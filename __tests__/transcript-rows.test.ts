import type { ChatItem } from '../src/components/message-row';
import { createItemsMirror, rowIndexOf } from '../src/lib/transcript-rows';
import { mergeRequestRows, type RequestCardState } from '../src/lib/turn-controller';

const item = (key: string): ChatItem => ({ key, role: 'assistant', text: key, complete: true });
const req = (id: string, anchorKey: string | null): RequestCardState => ({
  id, kind: 'approval', method: 'approval', params: {}, status: 'pending', legacy: false, receivedAt: 0, anchorKey,
});

test('rowIndexOf finds a card in the newest-first (inverted list) order', () => {
  const rows = mergeRequestRows([item('i0'), item('i1')], [req('a', 'i0')]).reverse();
  expect(rowIndexOf(rows, 'a')).toBe(1);
  expect(rowIndexOf(rows, 'zz')).toBe(-1);
});

test('an open card orphaned by a history replace is still findable (it sits at the newest end)', () => {
  const rows = mergeRequestRows([item('h0'), item('h1')], [req('a', 'gone')]).reverse();
  expect(rowIndexOf(rows, 'a')).toBe(0);
});

// Plan A final review M5 (Preflight F3): React commits state after the JS turn, so an anchor read
// from a post-commit mirror put a card that arrived with its tool.start ABOVE that tool row.
describe('createItemsMirror', () => {
  test('a card arriving in the same JS turn as tool.start anchors below the tool row', () => {
    const committed: ChatItem[][] = []; // React's commit is deferred: nothing is applied yet
    const mirror = createItemsMirror<ChatItem>((next) => committed.push(next));
    mirror.update((prev) => [...prev, item('i0')]);
    mirror.update((prev) => [...prev, { key: 'i1', role: 'tool', text: 'terminal' }]);
    expect(mirror.anchorKey()).toBe('i1');
    const rows = mergeRequestRows(committed[committed.length - 1], [req('a', mirror.anchorKey())]);
    expect(rows.map((r) => (r.kind === 'item' ? r.item.key : r.card.id))).toEqual(['i0', 'i1', 'a']);
  });

  test('several updates in one JS turn compose in order; the last commit is the final list', () => {
    const committed: ChatItem[][] = [];
    const mirror = createItemsMirror<ChatItem>((next) => committed.push(next));
    mirror.update((prev) => [...prev, { key: 'i0', role: 'assistant', text: 'he', complete: false }]);
    mirror.update((prev) => [...prev.slice(0, -1), { ...prev[prev.length - 1], text: 'hello' }]);
    mirror.update((prev) => [...prev.slice(0, -1), { ...prev[prev.length - 1], complete: true }]);
    mirror.update((prev) => [...prev, item('i1')]);
    expect(committed).toHaveLength(4);
    expect(committed[3]).toEqual([{ key: 'i0', role: 'assistant', text: 'hello', complete: true }, item('i1')]);
  });

  test('a replace (history load) resets the anchor; an empty list anchors to null', () => {
    const mirror = createItemsMirror<ChatItem>(() => {});
    expect(mirror.anchorKey()).toBeNull();
    mirror.update(() => [item('h0'), item('h1')]);
    expect(mirror.anchorKey()).toBe('h1');
    mirror.update(() => []);
    expect(mirror.anchorKey()).toBeNull();
  });
});
