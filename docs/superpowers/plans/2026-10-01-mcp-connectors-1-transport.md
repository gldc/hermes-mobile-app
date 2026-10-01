# MCP Connectors, Plan 1 of 3: Transport and Logic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the Connectors screens need that is not UI: the REST and RPC calls, the pure logic, the OAuth sign-in sequence and the bridge to the active chat, all unit-tested.

**Architecture:** Configuration and OAuth go over REST through `RestClient`; Test and runtime status go over the active chat's WebSocket through an injected `call`. Pure logic and the OAuth sequence take injected I/O so they are tested without a gateway. No screen, component or route is added in this plan.

**Tech Stack:** TypeScript 6, Expo SDK 57 / React Native 0.86, jest-expo. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-01-mcp-connectors-design.md` (revision 3). Section numbers below (`§n`) refer to it.

**The three plans:**

1. **This plan:** transport and logic, no UI. One PR.
2. Manage what exists: sidebar item, list, detail, Test, status, switch. Written after this PR merges, against the real interfaces.
3. Add: catalog, custom form, secrets, OAuth sign-in, Remove.

## Global Constraints

- Branch `feat/mcp-connectors-transport` from `origin/main`. PR-only; never push `main`.
- No new dependency. Never edit `src/vendor/hermes-gateway/**` except the app-owned `index.ts` barrel (not needed here).
- Never call `reload.mcp` and never send `always` to any RPC (§5.7).
- A secret value (bearer token, catalog `env` value) must never appear in a thrown error, a log, or module state (§5.9).
- Only `startMcpOauth` may use a request limit above 20 s, and it must send a fast request first (§6.1).
- Test files live in the top-level `__tests__/` and import with relative paths (`../src/...`), like `__tests__/skills.test.ts`.
- No `eslint-disable` comments. `npm run lint` covers `src/` only.
- Before every commit: `npx tsc --noEmit && npx jest && npm run lint`, each gated on its own exit code.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nothing in this plan talks to the live gateway.

## Two clarifications of the spec made here

- `containsSecret` lives in `src/api/mcp.ts`, next to its only caller, not in `src/lib/mcp.ts` as the spec's table says.
- Rule B (§5.6) accepts an authorization URL that has no `redirect_uri` parameter. Providers using pushed authorization requests omit it, and there is then nothing to check.

## Review Focus

Inputs the spec implies but does not spell out, each pinned by a test in the task named:

1. **A token typed with a `Bearer ` prefix or stray spaces** is echoed back by the gateway in a different form than typed; the error must still be cleaned. (Task 2)
2. **A server name with characters that need encoding** (a space, `#`, non-ASCII) must reach the right route. (Task 2)
3. **He returns to the app minutes after the provider redirected**; the first thing that happens must be a poll, and an approved flow must win over every time limit. (Task 5)
4. **The gateway becomes unreachable in the middle of a sign-in**; the sequence must end with an error, not poll forever. (Task 5)
5. **A payload with missing optional fields** (`description` absent, `tools` count missing, `required_env` absent) must not throw in the pure helpers. (Task 4)

## File Structure

| File | Responsibility |
| --- | --- |
| `src/api/restClient.ts` (modify) | Optional per-request timeout, bounded by `MAX_REQUEST_TIMEOUT_MS`. |
| `src/api/mcp.ts` (create) | REST types and calls; cleans errors of secret values. |
| `src/api/mcpSession.ts` (create) | The two RPCs over an injected `call`. |
| `src/lib/mcp.ts` (create) | Pure logic for the screens. |
| `src/lib/mcp-oauth.ts` (create) | The OAuth sign-in sequence with injected I/O. |
| `src/session-mcp-store.ts` (create) | Bridge: the active chat publishes Test and status; owner-checked clear. |
| `docs/contracts/mcp.md` (create) | The verified wire contract. |
| `AGENTS.md` (modify) | Architecture entries for the new files. |

---

### Task 1: Per-request timeout in `RestClient`

**Files:**
- Modify: `src/api/restClient.ts`
- Test: `__tests__/restClient.test.ts`

**Interfaces:**
- Produces:
  - `export const MAX_REQUEST_TIMEOUT_MS = 45_000`
  - `export interface RequestOptions { timeoutMs?: number }`
  - `export function resolveTimeoutMs(opts?: RequestOptions): number`
  - `get<T>(path, opts?)`, `post<T>(path, body?, opts?)`, `patch<T>(path, body?, opts?)`, `put<T>(path, body?, opts?)`, `del<T>(path, opts?)`

- [ ] **Step 1: Write the failing tests**

In `__tests__/restClient.test.ts`, change the import on line 2 to:

```ts
import {
  RestClient,
  AuthError,
  AT_FRESH_MARGIN_MS,
  MAX_REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  resolveTimeoutMs,
} from '../src/api/restClient';
```

Append at the end of the file:

```ts
describe('RestClient per-request timeout', () => {
  const abortError = () => {
    const e = new Error('Aborted');
    e.name = 'AbortError';
    return e;
  };

  /** A client whose fetch never answers; `signal()` is the request's abort signal. */
  function hangingClient() {
    const jar = new CookieJar(() => 1_000_000);
    jar.ingest(['hermes_session_at=at; Max-Age=900; Path=/']); // fresh → direct send
    let captured: AbortSignal | undefined;
    const hang = (_url: string, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        captured = init.signal as AbortSignal | undefined;
        captured?.addEventListener('abort', () => reject(abortError()));
      });
    return { c: new RestClient('http://h', jar, hang as any), signal: () => captured };
  }

  it('a longer limit outlives the default and fires at its own limit', async () => {
    jest.useFakeTimers();
    try {
      const { c, signal } = hangingClient();
      const p = c.post('/slow', {}, { timeoutMs: 45_000 });
      p.catch(() => {});
      await Promise.resolve();
      jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
      expect(signal()?.aborted).toBe(false);
      jest.advanceTimersByTime(45_000 - REQUEST_TIMEOUT_MS);
      expect(signal()?.aborted).toBe(true);
      await expect(p).rejects.toThrow('request timed out after 45s');
    } finally {
      jest.useRealTimers();
    }
  });

  it('clamps a limit above the ceiling', async () => {
    jest.useFakeTimers();
    try {
      const { c, signal } = hangingClient();
      const p = c.get('/slow', { timeoutMs: 600_000 });
      p.catch(() => {});
      await Promise.resolve();
      jest.advanceTimersByTime(MAX_REQUEST_TIMEOUT_MS);
      expect(signal()?.aborted).toBe(true);
      await expect(p).rejects.toThrow('request timed out after 45s');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the default limit and message when no option is passed', async () => {
    jest.useFakeTimers();
    try {
      const { c } = hangingClient();
      const p = c.del('/slow');
      p.catch(() => {});
      await Promise.resolve();
      jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
      await expect(p).rejects.toThrow('request timed out after 20s');
    } finally {
      jest.useRealTimers();
    }
  });

  it('resolveTimeoutMs ignores values that are not a positive finite number', () => {
    expect(resolveTimeoutMs()).toBe(REQUEST_TIMEOUT_MS);
    expect(resolveTimeoutMs({})).toBe(REQUEST_TIMEOUT_MS);
    expect(resolveTimeoutMs({ timeoutMs: 0 })).toBe(REQUEST_TIMEOUT_MS);
    expect(resolveTimeoutMs({ timeoutMs: -5 })).toBe(REQUEST_TIMEOUT_MS);
    expect(resolveTimeoutMs({ timeoutMs: Number.NaN })).toBe(REQUEST_TIMEOUT_MS);
    expect(resolveTimeoutMs({ timeoutMs: Number.POSITIVE_INFINITY })).toBe(REQUEST_TIMEOUT_MS);
    expect(resolveTimeoutMs({ timeoutMs: 30_000 })).toBe(30_000);
    expect(resolveTimeoutMs({ timeoutMs: 90_000 })).toBe(MAX_REQUEST_TIMEOUT_MS);
  });

  it('keeps the AT freshness margin above the ceiling', () => {
    expect(AT_FRESH_MARGIN_MS).toBeGreaterThan(MAX_REQUEST_TIMEOUT_MS);
    expect(MAX_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(REQUEST_TIMEOUT_MS);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/restClient.test.ts`
Expected: FAIL. TypeScript reports that `MAX_REQUEST_TIMEOUT_MS` and `resolveTimeoutMs` are not exported from `../src/api/restClient`.

- [ ] **Step 3: Implement**

In `src/api/restClient.ts`, replace the block from the `REQUEST_TIMEOUT_MS` doc comment through the invariant `if` (lines 20–36) with:

```ts
/** Default upper bound per request. The audited REST surface is all small JSON
 * on a private network — nothing legitimately approaches this — so it only ever
 * fires on a genuine hang, turning a silent freeze into an explicit failure and
 * freeing the serialization chain. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Ceiling for a per-request override. Only a call the gateway itself holds
 * open may ask for more than the default: starting MCP OAuth waits up to 30 s
 * for the authorization URL. A caller that raises the limit must send a fast
 * request first, because the gateway writes rotated cookies back only when the
 * handler returns — an aborted slow request would lose a rotation it carried
 * (docs/superpowers/specs/2026-10-01-mcp-connectors-design.md §6.1). */
export const MAX_REQUEST_TIMEOUT_MS = 45_000;

export interface RequestOptions {
  /** Per-request limit; clamped to MAX_REQUEST_TIMEOUT_MS. Default REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

export function resolveTimeoutMs(opts?: RequestOptions): number {
  const t = opts?.timeoutMs;
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return REQUEST_TIMEOUT_MS;
  return Math.min(t, MAX_REQUEST_TIMEOUT_MS);
}

// Load-bearing invariant. The off-chain "fresh" path lets a request skip the
// serialization chain; that is safe only because a fresh request finishes
// (bounded by MAX_REQUEST_TIMEOUT_MS) before the access token can fall below
// AT_FRESH_MARGIN_MS — so a fresh request and a later chained (post-rotation)
// request can never overlap on the same refresh token. That holds only while
// the margin dominates the largest timeout; fail loudly if a future edit breaks it.
if (AT_FRESH_MARGIN_MS <= MAX_REQUEST_TIMEOUT_MS || MAX_REQUEST_TIMEOUT_MS < REQUEST_TIMEOUT_MS) {
  throw new Error(
    'RestClient: AT_FRESH_MARGIN_MS must exceed MAX_REQUEST_TIMEOUT_MS, which must be at least REQUEST_TIMEOUT_MS (fresh-path race invariant)',
  );
}
```

Change `request` to take and forward the options:

```ts
  private request<T>(path: string, init: RequestInit = {}, opts?: RequestOptions): Promise<T> {
    const timeoutMs = resolveTimeoutMs(opts);
    // (keep the existing comment block here unchanged)
    if (this.jar.accessTokenFresh(AT_FRESH_MARGIN_MS)) {
      return this.send<T>(path, init, timeoutMs);
    }
    const run = this.chain.then(() => this.send<T>(path, init, timeoutMs));
    // (keep the existing chain bookkeeping unchanged)
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
```

Change `send`'s signature and its two uses of the constant:

```ts
  private async send<T>(path: string, init: RequestInit = {}, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<T> {
```

```ts
    const timer = setTimeout(() => controller.abort(), timeoutMs);
```

```ts
        throw new HttpError(0, `request timed out after ${timeoutMs / 1000}s`);
```

Replace the five generic verbs with:

```ts
  /** Generic authed verbs — feature modules (cron, memory, …) build on these
   * instead of growing this class. */
  get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>(path, {}, opts);
  }

  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }, opts);
  }

  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }, opts);
  }

  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }, opts);
  }

  del<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' }, opts);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/restClient.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Full gate and commit**

Run: `npx tsc --noEmit && npx jest && npm run lint`
Expected: all three exit 0.

