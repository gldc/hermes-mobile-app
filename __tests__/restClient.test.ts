// __tests__/restClient.test.ts
import { RestClient, AuthError } from '../src/api/restClient';
import { CookieJar } from '../src/api/cookieJar';

function fakeFetch(status: number, body: unknown, setCookie?: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => (k.toLowerCase() === 'set-cookie' ? setCookie ?? null : null) },
      json: async () => body,
    } as unknown as Response;
  };
  return Object.assign(fn, { calls });
}

describe('RestClient', () => {
  it('login posts credentials and ingests cookies', async () => {
    const jar = new CookieJar();
    const f = fakeFetch(200, { ok: true }, 'hermes_session_at=tok; Max-Age=900; Path=/');
    const c = new RestClient('http://100.1.2.3:9119', jar, f as any);
    await c.login('gianluca', 'pw');
    expect(f.calls[0].url).toBe('http://100.1.2.3:9119/auth/password-login');
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({
      provider: 'basic', username: 'gianluca', password: 'pw',
    });
    expect(jar.header()).toBe('hermes_session_at=tok');
  });

  it('login throws AuthError on 401', async () => {
    const c = new RestClient('http://h', new CookieJar(), fakeFetch(401, { detail: 'Invalid credentials' }) as any);
    await expect(c.login('u', 'bad')).rejects.toThrow(AuthError);
  });

  it('authed requests send the Cookie header and ingest rotations', async () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_rt=r1; Path=/']);
    const f = fakeFetch(200, { ticket: 't', ttl_seconds: 30 }, 'hermes_session_rt=r2; Path=/');
    const c = new RestClient('http://h', jar, f as any);
    const t = await c.wsTicket();
    expect(t.ticket).toBe('t');
    expect((f.calls[0].init.headers as Record<string, string>)['Cookie']).toBe('hermes_session_rt=r1');
    expect(jar.header()).toBe('hermes_session_rt=r2'); // rotation honored
  });

  it('authed requests throw AuthError on 401 (session dead → re-login)', async () => {
    const c = new RestClient('http://h', new CookieJar(), fakeFetch(401, {}) as any);
    await expect(c.listSessions()).rejects.toThrow(AuthError);
  });

  it('surfaces FastAPI {detail} on non-ok responses (e.g. cron schedule-parse 400s)', async () => {
    const c = new RestClient(
      'http://h',
      new CookieJar(),
      fakeFetch(400, { detail: 'Could not parse schedule: "every blarg"' }) as any,
    );
    await expect(c.get('/api/cron/jobs')).rejects.toThrow('Could not parse schedule: "every blarg"');
  });

  it('falls back to a generic message when the error body has no detail', async () => {
    const c = new RestClient('http://h', new CookieJar(), fakeFetch(500, { nope: 1 }) as any);
    await expect(c.get('/api/x')).rejects.toThrow('HTTP 500 on /api/x');
  });

  it('listSessions hits the right URL', async () => {
    const f = fakeFetch(200, { sessions: [], total: 0, limit: 40, offset: 0 });
    const c = new RestClient('http://h', new CookieJar(), f as any);
    await c.listSessions();
    expect(f.calls[0].url).toBe('http://h/api/sessions?limit=40&offset=0&order=recent');
  });

  it('listSessions paginates via offset', async () => {
    const f = fakeFetch(200, { sessions: [], total: 90, limit: 40, offset: 40 });
    const c = new RestClient('http://h', new CookieJar(), f as any);
    await c.listSessions(40);
    expect(f.calls[0].url).toBe('http://h/api/sessions?limit=40&offset=40&order=recent');
  });
});

describe('RestClient single-flight (rotating-token race)', () => {
  // Minimal Response stub matching the transport's needs.
  const res = (status: number, body: unknown, setCookie?: string) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => (k.toLowerCase() === 'set-cookie' ? setCookie ?? null : null) },
      json: async () => body,
    }) as unknown as Response;

  it('serializes concurrent authed requests so the second sends the rotated cookie', async () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_rt=r1; Path=/']);

    const seen: string[] = [];
    let call = 0;
    // The first request is slow and rotates r1→r2. If requests are NOT
    // serialized, the second reads the jar before that rotation is ingested
    // and ALSO sends r1 — exactly the rotated-out replay the gateway treats
    // as reuse and revokes the device for.
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

    expect(seen[0]).toBe('hermes_session_rt=r1');
    expect(seen[1]).toBe('hermes_session_rt=r2'); // waited for the rotation
  });

  it('a failed request does not poison the chain for later requests', async () => {
    const jar = new CookieJar();
    let call = 0;
    const fetchFn = async () => (call++ === 0 ? res(500, { nope: 1 }) : res(200, { ok: true }));
    const c = new RestClient('http://h', jar, fetchFn as any);
    await expect(c.get('/a')).rejects.toThrow();
    await expect(c.get('/b')).resolves.toEqual({ ok: true });
  });
});

describe('listSessions archived', () => {
  it('appends archived=only and keeps the default URL unchanged otherwise', async () => {
    const f = fakeFetch(200, { sessions: [], total: 0, limit: 40, offset: 0 });
    const c = new RestClient('http://h', new CookieJar(), f as any);
    await c.listSessions(0, 'only');
    await c.listSessions(0);
    expect(f.calls[0].url).toBe('http://h/api/sessions?limit=40&offset=0&order=recent&archived=only');
    expect(f.calls[1].url).toBe('http://h/api/sessions?limit=40&offset=0&order=recent');
  });
});
