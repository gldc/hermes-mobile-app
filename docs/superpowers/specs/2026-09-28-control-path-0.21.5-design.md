# Control path, interactive requests & polish against hermes 0.21.5 — design

- **Date:** 2026-09-28
- **Status:** Draft, pending adversarial review, then user sign-off, then the implementation plan
- **Author:** gldc (with Claude)
- **Repos touched:** `gldc/hermes-mobile-app` (most of it), `gldc/hermes-mobile-plugin` (one fix plus one
  optional fix), `gldc/hermes-deploy` (the gateway bump)
- **Evidence:** `docs/research/2026-09-28-api-delta-0.21.5.md` (the app/API delta, cited as `api-delta §n`)
  and the bump assessment (`bump §n`). The bump assessment lands in `hermes-deploy` with the bump PR as
  `docs/research/2026-09-28-bump-0.21.5-assessment.md`. Both were read from the tagged trees `v2026.8.18`
  and `v2026.9.24`, and from the live box read-only.

## 1. Intent

**What Gianluca asked for, in his words:** update the hermes version on dc1-1, and deepen the
integration: (1) a stop button, (2) UI polish, (3) whatever new gateway features the app can support.
He reported three concrete problems:

- The **`+` (attach) sheet** looks broken: the header is missing, text shows through, and there is a large
  empty area.
- **After sending a long message, the composer stays tall** until the chat is closed and reopened.
- **The agent asks a `clarify` question and the app shows nothing**, so the turn waits and times out.

**Decisions he made during brainstorming:**

- Sending while a turn is running **steers** it (option a). A Stop button is always available.
- Transport: **vendor upstream's own TypeScript client and generated contract** (1A). Do not hand-write it.
- Scope as listed in §3. **Sudo and secret prompts are supported** through the safe design in §6.4.
  The vault prompts stay declined.
- Merge `hermes-deploy` PR #29 before the bump. **Keep the compaction point near 750K** tokens
  (`compression.threshold_tokens: null`). Do not accept 0.21's new 256K cap.

**What success looks like:**

- On dc1-1 running 0.21.5, from the phone, he can:
  - stop a running turn;
  - steer a running turn;
  - answer an approval;
  - answer a 1–5-question clarify batch;
  - supply a skill secret behind Face ID;
  - watch all of the above survive the phone sleeping and waking.
- The attach sheet and the composer look right in dark and light.
- His on-device QA pass is the gate.

**Assumptions (not stated by him, flagged for correction):**

- The app keeps supporting a 0.20.4 gateway **for approvals only**, as a fallback during the rollout
  window.
  - Clarify, secure entry, steer-as-own-row and replay are built for 0.21.5 only.
  - Stop and steer also work on 0.20.4, because those RPCs exist there.
- A local 0.21.5 gateway in Docker on the Mac is acceptable as the integration environment. It needs a
  model key for live tool-calling tests; he supplies it at that point.

## 2. Why the order matters (the finding that shaped this)

**At 0.21.5, interactive prompts moved from events to server→client JSON-RPC requests** (api-delta §0,
§4). This covers approval, clarify, sudo and secret.

- The gateway sends them only to a client that advertised `client.capabilities {server_requests:true}`
  on its connection. Any other client gets:
  - **approvals withdrawn immediately** — the command never runs, no card appears, and the agent is told
    "update the Hermes app";
  - **clarify resolved with an empty answer**.
- Today's app advertises nothing. `gatewayClient.handleFrame` also drops any frame with `id:"srq-…"`
  without replying.

So **the app must ship server-request handling before the gateway is bumped.** Separately, today's
clarify stall is the 0.20.4 path: the `clarify.request` event is unhandled and dc1-1 has
`clarify_timeout: 600`.

## 3. Scope

**In this round:**

1. **Transport.** Vendor the upstream client and generated types, adapt the app onto them, and keep the
   legacy approval-event fallback.
2. **0.21.5 correctness fixes the bump requires or exposes:**
   - key turn end on `message.complete`;
   - show `status:"interrupted"` as "Stopped" (not the success haptic);
   - make sure no RPC sends unknown param keys (4000);
   - give `subagent.interrupt` a `session_id` if it is ever called;
   - parse the `>>>…<<<` search-snippet markers.
