# Foreground reconnect, rehydration fidelity & cross-surface sync — design

- **Date:** 2026-06-24
- **Status:** Reviewed (adversarial accuracy + completeness pass; 14 fixes applied), pending user sign-off → implementation plan
- **Author:** gldc (with Claude)
- **Delivery:** three sequenced PRs (Tier 1 → Tier 2 → Tier 3)

## 1. Background & problem

A user gave the agent a task, backgrounded the app, and returned to find the session
looking inactive with the live tool calls and reasoning gone; restarting the session from
the web dashboard did not sync to the app. Root-cause analysis (performed in-session against
the source; key findings summarized here) found three distinct problems:

1. **No foreground/background lifecycle handling.** The gateway WebSocket is owned per-chat-screen
   (`gwRef`, `src/app/chat/[id].tsx:126`). The only reconnect trigger is the socket's own
   `onclose` event (`gatewayClient.ts:96-102` → `chat/[id].tsx:393-401` → `reconnect()`). There is
   no `AppState` listener and no heartbeat. When iOS suspends the JS runtime and tears the socket
   down, nothing proactively recovers on foreground; the screen can sit at `ready=true` with a
   dead socket and no "reconnecting" note. There is also a **latent double-reconnect bug**:
   `establish()` overwrites `gwRef.current` without detaching the previous client's close handler
   (`chat/[id].tsx:412`; `wireGateway` discards the unsubscribers at `333-402`), so the orphaned
   socket's later `onclose` spawns a *second* concurrent `reconnect()` loop — churn that can trip
   the gateway's RT-reuse/revocation path.

2. **Lossy history rehydration.** `historyToItems` (`src/lib/history.ts:18-40`) rebuilds tool cards
   only from `role:'tool'` result rows (name + result) and drops the assistant rows carrying the
   `tool_calls[]` invocation, so reloaded cards lose the invocation args/context the live cards show
   (`startTool` uses `payload.context`, `chat/[id].tsx:168-176`). The server also persists reasoning
   columns the app never reads or renders.

3. **No cross-surface sync.** The sidebar is a static REST snapshot refreshed only on drawer-open /
   pull-to-refresh (`sidebar.tsx:153-156`; `RefreshControl` at `:575`); push payloads carry only `{type}`
   (`session_notify.py:176`) and `_layout.tsx:16` hardwires taps to `/chat/new`.

The app's recovery model is otherwise sound: per the plugin design doc the host runs the agent to
completion and persists the turn server-side on a WS drop, and the app re-syncs via
`GET /api/sessions/{id}/messages` on reconnect/reopen. The work below makes that recovery actually
fire (Tier 1), lose less on the way back (Tier 2), and reflect out-of-band activity (Tier 3).

## 2. Scope & locked decisions

Three independent subsystems, delivered as three sequenced PRs:

| Tier | What | Blast radius |
|---|---|---|
| 1 | Foreground reconnect + single-flight/teardown hardening | app-only |
| 2 | Rehydration fidelity: tool-call args/context **and** reasoning rendering | app-only |
| 3 | Cross-surface sync: sidebar foreground refresh + push deep-link to a session | app + plugin |

**Locked decisions (from scoping):**
- **T1 liveness:** `readyState`-only gate. Accepts the rare zombie-OPEN socket (recovers on next
  send → `onClose` → reconnect). No RPC probe in v1.
- **T2 reasoning:** include reasoning rendering (history-only) **in addition to** tool-call fidelity.
- **T3 push:** claimed-only sessions, device-targeted send (no cross-device id leak). Dashboard-started
  runs stay no-deep-link in v1.
- **T3 live status:** out of scope (server-required — see §6).

## 3. Grounding corrections (verified)

- The test files this work extends (gatewayClient/history/push/restClient) live in the **top-level**
  `/__tests__/` dir (jest `testMatch: '**/__tests__/**/*.test.ts'`, package.json:58-60, preset `jest-expo`).
  `src/lib/__tests__/` **also** exists (model-pill, subagent-progress, todo) and is collected by the same
  recursive glob — placement in top-level `/__tests__/` is a convention (proximity to the files extended),
  not a glob constraint.
