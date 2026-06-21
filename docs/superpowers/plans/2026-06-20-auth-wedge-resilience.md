# Auth Wedge Resilience (Expiry-Aware Serialization + Request Timeout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the whole-app REST freeze that the auth single-flight fix introduced, while keeping refresh-token-reuse revocations impossible — by serializing requests *only* when the access token is stale (Option B) and bounding any request with a hard timeout (Option A).

**Architecture:** Two app-only changes layered on the already-merged single-flight fix.
(B) `CookieJar` learns the access token's expiry from the `Max-Age` the gateway already sends on `hermes_session_at`; `RestClient` then serializes requests only while the AT is at/near expiry (the only window in which a request falls back to the rotating refresh token and could race). When the AT is fresh, requests run concurrently again, so a hung request can't wedge the whole REST layer.
(A) Every request runs under an `AbortController` timeout, so even a hang during the serialized refresh window — or on a platform with an unbounded socket default — frees the chain after a fixed bound instead of freezing.
These compose with the server-side reuse grace window (already merged in the plugin): if B ever under-serializes due to clock skew, the grace window forgives the replay instead of revoking.

**Tech Stack:** TypeScript, React Native (Expo SDK 56), Jest. No new dependencies. `AbortController`/`AbortSignal` are available in the RN runtime and in jest-expo.

---

## File Structure

- `src/api/cookieJar.ts` — add an injectable clock, parse `Max-Age` for the access-token cookie into an absolute expiry, expose `accessTokenFresh(marginMs)`. Persistence (`toJSON`) is unchanged — expiry is ephemeral in-memory state; an unknown expiry (e.g. just after a cold restore) reads as "not fresh", which conservatively serializes (never worse than the current behavior).
- `src/api/restClient.ts` — branch in `request()` on `jar.accessTokenFresh(...)` (concurrent when fresh, chained when stale/unknown); wrap `send()` in an `AbortController` timeout; export the two tunables.
- `__tests__/cookieJar.test.ts` — expiry-tracking unit tests.
- `__tests__/restClient.test.ts` — concurrent-when-fresh, serialize-when-stale, and timeout tests (the existing single-flight test stays valid: it seeds only an RT, so the AT is unknown → not fresh → still serialized).

`src/connection.ts` needs **no change**: it calls `new CookieJar()` and `CookieJar.fromJSON(seeded)`, both of which keep working because the new clock parameter defaults to `Date.now`.

---

### Task 1: CookieJar tracks access-token expiry

**Files:**
- Modify: `src/api/cookieJar.ts`
- Test: `__tests__/cookieJar.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/cookieJar.test.ts` inside the `describe('CookieJar', …)` block:

```ts
  it('learns the access-token expiry from Max-Age and reports freshness against a margin', () => {
    let now = 1_000_000;
    const jar = new CookieJar(() => now);
    jar.ingest(['hermes_session_at=at; Max-Age=900; Path=/']); // expires at now+900s
    expect(jar.accessTokenFresh(60_000)).toBe(true); // ~840s left > 60s margin
    now += 850_000; // 850s later → ~50s of AT life remains
    expect(jar.accessTokenFresh(60_000)).toBe(false); // within the margin → stale
  });

  it('treats an unknown access-token expiry as not fresh (conservative)', () => {
    const jar = new CookieJar(() => 1_000_000);
    jar.ingest(['hermes_session_rt=r1; Path=/']); // RT only, no AT seen
    expect(jar.accessTokenFresh(60_000)).toBe(false);
  });

  it('forgets the access-token expiry when the AT cookie is deleted', () => {
    let now = 1_000_000;
    const jar = new CookieJar(() => now);
    jar.ingest(['hermes_session_at=at; Max-Age=900; Path=/']);
    expect(jar.accessTokenFresh(60_000)).toBe(true);
    jar.ingest(['hermes_session_at=; Max-Age=0; Path=/']); // server deletion
    expect(jar.accessTokenFresh(60_000)).toBe(false);
  });

  it('refreshes the expiry when the AT rotates (new Max-Age extends it)', () => {
    let now = 1_000_000;
    const jar = new CookieJar(() => now);
    jar.ingest(['hermes_session_at=at1; Max-Age=900; Path=/']);
    now += 880_000; // would be within margin now
    expect(jar.accessTokenFresh(60_000)).toBe(false);
    jar.ingest(['hermes_session_at=at2; Max-Age=900; Path=/']); // rotation resets the window
    expect(jar.accessTokenFresh(60_000)).toBe(true);
  });

  it('recognises the __Secure- prefixed access-token cookie (HTTPS deployments)', () => {
    const jar = new CookieJar(() => 1_000_000);
    jar.ingest(['__Secure-hermes_session_at=at; Max-Age=900; Path=/']);
    expect(jar.accessTokenFresh(60_000)).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest cookieJar`
