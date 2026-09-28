import { createChatTransport, type ChatTransport } from '@/api/chat-transport';
import { withStaleSessionRetry } from '@/api/stale-session';
import type { GatewayEvent } from '@/vendor/hermes-gateway';
import { installFakeWebSocketGlobal, restoreWebSocketGlobal } from './fixtures/fake-socket';
import { createFakeGateway, HOLD, rpcErr, type FakeGateway } from './fixtures/fake-gateway';
import { event, serverRequest } from './fixtures/frames';

beforeAll(installFakeWebSocketGlobal);
afterAll(restoreWebSocketGlobal);

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 6) {
  for (let i = 0; i < n; i++) await tick();
}

const CLARIFY = { session_id: 'live-1', questions: [{ qid: 'q0', question: 'Which?', choices: ['a', 'b'], multi_select: false }] };

let live: ChatTransport[] = [];
afterEach(() => {
  for (const t of live.splice(0)) t.dispose();
});

function setup(opts: { stored?: string | null; history?: () => Promise<void>; onNewCard?: () => void } = {}) {
  const gw: FakeGateway = createFakeGateway();
  let stored: string | null = opts.stored === undefined ? 'stored-1' : opts.stored;
  let liveId: string | null = null;
  let tickets = 0;
  const applied: GatewayEvent[] = [];
  const historyCalls: string[] = [];
  gw.responders['session.resume'] = () => ({ session_id: 'live-1', message_count: 0, messages: [], info: {} });
  const t = createChatTransport({
    socketFactory: gw.factory,
    mintUrl: async () => `ws://gw.test/api/ws?ticket=t${++tickets}`,
    storedSessionId: () => stored,
    resumeParams: () => ({ session_id: stored! }),
    loadHistory: async (id) => {
      historyCalls.push(id);
      await opts.history?.();
    },
    onLiveSessionId: (id) => (liveId = id),
    applyEvent: (e) => applied.push(e),
    anchorKey: () => null,
    onNewCard: opts.onNewCard,
    sleep: async () => {},
  });
  live.push(t);
  return { gw, t, applied, historyCalls, getLive: () => liveId, setStored: (s: string) => (stored = s) };
}

describe('handshake', () => {
  it('frame order on the wire: client.capabilities before session.resume', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    expect(gw.current().sent.map((f) => f.method).filter(Boolean)).toEqual(['client.capabilities', 'session.resume']);
  });
});

describe('server requests before any UI state (review M3)', () => {
  it('open_requests in the resume result become cards with NO -32601, before resume resolves', async () => {
    const { gw, t } = setup();
    gw.responders['session.resume'] = () => ({
      session_id: 'live-1', message_count: 0, messages: [], info: {},
      open_requests: [
        { id: 'srq-a', method: 'approval', params: { session_id: 'live-1', request_id: 'r1', command: 'rm -rf x' } },
        { id: 'srq-c', method: 'clarify', params: CLARIFY },
        { id: 'srq-s', method: 'secret', params: { session_id: 'live-1', env_var: 'K', prompt: 'p' } },
        { id: 'srq-u', method: 'sudo', params: { session_id: 'live-1', command: 'apt' } },
      ],
      pending_approval: { command: 'rm -rf x' }, // duplicates srq-a at 0.21.5 — must be ignored
    });
    await t.orchestrator.start();
    const cards = t.store.getState().requests;
    expect(cards.map((c) => [c.id, c.kind, c.status])).toEqual([
      ['srq-a', 'approval', 'pending'],
      ['srq-c', 'clarify', 'pending'],
      ['srq-s', 'secure-entry', 'pending'],
      ['srq-u', 'secure-entry', 'pending'],
    ]);
    const errors = gw.current().sent.filter((f) => typeof f.id === 'string' && f.id.startsWith('srq-') && f.error);
    expect(errors).toEqual([]);
  });

  it('desktop-only requests get -32601; vault gets -32601 plus a declined card', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-t', 'terminal.read', { session_id: 'live-1' }));
    gw.current().serverSend(serverRequest('srq-v', 'vault.unlock_prompt', { session_id: 'live-1', backend: 'op', display_name: '1P' }));
    const sent = gw.current().sent;
    expect(sent.find((f) => f.id === 'srq-t')).toMatchObject({ error: { code: -32601 } });
    expect(sent.find((f) => f.id === 'srq-v')).toMatchObject({ error: { code: -32601 } });
    expect(t.store.getState().requests.map((c) => [c.id, c.kind, c.status])).toEqual([['srq-v', 'vault-declined', 'skipped']]);
  });
});

