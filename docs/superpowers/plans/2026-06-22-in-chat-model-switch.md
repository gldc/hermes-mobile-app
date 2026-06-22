# In-Chat Model Switch (Feature 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the composer model pill switch the model *of the chat you're in* (session-scoped), via the gateway's existing `config.set` WS RPC — no `hermes-agent` or plugin change.

**Architecture:** A pure switch module (`src/api/sessionModel.ts`) wraps `config.set` and classifies the reply into a `SwitchOutcome` (`ok | confirm | busy | error`). A tiny `useSyncExternalStore` singleton (`src/session-model-store.ts`, mirroring `profile-store.ts`) hands the chat's live socket + current model + streaming flag to the `/models` route. The picker gains a `?scope=session` mode that switches *this* chat instead of the global default; the no-`scope` path (Settings/sidebar/attach) is unchanged. The pill updates from the resulting `session.info` event (already wired in Feature 2). The pill's two-slot precedence module is refactored to hold raw model ids (so the chat can publish the chat's current model id without duplicating precedence).

**Tech Stack:** TypeScript, React Native (Expo SDK 56), Jest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-20-per-chat-model-design.md` (Feature 1, revised 2026-06-22 to `config.set`).

---

## Gateway contract (verified, read-only)

- `config.set` RPC, `tui_gateway/server.py:7689`: params `{session_id, key:'model', value, confirm_expensive_model}`. `value` is a `/model` arg string. Switches the **live agent**, emits **`session.info`** (model at top level), returns `{value, warning, confirm_required, confirm_message}`.
- Turn in flight → **RPC error 4009** `"session busy — /interrupt the current turn before switching models"`.
- Expensive model → `{confirm_required:true, confirm_message}`; re-call with `confirm_expensive_model:true`.
- `parse_model_flags` (`hermes_cli/model_switch.py:302`) accepts `--provider <slug>`, `--global`, `--refresh`, `--session`; **default scope is session**. Model id is the bare leftover token.
- Reachable over the mobile WS with no allowlist (`tui_gateway/ws.py` reuses `server.dispatch`). The app's `GatewayClient.call` already speaks JSON-RPC over that socket.

---

## File Structure

- Modify: `src/lib/model-pill.ts` — store raw ids; add `pillModelId()`; derive display in `pillLabel()`.
- Modify: `src/lib/__tests__/model-pill.test.ts` — one assertion update + `pillModelId` tests.
- Modify: `src/api/gatewayClient.ts` — reject with `RpcError` carrying the JSON-RPC `code`.
- Modify: `__tests__/gatewayClient.test.ts` — RpcError code tests.
- Create: `src/api/sessionModel.ts` — `buildSessionModelValue`, `switchSessionModel`, `SwitchOutcome` (pure, injected `call`).
- Create: `__tests__/sessionModel.test.ts` — outcome classification tests.
- Create: `src/session-model-store.ts` — the chat→picker handoff singleton.
- Create: `__tests__/session-model-store.test.ts` — store tests.
- Modify: `src/app/models.tsx` — `?scope=session` mode (glue; on-device + tsc).
- Modify: `src/app/chat/[id].tsx` — publish the target; pill press carries `?scope=session` (glue; on-device + tsc).

---

### Task 1: Pill module stores raw ids + `pillModelId`

**Files:**
- Modify: `src/lib/model-pill.ts`
- Test: `src/lib/__tests__/model-pill.test.ts`

- [ ] **Step 1: Update the failing test expectations + add `pillModelId` tests**

In `src/lib/__tests__/model-pill.test.ts`, add `pillModelId` to the import block:

```ts
import {
  emptyModelPill,
  withSessionModel,
  withFallbackModel,
  withResumedModel,
  pillLabel,
  pillModelId,
} from '../model-pill';
```

Change the one assertion that reads the internal slot (the `'clearing the session model leaves the fallback intact'` test) — the slot now holds the **raw** id, not the display name:

```ts
test('clearing the session model leaves the fallback intact', () => {
  let s = withFallbackModel(emptyModelPill(), 'openrouter/glm-5.2');
  s = withSessionModel(s, 'openai/qwen3.7-max');
  s = withSessionModel(s, null);
  expect(s.session).toBeNull();
  expect(s.fallback).toBe('openrouter/glm-5.2'); // raw id retained (display applied in pillLabel)
});
```

Append `pillModelId` tests at the end of the file:

```ts
test('pillModelId is null for an empty pill', () => {
  expect(pillModelId(emptyModelPill())).toBeNull();
});

test('pillModelId returns the raw (namespaced) id, session winning over fallback', () => {
  let s = withFallbackModel(emptyModelPill(), 'openrouter/glm-5.2');
  expect(pillModelId(s)).toBe('openrouter/glm-5.2'); // fallback when no session
  s = withSessionModel(s, 'openai/qwen3.7-max');
  expect(pillModelId(s)).toBe('openai/qwen3.7-max'); // session wins, raw not display
  expect(pillLabel(s)).toBe('qwen3.7-max'); // label still the display name
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest model-pill`
Expected: FAIL — `pillModelId` is not exported; the `s.fallback` assertion fails against the old display-name storage.

- [ ] **Step 3: Rewrite the module to store raw ids**

Replace the body of `src/lib/model-pill.ts` with:

```ts
// src/lib/model-pill.ts
//
// Which model the composer pill shows, and the raw id behind it. The running
// chat's own model (session.create/resume + the session.info event) wins once
// known; the gateway default (GET /api/model/info) is only a fallback for a
// brand-new lazy chat before its first prompt builds the agent. State stores
// RAW model ids; the display name is derived in pillLabel().
import { modelDisplayName } from '@/api/models';

export interface ModelPillState {
  /** Raw id of the running session's model, once known. */
  session: string | null;
  /** Raw id of the gateway default — fallback before the session model is known. */
  fallback: string | null;
}

export function emptyModelPill(): ModelPillState {
  return { session: null, fallback: null };
}

const clean = (modelId: string | null | undefined): string | null => modelId || null;

/** Set the session's model (session.create / session.resume / session.info). */
export function withSessionModel(s: ModelPillState, modelId: string | null | undefined): ModelPillState {
  return { ...s, session: clean(modelId) };
}

/** Set the gateway-default fallback (GET /api/model/info). */
export function withFallbackModel(s: ModelPillState, modelId: string | null | undefined): ModelPillState {
  return { ...s, fallback: clean(modelId) };
}

/** Adopt a session-model report from session.create / session.resume — but
 * ONLY when the gateway actually built the agent. A `lazy` resume/create
 * reports the gateway DEFAULT (not the chat's own model), and an info-less
 * resume omits the model entirely; in both cases keep the model we already
 * know rather than clobber the session slot back to the default. */
export function withResumedModel(
  s: ModelPillState,
  info: { model?: string; lazy?: boolean } | undefined,
): ModelPillState {
  if (!info?.model || info.lazy) return s; // lazy / absent → nothing real to adopt
  return withSessionModel(s, info.model);
}

/** Raw id the pill represents: the session's own model once known, else the default. */
export function pillModelId(s: ModelPillState): string | null {
  return s.session ?? s.fallback;
}

/** The pill label (display name), or null when nothing is known. */
export function pillLabel(s: ModelPillState): string | null {
  const id = pillModelId(s);
  return id ? modelDisplayName(id) : null;
}
```

(`clean('')` → `null`, so empty/undefined ids stay unknown; `pillLabel` guards falsy before `modelDisplayName`, preserving the prior "no label" behavior.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest model-pill`
Expected: PASS (existing tests + the 2 new `pillModelId` tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/model-pill.ts src/lib/__tests__/model-pill.test.ts
git commit -m "refactor(model): pill state holds raw ids, add pillModelId()"
```

---

### Task 2: `RpcError` exposes the JSON-RPC error code

**Files:**
- Modify: `src/api/gatewayClient.ts`
- Test: `__tests__/gatewayClient.test.ts`

- [ ] **Step 1: Add the failing tests**

In `__tests__/gatewayClient.test.ts`, add an import for `RpcError`:

```ts
import { GatewayClient, RpcError } from '../src/api/gatewayClient';
```

Add two cases inside the `describe('GatewayClient', ...)` block:

```ts
  it('call() rejects with an RpcError carrying the JSON-RPC code', async () => {
    const { sock, client, ready } = connected();
    await ready;
    const p = client.call('config.set', { session_id: 'x', key: 'model', value: 'm' });
    const id = JSON.parse(sock.sent[0]).id;
    sock.receive({ jsonrpc: '2.0', id, error: { code: 4009, message: 'session busy' } });
    await expect(p).rejects.toBeInstanceOf(RpcError);
    await expect(p).rejects.toMatchObject({ code: 4009, message: 'session busy' });
  });

  it('defaults the error code to 0 when the frame omits it', async () => {
    const { sock, client, ready } = connected();
    await ready;
    const p = client.call('x', {});
    const id = JSON.parse(sock.sent[0]).id;
    sock.receive({ jsonrpc: '2.0', id, error: { message: 'no code' } });
    await expect(p).rejects.toMatchObject({ code: 0, message: 'no code' });
  });
```

(The existing `'call() rejects on JSON-RPC error response'` test uses `rejects.toThrow('boom')`, which still holds — `RpcError extends Error`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest gatewayClient`
Expected: FAIL — `RpcError` is not exported; rejections are plain `Error` without `code`.

- [ ] **Step 3: Implement `RpcError` and reject with it**

In `src/api/gatewayClient.ts`, add the class above the `GatewayClient` class (after the `Pending` type):

```ts
/** A rejected JSON-RPC call, carrying the gateway's numeric error code
 * (e.g. 4009 = session busy) so callers can branch on it without string-matching. */
export class RpcError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
    this.name = 'RpcError';
  }
}
```

In `handleFrame`, change the error rejection line from:

```ts
      if (frame.error) p.reject(new Error(frame.error.message ?? 'gateway error'));
```

to:

```ts
      if (frame.error)
        p.reject(
          new RpcError(
            frame.error.message ?? 'gateway error',
            typeof frame.error.code === 'number' ? frame.error.code : 0,
          ),
        );
```

(Leave the socket-close rejection in `handleClose` as a plain `Error` — it has no JSON-RPC code.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest gatewayClient`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/api/gatewayClient.ts __tests__/gatewayClient.test.ts
git commit -m "feat(gateway): reject calls with RpcError carrying the JSON-RPC code"
```

---

### Task 3: Pure session-model switch module

**Files:**
- Create: `src/api/sessionModel.ts`
- Test: `__tests__/sessionModel.test.ts`

- [ ] **Step 1: Write the failing tests**

`__tests__/sessionModel.test.ts`:

```ts
import { RpcError } from '../src/api/gatewayClient';
import { buildSessionModelValue, switchSessionModel, SESSION_BUSY_CODE } from '../src/api/sessionModel';

describe('buildSessionModelValue', () => {
  it('renders the model bare with --provider and --session', () => {
    expect(buildSessionModelValue('openrouter', 'glm-5.2')).toBe('glm-5.2 --provider openrouter --session');
  });
  it('passes a namespaced model id through unchanged', () => {
    expect(buildSessionModelValue('openai', 'openai/qwen3.7-max')).toBe(
      'openai/qwen3.7-max --provider openai --session',
    );
  });
});

describe('switchSessionModel', () => {
  const args = { sessionId: 's1', provider: 'openrouter', model: 'glm-5.2' };

  it('sends config.set with the built value and confirm flag, returns ok', async () => {
    const calls: any[] = [];
    const call = async (method: string, params: any) => {
      calls.push({ method, params });
      return { value: 'openrouter/glm-5.2' };
    };
    const out = await switchSessionModel(call as any, { ...args, confirmExpensive: true });
    expect(calls[0]).toEqual({
      method: 'config.set',
      params: {
        session_id: 's1',
        key: 'model',
        value: 'glm-5.2 --provider openrouter --session',
        confirm_expensive_model: true,
      },
    });
    expect(out).toEqual({ kind: 'ok', model: 'openrouter/glm-5.2' });
  });

  it('defaults confirm_expensive_model to false', async () => {
    let seen: any;
    const call = async (_m: string, params: any) => {
      seen = params;
      return {};
    };
    await switchSessionModel(call as any, args);
    expect(seen.confirm_expensive_model).toBe(false);
  });

  it('maps confirm_required to a confirm outcome (message → confirm_message)', async () => {
    const call = async () => ({ confirm_required: true, confirm_message: 'Pricey!' });
    expect(await switchSessionModel(call as any, args)).toEqual({ kind: 'confirm', message: 'Pricey!' });
  });

  it('confirm falls back to warning, then a default message', async () => {
    expect(await switchSessionModel((async () => ({ confirm_required: true, warning: 'W' })) as any, args)).toEqual({
      kind: 'confirm',
      message: 'W',
    });
    expect(await switchSessionModel((async () => ({ confirm_required: true })) as any, args)).toEqual({
      kind: 'confirm',
      message: 'This model may be costly. Switch anyway?',
    });
  });

  it('maps an RPC 4009 rejection to busy', async () => {
    const call = async () => {
      throw new RpcError('session busy — /interrupt the current turn before switching models', SESSION_BUSY_CODE);
    };
    expect(await switchSessionModel(call as any, args)).toEqual({ kind: 'busy' });
  });

  it('maps a "session busy" message without a code to busy', async () => {
    const call = async () => {
      throw new Error('session busy — try later');
    };
    expect(await switchSessionModel(call as any, args)).toEqual({ kind: 'busy' });
  });

  it('maps a busy warning in a successful reply to busy', async () => {
    const call = async () => ({ warning: 'session busy — /interrupt the current turn before switching models' });
    expect(await switchSessionModel(call as any, args)).toEqual({ kind: 'busy' });
  });

  it('maps other rejections to error with the message', async () => {
    const call = async () => {
      throw new RpcError('unknown provider', 5001);
    };
    expect(await switchSessionModel(call as any, args)).toEqual({ kind: 'error', message: 'unknown provider' });
  });

  it('returns ok with null model when value is absent', async () => {
    expect(await switchSessionModel((async () => ({})) as any, args)).toEqual({ kind: 'ok', model: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest sessionModel`
Expected: FAIL — `Cannot find module '../src/api/sessionModel'`.

- [ ] **Step 3: Write the implementation**

`src/api/sessionModel.ts`:

```ts
// src/api/sessionModel.ts
//
// In-chat (session-scoped) model switch — see
// docs/superpowers/specs/2026-06-20-per-chat-model-design.md (Feature 1).
//
// Rides the gateway's existing `config.set` RPC ({session_id, key:'model',
// value, confirm_expensive_model}) — no core or plugin change. The composer
// pill updates from the resulting `session.info` event (handled in
// chat/[id].tsx); this module only performs the switch and classifies the
// gateway's reply. I/O is injected (`call`) so it is unit-testable.
import type { GatewayClient } from './gatewayClient';
import { RpcError } from './gatewayClient';

/** Gateway `config.set` reply shape for key:'model'. */
export interface ConfigSetModelResult {
  value?: string;
  warning?: string;
  confirm_required?: boolean;
  confirm_message?: string;
}

export type SwitchOutcome =
  | { kind: 'ok'; model: string | null } // switched; `model` is the resolved id (if returned)
  | { kind: 'confirm'; message: string } // expensive-model gate — re-call with confirmExpensive
  | { kind: 'busy' } // a turn is in flight (RPC 4009)
  | { kind: 'error'; message: string };

/** RPC code the gateway returns when a turn is in flight (server.py:7709). */
export const SESSION_BUSY_CODE = 4009;
const BUSY_RE = /session busy/i;

/** Build the `config.set` value: model id bare, provider via --provider,
 * --session = explicit session scope (also the gateway's default scope). */
export function buildSessionModelValue(provider: string, model: string): string {
  return `${model} --provider ${provider} --session`;
}

/** Switch THIS session's model via the gateway `config.set` RPC.
 * `call` is `GatewayClient['call']` (injected for tests). */
export async function switchSessionModel(
  call: GatewayClient['call'],
  args: { sessionId: string; provider: string; model: string; confirmExpensive?: boolean },
): Promise<SwitchOutcome> {
  try {
    const res = await call<ConfigSetModelResult>('config.set', {
      session_id: args.sessionId,
      key: 'model',
      value: buildSessionModelValue(args.provider, args.model),
      confirm_expensive_model: Boolean(args.confirmExpensive),
    });
    if (res?.confirm_required) {
      return {
        kind: 'confirm',
        message: res.confirm_message || res.warning || 'This model may be costly. Switch anyway?',
      };
    }
    if (res?.warning && BUSY_RE.test(res.warning)) return { kind: 'busy' };
    return { kind: 'ok', model: res?.value ?? null };
  } catch (e) {
    if (e instanceof RpcError && e.code === SESSION_BUSY_CODE) return { kind: 'busy' };
    const message = e instanceof Error ? e.message : String(e);
    if (BUSY_RE.test(message)) return { kind: 'busy' };
    return { kind: 'error', message };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest sessionModel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/sessionModel.ts __tests__/sessionModel.test.ts
git commit -m "feat(model): pure session-scoped switch over config.set"
```

---

### Task 4: Chat→picker handoff store

**Files:**
- Create: `src/session-model-store.ts`
- Test: `__tests__/session-model-store.test.ts`

- [ ] **Step 1: Write the failing tests**

`__tests__/session-model-store.test.ts`:

```ts
import {
  __resetSessionModelStore,
  getSessionModelTarget,
  setSessionModelTarget,
  subscribeSessionModelTarget,
  type SessionModelTarget,
} from '../src/session-model-store';

const noopSwitch: SessionModelTarget['switchModel'] = async () => ({ kind: 'ok', model: null });

function target(over: Partial<SessionModelTarget> = {}): SessionModelTarget {
  return { sessionId: 's1', modelId: 'openai/qwen3.7-max', streaming: false, switchModel: noopSwitch, ...over };
}

beforeEach(() => __resetSessionModelStore());

describe('session-model-store', () => {
  it('starts empty', () => {
    expect(getSessionModelTarget()).toBeNull();
  });

  it('publishes and reads back the same target reference', () => {
    const t = target();
    setSessionModelTarget(t);
    expect(getSessionModelTarget()).toBe(t);
  });

  it('clears with null', () => {
    setSessionModelTarget(target());
    setSessionModelTarget(null);
    expect(getSessionModelTarget()).toBeNull();
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    let n = 0;
    const unsub = subscribeSessionModelTarget(() => {
      n++;
    });
    setSessionModelTarget(target());
    expect(n).toBe(1);
    unsub();
    setSessionModelTarget(null);
    expect(n).toBe(1);
  });

  it('returns a stable snapshot between emits (safe for useSyncExternalStore)', () => {
    setSessionModelTarget(target());
    expect(getSessionModelTarget()).toBe(getSessionModelTarget());
  });

  it('__resetSessionModelStore clears the target and listeners', () => {
    let n = 0;
    subscribeSessionModelTarget(() => {
      n++;
    });
    setSessionModelTarget(target());
    __resetSessionModelStore();
    expect(getSessionModelTarget()).toBeNull();
    setSessionModelTarget(target()); // listener was cleared by reset
    expect(n).toBe(1); // only the pre-reset emit counted
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest session-model-store`
Expected: FAIL — `Cannot find module '../src/session-model-store'`.

- [ ] **Step 3: Write the implementation**

`src/session-model-store.ts`:

```ts
// src/session-model-store.ts — hands the active chat's switch target to the
// /models picker (session mode), since the picker doesn't own the chat's
// WebSocket. Same shape as profile-store: module state + subscribe, consumed
// with useSyncExternalStore. The active chat publishes on connect/model/
// streaming change and clears (null) on unmount.
import type { SwitchOutcome } from '@/api/sessionModel';

export interface SessionModelTarget {
  /** Live session id to switch; '' when no session exists yet (new chat). */
  sessionId: string;
  /** Raw current model id of the chat (best-effort) — for the picker's current/selected display. */
  modelId: string | null;
  /** True while a turn is in flight — the picker disables switching. */
  streaming: boolean;
  /** Switch THIS chat's model on its live socket (session-scoped). */
  switchModel: (provider: string, model: string, confirmExpensive: boolean) => Promise<SwitchOutcome>;
}

let target: SessionModelTarget | null = null;
const listeners = new Set<() => void>();

function emit(next: SessionModelTarget | null): void {
  target = next;
  for (const l of [...listeners]) l();
}

export function getSessionModelTarget(): SessionModelTarget | null {
  return target;
}

export function subscribeSessionModelTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish (or clear with null) the active chat's switch target. */
export function setSessionModelTarget(next: SessionModelTarget | null): void {
  emit(next);
}

/** Test-only: reset module state between cases. */
export function __resetSessionModelStore(): void {
  target = null;
  listeners.clear();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest session-model-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session-model-store.ts __tests__/session-model-store.test.ts
git commit -m "feat(model): session-model-store hands the chat socket to the picker"
```

---

### Task 5: Picker `?scope=session` mode

**Files:**
- Modify: `src/app/models.tsx`

This is screen glue (verified on-device); correctness of the switch itself is gated by Task 3's tests. The no-`scope` (global) path must remain byte-for-byte behaviorally unchanged.

- [ ] **Step 1: Imports**

Change the `expo-router` import (line 9) from:

```ts
import { Stack, router } from 'expo-router';
```

to:

```ts
import { Stack, router, useLocalSearchParams } from 'expo-router';
```

Change the React import (line 10) from:

```ts
import { useCallback, useEffect, useState } from 'react';
```

to:

```ts
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
```

Add a store import after the theme import (after line 29):

```ts
import {
  getSessionModelTarget,
  subscribeSessionModelTarget,
  type SessionModelTarget,
} from '@/session-model-store';
```

- [ ] **Step 2: Read the scope + target at the top of `ModelsScreen`**

Immediately after `const { colors } = useTheme();` (line 214), add:

```ts
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  const target = useSyncExternalStore(subscribeSessionModelTarget, getSessionModelTarget);
  // Session mode only when opened from a chat that actually has a live session.
  const sessionMode = scope === 'session' && !!target && target.sessionId.length > 0;
  const sessionModelId = sessionMode ? target!.modelId : null;
  const sessionStreaming = sessionMode && !!target!.streaming;
```

- [ ] **Step 3: Add the session-switch handlers**

Add these two functions inside `ModelsScreen`, right after the existing `requestSwitch` function (after line 311):

```ts
  function requestSessionSwitch(provider: ProviderRow, modelId: string) {
    const t = target;
    if (busy || !t) return;
    if (t.streaming) {
      Alert.alert('Hermes is responding', 'Stop the current turn before switching this chat’s model.');
      return;
    }
    if (modelId === t.modelId) return;
    Alert.alert(
      'Switch this chat?',
      `This chat will use ${modelDisplayName(modelId)} via ${provider.name}. Other chats and new chats are unaffected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', onPress: () => void applySessionSwitch(t, provider.slug, modelId, false) },
      ],
    );
  }

  async function applySessionSwitch(
    t: SessionModelTarget,
    provider: string,
    model: string,
    confirmExpensive: boolean,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const outcome = await t.switchModel(provider, model, confirmExpensive);
    setBusy(false);
    switch (outcome.kind) {
      case 'ok':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back(); // back to the chat; the pill updates from session.info
        break;
      case 'confirm':
        Alert.alert('Expensive model', outcome.message, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Switch anyway',
            style: 'destructive',
            onPress: () => void applySessionSwitch(t, provider, model, true),
          },
        ]);
        break;
      case 'busy':
        Alert.alert('Hermes is responding', 'Stop the current turn before switching this chat’s model.');
        break;
      case 'error':
        setError(outcome.message || 'The gateway did not accept the model switch.');
        break;
    }
  }
