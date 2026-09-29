import type { ChatItem } from '../src/components/message-row';
import { appendAfterStream, closeStreaming, createItemsMirror, offsetToReveal } from '../src/lib/transcript-rows';
import { mergeRequestRows, type RequestCardState } from '../src/lib/turn-controller';

const item = (key: string): ChatItem => ({ key, role: 'assistant', text: key, complete: true });
const req = (id: string, anchorKey: string | null): RequestCardState => ({
  id, kind: 'approval', method: 'approval', params: {}, status: 'pending', legacy: false, receivedAt: 0, anchorKey,
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

const streaming = (key: string, text: string): ChatItem => ({ key, role: 'assistant', text, complete: false });
const keysOf = (rows: ReturnType<typeof mergeRequestRows<ChatItem>>) =>
  rows.map((r) => (r.kind === 'item' ? r.item.key : r.card.id));

describe('closeStreaming', () => {
  test('completes a trailing streaming segment and drops a whitespace-only one', () => {
    expect(closeStreaming([item('i0'), streaming('i1', 'then')])).toEqual([item('i0'), { ...streaming('i1', 'then'), complete: true }]);
    expect(closeStreaming([item('i0'), streaming('i1', ' \n')])).toEqual([item('i0')]);
  });

  test('leaves a list with no trailing streaming segment unchanged', () => {
    const list = [item('i0'), { key: 'i1', role: 'tool' as const, text: 'terminal' }];
    expect(closeStreaming(list)).toBe(list);
  });
});

// Sim S1 §3c / S2 §5 (B1): a steer while text streams left the pre-steer segment complete:false for
// good (stuck caret, plain text) because the Steered bubble was appended after it without closing it.
test('B1: a steered bubble appended mid-stream closes the streaming segment first', () => {
  const steered: ChatItem = { key: 'i2', role: 'user', text: 'stop at 20', complete: true, steered: true };
  const next = appendAfterStream([item('i0'), streaming('i1', '67 Florence')], steered);
  expect(next).toEqual([item('i0'), { ...streaming('i1', '67 Florence'), complete: true }, steered]);
  expect(next.filter((it) => it.role === 'assistant' && !it.complete)).toHaveLength(0);
});

// Task 11 m1: the router samples anchorKey() before onNewCard's finishAssistant() drops a trailing
// whitespace-only segment, so a card anchored to that dropped row vanished once settled.
describe('createItemsMirror anchor with a settle step', () => {
  test('a trailing whitespace-only streaming segment is not an anchor: the card stays under the row before it', () => {
    const committed: ChatItem[][] = [];
    const mirror = createItemsMirror<ChatItem>((next) => committed.push(next), closeStreaming);
    mirror.update(() => [item('i0'), { key: 'i1', role: 'tool', text: 'terminal' }, streaming('i2', '\n')]);
    const anchor = mirror.anchorKey(); // sampled by the router when the request arrives…
    mirror.update(closeStreaming); // …then onNewCard closes the segment
    expect(anchor).toBe('i1');
    const settled = req('a', anchor);
    settled.status = 'answered';
    expect(keysOf(mergeRequestRows(committed[committed.length - 1], [settled]))).toEqual(['i0', 'i1', 'a']);
  });

  test('a streaming segment with text is still the anchor (it is completed, not dropped)', () => {
    const mirror = createItemsMirror<ChatItem>(() => {}, closeStreaming);
    mirror.update(() => [item('i0'), streaming('i1', 'Running it now.')]);
    expect(mirror.anchorKey()).toBe('i1');
  });
});

// Sim S2 §1 (B2): scrolling the CARD row put a focused field of a card taller than the band above the
// keyboard off-screen (a 3-question batch is 1140 pt; the band is ~430 pt). The field itself is revealed.
describe('offsetToReveal (inverted list: a larger offset moves the content down)', () => {
  const band = { visibleTop: 126, visibleBottom: 556, margin: 12 };

  test('a field pushed above the band by the keyboard comes down to just under its top', () => {
    // S2: Q1's "Other…" field at py −424 after the keyboard rose.
    expect(offsetToReveal({ ...band, offset: 0, fieldTop: -424, fieldBottom: -384 })).toBe(562);
  });

  test('a field below the band goes up to just above the keyboard', () => {
    // S2 viewPosition 1: Q3's field at py 965.
    expect(offsetToReveal({ ...band, offset: 562, fieldTop: 965, fieldBottom: 1005 })).toBe(101);
  });

  test('a field already inside the band needs no scroll', () => {
    expect(offsetToReveal({ ...band, offset: 40, fieldTop: 259, fieldBottom: 299 })).toBeNull();
    expect(offsetToReveal({ ...band, offset: 40, fieldTop: 138, fieldBottom: 544 })).toBeNull(); // margins exactly met
  });

  test('a field taller than the band shows its top', () => {
    expect(offsetToReveal({ ...band, offset: 400, fieldTop: 400, fieldBottom: 900 })).toBe(138); // top lands at 138
  });

  test('never scrolls past the newest end (offset 0)', () => {
    expect(offsetToReveal({ ...band, offset: 20, fieldTop: 600, fieldBottom: 640 })).toBe(0);
  });
});
