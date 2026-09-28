# Control path, interactive requests & polish against hermes 0.21.5 — design

- **Date:** 2026-09-28
- **Status:** Revision 2, **approved by Gianluca 2026-09-28**. It incorporates the adversarial review (1 BLOCKER, 11 MAJOR, 21 MINOR, all
  addressed below; the review is recorded in `docs/research/2026-09-28-spec-review.md`).
- **Author:** gldc (with Claude)
- **Repos:** `gldc/hermes-mobile-app` (most of the work), `gldc/hermes-mobile-plugin` (a store fix and
  pushes), `gldc/hermes-deploy` (the gateway bump)
- **Evidence:**
  - `docs/research/2026-09-28-api-delta-0.21.5.md` (cited as `api-delta §n`);
  - the bump assessment (cited as `bump §n`), which lands in `hermes-deploy` with the bump PR as
    `docs/research/2026-09-28-bump-0.21.5-assessment.md`;
  - the spec review (cited as `review B1/Mn/mn`).

  Everything was read from the tagged trees `v2026.8.18` (0.20.4, live) and `v2026.9.24` (0.21.5,
  target), and read-only from the live box.

## 1. Intent

**What Gianluca asked for:** update hermes on dc1-1, and deepen the app's integration: (1) a stop
button, (2) UI polish, (3) whatever new gateway features the app can support. He reported three
problems:

- **The `+` (attach) sheet** looks broken: the header is missing, text shows through, and there is a large
  empty area.
- **After a long message, the composer stays tall** until the chat is reopened.
- **The agent asks a `clarify` question and the app shows nothing**, so the turn waits and times out.

**His decisions:**

- Sending while a turn runs **steers** it, and a Stop button is always available.
- Transport: **vendor upstream's TypeScript client and generated contract** (1A).
- Scope as in §3, **including sudo and secret prompts** through the safe design in §6.4.
- Merge `hermes-deploy` PR #29 before the bump.
- Keep compaction near **750K** tokens (`compression.threshold_tokens: null`).
- Curator: **`prune_builtins: false`**, upstream's new default. The new 14/30-day windows then apply
  only to agent-authored skills.

**Success:**

- On dc1-1 at 0.21.5, from his phone, he can:
  - stop a running turn;
  - steer a running turn;
  - answer an approval;
  - answer a 1–5-question clarify batch;
  - supply a skill secret behind Face ID.
- All of the above survive the phone sleeping and waking **within the gateway's 10-minute orphan
  window** (§7.4).
- The attach sheet and the composer look right in dark and light.
- His on-device QA is the gate.

**Assumptions (flagged for correction):**

- During the rollout window the app still works on a 0.20.4 gateway for:
  - chat;
  - approvals, over the legacy event path;
  - Stop;
  - best-effort steer (§5.3).

  Clarify, secure entry and replay are built for 0.21.5 only.
- Integration testing uses a **throwaway 0.21.5 container on dc1-1** (his "heavy Docker → dc1-1" rule),
  bound to `127.0.0.1` there and reached over an SSH tunnel from the Mac (§10.2). It needs no new
  exposure and no new key from him.

## 2. Why the order matters

At 0.21.5 the interactive prompts (approval, clarify, sudo, secret) are **server→client JSON-RPC
requests**, sent only to a client that advertised `client.capabilities {server_requests:true}`
(api-delta §0, §4). Any other client gets:

- approvals **withdrawn at once** — the command never runs, and the agent is told "update the Hermes
  app";
- clarify resolved with an empty answer.

Today's app advertises nothing, and it drops `srq-…` frames without replying. So **the app ships
server-request handling before the gateway bump.** Today's clarify stall is the 0.20.4 path: the
`clarify.request` event is unhandled, and dc1-1 has `clarify_timeout: 600`.

## 3. Scope

**In this round:**

1. **Transport:**
   - vendored upstream client and types, with one persistent client per chat screen;
   - server-request handlers registered at construction;
   - handshake-ordered resume;
   - a reconnect orchestrator;
   - the legacy approval-event path kept, always on.
2. **0.21.5 correctness:**
   - server-driven turn state;
   - a turn ends on `message.complete` (or on `error` before `message.start`);
   - "Stopped" status with no success haptic;
   - `queued:true` on submits that must never interrupt;
   - no unknown param keys;
   - `4001` → resume + retry, for stop, steer and `config.set`;
   - the `>>>…<<<` search snippets;
   - replayed events cause no side effects.
3. **Stop:** `session.interrupt`.
4. **Steer:** `session.steer` while a turn runs.
5. **Server-request cards:**
   - approval;
   - clarify (single and batch, `clarify.lock`);
   - secure entry (sudo and secret);
   - a "declined on the phone" note for vault prompts;
   - `-32601` for desktop-only requests.
6. **Reconnect:** `open_requests` recovery, and in-flight turn replay via `session.events.since`.
7. **Polish:** the attach sheet, and resetting the composer height after send.
8. **Plugin:**
   - `DeviceStore` locking, in-process and cross-process (required before the bump);
   - skip coalesced approval pushes;
   - **a push when the agent calls `clarify`**.