```

- [ ] **Step 4: Branch the current card, the copy, and the rows on `sessionMode`**

Replace the `<CurrentModelCard ... />` and its following caption (lines 338–342):

```tsx
          <SectionTitle>Current</SectionTitle>
          <CurrentModelCard info={info} current={current} />
          <Text style={{ color: colors.textFaint, fontSize: 12.5, marginHorizontal: 4 }}>
            Changes apply to new chats on the gateway&apos;s default profile — running chats keep their model.
          </Text>
```

with:

```tsx
          <SectionTitle>{sessionMode ? 'This chat' : 'Current'}</SectionTitle>
          <CurrentModelCard
            info={sessionMode ? null : info}
            current={sessionMode ? { provider: '', model: sessionModelId ?? '' } : current}
          />
          <Text style={{ color: colors.textFaint, fontSize: 12.5, marginHorizontal: 4 }}>
            {sessionMode
              ? 'Switches this chat only. New chats use the default (change it in Settings).'
              : 'Changes apply to new chats on the gateway’s default profile — running chats keep their model.'}
          </Text>
          {sessionStreaming ? (
            <Text style={{ color: colors.textDim, fontSize: 12.5, marginHorizontal: 4 }}>
              Hermes is responding — stop the current turn to switch this chat&apos;s model.
            </Text>
          ) : null}
