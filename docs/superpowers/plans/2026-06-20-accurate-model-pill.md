# Accurate Composer Model Pill (Feature 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the composer model pill show *this chat's* model (from `session.create`/`session.resume`/`session.info`) instead of the gateway default, falling back to the default only when the session model isn't known yet.

**Architecture:** A pure precedence module (`src/lib/model-pill.ts`, mirroring `subagent-progress.ts`) decides the pill label — the session's own model wins once known, else the gateway default. The chat screen feeds it three already-on-the-wire sources (create/resume `info.model`, the `session.info` event) plus the existing `getModelInfo` default as fallback.

**Tech Stack:** TypeScript, React Native (Expo SDK 56), Jest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-20-per-chat-model-design.md`.

---

## File Structure

- Create: `src/lib/model-pill.ts` — pure pill-state precedence (testable).
- Create: `src/lib/__tests__/model-pill.test.ts` — unit tests.
- Modify: `src/api/types.ts` — add `info` to `SessionResumeResult`; add `'session.info'` to `GatewayEventType`.
- Modify: `src/app/chat/[id].tsx` — feed the pill module from create/resume/session.info; `getModelInfo` becomes the fallback. (Glue — verified on-device + tsc.)

---

### Task 1: Pure model-pill precedence module

**Files:**
- Create: `src/lib/model-pill.ts`
- Test: `src/lib/__tests__/model-pill.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/model-pill.test.ts`:

```ts
import {
  emptyModelPill,
  withSessionModel,
  withFallbackModel,
  pillLabel,
} from '../model-pill';

test('empty pill has no label', () => {
  expect(pillLabel(emptyModelPill())).toBeNull();
});

test('fallback (gateway default) shows when no session model is known', () => {
  const s = withFallbackModel(emptyModelPill(), 'anthropic/claude-opus-4.8');
  expect(pillLabel(s)).toBe('claude-opus-4.8'); // display name (trailing path segment)
});

test('session model wins over the fallback default', () => {
  let s = withFallbackModel(emptyModelPill(), 'openrouter/glm-5.2');
  s = withSessionModel(s, 'openai/qwen3.7-max');
  expect(pillLabel(s)).toBe('qwen3.7-max');
});

test('clearing the session model falls back to the default', () => {
  let s = withFallbackModel(emptyModelPill(), 'openrouter/glm-5.2');
  s = withSessionModel(s, 'openai/qwen3.7-max');
  s = withSessionModel(s, null);
  expect(pillLabel(s)).toBe('glm-5.2');
});

test('undefined / empty model ids are treated as unknown (no crash, no label)', () => {
  let s = withSessionModel(emptyModelPill(), undefined);
  expect(pillLabel(s)).toBeNull();
  s = withFallbackModel(s, '');
  expect(pillLabel(s)).toBeNull();
});

test('a bare (non-namespaced) model id is shown as-is', () => {
  const s = withSessionModel(emptyModelPill(), 'qwen3.7-max');
  expect(pillLabel(s)).toBe('qwen3.7-max');
});