9. **Gateway bump** to `v2026.9.24`, after PR #29 merges.

**Next round (out of scope here):**

- a context and usage ring;
- subagent interrupt and steer;
- undo, branch and compress;
- session rename, delete and hide;
- goal and loop controls;
- `prompt.btw`;
- `session.foreign.*` import;
- remote admin;
- curator rollback;
- clarify on 0.20.4;
- pushes for sudo and secret (no hook exists, §6.5).

## 4. Transport

### 4.1 Vendored upstream code

**What is copied:** `apps/shared/src/{json-rpc-channel,json-rpc-gateway,gateway-events,gateway-contract.generated}.ts`
from `NousResearch/hermes-agent@v2026.9.24`, into `src/vendor/hermes-gateway/`, together with the
**repo-root** `LICENSE` (MIT).

**The one mechanical edit:** strip the `.js` suffix from the relative import specifiers, so Metro and
tsc resolve them. The review confirmed that the four files then typecheck under the app's
`expo/tsconfig.base` (exit 0).

**`scripts/sync-gateway-contract.sh <tag>`:**
1. fetches the files at the tag;
2. applies the rewrite;
3. writes `VENDORED.json` with `{tag, commit, files:{name:{upstream_sha256, vendored_sha256}}}`.

A Jest **drift guard** recomputes `vendored_sha256`. The script can re-verify `upstream_sha256`
against the tag.

**Runtime dependencies to record in a header comment:**
- Hermes lacks `TextDecoder`. `json-rpc-channel.ts` constructs one at module top.
- It works only because Expo's winter runtime installs `TextDecoder`, `URL` and `DOMException`.
- RN 0.85 `WebSocket` provides `static OPEN` and `EventTarget`.

**Socket factory:** unchanged from today (no `Origin` header is set now; review m1). It is passed as
the vendored `socketFactory(url)`.

**If the vendored client fails at runtime under RN in a way that can't be fixed without editing vendored
source,** stop: fall back to 1B (types only), and that is his call.

### 4.2 Client lifecycle (review B1.1, B1.4, M2, M3)

- **One `JsonRpcGatewayClient` per chat screen,** created on mount and reused across reconnects:
  - reconnect = `client.invalidate()` → mint a fresh single-use ticket → `client.connect(newUrl)`;
  - `openGateway()` in `connection.ts` changes from "construct and connect" to "mint a ticket URL";
  - ownership of tickets, backoff (`lib/reconnect.ts`) and AppState stays in the app.
- **Handlers are registered once, at construction, before the first `connect()`:**
  - `onRequest`;
  - the event subscriptions;
  - state changes.

  They are never torn down and re-added across reconnects. The request handler **accepts every
  mobile-supported method even before any chat UI state exists**: it enqueues into the turn controller
  (§4.4), not into React state. A `-32601` is destructive at 0.21.5 (the approval is withdrawn, clarify
  is blanked; review M3), so no supported request may ever fall through to it.
- **Handshake before resume.** The adapter's `connect()` resolves only after the socket opens,
  **`gateway.ready` has been received**, and one tick has passed. The channel sends `client.capabilities`
  synchronously inside its `gateway.ready` handling, so the capability request is on the wire before
  the app sends `session.resume`. This closes the window in which a resumed-but-unadvertised transport
  gets its approval withdrawn (review M2).
- **The vendored heartbeat,** where `gateway.ready.heartbeat` is present, can `invalidate()` a
  suspended socket. `onState('closed')` routes into the same single-flight reconnect as the socket close
  and the AppState foreground (review m7).
- **The vendored auto-replay is off** (`replay:false`). Replay is app-orchestrated (§7), so the app can
  see `truncated` and order replay against history (review B1.2).
- **Timeouts:** the vendored default `requestTimeoutMs` is 120 s per call. Keep it, and verify
  `session.resume` on the cold 178 MB store stays well under it (review m8).
- **Errors:** the adapter maps `JsonRpcGatewayError{code}` to the app's `RpcError(message, code)`, so
  existing branches keep working, e.g. `sessionModel.ts` on `SESSION_BUSY_CODE` (review m6).

### 4.3 Types and the legacy path (review M1, m5)

- **Every RPC params/result, server-request and event type comes from
  `gateway-contract.generated.ts`.** `call` is typed on `RpcMethods`, so an unknown param key is a
  **compile error**. Overlapping hand-written types in `src/api/types.ts` are deleted. REST and plugin
  shapes stay app-owned.
- **No legacy detection.** The app **always** handles:
  - the `approval` server request (0.21.5);
  - the `approval.request` event answered by `approval.respond` (0.20.4).

  The two are mutually exclusive by construction: 0.21.5 removed the event, and 0.20.4 never sends
  server requests. At 0.20.4, the channel's `client.capabilities` gets `-32601`, which the channel
  swallows harmlessly.
