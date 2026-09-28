// src/lib/composer-height.ts
//
// The composer's multiline TextInput auto-grows via onContentSizeChange, but
// on iOS it does not auto-shrink back to one line when the controlled `value`
// prop is cleared programmatically after a send — it keeps its last-grown
// height until the screen remounts (spec §8.2). nextComposerHeight() is the
// pure decision: an explicit style height, clamped to a max, or `undefined`
// (no override, so the TextInput sizes itself to one empty line naturally)
// once `value` is empty again.

/** Above this, the input scrolls internally instead of growing further. */
export const COMPOSER_MAX_HEIGHT = 120;

export function nextComposerHeight(contentHeight: number, value: string): number | undefined {
  if (value === '') return undefined;
  return Math.min(contentHeight, COMPOSER_MAX_HEIGHT);
}
