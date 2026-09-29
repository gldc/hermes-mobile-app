import { afterKeyboardSettles, type KeyboardSource } from '../src/lib/keyboard-settle';

// Sim S3 s1: the focused-field scroll ran on a fixed 300 ms timer, which fired before the keyboard (and
// the composer inset riding it) finished rising, so the field landed 13–17 pt off its target.
function fakeKeyboard(visible: boolean) {
  const listeners = new Set<() => void>();
  const kb: KeyboardSource = {
    isVisible: () => visible,
    addListener: (_event, fn) => {
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    },
  };
  return { kb, didShow: () => [...listeners].forEach((fn) => fn()), listening: () => listeners.size };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('keyboard rising: runs on keyboardDidShow, not on a timer, and only once', () => {
  const k = fakeKeyboard(false);
  const fn = jest.fn();
  afterKeyboardSettles(k.kb, fn);
  jest.advanceTimersByTime(300); // where the old fixed timer fired, mid-animation
  expect(fn).not.toHaveBeenCalled();
  k.didShow();
  expect(fn).toHaveBeenCalledTimes(1);
  expect(k.listening()).toBe(0);
  jest.advanceTimersByTime(5000);
  k.didShow();
  expect(fn).toHaveBeenCalledTimes(1);
});

test('no keyboard event ever (a hardware keyboard): a late fallback still runs it once', () => {
  const k = fakeKeyboard(false);
  const fn = jest.fn();
  afterKeyboardSettles(k.kb, fn);
  jest.advanceTimersByTime(999);
  expect(fn).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(fn).toHaveBeenCalledTimes(1);
  expect(k.listening()).toBe(0);
});

test('keyboard already up (moving between fields): the inset is final, so it runs soon without an event', () => {
  const k = fakeKeyboard(true);
  const fn = jest.fn();
  afterKeyboardSettles(k.kb, fn);
  jest.advanceTimersByTime(99);
  expect(fn).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(fn).toHaveBeenCalledTimes(1);
});

test('keyboard already up but changing height (a new accessory bar): the didShow that follows runs it', () => {
  const k = fakeKeyboard(true);
  const fn = jest.fn();
  afterKeyboardSettles(k.kb, fn);
  k.didShow();
  expect(fn).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1000);
  expect(fn).toHaveBeenCalledTimes(1);
});

test('cancel: nothing runs and the listener is gone', () => {
  const k = fakeKeyboard(false);
  const fn = jest.fn();
  const cancel = afterKeyboardSettles(k.kb, fn);
  cancel();
  k.didShow();
  jest.advanceTimersByTime(5000);
  expect(fn).not.toHaveBeenCalled();
  expect(k.listening()).toBe(0);
});
