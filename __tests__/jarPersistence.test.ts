// __tests__/jarPersistence.test.ts
// The onChange hook is the device-mode survival mechanism: refresh tokens
// rotate on every middleware refresh and REUSE OF A STALE RT REVOKES THE
// DEVICE (device_store.rotate_refresh), so the jar must be persistable after
// every response that changed it — and must stay quiet when nothing changed.
import { CookieJar } from '../src/api/cookieJar';
import { RestClient } from '../src/api/restClient';

function fakeFetch(status: number, body: unknown, setCookie?: string) {
  const fn = async (_url: string, _init: RequestInit = {}) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => (k.toLowerCase() === 'set-cookie' ? setCookie ?? null : null) },
      json: async () => body,
    }) as unknown as Response;
  return fn;
}

describe('CookieJar onChange', () => {
  it('fires with a full snapshot when a cookie is added or rotated', () => {
    const jar = new CookieJar();
    const seen: Record<string, string>[] = [];
    jar.onChange((s) => seen.push(s));

    jar.ingest(['hermes_session_rt=r1; HttpOnly; Path=/']);
    jar.ingest(['hermes_session_at=a1; Max-Age=900; Path=/, hermes_session_rt=r2; Path=/']);

    expect(seen).toEqual([
      { hermes_session_rt: 'r1' },
      { hermes_session_at: 'a1', hermes_session_rt: 'r2' },
    ]);
  });

  it('does NOT fire when ingest changes nothing (same value re-set)', () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_rt=r1; Path=/']);
    const seen: Record<string, string>[] = [];
    jar.onChange((s) => seen.push(s));

    jar.ingest(['hermes_session_rt=r1; Path=/']); // idempotent re-set
    jar.ingest(['nonexistent=; Max-Age=0; Path=/']); // delete of absent cookie

    expect(seen).toEqual([]);
  });

  it('fires on deletions (middleware clear_session_cookies → Max-Age=0)', () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_rt=r1; Path=/']);
    const seen: Record<string, string>[] = [];
    jar.onChange((s) => seen.push(s));

    jar.ingest(['hermes_session_at=; Max-Age=0; Path=/, hermes_session_rt=; Max-Age=0; Path=/']);

    expect(seen).toEqual([{}]); // jar emptied — persisting {} is correct
  });

  it('fires on clear() but only when non-empty, and detaches via onChange(null)', () => {
    const jar = CookieJar.fromJSON({ hermes_session_rt: 'r1' });
    const seen: Record<string, string>[] = [];
    jar.onChange((s) => seen.push(s));
    jar.clear();
    jar.clear(); // already empty — no event
    expect(seen).toEqual([{}]);

    jar.onChange(null);
    jar.ingest(['x=1; Path=/']);
    expect(seen).toEqual([{}]); // detached listener never fired
  });

  it('persists through the RestClient request path (device bootstrap shape)', async () => {
    // RT-only request → middleware refresh → Set-Cookie AT + rotated RT.
    const jar = CookieJar.fromJSON({ hermes_session_rt: 'qr-rt' });
    const persisted: Record<string, string>[] = [];
    jar.onChange((s) => persisted.push(s));

    const f = fakeFetch(
      200,
      { sessions: [], total: 0, limit: 40, offset: 0 },
      'hermes_session_at=at1; HttpOnly; Max-Age=900; Path=/; SameSite=lax, ' +
        'hermes_session_rt=rt2; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax',
    );
    const c = new RestClient('http://100.64.0.7:9119', jar, f as any);
    await c.listSessions();

    // Exactly one persistence event for the response, carrying the ROTATED rt.
    expect(persisted).toEqual([{ hermes_session_rt: 'rt2', hermes_session_at: 'at1' }]);
    expect(jar.header()).toBe('hermes_session_rt=rt2; hermes_session_at=at1');
  });
});