- **The one allowed app-owned gateway type** is the legacy `approval.request` payload, because it is
  absent from the 0.21.5 contract. It is scoped to `src/api/legacy-approval.ts` with a comment naming
  the tag it came from, and is deleted once 0.20.4 support is dropped.

### 4.4 Pure modules pulled out of `chat/[id].tsx` (review M11)

`chat/[id].tsx` (855 lines) keeps only rendering and wiring. Two pure modules with no RN imports,
unit-tested, take the logic:

- **`src/lib/turn-controller.ts`.** A reducer plus actions for:
  - turn state (§5.1);
  - the send decision;
  - `message.complete` status mapping;
  - **open server requests, keyed by request id and held outside the transcript `items`**, rendered
    merged after them (review B1.3).
- **`src/lib/reconnect-orchestrator.ts`.** The PR #22 hardening, extracted and injected:
  - single-flight;
  - teardown order;
  - detaching handlers before close.

  It also owns the §7 sequence. **PR #22's hardening is untested today** (the only reconnect tests cover
  `shouldReconnect`/`backoffMs`), so this extraction adds tests for single-flight, ordering, and the
  heartbeat/AppState/close races.

`__tests__/gatewayClient.test.ts` is **rewritten** with an `EventTarget`-style fake socket, because the
vendored client uses `addEventListener`.

## 5. Turn control

### 5.1 Turn state is server-driven (review M4, M6)

**States:**

| state | meaning |
|---|---|
| `idle` | no turn running |
| `waiting` | a submit was sent, but `message.start` hasn't arrived yet |
| `streaming` | a turn is running |
| `stopping` | Stop was sent, and `message.complete` hasn't arrived yet |

**Transitions:**

- **`message.start`** → `streaming`, **whether or not the app sent anything.** The server starts turns
  on its own: leftover steers, goal continuations, queued drains and auto-continue.
- **`session.resume`** seeds the state from `running`/`status` (0.21.5) and `inflight` (both tags). After
  a reconnect mid-turn the composer shows **Stop**, never idle. This replaces today's forced
  `setStreaming(false)` in `dropAndReconnect`.
- **`message.complete`** ends the turn:
  - `status:"interrupted"` → a **"Stopped"** marker and no success haptic;
  - `status:"error"` → the error styling.
- **`error` event:**
  - in `waiting` it **ends** the turn. Covers an ownership refusal, an agent-init failure, or a
    queued-dispatch failure with no `message.complete` to follow.
  - in `streaming` it shows an inline notice and the turn continues.
- **Replayed events** (`replayed:true`) update state but never fire haptics or one-shot side effects
  (review m16).

**Every idle-state submit sends `prompt.submit {session_id, text, queued:true}`.**
- `queued` exists at both tags.
- It never redirects or interrupts a busy session.
- It is safe even when the app's view of the state is stale. dc1-1 runs `busy_input_mode: interrupt`,
  where a plain submit to a busy session would kill the turn.

### 5.2 Composer

| state | input empty | input has text |
|---|---|---|
| `idle` | send (disabled; **enabled if a photo is staged**) | **send** → `prompt.submit{queued:true}` |
| `waiting` / `streaming` | **Stop** ■ | **Stop** ■ + **steer-send** ↑ |
| `stopping` | "Stopping…" (Stop disabled, spinner) | steer-send disabled |

- The placeholder while streaming is "Steer Hermes…".
- The input stays editable.
- Colours come from `useTheme()`. Stop is `colors.text` on `colors.raised`, and the accent is reserved
  for primary send.

### 5.3 Stop and steer

**Stop:**
1. Call `session.interrupt {session_id}`.
2. Go to `stopping`.
3. The turn ends on `message.complete status:"interrupted"`. This happens at **both** tags, so "Stopped"
   works on 0.20.4 too.
4. At 0.21.5, open cards close on `request.cancel reason:"interrupted"`.
5. The RPC's own result is ignored, because it says `interrupted` even when idle.

**Stop errors:**
- `4001` → resume the stored id and retry once.
- Anything else → an inline error, and Stop re-enabled.
- No `message.complete` within 15 s of a successful interrupt → the §7 reconnect path.

**Steer:**
1. Send `session.steer {session_id, text}`. Its result is **`queued` or `rejected` only** (review M5).
   - `queued` → a user bubble marked **"steered"**.
   - `rejected` (the turn already ended) → `prompt.submit {…, queued:true}`.
2. Errors:
   - `4010` (agent still building) → `prompt.submit {…, queued:true}`. Never a plain submit, which would
     hard-interrupt the new turn.
   - `4001` → resume and retry once.
   - Anything else → an inline error, with the text put back in the input.
3. **On 0.20.4, steer is best-effort.** It never returns `rejected`. The text is appended to a later tool
   result rather than becoming a user row, and it can disappear from the transcript after a rehydrate.
   Accepted for the rollout window; the app does not try to compensate.
4. **Images are not steerable.** A staged photo waits for idle, and the chip says so.

**`config.set`** (the model switch) gets the same `4001` → resume + retry-once rule (review m10).

