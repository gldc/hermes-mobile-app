import { RpcError } from '../src/api/gatewayClient';
import {
  approvalResult,
  clarifySingleResult,
  clarifySkipAllResult,
  createRequestResponder,
  valueResult,
  type ResponderDeps,
} from '../src/lib/request-answers';
import type { RequestCardState, TurnAction } from '../src/lib/turn-controller';

const base = (over: Partial<RequestCardState>): RequestCardState => ({
  id: 'srq-1', kind: 'approval', method: 'approval', params: {}, status: 'pending',
  legacy: false, receivedAt: 0, anchorKey: null, ...over,
});

function harness(respondOk = true) {
  const actions: TurnAction[] = [];
  const calls: Array<{ method: string; params: unknown }> = [];
  const replies: Record<string, unknown[]> = {};
  const respond = jest.fn((_id: string, _r: Record<string, unknown>) => respondOk);
  const drop = jest.fn();
  const deps: ResponderDeps = {
    registry: { respond, drop },
    call: (async (method: string, params: unknown) => {
      calls.push({ method, params });
      const next = replies[method]?.shift();
      if (next instanceof Error) throw next;
      return next;
    }) as unknown as ResponderDeps['call'],
    dispatch: (a) => actions.push(a),
    liveSessionId: () => 'live-1',
  };
  return {
    r: createRequestResponder(deps),
    actions,
    calls,
    respond,
    drop,
    reply: (m: string, ...v: unknown[]) => (replies[m] = v),
  };
}

test('result builders match the wire contract exactly', () => {
  expect(approvalResult('once')).toEqual({ choice: 'once' });
  expect(clarifySingleResult('')).toEqual({ answer: '' });
  expect(clarifySkipAllResult()).toEqual({});
  expect('answers' in clarifySkipAllResult()).toBe(false);
  expect(valueResult('v')).toEqual({ value: 'v' });
});

describe('approve', () => {
  it('0.21.5: responds {choice} through the registry, optimistic, no RPC, never `all`', async () => {
    const h = harness();
    expect(await h.r.approve(base({}), 'once')).toEqual({ ok: true });
    expect(h.respond).toHaveBeenCalledWith('srq-1', { choice: 'once' });
    expect(h.actions).toEqual([{ type: 'request.answered', id: 'srq-1', resolution: 'once' }]);
    expect(h.calls).toHaveLength(0);
  });
  it('0.21.5: unknown id in the registry → card closed, error outcome', async () => {
    const h = harness(false);
    expect(await h.r.approve(base({}), 'deny')).toEqual({ ok: false, message: 'This request is no longer open.' });
    expect(h.actions).toEqual([{ type: 'request.cancelled', id: 'srq-1', reason: 'session_closed' }]);
  });
  it('a settled card is not answered twice (double tap)', async () => {
    const h = harness();
    await h.r.approve(base({ status: 'answered' }), 'once');
    expect(h.respond).not.toHaveBeenCalled();
  });
  it('legacy: approval.respond {session_id, choice}; resolved>0 answers, 0 closes', async () => {
    const h = harness();
    h.reply('approval.respond', { resolved: 1 }, { resolved: 0 });
    await h.r.approve(base({ id: 'legacy:1', legacy: true }), 'deny');
    await h.r.approve(base({ id: 'legacy:2', legacy: true }), 'once');
    expect(h.calls).toEqual([
      { method: 'approval.respond', params: { session_id: 'live-1', choice: 'deny' } },
      { method: 'approval.respond', params: { session_id: 'live-1', choice: 'once' } },
    ]);
    expect(h.actions).toEqual([
      { type: 'request.answering', id: 'legacy:1' },
      { type: 'request.answered', id: 'legacy:1', resolution: 'deny' },
      { type: 'request.answering', id: 'legacy:2' },
      { type: 'request.cancelled', id: 'legacy:2', reason: 'resolved' },
    ]);
  });
  it('legacy: RPC failure re-arms the card', async () => {
    const h = harness();
    h.reply('approval.respond', new RpcError('socket closed', -1));
    expect(await h.r.approve(base({ id: 'legacy:1', legacy: true }), 'once')).toEqual({ ok: false, message: 'socket closed' });
    expect(h.actions.at(-1)).toEqual({ type: 'request.failed', id: 'legacy:1' });
  });
  it('answer again after re-delivery goes through the registry again (Review Focus 2)', async () => {
    const h = harness();
    await h.r.approve(base({}), 'once');
    await h.r.approve(base({ status: 'pending' }), 'once'); // reducer put it back to pending
    expect(h.respond).toHaveBeenCalledTimes(2);
  });
});

