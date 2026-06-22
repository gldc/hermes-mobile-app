# Per-Chat Model: Accurate Pill + In-Chat Switching — Design

**Status:** approved (2026-06-20). Feature 2 (accurate pill) shipped (PR #19). Feature 1 (per-chat switch) revised 2026-06-22 to ride the existing **`config.set`** RPC instead of `slash.exec` `/model` — verified to need no `hermes-agent`/plugin change.

## Problem

The composer model pill is fed from `GET /api/model/info` — the **gateway default** model — fetched once at chat-screen mount (`chat/[id].tsx:454`). The picker's `POST /api/model/set` changes that default and **applies to new chats only** (`docs/contracts/models.md`; a running chat keeps the model it was created with). Result:

1. After changing the model, the pill on the current (running) chat doesn't reflect the choice — confusing.
2. Latent inaccuracy: open an *older* chat after changing the default and its pill shows the new default, not that chat's actual model.
3. There is no in-app way to change the model **of the chat you're in**.

## Research (gateway mechanics)

- **Read a session's model:** `session.create` and `session.resume` responses already include `info.model` (and `info.provider`). Live changes are pushed via the **`session.info`** gateway event (`tui_gateway/server.py:2286`, `_session_info`). No new endpoint needed. Caveat: a brand-new **lazy** session reports the gateway default until its first prompt builds the agent — which is correct (a new chat *will* use the default).
- **Switch a running session's model:** the gateway already ships a first-class WS RPC — **`config.set`** `{session_id, key:"model", value, confirm_expensive_model}` (`tui_gateway/server.py:7689`). `value` is a `/model` arg string (`<model> --provider <slug> --session`; `--session` is a real flag and the default scope is session). It switches the **live agent**, emits **`session.info`**, and returns `{value, warning, confirm_required, confirm_message}`. Constraints surface cleanly: a turn in flight returns **RPC error 4009** ("session busy …"), and an **expensive model** returns `confirm_required:true` + `confirm_message` (re-call with `confirm_expensive_model:true`). **No core or plugin change is required** — this RPC is reachable over the mobile WS today, and the app already implements the identical `confirm_required → re-submit` contract for the *global* switch (`POST /api/model/set`, `models.ts:79-113`). (The earlier `slash.exec` `/model` mechanism is superseded: `config.set` is a typed RPC whose confirm is a wire parameter and whose running-guard is a real error, eliminating the `slash.exec` warning-vs-switch ambiguity.)

## Feature 2 — Accurate pill (bug fix, ship first)

The pill should show **this chat's** model, not the gateway default.

- Capture `info.model` from the `session.create` and `session.resume` responses → the session's model.
- Handle the `session.info` event → update the pill live when the model changes (covers Feature 1 and any external `/model`).
- Fall back to `getModelInfo` (gateway default) **only** when no session model is known yet (lazy new chat before first prompt).
- Precedence is pure logic extracted into `src/lib/model-pill.ts` (mirrors `subagent-progress.ts`): session model wins once known, else the fallback default; both run through `modelDisplayName`.

This fixes (1) the staleness and (2) the old-chat inaccuracy.

## Feature 1 — In-chat switch (feature, ship second)

- The composer pill opens the picker in **"this chat" mode** (`router.push('/models?scope=session')`). The chat's live socket + current model + streaming flag are handed to the `/models` route via a tiny `useSyncExternalStore` singleton (`src/session-model-store.ts`, mirroring `profile-store`), since the picker doesn't own the chat's WebSocket.
- Selection runs on the **chat's** gateway connection via the pure `src/api/sessionModel.ts` module: `config.set` `{session_id, key:'model', value:'<model> --provider <slug> --session', confirm_expensive_model}` → a discriminated `SwitchOutcome` (`ok | confirm | busy | error`). Session-only — the global default is untouched; the **Settings / sidebar / attach** entrances to `/models` keep doing "default for new chats" (the no-`scope` path is unchanged).
- Handle the three gateway realities: **streaming-block** (disable the switch while a turn is in flight, with a hint; and map RPC 4009 → `busy`), **expensive-model confirm** (reuse the existing picker confirm Alert → re-call with `confirm_expensive_model:true`), and **errors** (surface the gateway error message).
- The pill updates from the resulting `session.info` (Feature 2 already wires this) — no optimistic pill mutation needed.

### Decisions

- From-chat switch is **session-only**, not a default change. The Settings/sidebar/attach picker stays default-for-new-chats; only the composer pill is session-scoped.
- **Block switching while streaming** (don't auto-interrupt) — matches the gateway constraint, least surprising.
- Reuse the existing expensive-model confirm.
- **No `hermes-agent` or `hermes-mobile-plugin` change** — the switch rides the existing `config.set` RPC. (Verified: `server.py:7689`, reachable over the mobile WS with no allowlist.)
- A brand-new chat with no live session yet (`id='new'`, pre-first-prompt) has nothing to switch, so a session-mode pick on it falls back to the **global** default — coherent, since a new chat *will* use the default.
- `config.set` rejections expose their JSON-RPC `code` via a new `RpcError` (so 4009 is matched on code, not brittle message text).

### Verification points (TDD + on-device)

- Exact `value` arg format from the picker's `{provider slug, model id}` (`<id> --provider <slug> --session`), against the gateway's `parse_model_flags` (now a 5-tuple with a real `--session`).
- On-device: a normal session-scoped switch emits one `session.info` and moves the pill; switching mid-stream returns `busy`; an expensive model prompts confirm then switches on re-submit.

## Testing

Pure logic (pill precedence in Feature 2; the `/model` command builder and confirm/err state machine in Feature 1) lives in `src/lib/` with unit tests. Screen wiring is glue, verified on-device.
