// src/lib/__tests__/subagent-progress.test.ts
import {
  emptyBatch,
  reduceSubagentEvent,
  finalizeBatch,
  batchAllDone,
} from '../subagent-progress';

const ev = (type: string, payload: Record<string, unknown>) => ({ type, payload });

test('start → tool → complete tracks one subagent with rollup', () => {
  let b = emptyBatch();
  b = reduceSubagentEvent(b, ev('subagent.start', { subagent_id: 'a', goal: 'Research', task_index: 0, task_count: 1 }), 1000);
  expect(b.subagents).toHaveLength(1);
  expect(b.subagents[0]).toMatchObject({ key: 'a', goal: 'Research', status: 'running', startedAtMs: 1000 });
  b = reduceSubagentEvent(b, ev('subagent.tool', { subagent_id: 'a', tool_name: 'web_search', tool_preview: 'auth libs', tool_count: 3 }), 1100);
  expect(b.subagents[0].toolCount).toBe(3);
  expect(b.subagents[0].activity).toContain('web_search');
  b = reduceSubagentEvent(b, ev('subagent.complete', { subagent_id: 'a', status: 'completed', duration_seconds: 41, input_tokens: 12000, cost_usd: 0.04 }), 5000);
  expect(b.subagents[0]).toMatchObject({ status: 'completed', durationSeconds: 41, inputTokens: 12000, costUsd: 0.04 });
  expect(batchAllDone(b)).toBe(true);
});

test('parallel subagents tracked separately; updates preserve order + isolation', () => {
  let b = emptyBatch();
  b = reduceSubagentEvent(b, ev('subagent.start', { subagent_id: 'a', goal: 'A', task_index: 0, task_count: 2 }), 0);
  b = reduceSubagentEvent(b, ev('subagent.start', { subagent_id: 'b', goal: 'B', task_index: 1, task_count: 2 }), 0);
  expect(b.subagents.map((s) => s.key)).toEqual(['a', 'b']);
  expect(batchAllDone(b)).toBe(false);
  // An update to 'b' must not reorder the list nor touch 'a'.
  b = reduceSubagentEvent(b, ev('subagent.tool', { subagent_id: 'b', tool_name: 'read' }), 1);
  expect(b.subagents.map((s) => s.key)).toEqual(['a', 'b']);
  expect(b.subagents[0].activity).toBe('');
  expect(b.subagents[1].activity).toContain('read');
});

test('falls back to task_index key when subagent_id absent', () => {
  let b = emptyBatch();
  b = reduceSubagentEvent(b, ev('subagent.start', { goal: 'X', task_index: 2, task_count: 3 }), 0);
  b = reduceSubagentEvent(b, ev('subagent.tool', { task_index: 2, tool_name: 'read' }), 1);
  expect(b.subagents).toHaveLength(1);
  expect(b.subagents[0].key).toBe('idx:2');
  expect(b.subagents[0].activity).toContain('read');
});

test('complete without prior start creates the row', () => {
  let b = emptyBatch();
  b = reduceSubagentEvent(b, ev('subagent.complete', { subagent_id: 'z', goal: 'late', status: 'failed' }), 0);
  expect(b.subagents).toHaveLength(1);
  expect(b.subagents[0]).toMatchObject({ key: 'z', status: 'failed' });
});

test('duplicate events are idempotent; startedAtMs set once', () => {
  let b = emptyBatch();
  const e = ev('subagent.start', { subagent_id: 'a', goal: 'A', task_index: 0, task_count: 1 });
  b = reduceSubagentEvent(b, e, 0);
  b = reduceSubagentEvent(b, e, 50);
  expect(b.subagents).toHaveLength(1);
  expect(b.subagents[0].startedAtMs).toBe(0);
});

test('non-subagent events and subagent.text are ignored', () => {
  let b = emptyBatch();
  b = reduceSubagentEvent(b, ev('tool.start', { name: 'x' }), 0);
  b = reduceSubagentEvent(b, ev('subagent.text', { subagent_id: 'a', text: 'tok' }), 0);
  expect(b.subagents).toHaveLength(0);
});

test('thinking sets activity; progress does not clobber tool activity', () => {
  let b = emptyBatch();
  b = reduceSubagentEvent(b, ev('subagent.start', { subagent_id: 'a', goal: 'A', task_index: 0, task_count: 1 }), 0);
  b = reduceSubagentEvent(b, ev('subagent.thinking', { subagent_id: 'a', text: 'planning approach' }), 1);
  expect(b.subagents[0].activity).toBe('planning approach');
  b = reduceSubagentEvent(b, ev('subagent.tool', { subagent_id: 'a', tool_name: 'web_search', tool_preview: 'auth' }), 2);
  expect(b.subagents[0].activity).toContain('web_search');
  b = reduceSubagentEvent(b, ev('subagent.progress', { subagent_id: 'a', text: '🔀 [1] web_search, read, edit' }), 3);
  expect(b.subagents[0].activity).toContain('web_search'); // not clobbered by the batch summary
  expect(b.subagents[0].activity).not.toContain('🔀');
});

test('subagent.tool falls back to text when tool_preview is absent', () => {
  let b = emptyBatch();
  b = reduceSubagentEvent(b, ev('subagent.start', { subagent_id: 'a', goal: 'A', task_index: 0, task_count: 1 }), 0);
  b = reduceSubagentEvent(b, ev('subagent.tool', { subagent_id: 'a', tool_name: 'bash', text: 'ls -la' }), 1);
  expect(b.subagents[0].activity).toContain('bash');
  expect(b.subagents[0].activity).toContain('ls -la');
});

test('maps timeout status', () => {
  let b = emptyBatch();
  b = reduceSubagentEvent(b, ev('subagent.complete', { subagent_id: 'a', status: 'timeout' }), 0);
  expect(b.subagents[0].status).toBe('timeout');
});

test('unknown or missing complete status falls back to completed', () => {
  const unknown = reduceSubagentEvent(emptyBatch(), ev('subagent.complete', { subagent_id: 'a', status: 'weird' }), 0);
  expect(unknown.subagents[0].status).toBe('completed');
  const missing = reduceSubagentEvent(emptyBatch(), ev('subagent.complete', { subagent_id: 'b' }), 0);
  expect(missing.subagents[0].status).toBe('completed');
});

test('batchAllDone is false for an empty batch', () => {
  expect(batchAllDone(emptyBatch())).toBe(false);
});

test('finalizeBatch stops only running subagents, leaves finished ones', () => {
  let b = emptyBatch();
  b = reduceSubagentEvent(b, ev('subagent.start', { subagent_id: 'a', goal: 'A', task_index: 0, task_count: 2 }), 0);
  b = reduceSubagentEvent(b, ev('subagent.start', { subagent_id: 'b', goal: 'B', task_index: 1, task_count: 2 }), 0);
  b = reduceSubagentEvent(b, ev('subagent.complete', { subagent_id: 'b', status: 'completed' }), 1);
  b = finalizeBatch(b);
  expect(b.finalized).toBe(true);
  expect(b.subagents[0].status).toBe('stopped'); // 'a' was running
  expect(b.subagents[1].status).toBe('completed'); // 'b' unchanged
});
