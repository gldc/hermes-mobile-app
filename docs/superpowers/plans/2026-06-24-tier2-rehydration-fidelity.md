# Tier 2 — Rehydration Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On reload/reconnect, restore tool-call invocation `context` (currently dropped) and render the reasoning the server already persists, so a rehydrated transcript matches the live one more closely.

**Architecture:** History rehydration (`historyToItems`) becomes a two-pass merge: pass 1 indexes assistant `tool_calls[]` invocations by `id ?? call_id`; pass 2 emits each tool card at its result-row position with a `context` derived by a new pure `toolContextFromArgs` that replicates the gateway's `build_tool_preview`. Reasoning is attached to the assistant `ChatItem` and rendered as a collapsed-by-default disclosure. All parsing/derivation logic is pure and unit-tested; the disclosure UI is device-verified.

**Tech Stack:** TypeScript, React Native 0.85 / Expo SDK 56, Jest (`jest-expo`), `expo-image` SF Symbols, the in-repo `MarkdownView`.

**Branch:** implement on `feat/rehydration-fidelity` (branched from `main`). Tier 2 is code-independent of Tier 1 (#22) — it touches `history.ts`, `message-text.ts`, `types.ts`, `message-row.tsx`, `export.ts`, and new `tool-context.ts`; none overlap Tier 1's files. Ship after Tier 1 by sequencing. Spec: `docs/superpowers/specs/2026-06-24-foreground-reconnect-rehydration-sync-design.md` (§5).

---

## File Structure

- **Create** `src/lib/tool-context.ts` — pure `toolContextFromArgs(toolName, args, maxLen?)`, a faithful port of `hermes-agent/agent/display.py:167-300` (`build_tool_preview`).
- **Create** `__tests__/toolContext.test.ts` — unit tests for the port.
- **Modify** `src/api/types.ts` — add `ToolCall` interface + `tool_calls?` and the reasoning columns to `SessionMessage`.
- **Modify** `src/lib/message-text.ts` — add pure `reasoningText(m)`.
- **Modify** `src/lib/history.ts` — two-pass merge (context restore) + reasoning emission + "prose OR reasoning" rule.
- **Modify** `__tests__/history.test.ts` — extend with 5a (merge) and 5b (reasoning) tests.
- **Modify** `src/components/message-row.tsx` — add `reasoning?` to `ChatItem`; add a `ReasoningDisclosure` sub-component; guard empty-text prose/Share.
- **Modify** `src/lib/export.ts` + `__tests__/export.test.ts` — include `reasoning` in the JSONL record.

**Verbatim current code anchors** (re-read before editing — line numbers may drift):
- `src/lib/history.ts` `historyToItems` at 18-40; `MAX_TOOL_DETAIL=4000` at 8; empty-row drops at 23 and 28.
- `src/lib/message-text.ts` `messageText` at 5-21.
- `src/api/types.ts` `SessionMessage` at 24-35.
- `src/components/message-row.tsx` `ChatItem` at 28-47; `ToolCallCard` expand pattern at 60-63/96/106-119; assistant branch at 169-194; `MessageRow = memo(...)` at 128. `useState` imported at 1; `LayoutAnimation`/`Pressable`/`View`/`Text` at 2; `Icon` at 6; `MarkdownView` at 7; `useTheme()` destructured at 129.
- `src/components/markdown-view.tsx` — `MarkdownView` takes a single prop `{ text: string }` (memoized).
- `src/lib/export.ts` — `textLine` (assistant returns `null` on empty text), `toRecord`, `exportAsJsonl`.
- Contract: `docs/contracts/sessions-extra.md` — `tool_calls` shape at 146-156, join rule at 158-159, reasoning columns at 130.
- Gateway source (for the port): `/Users/gldc/Developer/hermes-agent/agent/display.py:167-300`.

---

## Task 1: Pure `toolContextFromArgs` (port of `build_tool_preview`)

**Files:**
- Create: `src/lib/tool-context.ts`
- Test: `__tests__/toolContext.test.ts`

> The implementation below is transcribed byte-for-byte from `display.py:167-300` (read during planning). If `display.py` has changed, re-read it and reconcile before trusting this. Behavior degrades gracefully — a wrong/missing context just omits the card's context line (`message-row.tsx:79-83` guards `tool.context ? … : null`).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/toolContext.test.ts`:

```typescript
import { toolContextFromArgs } from '../src/lib/tool-context';

describe('toolContextFromArgs — primary-arg map', () => {
  it('maps terminal → command', () => {
    expect(toolContextFromArgs('terminal', { command: 'ls -la' })).toBe('ls -la');
  });
  it('maps write_file/read_file/patch → path', () => {
    expect(toolContextFromArgs('write_file', { path: '/a/b.txt' })).toBe('/a/b.txt');
    expect(toolContextFromArgs('read_file', { path: '/a/b.txt' })).toBe('/a/b.txt');
    expect(toolContextFromArgs('patch', { path: '/a/b.txt' })).toBe('/a/b.txt');
  });
  it('maps browser_navigate → url and web_search → query', () => {
    expect(toolContextFromArgs('browser_navigate', { url: 'https://x.dev' })).toBe('https://x.dev');
    expect(toolContextFromArgs('web_search', { query: 'hermes' })).toBe('hermes');
  });
  it('takes the first element of a list-valued arg (web_extract → urls)', () => {
    expect(toolContextFromArgs('web_extract', { urls: ['https://a', 'https://b'] })).toBe('https://a');
  });
  it('collapses whitespace and truncates to 80 chars with an ellipsis', () => {
    expect(toolContextFromArgs('terminal', { command: 'echo   a\n\n  b' })).toBe('echo a b');
    const long = 'x'.repeat(100);
    const out = toolContextFromArgs('terminal', { command: long })!;
    expect(out).toHaveLength(80);
    expect(out.endsWith('...')).toBe(true);
  });
});

describe('toolContextFromArgs — fallback + empties', () => {
  it('falls back through the key order for unmapped tools', () => {
    expect(toolContextFromArgs('mystery_tool', { name: 'thing' })).toBe('thing');
  });
  it('returns undefined for no/empty args', () => {
    expect(toolContextFromArgs('terminal', {})).toBeUndefined();
    expect(toolContextFromArgs('terminal', undefined)).toBeUndefined();
    expect(toolContextFromArgs('terminal', 'not-an-object')).toBeUndefined();
  });
  it('returns undefined when the chosen value is empty', () => {
    expect(toolContextFromArgs('terminal', { command: '   ' })).toBeUndefined();
  });
});

describe('toolContextFromArgs — special cases', () => {
  it('todo: reading / planning / updating', () => {
    expect(toolContextFromArgs('todo', { merge: false })).toBe('reading task list'); // todos undefined
    expect(toolContextFromArgs('todo', { todos: [1, 2, 3] })).toBe('planning 3 task(s)');
    expect(toolContextFromArgs('todo', { todos: [1, 2], merge: true })).toBe('updating 2 task(s)');
  });
  it('delegate_task: single goal and batch', () => {
    expect(toolContextFromArgs('delegate_task', { goal: 'do the thing' })).toBe('do the thing');
    expect(
      toolContextFromArgs('delegate_task', { tasks: [{ goal: 'a' }, { goal: 'b' }] }),
    ).toBe('2 tasks: a | b');
    expect(toolContextFromArgs('delegate_task', { tasks: [{}, {}] })).toBe('2 tasks: ? | ?');
  });
  it('memory: add / replace / remove', () => {
    expect(toolContextFromArgs('memory', { action: 'add', target: 'notes', content: 'remember me' }))
      .toBe('+notes: "remember me"');
    expect(toolContextFromArgs('memory', { action: 'replace', target: 'notes', old_text: 'old' }))
      .toBe('~notes: "old"');
    expect(toolContextFromArgs('memory', { action: 'remove', target: 'notes' }))
      .toBe('-notes: "<missing old_text>"');
  });
  it('send_message: target defaults to ? and message truncates at 20', () => {
    expect(toolContextFromArgs('send_message', { message: 'hi' })).toBe('to ?: "hi"');
    expect(toolContextFromArgs('send_message', { target: 'bob', message: 'x'.repeat(30) }))
      .toBe(`to bob: "${'x'.repeat(17)}..."`);
  });
  it('session_search: recall with 25-char cap', () => {
    expect(toolContextFromArgs('session_search', { query: 'find it' })).toBe('recall: "find it"');
  });
  it('process: joins action, session id (16), data (20), and wait timeout', () => {
    expect(toolContextFromArgs('process', { action: 'wait', session_id: 'sess1234567890abcdef', timeout: 5 }))
      .toBe('wait sess1234567890ab 5s');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/toolContext.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/tool-context'`.

- [ ] **Step 3: Write the implementation (faithful port of display.py)**

Create `src/lib/tool-context.ts`:

```typescript
// src/lib/tool-context.ts
// Faithful port of hermes-agent's build_tool_preview (agent/display.py:167-300)
// so a tool card rehydrated from history shows the same one-line `context` the
// live `tool.start` event carries. Pure; takes ALREADY-PARSED args (the caller
// JSON.parses the persisted tool_calls[].function.arguments string). Returns
// undefined when there's nothing useful to show (gateway returns None).

const MAX_LEN = 80;

// display.py:203-214 — tool name → its primary argument key.
const PRIMARY_ARG: Record<string, string> = {
  terminal: 'command', web_search: 'query', web_extract: 'urls',
  read_file: 'path', write_file: 'path', patch: 'path',
  search_files: 'pattern', browser_navigate: 'url',
  browser_click: 'ref', browser_type: 'text',
  image_generate: 'prompt', text_to_speech: 'text',
  vision_analyze: 'question', mixture_of_agents: 'user_prompt',
  skill_view: 'name', skills_list: 'category',
  cronjob: 'action',
  execute_code: 'code', delegate_task: 'goal',
  clarify: 'question', skill_manage: 'name',
};

// display.py:283 — fallback key order for unmapped tools.
const FALLBACK_KEYS = ['query', 'text', 'command', 'path', 'name', 'prompt', 'code', 'goal'];

/** display.py:167-169 — collapse all whitespace (incl. newlines) to single spaces. */
function oneline(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

/** display.py:172-177 */
function truncate(text: string, maxLen: number): string {
  if (maxLen > 0 && text.length > maxLen) {
    if (maxLen <= 3) return '.'.repeat(maxLen);
    return text.slice(0, maxLen - 3) + '...';
  }
  return text;
}

function asRecord(args: unknown): Record<string, unknown> | null {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : null;
}

/** display.py:180-190 */
function delegateGoalParts(tasks: unknown, perGoalLen: number): [number, string[]] {
  if (!Array.isArray(tasks)) return [0, []];
  const goals: string[] = [];
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) continue;
    const rawGoal = (task as Record<string, unknown>).goal;
    const goal = rawGoal == null ? '?' : oneline(String(rawGoal));
    goals.push(truncate(goal || '?', perGoalLen));
  }
  return [goals.length, goals];
}

export function toolContextFromArgs(
  toolName: string,
  args: unknown,
  maxLen: number = MAX_LEN,
): string | undefined {
  const a = asRecord(args);
  if (!a || Object.keys(a).length === 0) return undefined; // display.py:201 `if not args`

  // delegate_task (display.py:217-230)
  if (toolName === 'delegate_task') {
    const tasks = a.tasks;
    if (tasks && Array.isArray(tasks)) {
      const [count, goals] = delegateGoalParts(tasks, 40);
      const preview = goals.length
        ? `${count} tasks: ${goals.join(' | ')}`
        : `${tasks.length} parallel tasks`;
      return truncate(preview, maxLen) || undefined;
    }
    const goal = a.goal;
    if (goal == null) return undefined;
    const preview = oneline(String(goal));
    return preview ? truncate(preview, maxLen) : undefined;
  }

  // process (display.py:232-244)
  if (toolName === 'process') {
    const action = a.action == null ? '' : String(a.action);
    const sid = a.session_id == null ? '' : String(a.session_id);
    const data = a.data == null ? '' : String(a.data);
    const parts: string[] = [action];
    if (sid) parts.push(sid.slice(0, 16));
    if (data) parts.push(`"${oneline(data.slice(0, 20))}"`);
    if (a.timeout && action === 'wait') parts.push(`${a.timeout}s`);
    const joined = parts.join(' ');
    return joined.trim() ? joined : undefined;
  }

  // todo (display.py:246-254)
  if (toolName === 'todo') {
    const todos = a.todos;
    if (todos == null) return 'reading task list';
    const n = Array.isArray(todos) ? todos.length : 0;
    return a.merge ? `updating ${n} task(s)` : `planning ${n} task(s)`;
  }

  // session_search (display.py:256-258)
  if (toolName === 'session_search') {
    const query = oneline(a.query == null ? '' : String(a.query));
    return `recall: "${query.slice(0, 25)}${query.length > 25 ? '...' : ''}"`;
  }

  // memory (display.py:260-272)
  if (toolName === 'memory') {
    const action = a.action == null ? '' : String(a.action);
    const target = a.target == null ? '' : String(a.target);
    if (action === 'add') {
      const content = oneline(a.content == null ? '' : String(a.content));
      return `+${target}: "${content.slice(0, 25)}${content.length > 25 ? '...' : ''}"`;
    }
    if (action === 'replace') {
      const old = oneline(a.old_text ? String(a.old_text) : '') || '<missing old_text>';
      return `~${target}: "${old.slice(0, 20)}"`;
    }
    if (action === 'remove') {
      const old = oneline(a.old_text ? String(a.old_text) : '') || '<missing old_text>';
      return `-${target}: "${old.slice(0, 20)}"`;
    }
    return action || undefined;
  }

  // send_message (display.py:274-279)
  if (toolName === 'send_message') {
    const target = a.target == null ? '?' : String(a.target);
    let msg = oneline(a.message == null ? '' : String(a.message));
    if (msg.length > 20) msg = msg.slice(0, 17) + '...';
    return `to ${target}: "${msg}"`;
  }

  // Primary-arg map, then fallback order (display.py:281-300).
  let key: string | undefined = PRIMARY_ARG[toolName];
  if (!key) {
    for (const fk of FALLBACK_KEYS) {
      if (fk in a) { key = fk; break; }
    }
  }
  if (!key || !(key in a)) return undefined;

  let value = a[key];
  if (Array.isArray(value)) value = value.length ? value[0] : '';
  const preview = oneline(String(value));
  if (!preview) return undefined;
  return maxLen > 0 && preview.length > maxLen ? preview.slice(0, maxLen - 3) + '...' : preview;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/toolContext.test.ts`
Expected: PASS (3 suites).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tool-context.ts __tests__/toolContext.test.ts
git commit -m "feat(history): toolContextFromArgs — port of gateway build_tool_preview"
```

---

## Task 2: Two-pass tool-call merge in `historyToItems`

**Files:**
- Modify: `src/api/types.ts` (SessionMessage 24-35)
- Modify: `src/lib/history.ts` (historyToItems 18-40)
- Test: `__tests__/history.test.ts`

- [ ] **Step 1: Add the `ToolCall` type and `tool_calls` to `SessionMessage`**

In `src/api/types.ts`, add the `ToolCall` interface immediately above `SessionMessage`, and add the `tool_calls` field to `SessionMessage`:

```typescript
/** One entry of an assistant row's `tool_calls[]` invocation array
 * (docs/contracts/sessions-extra.md:146-156). `function.arguments` is a JSON string. */
export interface ToolCall {
  id?: string;
  call_id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** Some endpoints provide plain text… */
  text?: string | null;
  /** …but session-DB rows store `content`: a string or decoded structure
   * (e.g. parts array). Use messageText() to extract display text. */
  content?: unknown;
  timestamp: number;
  tool_name?: string | null;
  /** Set on role='tool' rows; joins to assistant tool_calls[i].id. */
  tool_call_id?: string | null;
  /** Set on role='assistant' rows; the tool invocations whose results arrive as
   * later role='tool' rows. Parsed server-side; defensively re-checked here. */
  tool_calls?: ToolCall[] | null;
}
```

- [ ] **Step 2: Write the failing 5a tests**

In `__tests__/history.test.ts`, add inside the existing `describe('historyToItems', …)` block:

```typescript
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
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx jest __tests__/history.test.ts -t "restores tool-call context"`
Expected: FAIL — `context` is `undefined` (merge not implemented).

- [ ] **Step 4: Rewrite `historyToItems` as a two-pass merge**

Replace the body of `src/lib/history.ts` (keep the file header comment + `MAX_TOOL_DETAIL`). Update the imports at the top to add `ToolCall` and `toolContextFromArgs`:

```typescript
// src/lib/history.ts — map raw session-DB message rows to renderable ChatItems.
// Contract: docs/contracts/sessions-extra.md → raw /messages row schema.
import type { SessionMessage } from '@/api/types';
import type { ChatItem, ToolInfo } from '@/components/message-row';
import { messageText } from './message-text';
import { toolContextFromArgs } from './tool-context';

/** Same cap the live tool.complete path applies to result text. */
const MAX_TOOL_DETAIL = 4000;

export function historyToItems(messages: SessionMessage[], nextKey: () => string): ChatItem[] {
  // Pass 1: index tool-call invocations from assistant rows by id ?? call_id.
  // The invocation lives on the assistant row; its result is a later tool row.
  const invocations = new Map<string, { name?: string; args: unknown }>();
  for (const m of messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    for (const tc of m.tool_calls) {
      const id = tc?.id ?? tc?.call_id;
      if (!id) continue;
      let args: unknown;
      const raw = tc?.function?.arguments;
      if (typeof raw === 'string') {
        try { args = JSON.parse(raw); } catch { args = undefined; }
      }
      invocations.set(id, { name: tc?.function?.name, args });
    }
  }

  // Pass 2: emit items at their natural (result-row) positions.
  const items: ChatItem[] = [];
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      const text = messageText(m);
      if (!text.trim()) continue; // drop empty rows (invocation-only assistants)
      items.push({ key: nextKey(), role: m.role, text, complete: true });
    } else if (m.role === 'tool') {
      const name = m.tool_name?.trim();
      const detail = messageText(m).trim().slice(0, MAX_TOOL_DETAIL);
      if (!name && !detail) continue; // drop empty rows
      const key = nextKey();
      const inv = m.tool_call_id ? invocations.get(m.tool_call_id) : undefined;
      const context = inv ? toolContextFromArgs(inv.name ?? name ?? 'tool', inv.args) : undefined;
      const tool: ToolInfo = {
        id: m.tool_call_id || key,
        name: name || inv?.name || 'tool',
        running: false,
        ...(context ? { context } : {}),
        ...(detail ? { detail } : {}),
      };
      items.push({ key, role: 'tool', text: tool.name, tool });
    }
  }
  return items;
}
```

- [ ] **Step 5: Run the full history suite to verify pass + no regressions**

Run: `npx jest __tests__/history.test.ts`
Expected: PASS (all existing tests + the 5 new ones).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/api/types.ts src/lib/history.ts __tests__/history.test.ts
git commit -m "feat(history): merge tool-call invocation context into rehydrated cards"
```