3. **Stop:** `session.interrupt`.
4. **Steer:** `session.steer` from the composer while busy, falling back to `prompt.submit` on `rejected`.
5. **Server-request cards:**
   - approval (new path);
   - clarify (single and batch, `clarify.lock`);
   - secure entry (sudo and secret);
   - a "finish on desktop" note for vault prompts;
   - automatic `-32601` for everything else.
6. **`open_requests` replay** on resume and reconnect, and **`session.events.since`** event replay on
   reconnect.
7. **Polish:** the attach sheet layout, and resetting the composer height after send.
8. **Plugin:** a `DeviceStore` concurrency fix (required before the bump). Also skip the duplicate push
   for coalesced approvals.
9. **Gateway bump** to `v2026.9.24` (0.21.5), after PR #29 merges.

**Next round (explicitly out):**

- a context and usage ring;
- subagent interrupt and steer from the cards;
- undo, branch and compress;
- session rename, delete and hide;
- goal and loop controls, `prompt.btw`, and Claude Code / Codex session import (`session.foreign.*`);
- remote admin;
- curator rollback;
- clarify on 0.20.4 (the gateway will not stay there).

## 4. Architecture — transport (decision 1A)

### 4.1 Vendored upstream code

- **Copy verbatim** from `NousResearch/hermes-agent@v2026.9.24` `apps/shared/src/` into
  `src/vendor/hermes-gateway/`:
  - `json-rpc-channel.ts` (576 lines)
  - `json-rpc-gateway.ts` (706)
  - `gateway-events.ts` (58)
  - `gateway-contract.generated.ts` (5,657)
  - the upstream `LICENSE` (MIT)
- The only edit allowed: rewriting the relative import specifiers if Metro/tsc need it (`./x.js` →
  `./x`). The sync script applies that rewrite **mechanically**, so it is reproducible.
- **`scripts/sync-gateway-contract.sh <tag>`**:
  - fetches the files at the tag;
  - applies the import rewrite;
  - writes `src/vendor/hermes-gateway/VENDORED.json` with `{tag, commit, files:{name: sha256}}`.
- **A Jest drift-guard test** recomputes the hashes and fails if a vendored file was hand-edited. Any
  change to vendored behaviour happens only by re-syncing to a new tag.
