# Wire contracts: profiles (list, create, active/default switch, targeting on sessions & chat)

Verified against a local hermes-agent checkout on 2026-06-11.
REST server: `hermes_cli/web_server.py` (FastAPI). Chat gateway (JSON-RPC over WS `/api/ws`):
`tui_gateway/server.py`.

---

## List profiles — SUPPORTED (shape has grown)

`GET /api/profiles`

Evidence: `hermes_cli/web_server.py:8044-8051`; row shape `_profile_to_dict` at 7845-7861.

Response (200):

```json
{
  "profiles": [
    {
      "name": "default",
      "path": "/Users/x/.hermes",
      "is_default": true,
      "model": "anthropic/claude-opus-4.7",
      "provider": "openrouter",
      "has_env": true,
      "skill_count": 42,
      "gateway_running": false,
      "description": "…",
      "description_auto": false,
      "distribution_name": null,
      "distribution_version": null,
      "distribution_source": null,
      "has_alias": false
    }
  ]
}
```

- `model` / `provider` may be `null` (read from each profile's config). `description_auto`
  marks an LLM-generated description. The `distribution_*` triplet and `has_alias` are newer
  fields (7857-7860) — clients should tolerate additional keys.
- On listing failure the server falls back to a raw directory scan with the same keys
  (8049-8051, `_fallback_profile_dicts` at 7864+); treat all fields as best-effort.
- Client usage: `web/src/lib/api.ts:459` (`getProfiles`).

---

## Create profile — SUPPORTED

`POST /api/profiles`

Evidence: `web_server.py:8054-8158`; request model `ProfileCreate` at 7783-7810.

Request body (all optional except `name`):

```json
{
  "name": "work",
  "clone_from_default": false,
  "clone_all": false,
  "no_skills": false,
  "description": "…",
  "clone_from": "other-profile",
  "provider": "openrouter",
  "model": "…",
  "mcp_servers": [],
  "keep_skills": [],
  "hub_skills": []
}
```

Response: `{ "ok": true, "name", "path", "model_set", "mcp_written", "skills_disabled",
"hub_installs": [{"identifier", "pid"}] }` (8150-8158). Model/MCP/skill extras are applied
best-effort after the directory exists (8096-8148). Errors: 400 (bad name / exists), 500.

Other per-profile management endpoints (all SUPPORTED):

- `PATCH /api/profiles/{name}` body `{"new_name": "…"}` — rename (8261-8273).
- `DELETE /api/profiles/{name}` — delete, no confirmation prompt server-side (8276-8291).
- `GET /api/profiles/{name}/soul` → `{content, exists}`; `PUT` body `{content}` (8294-8313).
- `PUT /api/profiles/{name}/description` body `{description}` — empty clears (8316-8336).
- `PUT /api/profiles/{name}/model` body `{provider, model}` (8339-8356; see
  `docs/contracts/models.md`).
- `POST /api/profiles/{name}/describe-auto` body `{overwrite?}` → `{ok, reason, description,
  description_auto}` — soft failure as `ok:false`, not HTTP error (8359-8383).
- `GET /api/profiles/{name}/setup-command` → `{command}` (8202-8204);
  `POST /api/profiles/{name}/open-terminal` is desktop-host-only (8207-8258).

---

## Active / default profile switch — SUPPORTED

`GET /api/profiles/active` (`web_server.py:8161-8179`) →

```json
{ "active": "work", "current": "default" }
```

- `active` = the sticky default written by `hermes profile use` (what new CLI invocations and
  gateways pick up). `current` = the profile **this running backend** is scoped to.

`POST /api/profiles/active` body `{ "name": "work" }` (`web_server.py:8182-8199`) →
`{ "ok": true, "active": "work" }`.

- Mirrors `hermes profile use`. **It does not retarget the already-running backend** — only
  subsequent CLI commands/gateways (docstring 8184-8188). 404 unknown profile, 400 bad name.
- This is the only "switch default" endpoint; there is no endpoint to re-bind a live backend
  to another profile (NOT FOUND — by design, see desktop backend-pool note below).

---

## Targeting a profile on sessions (REST)

### Listing

- `GET /api/sessions` — **no `profile` parameter** (`web_server.py:2114-2123`); always the
  backend's own profile. Params: `limit, offset, min_messages, archived=exclude|only|include,
  order=created|recent, source, exclude_sources`.
- `GET /api/profiles/sessions?profile=all|<name>&…` — SUPPORTED, cross-profile aggregate
  (`web_server.py:2192-2308`). Same paging/filter params as `/api/sessions` plus `profile`
  (default `"all"`). Opens each profile's `state.db` read-only on disk; does NOT spawn
  per-profile backends (2203-2210). Response:

  ```json
  {
    "sessions": [ { …session row…, "profile": "work", "is_default_profile": false,
                    "is_active": true, "archived": false } ],
    "total": 12,
    "profile_totals": { "default": 8, "work": 4 },
    "limit": 20, "offset": 0,
    "errors": [ { "profile": "broken", "error": "…" } ]
  }
  ```

### Per-session reads/mutations — `profile` as query param or body field

Mechanism: `_open_session_db_for_profile` (`web_server.py:5881-5893`) opens the named
profile's `state.db` directly; omitted/empty = the backend's own profile.

- `GET /api/sessions/{id}?profile=` (5896-5909) — detail; response tagged with `profile`.
- `GET /api/sessions/{id}/messages?profile=` (5924-5935).
- `DELETE /api/sessions/{id}?profile=` (5938-5950).
- `PATCH /api/sessions/{id}` body `{title?, archived?, profile?}` (5952-5991; see
  `docs/contracts/sessions-extra.md`).

---

## Targeting a profile on chat (gateway JSON-RPC over `/api/ws`)

The chat surface is the JSON-RPC WebSocket sidecar `/api/ws`
(`web_server.py:9510-9536` → `tui_gateway.ws.handle_ws`), driving `tui_gateway/server.py`
methods. Profile scoping ("app-global remote mode": one backend serving every profile) is
documented at `tui_gateway/server.py:667-674`.

### `session.create` — `profile` param SUPPORTED

Evidence: `tui_gateway/server.py:3567` (handler), 3585-3592 (profile binding).

Params: `cols?, messages?, title?, cwd?, close_on_disconnect?, profile?`.

- `params.profile` (string, optional): the new chat builds its agent against **that**
  profile's home and persists to that profile's `state.db` (`profile_home` stored on the
  session, 3619; agent build + turn persistence re-bind `HERMES_HOME`, 917-929 and 1140).
  Omitted / empty / the launch profile's own name → launch profile, unchanged (3590-3592,
  `_profile_home` at 675-696). A non-launch profile also resolves its workspace cwd from its
  own `config.yaml` (1037-1039, 698-712).
- Result includes `session_id`, `stored_session_id`, `messages`, and `info` with `model`,
  `cwd`, `branch`, `lazy: true`, `desktop_contract`, `profile_name` (3651-3667). Note
  `info.profile_name` reports the **launch** profile (`_current_profile_name()`), not the
  per-session override.

### `session.resume` — `profile` param SUPPORTED

Evidence: `tui_gateway/server.py:3760-3781`. Params: `session_id` (required), `cols?,
profile?`. A named profile opens that profile's `state.db` for the resume and binds the
rebuilt agent to it (3771-3781).

### Other methods

`prompt.submit` and the rest of the per-session methods take the gateway `session_id` and
inherit the profile binding stored on the session at create/resume time (the only
`params.get("profile")` reads in the gateway are session.create:3590, session.resume:3771,
and the cwd-completion helper at 1039). There is no per-message profile switch.

### Desktop pattern (for reference)

The desktop normally runs one backend per profile (`hermes --profile <name>`), pooled with
LRU eviction (`apps/desktop/electron/main.cjs:540-554`), and tags REST calls via
`profileScoped()` (`apps/desktop/src/hermes.ts:131-133`). The `profile` params above exist
for the app-global remote mode where a single remote backend serves every profile
(`apps/desktop/electron/main.cjs:4178-4187`, `tui_gateway/server.py:667-674`). A mobile
client talking to one remote backend should use: `GET /api/profiles/sessions` for the list,
`?profile=`/body `profile` on per-session REST, and `profile` on `session.create` /
`session.resume` for chat.

### PTY chat — NOT profile-targetable

The xterm PTY websocket `/api/pty` (`web_server.py:9378`) spawns the embedded TUI as the
launch profile only; no profile parameter.
