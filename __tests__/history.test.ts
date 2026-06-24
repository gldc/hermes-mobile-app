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

  it('restores tool-call context by merging assistant tool_calls into the result card', () => {
    const items = historyToItems(
      [
        msg({
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', function: { name: 'write_file', arguments: '{"path":"/a/b.txt"}' } }],
        }),
        msg({ role: 'tool', tool_name: 'write_file', tool_call_id: 'c1', content: '{"bytes_written":3}' }),
      ],
      keyer(),
    );
    // The invocation-only assistant row does not render; only the tool card.
    expect(items).toHaveLength(1);
    expect(items[0].tool).toEqual({
      id: 'c1',
      name: 'write_file',
      running: false,
      context: '/a/b.txt',
      detail: '{"bytes_written":3}',
    });
  });

  it('joins on call_id when id is absent', () => {
    const items = historyToItems(
      [
        msg({ role: 'assistant', content: '', tool_calls: [{ call_id: 'c2', function: { name: 'terminal', arguments: '{"command":"ls"}' } }] }),
        msg({ role: 'tool', tool_name: 'terminal', tool_call_id: 'c2', content: 'a b c' }),
      ],
      keyer(),
    );
    expect(items[0].tool!.context).toBe('ls');
  });

  it('keeps the tool card at the result-row position (not the invocation row)', () => {
    const items = historyToItems(
      [
        msg({ role: 'assistant', content: '', tool_calls: [{ id: 'c3', function: { name: 'read_file', arguments: '{"path":"/x"}' } }] }),
        msg({ role: 'assistant', content: 'thinking out loud' }),
        msg({ role: 'tool', tool_name: 'read_file', tool_call_id: 'c3', content: 'data' }),
      ],
      keyer(),
    );
    expect(items.map((i) => i.role)).toEqual(['assistant', 'tool']);
    expect(items[1].tool!.context).toBe('/x');
  });

  it('does not throw on non-array or malformed tool_calls', () => {
    const items = historyToItems(
      [
        msg({ role: 'assistant', content: '', tool_calls: 'oops' as any }),
        msg({ role: 'assistant', content: '', tool_calls: [{ id: 'c4', function: { name: 'terminal', arguments: 'not json' } }] }),
        msg({ role: 'tool', tool_name: 'terminal', tool_call_id: 'c4', content: 'ok' }),
      ],
      keyer(),
    );
    // Malformed args → card renders with no context, never throws.
    expect(items).toHaveLength(1);
    expect(items[0].tool!.name).toBe('terminal');
    expect(items[0].tool!.context).toBeUndefined();
  });

  it('renders an orphan tool result (no invocation) unchanged', () => {
    const items = historyToItems(
      [msg({ role: 'tool', tool_name: 'write_file', tool_call_id: 'zzz', content: 'r' })],
      keyer(),
    );
    expect(items[0].tool).toEqual({ id: 'zzz', name: 'write_file', running: false, detail: 'r' });
  });
});