---

## Task 3: Reasoning column + rehydration

**Files:**
- Modify: `src/api/types.ts` (SessionMessage)
- Modify: `src/lib/message-text.ts`
- Modify: `src/components/message-row.tsx` (ChatItem)
- Modify: `src/lib/history.ts` (historyToItems assistant branch)
- Test: `__tests__/history.test.ts`

- [ ] **Step 1: Add reasoning columns to `SessionMessage`**

In `src/api/types.ts`, add to `SessionMessage` (after `tool_calls`):

```typescript
  /** Reasoning/thinking trace persisted on assistant rows. Which column is
   * populated varies by model family (docs/contracts/sessions-extra.md:130). */
  reasoning?: string | null;
  reasoning_content?: string | null;
  reasoning_details?: string | null;
```

- [ ] **Step 2: Add `reasoning?` to `ChatItem`**

In `src/components/message-row.tsx`, add to the `ChatItem` interface (after `complete?`):

```typescript
  /** Assistant reasoning trace, rehydrated from history; rendered as a
   * collapsible disclosure above the prose. History-only (no live event yet). */
  reasoning?: string;
```

- [ ] **Step 3: Write the failing `reasoningText` + reasoning-emit tests**

Create `__tests__/messageText.test.ts` additions — if the file exists, add a new `describe`; the test file already imports from `../src/lib/message-text`. Add:

```typescript
import { reasoningText } from '../src/lib/message-text';

describe('reasoningText', () => {
  it('prefers reasoning_content, then reasoning', () => {
    expect(reasoningText({ reasoning_content: 'rc', reasoning: 'r' })).toBe('rc');
    expect(reasoningText({ reasoning: 'r' })).toBe('r');
  });
  it('returns empty string when none present', () => {
    expect(reasoningText({})).toBe('');
    expect(reasoningText({ reasoning: null, reasoning_content: null })).toBe('');
  });
});
```

And in `__tests__/history.test.ts`, add:

```typescript
  it('attaches reasoning to the assistant item and keeps the prose', () => {
    const items = historyToItems(
      [msg({ role: 'assistant', content: 'answer', reasoning_content: 'because' })],
      keyer(),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ role: 'assistant', text: 'answer', reasoning: 'because' });
  });

  it('emits a reasoning-only assistant item with empty text', () => {
    const items = historyToItems(
      [msg({ role: 'assistant', content: '', reasoning: 'just thinking' })],
      keyer(),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ role: 'assistant', text: '', reasoning: 'just thinking' });
  });

  it('drops an assistant row with neither prose nor reasoning', () => {
    const items = historyToItems([msg({ role: 'assistant', content: '' })], keyer());
    expect(items).toHaveLength(0);
  });
```