describe('review focus: supported methods never get -32601/-32603', () => {
  it('a throwing UI callback on a new card does not become a -32603 (approval stays answerable)', async () => {
    const { gw, t } = setup({ onNewCard: () => { throw new Error('render bug'); } });
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-a', 'approval', { session_id: 'live-1', request_id: 'r', command: 'x' }));
    expect(gw.current().sent.find((f) => f.id === 'srq-a')).toBeUndefined();
    expect(t.store.getState().requests[0]).toMatchObject({ id: 'srq-a', status: 'pending' });
    expect(t.registry.respond('srq-a', { choice: 'deny' })).toBe(true);
  });
});

describe('review focus: duplicate replay', () => {
  it('the same open request re-delivered by resume AND events.since, plus a racing live delta → one card, one delta', async () => {
    const { gw, t, applied } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(event('message.start', {}, { session_id: 'live-1', seq: 1 }));
    gw.current().serverSend(serverRequest('srq-c', 'clarify', CLARIFY));
    const open = [{ id: 'srq-c', method: 'clarify', params: CLARIFY }];
    gw.responders['session.resume'] = () => ({ session_id: 'live-1', message_count: 0, messages: [], info: {}, running: true, open_requests: open });
    gw.responders['session.events.since'] = (_p, sock) => {
      // a live frame races the replay response on the new socket
      sock.serverSend(event('message.delta', { text: 'B' }, { session_id: 'live-1', seq: 3 }));
      return { events: [{ type: 'message.delta', session_id: 'live-1', seq: 2, payload: { text: 'A' } }, { type: 'message.delta', session_id: 'live-1', seq: 3, payload: { text: 'B' } }], latest_seq: 3, truncated: false, count: 2, epoch: 'e1', open_requests: open };
    };
    gw.current().drop();
    await settle(10);
    expect(t.store.getState().requests.map((c) => c.id)).toEqual(['srq-c']);
    const deltas = applied.filter((e) => e.type === 'message.delta').map((e) => [(e.payload as any).text, !!e.replayed]);
    expect(deltas).toEqual([['A', true], ['B', true]]);
  });
});

describe('review focus: stop across a reconnect', () => {
  it('stopping survives a mid-turn anchor replay', async () => {
    const { gw, t, applied } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(event('message.start', {}, { session_id: 'live-1', seq: 1 }));
    expect(t.store.getState().turn).toBe('streaming');
    t.store.dispatch({ type: 'stop.sent' });
    expect(t.store.getState().turn).toBe('stopping');
    gw.responders['session.resume'] = () => ({ session_id: 'live-1', message_count: 0, messages: [], info: {}, running: true });
    gw.responders['session.events.since'] = () => ({
      events: [
        { type: 'message.start', session_id: 'live-1', seq: 1, payload: {} },
        { type: 'message.delta', session_id: 'live-1', seq: 2, payload: { text: 'A' } },
      ],
      latest_seq: 2, truncated: false, count: 2, epoch: 'e1',
    });
    gw.current().drop();
    await settle(10);
    expect(gw.sockets).toHaveLength(2);
    expect(t.store.getState().turn).toBe('stopping');
    const deltas = applied.filter((e) => e.type === 'message.delta').map((e) => [(e.payload as any).text, !!e.replayed]);
    expect(deltas).toEqual([['A', true]]);
  });
});

