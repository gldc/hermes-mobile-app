# Under-Discovered Features for Mobile App

> **SUPERSEDED 2026-08-26** by `2026-08-26-api-coverage-audit.md`. Kept for provenance.
> This was written against a pre-0.20.4 tree: its line-number evidence no longer
> resolves, and its #1 recommendation (approvals from mobile) has since shipped.

Research conducted 2026-06-16 against hermes-agent codebase.
Features are ranked by mobile-impact × implementation-feasibility.

---

## TIER 1: HIGH IMPACT, EXISTING API — Quick Wins

### 1. Usage & Cost Analytics Dashboard
**Status: Fully backed by REST, zero mobile coverage**

- `GET /api/analytics/usage?days=7|30|90&profile=<name>`
  - Evidence: `web_server.py:9799-9864`
  - Returns: `daily[]` (per-day token/cost breakdown), `by_model[]` (per-model usage), `totals` (aggregate), `skills` (top skills used, skill loads/edits)
  - Includes: `input_tokens`, `output_tokens`, `cache_read_tokens`, `reasoning_tokens`, `estimated_cost_usd`, `actual_cost_usd`, `api_calls`

- `GET /api/analytics/models?days=30&profile=<name>`
  - Evidence: `web_server.py:9867-9950+`
  - Returns: per-model breakdown with `billing_provider`, `tool_calls`, `avg_tokens_per_session`, `last_used_at`, plus capability metadata from models.dev

- **Mobile use case:** "Spending at a glance" — a unique mobile-first feature. Users check their AI spend on the go. Daily bar charts, cost trends, model usage pie charts. No other AI client shows this on mobile.
- **Effort:** ~3-4 days (2 screens: summary + detail; uses existing REST, just needs charts)

---

### 2. System Status & Remote Administration
**Status: Fully backed by REST, zero mobile coverage**

- `GET /api/status` — Evidence: `web_server.py:1564-1694`
  - Returns: `version`, `gateway_running`, `gateway_state`, `gateway_platforms` (Telegram/Discord/etc status), `active_sessions`, `auth_required`, `auth_providers`, `can_update_hermes`
  - Loopback-only extras: `hermes_home`, `config_path`, `gateway_pid`

- `GET /api/logs?file=agent|gateway|...&lines=100&level=&component=&search=`
  - Evidence: `web_server.py:6757-6807`
  - Available log files defined in `hermes_cli/logs.py`
  - Supports level filtering, component filtering, and free-text search

- `POST /api/gateway/restart` — Evidence: `web_server.py:2167-2179`
- `POST /api/gateway/start` — Evidence: `web_server.py:7725-7732`
- `POST /api/gateway/stop` — Evidence: `web_server.py:7735-7741`
- `POST /api/hermes/update` — Evidence: `web_server.py:2182-2204`

- `GET /api/actions/{name}/status?lines=200` — Evidence: `web_server.py:2564-2598`
  - Tail action logs for: `gateway-restart`, `gateway-start`, `gateway-stop`, `hermes-update`, `doctor`, `security-audit`, `backup`, `import`, `skills-install`, `skills-uninstall`, `skills-update`, etc.

- **Mobile use case:** "Server health at a glance" — check if your gateway is running, restart it remotely, view logs, trigger updates. Huge for self-hosters on the go.
- **Effort:** ~2-3 days (status card + log viewer + restart button)

---

### 3. Session Branching (via WebSocket JSON-RPC)
**Status: Fully working, zero mobile coverage, desktop-only today**

- RPC: `session.branch`
  - Evidence: `tui_gateway/server.py:5116-5184`
  - Params: `{session_id, name?}` — creates a full copy of current conversation history as a new session with auto-generated title lineage
  - Returns: `{session_id: <new_id>, title: <auto>, parent: <old_key>}`
  - New session has its own agent, own slot