- [ ] **Step 4: Run the new tests to verify they fail**

Run: `npx jest __tests__/messageText.test.ts -t reasoningText`
Expected: FAIL — `reasoningText` is not exported.

- [ ] **Step 5: Implement `reasoningText`**

In `src/lib/message-text.ts`, append:

```typescript
/** Reasoning trace persisted on assistant rows. The populated column varies by
 * model family; prefer reasoning_content, then reasoning. reasoning_details is a
 * structured blob and is intentionally ignored without a verified sample. */
export function reasoningText(m: {
  reasoning?: string | null;
  reasoning_content?: string | null;
}): string {
  if (typeof m.reasoning_content === 'string' && m.reasoning_content) return m.reasoning_content;
  if (typeof m.reasoning === 'string' && m.reasoning) return m.reasoning;
  return '';
}
```

- [ ] **Step 6: Wire reasoning into `historyToItems` (prose OR reasoning rule)**

In `src/lib/history.ts`, add `reasoningText` to the import from `./message-text`:

```typescript
import { messageText, reasoningText } from './message-text';
```

Then replace the user/assistant branch in the Pass-2 loop with:

```typescript
    if (m.role === 'user' || m.role === 'assistant') {
      const text = messageText(m);
      const reasoning = m.role === 'assistant' ? reasoningText(m).slice(0, MAX_TOOL_DETAIL) : '';
      if (!text.trim() && !reasoning.trim()) continue; // drop only if nothing to show
      items.push({
        key: nextKey(),
        role: m.role,
        text,
        complete: true,
        ...(reasoning.trim() ? { reasoning } : {}),
      });
    } else if (m.role === 'tool') {
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest __tests__/messageText.test.ts __tests__/history.test.ts`
Expected: PASS (reasoningText suite + all history tests incl. the 3 new reasoning cases).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/api/types.ts src/lib/message-text.ts src/lib/history.ts src/components/message-row.tsx __tests__/messageText.test.ts __tests__/history.test.ts
git commit -m "feat(history): rehydrate assistant reasoning trace"
```

---

## Task 4: Reasoning disclosure UI + empty-text guards (device-verified)

**Files:**
- Modify: `src/components/message-row.tsx`

This is screen rendering — verified on device, no unit test.

- [ ] **Step 1: Add the `ReasoningDisclosure` component**

In `src/components/message-row.tsx`, add this component immediately above `ToolCallCard` (it reuses the same imports: `useState`, `Pressable`, `View`, `Text`, `LayoutAnimation`, `Icon`, `MarkdownView`, `useTheme`):

```tsx
function ReasoningDisclosure({ text }: { text: string }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ marginBottom: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Reasoning, ${expanded ? 'tap to collapse' : 'tap to expand'}`}
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
          setExpanded((e) => !e);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      >
        <Icon sf="brain" size={12} color={colors.textFaint} />
        <Text style={{ color: colors.textFaint, fontSize: 12.5, fontWeight: '600' }}>Reasoning</Text>
        <Icon sf={expanded ? 'chevron.up' : 'chevron.down'} size={10} color={colors.textFaint} />
      </Pressable>
      {expanded ? (
        <View style={{ marginTop: 6, opacity: 0.9 }}>
          <MarkdownView text={text} />
        </View>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: Render the disclosure + guard empty text in the assistant branch**

Replace the assistant branch (`if (item.role === 'assistant') { … }`, lines ~169-194) with:

```tsx
  if (item.role === 'assistant') {
    // Markdown isn't selectable, so long-press opens the share sheet
    // (which includes Copy on iOS). Reasoning-only items have empty text.
    return (
      <Pressable
        accessibilityLabel="Assistant message, long-press to share"
        onLongPress={
          item.complete && item.text.trim()
            ? () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                Share.share({ message: item.text });
              }
            : undefined
        }
        style={{ paddingVertical: 6 }}
      >
        {item.reasoning ? <ReasoningDisclosure text={item.reasoning} /> : null}
        {item.complete ? (
          item.text.trim() ? <MarkdownView text={item.text} /> : null
        ) : (
          <Text selectable style={{ color: colors.text, fontSize: 17, lineHeight: 27 }}>
            {item.text}
            <Text style={{ color: colors.accent }}>▍</Text>
          </Text>
        )}
      </Pressable>
    );
  }
