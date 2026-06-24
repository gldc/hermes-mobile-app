import { shouldReconnect, backoffMs, MAX_RECONNECT_ATTEMPTS } from '../src/lib/reconnect';

describe('shouldReconnect', () => {
  it('reconnects on active when there is no socket', () => {
    expect(shouldReconnect({ hasSocket: false, isOpen: false, appState: 'active' })).toBe(true);
  });
  it('reconnects on active when the socket is not open', () => {
    expect(shouldReconnect({ hasSocket: true, isOpen: false, appState: 'active' })).toBe(true);
  });
  it('does not reconnect when the socket is open', () => {
    expect(shouldReconnect({ hasSocket: true, isOpen: true, appState: 'active' })).toBe(false);
  });
  it('does not reconnect on non-active app states', () => {
    expect(shouldReconnect({ hasSocket: false, isOpen: false, appState: 'background' })).toBe(false);
    expect(shouldReconnect({ hasSocket: false, isOpen: false, appState: 'inactive' })).toBe(false);
  });
});

describe('backoffMs', () => {
  it('doubles each attempt and caps at 8000ms', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });
});

describe('MAX_RECONNECT_ATTEMPTS', () => {
  it('is 5', () => {
    expect(MAX_RECONNECT_ATTEMPTS).toBe(5);
  });
});
