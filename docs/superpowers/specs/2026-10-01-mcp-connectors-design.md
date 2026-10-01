# MCP connectors (remote servers) — design

- **Date:** 2026-10-01
- **Status:** Revision 2, for Gianluca's review. The design conversation is approved (decisions 1a,
  2a, 3b below); this written spec is not yet approved. Revision 2 incorporates an adversarial
  review (no blocker, 7 major, 15 minor; recorded in
  `docs/research/2026-10-01-mcp-connectors-spec-review.md`, cited as `review n`).
- **Author:** gldc (with Claude)
- **Repo:** `gldc/hermes-mobile-app` only. No gateway or plugin change is needed.
- **Evidence:** read from the gateway tree at `v2026.9.24` (0.21.5, the live version) and checked
  read-only against the live gateway on 2026-10-01:
  - `hermes_cli/web_routers/mcp.py` (the REST routes), `hermes_cli/web_server_mcp.py` (add
    validation, OAuth worker), `hermes_cli/web_models.py` (request bodies);
  - `tools/mcp_dashboard_oauth.py` (the OAuth flow object and its states);
  - `hermes_cli/dashboard_auth/middleware.py` and `prefix.py` (which paths skip the login gate, when
    rotated cookies are written, how the callback URL is built);
  - `tui_gateway/methods_tools.py` (`reload.mcp`, `mcp.servers.*`), `tools/mcp_tool_discovery.py`
    (runtime status);
  - `src/vendor/hermes-gateway/gateway-contract.generated.ts` (the RPC types).

  No upstream client was found that drives the REST OAuth routes: the desktop app uses the RPC
  flow. The gateway's own dashboard page is the intended caller and was not read. The first real
  sign-in is therefore the proof of §5.6 (§10 R1).

## 1. Intent

**What Gianluca asked for:** add and manage MCP connectors from the app. Remote MCP servers come
first; local stdio servers are deferred.

**His decisions (2026-10-01):**

- **1a.** Adding covers both the gateway's catalog and a custom URL.
- **2a.** Face ID is required only when the app sends a secret (a bearer token or a catalog
  credential). Removing a connector needs a plain confirmation.
- **3b.** Changes apply to new chats, and the screen also offers to reload connectors for the chats
  that are open now.

**Success:** from his phone, on the tailnet, he can:

- see the connectors configured on the gateway and whether each one is working;
- add a catalog connector (for example Linear) and sign in through OAuth without leaving the app;
- add one of his own servers by URL, with no auth, a bearer token, or OAuth;
- turn a connector off and on, test it, see its tools, sign in again, and remove it;
- make the change take effect in the chat he is in, without restarting the gateway.

His on-device QA is the gate.

**Assumptions (flagged for correction):**

- The gateway is 0.21.5 or later (§8 covers an older one).
- The app talks to the gateway at an `https://` MagicDNS name (today
  `https://hermes.kite-opah.ts.net`). OAuth is refused otherwise (§5.6).
- iOS is the target. Android differences are noted in §5.6.

## 2. What the gateway provides

### 2.1 REST

All routes accept the app's existing cookie session, so they work through `withAuthRetry` like the
Skills and Cron screens. Every route except the three flow and callback routes takes an optional
`?profile=`.