## 6. Server-request cards

### 6.0 Common rules

- **Where cards live.** Each open request is one card in the turn controller, keyed by its JSON-RPC
  request id, **outside `items`**. It renders at its position in the transcript and survives a history
  replace.
- **Answering** is done by the vendored channel's response frame. At 0.21.5 **there is no ack**: a card
  marks itself answered **optimistically on send** (review M10). A response for an already-settled id is
  dropped by the server; `request.cancel` normally arrives first for a withdrawn one.
- **`request.cancel {id, reason}`** closes the card with a label:

  | reason | label |
  |---|---|
  | `interrupted` | "Stopped" |
  | `timeout` | "Timed out" |
  | `resolved` | "Answered elsewhere" |
  | `session_closed` / `shutdown` | "Closed" |

- **Replay dedupe is by id.** A card already present is **updated**, never duplicated, and never
  suppressed if missing (review B1.3).
- **`open_requests` wins.** When a `session.resume` result has `open_requests`, `pending_approval` is
  ignored, because it duplicates the same approval (review M10).

### 6.1 Approval

- The existing `approval-card.tsx` UI stays.
- **0.21.5:**
  - the `approval` server request, answered with result `{choice}` (`all` is not used);
  - resolution is **per request id**, so every pending approval card is independently actionable.
- **0.20.4 legacy:**
  - the `approval.request` event plus `approval.respond {session_id, choice}`;
  - the existing FIFO "only the oldest is actionable" rule, since `approval.respond` resolves the oldest.
- The gateway coalesces identical prompts, and the app dedupes by id on top of that.

### 6.2 Clarify

**Params (0.21.5):**
- single: `{session_id, question, choices|null, multi_select?}`
- batch: `{session_id, questions:[{qid, question, choices|null, multi_select}]}`, with 1–5 questions
  (ids `q0..q4`) and optional replayed `answers:{qid:str}` for locked questions, which render as answered

**Card:**
- one section per question;
- choices as rows: radio, or checkboxes when `multi_select`;
- the wire choice already carries a "(Recommended)" suffix; render it as a badge (the server strips it
  from answers either way);
- a free-text **"Other…"** row for every question;
- `choices: null` means a text field only.

**Answering:**
- **Single:** a response frame `{answer: string}`, with `""` for skip. `clarify.lock` is **not** used for
  single questions: it returns `expired` when there are no qids.
- **Batch:**
  1. Each answered question calls `clarify.lock {request_id, question_id, answer}`.
  2. A per-question **Skip** locks `""`.
  3. `remaining: []` on the last lock resolves the request; no response frame follows, and a stray one
     would be dropped harmlessly.
  4. **Submit all** locks the remaining questions in order.
  5. **Skip all** sends a response frame with no `answers`, which cancels the batch.
  6. A lock returning `expired` marks the card "Timed out".
- **Multi-select** sends a real JSON array; `clarify.lock.answer` is `JsonValue`.

### 6.3 Vault and desktop-only requests

- **Vault** (`vault.unlock_prompt`, `vault.save_login`, `vault.code`):
  - answered `-32601` at once, which resolves the request as unanswered for every client (first response
    wins);
  - the transcript shows: "Hermes asked for a password-manager action — declined on the phone."
    (review m12)
- **Desktop-only** (`terminal.read`, `preview.read`, `preview.act`, `window.read`, `tour`,
  `display.install.sudo`): a silent `-32601`.

### 6.4 Secure entry (sudo and secret)

**Threat model:**

- The phone side — masking, memory, logs, push — can be made safe.
- **The gateway side is the real risk:**
  - `secret` saves to `/opt/data/.env`, readable by the agent's own uid 10000, which is the opposite of
    the credexec boundary;
  - the plausible attack is **phishing by a prompt-injected agent**, which can author **or edit** a
    skill that "requires" a credential.
- `sudo` cannot fire on dc1-1 (the container has no `sudo`), but it shares the card.
- **Reachability confirmed:** `session.create`/`resume` set `HERMES_INTERACTIVE=1`, so secret capture
  reaches dashboard-WS sessions (review M8).

**Timeouts:** secret 300 s, sudo 120 s. The card shows the remaining time.

**Card:**

- **Title:** sudo "Administrator password"; secret "Value for `ENV_VAR`".
- **The ask:** the agent-written `prompt` under the label "Requested by the agent"; for sudo, the redacted
  `command`.
- **The warning on every secret card** (review M8): "Only continue if you asked for this — the agent can
  write or edit the skill that's asking."
  - The skill name (`metadata.skill_name`) and its `/api/skills?profile=<chat profile>` `provenance`
    (`hub` / `bundled` / `agent`) are shown **as information, not as a trust grade**, because
    provenance is a name lookup and the agent can edit bundled skills.
  - A failed lookup shows "unknown".
