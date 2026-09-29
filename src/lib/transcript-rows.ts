// src/lib/transcript-rows.ts — helpers for the chat screen's transcript. The merge with request cards
// is A's `mergeRequestRows` (src/lib/turn-controller.ts): cards live outside `items` (spec §6.0, review B1.3).
import type { RequestCardState } from './turn-controller';

/**
 * The inverted chat list's scroll offset that brings a focused card field inside the visible band
 * (under the floating header, above the composer and keyboard), or null when it is already there.
 * All y values are window coordinates measured at scroll time. In the inverted list a larger offset
 * moves the content DOWN. A field below the band is aligned to its bottom; one above it, or taller
 * than it, to its top. Never past the newest end (offset 0). Sim S2 §1 (B2): a card taller than the
 * band hid its focused field whichever edge of the CARD was aligned.
 */
export function offsetToReveal(p: {
  offset: number;
  fieldTop: number;
  fieldBottom: number;
  visibleTop: number;
  visibleBottom: number;
  margin?: number;
}): number | null {
  const margin = p.margin ?? 12;
  const top = p.visibleTop + margin;
  const bottom = p.visibleBottom - margin;
  let shiftUp: number;
  if (p.fieldTop < top || p.fieldBottom - p.fieldTop > bottom - top) shiftUp = p.fieldTop - top;
  else if (p.fieldBottom > bottom) shiftUp = p.fieldBottom - bottom;
  else return null;
  const next = Math.max(0, p.offset - shiftUp);
  return next === p.offset ? null : next;
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

/** Card id → the anchor the screen draws it under instead of its own `anchorKey` (Plan B final review I1). */
export type CardAnchors = Readonly<Record<string, string>>;

const isOpen = (c: RequestCardState) => c.status === 'pending' || c.status === 'answering';

/**
 * The card anchors after a history replace (each reconnect reloads, and the reload re-keys every row).
 * A card that is OPEN now and whose anchor is gone (or that arrived before any row, anchorKey null —
 * final review m4) moves under the new last row, so it stays there once it settles: the reloaded
 * history cannot reflect an answer given after it. A card already settled keeps no override and is
 * not redrawn — the history reflects it (contract §8). Overrides of cards gone from the store drop.
 */
export function reanchorAfterReplace(
  requests: readonly RequestCardState[],
  anchors: CardAnchors,
  items: readonly { key: string }[],
): Record<string, string> {
  const keys = new Set(items.map((i) => i.key));
  const last = items[items.length - 1]?.key ?? null;
  const next: Record<string, string> = {};
  for (const card of requests) {
    const current = anchors[card.id] ?? card.anchorKey;
    if (current !== null && keys.has(current)) {
      if (anchors[card.id] !== undefined) next[card.id] = current;
    } else if (isOpen(card) && last !== null) {
      next[card.id] = last;
    }
  }
  return next;
}

/** The cards as the transcript merge should place them: overridden anchors applied. The same list
 *  comes back when no override applies. */
export function withCardAnchors(requests: RequestCardState[], anchors: CardAnchors): RequestCardState[] {
  if (!requests.some((c) => anchors[c.id] !== undefined)) return requests;
  return requests.map((c) => (anchors[c.id] !== undefined ? { ...c, anchorKey: anchors[c.id] } : c));
}
