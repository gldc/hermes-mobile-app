# Per-Chat Model: Accurate Pill + In-Chat Switching — Design

**Status:** approved (2026-06-20). Ships in two stages: Feature 2 (accurate pill) first, then Feature 1 (per-chat switch).

## Problem

The composer model pill is fed from `GET /api/model/info` — the **gateway default** model — fetched once at chat-screen mount (`chat/[id].tsx:454`). The picker's `POST /api/model/set` changes that default and **applies to new chats only** (`docs/contracts/models.md`; a running chat keeps the model it was created with). Result:

1. After changing the model, the pill on the current (running) chat doesn't reflect the choice — confusing.
2. Latent inaccuracy: open an *older* chat after changing the default and its pill shows the new default, not that chat's actual model.
3. There is no in-app way to change the model **of the chat you're in**.

## Research (gateway mechanics)

- **Read a session's model:** `session.create` and `session.resume` responses already include `info.model` (and `info.provider`). Live changes are pushed via the **`session.info`** gateway event (`tui_gateway/server.py:2286`, `_session_info`). No new endpoint needed. Caveat: a brand-new **lazy** session reports the gateway default until its first prompt builds the agent — which is correct (a new chat *will* use the default).
- **Switch a running session's model:** there is **no dedicated RPC**. The mechanism is the `/model` slash command run via the gateway method **`slash.exec`** `{session_id, command}`. Syntax: `/model <name> [--provider <slug>] [--session|--global]` (no colon `provider:model` form; use `--provider`). On success it stores a per-session `model_override`, appends a system history marker, and emits `session.info`. Constraints: **blocked while a turn is streaming** (`_MUTATES_WHILE_RUNNING`), **expensive models gate** (`confirm_required` → resubmit), and failures surface as `output: "✗ …"`.

## Feature 2 — Accurate pill (bug fix, ship first)

The pill should show **this chat's** model, not the gateway default.

- Capture `info.model` from the `session.create` and `session.resume` responses → the session's model.
- Handle the `session.info` event → update the pill live when the model changes (covers Feature 1 and any external `/model`).
- Fall back to `getModelInfo` (gateway default) **only** when no session model is known yet (lazy new chat before first prompt).
- Precedence is pure logic extracted into `src/lib/model-pill.ts` (mirrors `subagent-progress.ts`): session model wins once known, else the fallback default; both run through `modelDisplayName`.

This fixes (1) the staleness and (2) the old-chat inaccuracy.

## Feature 1 — In-chat switch (feature, ship second)

- The composer pill opens the picker in **"this chat" mode** (route param + the chat's live `session_id` handed over via a small store, since the picker doesn't own the chat's WebSocket).
- Selection runs on the **chat's** gateway connection: `slash.exec` `/model <model> --provider <slug> --session` (session-only — the global default is untouched; the **Settings** picker keeps doing "default for new chats").
- Handle the three gateway realities: **streaming-block** (disable the switch while a turn is in flight, with a hint), **expensive-model confirm** (reuse the existing picker confirm flow), and **errors** (surface the gateway's `✗ …` text).
- The pill updates from the resulting `session.info` (Feature 2 already wires this).

### Decisions

- From-chat switch is **session-only** (`--session`), not a default change. Settings stays default-for-new-chats.
- **Block switching while streaming** (don't auto-interrupt) — matches the gateway constraint, least surprising.
- Reuse the existing expensive-model confirm.

### Verification points (TDD + on-device)

- Exact `/model` argument format from the picker's `{provider slug, model id}` (likely `/model <id-without-prefix> --provider <slug> --session`).
- `slash.exec` reachable over the mobile WS, and the success/`confirm_required`/error response shape.

## Testing

Pure logic (pill precedence in Feature 2; the `/model` command builder and confirm/err state machine in Feature 1) lives in `src/lib/` with unit tests. Screen wiring is glue, verified on-device.
