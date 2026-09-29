// src/lib/transcript-rows.ts — helpers over A's merged transcript rows. The merge itself is A's
// `mergeRequestRows` (src/lib/turn-controller.ts): cards live outside `items` (spec §6.0, review B1.3).
import type { TranscriptRow } from '@/lib/turn-controller';

/** Index of a request card in the newest-first rows the inverted FlatList renders, or -1. */
export function rowIndexOf<T>(rowsNewestFirst: TranscriptRow<T>[], cardId: string): number {
  return rowsNewestFirst.findIndex((r) => r.kind === 'request' && r.card.id === cardId);
}

/**
 * The chat screen's transcript items, current at mutation time. React commits state after the JS
 * turn, so a card anchored off a post-commit mirror landed above the tool row that asked for it
 * when both arrived in one turn (Plan A final review M5). Every mutation goes through `update`,
 * which applies it to the latest list, hands the result to `commit` (the state setter) and makes
 * it the anchor at once.
 */
export function createItemsMirror<T extends { key: string }>(commit: (next: T[]) => void) {
  let current: T[] = [];
  return {
    update(fn: (prev: T[]) => T[]): void {
      current = fn(current);
      commit(current);
    },
    /** Key of the last item — where a request card arriving now anchors — or null when empty. */
    anchorKey: (): string | null => current[current.length - 1]?.key ?? null,
  };
}
