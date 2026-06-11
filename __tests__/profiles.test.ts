// __tests__/profiles.test.ts — profile API + param-threading helpers
// (docs/contracts/profiles.md).
import { CookieJar } from '../src/api/cookieJar';
import {
  getActiveProfile,
  listProfiles,
  listSessionsForProfile,
  profileQuery,
  withProfile,
} from '../src/api/profiles';
import { RestClient } from '../src/api/restClient';
import { deleteSession, renameSession } from '../src/api/sessions';

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

describe('listProfiles', () => {
  it('GETs /api/profiles and returns the profile rows', async () => {
    const f = fakeFetch(200, {
      profiles: [
        { name: 'default', is_default: true, model: 'anthropic/claude-opus-4.7' },
        { name: 'work', is_default: false, model: null, distribution_name: null },
      ],
    });
    const res = await listProfiles(client(f));
    expect(f.calls[0].url).toBe('http://h/api/profiles');
    expect(f.calls[0].init.method).toBeUndefined(); // GET
    expect(res.profiles.map((p) => p.name)).toEqual(['default', 'work']);
    // newer/unknown keys must be tolerated
    expect(res.profiles[1].distribution_name).toBeNull();
  });
});

describe('getActiveProfile', () => {
  it('GETs /api/profiles/active and surfaces active vs current', async () => {
    const f = fakeFetch(200, { active: 'work', current: 'default' });
    const res = await getActiveProfile(client(f));
    expect(f.calls[0].url).toBe('http://h/api/profiles/active');
    expect(res).toEqual({ active: 'work', current: 'default' });
  });
});

describe('profileQuery', () => {
  it('returns empty for null/undefined/empty (omit = backend profile)', () => {
    expect(profileQuery(null)).toBe('');
    expect(profileQuery(undefined)).toBe('');
    expect(profileQuery('')).toBe('');
  });

  it('builds &profile= by default and ?profile= when asked', () => {
    expect(profileQuery('work')).toBe('&profile=work');
    expect(profileQuery('work', '?')).toBe('?profile=work');
  });

  it('URL-encodes the profile name', () => {
    expect(profileQuery('my profile/2', '?')).toBe('?profile=my%20profile%2F2');
  });
});

describe('withProfile', () => {
  it('leaves params untouched when profile is null/undefined/empty', () => {
    const params = { session_id: 'abc' };
    expect(withProfile(params, null)).toBe(params);
    expect(withProfile(params, undefined)).toBe(params);
    expect(withProfile(params, '')).toBe(params);
    expect(params).toEqual({ session_id: 'abc' }); // no mutation
  });

  it('merges the profile key without mutating the input', () => {
    const params = { session_id: 'abc' };
    expect(withProfile(params, 'work')).toEqual({ session_id: 'abc', profile: 'work' });
    expect(params).toEqual({ session_id: 'abc' });
  });

  it('works for empty create params', () => {
    expect(withProfile({}, 'work')).toEqual({ profile: 'work' });
  });
});

describe('listSessionsForProfile', () => {
  it('uses plain GET /api/sessions when no profile is selected', async () => {
    const f = fakeFetch(200, { sessions: [], total: 0, limit: 40, offset: 0 });
    await listSessionsForProfile(client(f), null, 80);
    expect(f.calls[0].url).toBe('http://h/api/sessions?limit=40&offset=80&order=recent');
  });

  it('uses the cross-profile aggregate for a named profile', async () => {
    const f = fakeFetch(200, {
      sessions: [{ id: 's1', profile: 'work' }],
      total: 1,
      limit: 40,
      offset: 0,
      profile_totals: { work: 1 },
    });
    const res = await listSessionsForProfile(client(f), 'work');
    expect(f.calls[0].url).toBe(
      'http://h/api/profiles/sessions?profile=work&limit=40&offset=0&order=recent',
    );
    expect(res.sessions[0].id).toBe('s1');
  });

  it('URL-encodes the profile and threads the offset', async () => {
    const f = fakeFetch(200, { sessions: [], total: 0, limit: 40, offset: 40 });
    await listSessionsForProfile(client(f), 'my profile', 40);
    expect(f.calls[0].url).toBe(
      'http://h/api/profiles/sessions?profile=my%20profile&limit=40&offset=40&order=recent',
    );
  });
});

describe('profile threading on session mutations', () => {
  it('renameSession adds the profile body field only when targeted', async () => {
    const f = fakeFetch(200, { ok: true, title: 'x' });
    const c = client(f);
    await renameSession(c, 'abc', 'x', 'work');
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ title: 'x', profile: 'work' });
    await renameSession(c, 'abc', 'x', null);
    expect(JSON.parse(f.calls[1].init.body as string)).toEqual({ title: 'x' });
  });

  it('deleteSession adds ?profile= only when targeted', async () => {
    const f = fakeFetch(200, { ok: true });
    const c = client(f);
    await deleteSession(c, 'abc', 'work');
    expect(f.calls[0].url).toBe('http://h/api/sessions/abc?profile=work');
    await deleteSession(c, 'abc');
    expect(f.calls[1].url).toBe('http://h/api/sessions/abc');
  });

  it('getMessages adds ?profile= only when targeted', async () => {
    const f = fakeFetch(200, { session_id: 'abc', messages: [] });
    const c = client(f);
    await c.getMessages('abc', 'work');
    expect(f.calls[0].url).toBe('http://h/api/sessions/abc/messages?profile=work');
    await c.getMessages('abc');
    expect(f.calls[1].url).toBe('http://h/api/sessions/abc/messages');
  });
});