- **Where the value goes (secret):** "Saved to the gateway's .env — the agent can read it."
- **Field:**
  - `secureTextEntry`;
  - `autoCorrect={false}`, `autoCapitalize="none"`, `spellCheck={false}`;
  - `textContentType`: **`password` for sudo**, so iOS Passwords autofill works; **`none` for secret**,
    so iOS never offers to save an API key to Passwords (review m14).
- **Buttons:**
  - **Skip** is prominent and responds `{value:""}`; the agent sees "skipped".
  - **Send** requires **Face ID** (`expo-local-authentication`, device passcode fallback) immediately
    before responding `{value}`. A failed or cancelled check sends nothing and keeps the card open.

**Data handling rules** (each one gets a test):

- The value lives only in the field component's local state.
  - It is never put in the turn controller, `items`, history, AsyncStorage or SecureStore.
  - It is never passed to `console.*`, an error message, or a telemetry path.
- The field is cleared on send, skip, cancel, timeout, unmount and interrupt.
- Afterwards the card shows only "Sent" / "Skipped", never the value or its length.
- The adapter **never logs** outbound response frames for `sudo` or `secret`, even in `__DEV__`.
- Face ID's `NSFaceIDUsageDescription` is set through the `expo-local-authentication` **config plugin**
  (`faceIDPermission`) in `app.json` `plugins` (review m15). This is a native module, so it needs a
  native rebuild.

### 6.5 Push (review m13)

- **Today:** the plugin pushes only on `pre_approval_request` and at session end.
- **This round adds:**
  - a push when the agent calls **`clarify`**, through the plugin's `pre_tool_call` hook (kwargs include
    `tool_name` and `session_id`). At 0.21.5 a `pre_tool_call` callback that raises or exceeds the 30 s
    hook timeout **becomes a block directive**, so the handler must catch everything, push on a background
    thread, and return `None`. It is rate-limited to one push per device and session every 30 s;
  - device-targeted like the session-stop push, with a redacted body: "Hermes has a question";
  - a tap deep-links to the session, where resume brings the card back (§7).
- **No push exists for sudo or secret** (there is no hook for them). It is documented as a known gap;
  those cards appear only when the chat is open.

## 7. Reconnect sequence (review B1)

The orchestrator (§4.4) runs one single-flight sequence on every reconnect trigger: socket close,
heartbeat `closed`, or AppState foreground with a dead socket.

1. `client.invalidate()` → mint a ticket → `client.connect(url)`, which resolves after `gateway.ready`
   (§4.2).
2. `session.resume {session_id}`.
   - Any `open_requests` it returns are routed by the vendored channel into the request handler as cards
     (§6.0).
   - `running`/`status`/`inflight` seed the turn state (§5.1).
3. **History:** `GET /api/sessions/{id}/messages` replaces `items`, as today. This is the proven source
   of persisted turns. Request cards are outside `items`, so they survive the replace.
4. **In-flight replay,** only if the turn is running:
   1. Call `session.events.since {session_id, last_seen}` with the app-tracked watermark (the highest
      `seq` seen for this session, kept in the orchestrator and not reset across reconnects).
   2. Apply only events **after the last `message.complete` in the replay batch**. Those belong to the
      still-unpersisted turn, so nothing duplicates history.
   3. `truncated:true`, **or no watermark yet** (a cold start or a fresh screen), → skip the replay;
      the live stream carries on from now, and the partial text before it is lost.
   4. A replay's own `open_requests` go through the same dedupe.
5. Live events resume. Events that arrive during steps 2–4 are **parked and applied after step 4**, in
   `seq` order, deduped against the replay.

**Limit to state in the QA script:** a WebSocket session left disconnected is reaped after
`ws_orphan_activity_stale_s` = 600 s idle, which is also dc1-1's `clarify_timeout`. "Survive sleep" is
tested with sleeps under 10 minutes (review m21).

## 8. Polish

### 8.1 Attach sheet (`src/app/attach.tsx`, `_layout.tsx:46-54`)

**Observed** (dark, 2026-09-28):
- no ✕ or "Add to chat" header;
- the title's "to" shows between the Camera and Photos tiles;
- the tiles sit against the grabber;
- roughly 300 pt of dead space under Memory.

**Hypothesis:** `attach.tsx` nests a `ScrollView` under a header `View` inside `flex:1`, in a `formSheet`
with numeric detents `[0.6, 0.95]`. `settings.tsx` has the same RNS 4.25.2 formSheet with a `ScrollView`
as its **root**, and it renders fine.

**Fix direction** (reproduce first, then confirm on the simulator):
- `sheetAllowedDetents: 'fitToContents'`;
- no `flex:1`;
- a plain `View` in place of the `ScrollView` (one tile row plus five list rows);
- top padding that clears the grabber;
- **if the largest supported Dynamic Type clips,** make the `ScrollView` the root with the header inside
  it, the way `settings.tsx` is built.

**Accept:** the header is visible, nothing shows through, and there is no dead space, in dark and light,
on the smallest and largest supported phone.

### 8.2 Composer height after send (`src/components/composer.tsx`)

**Observed:** after a multi-line message is sent and the input cleared, the multiline `TextInput` keeps
its grown height until the screen remounts.