| Route | Purpose | Notes |
| --- | --- | --- |
| `GET /api/mcp/servers` | Configured servers | `{servers: [...]}`, sorted by name. Each has `name`, `transport` (`http`, `stdio` or `unknown`), `url`, `command`, `args`, `env` (redacted), `auth` (`oauth`/`header`/null), `enabled`, `tools` (tool filter or null), `source` (`config`/`plugin`), `plugin`. No sign-in state and no tool count. |
| `POST /api/mcp/servers` | Add one server | Body `{name, url, auth, bearer_token?}` for a remote server. `auth` is `none`, `header` or `oauth`. `header` requires `bearer_token`; the token goes to the profile's `.env` and only a header template is written to `config.yaml`. 409 when the name exists or belongs to a plugin; 400 with a reason when validation fails; 422 for a malformed body. |
| `DELETE /api/mcp/servers/{name}` | Remove | 404 unknown, 409 plugin-provided. |
| `PUT /api/mcp/servers/{name}/enabled` | Turn on or off | Body `{enabled}`. The server stays in the config when off. |
| `POST /api/mcp/servers/{name}/auth` | Start OAuth | Returns a flow `{flow_id, server_name, status, authorization_url, error}`. The gateway waits up to 30 s for the authorization URL before answering. 404 unknown server, 400 for a stdio or header-auth server, 409 if a flow for this server is already running, 429 when 8 flows are already live. |
| `GET /api/mcp/oauth/flows/{id}` | Flow status | Same shape plus `tools` once approved. `status` is `starting`, `authorization_required`, `approved` or `error`. 404 when the flow has expired (15 min) or the gateway restarted. |
| `DELETE /api/mcp/oauth/flows/{id}` | Cancel a flow | Idempotent. Returns the flow's status after the cancel, which is `approved` if it had already succeeded. Frees the per-server slot. |
| `GET /api/mcp/oauth/callback/{name}` | OAuth redirect target | Public (no cookie needed); it matches the flow by `state` and returns a small HTML page. Verified live: an unauthenticated request reaches the handler. |
| `GET /api/mcp/catalog` | Curated catalog | `{entries, diagnostics}`. Live gateway: 65 entries, all remote HTTP, none needing a local install; 55 use OAuth and 10 need no auth. Two entries declare `required_env` (Asana: client id and secret; n8n: server URL). Each `required_env` item has `name`, `prompt`, `required`; it does not say whether the gateway treats the value as a secret. Each entry carries `installed` and `enabled` for the profile. |
| `POST /api/mcp/catalog/install` | Add a catalog entry | Body `{name, env, enable}`. `env` may contain only the entry's declared variables. Secret values are written to `.env` before the entry is installed, so a failed install can leave them there. 404 for an unknown entry. |

A REST test route exists too (`POST /api/mcp/servers/{name}/test`). The app does not use it (§4).

### 2.2 RPC, over the chat WebSocket

Types come from the vendored contract.

- **`mcp.servers.test`** `{profile?, name}` connects, lists tools and disconnects. It runs on the
  gateway's RPC pool, so a slow server does not stall the socket. Result: `{ok, tools, error?,
  prompts?, resources?, oauth_needed, oauth_tokens_present?}`.
- **`mcp.servers.status`** `{profile?}` returns one row per configured server from cached state
  (it never connects): `status` is `connected`, `disabled`, `connecting`, `failed`, `lazy` or
  `configured`, plus `tools` (a count). Runtime state is reported only for the gateway's launch
  profile; for another profile every row reads `configured` or `disabled`.
- **`reload.mcp`** `{session_id?, confirm?, always?}` tears down and reconnects every MCP server and
  refreshes the tool list of every live session. The next message in each chat re-sends the full
  conversation because the prompt cache is invalidated. Without `confirm`, and while the gateway's
  `approvals.mcp_reload_confirm` is on, it answers `confirm_required`. `always` writes an opt-out to
  the gateway's `config.yaml`. For a session on a compute host it reloads only that host and
  answers `{status: 'reloaded', turn_isolation: true}`.

**What the live gateway has today:** one server, `youtube-transcript`, which is stdio.

## 3. Scope

**In (v1):**

- A Connectors screen listing every configured server, with an on/off switch and a status line.
- A detail screen: test, tool list, sign in (OAuth), remove.
- Add from the catalog, including OAuth sign-in and the two entries that need credentials.
- Add a custom remote server by URL with no auth, a bearer token, or OAuth.
- "Reload now" for the open chats.
- Existing stdio servers are shown, and can be switched and tested. They cannot be added, edited
  or removed from the app (a removed stdio server could not be re-added from the phone).
- Plugin-provided servers are shown read-only with Test; the gateway rejects changes to them.

**Out (deferred):**

- Adding or editing stdio servers.
- Choosing individual tools of a server.
- Editing a server's URL or auth, and replacing a stored bearer token. Remove and re-add instead.
  (The only REST edit is a whole-map replace, which is too blunt for a phone form.)
- Brand icons and the desktop's composer suggestions.

## 4. Approach

**Chosen: REST for configuration and OAuth; RPC over the active chat's socket for Test, runtime
status and reload.**

- **Configuration over REST** (list, add, install, switch, remove, catalog) matches the other
  management screens (`src/api/skills.ts`, `cron.ts`) and works without a chat.
- **OAuth over REST** because it is the only flow whose redirect a phone can complete: the provider
  sends the browser to the gateway's own HTTPS callback. The RPC flow redirects to a loopback
  address on the client or on the gateway machine, which a phone's browser cannot reach, and most
  providers reject a custom-scheme redirect.
- **Test over RPC**, not REST, for two reasons (`review 1, 2`):
  - A test really connects and can take a minute. The gateway writes a rotated refresh token back
    only when the handler returns, so a slow REST request that the app gives up on can lose the new
    token; that is the known cause of a revoked pairing. The socket carries no cookies.
  - REST requests queue behind each other whenever the access token's expiry is unknown (after
    every cold start), so a slow test would hold up the list, the switches and chat reconnect.
- **Reload and status** exist only as RPCs.
- The RPCs go through the chat that is open underneath the screen, the way the Models screen
  switches a chat's model (`src/session-model-store.ts`). The Connectors screen is reached from
  the sidebar, which exists only over a chat, so a chat is normally there.

**Rejected: RPC for everything.** OAuth cannot complete (above), and the whole screen would stop
working while the chat socket reconnects.

**Rejected: a second WebSocket for management.** It adds a second ticket and reconnect lifecycle for
three calls.

## 5. Design

### 5.1 Navigation

- Sidebar: a **Connectors** item after Skills, pushing `/connectors`.
- Routes (ordinary stack pushes with the native header, like Skills; each exports the
  `RouteError` boundary; none needs registering in `_layout.tsx`):

| Route file | Screen |
| --- | --- |
| `src/app/connectors.tsx` | List |
| `src/app/connectors/server/[name].tsx` | Server detail |
| `src/app/connectors/add.tsx` | Catalog browser, with a "Custom server" row at the top |
| `src/app/connectors/catalog/[name].tsx` | Catalog entry |
| `src/app/connectors/custom.tsx` | Custom server form |

- Server names sit under `server/` and `catalog/` so a server called `add` or `custom` cannot
  collide with a route.
- After a successful add, the app returns to the list and pushes the new server's detail, so Back
  from the detail lands on the list, not on the form.
- `hermesmobileapp://connectors` opens the list for simulator screenshots.