```

In the `<ModelRow .../>` (lines 352–360), change `selected`, `disabled`, and `onPress`:

```tsx
                    <ModelRow
                      modelId={m}
                      selected={sessionMode ? m === sessionModelId : current?.provider === p.slug && current?.model === m}
                      disabled={busy || sessionStreaming}
                      unavailable={isModelUnavailable(p, m)}
                      pricing={pricingLine(p.pricing?.[m])}
                      badges={hintBadges(p.capabilities?.[m])}
                      onPress={() => (sessionMode ? requestSessionSwitch(p, m) : requestSwitch(p, m))}
                    />
```

Update the `Stack.Screen` title (line 323) to reflect the mode:

```tsx
      <Stack.Screen options={{ title: sessionMode ? 'Switch model' : 'Model' }} />
```

- [ ] **Step 5: Verify compile**

Run: `npx tsc --noEmit`
Expected: clean. (`SessionModelTarget` is imported as a type; `applySessionSwitch` is referenced before definition only inside another function body, which is legal for hoisted function declarations.)

- [ ] **Step 6: Commit**

```bash
git add src/app/models.tsx
git commit -m "feat(model): picker ?scope=session switches the current chat"
```

---

### Task 6: Chat screen publishes the target + opens the picker in session mode

**Files:**
- Modify: `src/app/chat/[id].tsx`

Screen glue (verified on-device); the switch logic is Task 3, the pill update is Feature 2's existing `session.info` handler.

- [ ] **Step 1: Imports**

Add `pillModelId` to the existing `@/lib/model-pill` import block (the block that already imports `ModelPillState`, `emptyModelPill`, `withFallbackModel`, `withResumedModel`, `withSessionModel`, `pillLabel`):

```ts
  pillLabel,
  pillModelId,
} from '@/lib/model-pill';
```

Add two imports near the other `@/` imports (e.g. after the `@/api/models` import on line 11):

```ts
import { setSessionModelTarget } from '@/session-model-store';
import { switchSessionModel, type SwitchOutcome } from '@/api/sessionModel';
```

- [ ] **Step 2: Publish the switch target**

After the line `const modelName = pillLabel(pill);` (line 121), add a derived raw id:

```ts
  const modelName = pillLabel(pill);
  const currentModelId = pillModelId(pill);