```bash
git add src/api/restClient.ts __tests__/restClient.test.ts
git commit -m "feat(rest): optional per-request timeout, capped at 45 s" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: REST calls and secret-safe errors (`src/api/mcp.ts`)

**Files:**
- Create: `src/api/mcp.ts`
- Test: `__tests__/mcp.test.ts`

**Interfaces:**
- Consumes: `RestClient` verbs with `RequestOptions` (Task 1); `profileQuery(profile, '?')` from `src/api/profiles.ts`; `AuthError`, `HttpError`.
- Produces (all exported from `src/api/mcp.ts`):
  - Types `McpTransport`, `McpServer`, `McpTool`, `McpOauthStatus`, `McpOauthFlow`, `McpCatalogEnv`, `McpCatalogEntry`, `McpCatalog`, `McpAddBody`, `McpInstallResult`
  - `OAUTH_START_TIMEOUT_MS = 45_000`, `MIN_SECRET_LENGTH = 4`
  - `listMcpServers(rest, profile?) → Promise<McpServer[]>`
  - `addMcpServer(rest, body: McpAddBody, profile?) → Promise<McpServer>`
  - `removeMcpServer(rest, name, profile?) → Promise<{ ok: boolean }>`
  - `setMcpServerEnabled(rest, name, enabled, profile?) → Promise<{ ok: boolean; name: string; enabled: boolean }>`
  - `startMcpOauth(rest, name, profile?) → Promise<McpOauthFlow>`
  - `getMcpOauthFlow(rest, flowId) → Promise<McpOauthFlow>`
  - `cancelMcpOauthFlow(rest, flowId) → Promise<{ ok: boolean; status: string }>`
  - `listMcpCatalog(rest, profile?) → Promise<McpCatalog>`
  - `installMcpCatalogEntry(rest, name, env: Record<string, string>, profile?) → Promise<McpInstallResult>`
  - `containsSecret(text: string, values: readonly string[]) → boolean`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/mcp.test.ts`:

```ts
// __tests__/mcp.test.ts
import {
  OAUTH_START_TIMEOUT_MS,
  addMcpServer,
  cancelMcpOauthFlow,
  containsSecret,
  getMcpOauthFlow,
  installMcpCatalogEntry,
  listMcpCatalog,
  listMcpServers,
  removeMcpServer,
  setMcpServerEnabled,
  startMcpOauth,
  type McpServer,
} from '../src/api/mcp';
import { CookieJar } from '../src/api/cookieJar';
import { AuthError, HttpError, RestClient } from '../src/api/restClient';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      json: async () => body,
    } as unknown as Response;
  };
  return Object.assign(fn, { calls });
}

function client(f: ReturnType<typeof fakeFetch>) {
  return new RestClient('http://h', new CookieJar(), f as any);
}

function server(over: Partial<McpServer> = {}): McpServer {
  return {
    name: 'linear',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    command: null,
    args: [],
    env: {},
    auth: 'oauth',
    enabled: true,
    tools: null,
    source: 'config',
    plugin: null,
    ...over,
  };
}

const bodyOf = (f: ReturnType<typeof fakeFetch>, i = 0) => JSON.parse(f.calls[i].init.body as string);

describe('mcp api — servers', () => {
  it('listMcpServers unwraps {servers}', async () => {
    const f = fakeFetch(200, { servers: [server()] });
    const out = await listMcpServers(client(f));
    expect(f.calls[0].url).toBe('http://h/api/mcp/servers');
    expect(f.calls[0].init.method).toBeUndefined();
    expect(out).toEqual([server()]);
  });

  it('listMcpServers adds the profile only when one is selected', async () => {
    const f = fakeFetch(200, { servers: [] });
    await listMcpServers(client(f), 'work profile');
    await listMcpServers(client(f), null);
    expect(f.calls[0].url).toBe('http://h/api/mcp/servers?profile=work%20profile');
    expect(f.calls[1].url).toBe('http://h/api/mcp/servers');
  });

  it('addMcpServer posts the body and returns the summary', async () => {
    const f = fakeFetch(200, server({ name: 'mine', auth: null }));
    const out = await addMcpServer(client(f), { name: 'mine', url: 'https://x.example/mcp', auth: 'none' }, 'p');
    expect(f.calls[0].url).toBe('http://h/api/mcp/servers?profile=p');
    expect(f.calls[0].init.method).toBe('POST');
    expect(bodyOf(f)).toEqual({ name: 'mine', url: 'https://x.example/mcp', auth: 'none' });
    expect(out.name).toBe('mine');
  });

  it('addMcpServer sends a bearer token only in the body', async () => {
    const f = fakeFetch(200, server({ name: 'mine', auth: 'header' }));
    await addMcpServer(client(f), { name: 'mine', url: 'https://x.example/mcp', auth: 'header', bearer_token: 'tok-12345' });
    expect(bodyOf(f)).toEqual({ name: 'mine', url: 'https://x.example/mcp', auth: 'header', bearer_token: 'tok-12345' });
    expect(f.calls[0].url).not.toContain('tok-12345');
  });

  it('encodes server names in the path (review focus 2)', async () => {
    const f = fakeFetch(200, { ok: true, name: 'x', enabled: false });
    await setMcpServerEnabled(client(f), 'my server#1 é', false);
    await removeMcpServer(client(f), 'my server#1 é', 'p');
    expect(f.calls[0].url).toBe('http://h/api/mcp/servers/my%20server%231%20%C3%A9/enabled');
    expect(f.calls[0].init.method).toBe('PUT');
    expect(bodyOf(f)).toEqual({ enabled: false });
    expect(f.calls[1].url).toBe('http://h/api/mcp/servers/my%20server%231%20%C3%A9?profile=p');
    expect(f.calls[1].init.method).toBe('DELETE');
  });

  it('surfaces the gateway reason on a 409', async () => {
    const f = fakeFetch(409, { detail: "Server 'mine' already exists" });
    await expect(
      addMcpServer(client(f), { name: 'mine', url: 'https://x.example/mcp', auth: 'none' }),
    ).rejects.toThrow("Server 'mine' already exists");
  });
});

describe('mcp api — OAuth', () => {
  it('startMcpOauth sends a fast request first, then the slow POST', async () => {
    const f = fakeFetch(200, { servers: [], flow_id: 'f1', server_name: 'linear', status: 'authorization_required', authorization_url: 'https://a.example/authorize?state=s', error: null });
    const flow = await startMcpOauth(client(f), 'linear', 'p');
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].url).toBe('http://h/api/mcp/servers?profile=p');
    expect(f.calls[0].init.method).toBeUndefined();
    expect(f.calls[1].url).toBe('http://h/api/mcp/servers/linear/auth?profile=p');
    expect(f.calls[1].init.method).toBe('POST');
    expect(flow.flow_id).toBe('f1');
  });

  it('startMcpOauth asks for the long limit on the POST only', async () => {
    const seen: (number | undefined)[] = [];
    const rest = {
      get: async (_p: string, o?: { timeoutMs?: number }) => {
        seen.push(o?.timeoutMs);
        return { servers: [] };
      },
      post: async (_p: string, _b?: unknown, o?: { timeoutMs?: number }) => {
        seen.push(o?.timeoutMs);
        return { flow_id: 'f1', server_name: 'x', status: 'starting', authorization_url: null, error: null };
      },
      put: async () => ({}),
      del: async () => ({}),
    };
    await startMcpOauth(rest as any, 'x');
    expect(seen).toEqual([undefined, OAUTH_START_TIMEOUT_MS]);
  });

  it('startMcpOauth does not start a flow when the fast request fails', async () => {
    const f = fakeFetch(401, {});
    await expect(startMcpOauth(client(f), 'linear')).rejects.toThrow(AuthError);
    expect(f.calls).toHaveLength(1);
  });

  it('flow status and cancel are keyed by flow id, with no profile', async () => {
    const f = fakeFetch(200, { ok: true, status: 'error', flow_id: 'a/b', server_name: 'x', authorization_url: null, error: null });
    await getMcpOauthFlow(client(f), 'a/b');
    const res = await cancelMcpOauthFlow(client(f), 'a/b');
    expect(f.calls[0].url).toBe('http://h/api/mcp/oauth/flows/a%2Fb');
    expect(f.calls[1].url).toBe('http://h/api/mcp/oauth/flows/a%2Fb');
    expect(f.calls[1].init.method).toBe('DELETE');
    expect(res.status).toBe('error');
  });
});

describe('mcp api — catalog', () => {
  it('listMcpCatalog returns entries and diagnostics', async () => {
    const f = fakeFetch(200, { entries: [], diagnostics: [] });
    const out = await listMcpCatalog(client(f), 'p');
    expect(f.calls[0].url).toBe('http://h/api/mcp/catalog?profile=p');
    expect(out).toEqual({ entries: [], diagnostics: [] });
  });

  it('installMcpCatalogEntry posts name, env and enable:true', async () => {
    const f = fakeFetch(200, { ok: true, name: 'asana', background: false });
    const out = await installMcpCatalogEntry(client(f), 'asana', { ASANA_CLIENT_ID: 'id-1' }, 'p');
    expect(f.calls[0].url).toBe('http://h/api/mcp/catalog/install?profile=p');
    expect(bodyOf(f)).toEqual({ name: 'asana', env: { ASANA_CLIENT_ID: 'id-1' }, enable: true });
    expect(out.background).toBe(false);
  });
});

describe('mcp api — secret-safe errors', () => {
  const add = (f: ReturnType<typeof fakeFetch>, token: string) =>
    addMcpServer(client(f), { name: 'mine', url: 'https://x.example/mcp', auth: 'header', bearer_token: token });

  it('replaces a gateway message that echoes the token', async () => {
    const f = fakeFetch(400, { detail: 'bad header value tok-12345 rejected' });
    const err = await add(f, 'tok-12345').catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    expect(err.message).not.toContain('tok-12345');
    expect(err.message).toBe('The gateway rejected this connector.');
  });

  it('catches the trimmed and Bearer-stripped forms (review focus 1)', async () => {
    const f = fakeFetch(400, { detail: 'value tok-12345 rejected' });
    const err = await add(f, '  Bearer tok-12345 ').catch((e) => e);
    expect(err.message).not.toContain('tok-12345');
  });

  it('keeps a gateway message that does not contain the token', async () => {
    const f = fakeFetch(409, { detail: "Server 'mine' already exists" });
    await expect(add(f, 'tok-12345')).rejects.toThrow("Server 'mine' already exists");
  });

  it('uses a status-specific message, with a generic fallback', async () => {
    const dup = await add(fakeFetch(409, { detail: 'tok-12345' }), 'tok-12345').catch((e) => e);
    expect(dup.message).toBe('A connector with this name already exists.');
    const other = await add(fakeFetch(500, { detail: 'tok-12345' }), 'tok-12345').catch((e) => e);
    expect(other.message).toBe('The gateway returned an error (HTTP 500).');
  });

  it('cleans install errors that echo any env value', async () => {
    const f = fakeFetch(400, { detail: 'cannot write secret-value-9' });
    const err = await installMcpCatalogEntry(client(f), 'asana', { A: 'id-1', B: 'secret-value-9' }).catch((e) => e);
    expect(err.message).not.toContain('secret-value-9');
  });

  it('cleans a non-HTTP error too', async () => {
    const rest = {
      get: async () => ({}),
      post: async () => {
        throw new Error('socket closed while sending tok-12345');
      },
      put: async () => ({}),
      del: async () => ({}),
    };
    const err = await addMcpServer(rest as any, { name: 'm', url: 'https://x', auth: 'header', bearer_token: 'tok-12345' }).catch((e) => e);
    expect(err.message).toBe('The request failed.');
  });

  it('passes AuthError through untouched', async () => {
    await expect(add(fakeFetch(401, {}), 'tok-12345')).rejects.toThrow(AuthError);
  });

  it('containsSecret ignores values shorter than 4 characters', () => {
    expect(containsSecret('bad ab value', ['ab'])).toBe(false);
    expect(containsSecret('bad abcd value', ['abcd'])).toBe(true);
    expect(containsSecret('anything', [])).toBe(false);
    expect(containsSecret('x', ['   '])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/mcp.test.ts`
Expected: FAIL with "Cannot find module '../src/api/mcp'".

- [ ] **Step 3: Implement**

Create `src/api/mcp.ts`:

