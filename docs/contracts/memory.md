# Wire contracts: memory / user profile

Verified against a local hermes-agent checkout on 2026-06-11.
REST server: `hermes_cli/web_server.py:6993-7091` (memory block).

## Summary

There is **NO per-entry memory CRUD REST surface**. The dashboard's memory REST API covers exactly
three operations: status, provider selection, and reset (file deletion). Built-in memory is two
markdown files on disk; provider-backed memory (plugins) has no REST read/write surface at all.

Comment at `web_server.py:6993-6997` confirms scope: "Selecting a provider only writes
config.memory.provider … The dashboard covers the common admin actions: … reset built-in memory
files."

---

## Status — SUPPORTED

`GET /api/memory`

Evidence: `web_server.py:7011-7043`.

```json
{
  "active": "" | "<provider name>",        // "" = built-in files
  "providers": [
    { "name": "mem0", "description": "…", "configured": true }
  ],
  "builtin_files": { "memory": 1234, "user": 567 }   // byte sizes; 0 = file absent
}
```

Built-in files live at `<HERMES_HOME>/memories/MEMORY.md` (agent memory) and
`<HERMES_HOME>/memories/USER.md` (user profile) — `web_server.py:7033-7037`.

## Set provider — SUPPORTED

`PUT /api/memory/provider` — body `{"provider": "mem0"}`; `""`, `"built-in"`, `"builtin"`, `"none"`
all mean built-in. 400 for unknown provider. Response `{"ok": true, "active": "<provider>"}`.
Evidence: `web_server.py:7046-7067`.

## Reset (delete files) — SUPPORTED

`POST /api/memory/reset` — body `{"target": "all" | "memory" | "user"}` (default `all`); 400 on
other values. Deletes `MEMORY.md` / `USER.md`. Response `{"ok": true, "deleted": ["MEMORY.md"]}`.
Evidence: `web_server.py:7070-7091`.

---

## List/read entries — NOT FOUND (no entry-level endpoint)

No `GET /api/memory/entries` or similar exists. The whole built-in memory is the raw markdown of
the two files.

**Self-hosted workaround (verified, but generic-files API, not a memory API):**

- Read: `GET /api/files/read?path=<abs path to MEMORY.md>` →
  `{"name", "path", "size", "mime_type", "data_url": "data:text/markdown;base64,…"}`
  (`web_server.py:1091-1121`). Max 100 MB (`_MANAGED_FILE_MAX_BYTES`, line 840).
- Write/edit: `POST /api/files/upload` body
  `{"path": "<abs path>", "data_url": "data:text/markdown;base64,…", "overwrite": true}`
  (`web_server.py:1124-1146`).
- Caveat: on hosted deployments the managed-files root is locked (env
  `HERMES_DASHBOARD_FILES_ROOT` or `/opt/data`) and paths outside it return 403
  (`web_server.py:961-971`, `1006-1007`). On a default self-hosted gateway `locked_root` is None
  and any absolute path is allowed (`web_server.py:971`).

## Edit / add / delete individual entries — NOT FOUND

No REST endpoint. Editing means rewriting the whole markdown file (workaround above), or letting
the agent do it through its own memory tools in a conversation.

## Timestamps — NOT FOUND

The memory REST surface exposes no timestamps (only byte sizes in `builtin_files`). File mtime is
not returned by `/api/memory`; `GET /api/files` directory listing entries are produced by
`_managed_file_entry` and can be checked if needed, but `/api/memory` itself has none.

## Provider-backed memory — explicitly no REST surface

When `active` is a plugin provider (e.g. mem0), there is no REST endpoint to list, read, add, edit
or delete its entries. The only REST controls are `GET /api/memory` (status) and
`PUT /api/memory/provider` (switch). Do not plan a memory-browser slice against provider-backed
memory.
