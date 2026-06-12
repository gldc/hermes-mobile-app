# Wire contracts: skills (list, toggle, content read, hub, profile scoping)

Verified against a local hermes-agent checkout on 2026-06-11.
REST server: `hermes_cli/web_server.py` (FastAPI). Reference clients:
`web/src/lib/api.ts` (dashboard) and `apps/desktop/src/hermes.ts` (desktop).

---

## List installed skills — SUPPORTED

`GET /api/skills?profile=<name>`

Evidence: `hermes_cli/web_server.py:8450-8460`. Skill discovery:
`tools/skills_tool.py:595-672` (`_find_all_skills`).

Response (200): a **bare JSON array** (not wrapped in an object):

```json
[
  { "name": "git-commits", "description": "…", "category": "dev", "enabled": true }
]
```

- `name` / `description` / `category` come from each skill dir's `SKILL.md` frontmatter
  (`tools/skills_tool.py:637-660`); `category` is derived from the path, `description` falls
  back to the first non-heading body line (lines 643-649).
- `enabled` is added by the endpoint: `name not in disabled` set from config
  (`web_server.py:8456-8459`).
- The handler passes `skip_disabled=True` so disabled skills are still listed (and then
  flagged), letting the UI render the toggle (line 8457).
- Client usage: `web/src/lib/api.ts:557-558` (`getSkills`), TS shape `SkillInfo` at
  `web/src/lib/api.ts:1755-1760` (`{name, description, category, enabled}`);
  desktop: `apps/desktop/src/hermes.ts:412-417`.

### `source` field — NOT FOUND on this endpoint

The list payload has only `name/description/category/enabled` (`tools/skills_tool.py:656-660`
plus `enabled` at `web_server.py:8458-8459`). There is **no per-skill `source` field**.
Hub-install provenance is exposed separately: the `installed` map on
`GET /api/skills/hub/sources` / `GET /api/skills/hub/search` (see below) keyed by hub
identifier, with `{name, trust_level, scan_verdict}` per entry
(`web_server.py:7484-7513`, `_installed_hub_identifiers`).

### `pinned` field — NOT FOUND

No `pinned` key anywhere in the `/api/skills` payload. Pin state exists only in the curator's
skill-usage records (`tools/skill_usage.py:22`, `set_pinned` at `tools/skill_usage.py:648-650`)
and is not surfaced over REST.

---

## Pin / unpin a skill — NOT FOUND (REST); CLI-only

There is no pin/unpin HTTP endpoint. The full route list of `web_server.py` contains no
`pin` route; curator REST is read/pause/run only:

- `GET /api/curator` — status `{enabled, paused, interval_hours, last_run_at, min_idle_hours,
  stale_after_days, archive_after_days}` (`web_server.py:1404-1422`).
- `PUT /api/curator/paused` `{paused: bool}` (`web_server.py:1429-1434`).
- `POST /api/curator/run` — spawns a background curator run (`web_server.py:1437-1444`).

Pinning is CLI-only: `hermes curator pin|unpin <skill>` (`hermes_cli/curator.py:234-258`),
and is restricted to **agent-created** skills — bundled or hub-installed skills are rejected
(`hermes_cli/curator.py:236-240`). Do not build mobile UI assuming REST pin support.

Note: the closest REST analog to "keep/remove" is the enable/disable toggle below — it is a
different concept (visibility to the agent, not curation opt-out).

---

## Enable / disable (toggle) a skill — SUPPORTED

`PUT /api/skills/toggle`

Evidence: `hermes_cli/web_server.py:8444-8474` (`SkillToggle` model at 8444-8447).

Request body:

```json
{ "name": "git-commits", "enabled": false, "profile": "work" }
```

`profile` optional (see profile scoping below). Persists to the profile's disabled-skills
config (`hermes_cli/skills_config.py` `save_disabled_skills`, called at line 8473).

Response (200): `{ "ok": true, "name": "git-commits", "enabled": false }`.

Client usage: `web/src/lib/api.ts:559-560`, `apps/desktop/src/hermes.ts:419-426`.

---

## Read a skill's SKILL.md content

### Installed skill content — NOT FOUND (no dedicated endpoint)

There is no `GET /api/skills/{name}` or `GET /api/skills/{name}/content` route (full route
scan of `web_server.py`). The dashboard SkillsPage renders only the list metadata.