```ts
// src/api/mcp.ts — MCP connector REST surface (docs/contracts/mcp.md).
//
// Configuration and OAuth go over REST; Test and runtime status are RPCs
// (src/api/mcpSession.ts). The REST server shape is NOT the contract's RPC
// `McpServerSummary`: `env` is a redacted map and there is no
// `oauth_tokens_present`, so the types are declared here.
import { profileQuery } from './profiles';
import { AuthError, HttpError, type RestClient } from './restClient';

type Rest = Pick<RestClient, 'get' | 'post' | 'put' | 'del'>;

const enc = encodeURIComponent;
const serverPath = (name: string, suffix = ''): string => `/api/mcp/servers/${enc(name)}${suffix}`;
const flowPath = (flowId: string): string => `/api/mcp/oauth/flows/${enc(flowId)}`;

/** The gateway waits up to 30 s for the authorization URL before answering. */
export const OAUTH_START_TIMEOUT_MS = 45_000;

/** Values shorter than this are not searched for in error text (they would match by accident). */
export const MIN_SECRET_LENGTH = 4;

export type McpTransport = 'http' | 'stdio' | 'unknown';

/** Row from GET /api/mcp/servers. */
export interface McpServer {
  name: string;
  transport: McpTransport;
  url: string | null;
  command: string | null;
  args: string[];
  /** Redacted by the gateway; never a real secret. */
  env: Record<string, string>;
  /** 'oauth', 'header', or null for none. */
  auth: string | null;
  enabled: boolean;
  /** Tool filter (enabled tool names), or null for all. Not a tool count. */
  tools: string[] | null;
  source: 'config' | 'plugin';
  plugin: string | null;
}

export interface McpTool {
  name: string;
  description: string;
}

export type McpOauthStatus = 'starting' | 'authorization_required' | 'approved' | 'error';

export interface McpOauthFlow {
  flow_id: string;
  server_name: string;
  status: McpOauthStatus;
  authorization_url: string | null;
  error: string | null;
  /** Present on a status read once approved. */
  tools?: McpTool[];
}

export interface McpCatalogEnv {
  name: string;
  prompt: string;
  required: boolean;
}

export interface McpCatalogEntry {
  name: string;
  description: string;
  connector_slug: string | null;
  source: string | null;
  transport: string;
  auth_type: string;
  required_env: McpCatalogEnv[];
  url: string | null;
  needs_install: boolean;
  installed: boolean;
  enabled: boolean;
}

export interface McpCatalog {
  entries: McpCatalogEntry[];
  diagnostics: { name: string; kind: string; message: string }[];
}

export type McpAddBody =
  | { name: string; url: string; auth: 'none' | 'oauth' }
  | { name: string; url: string; auth: 'header'; bearer_token: string };

export interface McpInstallResult {
  ok: boolean;
  name: string;
  background: boolean;
}

// --- secret-safe errors (spec §5.9) ---------------------------------------

function secretVariants(value: string): string[] {
  const trimmed = value.trim();
  const forms = [value, trimmed, trimmed.replace(/^bearer\s+/i, '')];
  return [...new Set(forms)].filter((v) => v.length >= MIN_SECRET_LENGTH);
}

/** True when `text` contains any submitted value: as typed, trimmed, or without a leading `Bearer `. */
export function containsSecret(text: string, values: readonly string[]): boolean {
  return values.some((value) => secretVariants(value).some((v) => text.includes(v)));
}

const CLEAN_MESSAGES: Record<number, string> = {
  400: 'The gateway rejected this connector.',
  409: 'A connector with this name already exists.',
  422: 'The gateway could not read this request.',
};

function cleanError(e: unknown, values: readonly string[]): unknown {
  if (e instanceof AuthError) return e; // fixed client-side text, never the gateway's
  const message = e instanceof Error ? e.message : String(e);
  if (!containsSecret(message, values)) return e;
  if (e instanceof HttpError) {
    return new HttpError(e.status, CLEAN_MESSAGES[e.status] ?? `The gateway returned an error (HTTP ${e.status}).`);
  }
  return new Error('The request failed.');
}

/** Run a request that carries secret values; nothing that echoes one may leave this function. */
async function withSecrets<T>(values: readonly string[], run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw cleanError(e, values);
  }
}

// --- servers ---------------------------------------------------------------

export async function listMcpServers(rest: Rest, profile?: string | null): Promise<McpServer[]> {
  const res = await rest.get<{ servers: McpServer[] }>(`/api/mcp/servers${profileQuery(profile, '?')}`);
  return res.servers;
}

/** Add a remote server. A bearer token goes to the profile's .env on the gateway; the app keeps nothing. */
export function addMcpServer(rest: Rest, body: McpAddBody, profile?: string | null): Promise<McpServer> {
  const secrets = body.auth === 'header' ? [body.bearer_token] : [];
  return withSecrets(secrets, () => rest.post<McpServer>(`/api/mcp/servers${profileQuery(profile, '?')}`, body));
}

export function removeMcpServer(rest: Rest, name: string, profile?: string | null): Promise<{ ok: boolean }> {
  return rest.del<{ ok: boolean }>(`${serverPath(name)}${profileQuery(profile, '?')}`);
}

export function setMcpServerEnabled(
  rest: Rest,
  name: string,
  enabled: boolean,
  profile?: string | null,
): Promise<{ ok: boolean; name: string; enabled: boolean }> {
  return rest.put<{ ok: boolean; name: string; enabled: boolean }>(
    `${serverPath(name, '/enabled')}${profileQuery(profile, '?')}`,
    { enabled },
  );
}

// --- OAuth -----------------------------------------------------------------

/** Start a dashboard-mediated OAuth flow.
 *
 * The fast GET comes first on purpose (spec §6.1): the gateway writes rotated
 * cookies back only when a handler returns, so a refresh-token rotation must
 * ride a request that finishes quickly, never the slow POST that follows. */
export async function startMcpOauth(rest: Rest, name: string, profile?: string | null): Promise<McpOauthFlow> {
  await listMcpServers(rest, profile);
  return rest.post<McpOauthFlow>(
    `${serverPath(name, '/auth')}${profileQuery(profile, '?')}`,
    {},
    { timeoutMs: OAUTH_START_TIMEOUT_MS },
  );
}

export function getMcpOauthFlow(rest: Rest, flowId: string): Promise<McpOauthFlow> {
  return rest.get<McpOauthFlow>(flowPath(flowId));
}

/** Cancel a flow. `status` is the flow's status AFTER the cancel — 'approved' means it had already succeeded. */
export function cancelMcpOauthFlow(rest: Rest, flowId: string): Promise<{ ok: boolean; status: string }> {
  return rest.del<{ ok: boolean; status: string }>(flowPath(flowId));
}

// --- catalog ---------------------------------------------------------------

export function listMcpCatalog(rest: Rest, profile?: string | null): Promise<McpCatalog> {
  return rest.get<McpCatalog>(`/api/mcp/catalog${profileQuery(profile, '?')}`);
}

/** Install a catalog entry. `env` values are treated as secrets: the gateway stores them, the app does not. */
export function installMcpCatalogEntry(
  rest: Rest,
  name: string,
  env: Record<string, string>,
  profile?: string | null,
): Promise<McpInstallResult> {
  return withSecrets(Object.values(env), () =>
    rest.post<McpInstallResult>(`/api/mcp/catalog/install${profileQuery(profile, '?')}`, { name, env, enable: true }),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/mcp.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate and commit**

Run: `npx tsc --noEmit && npx jest && npm run lint`
Expected: all three exit 0.

```bash
git add src/api/mcp.ts __tests__/mcp.test.ts
git commit -m "feat(mcp): REST calls for connectors, with secret-safe errors" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: RPC calls (`src/api/mcpSession.ts`)

**Files:**
- Create: `src/api/mcpSession.ts`
- Test: `__tests__/mcpSession.test.ts`

**Interfaces:**
- Consumes: `GatewayClient['call']`, `withProfile` from `src/api/profiles.ts`, `RpcMethods` from `@/vendor/hermes-gateway`, `McpTool` (Task 2).
- Produces:
  - `export type McpRuntimeRow` (one row of `mcp.servers.status`)
  - `export type McpTestOutcome = { kind: 'ok'; tools: McpTool[]; prompts: number; resources: number; tokensPresent: boolean | null } | { kind: 'failed'; message: string; oauthNeeded: boolean; tokensPresent: boolean | null } | { kind: 'error'; message: string }`
  - `testMcpServer(call, name, profile?) → Promise<McpTestOutcome>` (never rejects)
  - `mcpServerStatus(call, profile?) → Promise<McpRuntimeRow[]>` (never rejects; `[]` on failure)

- [ ] **Step 1: Write the failing tests**

Create `__tests__/mcpSession.test.ts`:

```ts
// __tests__/mcpSession.test.ts
import { RpcError } from '../src/api/gatewayClient';
import { mcpServerStatus, testMcpServer } from '../src/api/mcpSession';

function recorder(result: unknown) {
  const calls: { method: string; params: unknown }[] = [];
  const call = async (method: string, params: unknown) => {
    calls.push({ method, params });
    if (result instanceof Error) throw result;
    return result;
  };
  return { call: call as any, calls };
}

describe('testMcpServer', () => {
  it('calls mcp.servers.test with the name and maps a success', async () => {
    const r = recorder({
      ok: true,
      tools: [{ name: 'search', description: 'Search issues' }],
      prompts: 2,
      resources: 1,
      oauth_needed: true,
      oauth_tokens_present: true,
    });
    const out = await testMcpServer(r.call, 'linear');
    expect(r.calls).toEqual([{ method: 'mcp.servers.test', params: { name: 'linear' } }]);
    expect(out).toEqual({
      kind: 'ok',
      tools: [{ name: 'search', description: 'Search issues' }],
      prompts: 2,
      resources: 1,
      tokensPresent: true,
    });
  });

  it('adds the profile only when one is selected', async () => {
    const r = recorder({ ok: true, tools: [], oauth_needed: false });
    await testMcpServer(r.call, 'x', 'work');
    await testMcpServer(r.call, 'x', null);
    expect(r.calls[0].params).toEqual({ name: 'x', profile: 'work' });
    expect(r.calls[1].params).toEqual({ name: 'x' });
  });

  it('defaults missing counts to 0 and a missing token flag to null', async () => {
    const r = recorder({ ok: true, tools: [], oauth_needed: false });
    expect(await testMcpServer(r.call, 'x')).toEqual({ kind: 'ok', tools: [], prompts: 0, resources: 0, tokensPresent: null });
  });

  it('maps ok:false to failed with the gateway error and the token flag', async () => {
    const r = recorder({
      ok: false,
      tools: [],
      error: 'OAuth authentication required — no token found.',
      oauth_needed: true,
      oauth_tokens_present: false,
    });
    expect(await testMcpServer(r.call, 'x')).toEqual({
      kind: 'failed',
      message: 'OAuth authentication required — no token found.',
      oauthNeeded: true,
      tokensPresent: false,
    });
  });

  it('gives a failed test without error text a plain message', async () => {
    const r = recorder({ ok: false, tools: [], oauth_needed: false });
    const out = await testMcpServer(r.call, 'x');
    expect(out).toEqual({ kind: 'failed', message: 'The connector did not respond.', oauthNeeded: false, tokensPresent: null });
  });

  it('maps a rejected call to error instead of throwing', async () => {
    const r = recorder(new RpcError("server 'x' not found", 4064));
    expect(await testMcpServer(r.call, 'x')).toEqual({ kind: 'error', message: "server 'x' not found" });
  });
});

describe('mcpServerStatus', () => {
  const row = { name: 'linear', transport: 'http', tools: 12, connected: true, disabled: false, status: 'connected', source: 'config', plugin: null };

  it('returns the rows', async () => {
    const r = recorder({ servers: [row], checked_at: 1 });
    expect(await mcpServerStatus(r.call, 'work')).toEqual([row]);
    expect(r.calls).toEqual([{ method: 'mcp.servers.status', params: { profile: 'work' } }]);
  });

  it('sends no profile for the gateway default', async () => {
    const r = recorder({ servers: [], checked_at: 1 });
    await mcpServerStatus(r.call);
    expect(r.calls[0].params).toEqual({});
  });

  it('returns [] when the call fails', async () => {
    const r = recorder(new RpcError('socket closed', -1));
    expect(await mcpServerStatus(r.call)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/mcpSession.test.ts`
Expected: FAIL with "Cannot find module '../src/api/mcpSession'".

- [ ] **Step 3: Implement**

Create `src/api/mcpSession.ts`:

```ts
// src/api/mcpSession.ts — the connector RPCs that ride the active chat's socket
// (docs/contracts/mcp.md). Test goes here, not over REST, because it really
// connects and can take a minute: a slow REST request can lose a refresh-token
// rotation (spec §4). I/O is injected (`call`) so this is unit-testable.
import type { RpcMethods } from '@/vendor/hermes-gateway';
import type { GatewayClient } from './gatewayClient';
import type { McpTool } from './mcp';
import { withProfile } from './profiles';

/** One row of `mcp.servers.status`: what the running gateway has loaded. */
export type McpRuntimeRow = RpcMethods['mcp.servers.status']['result']['servers'][number];

export type McpTestOutcome =
  | { kind: 'ok'; tools: McpTool[]; prompts: number; resources: number; tokensPresent: boolean | null }
  /** The gateway ran the test and the connector failed it. */
  | { kind: 'failed'; message: string; oauthNeeded: boolean; tokensPresent: boolean | null }
  /** The call itself failed (socket closed, unknown server, timeout). */
  | { kind: 'error'; message: string };

/** Connect, list tools, disconnect. Never rejects. */
export async function testMcpServer(
  call: GatewayClient['call'],
  name: string,
  profile?: string | null,
): Promise<McpTestOutcome> {
  try {
    const res = await call('mcp.servers.test', withProfile({ name }, profile));
    const tokensPresent = res.oauth_tokens_present ?? null;
    if (!res.ok) {
      return {
        kind: 'failed',
        message: res.error || 'The connector did not respond.',
        oauthNeeded: Boolean(res.oauth_needed),
        tokensPresent,
      };
    }
    return { kind: 'ok', tools: res.tools ?? [], prompts: res.prompts ?? 0, resources: res.resources ?? 0, tokensPresent };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Cached runtime state per configured server; the gateway never connects for this. `[]` on failure. */
export async function mcpServerStatus(call: GatewayClient['call'], profile?: string | null): Promise<McpRuntimeRow[]> {
  try {
    const res = await call('mcp.servers.status', withProfile({}, profile));
    return res.servers ?? [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/mcpSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate and commit**

Run: `npx tsc --noEmit && npx jest && npm run lint`
Expected: all three exit 0.

```bash
git add src/api/mcpSession.ts __tests__/mcpSession.test.ts
git commit -m "feat(mcp): test and runtime-status RPCs over the chat socket" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pure logic (`src/lib/mcp.ts`)