### 5.2 Connectors list

- Loads `GET /api/mcp/servers` on focus; pull to refresh.
- Each row shows:
  - the name;
  - the URL's host for a remote server, or the command with a "Local" badge for stdio;
  - an auth badge: "OAuth", "Token", or none;
  - a "Plugin" badge when `source` is `plugin`;
  - a status line when runtime status is available (§5.8);
  - the on/off switch (hidden for plugin servers).
- The switch is optimistic and reverts on failure, like the Skills switch.
- The header has a `+` button to `/connectors/add`.
- Empty state: "No connectors yet" with an Add button.
- With more than one profile, the header shows which profile the list belongs to (§5.10).
- After any change, a banner appears (§5.7).
- A server whose name contains `/` (possible only by editing the gateway config by hand) is listed
  but cannot be managed: the gateway's routes cannot address it. Its row says so.

### 5.3 Server detail

- Shows name, URL (selectable) or command, auth kind, enabled switch.
- **Test connection** (`mcp.servers.test`):
  - runs automatically when the detail of a remote server opens (config or plugin), and on demand
    for any server; stdio servers are tested only on demand, because a test starts the process on
    the gateway;
  - shows a spinner, then either the tools (name and description) with prompt and resource
    counts, or the gateway's error text;
  - is disabled, with the reason shown, while no chat socket is connected;
  - only the latest test counts: a result that arrives after a newer test or a sign-in started is
    dropped.
- **Sign in:** shown when `auth` is `oauth` on a config server. Runs §5.6.
  - The label is "Sign in again" when the last test reported `oauth_tokens_present: true`, and
    "Sign in" otherwise, including while a test is pending or unavailable.
  - A successful sign-in replaces the test result with the tools the flow returned.
- **Remove:** remote config servers only. A confirmation alert, then `DELETE`, then back to the
  list.
- What each kind of server allows:

| Server | Switch | Test | Sign in | Remove |
| --- | --- | --- | --- | --- |
| Remote, config | yes | yes, automatic | if `auth` is `oauth` | yes |
| stdio, config | yes | yes, on demand | no | no |
| Plugin-provided, remote | no | yes, automatic | no | no |
| Plugin-provided, stdio | no | yes, on demand | no | no |
| `transport: unknown` | yes | no | no | no |

