# Subagent Progress Monitoring (#9) — Design

**Status:** approved 2026-06-17
**Issue:** gldc/hermes-mobile-app#9
**Scope:** client-side only (verified: zero gateway changes needed)

## Goal

Render live subagent (delegated task) progress and the agent's todo checklist in
the chat stream, so the user can monitor parallel work and planning in real time
instead of staring at a silent screen.

## Key finding (reframes the issue)

Issue #9 assumed subagent activity is only visible as a `delegate_task` tool card.
In fact the gateway emits a **dedicated, richer `subagent.*` event stream** on the
parent session the app is already connected to — and the app currently **drops it**
(no handler; `gatewayClient` forwards unknown event types but the chat switch has no
case). These events are gated by `_tool_progress_enabled(sid)` (`!= "off"`), the same
gate as `tool.start`/`tool.complete`, which the app already receives — so the events
already arrive at the app socket. No server change is required.

## Two widgets

1. **SubagentMonitorCard** — driven by the `subagent.*` stream (rich, live).
2. **TodoCard** — driven by `tool.start`/`tool.complete` where `name === 'todo'`
   (the generic tool path, special-cased so the generic tool card is suppressed).

Both render as **chat items in the inverted `FlatList`**, the same pattern as
`ApprovalCard`, so they scroll with the conversation.

## Decisions (approved)

- **Flat, not nested.** Events carry `depth`/`parent_id`; v1 renders subagents flat.
  (Tree is future work.)
- **Live-only.** `subagent.*` are ephemeral progress events, not persisted session
  rows; on resume the card is **not** reconstructed. The card shows during live runs
  only. Same for the TodoCard (the persisted `todo` tool row is not specially rendered
  on history hydration in v1).
- **No tap-to-open child session.** `child_session_id` enables a desktop-style live
  watch; out of scope for v1 (kept in the data model for later).

## Verified wire contracts

### `subagent.*` events (gateway → app)

Envelope (after `gatewayClient` normalization): `{ type, session_id, payload }`.
Emitted on the **parent** sid via `_emit` (`tui_gateway/server.py:2819-2885`).

**Always present in `payload`:** `goal: string`, `task_count: int`, `task_index: int`.

**Optional identity / metric fields:** `subagent_id`, `parent_id`, `child_session_id`,
`depth: int`, `model`, `tool_count: int`, `toolsets: string[]`.

| `type` | When | Notable payload |
|---|---|---|
| `subagent.spawn_requested` | spawn initiated | base + identity, `text` = goal preview |
| `subagent.start` | run begins | base + identity, `text` = goal label |
| `subagent.thinking` | reasoning emitted | base + `text` (reasoning preview) |
| `subagent.tool` | tool invoked | base + `tool_name`, `text`/`tool_preview` (arg preview), `tool_count` |
| `subagent.progress` | batch summary (every 5 tools / flush) | base + `text` (comma-joined tool names) |
| `subagent.text` | child reply token | **NOT emitted to parent** — ignore; do not depend on it |
| `subagent.complete` | run ends | base + `status` (`completed`/`failed`/`timeout`), `summary` (≤500 chars), `duration_seconds: float`, `input_tokens`, `output_tokens`, `reasoning_tokens`, `api_calls`, `cost_usd?`, `files_read: string[]`, `files_written: string[]`, `output_tail: object[]` |

### `todo` tool (`tools/todo_tool.py`, `tui_gateway/server.py`)

- Tool `name === 'todo'`. **The list arrives on `tool.complete`, NOT `tool.start`.** The
  gateway extracts the tool's JSON return onto a top-level `payload.todos` field
  (`_on_tool_complete`: `if name == "todo": payload["todos"] = json.loads(result)["todos"]`).
  `tool.start` carries no structured todos (only verbose `args_text`), and `args.todos`
  would be a *partial* merge update — the gateway code comments this explicitly. So the
  client reads `tool.complete` `payload.todos`.
- `payload.todos: Array<{ id: string, content: string, status }>` is the **full current
  list after the write** — the tool always returns the whole list and the gateway has
  already applied replace/merge server-side, so **no client-side merge is needed**. Item
  order = priority.
- A todo *read* also returns the full list, so updating on every todo `tool.complete` is
  correct and idempotent.
- On `tool.start` AND `tool.complete` with `name === 'todo'`, suppress the generic tool card.
- `status ∈ { 'pending', 'in_progress', 'completed', 'cancelled' }`
  (`VALID_STATUSES`). Caps: ≤256 items, content ≤4000 chars.

## Data models & pure logic (testable, in `src/lib/`)

### `src/lib/subagent-progress.ts`

