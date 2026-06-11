// src/api/cookieJar.ts
/** Split a comma-joined Set-Cookie string (React Native merges multiple
 * headers) into individual cookie strings. Splits only on a comma followed
 * by `name=` — an Expires date's "Wed, 21 Oct" has no `=` before the next
 * `;`, so it survives. */
export function splitSetCookie(joined: string): string[] {
  return joined.split(/,(?=\s*[A-Za-z0-9_\-!#$%&'*.^`|~]+=)/).map((s) => s.trim());
}

export class CookieJar {
  private cookies = new Map<string, string>();

  /** Accepts individual Set-Cookie strings or RN comma-joined ones. */
  ingest(setCookies: string[]): void {
    for (const raw of setCookies.flatMap(splitSetCookie)) {
      const [pair, ...attrs] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0+\s*$/i.test(a));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string | null {
    if (this.cookies.size === 0) return null;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  clear(): void {
    this.cookies.clear();
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.cookies);
  }

  static fromJSON(data: Record<string, string>): CookieJar {
    const jar = new CookieJar();
    for (const [k, v] of Object.entries(data)) jar.cookies.set(k, v);
    return jar;
  }
}
