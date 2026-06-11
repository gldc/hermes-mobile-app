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
npx tsc --noEmit        # typecheck (run before every commit)
npx jest                # unit tests (run before every commit)
```

## Git workflow

**Never push to `main` directly.** All changes go through a branch + PR, even small ones.
Branch names: `feat/...`, `fix/...`, `docs/...`. Run `npx tsc --noEmit && npx jest` before
opening the PR.

## Architecture

```
src/app/          expo-router routes — THIS is the router root, not a top-level app/
  index.tsx       Connect screen (gateway URL + basic-auth credentials)
  chat/[id].tsx   Root surface after connect ("new" = lazy-created session;
                  otherwise session.resume). No native header — floating buttons.
  settings.tsx    formSheet (gateway info, disconnect)
src/api/          transport, all unit-tested with injected fetch/socket
  cookieJar.ts    manual cookie store (RN fetch doesn't manage cookies)
  restClient.ts   login / ws-ticket / sessions / history
  gatewayClient.ts JSON-RPC 2.0 over WebSocket
src/connection.ts singleton glue: SecureStore persistence, withAuthRetry, openGateway
src/components/   message rows, tool cards, composer, theme'd pieces
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
- RPC: `session.create` (lazy, on first send), `session.resume` (continuation + reconnect),
  `prompt.submit`. Events: `message.delta/complete`, `tool.start/complete` (payload key is
  `name`, NOT `tool_name`), `status.update`, `error`.
- History: `GET /api/sessions/{id}/messages` returns raw session-DB rows — text lives in
  `content` (string or parts array), never `text`. Use `messageText()`.

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

## Testing

Pure logic (cookie parsing, REST, JSON-RPC, formatting) lives in `src/api`/`src/lib` with
injected I/O and unit tests in `__tests__/`. Screens are glue and are verified on-device.
TDD for any new transport/parsing logic.

## Roadmap context

The companion server plugin (`~/Developer/hermes-mobile-plugin`, installed at
`~/.hermes/plugins/hermes-mobile`) already provides QR pairing with per-device rotating
tokens, a `mobile` platform adapter (mailbox + redacted Expo push), and
`/api/plugins/hermes-mobile/` routes. M2 = app-side pairing screen consuming
`hermes mobile pair` QR payloads `{url, rt, device_id}` (the RT bootstraps a session via
the standard refresh path); push-token registration; then drop password storage.
Design docs: `docs/design.md`, plans in `docs/plans/`.
