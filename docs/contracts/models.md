# Wire contracts: models (current model, options/pricing, switching, per-profile)

Verified against hermes source at `~/hermes-agent` on 2026-06-11.
REST server: `hermes_cli/web_server.py` (FastAPI). Payload builder:
`hermes_cli/inventory.py`. Provider rows: `hermes_cli/model_switch.py`.

---

## Current model / provider read — SUPPORTED

`GET /api/model/info`

Evidence: `hermes_cli/web_server.py:2524-2598`.

Response (200) — never errors, falls back to an empty shape (`_EMPTY_MODEL_INFO`,
lines 2514-2521, 2596-2598):

```json
{
  "model": "anthropic/claude-opus-4.7",
  "provider": "openrouter",
  "auto_context_length": 200000,
  "config_context_length": 0,
  "effective_context_length": 200000,
  "capabilities": {
    "supports_tools": true, "supports_vision": true, "supports_reasoning": true,
    "context_window": 200000, "max_output_tokens": 32000, "model_family": "claude"
  }
}
```

- Reads `model.default` (fallback `model.name`) + `model.provider` from the backend's own
  `config.yaml` (lines 2533-2546). `config_context_length` is the user override; `effective`
  is what the agent uses (2564-2569). `capabilities` is best-effort from models.dev
  (2571-2586) and may be `{}`.
- **No `profile` parameter** — this endpoint is bound to the profile the backend process runs
  as. Per-profile read: each entry of `GET /api/profiles` carries `model` + `provider`
  (`web_server.py:7845-7861`; see `docs/contracts/profiles.md`). The desktop gets per-profile
  values by routing the request to that profile's pooled backend
  (`apps/desktop/electron/main.cjs:540-546`; `getGlobalModelInfo` at
  `apps/desktop/src/hermes.ts:246-251`).

---

## Available model options (with pricing + capabilities) — SUPPORTED

`GET /api/model/options`

Evidence: `hermes_cli/web_server.py:2624-2655`; builder `build_models_payload` at
`hermes_cli/inventory.py:111-175`, called with `include_unconfigured=True, picker_hints=True,
canonical_order=True, pricing=True, capabilities=True, max_models=50` (web_server.py:2644-2652).

Response (200):

```json
{
  "providers": [ { …provider row… } ],
  "model": "<currently configured model id>",
  "provider": "<currently configured provider slug>"
}
```

Provider row fields (base shape: `hermes_cli/model_switch.py:1192-1199`):

- `slug` (string — the value to send back as `provider`), `name` (display),
  `is_current` (bool), `is_user_defined` (bool), `models` (string[], curated, ≤50),
  `total_models` (int), `source` (`"built-in"` | `"models.dev"` | `"user-config"` |
  `"hermes"` | `"canonical"` — see emit sites at model_switch.py:1410-1416, 1569-1575,
  1644-1650, 1733-1739).
- Picker hints (`inventory.py:243-278`): `authenticated` (bool, on every row). Unconfigured
  skeleton rows (`authenticated: false`, empty `models`) additionally carry `auth_type`,
  `key_env`, `warning` so the client can render a setup affordance.
- Pricing (`inventory.py:302-322`, best-effort, only for providers with live pricing —
  openrouter / nous / novita):

  ```json
  "pricing": { "<model id>": { "input": "$3.00", "output": "$15.00", "cache": "$0.30", "free": false } }
  ```

  Prices are **pre-formatted strings** ($/Mtok); `cache` may be `null`. Nous rows also get
  `free_tier` (bool) and `unavailable_models` (string[] — paid models a free-tier account
  cannot pick), inventory.py:315-318. Rows may simply lack the `pricing` key on failure
  (line 322).
- Capabilities (`inventory.py:178-211`): `capabilities: { "<model id>": { "fast": bool,
  "reasoning": bool } }` — gates the fast-toggle / reasoning-effort controls.

Errors: 500 `{"detail": "Failed to list model options"}` (web_server.py:2653-2655).

