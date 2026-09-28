import { createTurnStore } from '../turn-store';

describe('turn store', () => {
  it('dispatch reduces, notifies subscribers, and skips no-op actions', () => {
    const store = createTurnStore();
    const seen: string[] = [];
    const off = store.subscribe(() => seen.push(store.getState().turn));
    store.dispatch({ type: 'submit.sent' });
    store.dispatch({ type: 'submit.sent' }); // no-op in waiting → no notification
    store.dispatch({ type: 'event.message.start', replayed: false });
    off();
    store.dispatch({ type: 'event.message.complete', status: 'complete', replayed: false });
    expect(seen).toEqual(['waiting', 'streaming']);
    expect(store.getState().turn).toBe('idle');
  });
});
