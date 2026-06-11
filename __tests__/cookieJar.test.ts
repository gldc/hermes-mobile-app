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
});
