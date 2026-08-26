# Mobile API Coverage Audit — hermes 0.20.4

**Date:** 2026-08-26 · **Gateway:** `v2026.8.18` (0.20.4), the digest live on dc1-1
**Supersedes:** `under-discovered-features.md` (2026-06-16, written against a pre-0.20.4
tree — its line-number evidence no longer resolves and several of its items have shipped).

Method: enumerated the real surface out of the tagged tree rather than from memory —
`@method("…")` decorators across `tui_gateway/methods_*.py` + `server.py` for RPC,
emit call sites for events, route decorators in `hermes_cli/web_server.py` for REST — then
intersected against every dotted name and `/api/…` path the app source references.

---

## Coverage, and why the headline number is misleading

| surface | available | app uses | |
|---|---|---|---|
| WS RPC methods | 154 | 6 | 4% |
| WS events | 40 | 15 | 38% |
| REST `/api` routes | 130 | 6 (+4 plugin-private) | 5% |

**Do not read 4% as "the app is 4% done."** Three things distort it:

1. **59 of the 154 RPCs are not mobile surface at all** — `pet.*`, `wake.*`, `voice.*`,
   `window.*`, `terminal.*`, `clipboard.*`, `preview.*`, `billing.*`, `subscription.*`,
   `shell.exec`, `cli.exec`, `spawn_tree.*`, `learning.*`. Desktop/TUI affordances and
   hosted-billing concerns. Excluding them the denominator is **89**, not 154.
2. **The app is REST-first where the gateway offers both.** Skills, profiles, memory and
   cron all go over `/api/…` in `src/api/*.ts`, so their RPC twins read as "uncovered"
   while the feature is present.
3. **The subagent event family is fully handled** (7/7 — `subagent.start`, `.text`,
   `.tool`, `.thinking`, `.progress`, `.spawn_requested`, `.complete`), which is most of
   what moved the event number from 27% to 38% once counted properly.

The real finding is narrower and sharper: **the app has a rich read/stream path and almost
no control path.** It can watch a turn in exquisite detail and cannot alter one.

---

## Closed out from the June audit

Shipped since, and no longer worth tracking: **approvals from mobile** (that audit's #1
"killer feature" — `approval.request`/`approval.respond`, `approval-card.tsx`, force-deny
on turn end), session export (`src/lib/export.ts`), memory read/write, the skills screen,
cron create/edit, model switching with a per-chat pill, and subagent progress cards.

Its remaining items are re-derived below against 0.20.4 rather than carried over — the
endpoints it cited by line number have all moved (e.g. analytics is `web_server.py:15354`,
not `:9799`).

---

## Tier 1 — Turn control. The app cannot stop, steer, or undo a turn.

Every RPC here is live on the gateway today and called from nowhere in `src/`.

| RPC | what it does | why it matters on a phone |
|---|---|---|
| `session.interrupt` | stops the running turn; force-denies pending approvals | **There is no stop button.** A runaway turn on a phone is tokens you are paying for and cannot halt. |
| `session.steer` | *"Inject a user message into the next tool result without interrupting… safe to call while a turn is running"* | The one genuinely mobile-native feature in the whole surface — see below. |
| `session.undo` | removes the last user+assistant+tool turn | one-tap "that came out wrong" |
| `session.branch` | full copy of history as a new session, with title lineage | fork a conversation instead of losing the good half |
| `session.compress` | manual compaction, optional `focus_topic`, returns before/after tokens | the long-thread escape hatch |
| `subagent.interrupt` / `subagent.steer` | same two verbs, scoped to one child | you already render subagent cards; these make them interactive |

**`session.steer` deserves its own paragraph.** It lands text on the last tool result of
the next tool batch — no interrupt, no new user turn, no role-alternation violation. The
model picks it up on its next iteration. Concretely: the agent is twenty minutes into
something, you are on your phone, and you add *"skip the integration tests, just ship the
unit ones"* without killing the run. No other AI mobile client has this, because most
gateways cannot express it. It is one RPC and a composer affordance.

Recommended order: `session.interrupt` (papercut, ~half a day) → `session.steer` (the
differentiator) → `undo`/`branch`/`compress` (each roughly a button and a call).

---

## Tier 2 — The interactive-request family. You built one of four.

`approval.request` → `approval.respond` is done. The gateway has three more request/respond
pairs on exactly the same shape, all unhandled:

- **`clarify.respond`** — the agent asks a question mid-turn. Unhandled, the turn simply
  stalls until you reach a desk. This is the twin of the approval flow and should reuse
  `approval-card.tsx` almost verbatim. **Highest value in this tier.**