**Fix:** reproduce on the simulator first, then choose one of:
- track the height via `onContentSizeChange`, clamped to 120 and reset explicitly when the value becomes
  empty; or
- re-key the input on send. Less preferred, because it drops focus.

**Accept:** after sending a 6-line message the composer returns to one line, the keyboard stays up, and
focus is kept.

## 9. Server side

### 9.1 Plugin (`gldc/hermes-mobile-plugin`), merged **before** the bump

**Required: `DeviceStore` locking (review M7).**

At 0.21.5, refresh runs in a threadpool, and the plugin has **several `DeviceStore` instances in one
process**:
- the auth provider's (`plugin.py:27`);
- `plugin_api.py`'s `_get_store()`.

The CLI `pair`/`revoke` commands write from another process. The fix:

- a **module-level lock keyed by the resolved store path**, plus an **`fcntl.flock` on a sidecar lock
  file**, for cross-process writers. `/mnt/user` is `fuse.shfs`; taking a flock there works, since
  qdrant holds one, but that it **excludes a second process** is proven only by Plan P Task 8 (the
  Slack token lock is an O_EXCL pid file, not a flock);
- it wraps load→modify→save in `create_device`, `rotate_refresh`, `revoke`, `revoke_by_refresh` and
  `set_push_token`;
- a unique tmp file per write (`tempfile.mkstemp` in the store dir, then `os.replace`), replacing
  `.devices.json.<pid>.tmp`;
- **RED first:**
  - a threaded test with **two `DeviceStore` instances on one path** (rotate on one, `set_push_token` on
    the other) that loses an update today;
  - a cross-process test.
- It must pass under both tags.

**Coalesced approvals:** `if kwargs.get("coalesced"): return` in the `pre_approval_request` handler,
RED first.

**Clarify push (§6.5):** a `pre_tool_call` handler that, for `tool_name == "clarify"`, sends the
device-targeted redacted push (`data.type = "clarify_request"`). It catches every exception and pushes on
a background thread, so it can never become a block directive (§6.5). RED first. The app adds
`clarify_request` to `SUPPRESSIBLE_PUSH_TYPES` (Plan B).

**`docker exec` runs as root:** any file the store or lock creates when root runs it is chowned back to
the store directory's owner (uid 10000).

**Deploy:** merge to `main`. The bump step pulls it explicitly (§9.2 step 5).

### 9.2 Gateway bump (`gldc/hermes-deploy`)

**Normative source:** execute the bump assessment's **Steps** and **Acceptance** lists **verbatim**
(bump §6). The assessment is committed in the bump PR, and this section only adds to it. The key points
and additions:

1. **Merge PR #29** (0.20.4, live for 40 days). He approved this.
2. **B0 re-diff** on execution day.
3. **B1 pin:** `v2026.9.24` =
   `nousresearch/hermes-agent@sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7`,
   in `IMAGE` and `ARG BASE`. Also update the pin comment and the `_bindscan.py` / `test_broker.py` /
   compose wording, RED→GREEN.
4. **B2 checks in the new base:**
   - the plugin suite, which now includes the §9.1 tests;
   - the differential loader smoke;
   - `hermes plugins compat`;
   - `assert_protocol_compliance(MobileDeviceProvider)`;
   - the `required_credential_files` re-grep.
5. **Prepare the box.**
   - **B3:** rsync without `--delete`, `_bindscan --assert-no-package-mount --assert-owns-pid1`, probe
     build.
   - **B4:** tag `hermes-dc1:pre-0.21.5` from `:local` *before* the build. The older tags are 0.18.2
     builds. `:preperuid` must never be retagged.
   - **Plugin checkout:** uid-10000 `git pull --ff-only` in `/opt/data/plugins/hermes-mobile`, then
     check `log -1` shows the §9.1 SHA. It already tracks `main`; the wiki's "still on the fix branch"
     line is stale and gets corrected in this PR.
6. **Migration dry-run on a copy:**
   - expect exactly config steps 40 and 44 to apply;
   - time the state.db v30 trigram FTS rebuild on the 178 MB DB.
7. **His decisions applied** (back up `config.yaml` as `config.yaml.bak-YYYYMMDD-<reason>` before each
   edit):
   - `compression.threshold_tokens: null`, to keep roughly 750K on k3's 1M context;
   - **curator:** `curator.prune_builtins: false`, his decision; the migrated 14/30-day windows stay.
8. **B5: back up and bring up.**
   1. `cp -p data/config.yaml data/config.yaml.bak-YYYYMMDD-pre0215`.
   2. Stop, and check the WAL is at 0.
   3. **Cold backup with the extended list** (bump §2 adds `mobile/`, `projects.db`, `auth.json`,
      `SOUL.md` and more), `chmod 0600`.
   4. `PRAGMA integrity_check` on the backup's state.db under SQLite 3.53.4; rebuild FTS first if it is
      malformed.
   5. Build and bring up. The first boot migrates config 37→46 and state.db 26→30. **Both are one-way.**