test('reducers are immutable (return new objects)', () => {
  const a = emptyModelPill();
  const b = withSessionModel(a, 'x/y');
  expect(b).not.toBe(a);
  expect(a.session).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest model-pill`
Expected: FAIL — `Cannot find module '../model-pill'`.

- [ ] **Step 3: Write the implementation**

`src/lib/model-pill.ts`:

```ts
// src/lib/model-pill.ts
//
// Which model the composer pill shows. The running chat's own model (from
// session.create/resume and the session.info event) wins once known; the
// gateway default (GET /api/model/info) is only a fallback for a brand-new
// lazy chat before its first prompt builds the agent.
import { modelDisplayName } from '@/api/models';

export interface ModelPillState {
  /** Display name of the running session's model, once known. */
  session: string | null;
  /** Display name of the gateway default — fallback before the session model is known. */
  fallback: string | null;
}

export function emptyModelPill(): ModelPillState {
  return { session: null, fallback: null };
}

const toName = (modelId: string | null | undefined): string | null =>
  modelId ? modelDisplayName(modelId) : null;

/** Set the session's model (session.create / session.resume / session.info). */
export function withSessionModel(s: ModelPillState, modelId: string | null | undefined): ModelPillState {
  return { ...s, session: toName(modelId) };
}

/** Set the gateway-default fallback (GET /api/model/info). */
export function withFallbackModel(s: ModelPillState, modelId: string | null | undefined): ModelPillState {
  return { ...s, fallback: toName(modelId) };
}

/** The pill label: the session's own model wins once known, else the default. */
export function pillLabel(s: ModelPillState): string | null {
  return s.session ?? s.fallback;
}
```

Note: `modelDisplayName('')` returns `'Not configured'`, but `toName` guards on the falsy id first, so empty/undefined → `null` (not `'Not configured'`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest model-pill`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/model-pill.ts src/lib/__tests__/model-pill.test.ts
git commit -m "feat(model): pure pill-precedence module (session model over default)"
```

---

### Task 2: Type the session-model sources

**Files:**
- Modify: `src/api/types.ts`

- [ ] **Step 1: Add `info` to `SessionResumeResult` and `'session.info'` to the event union**

In `src/api/types.ts`, replace:

```ts
/** session.resume reuses a live session or rebuilds it from stored state. */
export interface SessionResumeResult {
  session_id: string;
  resumed?: string;
}
```

with:

```ts
/** session.resume reuses a live session or rebuilds it from stored state. */
export interface SessionResumeResult {
  session_id: string;
  resumed?: string;
  /** Present on a built (non-lazy) resume; carries the session's own model. */
  info?: { model?: string; profile_name?: string; lazy?: boolean };
}
```

And in `GatewayEventType`, add `'session.info'` to the union (before the `(string & {})` line):

```ts
  | 'subagent.complete'
  | 'session.info'
  | 'error'
  | (string & {}); // forward-compatible
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean (exit 0). Type-only change.

- [ ] **Step 3: Commit**

```bash
git add src/api/types.ts
git commit -m "feat(model): type session.resume info.model and the session.info event"
```

---

### Task 3: Wire the pill in the chat screen

**Files:**
- Modify: `src/app/chat/[id].tsx`

This is screen glue (verified on-device); correctness is gated by `tsc` and the pure module's tests.

- [ ] **Step 1: Swap the module cache + import to the pill module**

Change the import at the top (line 11) from:

```ts
import { getModelInfo, modelDisplayName } from '@/api/models';
```

to (drop `modelDisplayName` — now only used inside `model-pill.ts`):

```ts
import { getModelInfo } from '@/api/models';
import {
  ModelPillState,
  emptyModelPill,
  withFallbackModel,
  withSessionModel,
  pillLabel,
} from '@/lib/model-pill';
```

Replace the module-level cache (line 41) from:

```ts
let cachedModelName: string | null = null;
```

to (cache the raw model id; the pill module applies the display name):

```ts
let cachedModelId: string | null = null;
```

- [ ] **Step 2: Replace the `modelName` state with pill state**

Replace (line 107):

```ts
const [modelName, setModelName] = useState<string | null>(cachedModelName);
```

with:

```ts
const [pill, setPill] = useState<ModelPillState>(() =>
  withFallbackModel(emptyModelPill(), cachedModelId),
);
const modelName = pillLabel(pill);
```

- [ ] **Step 3: Make `getModelInfo` set the fallback (not the whole pill)**

Replace the model-pill effect (lines ~454–468) body:

```ts
  // Composer model pill — best-effort, never blocks the chat.
  useEffect(() => {
    let stale = false;
    withAuthRetry((r) => getModelInfo(r))
      .then((info) => {
        cachedModelId = info.model;
        if (!stale) setPill((p) => withFallbackModel(p, info.model));
      })
      .catch(() => {
        // offline or older server — pill simply stays hidden
      });
    return () => {
      stale = true;
    };
  }, []);
```

(`withFallbackModel` only touches `fallback`, so it never clobbers a known session model — `pillLabel` keeps preferring `session`.)

- [ ] **Step 4: Capture the session's model on create and resume**

In `establish()` after `liveIdRef.current = resumed.session_id;` (≈ line 396) add:

```ts
      setPill((p) => withSessionModel(p, resumed.info?.model));
```

In the send path after `liveIdRef.current = created.session_id;` (≈ line 568) add:

```ts
        setPill((p) => withSessionModel(p, created.info?.model));
```

- [ ] **Step 5: Handle the `session.info` event (live model changes)**

In `wireGateway`'s `switch (e.type)` (after the `subagent.*` group, before `case 'error'`), add:

```ts
        case 'session.info':
          // The gateway pushes this when a session's model changes (e.g. an
          // in-chat /model switch). payload is the _session_info dict.
          if (e.payload?.model) setPill((p) => withSessionModel(p, e.payload.model));
          break;
```

- [ ] **Step 6: Verify compile + full suite**

Run: `npx tsc --noEmit`
Expected: clean (no unused `modelDisplayName`/`setModelName`/`cachedModelName` references remain).

Run: `npx jest`
Expected: all pass (existing + the 7 new model-pill tests).

- [ ] **Step 7: Commit**

```bash
git add src/app/chat/[id].tsx
git commit -m "feat(model): pill reflects the running chat's model (create/resume/session.info)"
```

---

## Final Verification

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx jest` — all pass (~+7 tests).
- [ ] On-device (manual): open a chat created with model A; change the default to B in Settings → the chat's pill still shows A (correct). Open a different/older chat → its pill shows its own model, not B.

## Self-Review notes

- **Type consistency:** `ModelPillState`, `withSessionModel`, `withFallbackModel`, `pillLabel`, `emptyModelPill` defined in Task 1 and used identically in Task 3. `SessionResumeResult.info.model` (Task 2) read in Task 3 Step 4.
- **No clobber:** `withFallbackModel` only sets `fallback`; `pillLabel` prefers `session`. So a late `getModelInfo` can't overwrite a known session model.
- **Lazy new chat:** before the first prompt there's no session model → `pillLabel` returns the fallback default, which is what the new chat will actually use. After `session.create`, `info.model` (or the next `session.info`) takes over.
- **Glue caveat:** Task 3 is screen wiring; the on-device check above is the acceptance test (per AGENTS.md, screens are verified on-device).
