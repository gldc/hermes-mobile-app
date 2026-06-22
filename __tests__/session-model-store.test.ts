import {
  __resetSessionModelStore,
  getSessionModelTarget,
  setSessionModelTarget,
  subscribeSessionModelTarget,
  type SessionModelTarget,
} from '../src/session-model-store';

const noopSwitch: SessionModelTarget['switchModel'] = async () => ({ kind: 'ok', model: null });

function target(over: Partial<SessionModelTarget> = {}): SessionModelTarget {
  return { sessionId: 's1', modelId: 'openai/qwen3.7-max', streaming: false, switchModel: noopSwitch, ...over };
}

beforeEach(() => __resetSessionModelStore());

describe('session-model-store', () => {
  it('starts empty', () => {
    expect(getSessionModelTarget()).toBeNull();
  });

  it('publishes and reads back the same target reference', () => {
    const t = target();
    setSessionModelTarget(t);
    expect(getSessionModelTarget()).toBe(t);
  });

  it('clears with null', () => {
    setSessionModelTarget(target());
    setSessionModelTarget(null);
    expect(getSessionModelTarget()).toBeNull();
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    let n = 0;
    const unsub = subscribeSessionModelTarget(() => {
      n++;
    });
    setSessionModelTarget(target());
    expect(n).toBe(1);
    unsub();
    setSessionModelTarget(null);
    expect(n).toBe(1);
  });

  it('returns a stable snapshot between emits (safe for useSyncExternalStore)', () => {
    setSessionModelTarget(target());
    expect(getSessionModelTarget()).toBe(getSessionModelTarget());
  });

  it('__resetSessionModelStore clears the target and listeners', () => {
    let n = 0;
    subscribeSessionModelTarget(() => {
      n++;
    });
    setSessionModelTarget(target());
    __resetSessionModelStore();
    expect(getSessionModelTarget()).toBeNull();
    setSessionModelTarget(target()); // listener was cleared by reset
    expect(n).toBe(1); // only the pre-reset emit counted
  });
});
