import { nextComposerHeight, COMPOSER_MAX_HEIGHT } from '../composer-height';

test('empty value has no explicit height override', () => {
  expect(nextComposerHeight(180, '')).toBeUndefined();
});

test('non-empty value under the max uses the measured content height', () => {
  expect(nextComposerHeight(60, 'hello')).toBe(60);
});

test('non-empty value over the max clamps to COMPOSER_MAX_HEIGHT', () => {
  const longText = 'a very long multi-line message '.repeat(10);
  expect(nextComposerHeight(400, longText)).toBe(COMPOSER_MAX_HEIGHT);
});

test('clearing after a tall message drops the override, not the last height', () => {
  const grown = nextComposerHeight(200, 'six lines of wrapped text that grew the input');
  expect(grown).toBe(COMPOSER_MAX_HEIGHT);
  const afterSend = nextComposerHeight(200, ''); // parent clears value; a stale content size may lag
  expect(afterSend).toBeUndefined();
});

test('a freshly mounted empty composer has no override regardless of a stray content size', () => {
  expect(nextComposerHeight(0, '')).toBeUndefined();
});
