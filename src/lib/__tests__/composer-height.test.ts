import { composerMinHeight } from '../composer-height';

test('the commit that clears the value leaves minHeight unset', () => {
  // The empty value has not been committed yet, so nothing flips on this commit.
  expect(composerMinHeight('', false)).toBeUndefined();
});

test('an empty value that has been committed (after a clear, or on mount) gets minHeight 0', () => {
  expect(composerMinHeight('', true)).toBe(0);
});

test('a clear and the commit after it produce different minHeights (the re-measure trigger)', () => {
  const onClear = composerMinHeight('', false);
  const afterSettle = composerMinHeight('', true);
  expect(afterSettle).not.toBe(onClear);
});

test('a non-empty value never sets minHeight, so native auto-grow is untouched', () => {
  expect(composerMinHeight('hello', false)).toBeUndefined();
  expect(composerMinHeight('six lines of wrapped text '.repeat(10), true)).toBeUndefined();
});
