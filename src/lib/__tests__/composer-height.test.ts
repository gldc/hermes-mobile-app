import { composerMinHeight, valueSetFromJs } from '../composer-height';

test('a JS-driven clear is a JS set (the value was never emitted by onChangeText)', () => {
  expect(valueSetFromJs('', 'six lines of text')).toBe(true);
});

test('a JS-driven non-empty set (a failed steer restore) is a JS set', () => {
  expect(valueSetFromJs('use tabs\nand spaces', '')).toBe(true);
  // The emitted text is consumed per commit, so restoring text that was typed earlier still counts.
  expect(valueSetFromJs('use tabs', null)).toBe(true);
});

test('a typed value echoed back by the parent is not a JS set', () => {
  expect(valueSetFromJs('use tabs', 'use tabs')).toBe(false);
  expect(valueSetFromJs('', '')).toBe(false); // typed all the way back to empty
});

test('the follow-up flip always changes minHeight, and never to a constraint', () => {
  expect(composerMinHeight(true)).not.toBe(composerMinHeight(false));
  // Rewritten from C's "a non-empty value never sets minHeight": the non-empty restore needs the
  // same flip as a clear, so a non-empty value may carry minHeight 0 — still layout-neutral, so
  // native auto-grow is untouched.
  expect(new Set([composerMinHeight(true), composerMinHeight(false)])).toEqual(new Set([0, undefined]));
});