```

- [ ] **Step 3: Typecheck + full suite (no regressions)**

Run: `npx tsc --noEmit && npx jest`
Expected: typecheck clean; all suites pass.

- [ ] **Step 4: On-device verification (manual)**

Run: `npx expo run:ios --device` (or reload if JS hot-reloads).
Verify:
1. Resume a session that contains a reasoning turn → a collapsed "Reasoning" row appears above the assistant prose; tapping expands/collapses with the fade animation; content renders as markdown.
2. A reasoning-only turn (no prose) shows the disclosure with no empty gap below it; long-pressing it does NOT open an empty share sheet.
3. A normal turn with no reasoning renders exactly as before (no disclosure).
4. **Context spot-check (Task 1/2 verify-on-deploy):** resume a session with `terminal`/`write_file`/`read_file` calls → each rehydrated tool card shows the same one-line context (command/path) the live `tool.start` showed. If any differ, re-check `toolContextFromArgs` against `display.py`.
5. Light theme renders correctly.

- [ ] **Step 5: Commit**

```bash
git add src/components/message-row.tsx
git commit -m "feat(chat): collapsible reasoning disclosure on assistant rows"
```

---

## Task 5: Export audit — include reasoning in JSONL

**Files:**
- Modify: `src/lib/export.ts`
- Test: `__tests__/export.test.ts`

`exportAsText` already drops empty assistant items (`textLine` returns `null` on empty text), so it needs no change. Only JSONL should carry the reasoning, so a reasoning-only item produces a meaningful record.

- [ ] **Step 1: Write the failing test**

In `__tests__/export.test.ts`, add:

```typescript
  it('includes reasoning in the JSONL record when present', () => {
    const out = exportAsJsonl([
      { key: 'k0', role: 'assistant', text: 'ans', reasoning: 'because', complete: true },
      { key: 'k1', role: 'assistant', text: 'plain', complete: true },
    ] as any);
    const [a, b] = out.split('\n').map((l) => JSON.parse(l));
    expect(a).toMatchObject({ role: 'assistant', text: 'ans', reasoning: 'because' });
    expect(b.reasoning).toBeUndefined();
  });