### 5.4 Add from the catalog

- `/connectors/add` loads `GET /api/mcp/catalog` and lists entries whose `transport` is `http` and
  `needs_install` is false, sorted by name, with header search over name and description.
  Entries already installed show "Added" and open the server detail instead.
- The entry screen shows the description, the server URL (so he can see where the agent will
  connect), the auth type, and the entry's `source` as a link when it is an `https://` URL.
- If the entry declares `required_env`, the screen shows one field per variable with the
  gateway's prompt text. Fields marked `required` must be filled; blank optional fields are left
  out of the request. These values are handled as secrets (§5.9).
- **Add** sends `POST /api/mcp/catalog/install` with `{name, env, enable: true}`.
  - For an OAuth entry the app then starts sign-in (§5.6) straight away.
  - When sign-in finishes, or for a no-auth entry, the app opens the server detail.
  - If sign-in is cancelled or fails, the connector stays configured. Its detail screen shows the
    Sign in and Remove buttons. The app does not silently roll back.
- If the install request fails or times out, the app re-reads the catalog before allowing another
  attempt, because the entry may have been installed. When credentials were sent, the error also
  says they may already be stored on the gateway.
- The app finds the new server by re-reading the server list. It expects the server's name to be
  the entry's name (§10 R7).

### 5.5 Add a custom server

- Fields: **Name**, **URL**, **Authentication** (None / Bearer token / OAuth), and **Token** when
  Bearer token is chosen.
- Client-side checks, before any request:
  - name is not empty and has no spaces or slashes; a name is suggested from the URL's host;
  - URL parses and is `https://` or `http://`; `http://` shows a caution that traffic between the
    gateway and that server is not encrypted;
  - a token is present when Bearer token is chosen.
- The gateway does the real validation; its 400 and 409 reasons are shown next to the form.
- **Add** sends `POST /api/mcp/servers`:
  - None: `{name, url, auth: "none"}`;
  - Bearer token: Face ID first, then `{name, url, auth: "header", bearer_token}` (§5.9);
  - OAuth: `{name, url, auth: "oauth"}`, then sign-in (§5.6).
- If the request times out, the app re-reads the server list before allowing another attempt; a
  second attempt would otherwise fail with "already exists".

### 5.6 OAuth sign-in

The gateway runs the OAuth client (discovery, registration, PKCE, token exchange). The app only
shows the provider's page and waits.

**Before starting:** if the app's gateway URL is not `https://`, sign-in is refused with an
explanation; providers do not accept a plain-HTTP redirect.

**Sequence:**

1. A fast request first (`GET /api/mcp/servers`), then `POST /api/mcp/servers/{name}/auth` with a
   45 s limit (§6.1 explains the pairing).
   - `status: error`: cancel the flow (rule A below), show the gateway's error. Stop.
   - `status: approved` with no URL: already signed in. Go to step 4. (The gateway takes its full
     30 s in this case, so the screen shows progress throughout.)
   - `status: authorization_required`: check the URL (rule B), then continue.
   - The request times out: the app holds no flow id and cannot cancel. It says so, and that a
     retry may be refused for up to 5 minutes.
2. Open the URL in the in-app browser (`expo-web-browser`, `openBrowserAsync`; already a
   dependency).
3. While the browser is open, poll `GET /api/mcp/oauth/flows/{id}` every 2 s.
   - `approved`: close the browser (`dismissBrowser`). Go to step 4.
   - `error`: close the browser, show the error.
   - `starting`, or `authorization_required` with the same URL: keep polling.
   - `authorization_required` with a different URL: the gateway restarted the attempt and the open
     page can no longer complete. Close the browser, cancel, and ask him to try again.
   - 404: close the browser and report that sign-in expired.
   - `AuthError`: close the browser, then handle it as everywhere else (§8).
   - Any other failed poll (network, 5xx) is retried on the next tick.
4. On approval, show the tools the flow returned and mark that a reload is pending (§5.7).

**Rule A: every exit except approval cancels the flow.** Whenever the app holds a flow id and stops
without an `approved` status, it sends `DELETE /api/mcp/oauth/flows/{id}`. Without this, a flow
that failed its first attempt can be reopened by the gateway and block the server for 5 minutes
(`review 3`). If the DELETE answers `approved`, the sign-in had already succeeded and the app
treats it as approved (`review 4`).

