import { createRequestRegistry } from '../request-registry';
import { createRequestRouter, shouldWarn, VAULT_DECLINED_MESSAGE } from '../request-router';
import { createTurnStore } from '../turn-store';
import type { RequestCardState } from '../turn-controller';
import type { ServerRequest } from '@/vendor/hermes-gateway';

function srq(id: string, method: string, params: Record<string, unknown> = {}, replayed = false) {
  const wire: unknown[] = [];
  const req: ServerRequest = {
    id, method, params, replayed,
    respond: (result) => wire.push({ result }),
    fail: (code, message) => wire.push({ error: { code, message } }),
  };
  return { req, wire };
}

function setup() {
  const store = createTurnStore();
  const registry = createRequestRegistry();
  const newCards: [string, boolean][] = [];
  let anchor: string | null = 'i7';
  const router = createRequestRouter({
    store, registry, anchorKey: () => anchor, now: () => 42,
    onNewCard: (c, replayed) => newCards.push([c.id, replayed]),
  });
  return { store, registry, router, newCards, setAnchor: (a: string | null) => (anchor = a) };
}

describe('request router', () => {
  it.each(['approval', 'clarify', 'sudo', 'secret'])('accepts %s: card + registry, no wire answer', (method) => {
    const { store, registry, router } = setup();
    const { req, wire } = srq('srq-1', method, { session_id: 's' });
    expect(router.handleRequest(req)).toBe(true);
    expect(wire).toEqual([]);
    expect(store.getState().requests[0]).toMatchObject({ id: 'srq-1', method, legacy: false, receivedAt: 42, anchorKey: 'i7', status: 'pending' });
    expect(registry.respond('srq-1', { x: 1 })).toBe(true);
  });

  it('declines desktop-only methods (the channel then answers -32601) and makes no card', () => {
    const { store, router } = setup();
    for (const m of ['terminal.read', 'preview.read', 'preview.act', 'window.read', 'tour', 'display.install.sudo']) {
      expect(router.handleRequest(srq(`srq-${m}`, m).req)).toBe(false);
    }
    expect(store.getState().requests).toEqual([]);
  });

  it('vault: a declined card, an immediate -32601, and accepted (true)', () => {
    const { store, router } = setup();
    const { req, wire } = srq('srq-v', 'vault.code', { session_id: 's' });
    expect(router.handleRequest(req)).toBe(true);
    expect(wire).toEqual([{ error: { code: -32601, message: VAULT_DECLINED_MESSAGE } }]);
    expect(store.getState().requests[0]).toMatchObject({ kind: 'vault-declined', status: 'skipped' });
  });

  it('batch clarify replay answers seed lockedAnswers', () => {
    const { store, router } = setup();
    router.handleRequest(srq('srq-c', 'clarify', { session_id: 's', questions: [], answers: { q0: 'yes' } }, true).req);
    expect(store.getState().requests[0].lockedAnswers).toEqual({ q0: 'yes' });
  });

  it('onNewCard fires once per id with the replayed flag; a re-delivery is an update', () => {
    const { store, router, newCards } = setup();
    router.handleRequest(srq('srq-1', 'approval').req);
    router.handleRequest(srq('srq-1', 'approval', {}, true).req);
    expect(newCards).toEqual([['srq-1', false]]);
    expect(store.getState().requests).toHaveLength(1);
  });

  it('request.cancel → cancelled with reason; unknown reason → session_closed; consumed', () => {
    const { store, registry, router } = setup();
    router.handleRequest(srq('a', 'approval').req);
    router.handleRequest(srq('b', 'clarify').req);
    expect(router.handleEvent({ type: 'request.cancel', payload: { id: 'a', method: 'approval', reason: 'timeout' } })).toBe(true);
    router.handleEvent({ type: 'request.cancel', payload: { id: 'b', method: 'clarify', reason: 'weird' } });
    expect(store.getState().requests.map((r) => [r.id, r.status, r.cancelReason])).toEqual([
      ['a', 'cancelled', 'timeout'],
      ['b', 'cancelled', 'session_closed'],
    ]);
    expect(registry.respond('a', {})).toBe(false);
  });

  it('legacy approval.request → legacy:<n> cards in arrival order; undisplayable payloads are consumed but dropped', () => {
    const { store, router } = setup();
    expect(router.handleEvent({ type: 'approval.request', payload: { command: 'rm -rf a' } })).toBe(true);
    expect(router.handleEvent({ type: 'approval.request', payload: { command: '', description: '' } })).toBe(true);
    router.handleEvent({ type: 'approval.request', payload: { description: 'danger' } });
    expect(store.getState().requests.map((r) => [r.id, r.legacy, r.kind])).toEqual([
      ['legacy:1', true, 'approval'],
      ['legacy:2', true, 'approval'],
    ]);
  });

  it('other events are not consumed', () => {
    const { router } = setup();
    expect(router.handleEvent({ type: 'message.delta', payload: { text: 'x' } })).toBe(false);
  });
});

// P7 (controller ruling): the live-only Warning haptic gate. Live request cards warrant the
// Warning haptic; replayed deliveries and vault-declined cards (nothing to answer) never do.
describe('shouldWarn', () => {
  function card(overrides: Partial<RequestCardState> = {}): RequestCardState {
    return {
      id: 'srq-1',
      kind: 'approval',
      method: 'approval',
      params: {},
      status: 'pending',
      legacy: false,
      receivedAt: 42,
      anchorKey: null,
      ...overrides,
    };
  }

  it('live approval → true', () => {
    expect(shouldWarn(card({ kind: 'approval' }), false)).toBe(true);
  });

  it('replayed approval → false', () => {
    expect(shouldWarn(card({ kind: 'approval' }), true)).toBe(false);
  });

  it('live vault-declined → false', () => {
    expect(shouldWarn(card({ kind: 'vault-declined', status: 'skipped' }), false)).toBe(false);
  });
});