describe('reconnect mid-clarify (review B1)', () => {
  it('socket drop → resume re-delivers → history replace → card still present and answerable on the NEW socket', async () => {
    const { gw, t, historyCalls } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-c', 'clarify', CLARIFY));
    expect(t.store.getState().requests).toHaveLength(1);
    const first = gw.current();
    gw.responders['session.resume'] = () => ({
      session_id: 'live-1', message_count: 0, messages: [], info: {}, running: true,
      open_requests: [{ id: 'srq-c', method: 'clarify', params: CLARIFY }],
    });
    first.drop();
    await settle();
    expect(gw.sockets).toHaveLength(2);
    expect(historyCalls).toEqual(['stored-1', 'stored-1']);
    const cards = t.store.getState().requests;
    expect(cards).toHaveLength(1); // deduped by id, not duplicated
    expect(cards[0]).toMatchObject({ id: 'srq-c', status: 'pending' });
    expect(t.registry.respond('srq-c', { answers: { q0: 'a' } })).toBe(true);
    expect(gw.current().sent.find((f) => f.id === 'srq-c')).toEqual({ jsonrpc: '2.0', id: 'srq-c', result: { answers: { q0: 'a' } } });
    expect(first.sent.find((f) => f.id === 'srq-c')).toBeUndefined();
  });

  it('reconnect DURING resume: the second drop joins/restarts cleanly and the card survives', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-c', 'clarify', CLARIFY));
    let holdOnce = true;
    gw.responders['session.resume'] = (_p, sock) => {
      if (holdOnce) {
        holdOnce = false;
        setTimeout(() => sock.drop(), 0); // drop while resume is in flight
        return HOLD;
      }
      return { session_id: 'live-1', message_count: 0, messages: [], info: {}, open_requests: [{ id: 'srq-c', method: 'clarify', params: CLARIFY }] };
    };
    gw.sockets[0].drop();
    await settle(12);
    expect(gw.sockets).toHaveLength(3);
    expect(t.store.getState().requests.map((c) => [c.id, c.status])).toEqual([['srq-c', 'pending']]);
    expect(t.client.isOpen).toBe(true);
  });
});

describe('turn ended during a drop (review I2)', () => {
  it('0.21.5 clarify + approval open → drop → resume running:false, no open_requests → cards closed as session_closed', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-c', 'clarify', CLARIFY));
    gw.current().serverSend(serverRequest('srq-a', 'approval', { session_id: 'live-1', request_id: 'r1', command: 'rm -rf x' }));
    expect(t.store.getState().requests.map((c) => c.status)).toEqual(['pending', 'pending']);
    gw.responders['session.resume'] = () => ({
      session_id: 'live-1', message_count: 0, messages: [], info: {}, running: false, status: 'idle',
    });
    gw.current().drop();
    await settle();
    expect(gw.sockets).toHaveLength(2);
    expect(t.store.getState().turn).toBe('idle');
    expect(t.store.getState().requests.map((c) => [c.id, c.status, c.cancelReason])).toEqual([
      ['srq-c', 'cancelled', 'session_closed'],
      ['srq-a', 'cancelled', 'session_closed'],
    ]);
  });

  it('a card re-delivered by that same running:false resume stays open (channel delivers open_requests first)', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-c', 'clarify', CLARIFY));
    gw.current().serverSend(serverRequest('srq-a', 'approval', { session_id: 'live-1', request_id: 'r1', command: 'rm -rf x' }));
    gw.responders['session.resume'] = () => ({
      session_id: 'live-1', message_count: 0, messages: [], info: {}, running: false,
      open_requests: [{ id: 'srq-c', method: 'clarify', params: CLARIFY }],
    });
    gw.current().drop();
    await settle();
    expect(t.store.getState().requests.map((c) => [c.id, c.status, c.cancelReason])).toEqual([
      ['srq-c', 'pending', undefined],
      ['srq-a', 'cancelled', 'session_closed'],
    ]);
    expect(t.registry.respond('srq-c', { answers: { q0: 'a' } })).toBe(true);
    expect(gw.current().sent.find((f) => f.id === 'srq-c')).toEqual({ jsonrpc: '2.0', id: 'srq-c', result: { answers: { q0: 'a' } } });
  });
});