- **React Native compatibility is proven first** (the plan's first task, before anything builds on it):
  - the vendored files typecheck under the app's `tsconfig`;
  - they run under jest-expo;
  - `JsonRpcGatewayClient` connects over the RN `WebSocket` through the `socketFactory` option.

  The app's socket factory sets an `Origin` header (api-delta §4 caveat), and `socketFactory` must keep
  doing that. If the vendored client proves incompatible and cannot be fixed without editing vendored
  source, **stop and re-plan**: fall back to 1B (types only), and that fallback is a user decision.

### 4.2 The app's adapter

- `src/api/gatewayClient.ts` becomes a thin adapter over `JsonRpcGatewayClient`. It keeps the surface
  the rest of the app uses (`call`, event subscription, close handling, `isOpen`) and delegates the
  wire work.
- **`connection.ts` keeps owning** ticket minting (single-use, 30 s), reconnect policy
  (`lib/reconnect.ts`) and the AppState foreground reconnect from PR #22.
  - Upstream's client leaves reconnection to its owner ("the outer connection owner decides
    whether/when to reconnect"), so there is no overlap.
  - Every reconnect mints a fresh ticket and dials a new URL, as today.
- **Capability handshake:** handled by the vendored channel on `gateway.ready`.
  - **Legacy mode:** if the gateway does not support `client.capabilities` (0.20.4), the adapter
    reports `serverRequests: false`, and the chat keeps handling the `approval.request` **event** with
    `approval.respond`, exactly as today.
  - The plan's first task **verifies against a real 0.20.4 frame trace** what the channel does when the
    method is unknown (error reply vs no `gateway.ready`). The legacy detection is written against
    observed behaviour, not assumed behaviour.
- **Types:** every RPC params/result, server-request params/result and event payload type comes from
  `gateway-contract.generated.ts` (no local aliases, no parallel interfaces).
  - Overlapping hand-written types in `src/api/types.ts` are deleted.
  - Types the gateway doesn't define (REST shapes, plugin routes) stay app-owned.
- **Unknown-param audit:** a unit test enumerates every `call(method, params)` site's param keys and
  checks them against the generated params type. The typechecker does most of this for free once
  `call` is typed on `RpcMethods`.

### 4.3 Splitting the chat screen

`src/app/chat/[id].tsx` is 855 lines and would absorb all of this. Turn and request state moves into a
pure, unit-tested module:

- **`src/lib/turn-controller.ts`** (no RN imports). A reducer plus action creators for:
  - turn lifecycle (`idle | streaming | stopping`);
  - the send decision (`submit | steer`);
  - `message.complete` status mapping;
  - open server requests keyed by request id (add, answer, cancel, replay dedupe).
- **`src/lib/server-requests.ts`.** Maps `ServerRequestMap` methods to the card kinds `approval`,
  `clarify`, `secure-entry` and `desktop-only`. Anything else is left to the channel's automatic
  `-32601`.
- The screen keeps rendering and wiring. The existing subagent, todo and approval logic moves only as
  far as needed to share the new request plumbing; no unrelated refactor.

## 5. Turn control

### 5.1 Composer states

| turn state | input empty | input has text |
|---|---|---|
| idle | send (disabled) | **send** → `prompt.submit` |
| streaming | **Stop** (■) | **Stop** (■) + **steer-send** (↑) |
| stopping | "Stopping…" (Stop disabled, spinner) | steer-send disabled |

- The placeholder while streaming becomes "Steer Hermes…".
- The input stays editable while streaming, as today.
- Colours come from `useTheme()`. Stop uses `colors.text` on `colors.raised`, so the accent stays
  reserved for primary send.

### 5.2 Stop

1. Call `session.interrupt {session_id}` (no other keys).
2. Show "Stopping…" optimistically.
3. The turn ends on `message.complete` with `status:"interrupted"`:
   - the partial reply stays;
   - a "Stopped" marker renders under it;
   - no success haptic plays;
   - open request cards close on their `request.cancel {reason:"interrupted"}`.
4. The result `{status:"interrupted"}` says nothing about whether a turn was running (api-delta §1), so
   the UI never depends on it.

**Errors:**

- `4001` (stale runtime id): resume the stored id and retry once.
- Anything else: an inline error on the composer, with Stop re-enabled.
- If no `message.complete` arrives within **15 s** after a successful interrupt, run the existing
  reconnect/rehydrate path. That path already reconciles from history.

### 5.3 Steer

1. While streaming, send text with `session.steer {session_id, text}`. Possible results:
   - `queued`: render the text as a user bubble marked **"steered"**. At 0.21.5 it lands as its own
     user row after the current tool batch.
   - `redirected`: render it as a normal user bubble.
   - `rejected` (the turn already ended): send the same text with `prompt.submit` as a normal turn.
2. Errors:
   - `4002` (empty text): cannot happen, because the UI never sends empty text.
   - `4010`: fall back to `prompt.submit`.
   - Others: inline error, and the text is restored to the input.
3. **Images cannot be steered.** If a photo is staged while streaming, only steer-send of text is
   allowed. The photo waits for idle, and the chip says so.

## 6. Server-request cards

**Common rules:**

- **Where cards live.** Every open request becomes one card in the transcript, keyed by the JSON-RPC
  request id.
- **Answering.** A card is answered by the vendored channel's response frame with the typed result.
- **Cancellation.** A `request.cancel {id, reason}` marks the card closed and shows the reason:
  - `interrupted` → "Stopped"
  - `timeout` → "Timed out"
  - `resolved` → "Answered elsewhere"
  - `session_closed` / `shutdown` → "Closed"
- **Replay.** `open_requests` from `session.resume`, `session.activate` or `session.events.since` is fed
  through the same handler. Dedupe is by id, so a replayed request never renders twice.
  - A replayed clarify batch carries `answers` for questions already locked. Those render as answered.
- **Push.** A push notification that opens the app lands on the chat. Resume replays the open request,
  so the card is there.

### 6.1 Approval

- The existing `approval-card.tsx` UI stays.
- Transport:
  - **0.21.5:** the `approval` server request, answered with result `{choice}`.
  - **Legacy (0.20.4):** the `approval.request` event plus `approval.respond`.
- The FIFO "only the oldest is actionable" rule stays. The gateway coalesces identical prompts, and the
  app dedupes by request id on top of that.

### 6.2 Clarify

**Params (0.21.5, api-delta §2):**

- **single:** `{session_id, question, choices|null, multi_select?}`
- **batch:** `{session_id, questions:[{qid, question, choices|null, multi_select}]}`, with 1–5
  questions and optional replayed `answers`

**Card:**

- one section per question, with its text;
- choices as tappable rows: radio, or checkboxes when `multi_select`;
- a first choice ending in "(Recommended)" is shown with a subtle badge rather than the raw suffix;
- a free-text **"Other…"** row for every question;
- choices `null` means an open-ended text field only.

**Answering:**

- **Single:** respond `{answer: string}`.
- **Batch:**
  - Each question can be answered on its own. Answering calls `clarify.lock {request_id, question_id,
    answer}` so progress survives a disconnect.
  - `remaining: []` from the last lock resolves the request, so no separate response is needed.
  - A **Submit** button covers "answer all at once" by locking the remaining questions in order.
- **Multi-select** answers are sent as a JSON array string (`_clean_answer` accepts it, api-delta §2).
- **Skip:**
  - single: `{answer:""}`;
  - batch: a response with no `answers` cancels the whole batch.
- `clarify.lock` returning `expired` marks the card "Timed out".

### 6.3 Desktop-only and vault prompts

- `vault.unlock_prompt`, `vault.save_login` and `vault.code`:
  - answered by the channel's automatic `-32601`;
  - the transcript shows a non-interactive note: "Hermes asked for a password-manager action — finish it
    on your desktop."
- `terminal.read`, `preview.read`, `preview.act`, `window.read`, `tour` and `display.install.sudo`:
  silent `-32601`.

### 6.4 Secure entry (sudo and secret)

**Threat model.**

- **The phone side** — masking, memory, logs, push — can be made safe.
- **The gateway side is the real risk.** A `secret` is saved to `/opt/data/.env`, which the agent's own
  uid (10000) can read. That is the opposite of the credexec boundary.
- **Phishing is the plausible attack.** The agent writes its own skills. If it is prompt-injected, it
  can author a skill that "requires" a credential and trigger a genuine-looking prompt.
- **`sudo` cannot fire on dc1-1** today, because the container has no `sudo` binary. It is supported for
  completeness, since it shares the card.

**Card contents:**

- **Title by kind:**
  - sudo: "Administrator password"
  - secret: "Value for `ENV_VAR`"
- **The ask:**
  - The agent-written `prompt` text sits under a label: "Requested by the agent".
  - For sudo, the redacted `command`.
- **Provenance (secret only):**
  - `metadata.skill_name`, plus its **provenance** looked up from `GET /api/skills` (`hub` / `bundled`
    / `agent`).
  - `agent` gets a warning: "This skill was written by the agent or by hand on the server. Only
    continue if you asked for this."
  - If the lookup fails or the skill isn't found, show the same warning (fail closed).
- **Where the value goes (secret):** "Saved to the gateway's .env — the agent can read it."
- **Field:**
  - `secureTextEntry`;
  - `autoCorrect={false}`, `autoCapitalize="none"`, `spellCheck={false}`;
  - `textContentType="password"`, so iOS Passwords autofill works.
- **Buttons:**
  - **Skip** is prominent and responds `{value:""}`; the agent sees "skipped".
  - **Send** requires a **Face ID** check (`expo-local-authentication`, device passcode fallback)
    immediately before responding. A failed or cancelled check keeps the card open and sends nothing.

**Data handling rules** (each one gets a test):

- The value lives only in the field's local component state.
  - It is never put in the turn controller, the transcript items, history, AsyncStorage or SecureStore.
  - It is never passed to `console.*` or any error message.
- The field state is cleared on send, skip, cancel, unmount and interrupt.
- The transcript card afterwards shows only "Sent" / "Skipped", never the value or its length.
- The adapter never logs outbound response frames for `sudo` or `secret` methods, even in `__DEV__`.
- Push notifications for these requests, if any, carry no prompt text.

**New dependency:** `expo-local-authentication` is a native module, so it needs a native rebuild. Add
`NSFaceIDUsageDescription` to `app.json`.

## 7. Replay on reconnect

- **Tracking.** The vendored `JsonRpcGatewayClient` tracks the last event `seq` per session. After a
  reconnect it calls `session.events.since {session_id, last_seen}`, with the `replay` option on by
  default.
- **Fallback.** If the result says `truncated:true`, or replay fails, the app falls back to today's
  `GET /api/sessions/{id}/messages` rehydrate.
- **Open requests.** `open_requests` comes back on that call and on `session.resume`, and is routed per
  §6.
- **Interplay with PR #22.** The existing single-flight reconnect and teardown in `chat/[id].tsx` stay.
  Replay runs inside the "reconnected" step and before the history fallback, never concurrently with it.

## 8. Polish

### 8.1 Attach sheet (`src/app/attach.tsx`, `_layout.tsx:46-54`)

**Observed** on device (screenshot 2026-09-28, dark):

- no ✕ or "Add to chat" header;
- the title's "to" shows between the Camera and Photos tiles;
- the tiles sit against the grabber;
- roughly 300 pt of empty sheet under Memory.

**Hypothesis:** the root is a `flex: 1` + `ScrollView` inside a `formSheet` with numeric detents
`[0.6, 0.95]`. The scroll content is laid out over the header row, and the fixed 60 % detent is taller
than the content.

**Fix direction** (confirmed on the simulator before and after, per systematic debugging):

- `sheetAllowedDetents: 'fitToContents'`;
- no `flex: 1` on the root;
- replace the `ScrollView` with a plain `View` (seven rows fit on the smallest supported phone at the
  largest Dynamic Type we support; verify);
- top padding that clears the grabber.

**Accept:** the header is visible, nothing shows through, there is no dead space, and it looks right in
dark and light, on the smallest and largest supported phone.

### 8.2 Composer height after send (`src/components/composer.tsx`)

**Observed:** after a multi-line message is sent and the input is cleared, the multiline `TextInput`
keeps its grown height until the screen remounts.

- **Reproduce first** on the simulator (new architecture).
- **Fix candidates**, chosen after reproduction:
  - track height via `onContentSizeChange`, clamped to 120 and reset explicitly when the value becomes
    empty; or
  - re-key the input on send (loses focus, so less preferred).

**Accept:** after sending a 6-line message the composer returns to one line, the keyboard stays up, and
focus is kept.

## 9. Server side

### 9.1 Plugin (`gldc/hermes-mobile-plugin`), merged **before** the bump

- **Required: `DeviceStore` concurrency (bump §4).** At 0.21.5, dashboard refresh runs in a threadpool.
  `DeviceStore` has no lock and one tmp name per PID, so concurrent refreshes can lose an update and
  bounce a device to re-pair.
  - **Fix:**
    - a `threading.Lock` around load→modify→save in `rotate_refresh`, `revoke*` and the push-token
      setters;
    - a unique tmp file per write (`tempfile.mkstemp` in the same dir, then `os.replace`).
  - **RED first:** a threaded test that loses an update without the lock.
  - Must pass on both 0.20.4 and 0.21.5.
- **Optional (included): skip coalesced approval pushes.** At 0.21.5, coalesced approval followers
  fire `pre_approval_request` with `coalesced=True`, and the plugin pushes a duplicate notification. The
  fix is `if kwargs.get("coalesced"): return`, RED first.
- Deploy is merge to `main`. dc1-1 pulls plugin main on boot, and the bump step pulls explicitly (§9.2).

### 9.2 Gateway bump (`gldc/hermes-deploy`)

This follows `docs/dc1-runbook.md` Phase B plus the additions marked ★ in bump §6. In short:

1. **Merge PR #29** (0.20.4, live for 40 days). He approved this.
2. **Pin** `v2026.9.24` = `nousresearch/hermes-agent@sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7`
   in `IMAGE` and `ARG BASE`.
3. **B2 checks in the new base:**
   - the plugin suite;
   - the differential loader smoke;
   - `hermes plugins compat`;
   - `assert_protocol_compliance(MobileDeviceProvider)`;
   - re-grep `required_credential_files`, which must still be google-workspace only.
4. **Rollback image:** tag `hermes-dc1:pre-0.21.5` from `:local` **before** the build. The older rollback
   tags are all 0.18.2 builds and useless here.
5. **Plugin checkout:** a uid-10000 `git pull --ff-only` in `/opt/data/plugins/hermes-mobile`, then check
   that `log -1` shows the §9.1 SHA. The live checkout already tracks `main`; the wiki line saying
   otherwise is stale.
6. **Stop and back up:**
   - `cp -p data/config.yaml data/config.yaml.bak-YYYYMMDD-pre0215`;
   - stop, and check the WAL is at 0;
   - take a **cold backup with the extended list** (bump §2 adds `mobile/`, `projects.db`, `auth.json`,
     `SOUL.md` and others), `chmod 0600`;
   - run `PRAGMA integrity_check` on the backup's `state.db` under SQLite 3.53.4, and rebuild FTS first
     if it reports malformed.
7. **Compaction setting:** set `compression.threshold_tokens: null` (his decision: keep roughly 750K on
   k3's 1M context). Back up the config before the edit.
8. **Build and bring up.** First boot migrates config 37→46 and `state.db` schema 26→30, including a
   one-time trigram FTS rebuild. Both are **one-way**.
9. **Rollback procedure:**
   - `down`;
   - retag `pre-0.21.5` → `:local`;
   - **restore `config.yaml`, `state.db` (with the `-wal` removed) and `kanban.db` from the tarball**;
   - `up -d`.
10. **STATE.md, CHANGELOG and the wiki** (`hermes-deploy`, `hermes-agent`, `hermes-mobile-plugin`,
    `hermes-mobile-app` pages) are updated in the same PR.
11. **Keep the `mobile` + `hermes-mobile` double entry** in `plugins.enabled`. #67069 is still open at 9.24.

**Acceptance** (bodies and real calls, never status codes alone):

- `hermes --version` reports 0.21.5.
- A diff of `config.yaml` against the backup shows only the expected migration edits and the
  compression change.
- As uid 10000 via `bash -lc`:
  - `hermes status`;
  - `hermes fallback`;
  - a real `hermes chat -q` turn answered by k3.
- Every credexec broker: one real call and one exit-77 denial.
- The dashboard serves the real sign-in page body.
- A Slack reply.
- The mobile adapter is connected (no `is_reconnect`-style errors in `agent.log`).
- A cross-node concurrency probe from the Mac with `tailscale up` returns PROBE PASS.
- **App-on-0.21.5 QA (§10.3).**

**Watch items (bump §6, uncertainty register):**

- The new `connections` toolset step.
- The gateway control socket on shfs (upstream #123761; failure is non-fatal).
- How long the FTS rebuild takes on the 178 MB DB.
- **The multiplex hazard:** a second profile would read secrets only from per-profile `.env`, breaking
  model access and Slack. Document it in STATE.md, and create no second profile.

## 10. Testing

### 10.1 Unit (Jest, RED→GREEN, injected fake socket)

- **Vendoring:**
  - the drift-guard hashes;
  - the vendored client connects through the app's `socketFactory` (fake RN socket);
  - the capability handshake is sent on `gateway.ready`;
  - an unhandled server request gets a `-32601` reply.
- **Legacy detection:** replay a recorded 0.20.4 frame sequence, and approvals still work over the
  event path.
- **Turn controller:**
  - submit vs steer vs steer-rejected→submit;
  - Stop → stopping → `message.complete{interrupted}` → "Stopped" (no success haptic);
  - an `error` event outside a turn does not end the turn;
  - 4001 on interrupt → resume and retry once;
  - the 15 s no-complete fallback.
- **Server requests:**
  - add, answer and cancel for every card kind;
  - each cancel reason's label;
  - replay dedupe by id;
  - replayed batch `answers` render as locked.
- **Clarify:**
  - single and batch payloads parse against the generated types;
  - lock per question;
  - `remaining:[]` resolves;
  - the multi-select answer serialises to a JSON array string;
  - skip semantics;
  - `expired`.
- **Secure entry:**
  - provenance `agent` or a failed lookup shows the warning;
  - a Face ID failure sends nothing;
  - **the value never appears in controller state, transcript items, or any `console.*` call** (spy);
  - state is cleared on every exit path.
- **Search:** `>>>…<<<` snippets parse to highlight runs.
- **Params:** no RPC call carries a key outside its generated params type.
- **Plugin (pytest):**
  - the threaded `DeviceStore` lost-update test (RED without the lock);
  - the unique tmp file name;
  - the coalesced approval push is skipped.

### 10.2 Integration (local, before touching dc1-1)

- Run `nousresearch/hermes-agent@sha256:fca358f1…` in Docker on the Mac, with the dashboard, `basic`
  auth and the mobile plugin mounted. Point the simulator build at it.
- Drive real turns with a real model key:
  - a dangerous command → approval card;
  - a prompt that makes the model call `clarify` with a batch;
  - a throwaway skill that declares a `required_environment_variables` entry → secure-entry card, with
    Face ID simulated in the simulator;
  - Stop mid-tool;
  - steer mid-run;
  - kill the socket mid-clarify → replay restores the card.
- Also run the simulator build against the **live 0.20.4** dc1-1, before the bump, to prove the legacy
  approval path, plus stop and steer.
- Screenshot every card and both polish fixes in dark and light, and put the screenshots in the PR.

### 10.3 On device (his QA, the real gate)

- A native rebuild installed on his iPhone (new native module).
- After the bump, on 0.21.5:
  - stop;
  - steer;
  - approval;
  - a clarify batch;
  - a secret (throwaway skill);
  - background the app mid-clarify, then foreground;
  - the attach sheet;
  - the composer after a long message;
  - both themes.

## 11. Delivery

**Five PRs**, each through branch → PR → CI green (gated on exit codes) → adversarial review → merge.
Parallel subagents in worktrees where the plan finds independence.

1. **Plugin:** the `DeviceStore` lock plus the coalesced skip (`hermes-mobile-plugin`). Independent;
   first.
2. **App A, transport:** vendoring plus the sync script, the adapter, the legacy fallback, the 0.21.5
   correctness fixes, the turn-controller extraction, and replay.
3. **App B, turn control and cards** (depends on A): Stop, steer, the approval migration, clarify, secure
   entry, and the vault note.
4. **App C, polish** (independent of A and B, can run in parallel): the attach sheet and the composer
   height.
5. **Deploy:** merge #29, then the bump PR (`hermes-deploy`). It runs only after 1 is merged and 2–3 are
   verified locally against 0.21.5 **and** against live 0.20.4.

**Order on the box:**

1. plugin merge;
2. app build installed on his phone (works on 0.20.4 through the legacy path);
3. gateway bump;
4. his QA on 0.21.5.

**If the bump has to roll back,** the installed app still works on 0.20.4.

## 12. Risks

| risk | mitigation |
|---|---|
| The vendored client doesn't run under RN or Hermes JS | The plan's first task proves it before anything depends on it. The fallback to 1B is a user decision. |
| The vendored transport regresses PR #22's reconnect hardening | Reconnect ownership stays in `connection.ts`; the existing reconnect tests must stay green unchanged; the replay-vs-rehydrate ordering is tested. |
| 0.20.4 legacy detection misfires, so approvals break before the bump | Legacy mode is built from a recorded 0.20.4 frame trace and verified live against dc1-1 before the bump. |
| Secret phishing by a prompt-injected agent | The §6.4 provenance warning, fail-closed lookup, Face ID, the "agent can read it" disclosure, and a prominent Skip. |
| A one-way migration breaks the box | Cold backup with the extended list, an integrity check on the backup, and a tested rollback procedure (§9.2). |
| Refresh concurrency bounces the phone to re-pair | The plugin lock merges before the bump. |