**Files:**
- Create: `src/lib/mcp.ts`
- Test: `__tests__/mcp-lib.test.ts`

**Interfaces:**
- Consumes: `McpServer`, `McpCatalogEntry` (Task 2); `McpRuntimeRow` (Task 3); `AuthError`, `HttpError`.
- Produces:
  - `remoteCatalogEntries(entries) → McpCatalogEntry[]`
  - `filterCatalog(entries, query) → McpCatalogEntry[]`
  - `suggestServerName(url) → string`
  - `interface CustomServerDraft { name: string; url: string; auth: 'none' | 'header' | 'oauth'; hasToken: boolean }`
  - `interface CustomServerIssues { name?: string; url?: string; token?: string; caution?: string }`
  - `validateCustomServer(draft) → CustomServerIssues`, `isCustomServerValid(issues) → boolean`
  - `interface ServerCapabilities { manageable: boolean; canSwitch: boolean; canTest: boolean; autoTest: boolean; canSignIn: boolean; canRemove: boolean }`
  - `serverCapabilities(server) → ServerCapabilities`
  - `authLabel(server) → 'OAuth' | 'Token' | null`
  - `serverSubtitle(server) → string`
  - `statusLine(server, row?) → string | null`
  - `isPlainEnvField(name) → boolean`
  - `type ConnectorAction = 'list' | 'catalog' | 'add' | 'install' | 'switch' | 'remove' | 'signin'`
  - `type ConnectorError = { kind: 'auth' } | { kind: 'unsupported'; message: string } | { kind: 'gone'; message: string } | { kind: 'message'; message: string }`
  - `connectorError(error, action) → ConnectorError`
  - `checkAuthorizationUrl(url, baseUrl) → string | null` (null = safe to open; otherwise the message to show)
  - `gatewaySupportsOauth(baseUrl) → boolean`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/mcp-lib.test.ts`:

```ts
// __tests__/mcp-lib.test.ts
import type { McpCatalogEntry, McpServer } from '../src/api/mcp';
import type { McpRuntimeRow } from '../src/api/mcpSession';
import { AuthError, HttpError } from '../src/api/restClient';
import {
  authLabel,
  checkAuthorizationUrl,
  connectorError,
  filterCatalog,
  gatewaySupportsOauth,
  isCustomServerValid,
  isPlainEnvField,
  remoteCatalogEntries,
  serverCapabilities,
  serverSubtitle,
  statusLine,
  suggestServerName,
  validateCustomServer,
} from '../src/lib/mcp';

function server(over: Partial<McpServer> = {}): McpServer {
  return {
    name: 'linear',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    command: null,
    args: [],
    env: {},
    auth: 'oauth',
    enabled: true,
    tools: null,
    source: 'config',
    plugin: null,
    ...over,
  };
}

function entry(over: Partial<McpCatalogEntry> = {}): McpCatalogEntry {
  return {
    name: 'linear',
    description: 'Issues and projects',
    connector_slug: 'linear',
    source: 'https://linear.app/docs/mcp',
    transport: 'http',
    auth_type: 'oauth',
    required_env: [],
    url: 'https://mcp.linear.app/mcp',
    needs_install: false,
    installed: false,
    enabled: false,
    ...over,
  };
}

function row(over: Partial<McpRuntimeRow> = {}): McpRuntimeRow {
  return { name: 'linear', transport: 'http', tools: 12, connected: true, disabled: false, status: 'connected', source: 'config', plugin: null, ...over };
}

describe('catalog', () => {
  it('keeps remote entries that need no install, sorted by name', () => {
    const out = remoteCatalogEntries([
      entry({ name: 'zapier' }),
      entry({ name: 'local', transport: 'stdio' }),
      entry({ name: 'builder', needs_install: true }),
      entry({ name: 'airtable' }),
    ]);
    expect(out.map((e) => e.name)).toEqual(['airtable', 'zapier']);
  });

  it('filters by name and description, case-insensitively', () => {
    const all = [entry({ name: 'linear', description: 'Issues' }), entry({ name: 'figma', description: 'Design FILES' })];
    expect(filterCatalog(all, 'files').map((e) => e.name)).toEqual(['figma']);
    expect(filterCatalog(all, ' LIN ').map((e) => e.name)).toEqual(['linear']);
    expect(filterCatalog(all, '')).toHaveLength(2);
  });

  it('tolerates entries with missing optional fields (review focus 5)', () => {
    const bare = { name: 'bare', transport: 'http', needs_install: false } as unknown as McpCatalogEntry;
    expect(remoteCatalogEntries([bare])).toHaveLength(1);
    expect(filterCatalog([bare], 'zzz')).toEqual([]);
    expect(filterCatalog([bare], 'bar')).toHaveLength(1);
  });
});

describe('suggestServerName', () => {
  it.each([
    ['https://mcp.linear.app/mcp', 'linear'],
    ['https://gws.mcp.gldc.io', 'gws'],
    ['https://example.com/x', 'example'],
    ['https://api.githubcopilot.com/mcp/', 'githubcopilot'],
    ['http://localhost:3000', 'localhost'],
    ['http://100.89.28.11:8080', ''],
    ['not a url', ''],
    ['', ''],
  ])('%s → %s', (url, name) => {
    expect(suggestServerName(url)).toBe(name);
  });
});

describe('validateCustomServer', () => {
  const ok = { name: 'mine', url: 'https://x.example/mcp', auth: 'none' as const, hasToken: false };

  it('accepts a complete draft', () => {
    const issues = validateCustomServer(ok);
    expect(issues).toEqual({});
    expect(isCustomServerValid(issues)).toBe(true);
  });

  it('requires a name without spaces or slashes', () => {
    expect(validateCustomServer({ ...ok, name: '  ' }).name).toBe('Enter a name.');
    expect(validateCustomServer({ ...ok, name: 'my server' }).name).toBe('Use a name without spaces or slashes.');
    expect(validateCustomServer({ ...ok, name: 'a/b' }).name).toBe('Use a name without spaces or slashes.');
  });

  it('requires an http or https URL', () => {
    expect(validateCustomServer({ ...ok, url: '' }).url).toBe('Enter the server URL.');
    expect(validateCustomServer({ ...ok, url: 'ftp://x.example' }).url).toBe('Enter a URL that starts with https://');
    expect(validateCustomServer({ ...ok, url: 'x.example/mcp' }).url).toBe('Enter a URL that starts with https://');
  });

  it('cautions on http but still allows it', () => {
    const issues = validateCustomServer({ ...ok, url: 'http://10.0.0.5:8000/mcp' });
    expect(issues.url).toBeUndefined();
    expect(issues.caution).toBe('Traffic between your gateway and this server will not be encrypted.');
    expect(isCustomServerValid(issues)).toBe(true);
  });

  it('requires a token for bearer auth only', () => {
    expect(validateCustomServer({ ...ok, auth: 'header', hasToken: false }).token).toBe('Enter the token.');
    expect(validateCustomServer({ ...ok, auth: 'header', hasToken: true }).token).toBeUndefined();
    expect(validateCustomServer({ ...ok, auth: 'oauth', hasToken: false }).token).toBeUndefined();
  });
});

describe('serverCapabilities (spec §5.3)', () => {
  it('remote config server with OAuth: everything', () => {
    expect(serverCapabilities(server())).toEqual({ manageable: true, canSwitch: true, canTest: true, autoTest: true, canSignIn: true, canRemove: true });
  });
  it('remote config server without OAuth cannot sign in', () => {
    expect(serverCapabilities(server({ auth: 'header' })).canSignIn).toBe(false);
    expect(serverCapabilities(server({ auth: null })).canSignIn).toBe(false);
  });
  it('stdio config server: switch and on-demand test only', () => {
    expect(serverCapabilities(server({ transport: 'stdio', url: null, command: 'uvx', auth: null }))).toEqual({
      manageable: true, canSwitch: true, canTest: true, autoTest: false, canSignIn: false, canRemove: false,
    });
  });
  it('plugin server: test only', () => {
    expect(serverCapabilities(server({ source: 'plugin', plugin: 'p' }))).toEqual({
      manageable: true, canSwitch: false, canTest: true, autoTest: true, canSignIn: false, canRemove: false,
    });
  });
  it('unknown transport: switch only', () => {
    expect(serverCapabilities(server({ transport: 'unknown', url: null, auth: null }))).toEqual({
      manageable: true, canSwitch: true, canTest: false, autoTest: false, canSignIn: false, canRemove: false,
    });
  });
  it('a name with a slash cannot be managed over REST', () => {
    expect(serverCapabilities(server({ name: 'a/b' }))).toEqual({
      manageable: false, canSwitch: false, canTest: true, autoTest: true, canSignIn: false, canRemove: false,
    });
  });
});

describe('labels', () => {
  it('authLabel', () => {
    expect(authLabel(server({ auth: 'oauth' }))).toBe('OAuth');
    expect(authLabel(server({ auth: 'header' }))).toBe('Token');
    expect(authLabel(server({ auth: null }))).toBeNull();
    expect(authLabel(server({ auth: 'none' }))).toBeNull();
  });

  it('serverSubtitle shows the host, the command, or nothing', () => {
    expect(serverSubtitle(server())).toBe('mcp.linear.app');
    expect(serverSubtitle(server({ url: 'not a url' }))).toBe('not a url');
    expect(serverSubtitle(server({ transport: 'stdio', url: null, command: 'uvx', args: ['a', 'b'] }))).toBe('uvx a b');
    expect(serverSubtitle(server({ transport: 'unknown', url: null, command: null }))).toBe('');
  });

  it('isPlainEnvField unmasks only URL, HOST and ID names', () => {
    expect(isPlainEnvField('N8N_MCP_SERVER_URL')).toBe(true);
    expect(isPlainEnvField('db_host')).toBe(true);
    expect(isPlainEnvField('ASANA_CLIENT_ID')).toBe(true);
    expect(isPlainEnvField('ASANA_CLIENT_SECRET')).toBe(false);
    expect(isPlainEnvField('GITHUB_PAT')).toBe(false);
    expect(isPlainEnvField('URL_SIGNING_KEY')).toBe(false);
  });
});

describe('statusLine (spec §5.8)', () => {
  it('has no line without a runtime row', () => {
    expect(statusLine(server())).toBeNull();
  });
  it.each([
    [row({ status: 'connected', tools: 12 }), 'Connected · 12 tools'],
    [row({ status: 'connected', tools: 1 }), 'Connected · 1 tool'],
    [row({ status: 'lazy', tools: 3 }), 'Ready · 3 tools'],
    [row({ status: 'connecting' }), 'Connecting…'],
    [row({ status: 'failed' }), 'Failed'],
  ])('enabled server: %#', (r, line) => {
    expect(statusLine(server(), r)).toBe(line);
  });
  it('marks a mismatch between the switch and the running gateway', () => {
    expect(statusLine(server({ enabled: false }), row({ status: 'connected', tools: 2 }))).toBe('Connected · 2 tools · changes after restart');
    expect(statusLine(server({ enabled: false }), row({ status: 'lazy', tools: 2 }))).toBe('Ready · 2 tools · changes after restart');
    expect(statusLine(server({ enabled: true }), row({ status: 'disabled' }))).toBe('Off · changes after restart');
    expect(statusLine(server({ enabled: true }), row({ status: 'configured' }))).toBe('Not loaded yet · changes after restart');
  });
  it('has no suffix when they agree', () => {
    expect(statusLine(server({ enabled: false }), row({ status: 'disabled' }))).toBe('Off');
    expect(statusLine(server({ enabled: false }), row({ status: 'configured' }))).toBe('Not loaded yet');
  });
  it('tolerates a missing tool count and an unknown status (review focus 5)', () => {
    expect(statusLine(server(), { ...row(), tools: undefined } as unknown as McpRuntimeRow)).toBe('Connected · 0 tools');
    expect(statusLine(server(), { ...row(), status: 'new-state' } as unknown as McpRuntimeRow)).toBeNull();
  });
});