9. **Rollback:**
   - `down`;
   - retag `pre-0.21.5` → `:local`;
   - restore `config.yaml`, `state.db` (with the `-wal` removed) and `kanban.db` from the tarball;
   - `up -d`.

   **It loses any conversations made after the bump.** **Do not restore `mobile/`**: old refresh-token
   hashes would bounce every phone to re-pair (review m19).
10. **STATE.md, CHANGELOG and the wiki** (`hermes-deploy`, `hermes-agent`, `hermes-mobile-plugin`,
    `hermes-mobile-app`) are updated in the same PR. **Keep both `mobile` and `hermes-mobile` in
    `plugins.enabled`**, because #67069 is still open.

**Acceptance** (the assessment's list, plus the review's additions; bodies and real calls, never status
codes alone):

- **Version and config:**
  - version 0.21.5, sqlite 3.53.4, `_config_version` 46;
  - the `config.yaml` diff shows only the expected steps plus his decisions.
- **Model and fallback, as uid 10000 via `bash -lc`:**
  - `hermes status`;
  - `hermes fallback`, showing a single entry;
  - a real `hermes chat -q` turn answered by k3.
- **Effective compression:** check the effective point (the agent's "compress at …" init line or
  `hermes config`), not only the YAML.
- **Database health:**
  - `hermes doctor` (no `--fix`) shows no FTS or structural damage;
  - schema 30;
  - `integrity_check` ok on a post-boot copy.
- **Profiles:**
  - a `multiplex_standalone_reason` is logged and `data/profiles` does not exist;
  - **no second profile** is created, because of the multiplex secret hazard; this is documented in
    STATE.md.
- **Exposure:**
  - listeners: only `127.0.0.1:8642` is new;
  - `/opt/data/.env` is 0600. It holds the set seeded from upstream's `.env.example` (captured on the
    throwaway container) plus `API_SERVER_KEY` and no compose env name, plus any secret entered later
    through §6.4 (Plan D, contradiction 1).
- **Logs:** no `UnscopedSecretError` or `compat` lines.
- **Skills:**
  - `hermes skills list` shows the disabled set;
  - `hermes curator status` shows no tenant skill archived.