Expected: FAIL — `jar.accessTokenFresh is not a function` (the method does not exist yet). The pre-existing CookieJar tests still pass.

- [ ] **Step 3: Implement the expiry tracking**

In `src/api/cookieJar.ts`, add the helper above the class:

```ts
/** The access-token cookie, plain and `__Secure-`-prefixed (HTTPS) variants. */
const AT_COOKIE_NAMES = new Set(['hermes_session_at', '__Secure-hermes_session_at']);
function isAccessTokenCookie(name: string): boolean {
  return AT_COOKIE_NAMES.has(name);
}
```

Give the class an injectable clock and the expiry field (the class currently has no explicit constructor):

```ts
export class CookieJar {
  private cookies = new Map<string, string>();
  private listener: ((snapshot: Record<string, string>) => void) | null = null;
  /** Absolute ms-epoch the access token expires, or null when unknown/none. */
  private atExpiresAtMs: number | null = null;

  /** `now` is injectable for tests; defaults to wall-clock. */
  constructor(private readonly now: () => number = () => Date.now()) {}
```

In `ingest`, keep the existing set/delete logic **unchanged** and add expiry tracking. The full method becomes:

```ts
  /** Accepts individual Set-Cookie strings or RN comma-joined ones. */
  ingest(setCookies: string[]): void {
    let changed = false;
    for (const raw of setCookies.flatMap(splitSetCookie)) {
      const [pair, ...attrs] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0+\s*$/i.test(a));
      if (expired || value === '') {
        if (this.cookies.delete(name)) changed = true;
        if (isAccessTokenCookie(name)) this.atExpiresAtMs = null;
      } else if (this.cookies.get(name) !== value) {
        this.cookies.set(name, value);
        changed = true;
      }
      // Record/refresh the access token's expiry from its Max-Age, independent
      // of whether the value changed (a re-sent AT with a new Max-Age still
      // extends the window).
      if (isAccessTokenCookie(name) && !expired && value !== '') {
        const m = attrs.map((a) => /^\s*max-age\s*=\s*(\d+)\s*$/i.exec(a)).find(Boolean);
        if (m) this.atExpiresAtMs = this.now() + parseInt(m[1], 10) * 1000;
      }
    }
    if (changed) this.notify();
  }
```

Add the freshness query (place it after `header()`):

```ts
  /** True only when a known access token has more than `marginMs` of life left.
   * Unknown expiry (no AT seen yet, e.g. just after a cold restore) → false, so
   * callers conservatively serialize until the next rotation reveals the expiry. */
  accessTokenFresh(marginMs: number, nowMs: number = this.now()): boolean {
    return this.atExpiresAtMs !== null && this.atExpiresAtMs - nowMs > marginMs;
  }
```

Thread the clock through `fromJSON` (expiry is not persisted, so a restored jar starts with unknown expiry → not fresh → serialized until first rotation):

```ts
  static fromJSON(data: Record<string, string>, now?: () => number): CookieJar {
    const jar = new CookieJar(now);
    for (const [k, v] of Object.entries(data)) jar.cookies.set(k, v);
    return jar;
  }
```

Leave `toJSON`, `header`, `clear`, `onChange`, `notify`, and `splitSetCookie` untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest cookieJar`
Expected: PASS — all new tests plus the four pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/api/cookieJar.ts __tests__/cookieJar.test.ts
git commit -m "feat(auth): track access-token expiry in CookieJar"
```

---

### Task 2: RestClient serializes only when the access token is stale