- `__tests__/gatewayClient.test.ts` **already exists** with a working `FakeSocket` — Tier 1 extends it.
- `__tests__/history.test.ts` **already exists** — Tier 2 extends it.
- `__tests__/push.test.ts` and `__tests__/restClient.test.ts` exist — Tier 3 extends `push.test.ts`.
- Gate before every PR (AGENTS.md): `npx tsc --noEmit && npx jest`. Plugin (Tier 3) must run with the
  hermes-agent packages on PYTHONPATH: `PYTHONPATH=/path/to/hermes-agent python -m pytest tests/ -q`
  (per the plugin README) — a bare checkout fails on `gateway` imports (pre-existing, not our change);
  to exercise only the new assertions, scope with `-k 'not session_context'`.

---

## 4. Tier 1 — Foreground reconnect (PR #1, app-only)

### Goal
Detect the foreground transition and re-establish a healthy socket; eliminate the double-reconnect
bug by serializing all reconnect entrypoints and tearing down replaced clients.

### Approach (chosen)
`readyState`-gated foreground reconnect + single-flight serialization + stale-handler teardown.
On `AppState` `'active'`: if `!gwRef.current || !gw.isOpen`, run the guarded `reconnect()`; otherwise
no-op. Liveness comes from the socket's numeric `readyState` (OPEN === 1), surfaced through
`SocketLike` — no server round-trip, no ticket churn on healthy sockets. The existing
`establish() → session.resume` stays the recovery; `reconnect()` stays the bounded backoff loop.

*Rejected:* unconditional reconnect on every `'active'` (needless 30s-ticket / RT-rotation churn);
RPC probe with timeout (more than v1 needs — deferred as future hardening for zombie sockets).

### Changes (app-only)

**`src/api/gatewayClient.ts`**
- `SocketLike` (5-12): add `readonly readyState?: number;` (optional → `FakeSocket` and
  `makeNativeSocket` need no change; RN `WebSocket` already exposes numeric `readyState`).
- `GatewayClient`: add `get isOpen(): boolean { return this.socket?.readyState === 1; }`.
  `this.socket` is nulled in `handleClose` (100), so closed/absent reads not-open for free.

**`src/lib/reconnect.ts`** (new, pure — no RN imports)
- `shouldReconnect({ hasSocket, isOpen, appState })`: `true` iff
  `appState === 'active' && (!hasSocket || !isOpen)`.
- `backoffMs(attempt)`: `Math.min(1000 * 2 ** (attempt - 1), 8000)` (currently inline at `:436`).
- `MAX_RECONNECT_ATTEMPTS = 5` (currently inline at `:48`). Screen imports these so loop and test
  share one source. The in-flight flag stays a screen ref (it's glue).

**`src/app/chat/[id].tsx`**
- (a) `reconnectingRef = useRef(false)`: `reconnect()` (432-455) check-then-sets the flag on entry
  (before its first await), early-returning if already true. **There is no function-level `try/finally`
  today** — only a per-attempt `try/catch` (438-449) and a post-loop failure branch (451-454). Wrap the
  **entire** body (the for-loop AND the failure branch) in a NEW `try { … } finally { reconnectingRef.current = false }`
  so the flag clears on **every** exit — success `return` (446), cancelled early-returns (434/437/442), and
  exhausted attempts (451-454). Keep the per-attempt `try/catch` nested inside the loop; do **not** clear
  the flag only there or only in the failure branch (that would latch it `true` on the success path and
  permanently wedge all future reconnects). Serializes `onClose` (400), foreground, and the initial path.
- (b) Stale-handler teardown in `establish()` (406-430): capture the unsubscribe fns returned by
  `gw.onEvent`/`gw.onClose` in `wireGateway` (333-402); store on a ref. **Before** adopting a new gw
  (`gwRef.current = gw`, 412), call the previous gw's unsubscribers **first**, then `prevGw.close()`,
  so the old socket's `onclose → handleClose` can't fire a surviving `closeHandler → reconnect()`.
- (c) `AppState` listener in the mount effect (457-478), mirroring `settings.tsx:174-193`:
  `const sub = AppState.addEventListener('change', (next) => { if (cancelledRef.current) return; if (shouldReconnect({ hasSocket: !!gwRef.current, isOpen: gwRef.current?.isOpen ?? false, appState: next })) void reconnect(); });`
  add `sub.remove()` to the existing cleanup (473-476); add `AppState` to the `react-native` import.
- (d) Run the initial `establish()` (467) under the same single-flight guard. Set
  `reconnectingRef.current = true` **synchronously before the mount IIFE's first await** (before
  `hydrateProfileStore` at 461, not merely before `establish` at 467), and clear it in that IIFE's
  `finally`. Otherwise, during the mount awaits `gwRef.current` is null → `shouldReconnect` returns true
  (`!hasSocket`) → a foreground `'active'` edge fires a concurrent `reconnect()` in the null-gwRef window.