**Rule B: check the authorization URL before opening it.** The URL comes from the remote server by
way of the gateway.

- It must be `https://`.
- Its `redirect_uri` parameter must start with `<gateway URL>/api/mcp/oauth/callback/`. If it does
  not, the redirect would not reach the gateway from the phone; the app cancels and reports that
  the gateway's public URL is misconfigured, naming `HERMES_DASHBOARD_PUBLIC_URL` (§10 R1).

**When he closes the browser himself:** the gateway keeps reporting `authorization_required`
while it exchanges the code and connects, and its page tells him to close the tab. So closing the
tab must not cancel a sign-in that is about to succeed.

- The app keeps polling for up to 60 s, showing "Finishing sign-in…" with a Cancel button.
- If the flow is still not approved after that, or he taps Cancel, the app cancels (rule A) and
  reports "Sign-in cancelled".
- After a cancel the detail screen runs a test, so a sign-in that did complete on the gateway
  still shows as signed in.

**Time limits:** the gateway waits 5 minutes for the redirect; the app stops after 6 minutes.
Every limit is checked only after a poll, so returning from another app (an authenticator, a
password manager) always polls first and never cancels a flow that finished in the meantime.

**Leaving the screen** while a sign-in is running cancels it (rule A).

**A flow already running** (409): the app reports the gateway's message. It cannot cancel a flow
whose id it does not know; that flow ends by itself within 5 minutes. If the 409 follows the app's
own cancel, the app retries once after 2 s, since the gateway may still be winding the old flow
down.

**Android:** the Custom Tab cannot be closed by the app. He closes it; polling continues when the
app returns to the foreground, with the same 60 s rule.

**Browser session:** the in-app browser does not share Safari's cookies, so he signs in to the
provider inside it.

### 5.7 Applying changes (decision 3b)

- A successful add, install, switch, remove or sign-in sets an in-memory "reload pending" flag.
  The flag survives leaving the chat; it is cleared by a successful reload, by disconnecting from
  the gateway, and by an app restart.
- While the flag is set, the list shows a banner: "Changes apply to new chats. Reload to use them
  in the chats that are open now." with a **Reload now** button.
- **Reload now** shows an alert first. It says that reloading:
  - reconnects every connector for every open chat on the gateway, including a chat that is in
    the middle of a turn on another device;
  - makes the next message in each chat re-send the whole conversation, so that message costs
    more.
- On confirm the app calls `reload.mcp` with `{confirm: true}` plus `session_id` when the chat has
  a live session (a new chat has none; the gateway accepts that).
- The app never sends `always`, because it would write a permanent opt-out to the gateway's
  `config.yaml` (the same rule as "Always allow" on approvals).
- The button is disabled, with the reason shown, when:
  - no chat socket is connected (the chat is reconnecting, or the screen was opened by deep link);
  - a turn is running in the active chat.
- Outcomes:
  - `reloaded`: the flag clears, the list and status refresh, and the banner is replaced by a
    short "Reloaded" note.
  - `reloaded` with `turn_isolation: true`: the note says only this chat was reloaded.
  - An RPC error: the gateway's message is shown and the flag stays.
  - The socket drops during the call: the result is unknown. The app says so, keeps the flag, and
    refreshes status once the socket is back.
- The chat socket's request timeout is 120 s; a reload that takes longer is reported as unknown.

### 5.8 Runtime status

- When a chat socket is connected **and** the list is for the gateway's own profile (no explicit
  profile selected), the list calls `mcp.servers.status` after each load and merges rows by name.
  The detail screen shows the same line. For another profile the gateway reports no runtime state,
  so no status line is shown.
- Status line per row:

| `status` | Line |
| --- | --- |
| `connected` | Connected · N tools |
| `lazy` | Ready · N tools |
| `connecting` | Connecting… |
| `failed` | Failed |
| `disabled` | Off |
| `configured` | Not loaded yet |

- When the switch and the running gateway disagree (switched off but still `connected` or `lazy`;
  switched on but `disabled`), the line ends with "· changes after reload".
- When status is unavailable, rows have no status line. Test on the detail screen still gives a
  definite answer.

### 5.9 Secrets

