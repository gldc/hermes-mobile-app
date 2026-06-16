import {
  __resetPinStore, getPinState, hydratePinStore,
  pinSession, unpinSession, isPinned, setPinsCollapsed,
  type PinPersistence,
} from '../src/pin-store';

function fakePersistence(data: Record<string, string> = {}): PinPersistence {
  const store = new Map(Object.entries(data));
  return {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => { store.set(k, v); },
    del: async (k) => { store.delete(k); },
  };
}

beforeEach(() => __resetPinStore());

describe('pinSession / unpinSession', () => {
  it('appends a new pin', () => {
    pinSession('a');
    expect(getPinState().ids).toEqual(['a']);
  });

  it('is idempotent', () => {
    pinSession('a');
    pinSession('a');
    expect(getPinState().ids).toEqual(['a']);
  });

  it('removes on unpin', () => {
    pinSession('a');
    pinSession('b');
    unpinSession('a');
    expect(getPinState().ids).toEqual(['b']);
  });

  it('unpin is idempotent', () => {
    unpinSession('x');
    expect(getPinState().ids).toEqual([]);
  });
});

describe('isPinned', () => {
  it('returns true for pinned ids', () => {
    pinSession('a');
    expect(isPinned('a')).toBe(true);
    expect(isPinned('b')).toBe(false);
  });
});

describe('setPinsCollapsed', () => {
  it('updates collapsed state', () => {
    setPinsCollapsed(true);
    expect(getPinState().collapsed).toBe(true);
    setPinsCollapsed(false);
    expect(getPinState().collapsed).toBe(false);
  });
});

describe('hydratePinStore', () => {
  it('reads both keys from persistence', async () => {
    const p = fakePersistence({
      'hermes-pinned-sessions': '["a","b"]',
      'hermes-pinned-collapsed': 'true',
    });
    await hydratePinStore(p);
    const state = getPinState();
    expect(state.ids).toEqual(['a', 'b']);
    expect(state.collapsed).toBe(true);
    expect(state.hydrated).toBe(true);
  });

  it('falls back on corrupt JSON', async () => {
    const p = fakePersistence({ 'hermes-pinned-sessions': 'not-json' });
    await hydratePinStore(p);
    expect(getPinState().ids).toEqual([]);
    expect(getPinState().collapsed).toBe(false);
  });

  it('is idempotent', async () => {
    const p = fakePersistence({ 'hermes-pinned-sessions': '["a"]' });
    await hydratePinStore(p);
    pinSession('b');
    await hydratePinStore(p); // second call is no-op
    expect(getPinState().ids).toEqual(['a', 'b']);
  });
});

describe('__resetPinStore', () => {
  it('resets hydration promise so re-hydration works', async () => {
    const p = fakePersistence({ 'hermes-pinned-sessions': '["a"]' });
    await hydratePinStore(p);
    expect(getPinState().ids).toEqual(['a']);
    __resetPinStore();
    expect(getPinState().ids).toEqual([]);
    expect(getPinState().hydrated).toBe(false);
    const p2 = fakePersistence({ 'hermes-pinned-sessions': '["b"]' });
    await hydratePinStore(p2);
    expect(getPinState().ids).toEqual(['b']);
  });
});
