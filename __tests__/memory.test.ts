// __tests__/memory.test.ts
import {
  BUILT_IN_PROVIDER,
  formatBytes,
  getMemoryStatus,
  providerLabel,
  resetMemory,
  setMemoryProvider,
} from '../src/api/memory';
import { CookieJar } from '../src/api/cookieJar';
import { RestClient } from '../src/api/restClient';

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

describe('memory api', () => {
  it('getMemoryStatus hits GET /api/memory and returns the status shape', async () => {
    const f = fakeFetch(200, {
      active: '',
      providers: [{ name: 'mem0', description: 'Mem0 memory', configured: true }],
      builtin_files: { memory: 1234, user: 0 },
    });
    const s = await getMemoryStatus(client(f));
    expect(f.calls[0].url).toBe('http://h/api/memory');
    expect(f.calls[0].init.method).toBeUndefined(); // GET
    expect(s.active).toBe(BUILT_IN_PROVIDER);
    expect(s.providers[0].name).toBe('mem0');
    expect(s.builtin_files).toEqual({ memory: 1234, user: 0 });
  });

  it('setMemoryProvider PUTs the provider name', async () => {
    const f = fakeFetch(200, { ok: true, active: 'mem0' });
    const res = await setMemoryProvider(client(f), 'mem0');
    expect(f.calls[0].url).toBe('http://h/api/memory/provider');
    expect(f.calls[0].init.method).toBe('PUT');
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ provider: 'mem0' });
    expect(res.active).toBe('mem0');
  });

  it('setMemoryProvider sends "" to select the built-in backend', async () => {
    const f = fakeFetch(200, { ok: true, active: '' });
    await setMemoryProvider(client(f), BUILT_IN_PROVIDER);
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ provider: '' });
  });

  it('setMemoryProvider surfaces 400 for unknown providers', async () => {
    const f = fakeFetch(400, { detail: 'unknown provider' });
    await expect(setMemoryProvider(client(f), 'nope')).rejects.toThrow('unknown provider');
  });

  it('resetMemory POSTs the target', async () => {
    const f = fakeFetch(200, { ok: true, deleted: ['MEMORY.md'] });
    const res = await resetMemory(client(f), 'memory');
    expect(f.calls[0].url).toBe('http://h/api/memory/reset');
    expect(f.calls[0].init.method).toBe('POST');
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ target: 'memory' });
    expect(res.deleted).toEqual(['MEMORY.md']);
  });

  it('resetMemory supports all three targets', async () => {
    for (const target of ['all', 'memory', 'user'] as const) {
      const f = fakeFetch(200, { ok: true, deleted: [] });
      await resetMemory(client(f), target);
      expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ target });
    }
  });

  describe('providerLabel', () => {
    it('maps "" to Built-in files', () => {
      expect(providerLabel('')).toBe('Built-in files');
    });
    it('passes provider names through', () => {
      expect(providerLabel('mem0')).toBe('mem0');
    });
  });

  describe('formatBytes', () => {
    it('treats 0 (absent file) as Empty', () => {
      expect(formatBytes(0)).toBe('Empty');
    });
    it('handles negatives and non-finite defensively', () => {
      expect(formatBytes(-5)).toBe('Empty');
      expect(formatBytes(NaN)).toBe('Empty');
    });
    it('formats bytes', () => {
      expect(formatBytes(1)).toBe('1 B');
      expect(formatBytes(1023)).toBe('1023 B');
    });
    it('formats kilobytes, trimming trailing .0', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(567)).toBe('567 B');
    });
    it('formats megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
      expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });
  });
});