The bearer token and every catalog `required_env` value follow the secure-entry rules in
`AGENTS.md`.

- **One component owns the values.** `ConnectorSecretForm` renders the secret fields and the
  submit button and keeps the values in its own local state, like `SecureEntryForm`. On submit it
  runs Face ID, then calls `onSubmit(values)`. The screen's `onSubmit` builds the request from
  that argument and returns the outcome. The screen never stores the values, and they never go
  into route params, a module store, a ref, an error, storage, `console.*`, analytics or push.
- **Face ID** (device-passcode fallback, `confirmWithBiometrics`) runs immediately before the
  request. A failed or cancelled check sends nothing and leaves the form as it is.
- **Masking.** Fields are masked by default (`secureTextEntry`). A catalog field is shown as plain
  text only when its name ends in `_URL`, `_HOST` or `_ID`. Face ID and the no-storage rule apply
  to plain fields too.
- All fields set `textContentType="none"`, `autoComplete="off"`, `autoCorrect={false}`,
  `spellCheck={false}` and no autocapitalise, so iOS never offers to save or learn the value.
- The form says where the value goes: it is sent to his gateway and stored there, and the app does
  not keep it.
- **Errors are cleaned where the secret is.** `addMcpServer` and `installMcpCatalogEntry` catch any
  error from a request that carried secret values and rethrow a new one. If the gateway's text
  contains a submitted value (as typed, trimmed, or without a leading `Bearer `; values shorter
  than 4 characters are not searched for), the new error carries only a fixed message for the
  status code. Nothing unredacted leaves those functions.
- The form clears its values on success; on failure they stay so he can retry.
- `withAuthRetry` re-runs the request closure once after a silent re-login. The value stays in
  memory for that retry only, and a 401 is answered before the gateway's handler runs, so nothing
  is written twice.
- Tests assert that the value never appears in a thrown error, a log, or any store.

### 5.10 Profiles

- Requests carry `?profile=<name>` (and RPCs carry `profile`) when the profile store has an
  explicit selection, and nothing otherwise (the gateway then uses its own profile). This is the
  rule the session list already follows.
- Flow status and cancel calls are keyed by flow id and take no profile.

## 6. Modules

| File | Responsibility |
| --- | --- |
| `src/api/mcp.ts` | REST calls and their types: `listMcpServers`, `addMcpServer`, `removeMcpServer`, `setMcpServerEnabled`, `startMcpOauth` (the fast request, then the 45 s POST), `getMcpOauthFlow`, `cancelMcpOauthFlow`, `listMcpCatalog`, `installMcpCatalogEntry`. Takes a `Pick<RestClient, …>` like `skills.ts`. Declares its own REST types: the REST server shape differs from the contract's RPC `McpServerSummary`. Owns the secret-error cleaning of §5.9. |
| `src/api/mcpSession.ts` | The three RPCs over an injected `call`, shaped like `sessionModel.ts`: `testMcpServer`, `mcpServerStatus`, and `reloadMcp` returning `reloaded` (with `thisChatOnly`), `unknown`, or `error` (with a message). |
| `src/lib/mcp.ts` | Pure logic: catalog filter and sort, `suggestServerName(url)`, `validateCustomServer`, `serverCapabilities(server)` (the table in §5.3), `authLabel`, `statusLine(server, row)`, `isPlainEnvField(name)`, `containsSecret(message, values)`, `connectorErrorMessage(error, action)` (the table in §8), `checkAuthorizationUrl(url, baseUrl)` (rule B). |
| `src/lib/mcp-oauth.ts` | `runOauthSignIn(deps)`: the §5.6 sequence with injected `start`, `poll`, `cancel`, `openBrowser`, `dismissBrowser`, `sleep`, `now`, plus `onPhase` (`starting`, `browser`, `finishing`) and `isCancelled()`. Returns `approved` (with tools), `cancelled`, or `error` (with a message); an `AuthError` passes through after the browser is closed. |
| `src/session-mcp-store.ts` | Module store like `session-model-store.ts`. The active chat publishes `{connected, streaming, sessionId, test, status, reload}`. A chat clears the target only if the target is still its own, so two chat screens that overlap during a transition cannot clear each other's. Also holds the "reload pending" flag. |
| `src/app/chat/[id].tsx` | Publishes the target above, next to the existing model target. `connected` follows the chat's `ready` state. |
| `src/components/connector-secret-form.tsx` | `ConnectorSecretForm` (§5.9), used by the custom form and the catalog entry screen. |
| `src/components/connector-sign-in.tsx` | `useConnectorSignIn(name)`: runs `runOauthSignIn` with the real browser and REST client, exposes the phase and a cancel function, and cancels on unmount. Used by the detail, catalog entry and custom screens. |
| `src/app/connectors*.tsx` | The five screens in §5.1. Glue only. |
| `src/components/sidebar.tsx` | The Connectors nav item; `src/lib/icon-map.ts` gets its icon. |
| `docs/contracts/mcp.md` | The REST and RPC surface as verified, like the other contract notes. |
| `AGENTS.md` | Architecture entries for the new files. |