**Files:**
- Modify: `src/api/restClient.ts`
- Test: `__tests__/restClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `__tests__/restClient.test.ts` (reuse the `res` helper pattern already used by the single-flight block):

```ts
describe('RestClient expiry-aware serialization', () => {
  const res = (status: number, body: unknown, setCookie?: string) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => (k.toLowerCase() === 'set-cookie' ? setCookie ?? null : null) },
      json: async () => body,
    }) as unknown as Response;

  it('runs requests concurrently while the access token is fresh', async () => {
    const NOW = 1_000_000;
    const jar = new CookieJar(() => NOW);
    jar.ingest(['hermes_session_at=at; Max-Age=900; Path=/', 'hermes_session_rt=r1; Path=/']);

    let firstDone = false;
    let secondStartedBeforeFirstDone = false;
    let call = 0;
    const fetchFn = async () => {
      const i = call++;
      if (i === 0) {
        await new Promise((r) => setTimeout(r, 20));
        firstDone = true;
        return res(200, { ok: true });
      }
      secondStartedBeforeFirstDone = !firstDone; // proves the 2nd didn't wait for the 1st
      return res(200, { ok: true });
    };
    const c = new RestClient('http://h', jar, fetchFn as any);
    await Promise.all([c.get('/a'), c.get('/b')]);
    expect(secondStartedBeforeFirstDone).toBe(true);
  });

  it('serializes requests when the access token is within the refresh margin', async () => {
    const NOW = 1_000_000;
    const jar = new CookieJar(() => NOW);
    // 30s of AT life left — inside AT_FRESH_MARGIN_MS → treated as stale.
    jar.ingest(['hermes_session_at=at; Max-Age=30; Path=/', 'hermes_session_rt=r1; Path=/']);

    const seen: string[] = [];
    let call = 0;
    const fetchFn = async (_url: string, init: RequestInit = {}) => {
      const i = call++;
      seen[i] = (init.headers as Record<string, string>)['Cookie'] ?? '';
      if (i === 0) {
        await new Promise((r) => setTimeout(r, 20));
        return res(200, { ok: true }, 'hermes_session_rt=r2; Path=/');
      }
      return res(200, { ok: true });
    };
    const c = new RestClient('http://h', jar, fetchFn as any);
    await Promise.all([c.get('/a'), c.get('/b')]);
    expect(seen[0]).toContain('hermes_session_rt=r1');
    expect(seen[1]).toContain('hermes_session_rt=r2'); // 2nd waited for the rotation
  });
});
```

Also confirm `AT_FRESH_MARGIN_MS` is importable: at the top of the file, change the import to
`import { RestClient, AuthError, AT_FRESH_MARGIN_MS } from '../src/api/restClient';`
(used only to keep the test honest about the margin; the value is asserted indirectly via the 30s case).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest restClient -t "expiry-aware"`
Expected: FAIL — `runs requests concurrently while the access token is fresh` fails because today *every* request is chained, so the second waits for the first (`secondStartedBeforeFirstDone === false`). (The `import { AT_FRESH_MARGIN_MS }` will also error until Step 3 exports it.)

- [ ] **Step 3: Implement the conditional serialization**

In `src/api/restClient.ts`, add the tunable near the top (after the `FetchFn` type):

```ts
/** Serialize requests once the access token has less than this much life left
 * (or its expiry is unknown). That is the only window in which a request falls
 * back to the rotating refresh token, so it is the only window in which two
 * concurrent requests could replay the same RT. The margin absorbs clock skew
 * and in-flight time; the server-side reuse grace window backstops any residue. */
export const AT_FRESH_MARGIN_MS = 60_000;
```

Replace `request()` so it branches on freshness (keep the `chain` field and its comment):

```ts
  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    // Access token fresh → the server validates it without rotating, so
    // requests are safe to run concurrently and a hung request cannot wedge the
    // rest of the REST layer. Stale/unknown → fall back to the chain so only one
    // request at a time can trigger (and thus race) a refresh-token rotation.
    if (this.jar.accessTokenFresh(AT_FRESH_MARGIN_MS)) {
      return this.send<T>(path, init);
    }
    const run = this.chain.then(() => this.send<T>(path, init));
    // Keep the chain alive across failures — a rejected request must not wedge
    // later ones — while still propagating the real result to the caller.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest restClient`
