// __tests__/cookieJar.test.ts
import { CookieJar, splitSetCookie } from '../src/api/cookieJar';

describe('splitSetCookie', () => {
  it('splits RN comma-joined Set-Cookie without breaking Expires dates', () => {
    const joined =
      'hermes_session_at=abc123; HttpOnly; Max-Age=900; Path=/; SameSite=lax, ' +
      'hermes_session_rt=def456; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Path=/';
    expect(splitSetCookie(joined)).toEqual([
      'hermes_session_at=abc123; HttpOnly; Max-Age=900; Path=/; SameSite=lax',
      'hermes_session_rt=def456; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Path=/',
    ]);
  });
});

describe('CookieJar', () => {
  it('stores cookies and emits a Cookie header', () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_at=abc; HttpOnly; Max-Age=900; Path=/']);
    jar.ingest(['hermes_session_rt=def; HttpOnly; Max-Age=2592000; Path=/']);
    expect(jar.header()).toBe('hermes_session_at=abc; hermes_session_rt=def');
  });

  it('rotation: later Set-Cookie for the same name replaces the value', () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_rt=old; Path=/']);
    jar.ingest(['hermes_session_rt=new; Path=/']);
    expect(jar.header()).toBe('hermes_session_rt=new');
  });

  it('Max-Age=0 deletes the cookie', () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_pkce=x; Path=/']);
    jar.ingest(['hermes_session_pkce=; Max-Age=0; Path=/']);
    expect(jar.header()).toBeNull();
  });

  it('round-trips through JSON for persistence', () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_at=abc; Path=/']);
    const restored = CookieJar.fromJSON(jar.toJSON());
    expect(restored.header()).toBe('hermes_session_at=abc');
  });

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
});
