import { createRequestRegistry } from '../request-registry';
import type { ServerRequest } from '@/vendor/hermes-gateway';

function req(id: string) {
  const out: [string, unknown][] = [];
  const r: ServerRequest = {
    id, method: 'clarify', params: {},
    respond: (result) => out.push(['respond', result]),
    fail: (code, message) => out.push(['fail', { code, message }]),
  };
  return { r, out };
}

describe('request registry', () => {
  it('respond routes to the live request once, then forgets it', () => {
    const reg = createRequestRegistry();
    const { r, out } = req('srq-1');
    reg.put(r);
    expect(reg.respond('srq-1', { answer: 'x' })).toBe(true);
    expect(reg.respond('srq-1', { answer: 'y' })).toBe(false);
    expect(out).toEqual([['respond', { answer: 'x' }]]);
  });
  it('latest delivery wins (a replay re-delivers the same id on the new socket)', () => {
    const reg = createRequestRegistry();
    const old = req('srq-1');
    const fresh = req('srq-1');
    reg.put(old.r);
    reg.put(fresh.r);
    reg.respond('srq-1', { answer: 'x' });
    expect(old.out).toEqual([]);
    expect(fresh.out).toEqual([['respond', { answer: 'x' }]]);
  });
  it('fail and drop', () => {
    const reg = createRequestRegistry();
    const a = req('a');
    reg.put(a.r);
    expect(reg.fail('a', -32601, 'nope')).toBe(true);
    expect(a.out).toEqual([['fail', { code: -32601, message: 'nope' }]]);
    const b = req('b');
    reg.put(b.r);
    reg.drop('b');
    expect(reg.respond('b', {})).toBe(false);
    expect(reg.fail('unknown', 1, 'x')).toBe(false);
  });
});
