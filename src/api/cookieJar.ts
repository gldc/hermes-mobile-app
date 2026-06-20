// src/api/cookieJar.ts
/** Split a comma-joined Set-Cookie string (React Native merges multiple
 * headers) into individual cookie strings. Splits only on a comma followed
 * by `name=` — an Expires date's "Wed, 21 Oct" has no `=` before the next
 * `;`, so it survives. */
export function splitSetCookie(joined: string): string[] {
  return joined.split(/,(?=\s*[A-Za-z0-9_\-!#$%&'*.^`|~]+=)/).map((s) => s.trim());
}

/** The access-token cookie, plain and `__Secure-`-prefixed (HTTPS) variants. */
const AT_COOKIE_NAMES = new Set(['hermes_session_at', '__Secure-hermes_session_at']);
function isAccessTokenCookie(name: string): boolean {
  return AT_COOKIE_NAMES.has(name);
}

export class CookieJar {
  private cookies = new Map<string, string>();
  private listener: ((snapshot: Record<string, string>) => void) | null = null;
  /** Absolute ms-epoch the access token expires, or null when unknown/none. */
  private atExpiresAtMs: number | null = null;

  /** `now` is injectable for tests; defaults to wall-clock. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Register a callback fired after every mutation that actually changed the
   * jar (ingest of a rotated cookie, deletion, clear). Refresh tokens rotate
   * server-side and replaying a stale one revokes the device, so connection.ts
   * uses this to persist the jar to SecureStore after EVERY change. */
  onChange(fn: ((snapshot: Record<string, string>) => void) | null): void {
    this.listener = fn;
  }

  private notify(): void {
    this.listener?.(this.toJSON());
  }

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

  header(): string | null {
    if (this.cookies.size === 0) return null;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** True only when a known access token has more than `marginMs` of life left.
   * Unknown expiry (no AT seen yet, e.g. just after a cold restore) → false, so
   * callers conservatively serialize until the next rotation reveals the expiry. */
  accessTokenFresh(marginMs: number, nowMs: number = this.now()): boolean {
    return this.atExpiresAtMs !== null && this.atExpiresAtMs - nowMs > marginMs;
  }

  clear(): void {
    if (this.cookies.size === 0) return;
    this.cookies.clear();
    this.notify();
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.cookies);
  }

  static fromJSON(data: Record<string, string>, now?: () => number): CookieJar {
    const jar = new CookieJar(now);
    for (const [k, v] of Object.entries(data)) jar.cookies.set(k, v);
    return jar;
  }
}
