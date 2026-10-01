# Wire contracts: MCP connectors (servers, OAuth, catalog, test, status)

Verified against the hermes-agent tree at `v2026.9.24` (0.21.5) on 2026-10-01, and read-only
against the live gateway. Server files: `hermes_cli/web_routers/mcp.py`,
`hermes_cli/web_server_mcp.py`, `hermes_cli/web_models.py`, `tools/mcp_dashboard_oauth.py`,
`tui_gateway/methods_tools.py`. App modules: `src/api/mcp.ts` (REST), `src/api/mcpSession.ts` (RPC).

Design: `docs/superpowers/specs/2026-10-01-mcp-connectors-design.md`.

---

## REST

Every route accepts the cookie session. Every route except the flow and callback routes takes an
optional `?profile=`.

### List servers — `GET /api/mcp/servers`

```json
{ "servers": [ {
  "name": "linear", "transport": "http", "url": "https://mcp.linear.app/mcp",
  "command": null, "args": [], "env": {}, "auth": "oauth", "enabled": true,
  "tools": null, "source": "config", "plugin": null
} ] }
```

- Sorted by name. `transport` is `http`, `stdio` or `unknown`.
- `auth` is `oauth`, `header`, or null. `env` values are redacted by the gateway.
- `tools` is the tool filter as configured (a list or an object), or null for all. It is **not** a
  tool count.
- There is **no sign-in state** here. Use the test RPC.
- This is not the RPC `McpServerSummary` shape (`env` there is a list of key names).

### Add a server — `POST /api/mcp/servers`

Body for a remote server: `{name, url, auth, bearer_token?}`.

- `auth` is `none`, `header` or `oauth`. `header` requires `bearer_token`; any other mode rejects it.
- The token is written to the profile's `.env`; `config.yaml` gets only a header template.
- Returns the server summary.
- 400 with a reason (validation), 409 (name exists, or provided by a plugin), 422 (malformed body).
- The 400 reason is `str(exc)` from the gateway. The app never trusts it to be free of the token:
  `src/api/mcp.ts` replaces any message that echoes a submitted value (as typed, trimmed, or
  without a leading `Bearer `). A value echoed in a transformed form (URL-encoded, JSON-escaped,
  case-changed) is not recognised.

### Remove — `DELETE /api/mcp/servers/{name}`

`{ok: true}`. 404 unknown, 409 plugin-provided.

Removing deletes only the `config.yaml` entry (`mcp_config._remove_mcp_server`). The server's
OAuth tokens and any token in `.env` stay on the gateway; the app's confirmation says so.

### Enable or disable — `PUT /api/mcp/servers/{name}/enabled`

Body `{enabled}`. Returns `{ok, name, enabled}`. The server stays in the config when off.
404 unknown, 409 plugin-provided.

### Names in paths

Routes use `{name}`, not `{name:path}`. A name containing `/` cannot be addressed over REST.

### Start OAuth — `POST /api/mcp/servers/{name}/auth`

Returns a flow: `{flow_id, server_name, status, authorization_url, error}`.

- The gateway waits **up to 30 s** for the authorization URL before answering, so the app allows
  45 s and always sends a fast request first (a slow request must not carry a token rotation; the
  gateway writes rotated cookies only when the handler returns).
- `status` is `starting`, `authorization_required`, `approved` or `error`.
- 404 unknown server, 400 stdio or header-auth server, 409 when a flow for this server is already
  running or the server is provided by a plugin, 429 when 8 flows are live (the app shows its
  fixed 429 text).
- A flow that ended with `error` and was **not cancelled** can be reopened by the gateway when its
  worker retries; it then holds the per-server slot for up to 5 minutes. So the app cancels every
  flow it stops without approval.

### Flow status — `GET /api/mcp/oauth/flows/{flow_id}`

The flow, plus `tools: [{name, description}]` once approved. 404 when the flow has expired
(15 minutes) or the gateway restarted (flows are in memory).

While the gateway exchanges the code and connects, the status stays `authorization_required`.

### Cancel — `DELETE /api/mcp/oauth/flows/{flow_id}`

`{ok: true, status}`. Idempotent. `status` is the flow's status **after** the cancel: `approved`
means the sign-in had already succeeded; `expired` means the flow no longer exists.

### Callback — `GET /api/mcp/oauth/callback/{server_name}`

Public (no cookie): it is on the gate's public-prefix list and is matched by `state`. The provider
redirects the browser here.

The redirect URI is the server's own `oauth.redirect_uri` when its config has one; otherwise
`HERMES_DASHBOARD_PUBLIC_URL` / `dashboard.public_url` plus the callback path; otherwise it is
rebuilt from the request (`base_url` + `X-Forwarded-Prefix`). The app refuses to open an
authorization URL whose `redirect_uri` does not come back to the gateway address it uses
(`checkAuthorizationUrl` in `src/lib/mcp.ts`).

A provider that restricts client registration to an allow list refuses that redirect URI until it
is added. The gateway passes the refusal through, both from the OAuth start and from
`mcp.servers.test`, as `Registration failed: <status> <body>`. Seen on 2026-10-01 from Cloudflare
Access: `Registration failed: 400 {"error":"invalid_client_metadata","error_description":"redirect_uri
is not allowed by the account configuration"}`. The app puts it into words and shows the address
to allow (`explainOauthRefusal`, `oauthRedirectAddress` in `src/lib/mcp.ts`). With the callback path
allowed there (`<gateway>/api/mcp/oauth/callback/*`), the sign-in completed on the device, and the
redirect was rebuilt with the `https` scheme without `HERMES_DASHBOARD_PUBLIC_URL`.