describe('connectorError (spec §8)', () => {
  it('AuthError → auth', () => {
    expect(connectorError(new AuthError('x'), 'list')).toEqual({ kind: 'auth' });
  });
  it('a bare 404 on the list or catalog means an unsupported gateway', () => {
    const msg = "This gateway doesn't support connectors (needs Hermes 0.21.5 or later).";
    expect(connectorError(new HttpError(404, 'Not Found'), 'list')).toEqual({ kind: 'unsupported', message: msg });
    expect(connectorError(new HttpError(404, 'HTTP 404 on /api/mcp/catalog'), 'catalog')).toEqual({ kind: 'unsupported', message: msg });
  });
  it('a 404 with a reason on the list is shown as the reason', () => {
    expect(connectorError(new HttpError(404, "Profile 'x' not found"), 'list')).toEqual({ kind: 'message', message: "Profile 'x' not found" });
  });
  it('a non-JSON answer on the list means an unsupported gateway', () => {
    expect(connectorError(new SyntaxError('Unexpected token <'), 'list').kind).toBe('unsupported');
  });
  it('a 404 on a server action means the connector is gone', () => {
    for (const action of ['switch', 'remove', 'signin'] as const) {
      expect(connectorError(new HttpError(404, "Server 'x' not found"), action)).toEqual({ kind: 'gone', message: 'This connector no longer exists.' });
    }
  });
  it('a 404 on install is the gateway reason', () => {
    expect(connectorError(new HttpError(404, "No catalog entry 'x'"), 'install')).toEqual({ kind: 'message', message: "No catalog entry 'x'" });
  });
  it('a timeout on a write says to check the list first', () => {
    expect(connectorError(new HttpError(0, 'request timed out after 20s'), 'add')).toEqual({
      kind: 'message',
      message: 'The gateway did not answer in time. Check the list before trying again.',
    });
    expect(connectorError(new HttpError(0, 'request timed out after 20s'), 'list')).toEqual({
      kind: 'message',
      message: 'The gateway did not answer in time.',
    });
  });
  it('other HTTP errors show the gateway reason', () => {
    expect(connectorError(new HttpError(409, "Server 'x' already exists"), 'add')).toEqual({ kind: 'message', message: "Server 'x' already exists" });
    expect(connectorError(new HttpError(429, 'rate limited — wait a minute'), 'signin')).toEqual({ kind: 'message', message: 'rate limited — wait a minute' });
  });
  it('anything else is a network failure', () => {
    expect(connectorError(new TypeError('Network request failed'), 'switch')).toEqual({
      kind: 'message',
      message: 'Gateway unreachable — check your VPN or Wi-Fi.',
    });
    expect(connectorError('boom', 'list').kind).toBe('message');
  });
});

