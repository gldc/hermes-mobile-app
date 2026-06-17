# Subagent Progress Monitoring (#9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render live subagent (delegated task) progress and the agent's todo checklist in the chat stream.

**Architecture:** Pure client-side. Two new `src/lib` reducers (pure, unit-tested) convert gateway events into view state; two new card components render them; the chat screen wires the dropped events into new `ChatItem` roles. No gateway change — the `subagent.*` stream and todo `tool.complete.todos` already reach the app socket.

**Tech Stack:** Expo SDK 56, React Native 0.85, TypeScript, Jest, expo-router. Conventions: `useTheme()` colors only, SF Symbols via `@/components/icon`, `borderCurve:'continuous'`, React Compiler (no manual memo), `LayoutAnimation` for expand.

**Verified wire contracts (do not re-derive):**
- `subagent.*` events on the parent sid: always `{goal, task_count, task_index}`; optional `subagent_id, parent_id, child_session_id, depth, model, tool_count, toolsets`; `subagent.tool` adds `tool_name`, `tool_preview`/`text`; `subagent.thinking`/`subagent.progress` add `text`; `subagent.complete` adds `status` (`completed`/`failed`/`timeout`), `summary`, `duration_seconds`, `input_tokens`, `output_tokens`, `cost_usd?`, `files_read[]`, `files_written[]`. `subagent.text` is **not** delivered to the parent.
- Todo: the list arrives on **`tool.complete`** where `payload.name === 'todo'`, as **`payload.todos: [{id, content, status}]`** (gateway-extracted full current list; replace/merge already applied server-side). `tool.start` carries no structured todos. `status ∈ pending|in_progress|completed|cancelled`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/subagent-progress.ts` (NEW) | Pure reducer `reduceSubagentEvent` + `emptyBatch`/`finalizeBatch`/`batchAllDone` over a `SubagentBatch`. |
| `src/lib/__tests__/subagent-progress.test.ts` (NEW) | Reducer unit tests. |
| `src/lib/todo.ts` (NEW) | Pure `parseTodoList(payload)` → `TodoItem[] | null`. |
| `src/lib/__tests__/todo.test.ts` (NEW) | Parser unit tests. |
| `src/components/todo-card.tsx` (NEW) | Renders a `TodoItem[]` checklist. |
| `src/components/subagent-monitor-card.tsx` (NEW) | Renders a `SubagentBatch`; self-ticking elapsed while running. |
| `src/components/message-row.tsx` (MODIFY) | Extend `ChatItem` role union + fields; render `null` for the new roles. |
| `src/app/chat/[id].tsx` (MODIFY) | Handle `subagent.*` + todo `tool.complete`; suppress generic todo card; finalize on turn end; render dispatch. |
| `src/api/types.ts` (MODIFY) | Add `subagent.*` to `GatewayEventType`. |

---

## Task 1: Subagent reducer (`src/lib/subagent-progress.ts`)

**Files:**
- Create: `src/lib/subagent-progress.ts`
- Test: `src/lib/__tests__/subagent-progress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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

