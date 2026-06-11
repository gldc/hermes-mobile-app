# Wire contracts: sessions (search, rename, delete/archive, raw tool messages)

Verified against hermes source at `~/hermes-agent` on 2026-06-11.
REST server: `hermes_cli/web_server.py` (FastAPI). DB layer: `hermes_state.py` (SQLite + FTS5).

---

## Full-text session search — SUPPORTED

`GET /api/sessions/search?q=<query>&limit=<n>`

Evidence: `hermes_cli/web_server.py:2311-2471` (`@app.get("/api/sessions/search")`).

- `q` (string, required in practice): empty/whitespace returns `{"results": []}` immediately (line 2323-2324).
- `limit` (int, default 20, clamped to 1..100 at line 2329).
- Backed by FTS5 (`SessionDB.search_messages`, `hermes_state.py:3097`; FTS index covers
  `content || tool_name || tool_calls`, see `hermes_state.py:535`, `754-755`).
- Server auto-appends `*` prefix wildcards to bare terms (line 2437-2447), so partial words match.
  Quoted phrases and explicit `term*` are passed through.
- Direct session-id matches are returned first (`db.search_sessions_by_id`, line 2422), then FTS
  content matches; results are deduped by compression lineage.

Response (200):

```json
{
  "results": [
    {
      "snippet": "…matched <b>text</b>…",
      "role": "user" | "assistant" | "tool" | null,
      "source": "cli" | "gateway" | "cron" | "telegram" | ...,
      "model": "anthropic/claude-...",
      "session_started": 1749500000.123,
      "session_id": "abc123...",
      "lineage_root": "def456..."
    }
  ]
}
```

- `session_id` is the **lineage tip** (latest compression segment) — open this id, not the raw hit
  (lines 2407-2416). `lineage_root` is the original/root session id.
- `role` is `null` for direct session-id matches (line 2430); for those, `snippet` is the session
  preview or `"Session ID: <id>"` (lines 2424-2425).
- Errors: 500 `{"detail": "Search failed"}` (line 2469-2471).

---

## Session rename / title update — SUPPORTED

`PATCH /api/sessions/{session_id}`

Evidence: `hermes_cli/web_server.py:5952-5991` (model `SessionRename` at 5952-5957, handler at 5960).

Request body (JSON, all fields optional but at least one of `title`/`archived` required):

```json
{ "title": "New name", "archived": true, "profile": "work" }
```

- `title: string | null` — renames; empty string or null **clears** the title (line 5978-5980).
- `archived: bool | null` — soft-archive / restore (line 5984-5985).
- `profile: string | null` — target another local profile's `state.db` (line 5955-5957). Omit for default.
- 400 if both `title` and `archived` are omitted (line 5973-5977).
- 400 with `detail` string if title is too long / invalid / already in use (line 5981-5983).
- 404 if session id can't be resolved.

Response (200): `{"ok": true, "title": "<current title>"}` plus `"archived": <bool>` only when
`archived` was in the request (lines 5986-5989).

---

## Session delete — SUPPORTED

`DELETE /api/sessions/{session_id}?profile=<name>`

Evidence: `hermes_cli/web_server.py:5938-5949`.

