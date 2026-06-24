# Tier 1 — Foreground Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat screen detect the app-foreground transition and re-establish a healthy gateway socket, and eliminate the latent double-reconnect bug, so a backgrounded session recovers instead of sitting silently dead.

**Architecture:** A new pure `src/lib/reconnect.ts` holds the foreground-reconnect decision (`shouldReconnect`) and backoff schedule (`backoffMs`, `MAX_RECONNECT_ATTEMPTS`) so they are unit-testable. `GatewayClient` gains an `isOpen` getter (reads the socket's numeric `readyState`) used as the liveness gate. The chat screen (`src/app/chat/[id].tsx`) adds an `AppState` listener that, on `'active'` with a dead/absent socket, resets live UI and drives a single-flight `reconnect()`; `establish()` tears down the previous client (detach handlers, then close) before adopting a new one.

**Tech Stack:** React Native 0.85 (`AppState`, `WebSocket`), Expo SDK 56, TypeScript, Jest (`jest-expo`), expo-router.

**Branch:** implement on `fix/foreground-reconnect` (branched from `main`). The design spec lives at `docs/superpowers/specs/2026-06-24-foreground-reconnect-rehydration-sync-design.md` (§4).

---

## File Structure

- **Create** `src/lib/reconnect.ts` — pure reconnect policy: `shouldReconnect`, `backoffMs`, `MAX_RECONNECT_ATTEMPTS`. No RN imports.
- **Create** `__tests__/reconnect.test.ts` — unit tests for the pure module.
- **Modify** `src/api/gatewayClient.ts` — add `readonly readyState?` to `SocketLike`; add `get isOpen()` to `GatewayClient`.
- **Modify** `__tests__/gatewayClient.test.ts` — extend `FakeSocket` with `readyState`; add `isOpen` + `onClose`-unsubscribe tests.
- **Modify** `src/app/chat/[id].tsx` — import the pure helpers + `AppState`; add `reconnectingRef` + `gwUnsubsRef`; capture handler unsubscribers in `wireGateway`; teardown-before-replace in `establish`; single-flight + `try/finally` + `backoffMs` in `reconnect`; `dropAndReconnect` helper; `AppState` listener + mount-guard ordering in the mount effect; defensive `isOpen` send guard.

---

## Task 1: Pure reconnect policy module

**Files:**
- Create: `src/lib/reconnect.ts`
- Test: `__tests__/reconnect.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/reconnect.test.ts`:

```typescript
import { shouldReconnect, backoffMs, MAX_RECONNECT_ATTEMPTS } from '../src/lib/reconnect';

describe('shouldReconnect', () => {
  it('reconnects on active when there is no socket', () => {
    expect(shouldReconnect({ hasSocket: false, isOpen: false, appState: 'active' })).toBe(true);
  });
  it('reconnects on active when the socket is not open', () => {
    expect(shouldReconnect({ hasSocket: true, isOpen: false, appState: 'active' })).toBe(true);
  });
  it('does not reconnect when the socket is open', () => {
    expect(shouldReconnect({ hasSocket: true, isOpen: true, appState: 'active' })).toBe(false);
  });
  it('does not reconnect on non-active app states', () => {
    expect(shouldReconnect({ hasSocket: false, isOpen: false, appState: 'background' })).toBe(false);
    expect(shouldReconnect({ hasSocket: false, isOpen: false, appState: 'inactive' })).toBe(false);
  });
});

describe('backoffMs', () => {
  it('doubles each attempt and caps at 8000ms', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });
});

describe('MAX_RECONNECT_ATTEMPTS', () => {
  it('is 5', () => {
    expect(MAX_RECONNECT_ATTEMPTS).toBe(5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/reconnect.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/reconnect'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/reconnect.ts`:

```typescript
// src/lib/reconnect.ts — pure reconnect/liveness policy (no RN imports), so the
// foreground-reconnect decision and backoff schedule are unit-testable.

export const MAX_RECONNECT_ATTEMPTS = 5;

/** Exponential backoff for reconnect attempt N (1-based), capped at 8s. */
export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

/** Decide whether an AppState transition should trigger a reconnect. Reconnect
 * only on the 'active' edge and only when the live socket is gone or not OPEN —
 * a healthy socket is left alone (no needless single-use-ticket churn). */
export function shouldReconnect(args: {
  hasSocket: boolean;
  isOpen: boolean;
  appState: string;
}): boolean {
  return args.appState === 'active' && (!args.hasSocket || !args.isOpen);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/reconnect.test.ts`
Expected: PASS (3 suites, 6 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/reconnect.ts __tests__/reconnect.test.ts
git commit -m "feat(reconnect): pure foreground-reconnect policy (shouldReconnect, backoffMs)"
```

---

## Task 2: GatewayClient liveness (`isOpen` + `readyState`)

**Files:**
- Modify: `src/api/gatewayClient.ts` (SocketLike interface lines 5-12; GatewayClient class 25-103)
- Test: `__tests__/gatewayClient.test.ts` (FakeSocket lines 5-16)

- [ ] **Step 1: Extend FakeSocket and write the failing tests**

In `__tests__/gatewayClient.test.ts`, replace the `FakeSocket` class (lines 5-16) with this version (adds `readyState` and sets it in `open()`/`close()`):

```typescript
class FakeSocket {
  sent: string[] = [];
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); }
  // test helpers
  open() { this.readyState = 1; this.onopen?.(); }
  receive(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
```

Then add these two tests inside the `describe('GatewayClient', ...)` block (after the existing `'rejects pending calls when the socket closes'` test, before the closing `});`):

```typescript
  it('isOpen reflects the socket readyState lifecycle', async () => {
    const sock = new FakeSocket();
    const client = new GatewayClient(() => sock as any);
    const ready = client.connect('ws://h/api/ws?ticket=t');
    expect(client.isOpen).toBe(false); // CONNECTING
    sock.open();
    await ready;
    expect(client.isOpen).toBe(true); // OPEN
    sock.close();
    expect(client.isOpen).toBe(false); // socket nulled on close
  });

  it('onClose unsubscribe detaches the handler so it does not fire on close', () => {
    const sock = new FakeSocket();
    const client = new GatewayClient(() => sock as any);
    client.connect('ws://h/api/ws?ticket=t');
    sock.open();
    let calls = 0;
    const off = client.onClose(() => { calls++; });
    off();
    sock.close();
    expect(calls).toBe(0);
  });
