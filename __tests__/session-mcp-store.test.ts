// __tests__/session-mcp-store.test.ts
import {
  NOT_CONNECTED_MESSAGE,
  __resetSessionMcpStore,
  clearMcpChanged,
  clearSessionMcpTarget,
  createSessionMcpTarget,
  getMcpChangePending,
  getSessionMcpTarget,
  markMcpChanged,
  publishSessionMcpTarget,
  subscribeMcpChange,
  subscribeSessionMcpTarget,
  type SessionMcpTarget,
} from '../src/session-mcp-store';

function target(over: Partial<SessionMcpTarget> = {}): SessionMcpTarget {
  return {
    connected: true,
    streaming: false,
    test: async () => ({ kind: 'error', message: 'unused' }),
    status: async () => [],
    reload: async () => ({ kind: 'unknown' }),
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

describe('createSessionMcpTarget', () => {
  it('without a socket: test reports not connected and status is empty (review focus 1)', async () => {
    const t = createSessionMcpTarget({ connected: false, streaming: false, getCall: () => null, getSessionId: () => null });
    expect(t.connected).toBe(false);
    expect(await t.reload()).toEqual({ kind: 'error', message: NOT_CONNECTED_MESSAGE });
    expect(await t.test('linear', null)).toEqual({ kind: 'error', message: NOT_CONNECTED_MESSAGE });
    expect(await t.status(null)).toEqual([]);
  });

  it('with a socket: delegates to the two RPCs with the profile', async () => {
    const calls: { method: string; params: unknown }[] = [];
    const call = (async (method: string, params: unknown) => {
      calls.push({ method, params });
      return method === 'mcp.servers.status'
        ? { servers: [{ name: 'linear', status: 'connected', tools: 3 }], checked_at: 1 }
        : { ok: true, tools: [], oauth_needed: false };
    }) as any;
    const t = createSessionMcpTarget({ connected: true, streaming: true, getCall: () => call, getSessionId: () => 's1' });
    expect(t.streaming).toBe(true);
    expect(t.connected).toBe(true);
    expect((await t.test('linear', 'work')).kind).toBe('ok');
    expect(await t.status('work')).toHaveLength(1);
    expect(calls).toEqual([
      { method: 'mcp.servers.test', params: { name: 'linear', profile: 'work' } },
      { method: 'mcp.servers.status', params: { profile: 'work' } },
    ]);
  });

  it('reads the socket at call time, not when the target was created', async () => {
    let live: any = null;
    const t = createSessionMcpTarget({ connected: true, streaming: false, getCall: () => live, getSessionId: () => null });
    expect((await t.test('x', null)).kind).toBe('error');
    live = async () => ({ ok: true, tools: [], oauth_needed: false });
    expect((await t.test('x', null)).kind).toBe('ok');
  });
});

describe('createSessionMcpTarget — reload', () => {
  it('reloads through the socket with the chat\'s live session id, read at call time', async () => {
    const calls: { method: string; params: unknown }[] = [];
    const call = (async (method: string, params: unknown) => {
      calls.push({ method, params });
      return { status: 'reloaded' };
    }) as any;
    let sid: string | null = null;
    const t = createSessionMcpTarget({ connected: true, streaming: false, getCall: () => call, getSessionId: () => sid });
    expect(await t.reload()).toEqual({ kind: 'reloaded', thisChatOnly: false });
    sid = 's9';
    await t.reload();
    expect(calls).toEqual([
      { method: 'reload.mcp', params: { confirm: true } },
      { method: 'reload.mcp', params: { session_id: 's9', confirm: true } },
    ]);
  });
});

describe('change-pending flag', () => {
  it('starts clear, is set by a change and cleared by a reload', () => {
    expect(getMcpChangePending()).toBe(false);
    markMcpChanged();
    expect(getMcpChangePending()).toBe(true);
    clearMcpChanged();
    expect(getMcpChangePending()).toBe(false);
  });

  it('notifies only when the value changes', () => {
    let n = 0;
    const unsub = subscribeMcpChange(() => {
      n++;
    });
    markMcpChanged();
    markMcpChanged();
    expect(n).toBe(1);
    clearMcpChanged();
    clearMcpChanged();
    expect(n).toBe(2);
    unsub();
    markMcpChanged();
    expect(n).toBe(2);
  });

  it('survives a chat unmounting, and is cleared by a store reset', () => {
    const owner = {};
    publishSessionMcpTarget(owner, target());
    markMcpChanged();
    clearSessionMcpTarget(owner);
    expect(getMcpChangePending()).toBe(true);
    __resetSessionMcpStore();
    expect(getMcpChangePending()).toBe(false);
  });
});