- **Mobile use case:** "Fork this conversation" — swipe action or context menu on a chat to create an alternate timeline. Unique differentiator: no other AI mobile client offers branching.
- **Effort:** ~1-2 days (add to chat context menu, call RPC, navigate to new session)

---

### 4. Session Undo / Rollback (via WebSocket JSON-RPC)
**Status: Fully working, zero mobile coverage**

- RPC: `session.undo`
  - Evidence: `tui_gateway/server.py:4925-4950`
  - Params: `{session_id}` — removes the last user+assistant+tool turn from history
  - Returns: `{removed: <count>}`
  - Guards: rejects if session is busy (must interrupt first)

- **Mobile use case:** "Oops, undo last response" — swipe-to-delete or button to remove last exchange. Simple and high-value.
- **Effort:** ~0.5 day (button + RPC call)

---

### 5. Manual Session Compression (via WebSocket JSON-RPC)
**Status: Fully working, zero mobile coverage**

- RPC: `session.compress`
  - Evidence: `tui_gateway/server.py:4953-5060+`
  - Params: `{session_id, focus_topic?}` — compresses conversation history with optional focus
  - Returns token counts before/after, messages removed
  - Emits `status.update` with kind `"compressing"` during operation

- **Mobile use case:** "Compact this chat" — when a conversation gets too long and expensive, compress it. Users can specify a focus topic. Shows before/after token savings.
- **Effort:** ~1 day (button + RPC call + progress indicator)

---

### 6. Session Export
**Status: REST endpoint exists, zero mobile coverage**

- `GET /api/sessions/{session_id}/export?profile=<name>`
  - Evidence: `web_server.py:6711-6724`
  - Returns full metadata + messages as JSON

- Desktop implementation: `apps/desktop/src/lib/session-export.ts` — downloads JSON with `exported_at`, `session_id`, `title`, `messages`

- **Mobile use case:** "Share/Export" in chat context menu → share sheet with JSON/Markdown. Use iOS share sheet to AirDrop, email, or save to Files.
- **Effort:** ~1 day (fetch export endpoint + share sheet integration)

---

### 7. Session Interrupt (Stop Generating)
**Status: Mobile likely already has this partially, but verifying**

- RPC: `session.interrupt`
  - Evidence: `tui_gateway/server.py:5187-5200+`
  - Params: `{session_id}` — interrupts the running agent turn
  - Force-denies pending approvals on interrupt

- **Mobile use case:** "Stop" button during streaming. Critical UX.
- **Effort:** Minimal if not already implemented

---

## TIER 2: HIGH IMPACT, NEEDS MINOR WORK

### 8. Cron Job Suggestions (Accept/Dismiss Automations)
**Status: Python module exists with full CRUD, NO REST API yet**

- Module: `cron/suggestions.py` (257 lines)
- Catalog: `cron/suggestion_catalog.py` — curated starter automations:
  - "Daily briefing" (8am calendar + weather + urgent items)
  - "Important-mail monitor" (every 30m, urgency-scored inbox check)
  - "Weekly review" (Sunday evening recap)

- Functions: `list_pending()`, `accept_suggestion(ref)`, `dismiss_suggestion(ref)`, `add_suggestion(...)`, `clear_resolved()`
- Storage: `~/.hermes/cron/suggestions.json`
- Sources: `catalog`, `blueprint`, `usage`, `integration`
- Max 5 pending suggestions, dedup-key latching

- **Missing: REST API endpoints** — need to add:
  - `GET /api/cron/suggestions` — list pending
  - `POST /api/cron/suggestions/{id}/accept` — create job from suggestion
  - `POST /api/cron/suggestions/{id}/dismiss` — dismiss + latch

- **Mobile use case:** "One-tap automation setup" — onboarding-style cards that say "Want a daily briefing?" with Accept/Dismiss. Huge for making cron accessible to non-technical users.
- **Effort:** ~2 days server-side (add REST endpoints) + ~2 days mobile (card UI)

---

### 9. Plugin Management via WebSocket
**Status: Working RPC, no mobile surface**