Expected: PASS — the new expiry-aware tests, the existing single-flight tests (they seed only an RT → AT unknown → still serialized), and all other RestClient tests.

- [ ] **Step 5: Commit**

```bash
git add src/api/restClient.ts __tests__/restClient.test.ts
git commit -m "feat(auth): serialize REST only while the access token is stale"
```

---

### Task 3: RestClient bounds every request with a timeout

**Files:**
- Modify: `src/api/restClient.ts`
- Test: `__tests__/restClient.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/restClient.test.ts`. Import the constant:
`import { RestClient, AuthError, AT_FRESH_MARGIN_MS, REQUEST_TIMEOUT_MS } from '../src/api/restClient';`

```ts
describe('RestClient request timeout', () => {
  it('aborts a request that exceeds REQUEST_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    try {
      const jar = new CookieJar(() => 1_000_000);
      jar.ingest(['hermes_session_at=at; Max-Age=900; Path=/']); // fresh → direct send

      // Hangs forever unless its AbortSignal fires.
      const hang = (_url: string, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          (init.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
            const e = new Error('Aborted');
            e.name = 'AbortError';
            reject(e);
          });
        });
      const c = new RestClient('http://h', jar, hang as any);
      const p = c.get('/slow');
      p.catch(() => {}); // attach early so the rejection is never "unhandled"
      await Promise.resolve(); // let send() install the timer + abort listener
      jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
      await expect(p).rejects.toThrow(/timed out/i);
    } finally {
      jest.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest restClient -t "request timeout"`
Expected: FAIL — `REQUEST_TIMEOUT_MS` is not exported (import error), and `send()` never aborts, so the promise stays pending (the test would otherwise hang until jest's own test timeout).

- [ ] **Step 3: Implement the timeout**

In `src/api/restClient.ts`, add the tunable next to `AT_FRESH_MARGIN_MS`:

```ts
/** Hard upper bound per request. The audited REST surface is all small JSON on
 * a private network — nothing legitimately approaches this — so it only ever
 * fires on a genuine hang, turning a silent freeze into an explicit failure and
 * freeing the serialization chain. */
export const REQUEST_TIMEOUT_MS = 20_000;
```

Wrap the fetch in `send()` with an `AbortController`. Replace the fetch call (lines that build `res` from `this.fetchFn`) with:

```ts
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        credentials: 'omit', // we manage cookies ourselves
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') {
        throw new HttpError(0, `request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
```

The rest of `send()` (the `set-cookie` ingest, status checks, and JSON return) is unchanged and continues to use `res`. Note: if `init.signal` is ever supplied by a caller it is overwritten here; no current caller passes one, so this is safe.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest restClient -t "request timeout"`
Expected: PASS — the aborted request rejects with an `HttpError` whose message matches `/timed out/i`.

- [ ] **Step 5: Commit**

```bash
git add src/api/restClient.ts __tests__/restClient.test.ts
git commit -m "feat(auth): bound every REST request with an abort timeout"
```

---

## Final Verification (run after all tasks)

- [ ] `npx tsc --noEmit` — expected: clean (exit 0).
- [ ] `npx jest` — expected: all suites pass (current baseline is 330; this plan adds ~8 tests).

## Self-Review notes

- **Spec coverage:** B = Tasks 1–2 (expiry tracking + conditional serialize); A = Task 3 (timeout). Both app-only. ✓
- **Type consistency:** `accessTokenFresh(marginMs, nowMs?)` defined in Task 1 and called with one arg in Task 2. Constants `AT_FRESH_MARGIN_MS` / `REQUEST_TIMEOUT_MS` exported in Tasks 2/3 and imported by the tests. ✓
- **Known, accepted edge:** if the client's clock is skewed by more than `AT_FRESH_MARGIN_MS` (60s) versus the server, it may run requests concurrently when the server already considers the AT expired, reintroducing a rotation race. This is backstopped by the server-side reuse grace window (already merged). Documented in the `AT_FRESH_MARGIN_MS` comment.
- **Conservative default:** unknown AT expiry (cold restore with a still-valid persisted AT) reads as not-fresh → serialized until the first rotation reveals a `Max-Age`. Strictly no worse than the current single-flight behavior.