describe('clarify', () => {
  const clarify = (over: Partial<RequestCardState> = {}) => base({ kind: 'clarify', method: 'clarify', ...over });
  it('single: {answer}, never clarify.lock; "" is a skip; multi-select joins as a JSON array string', () => {
    const h = harness();
    h.r.clarifySingle(clarify(), 'Blue');
    h.r.clarifySingle(clarify({ id: 'srq-2' }), '');
    h.r.clarifySingle(clarify({ id: 'srq-3' }), ['A', 'C']);
    expect(h.respond.mock.calls).toEqual([
      ['srq-1', { answer: 'Blue' }],
      ['srq-2', { answer: '' }],
      ['srq-3', { answer: '["A","C"]' }],
    ]);
    expect(h.calls).toHaveLength(0);
    expect(h.actions).toEqual([
      { type: 'request.answered', id: 'srq-1', skipped: false, resolution: 'Blue' },
      { type: 'request.answered', id: 'srq-2', skipped: true, resolution: '' },
      { type: 'request.answered', id: 'srq-3', skipped: false, resolution: 'A, C' },
    ]);
  });
  it('lock: ok with remaining → locked; remaining [] → locked + answered (no response frame); resolving drops the registry entry (Preflight F11)', async () => {
    const h = harness();
    h.reply('clarify.lock', { status: 'ok', remaining: ['q1'] }, { status: 'ok', remaining: [] });
    expect(await h.r.clarifyLock(clarify(), 'q0', ['a', 'b'])).toBe('ok');
    expect(h.drop).not.toHaveBeenCalled();
    expect(await h.r.clarifyLock(clarify(), 'q1', '')).toBe('resolved');
    expect(h.calls).toEqual([
      { method: 'clarify.lock', params: { request_id: 'srq-1', question_id: 'q0', answer: ['a', 'b'] } },
      { method: 'clarify.lock', params: { request_id: 'srq-1', question_id: 'q1', answer: '' } },
    ]);
    expect(h.actions).toEqual([
      { type: 'request.locked', id: 'srq-1', qid: 'q0', answer: ['a', 'b'] },
      { type: 'request.locked', id: 'srq-1', qid: 'q1', answer: '' },
      { type: 'request.answered', id: 'srq-1' },
    ]);
    expect(h.respond).not.toHaveBeenCalled();
    expect(h.drop).toHaveBeenCalledTimes(1);
    expect(h.drop).toHaveBeenCalledWith('srq-1');
  });
  it('lock: expired → Timed out', async () => {
    const h = harness();
    h.reply('clarify.lock', { status: 'expired' });
    expect(await h.r.clarifyLock(clarify(), 'q0', 'x')).toBe('expired');
    expect(h.actions).toEqual([{ type: 'request.cancelled', id: 'srq-1', reason: 'timeout' }]);
    expect(h.drop).not.toHaveBeenCalled();
  });
  it('lock: RPC failure → failed, no state change', async () => {
    const h = harness();
    h.reply('clarify.lock', new RpcError('bad qid', 4002));
    expect(await h.r.clarifyLock(clarify(), 'q9', 'x')).toBe('failed');
    expect(h.actions).toEqual([]);
    expect(h.drop).not.toHaveBeenCalled();
  });
  it('lock on a non-pending card does nothing', async () => {
    const h = harness();
    expect(await h.r.clarifyLock(clarify({ status: 'answering' }), 'q0', 'x')).toBe('failed');
    expect(h.calls).toHaveLength(0);
  });
  it('submitAll locks the given questions in order and resolves', async () => {
    const h = harness();
    h.reply('clarify.lock', { status: 'ok', remaining: ['q2'] }, { status: 'ok', remaining: [] });
    expect(await h.r.clarifySubmitAll(clarify(), [{ qid: 'q1', answer: 'x' }, { qid: 'q2', answer: '' }])).toBe('resolved');
    expect(h.calls.map((c) => (c.params as { question_id: string }).question_id)).toEqual(['q1', 'q2']);
    expect(h.actions[0]).toEqual({ type: 'request.answering', id: 'srq-1' });
    expect(h.drop).toHaveBeenCalledWith('srq-1');
  });
  it('submitAll stops at expired (Review Focus 4)', async () => {
    const h = harness();
    h.reply('clarify.lock', { status: 'ok', remaining: ['q2'] }, { status: 'expired' });
    expect(await h.r.clarifySubmitAll(clarify(), [{ qid: 'q1', answer: 'x' }, { qid: 'q2', answer: 'y' }, { qid: 'q3', answer: 'z' }])).toBe('expired');
    expect(h.calls).toHaveLength(2);
    expect(h.actions.at(-1)).toEqual({ type: 'request.cancelled', id: 'srq-1', reason: 'timeout' });
  });
  it('submitAll failure mid-way keeps earlier locks and re-arms the card (Review Focus 4)', async () => {
    const h = harness();
    h.reply('clarify.lock', { status: 'ok', remaining: ['q2'] }, new RpcError('socket closed', -1));
    expect(await h.r.clarifySubmitAll(clarify(), [{ qid: 'q1', answer: 'x' }, { qid: 'q2', answer: 'y' }])).toBe('failed');
    expect(h.actions).toEqual([
      { type: 'request.answering', id: 'srq-1' },
      { type: 'request.locked', id: 'srq-1', qid: 'q1', answer: 'x' },
      { type: 'request.failed', id: 'srq-1' },
    ]);
  });
  it('submitAll: every lock returns ok but the gateway still lists open question ids → request.failed + \'ok\' (Preflight F11)', async () => {
    const h = harness();
    h.reply('clarify.lock', { status: 'ok', remaining: ['q2'] }, { status: 'ok', remaining: ['q99'] });
    expect(await h.r.clarifySubmitAll(clarify(), [{ qid: 'q1', answer: 'x' }, { qid: 'q2', answer: 'y' }])).toBe('ok');
    expect(h.actions).toEqual([
      { type: 'request.answering', id: 'srq-1' },
      { type: 'request.locked', id: 'srq-1', qid: 'q1', answer: 'x' },
      { type: 'request.locked', id: 'srq-1', qid: 'q2', answer: 'y' },
      { type: 'request.failed', id: 'srq-1' },
    ]);
    expect(h.drop).not.toHaveBeenCalled();
  });
  it('skipAll responds with no answers (cancel-all)', () => {
    const h = harness();
    expect(h.r.clarifySkipAll(clarify())).toEqual({ ok: true });
    expect(h.respond).toHaveBeenCalledWith('srq-1', {});
    expect(h.actions).toEqual([{ type: 'request.answered', id: 'srq-1', skipped: true }]);
  });
});

describe('value (sudo/secret)', () => {
  const SECRET = 'sk-live-DO-NOT-LEAK-4242';
  it('responds {value} and dispatches nothing that contains the value', () => {
    const h = harness();
    expect(h.r.value(base({ kind: 'secure-entry', method: 'secret' }), SECRET)).toEqual({ ok: true });
    expect(h.respond).toHaveBeenCalledWith('srq-1', { value: SECRET });
    expect(h.actions).toEqual([{ type: 'request.answered', id: 'srq-1', skipped: false }]);
    expect(JSON.stringify(h.actions)).not.toContain(SECRET);
  });
  it('"" is Skip', () => {
    const h = harness();
    h.r.value(base({ kind: 'secure-entry', method: 'sudo' }), '');
    expect(h.respond).toHaveBeenCalledWith('srq-1', { value: '' });
    expect(h.actions).toEqual([{ type: 'request.answered', id: 'srq-1', skipped: true }]);
  });
});