```

(If `exportAsJsonl` is not yet imported in the test file, add it to the existing import from `../src/lib/export`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/export.test.ts -t "includes reasoning"`
Expected: FAIL — `reasoning` not present on the record.

- [ ] **Step 3: Add reasoning to `toRecord`**

In `src/lib/export.ts`, in `toRecord`, after the `{ role, text }` initializer add:

```typescript
  if (item.reasoning) record.reasoning = item.reasoning;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/export.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: clean; all suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/export.ts __tests__/export.test.ts
git commit -m "feat(export): include rehydrated reasoning in JSONL export"
```

---

## Self-Review (completed during authoring)

**Spec coverage (§5):** 5a two-pass merge → Task 2; `toolContextFromArgs` replicating `build_tool_preview` → Task 1 (ported byte-for-byte from `display.py:167-300`); `id ?? call_id` → Task 2 Step 2/4; non-array guard → Task 2 (the `Array.isArray` check + per-arg `JSON.parse` try/catch); result-row emission position → Task 2; title from `tool_name` → Task 2 (`name || inv?.name || 'tool'`); diff/durationS/summary NOT restored → not attempted (correct, not persisted). 5b reasoning column + `reasoningText` fallback → Task 3; ChatItem.reasoning + prose-OR-reasoning emit → Task 3; collapsible MarkdownView disclosure → Task 4; empty-text consumer audit (Share + export) → Task 4 Step 2 (Share/prose guards) + Task 5 (JSONL). `startTool` NOT changed → respected (only `history.ts` touched for the merge).