- RPC: `plugins.manage`
  - Evidence: `tui_gateway/server.py:10207-10283`
  - Actions:
    - `list` → `{plugins: [{name, version, description, source, status}], user_count, bundled_count}`
    - `toggle` → `{name, enable: bool}` → `{ok, unchanged, name, plugin}`

- **Mobile use case:** "Manage plugins" screen — see what's installed, toggle plugins on/off from your phone.
- **Effort:** ~1-2 days (list + toggle UI over existing WebSocket)

---

### 10. Diagnostics & Maintenance Actions
**Status: Fully backed by REST, zero mobile coverage**

- `POST /api/ops/doctor` → `{ok, pid, name: "doctor"}` — Evidence: `web_server.py:7977-7984`
- `POST /api/ops/security-audit` → `{ok, pid, name: "security-audit"}` — Evidence: `web_server.py:7987-7997`
- `POST /api/ops/backup` body `{output?, force?}` → `{ok, pid, name: "backup"}` — Evidence: `web_server.py:8002-8019`
- `POST /api/ops/prompt-size` — Evidence: `web_server.py:1943-1949`
- `POST /api/ops/dump` — Evidence: `web_server.py:1952-1958`
- `POST /api/ops/config-migrate` — Evidence: `web_server.py:1961-1968`
- `POST /api/ops/debug-share` — Evidence: `web_server.py:1979-2000`

All tailed via `GET /api/actions/{name}/status`.

- **Mobile use case:** "Health check" button in settings → run doctor, security audit, or backup from your phone.
- **Effort:** ~1 day (button triggers + action status polling)

---

### 11. Config Editor (Full Config Access)
**Status: Fully backed by REST, zero mobile coverage**

- `GET /api/config?profile=<name>` — normalized config — Evidence: `web_server.py:2993-2998`
- `PUT /api/config` body `{config: {...}}` — Evidence: `web_server.py:3559-3569`
- `GET /api/config/raw?profile=` — raw YAML text — Evidence: `web_server.py:9765-9778`
- `PUT /api/config/raw` body `{yaml_text, profile?}` — Evidence: `web_server.py:9781-9791`
- `GET /api/config/schema` — field definitions + category order — Evidence: `web_server.py:3006-3008`
- `GET /api/config/defaults` — default config — Evidence: `web_server.py:3001-3003`
- `GET /api/env?profile=` — env vars — Evidence: `web_server.py:3572`

- **Mobile use case:** "Settings editor" — browse and edit config.yaml sections from mobile. Useful for quick tweaks without SSH.
- **Effort:** ~3 days (settings form with schema-driven rendering)

---

### 12. Session Stats & Store Analytics
**Status: REST exists, not in mobile contracts**

- `GET /api/sessions/stats?profile=<name>`
  - Evidence: `web_server.py:6567-6595`
  - Returns: `{total, active_store, archived, messages, by_source}` — `by_source` is `{cli: 12, gateway: 5, cron: 3, ...}`

- **Mobile use case:** Stats badge in settings showing total conversations, messages, breakdown by source.
- **Effort:** ~0.5 day

---

### 13. Messaging Platform Management
**Status: Full REST API exists, zero mobile coverage**

- `GET /api/messaging/platforms?profile=<name>` — Evidence: `web_server.py:4788+`
  - Returns catalog of all messaging platforms (Telegram, Discord, Slack, WhatsApp, etc.) with connection status, required env vars, whether configured

- Telegram onboarding flow:
  - `POST /api/messaging/telegram/onboarding/start` — Evidence: `web_server.py:4576`
  - `GET /api/messaging/telegram/onboarding/{pairing_id}` — Evidence: `web_server.py:4614`
  - `POST /api/messaging/telegram/onboarding/{pairing_id}/apply` — Evidence: `web_server.py:4716`
  - `DELETE /api/messaging/telegram/onboarding/{pairing_id}` — Evidence: `web_server.py:4781`

