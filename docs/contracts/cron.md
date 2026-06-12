# Wire contracts: cron jobs REST

Verified against a local hermes-agent checkout on 2026-06-11.
REST server: `hermes_cli/web_server.py`. Job store: `cron/jobs.py` (JSON file per profile,
`~/.hermes/cron/jobs.json`).

All endpoints are profile-aware: jobs live per Hermes profile. When `profile` is omitted on
job-scoped endpoints the server scans every profile to find the job
(`_find_cron_job_profile`, `web_server.py:6180-6188`). Every job in a response is annotated with
`profile`, `profile_name`, `hermes_home`, `is_default_profile` (`web_server.py:6139-6145`).

---

## List jobs — SUPPORTED

`GET /api/cron/jobs?profile=all|<name>` (default `all`)

Evidence: `hermes_cli/web_server.py:6191-6206`. Returns a bare JSON **array** of job objects
(includes disabled/paused jobs — `list_jobs(True)`).

Job object shape (created in `cron/jobs.py:672-706`, normalized by `_normalize_job_record`):

```json
{
  "id": "a1b2c3d4e5f6",                  // 12-hex uuid fragment
  "name": "Morning digest",
  "prompt": "…",                          // null for no-agent script jobs
  "skills": ["skill-a"] | null,
  "skill": "skill-a" | null,              // legacy single-skill mirror
  "model": null, "provider": null, "base_url": null,
  "script": null, "no_agent": false,
  "context_from": ["otherjobid"] | null,
  "schedule": { "kind": "cron|interval|once", "...": "...", "display": "every day at 9am" },
  "schedule_display": "every day at 9am",
  "repeat": { "times": null, "completed": 3 },   // times null = forever
  "enabled": true,
  "state": "scheduled" | "paused",
  "paused_at": null, "paused_reason": null,
  "created_at": "2026-06-01T09:00:00+00:00",     // ISO 8601
  "next_run_at": "2026-06-12T09:00:00+00:00" | null,
  "last_run_at": "2026-06-11T09:00:01+00:00" | null,
  "last_status": "success" | "error" | null,
  "last_error": null,
  "last_delivery_error": null,
  "deliver": "local" | "origin" | "telegram" | ...,
  "origin": { ... } | null,
  "enabled_toolsets": null,
  "workdir": null,
  "profile": "default",                  // + profile_name, hermes_home, is_default_profile (annotations)
  "profile_name": "default",
  "hermes_home": "/Users/x/.hermes",
  "is_default_profile": true
}
```

`schedule` / `last_run_at` / `next_run_at` evidence: `cron/jobs.py:684-699`; run bookkeeping
(`last_run_at`, `last_status`, `next_run_at` recompute) in `mark_job_run` `cron/jobs.py:915-965`.

## Get one job — SUPPORTED

`GET /api/cron/jobs/{job_id}?profile=<name>` → job object; 404 if not found.
Evidence: `web_server.py:6209-6217`. `job_id` may be the id or the (unambiguous) job name
(`resolve_job_ref`, `cron/jobs.py:737-759`).

## Create — SUPPORTED

`POST /api/cron/jobs?profile=default`

Body (`CronJobCreate`, `web_server.py:6100-6104`):

```json
{ "prompt": "…", "schedule": "every day at 9am", "name": "", "deliver": "local" }
```

Response: the created job object. 400 with `detail` on schedule-parse or other errors
(`web_server.py:6266-6279`). Note: the REST create surface only exposes these 4 fields; richer
fields (skills, model, workdir, repeat, …) exist in `cron/jobs.py:create_job` (550-620) but are not
accepted by this endpoint — set them post-create via PUT updates.

## Update — SUPPORTED

`PUT /api/cron/jobs/{job_id}?profile=<name>`

Body (`CronJobUpdate`, `web_server.py:6107-6108`): `{ "updates": { "<field>": <value>, ... } }`.

- `schedule` may be a raw string (re-parsed server-side, `cron/jobs.py:812-825`).
- Immutable fields (notably `id`) rejected with 400 (`cron/jobs.py:770-779`).
- Response: updated job object; 404 if unknown. Evidence: `web_server.py:6310-6321`.

## Pause / Resume / Toggle — SUPPORTED (pause + resume; no single "toggle" endpoint)

- `POST /api/cron/jobs/{job_id}/pause?profile=<name>` → job object
  (`web_server.py:6324-6332`; sets `enabled=false, state="paused", paused_at`, `cron/jobs.py:836-849`).
- `POST /api/cron/jobs/{job_id}/resume?profile=<name>` → job object
  (`web_server.py:6335-6343`; sets `enabled=true, state="scheduled"` and recomputes `next_run_at`
  from now, `cron/jobs.py:852-868`).
- NOT FOUND: a literal `/toggle` endpoint. Implement toggle client-side from `enabled`/`state`.

## Trigger manual run — SUPPORTED

`POST /api/cron/jobs/{job_id}/trigger?profile=<name>` → job object.
Evidence: `web_server.py:6346-6354`. Semantics: sets `next_run_at = now` so the scheduler picks it
up on its next tick (`cron/jobs.py:871-885`) — it does NOT run synchronously; poll the job /runs
list for the new run session.

## Delete — SUPPORTED

`DELETE /api/cron/jobs/{job_id}?profile=<name>` → `{"ok": true}`; 404 unknown; 400 on
ambiguous-name errors. Evidence: `web_server.py:6357-6368`.

## Run history — SUPPORTED

`GET /api/cron/jobs/{job_id}/runs?profile=<name>&limit=20` (limit clamped 1..100)

Evidence: `web_server.py:6220-6263`; DB query `hermes_state.py:2083-2147`.

Cron runs are ordinary sessions with id `cron_{job_id}_{timestamp}` and `source='cron'`.
Response:

```json
{ "runs": [ { ...session row..., "preview": "…", "last_active": 174..., "is_active": false,
              "archived": false, "profile": "default" } ], "limit": 20 }
```

Same row shape as `/api/sessions` rows. Full run transcript:
`GET /api/sessions/{run_session_id}/messages?profile=<name>` (see sessions-extra.md).

## Last output — PARTIAL

- Job-level summary fields on the job object: `last_run_at`, `last_status`, `last_error`,
  `last_delivery_error` (`cron/jobs.py:696-699`, updated in `mark_job_run` 915-965).
- Raw output text is written to `~/.hermes/cron/output/{job_id}/{YYYY-MM-DD_HH-MM-SS}.md`
  (`save_job_output`, `cron/jobs.py:1114-1139`).
- NOT FOUND: a dedicated REST endpoint serving those output files. Options:
  1. Read the run's transcript via `/api/sessions/{run_id}/messages` (the assistant's final
     message is the output) — this is what powers the desktop run-history view.
  2. Self-hosted only: the managed-files API can read the file directly:
     `GET /api/files/read?path=/Users/x/.hermes/cron/output/<job_id>/<ts>.md` returns
     `{name, path, size, mime_type, data_url}` (`web_server.py:1091-1121`). On hosted deployments
     the files root is locked to `/opt/data` and this path is forbidden (`web_server.py:961-971`, 1006-1007).

## Delivery targets (for the create/edit form) — SUPPORTED

`GET /api/cron/delivery-targets` →
`{"targets": [{"id": "local", "name": "Local (save only)", "home_target_set": true, "home_env_var": null}, ...]}`
Evidence: `web_server.py:6282-6307`.
