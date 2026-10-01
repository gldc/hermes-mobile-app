// __tests__/session-mcp-store.test.ts
import {
  __resetSessionMcpStore,
  clearSessionMcpTarget,
  getSessionMcpTarget,
  publishSessionMcpTarget,
  subscribeSessionMcpTarget,
  type SessionMcpTarget,
} from '../src/session-mcp-store';

function target(over: Partial<SessionMcpTarget> = {}): SessionMcpTarget {
  return {
    connected: true,
    test: async () => ({ kind: 'error', message: 'unused' }),
    status: async () => [],
    ...over,
  };
}

beforeEach(() => __resetSessionMcpStore());

describe('session-mcp-store', () => {
  it('starts empty', () => {
    expect(getSessionMcpTarget()).toBeNull();
  });

  it('publishes and reads back the same reference', () => {
    const t = target();
    publishSessionMcpTarget({}, t);
    expect(getSessionMcpTarget()).toBe(t);
  });

  it('the owner can clear its target', () => {
    const owner = {};
    publishSessionMcpTarget(owner, target());
    clearSessionMcpTarget(owner);
    expect(getSessionMcpTarget()).toBeNull();
  });

  it('the same owner can republish (connected changes)', () => {
    const owner = {};
    publishSessionMcpTarget(owner, target({ connected: false }));
    const next = target({ connected: true });
    publishSessionMcpTarget(owner, next);
    expect(getSessionMcpTarget()).toBe(next);
  });

  it("an older chat's cleanup cannot clear a newer chat's target", () => {
    const older = {};
    const newer = {};
    publishSessionMcpTarget(older, target());
    const current = target();
    publishSessionMcpTarget(newer, current);
    clearSessionMcpTarget(older);
    expect(getSessionMcpTarget()).toBe(current);
  });

  it('an older chat that republishes does not take over from a newer one', () => {
    const older = {};
    const newer = {};
    publishSessionMcpTarget(older, target());
    const current = target();
    publishSessionMcpTarget(newer, current);
    publishSessionMcpTarget(older, target({ connected: false }));
    expect(getSessionMcpTarget()).toBe(current);
    clearSessionMcpTarget(older);
    expect(getSessionMcpTarget()).toBe(current);
  });

  it('clearing the newest chat falls back to an older one that is still mounted', () => {
    const older = {};
    const newer = {};
    const first = target();
    publishSessionMcpTarget(older, first);
    publishSessionMcpTarget(newer, target());
    clearSessionMcpTarget(newer);
    expect(getSessionMcpTarget()).toBe(first);
  });

  it('does not notify when the visible target is unchanged', () => {
    const older = {};
    const newer = {};
    publishSessionMcpTarget(older, target());
    publishSessionMcpTarget(newer, target());
    let n = 0;
    subscribeSessionMcpTarget(() => {
      n++;
    });
    publishSessionMcpTarget(older, target()); // hidden behind the newer chat
    clearSessionMcpTarget(older);
    expect(n).toBe(0);
  });

  it('notifies on publish and on an effective clear only', () => {
    let n = 0;
    const unsub = subscribeSessionMcpTarget(() => {
      n++;
    });
    const owner = {};
    publishSessionMcpTarget(owner, target());
    expect(n).toBe(1);
    clearSessionMcpTarget({}); // not the owner: nothing changes
    expect(n).toBe(1);
    clearSessionMcpTarget(owner);
    expect(n).toBe(2);
    unsub();
    publishSessionMcpTarget(owner, target());
    expect(n).toBe(2);
  });

  it('returns a stable snapshot between emits (safe for useSyncExternalStore)', () => {
    publishSessionMcpTarget({}, target());
    expect(getSessionMcpTarget()).toBe(getSessionMcpTarget());
  });

  it('__resetSessionMcpStore clears the target and listeners', () => {
    let n = 0;
    subscribeSessionMcpTarget(() => {
      n++;
    });
    publishSessionMcpTarget({}, target());
    __resetSessionMcpStore();
    expect(getSessionMcpTarget()).toBeNull();
    publishSessionMcpTarget({}, target());
    expect(n).toBe(1);
  });
});