- **Mobile use case:** "Channels" screen showing which messaging platforms are connected, their status, quick setup wizard for Telegram.
- **Effort:** ~2-3 days

---

## TIER 3: UNIQUE DIFFERENTIATORS (Moderate Effort)

### 14. WebSocket Events Beyond Chat
**Status: Rich event system exists, mobile only handles basic chat events**

The gateway emits these event types (from `_emit` calls):

| Event | Mobile handles? | Mobile opportunity |
|---|---|---|
| `message.delta` | ✅ Yes | — |
| `message.complete` | ✅ Yes | — |
| `message.start` | ✅ Yes | — |
| `tool.start` | ✅ Yes | — |
| `tool.complete` | ✅ Yes | — |
| `tool.generating` | ❌ No | Show "thinking about tool..." spinner |
| `status.update` | ✅ Partial | Expand: `kind` = `thinking`/`tools`/`compressing`/`process` — show in header |
| `session.info` | ❌ No | Model changes, toolset changes mid-session |
| `approval.request` | ❌ No | **HIGH VALUE** — approve/deny dangerous commands from phone |
| `clarify.request` | ❌ No | **HIGH VALUE** — answer agent questions from phone |
| `sudo.request` | ❌ No | Approve sudo from phone |
| `secret.request` | ❌ No | Provide secrets from phone |
| `terminal.read.request` | ❌ No | Read terminal output from phone |
| `reasoning.delta` | ❌ No | Show thinking/reasoning stream |
| `reasoning.available` | ❌ No | Indicate model supports reasoning |
| `thinking.delta` | ❌ No | Show extended thinking |
| `error` | ✅ Yes | — |
| `browser.progress` | ❌ No | Show browser automation progress |
| `skin.changed` | ❌ No | Theme sync |
| `preview.restart.progress` | ❌ No | Code preview rebuild progress |
| `preview.restart.complete` | ❌ No | Code preview rebuild done |
| `voice.transcript` | ❌ No | Voice input transcript |
| `voice.status` | ❌ No | Voice mode state |

**The big ones:**
- **Approvals from mobile** — approve dangerous commands while away from desk. This is the killer feature.
- **Clarify from mobile** — answer agent questions while away.
- **Reasoning/thinking display** — show the model's thinking process.

- **Effort:** ~3-4 days for approvals+clarify (the highest-value interactive events)

---

### 15. Skills Hub — Browse, Install, Uninstall from Mobile
**Status: Full REST API exists, zero mobile coverage**

- `GET /api/skills/hub/sources?profile=` — available skill sources
- `GET /api/skills/hub/search?q=&source=all&limit=20` — search skills
- `POST /api/skills/hub/install` body `{identifier, profile?}` — install
- `POST /api/skills/hub/uninstall` body `{name, profile?}` — uninstall
- `POST /api/skills/hub/update` body `{profile?}` — update all
- `GET /api/skills/hub/preview?identifier=` — preview skill content before install
- `GET /api/skills/hub/scan?identifier=` — security scan

Evidence: `web_server.py:7396-7771`

- **Mobile use case:** "Skills marketplace" — browse and install new capabilities from your phone. Think App Store for AI agent skills.
- **Effort:** ~3 days (search UI + install/uninstall + preview)

---

### 16. Curator (Auto Skill Management)
**Status: REST exists, zero mobile coverage**

- `GET /api/curator` — `{enabled, paused, interval_hours, last_run_at, min_idle_hours, stale_after_days, archive_after_days}`
  - Evidence: `web_server.py:1404-1422`
- `PUT /api/curator/paused` body `{paused: bool}` — Evidence: `web_server.py:1429-1434`
- `POST /api/curator/run` — trigger manual curator review — Evidence: `web_server.py:1437-1444`

- **Mobile use case:** Toggle auto-curation on/off, trigger a review run.
- **Effort:** ~0.5 day

---

### 17. Profile Management (Beyond Switching)
**Status: Full REST API exists, mobile only does switching**

