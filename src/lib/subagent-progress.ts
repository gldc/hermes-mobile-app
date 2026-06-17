// src/lib/subagent-progress.ts
export type SubagentStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'stopped';

export interface SubagentState {
  key: string;
  goal: string;
  taskIndex: number;
  taskCount: number;
  status: SubagentStatus;
  activity: string;
  toolCount: number;
  model?: string;
  startedAtMs: number;
  durationSeconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  filesRead?: string[];
  filesWritten?: string[];
  childSessionId?: string;
}

export interface SubagentBatch {
  subagents: SubagentState[];
  finalized: boolean;
}

export interface SubagentEvent {
  type: string;
  payload?: Record<string, unknown>;
}

const COMPLETE_STATUS: Record<string, SubagentStatus> = {
  completed: 'completed',
  failed: 'failed',
  timeout: 'timeout',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const strArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;

function keyOf(p: Record<string, unknown>): string {
  const id = p.subagent_id;
  if (typeof id === 'string' && id) return id;
  return `idx:${num(p.task_index) ?? 0}`;
}

export function emptyBatch(): SubagentBatch {
  return { subagents: [], finalized: false };
}

export function reduceSubagentEvent(
  batch: SubagentBatch,
  event: SubagentEvent,
  now: number,
): SubagentBatch {
  if (!event || typeof event.type !== 'string' || !event.type.startsWith('subagent.')) return batch;
  if (event.type === 'subagent.text') return batch; // never delivered to the parent
  const p = event.payload ?? {};
  const key = keyOf(p);
  const idx = batch.subagents.findIndex((s) => s.key === key);
  const existing = batch.subagents[idx];

  const next: SubagentState = existing
    ? { ...existing }
    : {
        key,
        goal: str(p.goal),
        taskIndex: num(p.task_index) ?? 0,
        taskCount: num(p.task_count) ?? 1,
        status: 'running',
        activity: '',
        toolCount: 0,
        startedAtMs: now,
      };

  if (str(p.goal)) next.goal = str(p.goal);
  if (num(p.task_count) !== undefined) next.taskCount = num(p.task_count)!;
  if (num(p.task_index) !== undefined) next.taskIndex = num(p.task_index)!;
  if (str(p.model)) next.model = str(p.model);
  if (num(p.tool_count) !== undefined) next.toolCount = num(p.tool_count)!;
  if (str(p.child_session_id)) next.childSessionId = str(p.child_session_id);

  switch (event.type) {
    case 'subagent.tool': {
      const tool = str(p.tool_name);
      const preview = str(p.tool_preview) || str(p.text);
      if (tool) next.activity = preview ? `${tool} · ${preview}` : tool;
      else if (preview) next.activity = preview;
      break;
    }
    case 'subagent.thinking': {
      const t = str(p.text);
      if (t) next.activity = t;
      break;
    }
    case 'subagent.progress':
      // Batch summary (gateway sends "🔀 [1] tool, tool, …"); toolCount conveys
      // throughput. Do NOT clobber the cleaner per-tool activity from subagent.tool.
      break;
    case 'subagent.complete': {
      next.status = COMPLETE_STATUS[str(p.status)] ?? 'completed';
      next.durationSeconds = num(p.duration_seconds);
      next.inputTokens = num(p.input_tokens);
      next.outputTokens = num(p.output_tokens);
      next.costUsd = num(p.cost_usd);
      next.filesRead = strArr(p.files_read);
      next.filesWritten = strArr(p.files_written);
      if (str(p.summary)) next.activity = str(p.summary);
      break;
    }
    default:
      break; // spawn_requested / start: row already exists/running
  }

  const subagents =
    idx >= 0 ? batch.subagents.map((s, i) => (i === idx ? next : s)) : [...batch.subagents, next];
  return { ...batch, subagents };
}

export function batchAllDone(batch: SubagentBatch): boolean {
  return batch.subagents.length > 0 && batch.subagents.every((s) => s.status !== 'running');
}

export function finalizeBatch(batch: SubagentBatch): SubagentBatch {
  return {
    finalized: true,
    subagents: batch.subagents.map((s) =>
      s.status === 'running' ? { ...s, status: 'stopped' as const } : s,
    ),
  };
}