- **Brokers:** every credexec broker makes one real call and gets one exit-77 denial.
- **Mobile plugin:** `/api/plugins/mobile/…` returns authenticated JSON, not a 404 (#67069).
- **Dashboard, Slack and network:**
  - the dashboard serves the real sign-in page body;
  - Slack replies;
  - the mobile adapter is connected;
  - the cross-node probe from the Mac, with `tailscale up`, returns PROBE PASS.
- **Refresh:** a refresh after more than 15 min in the background, **and a two-device refresh burst**.
  This is the live test of §9.1.
- **App on 0.21.5:** QA per §10.3.

**Watch items:**
- the `connections` toolset step;
- the control socket on shfs (upstream #123761, non-fatal);
- the FTS rebuild time.

## 10. Testing

### 10.1 Unit (RED→GREEN)

- **Vendoring and the adapter:**
  - the drift-guard hashes;
  - connects through the app's `socketFactory` (EventTarget fake);
  - frame order `gateway.ready` → `client.capabilities` → `session.resume` (review M2);
  - `connect()` doesn't resolve before `gateway.ready`;
  - an unhandled desktop request → `-32601`;
  - **no** `-32601` for any supported method, including an `open_requests` replay delivered before the
    UI is ready (review M3);
  - `JsonRpcGatewayError` → `RpcError` mapping.
- **Legacy (0.20.4):**
  - a fed 0.20.4-shaped `gateway.ready`, then `-32601` for `client.capabilities`, then `approval.request`
    → the card, then `approval.respond`.
- **Turn controller:**
  - `message.start` without a local send → `streaming`;
  - a resume with `running:true` → `streaming` with Stop visible;
  - `error` in `waiting` ends the turn, and `error` in `streaming` doesn't;
  - `message.complete{interrupted}` → "Stopped" with no haptic;
  - idle submit carries `queued:true`;
  - steer `queued`, `rejected`→submit`{queued:true}`, `4010`→submit`{queued:true}`, and `4001`→resume
    + retry;
  - the 15 s post-Stop fallback;
  - replayed events cause no side effects.
- **Reconnect orchestrator:**
  - single-flight across close, heartbeat and AppState;
  - teardown order;
  - resume → history → replay order;
  - **reconnect mid-clarify → history replace → the card is still present and answerable** (review B1);
  - replay applies only post-last-complete events;
  - `truncated` skips replay;
  - events parked during replay are deduped by `seq`.
- **Cards:**
  - add, answer (optimistic) and cancel for every kind, with each reason's label;
  - dedupe-and-update by id;
  - `open_requests` overrides `pending_approval`;
  - 0.21.5 approvals independently actionable, legacy approvals FIFO.
- **Clarify:**
  - single `{answer}` with no lock;
  - batch lock per question, per-question skip as `""`, and `remaining:[]` resolves;
  - Skip all sends a response with no `answers`;
  - multi-select sends an array;
  - `expired`;
  - replayed `answers` render as locked.
- **Secure entry:**
  - the warning on every secret card;
  - provenance shown as information, and "unknown" when the lookup fails;
  - a Face ID failure sends nothing;
  - `textContentType` per kind;
  - **the value never appears in controller state, `items`, or any `console.*` call** (spy);
  - cleared on every exit path;
  - the timeout countdown.
- **Misc:**
  - `>>>…<<<` snippets;
  - `config.set` 4001 retry;
  - `call()` param typing (a compile-level check through `tsc` in CI).
- **Plugin (pytest):**
  - a two-instance lost-update test;
  - a cross-process flock test;
  - the unique tmp file name;
  - a coalesced approval is skipped;
  - a `pre_tool_call(clarify)` push that is device-targeted and redacted, and non-clarify tools that
    don't push.

### 10.2 Integration (before touching the live gateway)

**Throwaway 0.21.5 container on dc1-1:**
- the target digest;
- its own fresh data dir under `/mnt/user/appdata/hermes-test-0215/`;
- the dashboard with `basic` auth, and the §9.1 plugin branch mounted;
- **no Slack tokens** (no second responder);
- only model-provider env vars copied from the live `.env`;
- bound to `127.0.0.1:19119` on dc1-1, reached from the Mac by `ssh -L 19119:127.0.0.1:19119
  root@dc1-1.local`;
- no tailnet node and no LAN exposure;
- **torn down** after use.

**Scenarios, driven with the simulator build:**
- a dangerous command → the approval card;
- a prompt that makes the model call `clarify` with a batch, plus the clarify push;
- a throwaway skill declaring `required_environment_variables` → the secure-entry card (simulated
  Face ID);
- Stop mid-tool;
- steer mid-run;
- kill the socket mid-clarify → the card survives the history reload;
- reconnect mid-turn → the partial text is restored;
- a two-device refresh burst.

**Also against live 0.20.4 dc1-1, before the bump:**
- a legacy approval;
- Stop;
- best-effort steer;
- a normal chat.

**Screenshots** of every card and both polish fixes, in dark and light, go in the PRs.

### 10.3 On device (his QA, the real gate)

A native rebuild on his iPhone (new native module). After the bump, on 0.21.5:
- stop;
- steer;
- an approval;
- a clarify batch, including the push-tap into the card;
- a secret, using a throwaway skill;
- background the app mid-clarify for **under 10 minutes**, then foreground;
- the attach sheet;
- the composer after a long message;
- both themes.

## 11. Delivery

Each PR goes through branch → PR → CI green (gated on exit codes) → adversarial review → merge. Where
the plan finds independent tasks, they run as parallel subagents in worktrees.

1. **Plugin:** locking, coalesced skip, clarify push. It is independent, so it goes first.
2. **App A, transport** (the first task **proves the vendored client under RN** before anything else is
   built on it):
   - vendoring and the sync script;
   - the adapter and lifecycle;
   - the legacy path;
   - the turn controller;
   - the reconnect orchestrator and its tests;
   - the `gatewayClient.test.ts` rewrite;
   - the 0.21.5 correctness items.
3. **App B, turn control and cards** (depends on A): Stop, steer, approval on the new path, clarify,
   secure entry, the vault note.
4. **App C, polish:** independent, in parallel with A and B.
5. **Deploy:** merge #29, then the bump PR. It runs only after 1 is merged and 2–4 are verified on the
   throwaway 0.21.5 container **and** against live 0.20.4.

**Order on the box:**
1. the plugin merge;
2. the app installed on his phone (it works on 0.20.4);
3. the bump;
4. his QA.

If the bump rolls back, the installed app still works on 0.20.4.

## 12. Risks

| risk | mitigation |
|---|---|
| The vendored client fails under RN or Hermes JS | App A's first task proves it. The runtime deps are documented. The fallback to 1B is his decision. |
| The transport swap regresses PR #22's reconnect hardening | The hardening is extracted into a tested orchestrator, with single-flight, ordering and race tests that did not exist before. |
| A `-32601` or handshake race withdraws approvals | Handlers are registered at construction, `connect()` gates on `gateway.ready`, and both have explicit tests. |
| A submit on a stale view interrupts a live turn (`busy_input_mode: interrupt`) | Server-driven turn state, and `queued:true` on every idle submit and every fallback. |
| A replayed card is wiped by the history reload | Cards live outside `items`; the orchestrator's order is tested. |
| Secret phishing by a prompt-injected agent | A warning on every card, provenance shown only as information, Face ID, the "agent can read it" disclosure, a prominent Skip, no keychain save. |
| A one-way migration breaks the box | Dry-run on a copy, the extended cold backup, an integrity check, and a rollback that states its data loss. |
| Refresh concurrency bounces the phone to re-pair | The path-keyed lock plus flock merges before the bump, and a burst test runs live. |
| The sleep window is longer than the orphan reap | A documented 10-minute limit, tested inside it. |
