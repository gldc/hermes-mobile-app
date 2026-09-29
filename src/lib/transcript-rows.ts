// src/lib/transcript-rows.ts — helpers over A's merged transcript rows. The merge itself is A's
// `mergeRequestRows` (src/lib/turn-controller.ts): cards live outside `items` (spec §6.0, review B1.3).
import type { TranscriptRow } from '@/lib/turn-controller';

/** Index of a request card in the newest-first rows the inverted FlatList renders, or -1. */
export function rowIndexOf<T>(rowsNewestFirst: TranscriptRow<T>[], cardId: string): number {
  return rowsNewestFirst.findIndex((r) => r.kind === 'request' && r.card.id === cardId);
}

/** A transcript item as far as streaming goes: an assistant segment is open while `complete` is false. */
type StreamItem = { role: string; text: string; complete?: boolean };

/** Close the trailing streaming segment: complete it, or drop it if it holds only whitespace
 *  (prevents stranded carets around tool calls). A list without one is returned as is. */
export function closeStreaming<T extends StreamItem>(items: T[]): T[] {
  const last = items[items.length - 1];
  if (last?.role !== 'assistant' || last.complete) return items;
  if (!last.text.trim()) return items.slice(0, -1);
  return [...items.slice(0, -1), { ...last, complete: true }];
}

/** Append a row the user caused mid-turn (a steer): the text streamed so far stays above it, closed,
 *  and later deltas open a new segment below it (sim S1 §3c, B1). */
export function appendAfterStream<T extends StreamItem>(items: T[], row: T): T[] {
  return [...closeStreaming(items), row];
}

/**
 * The chat screen's transcript items, current at mutation time. React commits state after the JS
 * turn, so a card anchored off a post-commit mirror landed above the tool row that asked for it
 * when both arrived in one turn (Plan A final review M5). Every mutation goes through `update`,
 * which applies it to the latest list, hands the result to `commit` (the state setter) and makes
 * it the anchor at once. `settle` is what a card's arrival does to the list (the screen closes the
 * streaming segment): the anchor is read through it, so a card never anchors to a whitespace-only
 * segment that its own arrival drops (Task 11 m1) — such a card would vanish once settled.
 */
export function createItemsMirror<T extends { key: string }>(
  commit: (next: T[]) => void,
  settle: (items: T[]) => T[] = (items) => items,
) {
  let current: T[] = [];
  return {
    update(fn: (prev: T[]) => T[]): void {
      current = fn(current);
      commit(current);
    },
    /** Key of the last item — where a request card arriving now anchors — or null when empty. */
    anchorKey: (): string | null => {
      const settled = settle(current);
      return settled[settled.length - 1]?.key ?? null;
    },
  };
}