### 6.1 REST client change: one slow request

`RestClient` caps every request at 20 s. Starting OAuth can take longer: the gateway waits up to
30 s for the authorization URL, and if the app gives up first it never learns the flow id and
cannot cancel the flow.

- The generic verbs gain an optional `{timeoutMs}`. `MAX_REQUEST_TIMEOUT_MS = 45_000` bounds it;
  larger values are clamped.
- The load-time invariant becomes `AT_FRESH_MARGIN_MS > MAX_REQUEST_TIMEOUT_MS` (60 s > 45 s). A
  request that starts with more than 60 s of access-token life still reaches the gateway before
  that life runs out.
- **A slow request must not carry a token rotation.** The gateway writes rotated cookies back only
  when the handler returns, so an aborted slow request would strand the app on the old refresh
  token. `startMcpOauth` therefore always sends a fast request first: if the access token had
  expired, the rotation happens there, on a request that finishes quickly, and the slow POST
  that follows travels with a fresh access token.
- Residual risk: the access token expires in the milliseconds between the two requests, and the
  slow one is then aborted. That loses one rotation. For a paired device the plugin's reuse grace
  forgives it (only a token two rotations behind revokes the device); a password session signs
  in again silently through `withAuthRetry`.
- Only `startMcpOauth` uses the longer limit. Everything else keeps 20 s; Test does not use REST.
- The timeout message reports the limit that applied.
- Cost: while the access token's expiry is unknown, REST requests queue, so a slow OAuth start can
  hold up the next REST call, including a chat reconnect, for up to 45 s. In the normal case the
  call returns in a few seconds.

## 7. Delivery

Three PRs, each with CI green before merge:

1. **Transport and logic, no UI:** the `RestClient` timeout option, `src/api/mcp.ts`,
   `src/api/mcpSession.ts`, `src/lib/mcp.ts`, `src/lib/mcp-oauth.ts`, `src/session-mcp-store.ts`,
   with their unit tests, and `docs/contracts/mcp.md`.
2. **Manage what exists:** the sidebar item, list, detail, Test, runtime status, the switch, and
   Reload now. Simulator QA, then his device.
3. **Add:** catalog, custom form, secrets, OAuth sign-in, Remove. His device QA is the gate.

## 8. Errors

`connectorErrorMessage` maps these in one place.

| Situation | What he sees |
| --- | --- |
| `AuthError` (session dead) | Back to the sign-in screen, as on Skills. |
| Gateway unreachable or timeout | An inline message with pull to retry. Switches revert. After a timed-out write, the list is re-read before a retry is allowed. |
| The list answers 404 "Not Found", or something that is not JSON | "This gateway doesn't support connectors (needs Hermes 0.21.5 or later)." |
| The list answers 404 with any other reason (for example an unknown profile) | The gateway's reason. |
| 400 / 409 / 422 on add or install | The gateway's reason next to the form, cleaned per §5.9. |
| 404 on a server action | "This connector no longer exists", then the list reloads. |
| 429 | "Rate limited — wait a minute." (`RestClient` replaces every 429 body with this today; that stays.) |
| OAuth provider refuses registration | The gateway's explanation, verbatim (§10 R2). |
| Authorization URL fails rule B | The misconfiguration message in §5.6. |
| Test fails | The gateway's error text, shown on screen and not logged. |
| Reload fails or is unknown | Per §5.7. |

## 9. Testing

**Unit (TDD, written first):**

