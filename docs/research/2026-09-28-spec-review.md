# Adversarial review: `2026-09-28-control-path-0.21.5-design.md`

Reviewed 2026-09-28 against: upstream `v2026.8.18` (O:) and `v2026.9.24` (N:) via `git show`, app `docs/control-path-0.21.5-spec` @ eab8107, plugin `main` @ 65e6efd, deploy `chore/base-bump-2026.8.18` (PR #29 still OPEN), and one read-only grep of the live dc1-1 `config.yaml`.
I also typechecked the four vendored files, with the import rewrite applied, under the app's `expo/tsconfig.base` in a scratch copy: `tsc` exit 0.

Totals: **1 BLOCKER, 11 MAJOR, 21 MINOR.**

---

## BLOCKER

### B1. §7 / §4.2: replay and open-request cards do not survive the app's reconnect flow as specified
- **Claim:** "The vendored `JsonRpcGatewayClient` tracks the last event `seq` per session. After a reconnect it calls `session.events.since`." Also: "if the result says `truncated:true`, or replay fails, the app falls back to … rehydrate", and "the existing single-flight reconnect … stay[s]".
- **Evidence:**
  1. **The app never reconnects on the same client.** `openGateway()` builds a **new client per connection** (`src/connection.ts` last function: `new GatewayClient(...)` then `connect`), and `establish()` swaps `gwRef` to it (`chat/[id].tsx:409-422`).
     - The vendored watermarks live on the instance (`json-rpc-gateway.ts:122`).
     - `fetchReplay()` is a no-op when `lastSeenSeq.size === 0` (`:496`).
     - A per-connection instance therefore **never replays**.
  2. **The app never sees the replay result.** The replay is internal and fire-and-forget (`:256`, `:495-579`). It reads only `events` and `epoch`, **ignores `truncated`**, and swallows every error (`:572-574`).
     - The app therefore cannot branch on `truncated` (N:`contracts/sessions.py` `SessionEventsSinceResult.truncated`).
     - The only coordination API is `sessionReplayBarrier(sid)` (`:473-487`), and the spec never mentions it.
  3. **History reload wipes the replayed cards.** `reconnect()` always runs `establish()` (which calls `session.resume`) and then `loadHistory()`. `loadHistory()` does `setItems(historyToItems(...))` and replaces every item (`chat/[id].tsx:324-332`, `451-453`).
     - The channel delivers `open_requests` **before** the `session.resume` promise resolves (`json-rpc-channel.ts:352-360`). So a replayed clarify, approval or secret card is appended and then wiped by the history replace.
     - Dedupe-by-id then treats the request as already shown. The card never comes back, and the agent waits out `clarify_timeout` (600 s live).
     - This breaks the §1 success criterion "survive the phone sleeping and waking".
  4. **A reused instance will not redial a zombie socket.** `connect()` returns early if the old socket still reads `OPEN` or the state is `connecting` (`json-rpc-gateway.ts:197`). A reused instance must `invalidate()` before `connect(newUrl)`.
- **Correction:** specify the lifecycle.
  - Create **one `JsonRpcGatewayClient` per chat screen**, reused across reconnects: `invalidate()` → mint ticket → `connect(newUrl)`.
  - Keep open server-request cards in turn-controller state **keyed by request id, outside `items`**, and render them merged after history, so a history replace can't drop them. Or re-merge open requests after `loadHistory`.
  - Decide explicitly whether REST rehydrate still runs on every reconnect.
    - If it does, gate it with `await client.sessionReplayBarrier(sid)`, and treat replayed deltas as superseded.
    - If replay should replace it, either run replay yourself with `replay:false` plus your own `session.events.since` call (so `truncated` is visible), or accept that `truncated` is not observable.
  - Add a test: "reconnect mid-clarify → history reload → card still present and answerable".

---

## MAJOR

### M1. §4.2 / §10.1: the "legacy mode" detection cannot be built on the vendored client without editing it
- **Claim:** "if the gateway does not support `client.capabilities` (0.20.4), the adapter reports `serverRequests:false`". The first task is to check "error reply vs no `gateway.ready`".
- **Evidence:**
  - That question is already answerable. 0.20.4 **does** emit `gateway.ready` on WS (O:`tui_gateway/ws.py:314-324`, payload `{skin, change_events}`, no `heartbeat`, no `replay_epoch`). It answers unknown methods with `-32601 "unknown method"` (O:`tui_gateway/server.py:2068-2070`).
  - The vendored channel sends `client.capabilities` itself and **swallows the result**: `.catch(() => undefined)`, and the success value is discarded (`json-rpc-channel.ts` `advertiseCapabilities`).
  - So the adapter has no signal to set `serverRequests:false` from.
- **Correction:** drop detection.
  - Always register the server-request handlers **and** always handle the `approval.request` event with `approval.respond`.
  - 0.21.5 never emits `approval.request`: it is removed from the N: contract. 0.20.4 never sends server requests. The two paths are mutually exclusive by construction.
  - If a flag is ever needed, derive it from `gateway.ready.payload.replay_epoch` being present (required at N:`contracts/events.py:51-56`, absent at O:). Don't use the capability reply.
  - Replace the "record a 0.20.4 frame trace" task with a test that feeds an O:-shaped `gateway.ready` plus the `-32601` reply and asserts that approvals still work over the event path.

### M2. §4.2 / §7: a capability-handshake race can silently withdraw approvals on reconnect
- **Evidence:**
  - `connect()` resolves on socket `open` (`json-rpc-gateway.ts:246-258`). The capability request goes out only when `gateway.ready` is **received** (`json-rpc-channel.ts` `handleFrame` → `advertiseCapabilities`).
  - `establish()` calls `session.resume` immediately after connect (`chat/[id].tsx:424`). So `session.resume` can reach the server **before** `client.capabilities`.
  - Resume attaches the new WS transport (N:`methods_session.py:752-756`).
  - `_session_client_answers_requests` returns False when every live WS client attached is non-advertising (N:`session_transports.py:38-47`).
  - An approval raised in that window hits `_unanswerable` → `on_result(None)` → **withdraw** (N:`server_requests.py:117-122,186-188`; N:`server.py:779-788`). Clarify gets `""`.
  - The window is small, but it opens on exactly the reconnect-mid-turn path the feature exists for.
- **Correction:** the adapter's `connect()` must not resolve (or `session.resume` must not be sent) until `gateway.ready` has arrived **and** the capability request is on the wire.
  - Frames are processed in order, so waiting for `gateway.ready` and then yielding one tick is enough, because the channel sends the capability synchronously inside `handleFrame`.
  - Add a unit test for the frame order: `gateway.ready` → `client.capabilities` → `session.resume`.

### M3. §6 / §7: handlers must be registered before any frame can arrive, because a `-32601` is destructive
- **Evidence:**
  - With no accepting handler, the channel answers `-32601` (`json-rpc-channel.ts` `deliverRequest` tail). That applies to live frames and to `open_requests` replays inside a `session.resume` or `session.events.since` result.
  - At N:, an error response settles the request as unanswered: `resolve_response` sets `answered=False` (N:`server_requests.py:218-220`).
  - For approval that means `on_result(None)` → **withdrawn** with the text "update the Hermes app" (N:`server.py:779-788`). Clarify returns `""` or a blank batch.
  - `fetchReplay()` fires inside `onOpen`, **before** `connect()` resolves (`json-rpc-gateway.ts:256`). Any handler attached after `connect()` misses replayed `open_requests`.
- **Correction:**
  - State as a hard rule: `client.onRequest(...)` is registered once, at client construction, before the first `connect()`, and never torn down and re-added across reconnects.
  - The handler must accept (return non-`false`) every mobile-supported method **even when no chat UI is mounted yet**. It should queue into the turn controller, not depend on React render.
  - Add a test: `open_requests` in a `session.resume` result, delivered before the screen state is ready, gets a card and **no** `-32601`.

### M4. §5.1 / §4.3: turn state is driven only by local send, but the server starts turns on its own and dc1-1 runs `busy_input_mode: interrupt`
- **Evidence:**
  - dc1-1 `config.yaml:259` is `busy_input_mode: interrupt`, read live and read-only.
  - `prompt.submit` on a busy session then **redirects or hard-interrupts** the live turn (O:`server.py:8045-8140`; N:`methods_prompt.py:636-654` → `session_auto_continue.py:248-291`).
  - The server starts turns without the app's `prompt.submit`:
    - a leftover steer is requeued as a follow-up turn (N:`prompt_turn.py:438-441`; also O:`server.py:11337-11341`);
    - goal continuation (`:442-447`);
    - queued-prompt drain and crash auto-continue (the `session.resume` `auto_continue` field).
  - `dropAndReconnect` forces `setStreaming(false)` (`chat/[id].tsx:337-345`), so after any reconnect mid-turn the composer shows **idle**. A "send" then interrupts the running turn.
  - The spec's controller has only `idle | streaming | stopping`, driven by send, and ignores `message.start` and the resume `running` / `status` / `inflight` fields (N:`contracts/sessions.py` `LiveSessionSnapshot`).
- **Correction:**
  - The turn controller enters `streaming` on `message.start` (emitted at both tags: O:`server.py:7862`, N:`prompt_turn.py:420`). It seeds from `session.resume` `running` / `status` at 0.21.5 and `inflight` at both.
  - Idle-state submits carry `queued: true`. It exists at both tags (O:`server.py:8045` signature; N:`contracts/prompt_voice.py:36`) and never redirects or interrupts a busy session.
  - Add tests: `message.start` without a local send → streaming; resume with `running:true` → streaming with Stop visible.

### M5. §5.3: the steer fallbacks can kill the live turn, and steer "works on 0.20.4" is overstated
- **Evidence:**
  - At N:, `4010` is returned while the agent is still being built (`running` true, `agent` None). Only **redirect** has a queue carve-out (N:`methods_session.py:2184-2193`).
    - The spec's `4010` fallback to plain `prompt.submit` hits the busy path.
    - Under `interrupt` mode with no agent, that path enqueues **and calls `_interrupt_busy_session`**, which hard-interrupts the just-started turn.
  - At O:, `session.steer` never returns `rejected`. `AIAgent.steer` returns True for any non-empty text (O:`run_agent.py:3379-3413`; handler O:`methods_session.py:3406-3440`).
    - A steer that races the turn end, or lands on an idle session, returns `queued`.
    - The text then lands on some later tool result, or is requeued as a follow-up turn (O:`server.py:11337-11341`).
    - Either way the `rejected → prompt.submit` fallback never fires on 0.20.4.
  - `session.steer` only ever returns `queued | rejected` (N:`methods_session.py:2203-2206`: the accepted status is `"queued"`). `redirected` belongs to `session.redirect`.
- **Correction:**
  - Every fallback submit uses `prompt.submit {…, queued:true}`.
  - Drop `redirected` from the steer result handling.
  - State that on 0.20.4 steer is best-effort mid-turn: no `rejected`, and the text is appended to a tool result, so it is not a user row and disappears from history after a rehydrate.
  - Add `4001` → resume + retry once, the same as Stop.

### M6. §5.2 / §10.1: "an `error` event outside a turn does not end the turn" can strand the composer
- **Evidence:**
  - `error` is documented as "outside a turn" (N:`contracts/events.py:86-92`).
  - Several N: sites fire right after `prompt.submit` with **no following `message.complete`**:
    - the ownership refusal clears `running` and emits `error` (N:`prompt_turn.py:120-133`);
    - agent init failed (N:`server.py:1138`);
    - queued-prompt dispatch failed (N:`session_auto_continue.py:333`).
  - Turn failures do end with `message.complete status:"error"` at both tags (O:`server.py:8286-8318`; N:`prompt_turn.py:895-906`).
  - If the app ignores `error` while waiting for `message.complete`, it sits in `streaming` with only Stop available. The 15 s fallback exists only after Stop.
- **Correction:**
  - `error` ends the turn if no `message.start` has arrived since submit (the "waiting" sub-state). After `message.start`, `error` shows a notice and does not end the turn.
  - Or reconcile via a cheap state read, such as `session.resume` `status` / `running`.
  - Adjust the §10.1 test accordingly.

### M7. §9.1: the DeviceStore lock as written does not cover the actual race
- **Claim:** "a `threading.Lock` around load→modify→save in `rotate_refresh`, `revoke*` and the push-token setters".
- **Evidence:** the plugin builds **several independent `DeviceStore` instances** in the same dashboard process.
  - `plugin.py:27` builds one, passed to the auth provider (`rotate_refresh`, `revoke_by_refresh`: `auth_provider.py:101,123`).
  - `plugin_api.py:77` has its own `_get_store()` instance, used by `set_push_token` (`plugin_api.py:137`).
  - An instance-attribute lock serializes neither against the other.
  - `create_device` (`device_store.py:139-162`) is also load→modify→save and is missing from the list.
  - `hermes mobile pair` / `revoke` run in a **separate CLI process** (`cli.py:110,164`), which no threading lock covers.
- **Correction:**
  - Use a **module-level** lock, keyed per resolved store path, plus an `fcntl.flock` on a sidecar lock file for cross-process writers. flock works on this shfs path: the Slack token lock already uses it, per bump §3.
  - Cover `create_device`, `rotate_refresh`, `revoke`, `revoke_by_refresh` and `set_push_token`.
  - Make the RED test use **two `DeviceStore` instances** on one path (rotate on one, `set_push_token` on the other) so the lock scope is exercised.

### M8. §6.4: the provenance signal is weaker than the card implies
- **Evidence:**
  - `/api/skills` provenance is a **name lookup**: `hub` if the name is in the hub-installed set, `bundled` if it is in the bundled manifest, else `agent` (N:`hermes_cli/web_routers/skills.py:343-370`).
  - Bundled skills live under `/opt/data/skills`, which uid 10000 can write, and the agent has skill-editing tools.
    - A prompt-injected agent can add `required_environment_variables` to an existing **bundled** or **hub** skill's `SKILL.md`, or reuse such a name.
    - The card would then show "bundled" or "hub" with **no warning**, which is the exact phishing case §6.4 targets.
  - `metadata.skill_name` is agent-influenceable (N:`tools/skills_tool_setup.py:108`).
  - Two claims hold:
    - fail-closed for disabled or unknown skills (`skip_disabled=True`);
    - a just-created skill appears, because `_find_all_skills` scans the disk on every call.
  - The route takes `?profile=`; the card should pass the chat's profile.
- **Correction:**
  - Show the "only continue if you asked for this" warning on **every** secret card.
  - Show provenance as information, not as a trust grade. If a trust grade is wanted, it needs a content hash against the bundled or hub manifest, which is out of scope.
  - Reachability is fine: `session.create` / `resume` set `HERMES_INTERACTIVE=1` (N:`server.py:1311-1313`; N:`methods_session.py:369,562`), so `_is_gateway_surface() and not HERMES_INTERACTIVE` is False, and the secret callback is wired (N:`agent_callbacks.py:199-213`).

### M9. §9.2: the "in short" bump list drops ★ steps and acceptance checks the plan-writer needs
Compared with the bump assessment's "Steps" and "Acceptance" sections and the runbook's Phase B, the spec's list omits:
- **Steps:**
  - B0 (re-diff on execution day);
  - B1's pin-comment and `_bindscan.py` / `test_broker.py` / compose wording updates (RED→GREEN);
  - B3 (rsync, `_bindscan --assert-no-package-mount --assert-owns-pid1`, probe build);
  - ★ **migration dry-run on a copy** (expect exactly steps 40 and 44, and time the v30 trigram rebuild on 178 MB).
- **His decision:** the curator setting (`prune_builtins`, 30/14-day archive) was flagged as "his call" in the assessment. §1 records only the compression decision.
- **Acceptance:**
  - `hermes doctor` (no `--fix`) reports no FTS damage;
  - schema = 30 and `PRAGMA integrity_check` passes on a post-boot copy;
  - `multiplex_standalone_reason` and no `data/profiles`;
  - listeners: only `127.0.0.1:8642` is new;
  - `/opt/data/.env` is 0600 and holds only `API_SERVER_KEY`;
  - the gateway log has no `UnscopedSecretError` or `compat` lines;
  - `hermes skills list` shows the disabled set, and `hermes curator status` shows no tenant skill archived;
  - `/api/plugins/mobile/…` returns authenticated JSON, not a 404 (#67069);
  - **refresh after more than 15 min in the background, then a 2-device burst.** That last check is the live test of the M7 fix.
- **Correction:** make §9.2 normative, either by reproducing the assessment's step and acceptance lists or by stating "execute the assessment's list verbatim". Add the curator choice to §1.

### M10. §4.2 / §6.1: approval semantics need restating at N:
- **Evidence:**
  - At N: the result is `{choice, all?}` (N:`contracts/server_requests.py:89-91`), resolved **per `request_id`** (N:`server.py:789-792`). The FIFO "only the oldest is actionable" rule is now a UI choice, not a protocol constraint.
  - A response frame gets **no ack**. The old `approval.respond` returned `{resolved:int}`, which the current card reads (`chat/[id].tsx:304-310`).
  - A response for an id that is already settled is dropped silently (N:`server_requests.py:208-213`).
  - `session.resume` at N: returns **both** `pending_approval` and the same approval in `open_requests`.
- **Correction:**
  - The card marks itself answered optimistically on `respond()`, and relies on `request.cancel` arriving earlier for a withdrawn request.
  - Ignore `pending_approval` when `open_requests` is present.
  - `approval.received` is a no-op: `acknowledged` is set but never read (N:`tools/approval.py:209-215`; no reader in `approval_gateway_wait.py`). No need to call it. **Verified.**

### M11. §12 risk table: "existing reconnect tests must stay green unchanged" is an empty mitigation
- **Evidence:**
  - `__tests__/reconnect.test.ts` covers only the pure `shouldReconnect` and `backoffMs` (6 tests).
  - PR #22's actual hardening (single-flight, teardown order, handler detach before close) lives in `chat/[id].tsx:334-470` with no tests.
  - `__tests__/gatewayClient.test.ts` (9 tests) drives an `onopen` / `onmessage` fake. The vendored client uses `addEventListener` (`json-rpc-gateway.ts:208-305`), so those tests **must** be rewritten, and the spec does not say so.
- **Correction:**
  - Move the reconnect orchestration (establish, resume, replay barrier, history) into a pure, injected module next to `turn-controller.ts`, with tests for single-flight and ordering.
  - List the `gatewayClient.test.ts` rewrite, which needs an event-target fake socket, as part of App A.

---

## MINOR

1. **§4.1 Origin header:**
   - **Claim:** "The app's socket factory sets an `Origin` header … must keep doing that."
   - **Evidence:** `openGateway()` calls `makeNativeSocket(url)` **without** `extraHeaders` (`connection.ts` last function), so no Origin header is set today. `socketFactory` receives only `url` (`json-rpc-gateway.ts:35`); the headers would be a closure.
   - **Correction:** "keep today's socket factory (no explicit Origin)".
2. **§4.1 LICENSE path:** there is no `LICENSE` in `apps/shared/`. The MIT file is the repo root `LICENSE`. The sync script must fetch `"${TAG}:LICENSE"`.
3. **§4.1 hash scope:** say whether `VENDORED.json` stores the upstream blob hash or the post-rewrite hash. The drift guard can only recompute the post-rewrite hash. Storing both allows a check against upstream.
4. **§4.1 runtime compatibility** is fine, but credit the right source.
   - Hermes itself has `TextEncoder` but **no `TextDecoder`**; I checked the `hermesvm` strings.
   - `json-rpc-channel.ts` calls `new TextDecoder()` at module top.
   - It works because Expo's winter runtime installs `TextDecoder`, WHATWG `URL` and `DOMException` (`node_modules/expo/src/winter/runtime.native.ts:11,17,21`).
   - Record this dependency so a future "remove expo winter" change doesn't break the transport.
   - RN 0.85's `WebSocket` has `static OPEN` and `EventTarget` with `once` (`react-native/Libraries/WebSocket/WebSocket.js:76-80`).
5. **§4.2 types:** `approval.request` and the O: payload are **not** in the N: generated contract. The legacy handler needs a narrowly scoped app-owned type, or `onAny` plus a string match. State this as the one allowed exception to "types only from the generated file".
6. **§4.2 errors:** the vendored client rejects with `JsonRpcGatewayError` (optional `code`), not the app's `RpcError`. `switchSessionModel` branches on `RpcError` and `SESSION_BUSY_CODE` (`src/api/sessionModel.ts`), so the adapter must map one to the other.
7. **§4.2 heartbeat:** at N:, `gateway.ready.heartbeat` starts a 15 s `gateway.ping` with a 45 s deadline (`json-rpc-gateway.ts:415-417`). After iOS suspension, the first tick fires `invalidate()` at the same moment as the AppState foreground reconnect. Specify that `onState('closed')` → `dropAndReconnect` shares the single-flight guard, and add a test for it.
8. **§4.2 default timeout:** the vendored default `requestTimeoutMs` is 120 s for every call. Today there is none. Check `session.resume` on a cold 178 MB store.
9. **§5.1 composer table:** idle with empty input and a staged photo is "send enabled" today (`composer.tsx:42`). The table says "send (disabled)".
10. **§5.2 / §5.3 stale id:** apply the `4001` → resume + retry once rule to steer and `config.set` as well. At N:, `config.set` with a stale sid now returns 4001 (api-delta §3.1).
11. **§6.2 clarify:**
    - Per-question **skip** inside a batch is undefined. Lock `""`: `_batch_result` renders a falsy answer as `""`, which is a skip (N:`tools/clarify_tool.py` `_batch_result`).
    - `clarify.lock.answer` is `JsonValue`, and non-strings are JSON-encoded server-side (N:`methods_prompt.py:1147-1148`), so multi-select can send a real array.
    - Wire `choices` already carry the "(Recommended)" suffix (`mark_recommended`), and `_clean_answer` strips it from the answer either way.
12. **§6.3 vault note:**
    - An instant `-32601` makes the request **resolve as unanswered** for everyone, first response wins (N:`server_requests.py:217-220`). The phone therefore preempts an attached desktop, and "finish it on your desktop" is false once the phone has answered.
    - **Correction:** either reword the note to "declined on the phone", or accept vault requests without responding so the desktop can answer. The cost is the agent waiting 120–180 s when no desktop is attached.
13. **§6 push:** the plugin pushes only for `pre_approval_request` and session end (`plugin.py:57-58`). There is no push for clarify, secret or sudo, so a clarify raised while the phone sleeps is invisible until he opens the chat. Note this as a gap, or add a plugin hook if one exists.
14. **§6.4 `textContentType="password"`:** may make iOS offer to save the value to Passwords when the field unmounts. For an API-key secret, `"none"` or `oneTimeCode`-style handling avoids a keychain copy. Decide deliberately.
15. **§6.4 native config:** set `NSFaceIDUsageDescription` through the `expo-local-authentication` config plugin (`faceIDPermission`) in `app.json` `plugins`, not a raw `infoPlist` edit. This keeps it consistent with the other permission strings.
16. **§6 / §7 replayed events:** replayed events carry `replayed: true`. Suppress haptics and "Stopped" or "Success" side effects for replayed `message.complete`.
17. **§8.1 row count:** the sheet is 1 tile row plus 5 list rows, not "seven rows".
    - The diagnosis is plausible: `settings.tsx` (same RNS 4.25.2 formSheet) has `ScrollView` as its **root** and renders fine, while `attach.tsx` nests the `ScrollView` under a header `View` inside `flex:1`.
    - With `fitToContents` and no `ScrollView`, the largest Dynamic Type can clip. Keep the "verify" step, or fall back to making the `ScrollView` the root with the header inside it.
18. **§9.2 compression:** `compression.threshold_tokens: null` is the right key and value.
    - Explicit null stays None and means ratio-only (N:`agent/agent_init.py:1490-1494`).
    - `_deep_merge` keeps a None leaf (N:`hermes_cli/config.py:1508-1523`).
    - `save_config` keeps non-default explicit paths through the migration rewrite.
    - Live `threshold: 0.75` plus the 1M window gives about 750K.
    - Add an acceptance check on the **effective** value, for example the agent's "compress at 75% = 750,000" init line or `hermes config`, not only the YAML diff.
19. **§9.2 rollback:** restoring `state.db` loses any conversations made after the bump. Say so. Explicitly **do not** restore `mobile/`: rolled-back RT hashes bounce every phone to re-pair (`rotate_refresh` → `UnknownRefreshTokenError`).
20. **§10.2 local Docker:** running the image locally conflicts with his standing "heavy Docker → dc1-1" preference. It is already flagged as an assumption. Note that the digest has a linux/arm64 manifest (`sha256:93b4e287…`), so the Mac runs it without emulation. The alternative is a throwaway container on dc1-1.
21. **Orphan-reap timing:** at N:, a disconnected WS session is interrupted only after its activity clock has been idle for `ws_orphan_activity_stale_s` = 600 s (N:`tui_gateway/server.py:127-137`). That equals dc1-1's `clarify_timeout: 600`. A clarify left pending over a longer sleep is gone on wake by design. Say so in the QA script so "survive sleep" is tested within 10 min.

---

## Verified (important claims that hold)

- **Vendored files:** 576 / 706 / 58 / 5,657 lines.
  - Only relative imports: `./gateway-events.js`, `./json-rpc-channel.js`, `./gateway-contract.generated.js`.
  - The generated file has no imports.
  - With the `.js` specifiers stripped, all four typecheck (exit 0) under the app's `expo/tsconfig.base` (DOM lib, bundler resolution).
- **Channel behaviour:**
  - sends `client.capabilities {server_requests:true}` on `gateway.ready`;
  - auto-answers `-32601` and `-32603`;
  - re-delivers `open_requests` from any result with `replayed:true`;
  - `respond` is idempotent per delivery and goes out on the **current** transport.
- **0.21.5 withdraws approvals for a non-advertising client:** the agent is told "update the Hermes app" (N:`server.py:779-788`). Clarify returns `""` immediately (N:`server_requests.py:152-153`).
- **The app drops `srq-…` frames today:** `handleFrame` looks the string id up in `pending` and returns.
- **Clarify contract** (N:`contracts/server_requests.py:32-59`; N:`contracts/prompt_voice.py:251-272`; N:`methods_prompt.py:1141-1159`):
  - single `{answer}` with `""` = skip;
  - batch `{answers}`, and a response with neither is cancel-all;
  - `clarify.lock {request_id, question_id, answer}` → `{status: ok|expired, remaining}`;
  - the last lock resolves the request, and a later response frame is dropped harmlessly;
  - a lock on a single-question request returns `expired` (`qids is None`);
  - batch ids are `q0..q4`.
- **Sudo / secret:**
  - `ValueResult {value}`, and empty means skipped (N:`server.py:1318-1324`; `agent_callbacks.py:202-206`);
  - secret `_ask` timeout is 300 s, sudo 120 s;
  - `metadata.skill_name` is populated (N:`skills_tool_setup.py:108`);
  - secret capture is reachable on dashboard-WS sessions, because `HERMES_INTERACTIVE=1` is set by `session.create` / `resume`;
  - the value is saved via `save_env_value_secure` to `$HERMES_HOME/.env`.
- **`/api/skills`:** returns `provenance ∈ hub|bundled|agent`, excludes disabled skills and includes just-created ones.
- **`session.interrupt`:**
  - `{status:"interrupted"}` even when idle, at both tags;
  - at N:, `request.cancel reason:"interrupted"` per open request;
  - `message.complete status:"interrupted"` is emitted at **both** tags (O:`server.py:11003-11013`), so "Stopped" works on 0.20.4.
- **`message.complete.status`:** `complete|error|interrupted` (N:`events.py:137-142,183-204`). At both tags a turn exception emits `message.complete status:"error"`. The app today ends turns on `error` (`chat/[id].tsx:394-400`).
- **`session.events.since {session_id, last_seen}`** returns `{events, latest_seq, truncated, count, epoch, open_requests}`, with no ownership check. The vendored client calls it automatically on reconnect when it has watermarks.
- **Plugin:**
  - method names `rotate_refresh`, `revoke`, `revoke_by_refresh`, `set_push_token`, `create_device`;
  - tmp file `.devices.json.<pid>.tmp` (`device_store.py:331`);
  - `pre_approval_request` is fired with `coalesced=True` for followers (N:`tools/approval_gateway_wait.py:110`);
  - the plugin handler takes `**_`, so it pushes duplicates today.
- **Search:** snippets use `>>>…<<<` at both tags; the app parses `<b>`.
- **Live config (read-only):** `clarify_timeout: 600`, `compression.threshold: 0.75`, `busy_input_mode: interrupt`.
- **Image and PR state:** the target digest's index includes amd64 and arm64. PR #29 is OPEN and MERGEABLE.