describe('teardown order (PR #22 hardening)', () => {
  it("the old socket's late close after a successful reconnect starts no second run", async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    const old = gw.current();
    old.readyState = 3; // OS tore it down silently (iOS suspension) — no close event yet
    await t.orchestrator.reconnect('foreground');
    expect(gw.sockets).toHaveLength(2);
    old.drop(); // the late close finally fires
    await settle();
    expect(gw.sockets).toHaveLength(2);
    expect(t.client.isOpen).toBe(true);
  });

  it('dispose() closes the socket without reconnecting', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    t.dispose();
    await settle();
    expect(gw.sockets).toHaveLength(1);
    expect(gw.sockets[0].closed).toBe(true);
  });

  it('heartbeat-style invalidate + foreground in the same tick → one new socket', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    t.client.invalidate(); // what the vendored heartbeat does on deadline → onState('closed')
    void t.orchestrator.reconnect('foreground');
    await settle();
    expect(gw.sockets).toHaveLength(2);
  });
});

describe('events', () => {
  it('request.cancel closes the card and drops the live request', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-a', 'approval', { session_id: 'live-1', request_id: 'r', command: 'x' }));
    gw.current().serverSend(event('request.cancel', { id: 'srq-a', method: 'approval', reason: 'interrupted' }, { session_id: 'live-1', seq: 4 }));
    expect(t.store.getState().requests[0]).toMatchObject({ status: 'cancelled', cancelReason: 'interrupted' });
    expect(t.registry.respond('srq-a', { choice: 'once' })).toBe(false);
  });

  it('message.start with no local send drives streaming; error while waiting ends the turn', async () => {
    const { gw, t, applied } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(event('message.start', {}, { session_id: 'live-1', seq: 1 }));
    expect(t.store.getState().turn).toBe('streaming');
    gw.current().serverSend(event('message.complete', { status: 'interrupted' }, { session_id: 'live-1', seq: 2 }));
    expect(t.store.getState()).toMatchObject({ turn: 'idle', lastStatus: 'interrupted' });
    t.store.dispatch({ type: 'submit.sent' });
    gw.current().serverSend(event('error', { message: 'agent init failed' }, { session_id: 'live-1', seq: 3 }));
    expect(t.store.getState().turn).toBe('idle');
    expect(applied.map((e) => e.type)).toEqual(['gateway.ready', 'message.start', 'message.complete', 'error']);
  });

  it('0.20.4: approval.request event → legacy card; approval.respond is typed and callable', async () => {
    const { gw, t } = setup();
    gw.ready = {}; // 0.20.4 ready: no heartbeat, no replay_epoch
    gw.responders['client.capabilities'] = () => rpcErr(-32601, 'unknown method');
    gw.responders['approval.respond'] = () => ({ resolved: 1 });
    await t.orchestrator.start();
    gw.current().serverSend(event('approval.request', { command: 'rm -rf build', description: 'recursive delete' }, { session_id: 'live-1' }));
    expect(t.store.getState().requests).toEqual([
      expect.objectContaining({ id: 'legacy:1', kind: 'approval', legacy: true, status: 'pending' }),
    ]);
    await expect(t.client.call('approval.respond', { session_id: 'live-1', choice: 'once' })).resolves.toEqual({ resolved: 1 });
  });
});

describe('stale live session id (4001)', () => {
  it('resumeStored() + withStaleSessionRetry retries once with the fresh live id', async () => {
    const { gw, t, getLive } = setup();
    await t.orchestrator.start();
    let calls = 0;
    gw.responders['session.interrupt'] = (p) => (++calls === 1 ? rpcErr(4001, 'session not found') : { status: 'interrupted', seen: p.session_id });
    gw.responders['session.resume'] = () => ({ session_id: 'live-2', message_count: 0, messages: [], info: {} });
    const out = await withStaleSessionRetry(
      'live-1',
      (sid) => t.client.call('session.interrupt', { session_id: sid }),
      () => t.resumeStored(),
    );
    expect(out).toMatchObject({ seen: 'live-2' });
    expect(getLive()).toBe('live-2');
  });

  it('a second 4001 is surfaced, not retried forever', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    const resumes = () => gw.sockets.flatMap((s) => s.sentFor('session.resume')).length;
    const before = resumes();
    gw.responders['session.interrupt'] = () => rpcErr(4001, 'session not found');
    await expect(
      withStaleSessionRetry('live-1', (sid) => t.client.call('session.interrupt', { session_id: sid }), () => t.resumeStored()),
    ).rejects.toEqual(expect.objectContaining({ code: 4001 }));
    expect(resumes() - before).toBe(1); // exactly one resume-and-retry, then the error surfaces
  });
});