test('parallel subagents tracked separately, in task order', () => {
  let b = emptyBatch();
  b = reduceSubagentEvent(b, ev('subagent.start', { subagent_id: 'a', goal: 'A', task_index: 0, task_count: 2 }), 0);
  b = reduceSubagentEvent(b, ev('subagent.start', { subagent_id: 'b', goal: 'B', task_index: 1, task_count: 2 }), 0);
  expect(b.subagents.map((s) => s.key)).toEqual(['a', 'b']);
  expect(batchAllDone(b)).toBe(false);
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

test('finalizeBatch stops running subagents and marks finalized', () => {
  let b = emptyBatch();
  b = reduceSubagentEvent(b, ev('subagent.start', { subagent_id: 'a', goal: 'A', task_index: 0, task_count: 1 }), 0);
  b = finalizeBatch(b);
  expect(b.finalized).toBe(true);
  expect(b.subagents[0].status).toBe('stopped');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/subagent-progress.test.ts`
Expected: FAIL — "Cannot find module '../subagent-progress'".

- [ ] **Step 3: Write minimal implementation**

```ts
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
    case 'subagent.thinking':
    case 'subagent.progress': {
      const t = str(p.text);
      if (t) next.activity = t;
      break;
    }
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/__tests__/subagent-progress.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/subagent-progress.ts src/lib/__tests__/subagent-progress.test.ts
git commit -m "feat(#9): subagent progress reducer with unit tests"
```

---

## Task 2: Todo parser (`src/lib/todo.ts`)

**Files:**
- Create: `src/lib/todo.ts`
- Test: `src/lib/__tests__/todo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/todo.test.ts
import { parseTodoList } from '../todo';

test('returns null when there is no todos array', () => {
  expect(parseTodoList({})).toBeNull();
  expect(parseTodoList({ todos: 'nope' as unknown })).toBeNull();
  expect(parseTodoList(undefined)).toBeNull();
});

test('parses items and preserves order', () => {
  const out = parseTodoList({
    todos: [
      { id: '1', content: 'first', status: 'completed' },
      { id: '2', content: 'second', status: 'in_progress' },
    ],
  });
  expect(out).toEqual([
    { id: '1', content: 'first', status: 'completed' },
    { id: '2', content: 'second', status: 'in_progress' },
  ]);
});

test('coerces unknown/missing status to pending', () => {
  const out = parseTodoList({ todos: [{ id: '1', content: 'x', status: 'bogus' }, { id: '2', content: 'y' }] });
  expect(out!.map((t) => t.status)).toEqual(['pending', 'pending']);
});

test('drops malformed entries (no string content)', () => {
  const out = parseTodoList({ todos: [{ id: '1' }, null, 5, { id: '2', content: 'ok', status: 'pending' }] });
  expect(out).toEqual([{ id: '2', content: 'ok', status: 'pending' }]);
});

test('empty array returns empty list, not null', () => {
  expect(parseTodoList({ todos: [] })).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/todo.test.ts`
Expected: FAIL — "Cannot find module '../todo'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/todo.ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

const VALID = new Set<TodoStatus>(['pending', 'in_progress', 'completed', 'cancelled']);

/** Read the full todo list from a `todo` tool.complete payload (gateway already
 * applied replace/merge). Returns null when there is no todos array. */
export function parseTodoList(payload: { todos?: unknown } | null | undefined): TodoItem[] | null {
  const todos = payload?.todos;
  if (!Array.isArray(todos)) return null;
  const out: TodoItem[] = [];
  for (const raw of todos) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.content !== 'string') continue;
    const status =
      typeof r.status === 'string' && VALID.has(r.status as TodoStatus)
        ? (r.status as TodoStatus)
        : 'pending';
    out.push({ id: typeof r.id === 'string' ? r.id : String(out.length), content: r.content, status });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/__tests__/todo.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/todo.ts src/lib/__tests__/todo.test.ts
git commit -m "feat(#9): todo list parser with unit tests"
```

---

## Task 3: TodoCard component (`src/components/todo-card.tsx`)

**Files:**
- Create: `src/components/todo-card.tsx`

No unit test (component glue, verified on-device per AGENTS.md). It must `npx tsc --noEmit` clean.

- [ ] **Step 1: Write the component**

```tsx
// src/components/todo-card.tsx
import { Text, View } from 'react-native';
import { Icon } from '@/components/icon';
import type { TodoItem } from '@/lib/todo';
import { useTheme } from '@/theme';

type Colors = ReturnType<typeof useTheme>['colors'];

function TodoGlyph({ status, colors }: { status: TodoItem['status']; colors: Colors }) {
  if (status === 'completed') {
    return (
      <View style={{ paddingTop: 1 }}>
        <Icon sf="checkmark.circle.fill" size={14} color={colors.success} />
      </View>
    );
  }
  const ring = { width: 13, height: 13, borderRadius: 7, borderCurve: 'continuous' as const, marginTop: 3 };
  if (status === 'in_progress') return <View style={[ring, { borderWidth: 3.5, borderColor: colors.accent }]} />;
  if (status === 'cancelled') return <View style={[ring, { borderWidth: 1.5, borderColor: colors.textFaint }]} />;
  return <View style={[ring, { borderWidth: 1.5, borderColor: colors.textDim }]} />; // pending
}

export function TodoCard({ items }: { items: TodoItem[] }) {
  const { colors } = useTheme();
  const done = items.filter((t) => t.status === 'completed').length;
  return (
    <View style={{ paddingVertical: 4 }}>
      <View
        style={{
          backgroundColor: colors.raised,
          borderRadius: 14,
          borderCurve: 'continuous',
          paddingHorizontal: 12,
          paddingVertical: 9,
          gap: 8,
          alignSelf: 'stretch',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Icon sf="checklist" size={12} color={colors.accent} />
          <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: '600' }}>Plan</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] }}>
            {done}/{items.length}
          </Text>
        </View>
        <View style={{ gap: 6 }}>
          {items.map((t) => (
            <View key={t.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <TodoGlyph status={t.status} colors={colors} />
              <Text
                style={{
                  flex: 1,
                  color:
                    t.status === 'completed'
                      ? colors.textDim
                      : t.status === 'cancelled'
                        ? colors.textFaint
                        : colors.text,
                  fontSize: 13.5,
                  lineHeight: 19,
                  textDecorationLine: t.status === 'cancelled' ? 'line-through' : 'none',
                }}
              >
                {t.content}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Verify Android icon mapping**

Open `src/components/icon.tsx`. Confirm `checklist` and `checkmark.circle.fill` have Android (MaterialCommunityIcons) fallbacks in the mapping table. `checkmark.circle.fill` is already used in the app. If `checklist` has no mapping, add one (e.g. → `'format-list-checks'`) or switch the header glyph to a mapped name like `list.bullet`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/todo-card.tsx src/components/icon.tsx
git commit -m "feat(#9): TodoCard checklist component"
```

---

## Task 4: SubagentMonitorCard component (`src/components/subagent-monitor-card.tsx`)

**Files:**
- Create: `src/components/subagent-monitor-card.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/subagent-monitor-card.tsx
import { useEffect, useState } from 'react';
import { LayoutAnimation, Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/icon';
import type { SubagentBatch, SubagentState } from '@/lib/subagent-progress';
import { useTheme } from '@/theme';

type Colors = ReturnType<typeof useTheme>['colors'];

function fmtElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function SubagentRow({
  s,
  now,
  expanded,
  colors,
}: {
  s: SubagentState;
  now: number;
  expanded: boolean;
  colors: Colors;
}) {
  const running = s.status === 'running';
  const elapsed = running ? (now - s.startedAtMs) / 1000 : s.durationSeconds;
  const dot = running ? colors.accent : s.status === 'completed' ? colors.success : colors.textFaint;
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {running ? (
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />
        ) : (
          <Icon sf={s.status === 'completed' ? 'checkmark.circle.fill' : 'xmark.circle'} size={12} color={dot} />
        )}
        <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontSize: 13 }}>
          {s.goal || 'subagent'}
        </Text>
        {elapsed !== undefined ? (
          <Text style={{ color: colors.textFaint, fontSize: 11.5, fontVariant: ['tabular-nums'] }}>
            {fmtElapsed(elapsed)}
          </Text>
        ) : null}
      </View>
      {(running || expanded) && s.activity ? (
        <Text numberOfLines={expanded ? 3 : 1} style={{ color: colors.textFaint, fontSize: 12, marginLeft: 14 }}>
          ↳ {s.activity}
          {s.toolCount ? ` · ${s.toolCount} tools` : ''}
        </Text>
      ) : null}
    </View>
  );
}

export function SubagentMonitorCard({ batch }: { batch: SubagentBatch }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const running = batch.subagents.some((s) => s.status === 'running');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const runningCount = batch.subagents.filter((s) => s.status === 'running').length;
  const doneCount = batch.subagents.length - runningCount;
  const header = running ? `${runningCount} running` : `${doneCount} done`;
  const totalCost = batch.subagents.reduce((acc, s) => acc + (s.costUsd ?? 0), 0);

  return (
    <View style={{ paddingVertical: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Subagents, ${header}, tap to ${expanded ? 'collapse' : 'expand'}`}
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
          setExpanded((e) => !e);
        }}
        style={{
          backgroundColor: colors.raised,
          borderRadius: 14,
          borderCurve: 'continuous',
          paddingHorizontal: 12,
          paddingVertical: 9,
          gap: 8,
          alignSelf: 'stretch',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Icon sf="square.grid.2x2" size={12} color={colors.accent} />
          <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: '600' }}>Subagents</Text>
          <Text style={{ color: colors.textDim, fontSize: 13 }}>{header}</Text>
          <View style={{ flex: 1 }} />
          <Icon sf={expanded ? 'chevron.up' : 'chevron.down'} size={11} color={colors.textFaint} />
        </View>
        <View style={{ gap: 7 }}>
          {batch.subagents.map((s) => (
            <SubagentRow key={s.key} s={s} now={now} expanded={expanded} colors={colors} />
          ))}
        </View>
        {!running && totalCost > 0 ? (
          <Text style={{ color: colors.textFaint, fontSize: 12 }}>total ~${totalCost.toFixed(2)}</Text>
        ) : null}
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 2: Verify Android icon mapping**

In `src/components/icon.tsx`, confirm `square.grid.2x2`, `chevron.up`, `chevron.down`, `checkmark.circle.fill`, `xmark.circle` are mapped for Android. `chevron.*` and `checkmark.circle.fill` are already used. Add mappings for `square.grid.2x2` (→ `'view-grid-outline'`) and `xmark.circle` (→ `'close-circle-outline'`) if missing.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/subagent-monitor-card.tsx src/components/icon.tsx
git commit -m "feat(#9): SubagentMonitorCard with live elapsed ticker"
```

---

## Task 5: Wire into the chat screen

**Files:**
- Modify: `src/api/types.ts` (event union)
- Modify: `src/components/message-row.tsx` (`ChatItem` role union + fields + null render)
- Modify: `src/app/chat/[id].tsx` (event handlers, refs, render dispatch)

- [ ] **Step 1: Extend the event-type union**

In `src/api/types.ts`, add the six subagent event types to `GatewayEventType` (above the `(string & {})` line):

```ts
export type GatewayEventType =
  | 'gateway.ready'
  | 'message.start'
  | 'message.delta'
  | 'message.complete'
  | 'tool.start'
  | 'tool.complete'
  | 'status.update'
  | 'subagent.spawn_requested'
  | 'subagent.start'
  | 'subagent.thinking'
  | 'subagent.tool'
  | 'subagent.progress'
  | 'subagent.complete'
  | 'error'
  | (string & {}); // forward-compatible
```

- [ ] **Step 2: Extend `ChatItem`**

In `src/components/message-row.tsx`, add imports at the top (after the existing imports):

```ts
import type { SubagentBatch } from '@/lib/subagent-progress';
import type { TodoItem } from '@/lib/todo';
```

Change the `ChatItem` role union and add two fields:

```ts
  role: 'user' | 'assistant' | 'tool' | 'status' | 'approval' | 'subagent' | 'todo';
```

Add inside the `ChatItem` interface (next to `approval?`):

```ts
  /** Live subagent batch — rendered by the chat screen via SubagentMonitorCard. */
  subagent?: SubagentBatch;
  /** Current todo list — rendered by the chat screen via TodoCard. */
  todo?: TodoItem[];
```

In `MessageRow`, replace the approval null-return line with one that also covers the new roles:

```ts
  // Rendered by the chat screen (they own their components); render nothing here.
  if (item.role === 'approval' || item.role === 'subagent' || item.role === 'todo') return null;
```

- [ ] **Step 3: Add imports + refs + handlers in the chat screen**

In `src/app/chat/[id].tsx`, add imports:

```ts
import { SubagentMonitorCard } from '@/components/subagent-monitor-card';
import { TodoCard } from '@/components/todo-card';
import { emptyBatch, finalizeBatch, reduceSubagentEvent } from '@/lib/subagent-progress';
import { parseTodoList } from '@/lib/todo';
```

Add two refs next to `keyCounter` (around line 111):

```ts
  const activeSubagentKeyRef = useRef<string | null>(null);
  const todoKeyRef = useRef<string | null>(null);
```

Add three helpers near the other `setItems` helpers (e.g. after `appendApproval`):

```ts
  /** Reduce a `subagent.*` event into the active batch item (create one if the
   * last batch finalized / none exists). */
  function handleSubagentEvent(e: GatewayEvent) {
    const ts = Date.now();
    setItems((prev) => {
      const k = activeSubagentKeyRef.current;
      const idx = k ? prev.findIndex((it) => it.key === k) : -1;
      if (idx >= 0 && prev[idx].subagent && !prev[idx].subagent!.finalized) {
        const next = [...prev];
        next[idx] = { ...prev[idx], subagent: reduceSubagentEvent(prev[idx].subagent!, e, ts) };
        return next;
      }
      const key = nextKey();
      activeSubagentKeyRef.current = key;
      return [...prev, { key, role: 'subagent', text: '', subagent: reduceSubagentEvent(emptyBatch(), e, ts) }];
    });
    if (e.type === 'subagent.complete') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }

  /** Turn ended / interrupted: stop any still-running subagents and seal the card. */
  function finalizeSubagents() {
    const k = activeSubagentKeyRef.current;
    if (!k) return;
    activeSubagentKeyRef.current = null;
    setItems((prev) => prev.map((it) => (it.key === k && it.subagent ? { ...it, subagent: finalizeBatch(it.subagent) } : it)));
  }

  /** Update (or create) the single todo card from a `todo` tool.complete. */
  function upsertTodo(payload: any) {
    const list = parseTodoList(payload);
    if (list === null) return;
    setItems((prev) => {
      const k = todoKeyRef.current;
      const idx = k ? prev.findIndex((it) => it.key === k) : -1;
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...prev[idx], todo: list };
        return next;
      }
      const key = nextKey();
      todoKeyRef.current = key;
      return [...prev, { key, role: 'todo', text: '', todo: list }];
    });
  }
```

- [ ] **Step 4: Wire the event switch**

In `wireGateway`'s `switch (e.type)` (around line 257):

- In `case 'message.complete':` add `finalizeSubagents();` right after `finishAssistant();`.
- In `case 'error':` add `finalizeSubagents();` after `cancelPendingApprovals();`.
- Replace `case 'tool.start':` body to suppress the generic todo card:

```ts
        case 'tool.start':
          setWaiting(false);
          finishAssistant();
          if (e.payload?.name === 'todo') break; // todo renders as TodoCard on complete
          startTool(e.payload);
          break;
```

- Replace `case 'tool.complete':` body:

```ts
        case 'tool.complete':
          if (e.payload?.name === 'todo') {
            upsertTodo(e.payload);
            break;
          }
          completeTool(e.payload);
          break;
```

- Add the subagent cases (before `case 'error':`):

```ts
        case 'subagent.spawn_requested':
        case 'subagent.start':
        case 'subagent.thinking':
        case 'subagent.tool':
        case 'subagent.progress':
        case 'subagent.complete':
          handleSubagentEvent(e);
          break;
```

- [ ] **Step 5: Wire the render dispatch**

In the `FlatList` `renderItem` (around line 585), replace the `item.approval ? … : <MessageRow … />` ternary with:

```tsx
              {item.approval ? (
                <ApprovalCard
                  approval={item.approval}
                  active={item.key === activeApprovalKey}
                  onRespond={(choice) => respondApproval(item.key, choice)}
                />
              ) : item.subagent ? (
                <SubagentMonitorCard batch={item.subagent} />
              ) : item.todo ? (
                <TodoCard items={item.todo} />
              ) : (
                <MessageRow item={item} />
              )}
```

- [ ] **Step 6: Typecheck + full test run**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc clean; all tests pass (existing + the 12 new lib tests).

- [ ] **Step 7: Commit**

```bash
git add src/api/types.ts src/components/message-row.tsx src/app/chat/[id].tsx
git commit -m "feat(#9): render subagent progress + todo cards in chat"
```

---

## Self-Review

**Spec coverage:** SubagentMonitorCard (T1+T4+T5); TodoCard (T2+T3+T5); subagent.* handling + finalize (T5); todo via `tool.complete.todos` + generic-card suppression (T5); flat/live-only/no-tap-open honored (reducer is flat, no history hydration, `childSessionId` stored but unused); conventions (theme/icon/borderCurve/no-memo) followed. Covered.

**Placeholder scan:** none — every step has full code or exact edits.

**Type consistency:** `SubagentBatch`/`SubagentState`/`reduceSubagentEvent`/`emptyBatch`/`finalizeBatch`/`batchAllDone` consistent across T1/T4/T5; `TodoItem`/`parseTodoList` consistent across T2/T3/T5; `ChatItem.subagent`/`ChatItem.todo` consistent T5; event names match the verified `GatewayEventType` additions.
