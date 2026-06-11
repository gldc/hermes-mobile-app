# Push registration & mailbox — verified wire contract

Verified 2026-06-11 against source (read-only):

- `hermes-mobile-plugin/hermes_mobile/plugin_api.py` (routes), `push.py`
  (outbound Expo payload), `mailbox.py` (message records),
  `dashboard/manifest.json` + `dashboard/plugin_api.py` (mounting)
- `hermes-agent/hermes_cli/web_server.py` (plugin API mount prefix)

## Route prefix is `/api/plugins/mobile/…` — NOT `hermes-mobile`

`web_server.py:10690` mounts each plugin router at
`/api/plugins/{plugin['name']}` where `name` comes from
`dashboard/manifest.json` (`_discover_dashboard_plugins`,
web_server.py:10186: `name = data.get("name", child.name)`). The mobile
plugin's manifest declares `"name": "mobile"`, so the real routes are:

- `POST /api/plugins/mobile/push-token`
- `GET  /api/plugins/mobile/mailbox`
- `GET  /api/plugins/mobile/me`

(The repo directory is `hermes-mobile-plugin` and `plugin.yaml` says
`name: hermes-mobile`, but neither feeds the API prefix.)

## Auth: every route is device-session-gated

`_require_device_id` (plugin_api.py:65) requires the gated auth middleware to
have attached a session with `provider == "mobile-device"` and
`user_id == "mobile:<device_id>"`. Anything else — browser OAuth sessions,
loopback/--insecure mode (no session) — gets 403. The device id is implied by
the session; the app never sends it in the body. Our normal RestClient cookie
flow (AT, or RT-only triggering a rotation) is exactly what produces that
session, so `withAuthRetry((r) => r.post(...))` is the whole client story.

## POST /push-token

Request body (pydantic `PushTokenBody`): `{"token": "<Expo push token>"}`.
Token is `.strip()`ed; empty → 400. Responses:

- `200 {"ok": true}` — token stored on the device record (re-POST = refresh;
  idempotent overwrite via `DeviceStore.set_push_token`).
- `400` empty token, `403` not a device session, `404` device unknown or
  revoked, `503` device store write failed.

## GET /mailbox — drain is DESTRUCTIVE

`drain_messages` (mailbox.py:82) reads `<hermes home>/mobile/mailbox/<device_id>.jsonl`,
parses every line, **unlinks the file**, and returns
`{"messages": [...]}`. Missing file → `{"messages": []}`. Each record
(mailbox.py:58):

```json
{"ts": 1760000000.0, "chat_id": "<device_id>", "content": "...",
 "message_id": "<32-hex uuid4>", "reply_to": "...?", "metadata": {...}?}
```

`reply_to` and `metadata` are optional. Consequence for the app: do NOT call
this route until there is UI/storage to show the drained messages — a drain
with nowhere to put the result silently loses agent messages. (M3 follow-up;
see "Follow-ups" below.)

## GET /me

`{"device_id", "name", "created_at", "last_refresh_at", "revoked",
"has_push_token"}` — booleans/epoch floats; token hashes never leave the
store. 404 when unknown, 503 store failure.

## What a push notification contains (push.py)

The gateway POSTs to `https://exp.host/--/api/v2/push/send` with
`{"to": token, "title": "Hermes", "body": "New message from Hermes"}` —
body is redacted by default (content only when the operator opts in), and
there is **no `data` field at all**. So a notification tap carries no chat id
or message id; the only sane deep link is the sessions list, and the mailbox
remains the source of truth (push is just the "go look" signal — push.py
docstring; failures are swallowed server-side).

## App-side behavior (this repo)

- `src/lib/push.ts` — pure logic: route constants, registration-staleness
  (re-register when older than 7 days, device changed, or timestamp is in the
  future), mailbox payload parsing.
- `src/notifications.ts` — orchestration: permission soft-ask (own Alert
  before the OS prompt), `getExpoPushTokenAsync({ projectId })` with
  `projectId` read from `Constants.expoConfig.extra.eas.projectId` (fallback
  `Constants.easConfig.projectId`); when absent, registration is skipped and
  settings shows "Run eas init to enable push". Registration state persists in
  SecureStore (`hermes-push-registration`) and is refreshed on app start when
  stale. Foreground notifications show as banners; taps navigate to
  `/sessions` (cold-start taps land on `/` whose restore flow already replaces
  to `/sessions`).

## Follow-ups (deliberately not in this change)

- Mailbox drain + display: needs an inbox UI or per-chat merge before calling
  the destructive `GET /mailbox`. The parser (`parseMailboxMessages`) is
  already written and tested.
- Chat deep links: blocked on the gateway adding a `data` payload to push.py.