### Foreground entry state (UX) — G1/G2

Because a suspended-runtime foreground bypasses `onClose`, the screen sits at `ready=true` (composer
enabled via `disabled={!ready}`, :811) with possibly stale `streaming`/`waiting`, live `ThinkingDots`,
and still-actionable approval cards pointed at a dead `gw`. **In the AppState handler, before calling
`reconnect()`, mirror `onClose`'s reset (395-399):** `setReady(false)`, `setStreaming(false)`,
`setWaiting(false)`, surface `reconnectNote`, `cancelPendingApprovals()`, `finalizeSubagents()`. Make it
idempotent so the foreground and `onClose` paths converge on identical UI. The `setReady(false)` here is
also the **send guard**: the existing `disabled={!ready}` composer contract must hold for the whole
foreground-reconnect window (`send()` at :589 gates only on `!gw || streaming`, NOT `ready`/`isOpen`, so
without this a send would hit the torn socket after clearing input/appending a bubble). If preferred over
relying on the composer contract, extend the :589 guard with `|| !gw.isOpen || reconnectingRef.current`.

### Rehydration on foreground — G6

The foreground `reconnect()` runs `loadHistory()`, a full `setItems(historyToItems(...))` **replace**
(history.ts:326). `historyToItems` emits only user/assistant/tool items, so live-only subagent monitor
cards, the rich TodoCard, status lines, and any uncommitted streaming partial are dropped on every
foreground reconnect (now far more frequent under Tier 1). **Accepted in v1:** the server session DB is
the source of truth and these are ephemeral live decorations with no DB persistence; completed assistant
text + tool cards are restored. (Interacts with the `activeSubagentKeyRef`/`todoKeyRef` clearing at
329-330.) Tier 2 narrows this loss for tool cards; subagent/todo/status remain live-only by design.

### Data flow
`AppState 'active'` → `shouldReconnect` → guarded `reconnect()` → `backoffMs` wait → `establish()`
(`openGateway` mint ticket → `connect` → `session.resume` if `storedIdRef`) → `loadHistory` resync
(441) → `setReady(true)`. Healthy socket → no-op.

### Error handling
- `reconnectingRef` clears in the new function-level `finally` per (a) — every exit path, not just the
  failure branch.
- Old-gw `close()` may reject in-flight pending RPCs (`handleClose`, 98) — acceptable; already orphaned.
- `cancelledRef` (set in cleanup, 474) short-circuits the listener and the loop.

### Tests (TDD, failing-first)
- Extend `__tests__/gatewayClient.test.ts`: add mutable `readyState` to `FakeSocket`; assert `isOpen`
  false before open / true after open+`readyState=1` / false after close. **Orphaned-handler test:** two
  fake sockets + two clients simulating `establish()` replacement; a counting close handler; fire the
  OLD socket's `onclose` — red today (handler still fires), green after unsubscribe-before-replace.
- New `__tests__/reconnect.test.ts`: `shouldReconnect` truth table; `backoffMs` schedule
  (1000, 2000, 4000, 8000, 8000).