describe('checkAuthorizationUrl (rule B, spec §5.6)', () => {
  const base = 'https://hermes.kite-opah.ts.net';
  const cb = encodeURIComponent('https://hermes.kite-opah.ts.net/api/mcp/oauth/callback/linear');

  it('accepts an https URL whose redirect comes back to the gateway', () => {
    expect(checkAuthorizationUrl(`https://linear.app/oauth/authorize?state=s&redirect_uri=${cb}`, base)).toBeNull();
  });
  it('accepts a gateway URL written with a trailing slash or other case', () => {
    expect(checkAuthorizationUrl(`https://a.example/authorize?redirect_uri=${cb}`, 'https://Hermes.Kite-Opah.ts.net/')).toBeNull();
  });
  it('accepts an https URL with no redirect_uri (pushed authorization request)', () => {
    expect(checkAuthorizationUrl('https://a.example/authorize?request_uri=urn%3Ax&client_id=c', base)).toBeNull();
  });
  it('refuses a URL that is not https', () => {
    expect(checkAuthorizationUrl(`http://a.example/authorize?redirect_uri=${cb}`, base)).toBe(
      'The sign-in address is not HTTPS, so it was not opened.',
    );
    expect(checkAuthorizationUrl('tel:+15551234', base)).toBe('The sign-in address is not HTTPS, so it was not opened.');
  });
  it('refuses a URL that does not parse', () => {
    expect(checkAuthorizationUrl('::::', base)).toBe('The gateway returned a sign-in address that is not a valid URL.');
  });
  it('refuses a redirect to another host, another path, or plain http', () => {
    const elsewhere = encodeURIComponent('http://127.0.0.1:9119/api/mcp/oauth/callback/linear');
    const wrongPath = encodeURIComponent('https://hermes.kite-opah.ts.net/other/linear');
    const msg =
      'The gateway would send the sign-in back to an address this phone cannot reach. Set HERMES_DASHBOARD_PUBLIC_URL on the gateway to https://hermes.kite-opah.ts.net.';
    expect(checkAuthorizationUrl(`https://a.example/authorize?redirect_uri=${elsewhere}`, base)).toBe(msg);
    expect(checkAuthorizationUrl(`https://a.example/authorize?redirect_uri=${wrongPath}`, base)).toBe(msg);
    expect(checkAuthorizationUrl('https://a.example/authorize?redirect_uri=nonsense', base)).toBe(msg);
  });
  it('gatewaySupportsOauth needs an https gateway URL', () => {
    expect(gatewaySupportsOauth('https://hermes.kite-opah.ts.net')).toBe(true);
    expect(gatewaySupportsOauth('HTTPS://h')).toBe(true);
    expect(gatewaySupportsOauth('http://100.89.28.11:9119')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/mcp-lib.test.ts`
Expected: FAIL with "Cannot find module '../src/lib/mcp'".

- [ ] **Step 3: Implement**

Create `src/lib/mcp.ts`:

```ts
// src/lib/mcp.ts — pure logic for the Connectors screens (spec §5, §8). No I/O.
import type { McpCatalogEntry, McpServer } from '@/api/mcp';
import type { McpRuntimeRow } from '@/api/mcpSession';
import { AuthError, HttpError } from '@/api/restClient';

// --- catalog ---------------------------------------------------------------

/** Entries the app can add: remote, with no local install step. Sorted by name. */
export function remoteCatalogEntries(entries: McpCatalogEntry[]): McpCatalogEntry[] {
  return entries
    .filter((e) => e.transport === 'http' && !e.needs_install)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Case-insensitive substring match over name and description. */
export function filterCatalog(entries: McpCatalogEntry[], query: string): McpCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) => e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q),
  );
}

// --- custom server form ----------------------------------------------------

const SKIPPED_LABELS = new Set(['www', 'mcp', 'api']);

/** A name suggestion from the URL's host: `https://mcp.linear.app/mcp` → `linear`. '' when there is none. */
export function suggestServerName(url: string): string {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return '';
  const labels = host.split('.').filter(Boolean);
  const body = labels.length > 1 ? labels.slice(0, -1) : labels;
  const pick = body.find((l) => !SKIPPED_LABELS.has(l)) ?? body[0] ?? '';
  return pick.replace(/[^a-z0-9_-]/g, '-');
}

export interface CustomServerDraft {
  name: string;
  url: string;
  auth: 'none' | 'header' | 'oauth';
  /** Whether a token has been typed. The token itself never reaches this module. */
  hasToken: boolean;
}

export interface CustomServerIssues {
  name?: string;
  url?: string;
  token?: string;
  /** Not an error: shown under the URL field. */
  caution?: string;
}

/** Client-side checks before any request; the gateway does the real validation. */
export function validateCustomServer(draft: CustomServerDraft): CustomServerIssues {
  const issues: CustomServerIssues = {};
  const name = draft.name.trim();
  if (!name) issues.name = 'Enter a name.';
  else if (/[\s/]/.test(name)) issues.name = 'Use a name without spaces or slashes.';

  const url = draft.url.trim();
  if (!url) {
    issues.url = 'Enter the server URL.';
  } else {
    let protocol = '';
    try {
      protocol = new URL(url).protocol;
    } catch {
      protocol = '';
    }
    if (protocol === 'http:') {
      issues.caution = 'Traffic between your gateway and this server will not be encrypted.';
    } else if (protocol !== 'https:') {
      issues.url = 'Enter a URL that starts with https://';
    }
  }

  if (draft.auth === 'header' && !draft.hasToken) issues.token = 'Enter the token.';
  return issues;
}

export function isCustomServerValid(issues: CustomServerIssues): boolean {
  return !issues.name && !issues.url && !issues.token;
}

// --- what a server allows (spec §5.3) --------------------------------------

export interface ServerCapabilities {
  /** False when the REST routes cannot address the name (it contains '/'). */
  manageable: boolean;
  canSwitch: boolean;
  canTest: boolean;
  /** Test runs when the detail screen opens (remote servers only). */
  autoTest: boolean;
  canSignIn: boolean;
  canRemove: boolean;
}

export function serverCapabilities(server: McpServer): ServerCapabilities {
  const manageable = !server.name.includes('/');
  const config = server.source !== 'plugin';
  const remote = server.transport === 'http';
  const known = server.transport === 'http' || server.transport === 'stdio';
  return {
    manageable,
    canSwitch: manageable && config,
    canTest: known,
    autoTest: remote,
    canSignIn: manageable && config && remote && server.auth === 'oauth',
    canRemove: manageable && config && remote,
  };
}

// --- labels ----------------------------------------------------------------

export function authLabel(server: McpServer): 'OAuth' | 'Token' | null {
  if (server.auth === 'oauth') return 'OAuth';
  if (server.auth === 'header') return 'Token';
  return null;
}

/** Second line of a row: the URL's host, or the command for a local server. */
export function serverSubtitle(server: McpServer): string {
  if (server.url) {
    try {
      return new URL(server.url).host;
    } catch {
      return server.url;
    }
  }
  if (server.command) return [server.command, ...(server.args ?? [])].join(' ');
  return '';
}

const tools = (n: unknown): string => {
  const count = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return `${count} ${count === 1 ? 'tool' : 'tools'}`;
};

/** The runtime status line (spec §5.8); null when there is nothing to show. */
export function statusLine(server: McpServer, row?: McpRuntimeRow): string | null {
  if (!row) return null;
  let line: string;
  switch (row.status) {
    case 'connected':
      line = `Connected · ${tools(row.tools)}`;
      break;
    case 'lazy':
      line = `Ready · ${tools(row.tools)}`;
      break;
    case 'connecting':
      return 'Connecting…';
    case 'failed':
      return 'Failed';
    case 'disabled':
      line = 'Off';
      break;
    case 'configured':
      line = 'Not loaded yet';
      break;
    default:
      return null;
  }
  const loaded = row.status === 'connected' || row.status === 'lazy';
  const mismatch = server.enabled ? !loaded : loaded;
  return mismatch ? `${line} · changes after restart` : line;
}

/** Catalog credential fields are masked unless the name says the value is not a secret (spec §5.9). */
export function isPlainEnvField(name: string): boolean {
  return /_(URL|HOST|ID)$/i.test(name);
}

// --- errors (spec §8) ------------------------------------------------------

export type ConnectorAction = 'list' | 'catalog' | 'add' | 'install' | 'switch' | 'remove' | 'signin';

export type ConnectorError =
  | { kind: 'auth' }
  | { kind: 'unsupported'; message: string }
  | { kind: 'gone'; message: string }
  | { kind: 'message'; message: string };

const UNSUPPORTED = "This gateway doesn't support connectors (needs Hermes 0.21.5 or later).";
const GONE = 'This connector no longer exists.';
const UNREACHABLE = 'Gateway unreachable — check your VPN or Wi-Fi.';

const isRead = (a: ConnectorAction): boolean => a === 'list' || a === 'catalog';
const isServerAction = (a: ConnectorAction): boolean => a === 'switch' || a === 'remove' || a === 'signin';

/** Map a failed connector request to what the screen does and says. */
export function connectorError(error: unknown, action: ConnectorAction): ConnectorError {
  if (error instanceof AuthError) return { kind: 'auth' };
  if (error instanceof HttpError) {
    if (error.status === 404) {
      const bare = /^not found$/i.test(error.message) || error.message.startsWith('HTTP 404 on ');
      if (isRead(action) && bare) return { kind: 'unsupported', message: UNSUPPORTED };
      if (isServerAction(action)) return { kind: 'gone', message: GONE };
    }
    if (error.status === 0) {
      const write = action === 'add' || action === 'install';
      return {
        kind: 'message',
        message: `The gateway did not answer in time.${write ? ' Check the list before trying again.' : ''}`,
      };
    }
    return { kind: 'message', message: error.message };
  }
  // An old gateway answers unknown /api paths with its HTML shell: res.json() throws SyntaxError.
  if (error instanceof SyntaxError && isRead(action)) return { kind: 'unsupported', message: UNSUPPORTED };
  return { kind: 'message', message: UNREACHABLE };
}

// --- OAuth (spec §5.6) -----------------------------------------------------

/** OAuth needs the gateway on HTTPS: providers do not accept a plain-HTTP redirect. */
export function gatewaySupportsOauth(baseUrl: string): boolean {
  return /^https:\/\//i.test(baseUrl.trim());
}

/** Rule B: null when the authorization URL is safe to open, otherwise the message to show. */
export function checkAuthorizationUrl(url: string, baseUrl: string): string | null {
  let auth: URL;
  try {
    auth = new URL(url);
  } catch {
    return 'The gateway returned a sign-in address that is not a valid URL.';
  }
  if (auth.protocol !== 'https:') return 'The sign-in address is not HTTPS, so it was not opened.';

  const redirect = auth.searchParams.get('redirect_uri');
  if (redirect === null) return null; // pushed authorization request: nothing to check

  const base = baseUrl.trim().replace(/\/+$/, '');
  const misconfigured = `The gateway would send the sign-in back to an address this phone cannot reach. Set HERMES_DASHBOARD_PUBLIC_URL on the gateway to ${base.toLowerCase()}.`;
  try {
    const want = new URL(base);
    const got = new URL(redirect);
    const prefix = `${want.pathname.replace(/\/+$/, '')}/api/mcp/oauth/callback/`;
    return got.origin === want.origin && got.pathname.startsWith(prefix) ? null : misconfigured;
  } catch {
    return misconfigured;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/mcp-lib.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate and commit**

Run: `npx tsc --noEmit && npx jest && npm run lint`
Expected: all three exit 0.

```bash
git add src/lib/mcp.ts __tests__/mcp-lib.test.ts
git commit -m "feat(mcp): pure logic for the connectors screens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: OAuth sign-in sequence (`src/lib/mcp-oauth.ts`)

**Files:**
- Create: `src/lib/mcp-oauth.ts`
- Test: `__tests__/mcp-oauth.test.ts`

**Interfaces:**
- Consumes: `McpOauthFlow`, `McpTool` (Task 2); `AuthError`, `HttpError`.
- Produces:
  - Constants `OAUTH_POLL_MS = 2_000`, `OAUTH_FINISH_GRACE_MS = 60_000`, `OAUTH_TOTAL_LIMIT_MS = 360_000`, `OAUTH_MAX_FAILED_POLLS = 15`, `OAUTH_CONFLICT_RETRY_MS = 2_000`
  - `type OauthPhase = 'starting' | 'browser' | 'finishing'`
  - `type OauthOutcome = { kind: 'approved'; tools: McpTool[] } | { kind: 'cancelled' } | { kind: 'error'; message: string }`
  - `interface OauthDeps` (below)
  - `runOauthSignIn(deps: OauthDeps) → Promise<OauthOutcome>`; rejects only with `AuthError`.

**The rules this function implements (spec §5.6):**

- Rule A: whenever it holds a flow id and stops without `approved`, it cancels the flow. If the cancel answers `approved`, the result is `approved`.
- Rule B is injected as `checkUrl`.
- It polls first and applies time limits only directly after a poll that succeeded.
- A failed poll is retried; 15 failed polls in a row end the sequence.
- When the browser is closed by the person, it keeps polling for 60 s (`finishing`), then cancels.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/mcp-oauth.test.ts`:

```ts
// __tests__/mcp-oauth.test.ts
import type { McpOauthFlow } from '../src/api/mcp';
import { AuthError, HttpError } from '../src/api/restClient';
import {
  OAUTH_CONFLICT_RETRY_MS,
  OAUTH_FINISH_GRACE_MS,
  OAUTH_MAX_FAILED_POLLS,
  OAUTH_POLL_MS,
  OAUTH_TOTAL_LIMIT_MS,
  runOauthSignIn,
  type OauthDeps,
  type OauthPhase,
} from '../src/lib/mcp-oauth';

const URL_A = 'https://a.example/authorize?state=s1';

function flow(over: Partial<McpOauthFlow> = {}): McpOauthFlow {
  return { flow_id: 'f1', server_name: 'linear', status: 'authorization_required', authorization_url: URL_A, error: null, ...over };
}

type Step = McpOauthFlow | Error;

interface Script {
  start?: Step | Step[];
  /** Poll answers in order; the last one repeats. */
  polls?: Step[];
  cancelStatus?: string;
  cancelError?: Error;
  checkUrl?: (url: string) => string | null;
  /** The person closes the browser just before this poll (0-based). */
  closeBrowserBeforePoll?: number;
  /** openBrowser rejects. */
  openFails?: boolean;
  /** isCancelled() turns true just before this poll (0-based). */
  cancelBeforePoll?: number;
  /** Extra clock jump (ms) added to the sleep before this poll (0-based) — a background suspension. */
  jumpBeforePoll?: Record<number, number>;
  retryConflict?: boolean;
}

function harness(script: Script) {
  let t = 0;
  let pollIndex = 0;
  let startIndex = 0;
  let cancelled = false;
  let closeBrowser: () => void = () => {};
  const log = {
    phases: [] as OauthPhase[],
    opened: [] as string[],
    dismissed: 0,
    cancels: [] as string[],
    polls: 0,
    starts: 0,
    sleeps: [] as number[],
  };
  const starts = Array.isArray(script.start) ? script.start : [script.start ?? flow()];
  const polls = script.polls ?? [flow()];

  const deps: OauthDeps = {
    start: async () => {
      log.starts += 1;
      const step = starts[Math.min(startIndex++, starts.length - 1)];
      if (step instanceof Error) throw step;
      return step;
    },
    poll: async () => {
      log.polls += 1;
      const step = polls[Math.min(pollIndex++, polls.length - 1)];
      if (step instanceof Error) throw step;
      return step;
    },
    cancel: async (id) => {
      log.cancels.push(id);
      if (script.cancelError) throw script.cancelError;
      return { status: script.cancelStatus ?? 'error' };
    },
    openBrowser: (url) => {
      log.opened.push(url);
      if (script.openFails) return Promise.reject(new Error('no browser'));
      return new Promise<void>((resolve) => {
        closeBrowser = resolve;
      });
    },
    dismissBrowser: () => {
      log.dismissed += 1;
      closeBrowser();
    },
    checkUrl: script.checkUrl ?? (() => null),
    sleep: async (ms) => {
      log.sleeps.push(ms);
      t += ms + (script.jumpBeforePoll?.[pollIndex] ?? 0);
      if (script.closeBrowserBeforePoll === pollIndex) closeBrowser();
      if (script.cancelBeforePoll === pollIndex) cancelled = true;
      await Promise.resolve();
    },
    now: () => t,
    onPhase: (p) => log.phases.push(p),
    isCancelled: () => cancelled,
    retryConflict: script.retryConflict,
  };
  return { deps, log, clock: () => t };
}

const approved = (tools = [{ name: 'search', description: 'Search' }]) => flow({ status: 'approved', tools });

describe('runOauthSignIn — the normal path', () => {
  it('opens the URL, polls, and closes the browser on approval', async () => {
    const h = harness({ polls: [flow(), flow(), approved()] });
    const out = await runOauthSignIn(h.deps);
    expect(out).toEqual({ kind: 'approved', tools: [{ name: 'search', description: 'Search' }] });
    expect(h.log.opened).toEqual([URL_A]);
    expect(h.log.phases).toEqual(['starting', 'browser']);
    expect(h.log.polls).toBe(3);
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual([]);
    expect(h.log.sleeps.every((ms) => ms === OAUTH_POLL_MS)).toBe(true);
  });

  it('keeps polling through `starting` and a null URL', async () => {
    const h = harness({ polls: [flow({ status: 'starting', authorization_url: null }), approved([])] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'approved', tools: [] });
  });

  it('already approved at start: no browser, tools read once', async () => {
    const h = harness({ start: flow({ status: 'approved', authorization_url: null }), polls: [approved()] });
    const out = await runOauthSignIn(h.deps);
    expect(out.kind).toBe('approved');
    expect(h.log.opened).toEqual([]);
    expect(h.log.polls).toBe(1);
    expect(h.log.cancels).toEqual([]);
  });

  it('already approved at start still succeeds when the tools read fails', async () => {
    const h = harness({ start: flow({ status: 'approved', authorization_url: null }), polls: [new HttpError(404, 'gone')] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'approved', tools: [] });
  });
});

describe('runOauthSignIn — start failures', () => {
  it('an error status at start cancels the flow (rule A) and reports the gateway error', async () => {
    const h = harness({ start: flow({ status: 'error', authorization_url: null, error: 'Registration refused' }) });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Registration refused' });
    expect(h.log.cancels).toEqual(['f1']);
    expect(h.log.opened).toEqual([]);
  });

  it('no URL at start cancels and reports it', async () => {
    const h = harness({ start: flow({ status: 'starting', authorization_url: null }) });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'The gateway did not produce a sign-in page. Try again.' });
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a URL that fails rule B is not opened and the flow is cancelled', async () => {
    const h = harness({ checkUrl: () => 'The sign-in address is not HTTPS, so it was not opened.' });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'The sign-in address is not HTTPS, so it was not opened.' });
    expect(h.log.opened).toEqual([]);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a start timeout holds no flow id, so nothing is cancelled', async () => {
    const h = harness({ start: new HttpError(0, 'request timed out after 45s') });
    expect(await runOauthSignIn(h.deps)).toEqual({
      kind: 'error',
      message: 'The gateway did not answer in time. Trying again may be refused for up to 5 minutes.',
    });
    expect(h.log.cancels).toEqual([]);
  });

  it('a start HTTP error shows the gateway reason', async () => {
    const h = harness({ start: new HttpError(409, "MCP OAuth for 'linear' is already in progress") });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: "MCP OAuth for 'linear' is already in progress" });
    expect(h.log.starts).toBe(1);
  });

  it('retries once after a 409 when the app has just cancelled a flow', async () => {
    const h = harness({ retryConflict: true, start: [new HttpError(409, 'in progress'), flow()], polls: [approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.starts).toBe(2);
    expect(h.log.sleeps[0]).toBe(OAUTH_CONFLICT_RETRY_MS);
  });

  it('a network failure at start is reported plainly', async () => {
    const h = harness({ start: new TypeError('Network request failed') });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Gateway unreachable — check your VPN or Wi-Fi.' });
  });

  it('AuthError at start passes through', async () => {
    const h = harness({ start: new AuthError('dead') });
    await expect(runOauthSignIn(h.deps)).rejects.toThrow(AuthError);
  });
});

describe('runOauthSignIn — while the browser is open', () => {
  it('a gateway error on a poll closes the browser, cancels, and reports it', async () => {
    const h = harness({ polls: [flow(), flow({ status: 'error', error: 'Access denied' })] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Access denied' });
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a changed authorization URL cancels: the open page can no longer complete', async () => {
    const h = harness({ polls: [flow({ authorization_url: 'https://a.example/authorize?state=s2' })] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'The gateway restarted the sign-in. Try again.' });
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a 404 on a poll means the flow expired; there is nothing to cancel', async () => {
    const h = harness({ polls: [new HttpError(404, 'OAuth flow not found or expired')] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Sign-in expired. Try again.' });
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual([]);
  });

  it('a failed poll is retried on the next tick', async () => {
    const h = harness({ polls: [new TypeError('Network request failed'), new HttpError(502, 'bad gateway'), approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.polls).toBe(3);
  });

  it('gives up after 15 failed polls in a row (review focus 4)', async () => {
    const h = harness({ polls: [new TypeError('Network request failed')] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Lost contact with the gateway during sign-in.' });
    expect(h.log.polls).toBe(OAUTH_MAX_FAILED_POLLS);
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('AuthError on a poll closes the browser, then passes through', async () => {
    const h = harness({ polls: [flow(), new AuthError('dead')] });
    await expect(runOauthSignIn(h.deps)).rejects.toThrow(AuthError);
    expect(h.log.dismissed).toBe(1);
  });

  it('stops at the 6-minute limit, after a poll', async () => {
    const h = harness({ polls: [flow()] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Sign-in timed out.' });
    expect(h.clock()).toBe(OAUTH_TOTAL_LIMIT_MS);
    expect(h.log.polls).toBe(OAUTH_TOTAL_LIMIT_MS / OAUTH_POLL_MS);
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('after a long gap the poll comes first, and approval beats the limit (review focus 3)', async () => {
    const h = harness({ polls: [flow(), approved()], jumpBeforePoll: { 1: 30 * 60_000 } });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.cancels).toEqual([]);
  });

  it('a failed poll never triggers a time limit by itself', async () => {
    const h = harness({
      polls: [flow(), new TypeError('Network request failed'), approved()],
      jumpBeforePoll: { 1: 30 * 60_000 },
    });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
  });

  it('a browser that cannot open ends with an error and a cancel', async () => {
    const h = harness({ openFails: true });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Could not open the sign-in page.' });
    expect(h.log.cancels).toEqual(['f1']);
    expect(h.log.dismissed).toBe(0);
  });
});

describe('runOauthSignIn — the person closes the browser', () => {
  it('keeps polling and succeeds when approval lands within 60 s', async () => {
    const h = harness({ closeBrowserBeforePoll: 1, polls: [flow(), flow(), flow(), approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.phases).toEqual(['starting', 'browser', 'finishing']);
    expect(h.log.dismissed).toBe(0); // it is already closed
    expect(h.log.cancels).toEqual([]);
  });

  it('cancels after 60 s without approval', async () => {
    const h = harness({ closeBrowserBeforePoll: 0, polls: [flow()] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'cancelled' });
    expect(h.log.cancels).toEqual(['f1']);
    // closed is first seen at the first poll; the grace runs from there
    expect(h.clock()).toBe(OAUTH_POLL_MS + OAUTH_FINISH_GRACE_MS);
  });

  it('a cancel that answers `approved` is a success (rule A)', async () => {
    const h = harness({ closeBrowserBeforePoll: 0, polls: [flow()], cancelStatus: 'approved' });
    const out = await runOauthSignIn(h.deps);
    expect(out.kind).toBe('approved');
  });

  it('a failing cancel still reports the outcome', async () => {
    const h = harness({ closeBrowserBeforePoll: 0, polls: [flow()], cancelError: new HttpError(500, 'x') });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'cancelled' });
  });

  it('AuthError from the cancel passes through', async () => {
    const h = harness({ closeBrowserBeforePoll: 0, polls: [flow()], cancelError: new AuthError('dead') });
    await expect(runOauthSignIn(h.deps)).rejects.toThrow(AuthError);
  });
});

describe('runOauthSignIn — Cancel and leaving the screen', () => {
  it('isCancelled ends the sequence at the next tick, closing the browser and cancelling the flow', async () => {
    const h = harness({ cancelBeforePoll: 1, polls: [flow()] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'cancelled' });
    expect(h.log.polls).toBe(2);
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a flow approved on the very poll where Cancel was tapped still counts', async () => {
    const h = harness({ cancelBeforePoll: 0, polls: [approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.cancels).toEqual([]);
  });

  it('Cancel is honoured even when the poll failed', async () => {
    const h = harness({ cancelBeforePoll: 0, polls: [new TypeError('Network request failed')] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'cancelled' });
    expect(h.log.cancels).toEqual(['f1']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/mcp-oauth.test.ts`
Expected: FAIL with "Cannot find module '../src/lib/mcp-oauth'".

- [ ] **Step 3: Implement**

Create `src/lib/mcp-oauth.ts`:

```ts
// src/lib/mcp-oauth.ts — the connector OAuth sign-in sequence (spec §5.6).
//
// The gateway runs the OAuth client; the app shows the provider's page and
// waits. All I/O is injected, so the whole sequence is unit-tested.
//
// Rule A: whenever this holds a flow id and stops without `approved`, it
// cancels the flow — a flow left behind can be reopened by the gateway and
// block the server for 5 minutes. A cancel that answers `approved` means the
// sign-in had already succeeded.
import type { McpOauthFlow, McpTool } from '@/api/mcp';
import { AuthError, HttpError } from '@/api/restClient';

export const OAUTH_POLL_MS = 2_000;
/** How long to keep polling after the person closes the browser themselves. */
export const OAUTH_FINISH_GRACE_MS = 60_000;
/** The gateway waits 5 minutes for the redirect; stop a little after that. */
export const OAUTH_TOTAL_LIMIT_MS = 360_000;
export const OAUTH_MAX_FAILED_POLLS = 15;
export const OAUTH_CONFLICT_RETRY_MS = 2_000;

export type OauthPhase = 'starting' | 'browser' | 'finishing';

export type OauthOutcome =
  | { kind: 'approved'; tools: McpTool[] }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export interface OauthDeps {
  start: () => Promise<McpOauthFlow>;
  poll: (flowId: string) => Promise<McpOauthFlow>;
  /** Resolves with the flow's status AFTER the cancel. */
  cancel: (flowId: string) => Promise<{ status: string }>;
  /** Resolves when the browser closes, for any reason; rejects if it cannot open. */
  openBrowser: (url: string) => Promise<unknown>;
  dismissBrowser: () => void | Promise<unknown>;
  /** Rule B: null when the URL is safe to open, otherwise the message to show. */
  checkUrl: (url: string) => string | null;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  onPhase?: (phase: OauthPhase) => void;
  /** True once the person tapped Cancel or left the screen. */
  isCancelled?: () => boolean;
  /** Retry the start once after a 409: the app has just cancelled a flow for this server. */
  retryConflict?: boolean;
}

async function startFlow(deps: OauthDeps): Promise<McpOauthFlow> {
  try {
    return await deps.start();
  } catch (e) {
    if (!deps.retryConflict || !(e instanceof HttpError) || e.status !== 409) throw e;
    await deps.sleep(OAUTH_CONFLICT_RETRY_MS);
    return deps.start();
  }
}

function startFailure(e: unknown): string {
  if (e instanceof HttpError) {
    // No flow id came back, so the flow cannot be cancelled from here.
    if (e.status === 0) return 'The gateway did not answer in time. Trying again may be refused for up to 5 minutes.';
    return e.message;
  }
  return 'Gateway unreachable — check your VPN or Wi-Fi.';
}

/** Approved without a tools list in hand: read it once; approval stands even if that read fails. */
async function approvedOutcome(deps: OauthDeps, flowId: string): Promise<OauthOutcome> {
  try {
    const snap = await deps.poll(flowId);
    return { kind: 'approved', tools: snap.tools ?? [] };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    return { kind: 'approved', tools: [] };
  }
}

/** Rule A: cancel, then report `fallback` — unless the cancel says the flow had already succeeded. */
async function stop(deps: OauthDeps, flowId: string, fallback: OauthOutcome): Promise<OauthOutcome> {
  try {
    const res = await deps.cancel(flowId);
    if (res.status === 'approved') return approvedOutcome(deps, flowId);
  } catch (e) {
    if (e instanceof AuthError) throw e;
  }
  return fallback;
}

/** Run one sign-in. Rejects only with AuthError (after closing the browser). */
export async function runOauthSignIn(deps: OauthDeps): Promise<OauthOutcome> {
  deps.onPhase?.('starting');
  let flow: McpOauthFlow;
  try {
    flow = await startFlow(deps);
  } catch (e) {
    if (e instanceof AuthError) throw e;
    return { kind: 'error', message: startFailure(e) };
  }
  const id = flow.flow_id;

  if (flow.status === 'approved') return approvedOutcome(deps, id);
  if (flow.status === 'error') return stop(deps, id, { kind: 'error', message: flow.error || 'Sign-in failed.' });
  const url = flow.authorization_url;
  if (flow.status !== 'authorization_required' || !url) {
    return stop(deps, id, { kind: 'error', message: 'The gateway did not produce a sign-in page. Try again.' });
  }
  const refusal = deps.checkUrl(url);
  if (refusal) return stop(deps, id, { kind: 'error', message: refusal });

  deps.onPhase?.('browser');
  let closed = false;
  let openFailed = false;
  deps.openBrowser(url).then(
    () => {
      closed = true;
    },
    () => {
      closed = true;
      openFailed = true;
    },
  );
  const dismiss = async (): Promise<void> => {
    if (closed) return;
    try {
      await deps.dismissBrowser();
    } catch {
      // closing is best-effort
    }
  };

  const startedAt = deps.now();
  let closedAt: number | null = null;
  let failedPolls = 0;

  for (;;) {
    await deps.sleep(OAUTH_POLL_MS);

    let snap: McpOauthFlow | null = null;
    try {
      snap = await deps.poll(id);
      failedPolls = 0;
    } catch (e) {
      if (e instanceof AuthError) {
        await dismiss();
        throw e;
      }
      if (e instanceof HttpError && e.status === 404) {
        await dismiss();
        return { kind: 'error', message: 'Sign-in expired. Try again.' }; // the flow is gone: nothing to cancel
      }
      failedPolls += 1;
    }

    if (snap) {
      if (snap.status === 'approved') {
        await dismiss();
        return { kind: 'approved', tools: snap.tools ?? [] };
      }
      if (snap.status === 'error') {
        await dismiss();
        return stop(deps, id, { kind: 'error', message: snap.error || 'Sign-in failed.' });
      }
      if (snap.status === 'authorization_required' && snap.authorization_url && snap.authorization_url !== url) {
        await dismiss();
        return stop(deps, id, { kind: 'error', message: 'The gateway restarted the sign-in. Try again.' });
      }
    }

    if (deps.isCancelled?.()) {
      await dismiss();
      return stop(deps, id, { kind: 'cancelled' });
    }
    if (failedPolls >= OAUTH_MAX_FAILED_POLLS) {
      await dismiss();
      return stop(deps, id, { kind: 'error', message: 'Lost contact with the gateway during sign-in.' });
    }
    // Time limits apply only directly after a poll that succeeded, so returning
    // from another app can never cancel a flow that finished in the meantime.
    if (!snap) continue;

    if (openFailed) return stop(deps, id, { kind: 'error', message: 'Could not open the sign-in page.' });
    if (closed) {
      if (closedAt === null) {
        closedAt = deps.now();
        deps.onPhase?.('finishing');
      } else if (deps.now() - closedAt >= OAUTH_FINISH_GRACE_MS) {
        return stop(deps, id, { kind: 'cancelled' });
      }
    }
    if (deps.now() - startedAt >= OAUTH_TOTAL_LIMIT_MS) {
      await dismiss();
      return stop(deps, id, { kind: 'error', message: 'Sign-in timed out.' });
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/mcp-oauth.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate and commit**

Run: `npx tsc --noEmit && npx jest && npm run lint`
Expected: all three exit 0.

```bash
git add src/lib/mcp-oauth.ts __tests__/mcp-oauth.test.ts
git commit -m "feat(mcp): OAuth sign-in sequence with injected I/O" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Bridge to the active chat (`src/session-mcp-store.ts`)

**Files:**
- Create: `src/session-mcp-store.ts`
- Test: `__tests__/session-mcp-store.test.ts`

**Interfaces:**
- Consumes: `McpTestOutcome`, `McpRuntimeRow` (Task 3).
- Produces:
  - `interface SessionMcpTarget { connected: boolean; test: (name: string, profile: string | null) => Promise<McpTestOutcome>; status: (profile: string | null) => Promise<McpRuntimeRow[]> }`
  - `publishSessionMcpTarget(owner: object, target: SessionMcpTarget): void`
  - `clearSessionMcpTarget(owner: object): void` (no-op unless `owner` published the current target)
  - `getSessionMcpTarget(): SessionMcpTarget | null`
  - `subscribeSessionMcpTarget(listener: () => void): () => void`
  - `__resetSessionMcpStore(): void` (tests only)

The chat screen publishes in plan 2; this plan only builds and tests the store.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/session-mcp-store.test.ts`:

```ts
// __tests__/session-mcp-store.test.ts
import {
  __resetSessionMcpStore,
  clearSessionMcpTarget,
  getSessionMcpTarget,
  publishSessionMcpTarget,
  subscribeSessionMcpTarget,
  type SessionMcpTarget,
} from '../src/session-mcp-store';

function target(over: Partial<SessionMcpTarget> = {}): SessionMcpTarget {
  return {
    connected: true,
    test: async () => ({ kind: 'error', message: 'unused' }),
    status: async () => [],
    ...over,
  };
}

beforeEach(() => __resetSessionMcpStore());

describe('session-mcp-store', () => {
  it('starts empty', () => {
    expect(getSessionMcpTarget()).toBeNull();
  });

  it('publishes and reads back the same reference', () => {
    const t = target();
    publishSessionMcpTarget({}, t);
    expect(getSessionMcpTarget()).toBe(t);
  });

  it('the owner can clear its target', () => {
    const owner = {};
    publishSessionMcpTarget(owner, target());
    clearSessionMcpTarget(owner);
    expect(getSessionMcpTarget()).toBeNull();
  });

  it('the same owner can republish (connected changes)', () => {
    const owner = {};
    publishSessionMcpTarget(owner, target({ connected: false }));
    const next = target({ connected: true });
    publishSessionMcpTarget(owner, next);
    expect(getSessionMcpTarget()).toBe(next);
  });

  it("an older chat's cleanup cannot clear a newer chat's target", () => {
    const older = {};
    const newer = {};
    publishSessionMcpTarget(older, target());
    const current = target();
    publishSessionMcpTarget(newer, current);
    clearSessionMcpTarget(older);
    expect(getSessionMcpTarget()).toBe(current);
  });

  it('notifies on publish and on an effective clear only', () => {
    let n = 0;
    const unsub = subscribeSessionMcpTarget(() => {
      n++;
    });
    const owner = {};
    publishSessionMcpTarget(owner, target());
    expect(n).toBe(1);
    clearSessionMcpTarget({}); // not the owner: nothing changes
    expect(n).toBe(1);
    clearSessionMcpTarget(owner);
    expect(n).toBe(2);
    unsub();
    publishSessionMcpTarget(owner, target());
    expect(n).toBe(2);
  });

  it('returns a stable snapshot between emits (safe for useSyncExternalStore)', () => {
    publishSessionMcpTarget({}, target());
    expect(getSessionMcpTarget()).toBe(getSessionMcpTarget());
  });

  it('__resetSessionMcpStore clears the target and listeners', () => {
    let n = 0;
    subscribeSessionMcpTarget(() => {
      n++;
    });
    publishSessionMcpTarget({}, target());
    __resetSessionMcpStore();
    expect(getSessionMcpTarget()).toBeNull();
    publishSessionMcpTarget({}, target());
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/session-mcp-store.test.ts`
Expected: FAIL with "Cannot find module '../src/session-mcp-store'".

- [ ] **Step 3: Implement**

Create `src/session-mcp-store.ts`:

```ts
// src/session-mcp-store.ts — hands the active chat's socket to the Connectors
// screens for the two connector RPCs (test, runtime status), since those
// screens do not own a WebSocket. Same shape as session-model-store: module
// state + subscribe, consumed with useSyncExternalStore.
//
// Unlike session-model-store, a clear is owner-checked: two chat screens can
// overlap during a transition, and the older one's cleanup must not clear the
// newer one's target.
import type { McpRuntimeRow, McpTestOutcome } from '@/api/mcpSession';

export interface SessionMcpTarget {
  /** True while the chat's socket is ready for calls. */
  connected: boolean;
  /** Connect, list tools, disconnect — on the gateway. Never rejects. */
  test: (name: string, profile: string | null) => Promise<McpTestOutcome>;
  /** What the running gateway has loaded. `[]` when unavailable. */
  status: (profile: string | null) => Promise<McpRuntimeRow[]>;
}

let owner: object | null = null;
let target: SessionMcpTarget | null = null;
const listeners = new Set<() => void>();

function emit(nextOwner: object | null, next: SessionMcpTarget | null): void {
  owner = nextOwner;
  target = next;
  for (const l of [...listeners]) l();
}

export function getSessionMcpTarget(): SessionMcpTarget | null {
  return target;
}

export function subscribeSessionMcpTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish the active chat's target. `by` identifies the publishing chat screen. */
export function publishSessionMcpTarget(by: object, next: SessionMcpTarget): void {
  emit(by, next);
}

/** Clear the target, but only if `by` is the chat that published it. */
export function clearSessionMcpTarget(by: object): void {
  if (owner !== by) return;
  emit(null, null);
}

/** Test-only: reset module state between cases. */
export function __resetSessionMcpStore(): void {
  owner = null;
  target = null;
  listeners.clear();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/session-mcp-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate and commit**

Run: `npx tsc --noEmit && npx jest && npm run lint`
Expected: all three exit 0.

```bash
git add src/session-mcp-store.ts __tests__/session-mcp-store.test.ts
git commit -m "feat(mcp): owner-checked store that lends the chat socket to connectors" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Contract note and architecture entries

**Files:**
- Create: `docs/contracts/mcp.md`
- Modify: `AGENTS.md` (the `src/api/`, `src/lib/` and store lines of the Architecture block)

**Interfaces:** none; documentation only.

- [ ] **Step 1: Write the contract note**

Create `docs/contracts/mcp.md`:

````markdown
# Wire contracts: MCP connectors (servers, OAuth, catalog, test, status)

Verified against the hermes-agent tree at `v2026.9.24` (0.21.5) on 2026-10-01, and read-only
against the live gateway. Server files: `hermes_cli/web_routers/mcp.py`,
`hermes_cli/web_server_mcp.py`, `hermes_cli/web_models.py`, `tools/mcp_dashboard_oauth.py`,
`tui_gateway/methods_tools.py`. App modules: `src/api/mcp.ts` (REST), `src/api/mcpSession.ts` (RPC).

Design: `docs/superpowers/specs/2026-10-01-mcp-connectors-design.md`.

---

## REST

Every route accepts the cookie session. Every route except the flow and callback routes takes an
optional `?profile=`.

### List servers — `GET /api/mcp/servers`

```json
{ "servers": [ {
  "name": "linear", "transport": "http", "url": "https://mcp.linear.app/mcp",
  "command": null, "args": [], "env": {}, "auth": "oauth", "enabled": true,
  "tools": null, "source": "config", "plugin": null
} ] }
```

- Sorted by name. `transport` is `http`, `stdio` or `unknown`.
- `auth` is `oauth`, `header`, or null. `env` values are redacted by the gateway.
- `tools` is the tool filter (enabled tool names) or null for all. It is **not** a tool count.
- There is **no sign-in state** here. Use the test RPC.
- This is not the RPC `McpServerSummary` shape (`env` there is a list of key names).

### Add a server — `POST /api/mcp/servers`

Body for a remote server: `{name, url, auth, bearer_token?}`.

- `auth` is `none`, `header` or `oauth`. `header` requires `bearer_token`; any other mode rejects it.
- The token is written to the profile's `.env`; `config.yaml` gets only a header template.
- Returns the server summary.
- 400 with a reason (validation), 409 (name exists, or provided by a plugin), 422 (malformed body).
- The 400 reason is `str(exc)` from the gateway. The app never trusts it to be free of the token:
  `src/api/mcp.ts` replaces any message that echoes a submitted value.

### Remove — `DELETE /api/mcp/servers/{name}`

`{ok: true}`. 404 unknown, 409 plugin-provided.

### Enable or disable — `PUT /api/mcp/servers/{name}/enabled`

Body `{enabled}`. Returns `{ok, name, enabled}`. The server stays in the config when off.
404 unknown, 409 plugin-provided.

### Names in paths

Routes use `{name}`, not `{name:path}`. A name containing `/` cannot be addressed over REST.

### Start OAuth — `POST /api/mcp/servers/{name}/auth`

Returns a flow: `{flow_id, server_name, status, authorization_url, error}`.

- The gateway waits **up to 30 s** for the authorization URL before answering, so the app allows
  45 s and always sends a fast request first (a slow request must not carry a token rotation; the
  gateway writes rotated cookies only when the handler returns).
- `status` is `starting`, `authorization_required`, `approved` or `error`.
- 404 unknown server, 400 stdio or header-auth server, 409 a flow for this server is already
  running, 429 when 8 flows are live (the app shows its fixed 429 text).
- A flow that ended with `error` and was **not cancelled** can be reopened by the gateway when its
  worker retries; it then holds the per-server slot for up to 5 minutes. So the app cancels every
  flow it stops without approval.

### Flow status — `GET /api/mcp/oauth/flows/{flow_id}`

The flow, plus `tools: [{name, description}]` once approved. 404 when the flow has expired
(15 minutes) or the gateway restarted (flows are in memory).

While the gateway exchanges the code and connects, the status stays `authorization_required`.

### Cancel — `DELETE /api/mcp/oauth/flows/{flow_id}`

`{ok: true, status}`. Idempotent. `status` is the flow's status **after** the cancel: `approved`
means the sign-in had already succeeded; `expired` means the flow no longer exists.

### Callback — `GET /api/mcp/oauth/callback/{server_name}`

Public (no cookie): it is on the gate's public-prefix list and is matched by `state`. The provider
redirects the browser here. The redirect URI is built from `HERMES_DASHBOARD_PUBLIC_URL` /
`dashboard.public_url` when set, else from the request, else from a per-server `oauth.redirect_uri`.

### Catalog — `GET /api/mcp/catalog`

`{entries, diagnostics}`. Entry fields the app uses: `name`, `description`, `connector_slug`,
`source`, `transport`, `auth_type` (`oauth`/`none`/…), `required_env: [{name, prompt, required}]`,
`url`, `needs_install`, `installed`, `enabled`.

- `required_env` does **not** say whether a variable is a secret. The gateway decides that itself.
- Live on 2026-10-01: 65 entries, all `http`, none with `needs_install`; 55 `oauth`, 10 `none`; two
  with `required_env` (`asana`, `n8n-official`).

### Install a catalog entry — `POST /api/mcp/catalog/install`

Body `{name, env, enable}`. Returns `{ok, name, background}`.

- `env` may contain only variables the entry declares (400 otherwise). 404 for an unknown entry.
- Secret values are written to `.env` **before** the entry is installed, so a failed install can
  leave them there.

---

## RPC (over the chat WebSocket)

### `mcp.servers.test` `{profile?, name}`

`{ok, tools, error?, prompts?, resources?, oauth_needed, oauth_tokens_present?}`.

- Really connects, lists tools and disconnects. It runs on the gateway's RPC pool
  (`_LONG_HANDLERS`), so a slow server does not stall the socket.
- For an `auth: oauth` server with no token on disk it answers `ok: false` with
  `oauth_tokens_present: false`.
- Error code 4064 when the server is unknown.
- The app uses this instead of the REST test route (`POST /api/mcp/servers/{name}/test`), which is
  slow and would ride the cookie path.

### `mcp.servers.status` `{profile?}`

`{servers: [{name, transport, tools, connected, disabled, status, source, plugin}], checked_at}`.

- From cached state; never connects. `tools` is a count.
- `status`: `connected`, `disabled`, `connecting`, `failed`, `lazy`, `configured`.
- Runtime state is reported only for the gateway's launch profile. For another profile every row
  reads `configured` or `disabled`.

### `reload.mcp` — NOT USED

Tears down and reconnects every MCP server for every live session and invalidates the prompt
cache. The app does not call it (spec §5.7).

---

## When a change takes effect

Read from `hermes_cli/mcp_startup.py` (`start_background_mcp_discovery`): discovery runs once per
profile and is started again for a new session only when **no** server is connected. With at least
one server connected, a newly added server is loaded by `reload.mcp` or a gateway restart. After an
OAuth sign-in the gateway reconnects the server only if it is already loaded
(`tools/mcp_tool_loop.py`, `reconnect_mcp_server`).
````

- [ ] **Step 2: Add the architecture entries**

In `AGENTS.md`, inside the Architecture code block, add after the `chat-transport.ts` entry (keep the block's two-column alignment):

```
  mcp.ts          MCP connector REST calls (servers, OAuth flow, catalog); cleans errors of
                  secret values. Contract: docs/contracts/mcp.md
  mcpSession.ts   connector RPCs over an injected call: mcp.servers.test / .status
```

Add after the `src/lib/request-answers.ts` line:

```
src/lib/mcp.ts    pure connector logic (capabilities, status line, validation, error mapping, rule B)
src/lib/mcp-oauth.ts  the connector OAuth sign-in sequence, I/O injected (cancels every flow it abandons)
```

Add after the `src/sidebar-store.ts` line:

```
src/session-mcp-store.ts  the active chat lends its socket to the Connectors screens (owner-checked clear)
```

- [ ] **Step 3: Full gate and commit**

Run: `npx tsc --noEmit && npx jest && npm run lint`
Expected: all three exit 0.

```bash
git add docs/contracts/mcp.md AGENTS.md
git commit -m "docs: MCP connector wire contract and architecture entries" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Whole-branch review and PR

- [ ] **Step 1: Independent review**

Dispatch one fresh reviewer over `git diff origin/main...HEAD` with the spec. It checks: the secret rules of §5.9 against `src/api/mcp.ts`, rule A in `src/lib/mcp-oauth.ts`, the timeout invariant in `src/api/restClient.ts`, and that no test asserts behaviour the code does not have. Address what it finds, re-run the gate.

- [ ] **Step 2: Open the PR**

```bash
git push -u origin feat/mcp-connectors-transport
gh pr create --base main --title "feat(mcp): connector transport and logic (plan 1 of 3)" --body-file <prepared body>
```

The body states: what is in the PR, that nothing user-visible changes, that nothing was run against the live gateway, and the test counts.

- [ ] **Step 3: Gate on CI**

Run: `gh pr checks <number> --watch`
Expected: exit code 0. Merge is Gianluca's call.