- **`sudo.respond`** — privilege prompt.
- **`secret.respond`** — supply a secret to a running turn. Think before shipping: it
  moves credential entry onto the phone, which is a threat-model change, not a feature.

Also uncovered and cheap: **`approval.pending`** — resync outstanding approvals after a
cold start. Today a push notification can wake the app to an approval it cannot enumerate.

**0.20.4 caveat for the approvals UI you already have:** the gateway now *coalesces
identical concurrent approval prompts*. Worth confirming the queue does not render a
coalesced prompt twice.

---

## Tier 3 — Cost and context, now much cheaper than the June estimate

June scoped this as a 3-4 day analytics dashboard against two REST endpoints. 0.20.4 has
better, over the socket the app is already holding open:

- **`session.usage`** — per-session tokens/calls, plus a Nous credits block that resolves
  even on a resumed session with zero API calls. There is also a **`session.usage` event**,
  so this can be live rather than polled.
- **`session.context_breakdown`** — categories, `context_used`, `context_max`,
  `context_percent`. This is the "why is this chat expensive" view, per chat.
- **`usage.bars`** — the shared two-bar dollar model behind `/usage`. Explicitly fail-open
  (`available:false` when logged out), so it degrades cleanly on a self-hosted box.
- **`insights.get`** — session rollup over a `days` window.
- REST, if a historical dashboard is wanted later: `GET /api/analytics/usage`
  (`web_server.py:15354`) and `GET /api/analytics/models` (`:15542`).

A context-percent ring on the composer, fed by the `session.usage` event, is a few hours'
work and is the single highest information-per-pixel addition available.

---

## Tier 4 — Session management

`session.list`, `session.delete`, `session.title`, `session.set_hidden` (**new in 0.20.4**
— hides from the list while staying resumable), `session.save`, `session.close`,
`session.active_list`, `session.most_recent`, `session.status`. The app creates and resumes
sessions and manages them not at all. Rename/delete/hide is table stakes for a list view.

---

## Tier 5 — Remote admin (REST, and genuinely useful given dc1-1 is headless)

- `GET /api/status` (`:3543`) — version, gateway state, per-platform connection status
- `GET /api/logs` (`:12235`) — level/component/search filtering
- `POST /api/gateway/restart` (`:4657`), `/start` (`:13664`), `/stop` (`:13676`),
  **`/drain` (`:4674`, new)**
- `POST /api/ops/doctor` (`:13945`), `/backup` (`:13974`), **`/backup/download` (`:14002`)**,
  **`/checkpoints` (`:14285`)**, **`/hooks` (`:14131`)**
- `GET /api/actions/{name}/status` (`:5438`) — tail any of the above
- `GET/PUT /api/curator` + `/curator/run` (`:4101`–`:4130`) — you run curator weekly

Largest new UI surface of anything here, and the least differentiated — it is a status
page. Worth doing, worth doing last.

---

## Tier 6 — Surface that did not exist when the June audit was written

- **`rollback.list` / `rollback.diff` / `rollback.restore`** — the curator's per-mutation
  audit ledger with single-edit rollback. Your curator runs unattended every 168h; this is
  the only way to see and undo what it did, and there is no mobile surface for it at all.
- **`session.set_hidden`** — the hidden-but-resumable flag.
- **Import and resume Claude Code / Codex CLI sessions** — start in a terminal, continue on
  the phone.
- **`/save` exports json/md/html on every platform** — `src/lib/export.ts` predates this and
  may be doing work the gateway now does.
- **Skill trust gate, quarantine, and advisory license/security scan on install** — the
  skills screen has new states to represent, and a skill can arrive quarantined.
- **`tool.output_risk` event** — unhandled risk signal on tool output.
- **`mcp.servers.*`** (9 RPCs) — full MCP server management incl. OAuth start/poll.
- **`process.list` / `process.kill` / `process.stop`** — background process control, which
  pairs with 0.20.4's switch to concise background-process notifications.
- **`delegation.pause` / `delegation.status`** — with `max_concurrent_children` now
  defaulting to 10, fan-outs are wider and worth being able to see and pause.

---

## Recommendation

Tier 1 first, and inside it `session.interrupt` before anything else: it is the smallest
change here and the only one that fixes something that annoys you every day. Then
`session.steer`, which is the feature worth telling people about. Tier 2's `clarify.respond`
next, because it reuses a card you have already built and shipped.

Tiers 3-6 are real but none of them are blocked on anything, and none of them change how
the app feels in the first thirty seconds of use.