- Screen wiring (`AppState`, refs) stays device-verified per AGENTS.md.

### Risks / verification
- Zombie-OPEN socket survives a foreground (accepted; recovers on next send). Future hardening = RPC probe.
- Teardown ordering: `close()` before unsubscribe re-triggers reconnect — enforce order in (b).
- Guard must cover the mount path (d), else a foreground during first connect double-runs.
- Spurious `'active'` edges (permission dialog / share-sheet dismiss) must be cheap → strict `!isOpen` gate.

---

## 5. Tier 2 — Rehydration fidelity (PR #2, app-only)

### Goal
On reload/reconnect, restore tool-call invocation **context** (and keep cards faithful to the live
path), and render the **reasoning** the server already persists.

### 5a. Tool-call fidelity

**Approach (chosen):** two-pass merge with a shared pure helper.
Pass 1 (index-only): for every assistant row, if `Array.isArray(m.tool_calls)`, index each entry under
`tc.id ?? tc.call_id` (skip entries with neither) into `Map<callId, {name, argsJson}>`. The gateway's own
join is `id`-first with `call_id` fallback (gateway/run.py), so a `call_id`-only invocation must still
join. A non-array `tool_calls` (server returns `[]` on corrupt JSON, but be defensive) is skipped — no
throw; the row falls through to text handling.
Pass 2: emit each `role:'tool'` card **at the tool RESULT row's iteration position** (never the invocation
row — preserves existing card order), join on `m.tool_call_id`, `JSON.parse` args in try/catch (malformed →
card with no `context`, never throw), derive `context` via `toolContextFromArgs`. Two-pass (not single
forward pass) is robust to row reordering. Contract confirms the join:
`assistant.tool_calls[i].id === tool.tool_call_id`, and `function.arguments` is a JSON **string**
(`docs/contracts/sessions-extra.md:146-159`).

**Changes:**
- `src/api/types.ts`: extend `SessionMessage` (24-35) with `tool_calls?: ToolCall[] | null;`; define
  `ToolCall = { id?: string; call_id?: string; type?: string; function?: { name?: string; arguments?: string } }`.
- `src/lib/tool-context.ts` (new, pure): `toolContextFromArgs(name: string, args: unknown): string | undefined`
  → replicate the gateway's `build_tool_preview` (agent/display.py — the function that populates the live
  `payload.context`): real key map e.g. `terminal→command`, `read_file`/`write_file`/`patch→path`,
  `browser_navigate→url`, `web_extract→urls`, …, truncated to ~80 chars, unknown → `undefined`. **Verify
  the exact key map against the deployed gateway before finalizing** (do not invent keys).
- `src/lib/history.ts`: rewrite `historyToItems` to the two-pass merge. **Unified per-assistant-row rule**
  (covers 5a + 5b): Pass 1 harvests `tool_calls` from EVERY assistant row unconditionally (independent of
  emission); in Pass 2 emit exactly ONE assistant item **iff `messageText(m)` OR `reasoningText(m)` is
  non-empty**, carrying `text` (possibly `''`) and `reasoning`. A row never yields >1 assistant item or a
  tool card. Keep title from `m.tool_name` (stable; invocation only supplies args/context); keep
  `MAX_TOOL_DETAIL=4000` for tool detail and cap reasoning length the same way.
- `src/app/chat/[id].tsx`: **do NOT** refactor `startTool` to parse `payload.args_text`. Verified: live
  `tool.start` already carries a server-derived `payload.context` one-liner plus a verbose `args_text`
  **string** (not a structured args object), so a `toolContextFromArgs(name, args)` fallback would be inert
  when `context` is present and cannot reproduce parity from `args_text`. Because `toolContextFromArgs` and
  `build_tool_preview` derive from the same key map, live (`payload.context`) and reloaded
  (`toolContextFromArgs` over persisted args) cards already match in practice. Leave `startTool` unchanged
  and document the (minor) source asymmetry; revisit only if on-device shows a mismatch.