### Catalog — `GET /api/mcp/catalog`

`{entries, diagnostics}`. Entry fields the app uses: `name`, `description`, `connector_slug`,
`source`, `transport`, `auth_type` (`oauth`/`none`/…), `required_env: [{name, prompt, required}]`,
`url`, `needs_install`, `installed`, `enabled`.

- `required_env` does **not** say whether a variable is a secret. The gateway decides that itself.
- Live on 2026-10-01: 65 entries, all `http`, none with `needs_install`; 55 `oauth`, 10 `none`; two
  with `required_env` (`asana`, `n8n-official`).

### Install a catalog entry — `POST /api/mcp/catalog/install`

Body `{name, env, enable}`. Returns `{ok, name, background}`.

- `env` may contain only variables the entry declares (400 otherwise). 404 for an unknown entry.
- Secret values are written to `.env` **before** the entry is installed, so a failed install can
  leave them there. A value the entry does not mark as secret (for example a server URL) is written
  into `config.yaml` instead.
- The server is saved as `mcp_servers.<entry name>`: an install is named after its entry.
- **It does not reject an entry that is already configured — it overwrites it** and switches it
  back on. `installMcpCatalogEntry` therefore reads the server list first and refuses
  (`McpAlreadyAddedError`) when the name exists.
- **It is slow.** After saving the entry the gateway connects to the server to list its tools
  (`mcp_catalog._apply_tool_selection`), which can take about 40 s; a failed probe does not fail
  the install. The app sends a fast request first and allows 45 s, like the OAuth start. Because
  the entry is saved before the probe, a lost answer is settled by reading the catalog again.
- A required variable that is missing fails the install with a 400 that names it.

---

## RPC (over the chat WebSocket)

### `mcp.servers.test` `{profile?, name}`

`{ok, tools, error?, prompts?, resources?, oauth_needed, oauth_tokens_present?}`.

- Really connects, lists tools and disconnects. It runs on the gateway's RPC pool
  (`_LONG_HANDLERS`), so a slow server does not stall the socket.
- For an `auth: oauth` server with no token on disk it answers `ok: false` with
  `oauth_tokens_present: false`.
- Error code 4064 when the server is unknown.
- `error` is the raw exception text. Unlike the REST test route, the gateway does **not** redact
  it, and a connection error can echo a server URL that carries a key in its query string. The app
  shows it on screen and never logs it or offers to copy it.
- The app uses this instead of the REST test route (`POST /api/mcp/servers/{name}/test`), which is
  slow and would ride the cookie path.

### `mcp.servers.status` `{profile?}`

`{servers: [{name, transport, tools, connected, disabled, status, source, plugin}], checked_at}`.

- From cached state; never connects. `tools` is a count.
- `status`: `connected`, `disabled`, `connecting`, `failed`, `lazy`, `configured`.
- Runtime state is reported for the gateway's launch profile. Under a multiplexed gateway (one
  that has served a profile-scoped RPC) it is the scoped profile's own view. Otherwise a
  non-launch profile's rows read `configured` or `disabled`.

### `reload.mcp` `{session_id?, confirm?, always?}`

`{status, message?, turn_isolation?, …}`. Tears down and reconnects every MCP server on the gateway
and refreshes the tools of every live session; the prompt cache of each is invalidated, so the next
message in each chat re-sends the whole conversation.

- This is how a connector added, switched or removed from the app reaches the running gateway
  (see "When a change takes effect"). The Connectors list offers it as "Reload now" after an alert.
- The app always sends `confirm: true` (it has asked already) and `session_id` when the chat has
  a live session. Without `confirm`, and while the gateway's `approvals.mcp_reload_confirm` is on,
  the answer is `status: "confirm_required"`.
- The app **never** sends `always`: it writes a permanent opt-out to the gateway's `config.yaml`.
- For a session on a compute host the gateway reloads only that host and answers
  `{status: "reloaded", turn_isolation: true}`.
- It runs on the gateway's RPC pool (`_LONG_HANDLERS`). The chat socket's request timeout is
  120 s; a call that does not come back is reported as "unknown", not as a failure.

---

## When a change takes effect

Read from `hermes_cli/mcp_startup.py` (`start_background_mcp_discovery`): discovery runs once per
profile and is started again for a new session only when **no** server is connected or lazily
registered. With at least one such server, a newly added server is loaded by `reload.mcp` or a
gateway restart. After an
OAuth sign-in the gateway reconnects the server only if it is already loaded
(`tools/mcp_tool_loop.py`, `reconnect_mcp_server`) and the flow belongs to the gateway's launch
profile (`reconnect_live` in `web_routers/mcp.py`).

Observed on the live gateway on 2026-10-01 (it had one connected server): a catalog entry added
from the app read `configured` ("Not loaded yet") until `reload.mcp`, then `connected`. After it
was removed, a second reload returned the gateway to its starting state.

The `tools` count in a status row is what the gateway registered for the agent, which is more
than the server's own tool list: a server whose test listed 3 tools read 7, and one with 4 read 8.
Four more in both cases is consistent with the gateway registering its own helper tools for a
server's prompts and resources; that was not confirmed in its source.