- `__tests__/mcp.test.ts`: every REST call's path, name encoding, profile query and body;
  `startMcpOauth` sends the fast request first and then the POST with the 45 s limit; secret
  errors are cleaned for each variant (as typed, trimmed, `Bearer ` prefix) and short values are
  ignored.
- `__tests__/mcp-lib.test.ts`: filter and sort, name suggestion, validation, the capability table,
  status lines including the "changes after reload" cases, plain-field rule, error mapping
  (including both 404 cases and non-JSON), rule B.
- `__tests__/mcp-oauth.test.ts`:
  - approved; gateway error on a poll; already approved at start;
  - error at start cancels the flow;
  - a non-HTTPS URL or a foreign `redirect_uri` is refused and the flow cancelled;
  - `starting` on a poll keeps polling; a changed URL cancels;
  - browser closed, then approved within 60 s; browser closed, then cancelled at 60 s;
  - Cancel tapped; DELETE answering `approved` counts as success;
  - 404; the 6-minute limit; a poll always precedes a limit check after a long gap;
  - a failed poll is retried; `AuthError` closes the browser and passes through;
  - one retry after a 409 that follows the app's own cancel.
- `__tests__/mcpSession.test.ts`: reload sends `confirm: true` and never `always`; `session_id`
  omitted for a new chat; `turn_isolation`; socket drop reported as unknown; test and status
  results.
- `__tests__/session-mcp-store.test.ts`: publish, owner-checked clear, pending flag.
- `__tests__/restClient.test.ts`: timeout override, clamp, invariant, message.

**Component:** `connector-secret-form.test.tsx`: Face ID runs before submit; cancelled or failed
sends nothing; the value never reaches an error, a log or a store; required fields; blank optional
fields omitted; values cleared on success and kept on failure.

**Simulator (screenshots, dark and light):** list, detail, catalog, catalog entry, custom form, the
banner, error states. Read-only REST calls run against the live gateway.

**Anything that changes or exercises his real gateway needs his go-ahead at plan time:**

- Test on `youtube-transcript` starts that stdio process on the gateway.
- Proposed write pass on the simulator: add one no-auth catalog entry, switch it, test it, reload,
  remove it.
- OAuth sign-in and the bearer-token form are verified on his phone, because they need his
  accounts and Face ID.

**Gate:** `npx tsc --noEmit && npx jest && npm run lint`, CI green, then his device QA.

## 10. Risks and things to verify during implementation

- **R1. The REST OAuth flow has no client we could copy, and the callback URL is built by the
  gateway** from the request, from `HERMES_DASHBOARD_PUBLIC_URL` / `dashboard.public_url`, or from
  a per-server override. Expected: `https://hermes.kite-opah.ts.net/api/mcp/oauth/callback/<name>`.
  Rule B checks it at run time. If it is wrong, the fix is to set `HERMES_DASHBOARD_PUBLIC_URL` in
  `hermes-deploy`, which is his deploy.
- **R2. Providers that restrict client registration.** Some catalog entries only accept
  pre-approved OAuth clients. The gateway reports this in plain words and the app shows it. Those
  entries will not work from any client; this is not an app defect.
- **R3. "Changes apply to new chats."** This follows the gateway's own description of the enable
  switch. Verify with a new chat after adding a server. If a new chat does not pick the server up,
  the banner text changes to say a reload is needed.
- **R4. What removal leaves behind.** Verify whether removing a server also deletes its OAuth
  tokens and its token in `.env`, and make the confirmation text say what remains.
- **R5. Whether `reload.mcp` runs off the gateway's dispatch thread.** `mcp.servers.test` does. If
  reload does not, a long reload could starve the socket's heartbeat (45 s) and drop the chat
  connection; §5.7 already reports that as unknown. Verify in `tui_gateway/server.py`
  (`_LONG_HANDLERS`), which could not be fetched for this spec.
- **R6. A gateway restart loses running OAuth flows** (they are in memory). The app reports
  "expired" and he starts again.
- **R7. Catalog install details not read:** that the installed server's name equals the entry's
  name, and what the gateway does when a required variable is missing.
- **R8. Cancel during token exchange.** If he cancels after the provider has redirected, the
  gateway may still store the tokens while reporting the flow as cancelled. The test after a
  cancel (§5.6) shows the true state.

## 11. Deferred

- stdio servers: add, edit, remove.
- Per-tool selection.
- Editing a server in place and replacing a stored token.
- Brand icons.