**Placeholder scan:** none — every code step has complete code; every run step has the command + expected result.

**Type/name consistency:** `toolContextFromArgs(toolName, args, maxLen?)` defined in Task 1, consumed in Task 2 with `toolContextFromArgs(inv.name ?? name ?? 'tool', inv.args)`. `ToolCall`/`tool_calls` defined in Task 2, consumed in Task 2's Pass 1. `reasoningText` defined in Task 3, consumed in `history.ts`. `ChatItem.reasoning` defined in Task 3, consumed in Task 4 (`ReasoningDisclosure`) and Task 5 (`toRecord`). `reasoning` on `SessionMessage` (Task 3) vs `ChatItem` (Task 3) — distinct types, both named `reasoning`, intentional.

---

## Open questions / verify-on-deploy

1. **`reasoningText` column order** — `reasoning_content` then `reasoning`; `reasoning_details` ignored. Confirm with a live sample from a reasoning-capable model; narrow if needed (spec §8 #3).
2. **`build_tool_preview` drift** — the port matches the local `display.py` checkout; the deployed gateway may differ. Task 4 Step 4 #4 is the spot-check. Graceful degradation if wrong (context line omitted).
3. **`brain` SF Symbol** — used for the disclosure; if it doesn't render on the target iOS version, swap for `sparkles` or `lightbulb` (cosmetic).
4. **Live reasoning parity** — reasoning is history-only (no `wireGateway` event). If the gateway emits a live main-agent reasoning delta, a follow-up adds the live case for parity (spec §8 #4); out of scope here.