- `profile` query param optional (other local profile's DB).
- Response: `{"ok": true}`; 404 if not found.
- Children of a deleted parent are orphaned, not cascade-deleted.

Related bulk endpoints:

- `POST /api/sessions/bulk-delete` — body `{"ids": ["...", ...]}` (max 500, else 400);
  response `{"ok": true, "deleted": <int actually deleted>}`. Unknown ids silently skipped.
  Evidence: `web_server.py:5748-5800`.
- `GET /api/sessions/empty/count` → `{"count": <int>}` (`web_server.py:5803-5816`).
- `DELETE /api/sessions/empty` → `{"ok": true, "deleted": <int>}` (`web_server.py:5819-5845`).
- `POST /api/sessions/prune` — body `{"older_than_days": 90, "source": null}` →
  `{"ok": true, "removed": <int>}`; 400 if `older_than_days < 1` (`web_server.py:6012-6034`).

## Session archive — SUPPORTED (via PATCH, no dedicated verb)

Archive is the `archived` field of `PATCH /api/sessions/{session_id}` (see above). There is no
separate `/archive` endpoint. List endpoint filters archived rows:
`GET /api/sessions?archived=exclude|only|include` (`web_server.py:2114-2145`).

---

## RAW message rows: `GET /api/sessions/{session_id}/messages` — SUPPORTED

Evidence: handler `hermes_cli/web_server.py:5924-5935`; row production `hermes_state.py:2413-2446`
(`SessionDB.get_messages` — `SELECT * FROM messages ... ORDER BY id`); table schema
`hermes_state.py:477-496`.

- Query param `profile` optional (cross-profile read, `web_server.py:5881-5893`).
- Resolves resumed/compressed ids first (`resolve_resume_session_id`, line 5931).

Response (200):

```json
{ "session_id": "<resolved id>", "messages": [ { ...raw row... } ] }
```

Every row has ALL columns of the `messages` table (it is a `SELECT *`), i.e.:

| field | type | notes |
|---|---|---|
| `id` | int | autoincrement; true insertion order |
| `session_id` | string | |
| `role` | string | `user` / `assistant` / `tool` / `system` |
| `content` | string \| object \| null | JSON-prefix-encoded structured content is decoded back to objects by `_decode_content` (`hermes_state.py:2217-2228`); usually a string |
| `tool_call_id` | string \| null | e.g. `"call_39533c19b0624626ba271be6"` |
| `tool_calls` | array \| null | JSON-parsed server-side (`hermes_state.py:2439-2444`); falls back to `[]` on corrupt JSON |
| `tool_name` | string \| null | |
| `timestamp` | float | epoch seconds (REAL) |
| `token_count` | int \| null | |
| `finish_reason` | string \| null | |
| `reasoning`, `reasoning_content`, `reasoning_details` | string \| null | assistant rows only |
| `codex_reasoning_items`, `codex_message_items` | string \| null | |
| `platform_message_id` | string \| null | |
| `observed` | 0/1 | |
| `active` | 0/1 | soft-delete flag; only `active=1` rows are returned by default |

### role='tool' rows (rendering tool calls from history)

Verified against a live `~/.hermes/state.db`:

- `role: "tool"`, `tool_name` set (e.g. `"write_file"`, `"skill_view"`), `tool_call_id` set,
  `content` = the tool **result** — typically a JSON-as-string, e.g.
  `"{\"bytes_written\": 5763, \"dirs_created\": true, ...}"`. `tool_calls` is null on tool rows.
- The matching tool **invocation** lives on the preceding `role: "assistant"` row in its
  `tool_calls` array (already parsed to objects in the response):

```json
"tool_calls": [
  {
    "id": "call_39533c19b0624626ba271be6",
    "call_id": "call_39533c19b0624626ba271be6",
    "response_item_id": "fc_...",
    "type": "function",
    "function": { "name": "write_file", "arguments": "{...json string...}" }
  }
]
```

Join invocation→result on `assistant.tool_calls[i].id == tool.tool_call_id`.
`function.arguments` is a JSON **string** (OpenAI style), parse client-side.

---

## Adjacent (for completeness)

- `GET /api/sessions` — list; response `{"sessions": [...], "total", "limit", "offset"}`, rows
  enriched with `preview`, `last_active`, `is_active`, boolean `archived`
  (`web_server.py:2114-2189`). Params: `limit, offset, min_messages, archived, order=created|recent, source, exclude_sources`.
- `GET /api/sessions/{id}` — session detail row (`web_server.py:5896-5908`).
- `GET /api/sessions/{id}/latest-descendant` → `{requested_session_id, session_id, path, changed}` (`web_server.py:5912-5922`).
- `GET /api/sessions/{id}/export` — full metadata + messages JSON (`web_server.py:5994-6009`).
- `GET /api/sessions/stats` → `{total, active_store, archived, messages, by_source}` (`web_server.py:5848-5878`).
