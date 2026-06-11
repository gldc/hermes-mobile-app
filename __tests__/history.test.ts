// __tests__/history.test.ts
import type { SessionMessage } from '../src/api/types';
import { historyToItems } from '../src/lib/history';

function keyer() {
  let i = 0;
  return () => `k${i++}`;
}

const msg = (m: Partial<SessionMessage>): SessionMessage =>
  ({ role: 'user', timestamp: 0, ...m }) as SessionMessage;

describe('historyToItems', () => {
  it('maps user and assistant rows to complete text items', () => {
    const items = historyToItems(
      [msg({ role: 'user', content: 'hi' }), msg({ role: 'assistant', content: 'hello!' })],
      keyer(),
    );
    expect(items).toEqual([
      { key: 'k0', role: 'user', text: 'hi', complete: true },
      { key: 'k1', role: 'assistant', text: 'hello!', complete: true },
    ]);
  });

  it('drops empty user/assistant rows (e.g. assistant rows that only carry tool_calls)', () => {
    const items = historyToItems(
      [
        msg({ role: 'assistant', content: '' }),
        msg({ role: 'assistant', content: null }),
        msg({ role: 'user', content: '  \n ' }),
        msg({ role: 'user', content: 'real' }),
      ],
      keyer(),
    );
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('real');
  });

  it('maps role=tool rows into completed ToolInfo cards', () => {
    const items = historyToItems(
      [
        msg({
          role: 'tool',
          tool_name: 'write_file',
          tool_call_id: 'call_39533c19b0624626ba271be6',
          content: '{"bytes_written": 5763, "dirs_created": true}',
        }),
      ],
      keyer(),
    );
    expect(items).toHaveLength(1);
    const it0 = items[0];
    expect(it0.role).toBe('tool');
    expect(it0.text).toBe('write_file');
    expect(it0.tool).toEqual({
      id: 'call_39533c19b0624626ba271be6',
      name: 'write_file',
      running: false,
      detail: '{"bytes_written": 5763, "dirs_created": true}',
    });
  });

  it('keeps tool cards whose result is empty (name-only card, no detail)', () => {
    const items = historyToItems(
      [msg({ role: 'tool', tool_name: 'skill_view', tool_call_id: 'c1', content: '' })],
      keyer(),
    );
    expect(items).toHaveLength(1);
    expect(items[0].tool).toEqual({ id: 'c1', name: 'skill_view', running: false });
  });

  it('drops tool rows with neither a name nor content', () => {
    expect(
      historyToItems([msg({ role: 'tool', tool_name: null, content: '' })], keyer()),
    ).toEqual([]);
  });

  it('falls back to the item key when tool_call_id is missing', () => {
    const items = historyToItems(
      [msg({ role: 'tool', tool_name: 'bash', tool_call_id: null, content: 'ok' })],
      keyer(),
    );
    expect(items[0].tool!.id).toBe(items[0].key);
  });

  it('truncates oversized tool results to 4000 chars', () => {
    const items = historyToItems(
      [msg({ role: 'tool', tool_name: 't', content: 'x'.repeat(5000) })],
      keyer(),
    );
    expect(items[0].tool!.detail).toHaveLength(4000);
  });

  it('skips system rows and preserves interleaved order', () => {
    const items = historyToItems(
      [
        msg({ role: 'system', content: 'you are hermes' }),
        msg({ role: 'user', content: 'do it' }),
        msg({ role: 'assistant', content: null }),
        msg({ role: 'tool', tool_name: 'bash', tool_call_id: 'c1', content: 'done' }),
        msg({ role: 'assistant', content: 'All done.' }),
      ],
      keyer(),
    );
    expect(items.map((i) => i.role)).toEqual(['user', 'tool', 'assistant']);
  });

  it('extracts text from structured parts content via messageText', () => {
    const items = historyToItems(
      [msg({ role: 'assistant', content: [{ type: 'text', text: 'part' }] })],
      keyer(),
    );
    expect(items[0].text).toBe('part');
  });
});
