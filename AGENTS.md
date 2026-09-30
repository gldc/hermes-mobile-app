# Hermes Mobile

Unofficial open-source iOS client for [hermes-agent](https://github.com/NousResearch/hermes-agent).
The app is a pure client of a self-hosted hermes dashboard over a **private network**
(Tailscale/VPN/LAN) — it never talks to any third-party backend.

## Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

## Commands

```bash
npx expo start          # dev server; JS changes hot-reload, no rebuild
npx expo run:ios --device   # native rebuild — ONLY needed when native deps/config change
                        # (expo-local-authentication, Face ID for secure entry, is native: an old
                        # dev client must be rebuilt once)
npx tsc --noEmit        # typecheck (run before every commit)
npx jest                # unit tests (run before every commit)
npm run lint            # expo lint --max-warnings 0 — must be clean (0 errors, 0 warnings)
```

`npm run lint` covers `src/` only (expo lint's default inputs); the top-level `__tests__/`
is not linted. Fix React Compiler lint findings by removing the pattern — no
`eslint-disable` comments and no rule downgrades.

## Git workflow

**Never push to `main` directly.** All changes go through a branch + PR, even small ones.
Branch names: `feat/...`, `fix/...`, `docs/...`. Run `npx tsc --noEmit && npx jest && npm run lint`
before opening the PR.

CI (`.github/workflows/ci.yml`) runs typecheck, `npx jest --ci` and `npm run lint` on every PR
and on `main` (Node 22, SHA-pinned actions). Merge only when it is green — gate on the
check's exit code, never on piped output.

## Architecture

```
src/app/          expo-router routes — THIS is the router root, not a top-level app/
  index.tsx       Connect screen (gateway URL + basic-auth credentials)
  chat/[id].tsx   Root surface after connect ("new" = lazy-created session;
                  otherwise session.resume). No native header — floating buttons.
  settings.tsx    formSheet (gateway info, disconnect)
  dev-cards.tsx   __DEV__-only gallery of every turn-control/card state for sim screenshots
                  (`xcrun simctl openurl booted hermesmobileapp://dev-cards`); release redirects
src/api/          transport, all unit-tested with injected fetch/socket
  cookieJar.ts    manual cookie store (RN fetch doesn't manage cookies)
  restClient.ts   login / ws-ticket / sessions / history
  gatewayClient.ts adapter over the vendored upstream JsonRpcGatewayClient
  chat-transport.ts one per chat screen: client + turn store + request router +
                  reconnect orchestrator, all handlers registered before connect
src/vendor/hermes-gateway/  upstream client + generated contract, pinned by
                  VENDORED.json (re-vendor: scripts/sync-gateway-contract.sh <tag>)
src/connection.ts singleton glue: SecureStore persistence, withAuthRetry, mintGatewayUrl
                  (mints a fresh single-use ticket URL)
src/lib/turn-controller.ts pure turn state + request-card reducer; mergeRequestRows places cards
src/lib/turn-commands.ts   Stop (15 s reconnect fallback) and steer
src/lib/request-answers.ts answers cards (guards on the store's card, never the rendered one)
src/components/   message rows, tool cards, composer, theme'd pieces
  approval-card / clarify-card / secure-entry-card  server→client request cards
  sidebar-host.tsx Claude-style slide-over: wraps the Stack in root _layout;
                  custom Reanimated drawer (no @react-navigation/drawer — banned
                  in SDK 56). Active on /chat/* only; left edge opens it there.
  sidebar.tsx     Session list, search, profile switcher, archive view, nav
                  destinations, New chat pill — lives inside the drawer.
src/sidebar-store.ts open/close state (useSyncExternalStore, like profile-store)
src/theme.ts      single source of color truth (warm cream light / charcoal dark,
                  terracotta accent, Georgia serif for wordmark + greetings)
```

## Wire contract (server = hermes dashboard, port 9119, gated auth mode)

- Login: `POST /auth/password-login` `{provider:"basic", username, password}` → AT/RT cookies.
  Cookies are managed manually (`CookieJar`); every response's `Set-Cookie` must be ingested
  (refresh tokens rotate server-side).
- WebSocket: mint single-use 30s ticket via `POST /api/auth/ws-ticket`, connect
  `ws(s)://host/api/ws?ticket=…`. A ticket can never be reused — reconnects mint fresh ones.
- RPC: types come ONLY from src/vendor/hermes-gateway (generated at v2026.9.24); an unknown
  param key is a compile error. `session.create` (lazy), `session.resume` (after the
  capability handshake), `prompt.submit {queued:true}` from idle. Server→client requests
  (approval/clarify/sudo/secret) are answered on the socket; never -32601 them. 0.20.4's
  `approval.request` event + `approval.respond` stay supported (src/api/legacy-approval.ts).
- Events: `message.start/delta/complete` (complete carries `status`: complete|error|interrupted),
  `tool.start/complete` (payload key is `name`, NOT `tool_name`), `status.update`, `error`;
  server→client request cards arrive via the request router.
- History: `GET /api/sessions/{id}/messages` returns raw session-DB rows — text lives in
  `content` (string or parts array), never `text`. Use `messageText()`.
- Stop = `session.interrupt` (turn ends via `message.complete status:interrupted`); steer =
  `session.steer` mid-turn, falling back to `prompt.submit {queued:true}` when rejected (or
  4010). Turn state is server-driven (`turn-controller`), not set from the composer.
- Request cards live in the turn store, outside `items`, anchored to a transcript key. An OPEN
  card whose anchor a history reload removed draws at the tail until the reconnect sequence
  ends (ready / failed / `start()` rejected), then is pinned under its requester tool row
  (`createCardPinner`, D1). Cards already settled at the reload are not redrawn (the history
  reflects them); a card that was open at the reload and settles during the window is still
  pinned and drawn.
  Answer with the contract's own decline (clarify `{}` = cancel-all, sudo/secret
  `{value:""}`); malformed params render "can't be shown" + Skip — never throw in render.
- Push: `clarify_request` joins `session_end`/`approval_request` as a foreground-suppressed
  type (`SUPPRESSIBLE_PUSH_TYPES`); taps open `/chat/<session_id>`.

## Conventions & gotchas

- `process.env.EXPO_OS`, not `Platform.OS` (build-time platform elimination).
- Never import from `@react-navigation/*` — expo-router SDK 56 hard-errors on it.
- SF Symbols via `expo-image` (`source="sf:name"`), not expo-symbols/vector-icons.
- All colors from `useTheme()`; never hardcode hex in components. Dark is the primary
  theme; light must stay working.
- `borderCurve: 'continuous'` on rounded rects; inline styles (no StyleSheet.create needed);
  React Compiler is enabled — don't hand-memoize render values.
- Chat list is an inverted FlatList (index 0 = visual bottom).
- Adding a native module forces a dev-client rebuild and breaks hot reload for anyone on the
  old binary — prefer pure-JS deps (e.g. share-sheet over expo-clipboard).
- ATS exception (`NSAllowsArbitraryLoads`) is dev-only pragmatism for plain-HTTP-over-
  WireGuard; replace with Tailscale HTTPS certs before App Store submission.

## Secure entry (sudo/secret) — security rules

- The typed value lives ONLY in `SecureEntryForm`'s local state and goes straight to the
  response frame: never into the turn store, `items`, a ref, an error, storage, `console.*`,
  analytics or push. The form renders only while the card is open, so every exit clears it.
- Send requires Face ID (device-passcode fallback) immediately before responding; a failed
  or cancelled check sends nothing and keeps the card open. Skip responds `{value:""}`.
- Secret: `textContentType="none"` (never offer to save an API key to Passwords); sudo:
  `password`. Every secret card shows the phishing warning and where the value goes; skill
  provenance is information, never a trust grade. Tests assert the value never leaks.

## Testing

Pure logic (cookie parsing, REST, JSON-RPC, formatting) lives in `src/api`/`src/lib` with
injected I/O and unit tests in `__tests__/`. TDD for any new transport/parsing logic.
Components (cards, composer) have React Native Testing Library tests (`*.test.tsx`);
`jest.setup.ts` mocks Reanimated/Worklets for them. Screens (`src/app/`) are glue and are
verified on the simulator/device.

## Roadmap context

The companion server plugin (`~/Developer/hermes-mobile-plugin`, installed at
`~/.hermes/plugins/hermes-mobile`) already provides QR pairing with per-device rotating
tokens, a `mobile` platform adapter (mailbox + redacted Expo push), and
`/api/plugins/hermes-mobile/` routes. M2 = app-side pairing screen consuming
`hermes mobile pair` QR payloads `{url, rt, device_id}` (the RT bootstraps a session via
the standard refresh path); push-token registration; then drop password storage.
Design docs: `docs/design.md`, plans in `docs/plans/`.
