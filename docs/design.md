# Hermes Mobile — Design Spec

**Date:** 2026-06-11
**Status:** Approved (brainstorming phase complete)
**Owner:** gldc@users.noreply.github.com

## Goal

A mobile app (iOS first, published as an unofficial open-source app on the
App Store) that connects to a running hermes-agent over a private network
(Tailscale/VPN), mirroring the chat experience of the desktop app. The
gateway is never exposed on the public internet. All server-side
functionality ships as a **standalone plugin** that works against stock
hermes-agent — no fork divergence, no upstream PR required for v1.

## Decisions made during brainstorming

| Decision | Choice |
| --- | --- |
| v1 scope | Chat-first (sessions, streaming chat, tool output). Management features later. |
| Push notifications | Yes in v1, via Expo's push service (outbound-only from the gateway). |
| Push privacy | Redacted by default ("Hermes: new message"); content previews opt-in via app setting. |
| Pairing | QR code: `hermes mobile pair` mints a device token locally, QR carries URL + token. |
| Distribution | Standalone plugin repo (like memory providers). Upstream PR only if a hook gap demands it (v2). |
| App stack | Expo / React Native (expo-notifications, expo-secure-store), separate repo. |

## Architecture

Three parts. The hermes-agent fork itself is **untouched**.

```
┌─────────────────────┐   Tailscale (WireGuard)   ┌──────────────────────────────┐
│ hermes-mobile-app   │ ◄───────────────────────► │ hermes-agent host            │
│ (Expo, separate     │   REST + WS, port 9119    │  dashboard backend (gated    │
│  repo, App Store)   │                           │  auth mode, tailnet bind)    │
└─────────┬───────────┘                           │  + hermes-mobile-plugin      │
          │ APNs (redacted               outbound │    (~/.hermes/plugins/)      │
          ▼ notification)                HTTPS    └──────────────┬───────────────┘
┌─────────────────────┐                                          │
│ Apple APNs          │ ◄──── Expo push service ◄────────────────┘
└─────────────────────┘       (exp.host)          POST /v2/push/send
```

### 1. `hermes-mobile-app` (new repo)

Pure client of the existing dashboard backend API — the same REST + WebSocket
contract the desktop app's remote-gateway mode uses.

- **Screens (v1):** pairing (QR scan + status), session list, chat
  (streaming responses, tool-output rendering), inbox (agent-initiated
  messages), settings (push preview toggle, unpair).
- **Stack:** Expo; `expo-notifications` (push token), `expo-secure-store` /
  iOS Keychain (credentials), QR scanner.
- **API types:** vendored from `apps/desktop/src/types/hermes.ts`.
- **Auth transport:** the app stores AT/RT and sends them as the session
  cookie header itself, tracking `Set-Cookie` rotation (middleware is
  cookie-only; see Validations §3). WebSocket connects with a single-use
  ticket from `POST /api/auth/ws-ticket`.
- **Offline:** explicit "tailnet unreachable" state with retry — VPN-off is
  an everyday state, not an edge case.

### 2. `hermes-mobile-plugin` (new repo)

Standalone plugin, installable into `~/.hermes/plugins/` or via pip entry
point. Four pieces, all using existing plugin-context hooks:

1. **Auth provider** — `ctx.register_dashboard_auth_provider()` registers a
   `DashboardAuthProvider("mobile-device")`:
   - Device store at `~/.hermes/mobile/devices.json`, tokens stored hashed.
   - `verify_session` / `refresh_session` (rotating ~30-day RT, ~15-min AT,
     matching existing cookie semantics) / `revoke_session`.
   - `start_login` redirects to the public project docs ("pair with the
     mobile app via `hermes mobile pair`"), so the provider's presence on
     the browser login page is informative rather than a broken button.
     (It cannot point at a plugin route: those sit behind session auth,
     and the login-page visitor is unauthenticated by definition.)
2. **CLI** — `ctx.register_cli_command()`:
   - `hermes mobile pair` — mints a device record + initial RT locally,
     renders a QR in the terminal encoding `{gateway URL, refresh token,
     device id}`.
   - `hermes mobile devices` — list paired devices.
   - `hermes mobile revoke <device>` — revoke a device's tokens.
3. **Platform adapter `mobile`** — `ctx.register_platform()`:
   - `send()` writes the message to a per-device mailbox and fires a
     redacted Expo push (outbound `POST https://exp.host/--/api/v2/push/send`).
   - Makes the phone a first-class `send_message` / cron-delivery target.
4. **API router** — plugin FastAPI router auto-mounted at
   `/api/plugins/mobile/` behind session auth:
   - `POST .../push-token` — register/refresh the device's Expo push token.
   - `GET .../mailbox` — sync agent-initiated messages.
   - `GET .../me` — device self-info.

### 3. hermes-agent (fork)

No changes in v1. Candidate v2 upstream PRs, both small and mergeable:
- A `post-response` hook so the plugin can push "your reply is ready" when
  a chat response completes while the app is backgrounded.
- `Authorization: Bearer` support in the dashboard auth middleware, if
  cookie-header auth from the native client proves awkward.

## Key flows

**Pairing.** `hermes mobile pair` runs on the gateway host, which already
has filesystem trust — so the device token is minted locally and no
pre-auth network endpoint exists at all (nothing to attack). QR → app scans
→ credentials into Keychain → app exchanges RT for AT → connected.
Re-pairing is the recovery path for an expired or revoked RT.

**Chat.** App ↔ dashboard backend over the tailnet: REST for sessions,
WS (`/api/ws` with `?ticket=`) for streaming chat. Identical contract to
the desktop remote mode.

**Push.** Agent/cron sends to platform `mobile` → adapter stores the
message in the mailbox and POSTs a redacted notification to Expo's push
API (outbound only — works from inside the tailnet because outbound
internet was never restricted; the gateway already calls LLM APIs).
Tapping the notification opens the app, which fetches real content over
the VPN. The mailbox is the source of truth; push is a best-effort signal.

## Security posture

- Dashboard backend binds to the Tailscale interface only; non-loopback
  bind engages gated auth mode. Nothing listens publicly.
- Transport encryption via WireGuard (Tailscale); Tailscale-issued HTTPS
  certs are optional hardening, not a requirement.
- Per-device tokens, hashed at rest, individually revocable
  (`hermes mobile revoke`). Short-lived ATs, rotating RTs.
- Push payloads transit Expo + APNs ⇒ redacted by default; previews are
  explicit opt-in.
- The QR contains a live refresh token: display warns it is a secret, and
  the embedded RT can be made single-exchange (consumed and rotated on
  first refresh).

## Error handling

- Refresh failures distinguish "gateway unreachable" (retry/backoff) from
  "RT revoked or expired" (prompt re-pair).
- Expo push receipts are checked; dead/invalid push tokens are pruned.
- WS drops mid-stream: agent completes server-side and persists; app
  re-syncs the session on reconnect.

## Validations performed (code-verified, not assumed)

1. **Plugin auth hook exists with precedent** —
   `ctx.register_dashboard_auth_provider()` (`hermes_cli/plugins.py:561`);
   provider ABC in `hermes_cli/dashboard_auth/base.py`; three bundled
   providers (`basic`, `self_hosted`, `nous`) already use it.
2. **Providers stack** — middleware tries every registered provider's
   `verify_session`; first to recognise the token wins
   (`hermes_cli/dashboard_auth/middleware.py:196-214`). Device tokens
   coexist with any browser login provider.
3. **Token transport is cookie-only** — `read_session_cookies` in the
   middleware; no `Authorization` header path. Native client sends the
   cookie header manually. WS auth via 30-second single-use tickets
   (`hermes_cli/dashboard_auth/ws_tickets.py`).
4. **Plugins can mount REST routes** — FastAPI routers auto-mounted at
   `/api/plugins/{name}/` behind session auth
   (`hermes_cli/web_server.py:10623-10697`); kanban plugin is the working
   example.
5. **Plugins can register platform adapters** —
   `ctx.register_platform()` (`hermes_cli/plugins.py:770-822`); the API
   server itself is an adapter that runs an HTTP server, so an adapter
   doing push delivery is in-pattern.
6. **Gated auth mode engages on non-loopback bind** — `auth_required`
   check in `middleware.py`; default bind is loopback.
7. **Checked and rejected** — the gateway's OpenAI-compatible API server
   (`gateway/platforms/api_server.py`) supports only one static
   `API_SERVER_KEY` with hardcoded validation ⇒ use the dashboard backend
   instead. No response-completion hook exists ⇒ that push lands in v2.

## Testing

- **Plugin:** `assert_protocol_compliance(MobileDeviceProvider)` (the
  repo's prescribed provider test); unit tests for token store, rotation,
  revocation, mailbox, and push (Expo API mocked); integration test
  booting the dashboard in gated mode and walking
  pair → verify → refresh → revoke.
- **App:** component tests; TestFlight for the push path (requires a real
  device).

## Milestones

1. **Walking skeleton** — Expo app chats with an unmodified hermes-agent
   over Tailscale using an existing auth provider. Proves transport, auth,
   WS, streaming. No plugin code yet.
2. **Plugin: pairing + device tokens** — QR flow, per-device revocable
   credentials.
3. **Plugin: `mobile` platform + Expo push** — mailbox, redacted
   notifications, cron/`send_message` targeting.
4. **App Store polish** — onboarding, error states, demo mode (review
   compliance: the app must be demonstrable without a private gateway).

## Known risks

- Cookie-header auth from a native client is unconventional; fallback is
  the small `Authorization: Bearer` upstream PR.
- "Push when my chat reply finishes" is not in v1 — only
  agent-initiated/cron messages push.
- App Store review may reject an app unusable without a self-hosted
  server; demo mode mitigates.
- Upstream API drift: the dashboard REST/WS contract is internal to the
  repo, not a stable public API. The app vendors types and pins tested
  hermes versions; the plugin can expose a version-handshake endpoint.