Workaround that exists but is NOT a stable contract: `GET /api/files/read?path=<abs path>`
returns `{name, path, size, mime_type, data_url}` with base64 content
(`web_server.py:1091-1121`) — but the managed-files policy locks the browsable root when the
dashboard is gated/remote (`_managed_files_policy`, `web_server.py:959-971`), so profile skill
dirs under `~/.hermes*/skills/` are generally unreachable from a remote mobile client. Treat
installed-skill content read as unavailable.

### Hub (not-yet-installed) skill content — SUPPORTED

`GET /api/skills/hub/preview?identifier=<hub identifier>`

Evidence: `hermes_cli/web_server.py:7626-7684`.

Response (200):

```json
{
  "name": "…", "description": "…", "source": "skills-sh",
  "identifier": "…", "trust_level": "builtin" | "trusted" | "community",
  "repo": "owner/repo" | null, "tags": ["…"],
  "skill_md": "full SKILL.md text",
  "files": ["SKILL.md", "scripts/run.sh", "…"]
}
```

Binary files in the manifest are replaced with `"(binary file)"` (lines 7653-7659).
Errors: 400 missing identifier, 404 not found, 502 hub failure (7637, 7679-7684).

---

## Skills hub (search / install / uninstall / update / scan) — SUPPORTED

All under `/api/skills/hub/*`; result rows share the `_skill_meta_to_payload` shape
(`web_server.py:7472-7481`): `{name, description, source, identifier, trust_level, repo, tags}`.
Source ids/labels: `web_server.py:7458-7470` (`official`, `hermes-index`, `skills-sh`,
`well-known`, `url`, `github`, `clawhub`, `claude-marketplace`, `lobehub`, `browse-sh`).

- `GET /api/skills/hub/sources?profile=<name>` (`web_server.py:7515-7573`) →
  `{sources: [{id, label, rate_limited?, available?}], index_available, featured: [meta…],
  installed: {identifier: {name, trust_level, scan_verdict}}}`.
- `GET /api/skills/hub/search?q=&source=all&limit=20&profile=` (`web_server.py:7576-7623`) →
  `{results: [meta…], source_counts, timed_out, installed}`; limit clamped 1..50; empty `q`
  returns empty payload immediately (7588-7589).
- `POST /api/skills/hub/install` body `{identifier, profile?}` (`web_server.py:7396-7411`,
  `SkillInstallRequest` at 7372-7374) → spawns `hermes skills install` as a background
  action; response `{ok, pid, name: "skills-install"}`. Tail progress via
  `GET /api/actions/skills-install/status` (`web_server.py:2077`, log-name map at 1603-1605).
- `POST /api/skills/hub/uninstall` body `{name, profile?}` (`web_server.py:7414-7434`) →
  `{ok, pid, name: "skills-uninstall"}` (action pattern as above).
- `POST /api/skills/hub/update` body `{profile?}` (`web_server.py:7437-7453`) →
  `{ok, pid, name: "skills-update"}`.
- `GET /api/skills/hub/scan?identifier=` (`web_server.py:7687-7771`) — install-time security
  scan without installing; returns scan verdict fields (e.g. `name` from
  `result.skill_name`, line 7756).

---

## Profile-scoped variants — SUPPORTED

`GET /api/skills`, `PUT /api/skills/toggle`, the toolsets endpoints, and the hub
sources/search/install/uninstall/update endpoints all accept `profile` (query param on GETs,
body field on writes).

Mechanism: `_profile_scope()` (`web_server.py:8403-8441`) — re-binds `HERMES_HOME` and
`tools.skills_tool.SKILLS_DIR` to the named profile for the duration of the request, under a
lock. `profile` of `None` / `""` / `"current"` means the dashboard's own profile (no-op,
backward compatible — lines 8417-8423). Unknown profile names → 404 from
`_resolve_profile_dir`. Hub install/uninstall/update instead spawn the CLI with
`-p <profile>` (`_profile_cli_args`, used at `web_server.py:7403, 7426, 7446`).

Client evidence: web dashboard sends `?profile=` (`web/src/lib/api.ts:557-560`,
`profileQuery`); SkillsPage profile selector rationale at
`web/src/pages/SkillsPage.tsx:140-145`. The desktop instead routes per-profile via its
backend pool (one `hermes --profile <name>` backend per profile,
`apps/desktop/electron/main.cjs:540-546`) with `profileScoped()` request tagging
(`apps/desktop/src/hermes.ts:131-133`).
