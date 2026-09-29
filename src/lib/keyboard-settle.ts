// src/lib/keyboard-settle.ts — run something once the keyboard has finished rising (sim S3 s1).
// Pure with an injected keyboard: the chat screen passes React Native's `Keyboard`.

/** The slice of React Native's `Keyboard` this needs; `Keyboard` itself satisfies it. */
export interface KeyboardSource {
  isVisible(): boolean;
  addListener(event: 'keyboardDidShow', listener: () => void): { remove(): void };
}

/** Keyboard already up: nothing is animating unless its height changes, which posts a didShow. */
const VISIBLE_FALLBACK_MS = 100;
/** No didShow ever comes with a hardware keyboard attached (the software one never rises). */
const HIDDEN_FALLBACK_MS = 1000;

/**
 * Calls `fn` once, after the keyboard's `keyboardDidShow` — the end of its rise, when the composer
 * inset riding it is final — or after a fallback when no such event comes. A fixed 300 ms timer
 * fired mid-animation and the focused field landed 13–17 pt off its target (sim S3 s1).
 * Returns a cancel function.
 */
export function afterKeyboardSettles(kb: KeyboardSource, fn: () => void): () => void {
  let done = false;
  const sub = kb.addListener('keyboardDidShow', () => run());
  const timer = setTimeout(() => run(), kb.isVisible() ? VISIBLE_FALLBACK_MS : HIDDEN_FALLBACK_MS);
  function cancel() {
    done = true;
    sub.remove();
    clearTimeout(timer);
  }
  function run() {
    if (done) return;
    cancel();
    fn();
  }
  return cancel;
}