**Caveat (no UI promise we can't keep):** the live `diff` comes from gateway `payload.inline_diff`
(`chat/[id].tsx:206`), which is **not** persisted — so Tier 2 restores args/context but **not** the
server-rendered diff, `durationS`, or `summary`. Rehydrated cards lack those (deliberate, visible
asymmetry; documented).

### 5b. Reasoning rendering (history-only)

**Approach (chosen):** attach reasoning to the assistant `ChatItem`; render a collapsible disclosure.
No new `ChatItem` role.

**Changes:**
- `src/api/types.ts`: add `reasoning?: string | null; reasoning_content?: string | null; reasoning_details?: string | null;`
  to `SessionMessage` (assistant rows only, per contract).
- `src/lib/message-text.ts` (or `history.ts`): add `reasoningText(m)` picking the first non-empty of
  `reasoning_content`, `reasoning`, then a best-effort parse of `reasoning_details` (a fallback chain so
  it's correct regardless of which column the model family populates).
- `src/lib/history.ts`: compute `reasoning = reasoningText(m)` per the unified emit rule in §5a (emit when
  prose OR reasoning; set `item.reasoning`); cap reasoning length alongside `MAX_TOOL_DETAIL`.
- `src/components/message-row.tsx`: add `reasoning?: string` to `ChatItem` (28-47). In the assistant
  branch (169-195), when `item.reasoning` is present, render a collapsible **"Reasoning"** disclosure
  above the prose, reusing the `LayoutAnimation` expand pattern from `ToolCallCard` (60-63, 106-119),
  collapsed by default, body via `MarkdownView` (it's prose — not Menlo monospace). **Emitting
  reasoning-only items (`text:''`) relaxes the prior no-empty-assistant invariant (history.ts:23) — audit
  consumers:** skip the empty `<MarkdownView text="" />` when text is empty (186); make long-press Share a
  no-op (or share the reasoning) on empty text (175-181, currently `Share.share({message:''})`); decide
  whether JSONL export (`toRecord`) includes reasoning or skips empty-text-empty-reasoning items
  (`exportAsText` already returns null — fine).

**Asymmetry (accepted v1 product call):** there is no live main-agent reasoning event in
`GatewayEventType` (`types.ts:61+`) or `wireGateway` — only `subagent.thinking`. So reasoning shows on
**reloaded** turns, not live ones. Verification point: confirm whether the gateway emits a live
main-agent reasoning/thinking delta; if it does and is cheap, a follow-up can add a `reasoning.delta`
case to `wireGateway` for live/history parity. Not required for this PR.

### Tests (TDD, failing-first)
- Extend `__tests__/history.test.ts`:
  - Merge: assistant `tool_calls:[{id:'call_1', function:{name:'write_file', arguments:'{"path":"/a.ts"}'}}]`
    + tool `{tool_name:'write_file', tool_call_id:'call_1', content:'{"bytes_written":3}'}` → exactly one
    item with `tool.context==='/a.ts'`, `name==='write_file'`, `running:false`, `detail` from content.
  - Interleaved invocations/results → each card gets its own `context` by id (no last-write-wins).
  - Malformed args (`'not json'`) → no throw, card with no `context`.
  - Non-array `tool_calls` (`{}` / `'corrupt'`) → no throw; row falls through to text handling.
  - `call_id`-only invocation (`tc.call_id` set, `tc.id` absent) still joins to its result card.
  - Emission position: assistant(tool_calls, no prose) → unrelated assistant prose → tool(result) yields
    `[assistant-prose, tool]` with merged context **at the result position** (guards card order; mirrors
    the existing order test).
  - Orphan tool row (no invocation) → today's name+detail card (regression).
  - Reasoning: assistant `{content:'answer', reasoning_content:'because'}` → `item.reasoning==='because'`,
    `item.text==='answer'`; reasoning-only row (`content:''`, `reasoning:'x'`) → emitted with empty text.
  - Combined row (5a+5b): assistant `{content:'ans', reasoning_content:'why', tool_calls:[{id:'c1', function:{name:'write_file', arguments:'{"path":"/a.ts"}'}}]}`
    + tool `{tool_call_id:'c1'}` → exactly **2** items: assistant(`text:'ans'`, `reasoning:'why'`) + one
    tool card (`context:'/a.ts'`); nothing dropped or duplicated.
- New `__tests__/tool-context.test.ts`: real `build_tool_preview` keys — `terminal→command`,
  `write_file`/`read_file`/`patch→path`, `browser_navigate→url`, unknown→`undefined`.
- `ToolCallCard`/reasoning disclosure render = device-verified.

### Cross-tier note
Tier 2's `loadHistory` runs inside Tier 1's `reconnect()` (441). No file-level conflict (Tier 1 = reconnect
machinery; Tier 2 = parsing/render), but ship after Tier 1 so the foreground resync path that exercises
fidelity already exists.

---

## 6. Tier 3 — Cross-surface sync (PR #3, app + plugin)

Two independent asks shippable together.

### 6a. Sidebar foreground refresh (app-only, trivial)
- `src/components/sidebar.tsx`: add `AppState` to the `react-native` import; add a sibling effect to the
  open-driven one (153-156): on `'active' && open`, call the existing `load()` (106-132); `sub.remove()`
  in cleanup; deps `[open, load]`. Optional `{silent?}` arg to `load()` to skip the `setRefreshing(true)`
  spinner (107) on the foreground path. Reuses `load()` verbatim (auth-retry + pinned-survivor merge).

### 6b. Push deep-link to a session (app + plugin)

**Approach (chosen):** plugin emits the persistent stored session id into `data`; app routes via a
new pure `routeForPushData`. **Device-targeted** send only (no broadcast of a session id). Scope to
claimed sessions (the only ones that get a push today — dashboard runs resolve `device_id=None` and
skip, `session_notify.py:127-135`).

**App changes:**
- `src/lib/push.ts`: add pure `routeForPushData(data: unknown): string` → `/chat/<id>` when `data` has a
  non-empty `session_id`, else `/chat/new`. Defensive parse like `shouldSuppressForeground` (15-20).
- `src/notifications.ts`: widen `setupNotificationHandling(onTap)` (192) so `onTap` receives the data arg;
  pass `response.notification.request.content.data` through the
  `addNotificationResponseReceivedListener` (202). Fix the stale "pushes carry no data" comment (187-191).
- `src/app/_layout.tsx`: replace `setupNotificationHandling(() => router.navigate('/chat/new'))` (16) with
  `setupNotificationHandling((data) => router.navigate(routeForPushData(data)))`; fix comment (12-15).
- **Cold-start tap (REQUIRED, not optional):** `addNotificationResponseReceivedListener` (notifications.ts:202)
  only fires while the JS runtime is alive — the headline case (phone locked, agent finishes, user taps
  later after iOS killed the app) loses the `session_id`. On mount (in `_layout.tsx` / `notifications.ts`)
  call `Notifications.getLastNotificationResponseAsync()` (or `useLastNotificationResponse`) and route via
  `routeForPushData(...)` if present and not already consumed by the live listener (guard double-routing).
  **Sequence AFTER the connect-screen restore** so its `router.replace('/chat/new')` (index.tsx:35) does
  not clobber the deep-link target (resolves open question #4).
- `src/app/chat/[id].tsx`: **no change** — the route param `id` is the persistent **stored** id
  `loadHistory` uses (323-326, `storedIdRef` 128), exactly what the plugin must emit. Cold-start handling
  below is **required**, not optional.

**Plugin changes (`~/Developer/hermes-mobile-plugin`):**
- **The hooks carry only runtime ids, and the registry returns only `device_id` — there is no live→stored
  map.** `on_session_end` receives `session_id`+`task_id`; `on_pre_approval_request` receives
  `session_key` (session_notify.py:109-115, 143-145). `SessionClaimRegistry` maps each claimed id →
  `device_id` (39-59); the app claims via `claimSession(LIVE, STORED)` → `{session_id: live, session_key: stored}`
  (restClient.ts:184-189 → plugin_api.py:157). So:
  - **Approval path:** `session_key` IS the stored/route id — thread it straight into `data.session_id`.
  - **`session_end` path:** the hook id is the LIVE id; the stored id is **not recoverable** from the
    registry today. Either (i) confirm the gateway's `session_id`/`task_id` already equals the stored id
    (open question #1 — likely not), or (ii) extend the registry to retain and return the canonical stored
    id (e.g. `resolve()` → `(device_id, stored_id)`, captured from the app's `session_key`). **Do not wire
    the `session_end` emit until the emitted id is verified to equal the route/stored id.**
- `hermes_mobile/session_notify.py`: emit `data={"type": notif_type, "session_id": <STORED id>}` through
  `_fan_out` (173-178). Body stays redacted. `push.py` needs no change (forwards `data` verbatim, 76-77).
- `hermes_mobile/session_notify.py`: make the send **device-targeted** — `_fan_out` currently broadcasts to
  every tokened device and ignores the resolved `device_id` (127, 148, 162-178). Pass the already-resolved
  `device_id` into `_fan_out` and replace the `_tokened_devices()` broadcast with a single
  `self._store.get_push_token(device_id)` call (`DeviceStore.get_push_token`, device_store.py:295-302 —
  already exists, returns `None` for revoked/unknown, preserving the gate); send once. Cron stays broadcast
  (no id). This is a ~10-line change reusing existing machinery, not new infrastructure.
- `tests/test_session_notify.py`: see strengthened tests in §6b Tests below (assert emitted id == STORED;
  two-device isolation is **required**, not optional).

**Data flow:** run ends/needs approval → hook resolves `device_id` from the claim registry (bound at
`chat/[id].tsx:426-428` resume / `621-623` create) → `_fan_out(body, type, session_id)` → device-targeted
`push.send(token, body, data={type, session_id})` → tap → `addNotificationResponseReceivedListener` →
`onTap(data)` → `routeForPushData` → `router.navigate('/chat/<stored_id>')` → `loadHistory`.

### Live/running status — NOT in this PR (server-required)
`SessionSummary.is_active` (`types.ts:11`) is computed server-side as
`ended_at IS NULL AND (now - last_active) < 300` — a **5-minute recency heuristic**, NOT "turn in flight"
(and NOT the messages-table `active` soft-delete flag). It goes false when a run ends or after 5 min idle,
so it is too coarse/stale to render as a live "running" dot. True live status needs a per-row flag derived
from the gateway's in-memory active-session set. Excluded from app-only Tier 3; if/when a real flag exists,
the app render is a trivial accent dot in `session-row.tsx`. (Confirm the exact heuristic/line on the
deployed server — see §8.)

### Tests (TDD, failing-first)
- App: extend `__tests__/push.test.ts` — `routeForPushData({type,session_id:'abc'})==='/chat/abc'`;
  `{}` / `undefined` / `{session_id:''}` / non-object → `/chat/new`. Red → implement in `src/lib/push.ts` →
  green → rewire `_layout.tsx` + `notifications.ts` (glue, device-verified).
- Plugin: `tests/test_session_notify.py` (run per the §9 PYTHONPATH gate). (1) Claim a device with
  **distinct** live and stored ids, fire `on_session_end(session_id=LIVE)`, assert
  `push.sent[0]['data']['session_id'] == STORED` (the routable id, not LIVE) — presence-only assertions
  pass a wrong impl. (2) **Two-device isolation (required):** device A claims S_A, device B claims S_B;
  `on_session_end` for A sends to ONLY A's token via `get_push_token`, never B.
- Sidebar foreground refresh = device-verified; if a unit is wanted, extract
  `shouldRefreshOnForeground(next, open) => next==='active' && open` and test it.

### Risks / verification
- **Emitted id must be the routable stored id (BLOCKING — see §8 #1).** The registry returns only
  `device_id`; `on_session_end` carries the LIVE id with no live→stored map today. The approval path is
  safe (`session_key` = stored id); the `session_end` path is blocked until the registry is extended or
  the id equality is verified.
- **Approval deep-link may be cosmetic.** Approval cards render only from the live `approval.request`
  event (chat/[id].tsx:369); `historyToItems` never reconstructs them and `SessionResumeResult`
  (types.ts:54-59) carries no pending-approval payload. Verify the gateway re-emits pending approvals on
  `session.resume`; if not, tapping an approval push lands on history without the prompt — defer the
  approval deep-link or pair it with a pending-approvals fetch/replay (see §8).
- Broadcasting a specific `session_id` leaks cross-device → device-targeting is required, not optional.
- Cold-start taps are handled by the **required** `getLastNotificationResponseAsync` change above; without
  it the headline locked-phone case loses the deep link.
- `SessionClaimRegistry` is in-process, 24h TTL → gateway restart / >24h gap drops the claim and the
  deep link falls back to `/chat/new`. Pre-existing reliability bound, not introduced here.

---

## 7. Cross-tier dependencies & PR sequence

1. **PR #1 — Tier 1.** Independent. Establishes the corrected reconnect machinery (single-flight +
   teardown) and the foreground recovery path later tiers ride on. Introduces the `AppState 'active'`
   listener pattern (mirrors `settings.tsx:174-193`) that Tier 3 (sidebar) reuses.
2. **PR #2 — Tier 2.** Depends on Tier 1 only by sequencing (Tier 1's `reconnect()` calls `loadHistory`,
   441). No file-level conflict. Ship after #1.
3. **PR #3 — Tier 3.** Code-independent of #1/#2 (push routing + sidebar + plugin). Ship last: it's the
   only one with a server/plugin component (slower review, needs the §6 verifications) and its deep link
   lands on the chat screen whose reconnect (T1) and rehydration (T2) should already be solid.

All new pure-logic tests go in the top-level `/__tests__/` directory.

## 8. Open questions / implementation-time verifications

1. **T3 — BLOCKING precondition for the `session_end` emit:** on a live run, log the hook's id inputs
   (`session_id`/`task_id`) vs the claimed stored id and confirm the emitted `data.session_id` equals the
   persistent stored id the app routes on (storedIdRef:128; loadHistory:441). Until verified — and, for
   `session_end`, the registry extended per §6b — **do not wire the emit**. (The approval path is already
   safe: `session_key` = stored id.)
2. **T2 tool-context:** confirm the exact `build_tool_preview` key map + truncation on the deployed gateway
   (agent/display.py) before finalizing `toolContextFromArgs` (§5a).
3. **T2 reasoning:** which column does the configured model family populate (`reasoning_content` vs
   `reasoning` vs `reasoning_details`)? The fallback chain covers all, but confirm with one live sample.
4. **T2 reasoning:** does the gateway emit any live main-agent reasoning event? If yes + cheap, a
   follow-up adds a `wireGateway` case for live/history parity (not required here).
5. **T3 approvals:** does the gateway re-emit pending approvals on `session.resume`? If not, the approval
   deep-link is cosmetic — defer it or pair with a pending-approvals fetch/replay (§6b risk).
6. **T3 `is_active`:** confirm the server heuristic (`ended_at IS NULL AND now-last_active<300`) and line on
   the deployed server; gates whether live status could ever be app-only (currently server-required).
7. **T1 zombie sockets:** if on-device testing shows zombie-OPEN sockets surviving foreground, add the
   RPC liveness probe (deferred from v1).

## 9. Conventions

- Branches: `fix/foreground-reconnect`, `feat/rehydration-fidelity`, `feat/cross-surface-sync` (or
  similar). Never push to `main`; PR per tier.
- Gate before each PR: `npx tsc --noEmit && npx jest` (app);
  `PYTHONPATH=/path/to/hermes-agent python -m pytest tests/ -q` (plugin, Tier 3 — bare-checkout `gateway`
  import failures are pre-existing).
- TDD for all new transport/parsing logic (AGENTS.md). Screens are glue → device-verified.
