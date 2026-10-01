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

/** Append the "Stopped" marker of a turn that ended interrupted, unless the transcript already ends
 *  with one: a history reload draws the marker from the gateway's stored closing row, and that
 *  turn's message.complete can still arrive live afterwards. */
export function appendStoppedMarker<T extends { marker?: string }>(items: T[], marker: T): T[] {
  return items[items.length - 1]?.marker === 'stopped' ? items : [...items, marker];
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
    /** The latest list (not yet committed to React state). */
    items: (): readonly T[] => current,
  };
}

/** Card id → the anchor the screen draws it under instead of its own `anchorKey` (Plan B final review I1). */
export type CardAnchors = Readonly<Record<string, string>>;

const isOpen = (c: RequestCardState) => c.status === 'pending' || c.status === 'answering';

/** At a history replace: ids of the OPEN cards whose effective anchor (override ?? card.anchorKey) is
 *  null or no longer in `items`. */
export function cardsLosingAnchor(
  requests: readonly RequestCardState[],
  anchors: CardAnchors,
  items: readonly { key: string }[],
): string[] {
  const keys = new Set(items.map((i) => i.key));
  return requests
    .filter((card) => {
      const current = anchors[card.id] ?? card.anchorKey;
      return isOpen(card) && (current === null || !keys.has(current));
    })
    .map((card) => card.id);
}

/**
 * The overrides after a replace or a replay: every card in `pin` that is still in the store moves under
 * `target(card)` (by default the last item; none when that is null), an override whose anchor is still
 * in `items` is kept, and everything else drops (cards gone from the store, dead anchors).
 */
export function pinCards(
  requests: readonly RequestCardState[],
  anchors: CardAnchors,
  items: readonly { key: string }[],
  pin: readonly string[],
  target: (card: RequestCardState) => string | null = () => items[items.length - 1]?.key ?? null,
): Record<string, string> {
  const keys = new Set(items.map((i) => i.key));
  const next: Record<string, string> = {};
  for (const card of requests) {
    const to = pin.includes(card.id) ? target(card) : null;
    if (to !== null) next[card.id] = to;
    else if (!pin.includes(card.id) && anchors[card.id] !== undefined && keys.has(anchors[card.id])) {
      next[card.id] = anchors[card.id];
    }
  }
  return next;
}

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
  return pinCards(requests, anchors, items, cardsLosingAnchor(requests, anchors, items));
}

/** A transcript row as far as finding a card's requester goes. */
type PinItem = { key: string; tool?: { name: string; running: boolean } };

/**
 * When the screen pins request cards across a reconnect (D1, QA 2026-09-29 item 6). The reconnect
 * sequence reloads history and then replays the running turn, so the tool row that asked for a card
 * is appended AFTER the reload: pinning at the reload put the card above it. Instead the reload only
 * records the open cards it orphaned (drawn at the tail meanwhile, by `mergeRequestRows`), and the end
 * of the sequence (ready, failed, or a rejected `start()`) pins each one under its requester row:
 * the last `clarify` tool row for a clarify card (a running one if any), else the last running tool
 * row, else where it is (a live anchor) or the settled last row — today's behaviour. Only rows
 * appended since the last reload (and after the card's own live anchor) are candidates, so a card is
 * never pulled up to a tool row of an earlier turn. Every recorded card is pinned whatever its status,
 * so one that settled inside the window is still drawn (Plan B I1). Records union across reloads and
 * attempts until the sequence ends.
 */
export function createCardPinner() {
  const pending = new Set<string>();
  let running = false;
  let replaced = false;
  let floorKey: string | null = null; // last row of the latest reload

  function requesterRow(card: RequestCardState, items: readonly PinItem[], settledAnchor: string | null): string | null {
    const indexAfter = (key: string) => {
      const at = items.findIndex((i) => i.key === key);
      return at < 0 ? -1 : at + 1;
    };
    // Candidates start after the latest reload's last row and after the card's own live anchor. A dead
    // anchor with no reload in this sequence says nothing about where new rows begin: no candidates.
    const afterAnchor = card.anchorKey === null ? 0 : indexAfter(card.anchorKey);
    let start = afterAnchor < 0 ? (replaced ? 0 : items.length) : afterAnchor;
    if (replaced && floorKey !== null) {
      const afterFloor = indexAfter(floorKey);
      start = Math.max(start, afterFloor < 0 ? items.length : afterFloor);
    }
    const newest = items.slice(start).filter((i) => i.tool).reverse();
    const clarify = card.kind === 'clarify' ? newest.filter((i) => i.tool!.name === 'clarify') : [];
    const requester = clarify.find((i) => i.tool!.running) ?? clarify[0] ?? newest.find((i) => i.tool!.running);
    if (requester) return requester.key;
    return afterAnchor > 0 ? card.anchorKey : settledAnchor;
  }

  return {
    /** A reconnect attempt (or `start()`) began. */
    sequenceStarted(): void {
      running = true;
    },
    inSequence: (): boolean => running,
    /** A history replace: record the open cards whose anchor the reload removed; returns the overrides
     *  to keep (dead and gone ones dropped, nothing pinned yet). */
    onHistoryReplace(
      requests: readonly RequestCardState[],
      anchors: CardAnchors,
      items: readonly { key: string }[],
    ): Record<string, string> {
      for (const id of cardsLosingAnchor(requests, anchors, items)) pending.add(id);
      replaced = true;
      floorKey = items[items.length - 1]?.key ?? null;
      return pinCards(requests, anchors, items, []);
    },
    /** A card was first delivered while a sequence was in flight (review finding 5): record it. */
    onCardCreatedDuringSequence(id: string): void {
      pending.add(id);
    },
    /** The sequence ended: pin every recorded card still in the store under its requester row, clear
     *  the record, and return the new overrides — or null when nothing was recorded. `settledAnchor`
     *  is the items mirror's `anchorKey()` (read through `closeStreaming`, review finding 7). */
    onSequenceEnd(
      requests: readonly RequestCardState[],
      items: readonly PinItem[],
      settledAnchor: string | null,
    ): Record<string, string> | null {
      const ids = [...pending];
      const pins = ids.length ? pinCards(requests, {}, items, ids, (card) => requesterRow(card, items, settledAnchor)) : null;
      pending.clear();
      running = false;
      replaced = false;
      floorKey = null;
      return pins;
    },
  };
}

/** The cards as the transcript merge should place them: overridden anchors applied. The same list
 *  comes back when no override applies. */
export function withCardAnchors(requests: RequestCardState[], anchors: CardAnchors): RequestCardState[] {
  if (!requests.some((c) => anchors[c.id] !== undefined)) return requests;
  return requests.map((c) => (anchors[c.id] !== undefined ? { ...c, anchorKey: anchors[c.id] } : c));
}
