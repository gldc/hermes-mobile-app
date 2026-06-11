// __tests__/search.test.ts
import { parseSnippet, searchSessions } from '../src/api/search';

function fakeClient(body: unknown) {
  const calls: string[] = [];
  return {
    calls,
    get: async <T>(path: string): Promise<T> => {
      calls.push(path);
      return body as T;
    },
  };
}

describe('searchSessions', () => {
  it('hits the verified endpoint with an encoded query', async () => {
    const c = fakeClient({ results: [] });
    await searchSessions(c, 'fix the/bug & ship');
    expect(c.calls).toEqual([
      `/api/sessions/search?q=${encodeURIComponent('fix the/bug & ship')}&limit=20`,
    ]);
  });

  it('short-circuits blank queries without a network call', async () => {
    const c = fakeClient({ results: [{ session_id: 'x' }] });
    expect(await searchSessions(c, '   ')).toEqual({ results: [] });
    expect(c.calls).toEqual([]);
  });

  it('trims the query before sending', async () => {
    const c = fakeClient({ results: [] });
    await searchSessions(c, '  hello  ');
    expect(c.calls[0]).toBe('/api/sessions/search?q=hello&limit=20');
  });

  it('clamps limit into the server-accepted 1..100 range', async () => {
    const c = fakeClient({ results: [] });
    await searchSessions(c, 'q', 500);
    await searchSessions(c, 'q', 0);
    await searchSessions(c, 'q', 7.9);
    expect(c.calls).toEqual([
      '/api/sessions/search?q=q&limit=100',
      '/api/sessions/search?q=q&limit=1',
      '/api/sessions/search?q=q&limit=7',
    ]);
  });

  it('returns the parsed response body', async () => {
    const hit = { snippet: 'a <b>b</b>', role: 'user', session_id: 's1', lineage_root: 's0' };
    const c = fakeClient({ results: [hit] });
    expect(await searchSessions(c, 'b')).toEqual({ results: [hit] });
  });
});

describe('parseSnippet', () => {
  it('returns one plain segment when there are no markers', () => {
    expect(parseSnippet('just text')).toEqual([{ text: 'just text', match: false }]);
  });

  it('splits matched runs out of the snippet', () => {
    expect(parseSnippet('before <b>match</b> after')).toEqual([
      { text: 'before ', match: false },
      { text: 'match', match: true },
      { text: ' after', match: false },
    ]);
  });

  it('handles multiple and leading/trailing matches', () => {
    expect(parseSnippet('<b>a</b> mid <b>b</b>')).toEqual([
      { text: 'a', match: true },
      { text: ' mid ', match: false },
      { text: 'b', match: true },
    ]);
  });

  it('merges adjacent matched runs', () => {
    expect(parseSnippet('<b>a</b><b>b</b>')).toEqual([{ text: 'ab', match: true }]);
  });

  it('treats an unclosed <b> as matching to the end', () => {
    expect(parseSnippet('x <b>tail')).toEqual([
      { text: 'x ', match: false },
      { text: 'tail', match: true },
    ]);
  });

  it('decodes common HTML entities', () => {
    expect(parseSnippet('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;')).toEqual([
      { text: 'a & b <c> "d" \'e\'', match: false },
    ]);
  });

  it('returns an empty list for an empty snippet', () => {
    expect(parseSnippet('')).toEqual([]);
  });
});
