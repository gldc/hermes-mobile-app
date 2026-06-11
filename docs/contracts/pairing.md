# QR device pairing — verified wire contract

Verified 2026-06-11 against source (read-only):

- `hermes-mobile-plugin/hermes_mobile/cli.py`, `auth_provider.py`, `device_store.py`
- `hermes-agent/hermes_cli/dashboard_auth/cookies.py`, `middleware.py`

## Pairing payload (`hermes mobile pair`) — SUPPORTED

`cmd_pair` (cli.py:107) mints a device via `DeviceStore.create_device(name)` and
prints (and QR-encodes) compact JSON:

```json
{"url":"http://100.x.y.z:9119","rt":"<refresh token>","device_id":"<16-hex>"}
```

- `url` — gateway base URL. Default `http://<detected tailscale/LAN ip>:9119`
  (`DEFAULT_GATEWAY_PORT = 9119`, cli.py:31); overridable with `--url`, so the
  app must treat it as an arbitrary http(s) URL, not assume the port.
- `rt` — a LIVE 30-day refresh token (`secrets.token_urlsafe(32)`), returned
  exactly once; only its SHA-256 hash is stored server-side. **It is the whole
  device credential** — no access token exists until first rotation
  (device_store.py:124-148).
- `device_id` — `secrets.token_hex(8)` (16 hex chars). Used for
  `hermes mobile revoke <device_id>` and push-token registration.

The QR encodes the JSON string itself (no URL scheme wrapper). When the
`qrcode` package is missing the CLI prints only the JSON and tells the user to
paste it manually — the app's manual-paste fallback consumes the same string.

## Cookie names (cookies.py)

Bare names, with `__Host-` / `__Secure-` prefixes ONLY over HTTPS
(`_resolved_name`, cookies.py:87). Over plain HTTP — our private-network case —
the names are exactly:

- `hermes_session_at` — access token, Max-Age = token TTL (~15 min;
  `ACCESS_TTL_SECONDS = 15*60` in device_store.py)
- `hermes_session_rt` — refresh token, Max-Age 30 days, **rotating +
  reuse-detected**

`HttpOnly; SameSite=Lax; Path=/` (no `Secure` over HTTP). The middleware's
reader (`_read_with_fallback`) checks all three name variants, so a client that
always sends the bare names works over both HTTP and HTTPS.

## Bootstrap: RT-only request triggers provider refresh — SUPPORTED

`gated_auth_middleware` (middleware.py:188-310):

1. Reads `(at, rt)` from cookies. Neither present → 401 `no_cookie`.
2. `at` present → stacked `provider.verify_session(at)`.
3. **`at` absent but `rt` present → skips verification entirely and goes
   straight to `_attempt_refresh(rt)`** (middleware.py:208-260). This is the
   documented common path, and `MobileDeviceProvider.refresh_session` *is* the
   device-login endpoint (auth_provider.py docstring): there is no
   password-login or browser flow for devices (`complete_login` raises
   unconditionally; `supports_password = False`).
4. On refresh success the middleware serves the request AND calls
   `set_session_cookies` on the response — fresh `hermes_session_at` +
   rotated `hermes_session_rt` arrive via `Set-Cookie`.
5. On `RefreshExpiredError` → 401 JSON `{"error":"session_expired", ...}` on
   `/api/*` routes, plus `Max-Age=0` deletions for every cookie-name variant
   (`clear_session_cookies`).

So the app pairs by seeding its jar with `hermes_session_rt=<rt>` and issuing
any authed `/api/*` request (we probe with `GET /api/sessions`); the response
carries the first real AT/RT pair.

## RT rotation + reuse-revocation (device_store.py `rotate_refresh`)

- Every refresh rotates BOTH tokens: new ~15-min AT, new 30-day RT. The old RT
  hash is retired into `prev_refresh_token_hashes` (last 50 kept).
- **Reuse detection:** presenting any retired RT **revokes the whole device**
  (`ReusedRefreshTokenError`, device_store.py:174-177). There is NO grace
  window. Consequence for the app: after every response, the rotated RT must
  be persisted immediately — replaying a stale persisted RT (e.g. app killed
  between refresh and persist) permanently kills the pairing.
- Unknown / expired / revoked / reused RT all surface as
  `RefreshExpiredError` → middleware 401 (`session_expired`) + cookie clears.
  None of these are recoverable client-side: the only fix is re-pairing via
  `hermes mobile pair`. A `ProviderError` (store I/O) also yields 401 via
  `_attempt_refresh` returning None — indistinguishable from revocation at the
  wire level.
- `verify_access` only accepts the single latest AT and only until
  `access_expires_at`; an expired AT with a live RT refreshes transparently
  (same flow as bootstrap).

## Device management (cli.py) — server-side only

- `hermes mobile devices` — list; `hermes mobile revoke <device_id>` — revoke.
- `revoke_session` (logout) revokes the device by RT, best-effort. The app
  does not call a logout endpoint in M2; disconnect just discards local state
  (revocation is done on the gateway host).

## App-side contract implemented in M2

- `StoredConnection` v2: `{version: 2, baseUrl, mode: 'password' | 'device',
  username?, password?, deviceId?, cookies}`. v1 blobs (no `version`) migrate
  to `{version: 2, mode: 'password'}` transparently.
- Device connect: seed jar with `hermes_session_rt`, probe `listSessions`,
  persist jar to SecureStore on EVERY jar mutation (CookieJar onChange hook).
- `AuthError` in device mode after a failed refresh ⇒ device revoked/expired ⇒
  surface "re-pair" message; nothing to replay (no credentials stored).

## Out of scope for M2 (deferred)

- Push-token registration (`/api/plugins/hermes-mobile/` routes,
  `DeviceStore.set_push_token`) — M3 per roadmap.
- Server-side logout/revoke call from the app on disconnect.