Already in contracts but these are under-utilized:
- `POST /api/profiles` — create new profile — Evidence: `web_server.py:8054-8158`
- `PATCH /api/profiles/{name}` — rename — Evidence: `web_server.py:8261-8273`
- `DELETE /api/profiles/{name}` — delete — Evidence: `web_server.py:8276-8291`
- `GET /api/profiles/{name}/soul` / `PUT` — read/edit system prompt — Evidence: `web_server.py:8294-8313`
- `PUT /api/profiles/{name}/description` — set description — Evidence: `web_server.py:8316-8336`
- `POST /api/profiles/{name}/describe-auto` — auto-generate description — Evidence: `web_server.py:8359-8383`

- **Mobile use case:** Full profile management — create, edit soul (system prompt), auto-describe.
- **Effort:** ~2 days

---

### 18. Auxiliary Model Slots
**Status: REST exists, not in mobile contracts**

- `GET /api/model/auxiliary`
  - Evidence: `web_server.py:2730-2771`
  - Returns: per-task model assignments for `vision`, `web_extract`, `compression`, `skills_hub`, `approval`, `mcp`, `title_generation`, `triage_specifier`, `kanban_decomposer`, `profile_describer`, `curator`

- `POST /api/model/set` with `scope: "auxiliary"` — set per-task models

- **Mobile use case:** Advanced model settings — choose which model handles vision, compression, etc.
- **Effort:** ~1 day

---

## TIER 4: POLISH & DELIGHT

### 19. Session Pruning & Bulk Operations
- `POST /api/sessions/bulk-delete` body `{ids: [...]}` — Evidence: `web_server.py:5748-5800`
- `GET /api/sessions/empty/count` → `{count}` — Evidence: `web_server.py:5803-5816`
- `DELETE /api/sessions/empty` — Evidence: `web_server.py:5819-5845`
- `POST /api/sessions/prune` body `{older_than_days, source?}` — Evidence: `web_server.py:6012-6034`
- **Mobile use case:** "Clean up" — bulk-select and delete, prune old sessions, clear empty sessions.
- **Effort:** ~1 day

### 20. Memory File Read/Write (Self-hosted)
- `GET /api/files/read?path=~/.hermes/memories/MEMORY.md` — read memory file
- `POST /api/files/upload` body `{path, data_url, overwrite: true}` — write
- Evidence: `web_server.py:1091-1146`
- **Mobile use case:** Edit your agent's memory/persona from your phone.
- **Effort:** ~1 day (markdown editor + file read/write)

### 21. Cron Delivery Targets
- `GET /api/cron/delivery-targets` — Evidence: `web_server.py:6282-6307`
- Returns: `{targets: [{id, name, home_target_set, home_env_var}]}`
- **Mobile use case:** Cron job creation form — choose where output goes.
- **Effort:** ~0.5 day (integrate into cron create flow)

### 22. Session Latest-Descendant Resolution
- `GET /api/sessions/{id}/latest-descendant` — Evidence: `web_server.py:6629-6636`
- Returns: `{requested_session_id, session_id, path, changed}`
- **Mobile use case:** When reopening a chat, auto-navigate to the latest continuation (after compression or /model switch).
- **Effort:** ~0.5 day (integrate into session resume flow)

---

## Summary: Top 5 Mobile Differentiators

| # | Feature | Why unique | Effort |
|---|---------|-----------|--------|
| 1 | **Approval/Clarify from mobile** | No other AI client lets you approve dangerous commands from your phone | 3-4 days |
| 2 | **Usage & cost analytics** | "How much am I spending?" is the #1 question for self-hosters | 3-4 days |
| 3 | **System admin (status, logs, restart)** | Remote server management from your pocket | 2-3 days |
| 4 | **Session branching + undo** | Conversation version control — fork and rollback | 2 days |
| 5 | **Cron suggestions (one-tap automations)** | Makes scheduled jobs accessible to non-technical users | 4 days (2 server + 2 mobile) |