```

> Note: the `onClose`-unsubscribe test guards the existing contract the screen teardown (Task 3) relies on — it should pass immediately. The `isOpen` test is the red-first driver for this task.

- [ ] **Step 2: Run the tests to verify the isOpen test fails**

Run: `npx jest __tests__/gatewayClient.test.ts -t isOpen`
Expected: FAIL — `client.isOpen` is `undefined` (not a getter), so `expect(undefined).toBe(false)` passes by accident on the first assert but `expect(undefined).toBe(true)` fails after `open()`. (If it errors instead because `isOpen` is unknown on the type, that is also the expected red state.)

- [ ] **Step 3: Add `readyState` to SocketLike and the `isOpen` getter**

In `src/api/gatewayClient.ts`, add a `readyState` field to the `SocketLike` interface (lines 5-12) so it reads:

```typescript
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  /** Numeric WebSocket readyState (OPEN === 1). Optional so fakes/native need no change. */
  readonly readyState?: number;
  send(data: string): void;
  close(): void;
}
```

Then add this getter to the `GatewayClient` class, immediately after the `constructor` (after line 32):

```typescript
  /** True only when the underlying socket is OPEN (readyState === 1). A closed
   * or absent socket reads false (handleClose nulls this.socket at line 100). */
  get isOpen(): boolean {
    return this.socket?.readyState === 1;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/gatewayClient.test.ts`
Expected: PASS (all existing tests + the 2 new ones).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/api/gatewayClient.ts __tests__/gatewayClient.test.ts
git commit -m "feat(gateway): isOpen liveness getter + readyState on SocketLike"
```

---

## Task 3: Wire foreground reconnect into the chat screen

This task is screen glue (no unit test — verified on device per AGENTS.md). Apply each edit exactly, then run the typecheck/test gate and the on-device checklist.

**Files:**
- Modify: `src/app/chat/[id].tsx`

- [ ] **Step 1: Add the `AppState` import**

Change the `react-native` import (line 7) from:

```typescript
import { ActivityIndicator, FlatList, Pressable, Share, Text, View } from 'react-native';
```

to:

```typescript
import { ActivityIndicator, AppState, FlatList, Pressable, Share, Text, View } from 'react-native';
```

- [ ] **Step 2: Import the pure reconnect helpers and remove the local constant**

Add this import next to the other `@/lib` imports (e.g. after line 43 `import { parseTodoList } from '@/lib/todo';`):

```typescript
import { shouldReconnect, backoffMs, MAX_RECONNECT_ATTEMPTS } from '@/lib/reconnect';
```

Then delete the now-duplicated local constant (line 48):

```typescript
const MAX_RECONNECT_ATTEMPTS = 5;
```

- [ ] **Step 3: Add the new refs**

After the `todoKeyRef` declaration (line 135), add:

```typescript
  const reconnectingRef = useRef(false); // single-flight guard for reconnect()
  const gwUnsubsRef = useRef<Array<() => void>>([]); // current gw's onEvent/onClose detachers
```

- [ ] **Step 4: Capture handler unsubscribers in `wireGateway`, and add `dropAndReconnect`**

Replace the whole `wireGateway` function (lines 333-402). Keep the event/close bodies identical; the changes are: capture the `onEvent`/`onClose` return values into `gwUnsubsRef`, and route the close handler through a new shared `dropAndReconnect()`.

Replace from `function wireGateway(gw: GatewayClient) {` through its closing `}` (line 402) with:

```typescript
  /** Reset live UI to the disconnected state, then drive a guarded reconnect.
   * Shared by the socket onClose path and the AppState foreground path so both
   * converge on identical UI. Idempotent and cancelled-safe. */
  function dropAndReconnect() {
    if (cancelledRef.current) return;
    setReady(false);
    setStreaming(false);
    setWaiting(false);
    cancelPendingApprovals(); // can't answer across a dead socket
    finalizeSubagents(); // socket drop mid-delegation: seal the card / stop the ticker
    void reconnect();
  }

  function wireGateway(gw: GatewayClient) {
    const offEvent = gw.onEvent((e) => {
      switch (e.type) {
        case 'message.delta':
          appendDelta(e.payload?.text ?? '');
          break;
        case 'message.complete':
          finishAssistant();
          finalizeSubagents();
          cancelPendingApprovals(); // gateway force-denies leftovers on turn end
          setStreaming(false);
          setWaiting(false);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        case 'tool.start':
          setWaiting(false);
          finishAssistant();
          if (e.payload?.name === 'todo') break; // todo renders as TodoCard on complete
          startTool(e.payload);
          break;
        case 'tool.complete':
          if (e.payload?.name === 'todo') {
            if (!upsertTodo(e.payload)) append('status', 'Todo update failed');
            break;
          }
          completeTool(e.payload);
          break;
        case 'status.update':
          if (e.payload?.text) append('status', e.payload.text);
          break;
        case 'approval.request':
          setWaiting(false);
          finishAssistant();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          appendApproval(e.payload);
          break;
        case 'subagent.spawn_requested':
        case 'subagent.start':
        case 'subagent.thinking':
        case 'subagent.tool':
        case 'subagent.progress':
        case 'subagent.complete':
          handleSubagentEvent(e);
          break;
        case 'session.info':
          if (e.payload?.model) setPill((p) => withSessionModel(p, e.payload.model));
          break;
        case 'error':
          cancelPendingApprovals(); // gateway force-denies on interrupt/failure
          finalizeSubagents();
          setStreaming(false);
          setWaiting(false);
          setError(e.payload?.message ?? 'agent error');
          break;
      }
    });
    const offClose = gw.onClose(() => dropAndReconnect());
    gwUnsubsRef.current = [offEvent, offClose];
  }
```

- [ ] **Step 5: Teardown the previous client before adopting a new one in `establish`**

In `establish()` (lines 406-430), insert the teardown block between the cancelled check and `gwRef.current = gw;`. Replace:

```typescript
    gwRef.current = gw;
    wireGateway(gw);
```

with:

```typescript
    // Tear down any previous client BEFORE adopting the new one: detach its
    // handlers FIRST (so its later onclose can't fire a surviving reconnect),
    // then close it. Idempotent — no-ops on the initial connect (no prev gw).
    for (const off of gwUnsubsRef.current) off();
    gwUnsubsRef.current = [];
    gwRef.current?.close();
    gwRef.current = gw;
    wireGateway(gw);
```

- [ ] **Step 6: Single-flight + outer try/finally + backoffMs in `reconnect`**

Replace the entire `reconnect()` function (lines 432-455) with:

```typescript
  async function reconnect(): Promise<void> {
    if (reconnectingRef.current) return; // single-flight: one loop across onClose + foreground
    reconnectingRef.current = true;
    try {
      for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
        if (cancelledRef.current) return;
        setReconnectNote(`Connection lost — reconnecting (${attempt}/${MAX_RECONNECT_ATTEMPTS})…`);
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        if (cancelledRef.current) return;
        try {
          await establish();
          // Resync from the store: anything streamed while offline never reached us.
          if (storedIdRef.current) await loadHistory(storedIdRef.current);
          if (cancelledRef.current) return;
          setReconnectNote(null);
          setError(null);
          setReady(true);
          return;
        } catch {
          // next attempt with longer backoff
        }
      }
      if (!cancelledRef.current) {
        setReconnectNote(null);
        setError('Could not reconnect. Check your VPN or Wi-Fi, then reopen this chat.');
      }
    } finally {
      reconnectingRef.current = false; // clears on EVERY exit (success, cancel, exhaustion)
    }
  }
```

- [ ] **Step 7: Mount-effect guard ordering + AppState listener**

Replace the mount effect (lines 457-478) with:

```typescript
  useEffect(() => {
    cancelledRef.current = false;
    reconnectingRef.current = true; // hold off foreground reconnects during the initial connect
    (async () => {
      try {
        await hydrateProfileStore(); // no-op when sessions screen already ran
        profileRef.current = getProfileState().selected;
        if (id !== 'new') {
          storedIdRef.current = id;
          await loadHistory(id);
        }
        await establish();
        if (!cancelledRef.current) setReady(true);
      } catch {
        if (!cancelledRef.current) setError('Could not open a live session. Check your VPN or Wi-Fi.');
      } finally {
        reconnectingRef.current = false;
      }
    })();
    // Foreground revival: iOS suspends the runtime and the OS tears the socket
    // down without onclose firing. On return, if the socket is gone/not-open,
    // reset live UI and reconnect; a healthy socket is left untouched.
    const sub = AppState.addEventListener('change', (next) => {
      if (cancelledRef.current) return;
      if (
        shouldReconnect({
          hasSocket: !!gwRef.current,
          isOpen: gwRef.current?.isOpen ?? false,
          appState: next,
        })
      ) {
        dropAndReconnect();
      }
    });
    return () => {
      cancelledRef.current = true;
      sub.remove();
      gwRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
```

- [ ] **Step 8: Defensive send guard**

In `send()` (line 589), change:

```typescript
    if ((!text && !image) || !gw || streaming) return;
```

to:

```typescript
    if ((!text && !image) || !gw || !gw.isOpen || streaming) return;
```

- [ ] **Step 9: Typecheck + full test suite (no regressions)**

Run: `npx tsc --noEmit && npx jest`
Expected: typecheck clean; all suites pass (the Task 1/2 tests plus the unchanged existing suites).

- [ ] **Step 10: On-device verification (manual)**

Run: `npx expo run:ios --device` (or reload if the JS-only changes hot-reload).
Verify:
1. **Warm background recovery:** start a long agent task, background the app ~30–60s, foreground → a brief "Connection lost — reconnecting (1/5)…" note appears, then the completed/continuing turn renders (from `loadHistory`); the composer is disabled during the window and re-enabled after.
2. **No double-reconnect:** background mid-stream and foreground repeatedly → only one reconnect sequence at a time (watch Metro logs for a single ticket mint per recovery, not two interleaved loops).
3. **Healthy quick switch:** flip to another app for ~2s while the socket is still alive and return → NO "reconnecting" note, stream continues uninterrupted (`shouldReconnect` returned false).
4. **Send is blocked while reconnecting:** during the reconnect window the composer send is disabled and a tapped send does nothing (no user bubble against a dead socket).
5. **Light theme still renders** (AGENTS.md): toggle to light and repeat (1).

- [ ] **Step 11: Commit**

```bash
git add src/app/chat/[id].tsx
git commit -m "fix(chat): foreground reconnect + single-flight/teardown hardening"
```

---

## Self-Review (completed during authoring)

**Spec coverage (§4):** `readyState`-gated foreground reconnect → Tasks 1+2+3 (Step 7). Single-flight → Task 3 Step 6. Stale-handler teardown → Task 3 Steps 4-5. Entry-UX reset (G1) → `dropAndReconnect` (Step 4) used by both the onClose and foreground paths. Send guard (G2) → Step 4 (`setReady(false)` via `dropAndReconnect`) + Step 8 (defensive `isOpen`). Rehydration-on-foreground loss (G6) → accepted; documented in spec, no code needed. `try/finally` (G15) → Step 6. Mount-guard ordering (G14) → Step 7 (`reconnectingRef = true` before the first await, cleared in `finally`). Tests → Tasks 1-2; screen device-verified → Step 10. All §4 items covered.

**Placeholder scan:** none — every code step shows complete code; every run step shows the command + expected result.

**Type/name consistency:** `shouldReconnect`/`backoffMs`/`MAX_RECONNECT_ATTEMPTS` defined in Task 1 and consumed in Task 3 with matching signatures; `isOpen` defined in Task 2, consumed in Task 3 Steps 7-8; `reconnectingRef`/`gwUnsubsRef`/`dropAndReconnect` defined and used consistently within Task 3.

---

## Out of scope (later plans)

- **Tier 2** (rehydration fidelity: tool-call args/context + reasoning) — separate plan, separate PR.
- **Tier 3** (sidebar foreground refresh + push deep-link) — separate plan, separate PR, includes plugin work.
- **Zombie-OPEN socket** RPC liveness probe — deferred per spec §8 #7 unless on-device testing surfaces it.