```

Add a new effect immediately after the existing "Composer model pill" effect (after its closing `}, []);` on line 490):

```ts
  // Publish this chat's switch target so the /models picker (session mode) can
  // switch THIS chat over its live socket. The switchModel closure reads the
  // refs at call time, so it stays correct even if this object is stale.
  useEffect(() => {
    setSessionModelTarget({
      sessionId: liveIdRef.current ?? '',
      modelId: currentModelId,
      streaming,
      switchModel: (provider, model, confirmExpensive) => {
        const gw = gwRef.current;
        const sid = liveIdRef.current;
        if (!gw || !sid) {
          return Promise.resolve({ kind: 'error', message: 'Not connected.' } as SwitchOutcome);
        }
        return switchSessionModel(gw.call.bind(gw), { sessionId: sid, provider, model, confirmExpensive });
      },
    });
    return () => setSessionModelTarget(null);
  }, [currentModelId, streaming, ready]);
```

- [ ] **Step 3: Open the picker in session mode from the pill**

Change the composer prop (line 791) from:

```tsx
        onModelPress={() => router.push('/models')}
```

to:

```tsx
        onModelPress={() => router.push('/models?scope=session')}
```

- [ ] **Step 4: Verify compile + full suite**

Run: `npx tsc --noEmit`
Expected: clean (no unused imports; `SwitchOutcome` used in the closure's fallback cast).

Run: `npx jest`
Expected: all pass (existing suite + Tasks 1–4 additions).

- [ ] **Step 5: Commit**

```bash
git add src/app/chat/[id].tsx
git commit -m "feat(model): composer pill switches the current chat's model"
```

---

## Final Verification

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx jest` — all pass.
- [ ] On-device (manual):
  1. Open a running chat on model A; tap the pill → picker titled "Switch model", "This chat" shows A selected. Pick B → confirm "Switch this chat?" → returns to chat; pill flips to B (from `session.info`); a new chat still opens on the default.
  2. While Hermes is streaming, tap the pill: rows disabled + banner; if tapped anyway, "Hermes is responding" alert (no switch).
  3. Pick an expensive (cost-gated) model → "Expensive model" alert → "Switch anyway" → switches; pill updates.
  4. Settings → Model (no `scope`) still switches the **default for new chats** exactly as before; running chats keep their model.
  5. Brand-new chat (`/chat/new`, no message yet) → pill → picker behaves as the global default picker (no live session to scope to).

