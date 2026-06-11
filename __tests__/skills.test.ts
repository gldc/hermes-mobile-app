// __tests__/skills.test.ts
import {
  filterSkills,
  listSkills,
  sortSkills,
  summaryLine,
  toggleSkill,
  type SkillInfo,
} from '../src/api/skills';
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

function skill(over: Partial<SkillInfo> = {}): SkillInfo {
  return { name: 'git-commits', description: 'Write good commits', category: 'dev', enabled: true, ...over };
}

describe('skills api', () => {
  it('listSkills hits GET /api/skills and returns the bare array', async () => {
    const f = fakeFetch(200, [skill(), skill({ name: 'pdf', category: '', enabled: false })]);
    const skills = await listSkills(client(f));
    expect(f.calls[0].url).toBe('http://h/api/skills');
    expect(f.calls[0].init.method).toBeUndefined(); // GET
    expect(skills).toHaveLength(2);
    expect(skills[0].name).toBe('git-commits');
    expect(skills[1].enabled).toBe(false);
  });

  it('toggleSkill PUTs name + enabled to /api/skills/toggle', async () => {
    const f = fakeFetch(200, { ok: true, name: 'git-commits', enabled: false });
    const res = await toggleSkill(client(f), 'git-commits', false);
    expect(f.calls[0].url).toBe('http://h/api/skills/toggle');
    expect(f.calls[0].init.method).toBe('PUT');
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ name: 'git-commits', enabled: false });
    expect(res.enabled).toBe(false);
  });

  it('toggleSkill surfaces server errors', async () => {
    const f = fakeFetch(404, { detail: 'unknown skill' });
    await expect(toggleSkill(client(f), 'nope', true)).rejects.toThrow('unknown skill');
  });

  describe('summaryLine', () => {
    it('returns a single-line description as-is, trimmed', () => {
      expect(summaryLine('  Write good commits  ')).toBe('Write good commits');
    });
    it('takes the first non-empty line of multi-line text', () => {
      expect(summaryLine('\n\n  First real line\nsecond line')).toBe('First real line');
    });
    it('handles empty and nullish input', () => {
      expect(summaryLine('')).toBe('');
      expect(summaryLine('\n \n')).toBe('');
      expect(summaryLine(undefined as unknown as string)).toBe('');
    });
  });

  describe('filterSkills', () => {
    const skills = [
      skill({ name: 'git-commits', description: 'Write good commits', category: 'dev' }),
      skill({ name: 'pdf-tools', description: 'Fill PDF forms', category: 'docs' }),
      skill({ name: 'weather', description: 'Forecast lookup', category: '' }),
    ];
    it('returns everything for an empty or whitespace query', () => {
      expect(filterSkills(skills, '')).toHaveLength(3);
      expect(filterSkills(skills, '   ')).toHaveLength(3);
    });
    it('matches name case-insensitively', () => {
      expect(filterSkills(skills, 'GIT').map((s) => s.name)).toEqual(['git-commits']);
    });
    it('matches description', () => {
      expect(filterSkills(skills, 'forms').map((s) => s.name)).toEqual(['pdf-tools']);
    });
    it('matches category', () => {
      expect(filterSkills(skills, 'docs').map((s) => s.name)).toEqual(['pdf-tools']);
    });
    it('returns empty for no match', () => {
      expect(filterSkills(skills, 'zzz')).toEqual([]);
    });
  });

  describe('sortSkills', () => {
    it('orders by category A→Z then name, uncategorized last', () => {
      const out = sortSkills([
        skill({ name: 'b-skill', category: '' }),
        skill({ name: 'z-skill', category: 'dev' }),
        skill({ name: 'a-skill', category: 'dev' }),
        skill({ name: 'doc-skill', category: 'docs' }),
      ]);
      expect(out.map((s) => s.name)).toEqual(['a-skill', 'z-skill', 'doc-skill', 'b-skill']);
    });
    it('does not mutate the input', () => {
      const input = [skill({ name: 'z' }), skill({ name: 'a' })];
      sortSkills(input);
      expect(input[0].name).toBe('z');
    });
  });
});