```ts
export type SubagentStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'stopped';

export interface SubagentState {
  key: string;            // subagent_id, else `idx:${task_index}`
  goal: string;
  taskIndex: number;
  taskCount: number;
  status: SubagentStatus;
  activity: string;       // latest tool/thinking/progress text
  toolCount: number;
  model?: string;
  startedAtMs: number;    // client clock, captured on first event (injected `now`)
  // completion rollup (from subagent.complete):
  durationSeconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  filesRead?: string[];
  filesWritten?: string[];
  childSessionId?: string; // retained for future tap-to-open
}

export interface SubagentBatch {
  subagents: SubagentState[]; // insertion order (= task_index order)
  finalized: boolean;
}

export function emptyBatch(): SubagentBatch;
// Pure. `now` injected for testability (no Date.now in lib).
export function reduceSubagentEvent(
  batch: SubagentBatch,
  event: { type: string; payload?: Record<string, unknown> },
  now: number,
): SubagentBatch;
// Mark any still-running subagents 'stopped' and finalize (turn ended/interrupted).
export function finalizeBatch(batch: SubagentBatch): SubagentBatch;
export function batchAllDone(batch: SubagentBatch): boolean;
```

Reducer rules: key by `subagent_id ?? idx:${task_index}`; idempotent by key
(duplicate events update, never duplicate rows); `complete` with no prior `start`
creates the row; non-`subagent.*` events return the batch unchanged.

### `src/lib/todo.ts`

```ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export interface TodoItem { id: string; content: string; status: TodoStatus; }

// Read the full todo list the gateway puts on a `todo` tool.complete payload.
// Returns null when there is no todos array (nothing to render / not a todo result).
export function parseTodoList(payload: { todos?: unknown }): TodoItem[] | null;
```

Rules: `payload.todos` not an array → `null`. Map each entry to
`{ id, content, status }`; coerce missing/unknown `status` to `'pending'`; drop entries
without a string `content`. **No merge logic** — the gateway already returns the
post-write full list.

## UI behavior

- **SubagentMonitorCard** (`src/components/subagent-monitor-card.tsx`): one chat item
  (`role: 'subagent'`) per delegation batch. Collapsed: `🧫 Subagents (N running|done)`
  header + per-subagent line (status dot · goal (truncated) · `↳ tool · n tools · m:ss`).
  Expanded (tap, `LayoutAnimation`): per-subagent latest activity. On all-done: each row
  shows `✓ goal · m:ss · Nk` and a `total ~$X.XX` line when `cost_usd` present. Light
  haptic on each `subagent.complete`. Elapsed ticks from a 1s interval **only while a
  subagent is running** (cleared otherwise).
- **TodoCard** (`src/components/todo-card.tsx`): one chat item (`role: 'todo'`) showing
  the latest list; updates in place. Row glyph by status — `pending` empty circle,
  `in_progress` accent dot, `completed` green check, `cancelled` faint + struck.

## Integration points

| File | Change |
|---|---|
| `src/lib/subagent-progress.ts` | NEW — reducer + helpers (+ `__tests__`) |
| `src/lib/todo.ts` | NEW — `parseTodoList` (+ `__tests__`) |
| `src/components/subagent-monitor-card.tsx` | NEW |
| `src/components/todo-card.tsx` | NEW |
| `src/components/message-row.tsx` | add `'subagent'` + `'todo'` to `ChatItem` role union; render branches (or render in chat screen like `ApprovalCard`) |
| `src/app/chat/[id].tsx` | event switch: handle `subagent.*` (reduce into a batch item); on `tool.complete` `name==='todo'` update the todo item via `parseTodoList`; suppress the generic tool card for `name==='todo'` on both `tool.start` and `tool.complete`; 1s ticker; finalize batch on `message.complete`/`error` |
| `src/api/types.ts` | add `subagent.*` to `GatewayEventType` (optional; wildcard already covers) |

## Conventions

`useTheme()` colors only (no hex), SF Symbols via `expo-image` `source="sf:name"`,
`borderCurve:'continuous'`, `process.env.EXPO_OS`, React Compiler (no manual memo of
render values), `LayoutAnimation` for expand (matches `ToolCallCard`). Dark is primary;
light must work.

## Testing

- TDD on the two `src/lib/` reducers (pure, injected `now`): lifecycle, parallel batch,
  identity fallback, complete-without-start, idempotency, finalize; todo replace/merge/
  dedupe/status-coercion/read-ignore. Run `npx tsc --noEmit && npx jest` before PR.
- Components are glue → verified on-device (per `AGENTS.md`).

## Out of scope (v1)

Nested-hierarchy tree; history hydration of the live card; tap-to-open child session
live watch; the `subagent.text` child-token stream (not delivered to the parent anyway).