## Self-Review notes

- **Type consistency:** `SwitchOutcome` defined in Task 3, imported in Tasks 4 (store field type) and 6 (closure cast). `SessionModelTarget` defined in Task 4, imported in Task 5. `pillModelId` defined in Task 1, used in Task 6. `RpcError` defined in Task 2, imported in Task 3.
- **No global-path regression:** every session-only branch is gated on `sessionMode`, which is false without `?scope=session` AND a populated target — Settings/sidebar/attach never set the param, so they keep today's behavior.
- **No pill clobber:** the pill still updates only via `withFallbackModel`/`withResumedModel`/`withSessionModel` + the `session.info` handler (Feature 2). The session switch does **not** optimistically mutate the pill — it relies on `session.info`, the authoritative signal.
- **Busy detection is defense-in-depth:** client-side (`sessionStreaming` disables rows) + server-side (`config.set` 4009 → `busy` via `RpcError.code`, with a message-regex fallback if a future build returns the busy state as a `warning`).
- **Lazy/new chat:** `sessionId === ''` → `sessionMode` false → the picker falls back to the global default, which is the model a new chat will actually use. Coherent.
- **Glue caveat:** Tasks 5 & 6 are screen wiring; the on-device checklist is the acceptance test (AGENTS.md: screens are verified on-device).
```