Gateway JSON-RPC equivalent: `model.options` (`tui_gateway/server.py:8377`) returns the same
shape; `model.save_key` at `tui_gateway/server.py:8417`.

### Recommended default for a provider — SUPPORTED

`GET /api/model/recommended-default?provider=<slug>`

Evidence: `web_server.py:2658-2727`. Response: `{"provider": str, "model": str,
"free_tier": bool | null}` — Nous-aware (free vs paid tier); other providers return their
first curated model; `model` may be `""` (degrade gracefully, lines 2668-2670).

### Auxiliary model slots — SUPPORTED

`GET /api/model/auxiliary` (`web_server.py:2730-2771`) →

```json
{
  "tasks": [ { "task": "vision", "provider": "auto", "model": "", "base_url": "" }, … ],
  "main": { "provider": "openrouter", "model": "anthropic/claude-opus-4.7" }
}
```

Canonical task slots (`web_server.py:2609-2621`): `vision, web_extract, compression,
skills_hub, approval, mcp, title_generation, triage_specifier, kanban_decomposer,
profile_describer, curator`.

---

## Switch the active model — SUPPORTED

`POST /api/model/set`

Evidence: `web_server.py:2774-2941`; request model `ModelAssignment` at 700-719.

Request body:

```json
{
  "scope": "main",                      // "main" | "auxiliary" (required)
  "provider": "openrouter",             // required for main; required for auxiliary
  "model": "anthropic/claude-opus-4.7", // required for main
  "task": "",                            // auxiliary only: slot name; "" = all slots; "__reset__" = reset all to auto
  "base_url": "",                        // optional, custom/local OpenAI-compatible endpoints (main slot)
  "confirm_expensive_model": false
}
```

Semantics (docstring at 701-707, handler 2782-2941):

- Writes `model.provider` + `model.default` (main) or `auxiliary.<task>.provider/.model`
  into the backend profile's `config.yaml`. **Applies to NEW sessions only** — a running chat
  session is not hot-swapped; use the `/model` slash command inside the chat for that
  (docstring 2776-2781).
- Expensive-model guard: if the model trips the cost guard and `confirm_expensive_model` is
  false, returns 200 with `{ "ok": false, "confirm_required": true, "confirm_message": "…" }`
  (lines 2794-2816) — re-POST with `confirm_expensive_model: true` to proceed.
- Main success response: `{ "ok": true, "scope": "main", "provider", "model", "base_url",
  "gateway_tools": [..], "stale_aux": [{task, provider, model}, ..] }` (2886-2894).
  `gateway_tools` lists tools auto-routed through the Nous gateway when switching to Nous
  (2835-2853); `stale_aux` lists auxiliary slots still pinned to a different provider so the
  UI can offer a "reset to main" nudge (2857-2884).
- Auxiliary responses: `{ok, scope: "auxiliary", reset: true}` for `task="__reset__"`
  (2901-2912) or `{ok, scope: "auxiliary", tasks: [..], provider, model}` (2930-2936).
- Errors: 400 for bad scope/missing fields/unknown task (2788-2789, 2819-2820, 2914-2920);
  500 `{"detail": "Failed to save model assignment"}` (2939-2941).

### Per-profile semantics

`POST /api/model/set` has **no profile parameter** — it always writes the backend process's
own profile config. To set the model for a *named* profile from a single backend:

`PUT /api/profiles/{name}/model` body `{ "provider": "...", "model": "..." }` — SUPPORTED.
Evidence: `web_server.py:8339-8356` (handler, `ProfileModelUpdate` at 7829-7831), writing via
the context-local `HERMES_HOME` override in `_write_profile_model` (7936-7953; clears stale
`base_url`/`context_length` like `/api/model/set` does). Response:
`{ "ok": true, "provider": "...", "model": "..." }`; 400 if either field is empty; 404 for
unknown profile. Client usage: `web/src/lib/api.ts:513` (`updateProfileModel`).

A model can also be assigned at profile creation time via `provider` + `model` on
`POST /api/profiles` (`web_server.py:7794-7795, 8100-8108` — best-effort, reported as
`model_set` in the create response).
