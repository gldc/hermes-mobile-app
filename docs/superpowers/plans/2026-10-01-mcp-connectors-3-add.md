# MCP Connectors, Plan 3 of 3: Add, Sign In, Remove — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the Connectors screen he can add a connector from the gateway's catalog or by URL, sign in to an OAuth connector without leaving the app, and remove a remote connector.

**Architecture:** Three new screens (catalog, catalog entry, custom form) send one REST request each and then hand over to the existing detail screen, which owns sign-in. One component, `ConnectorSecretForm`, is the only owner of any typed secret and runs Face ID before a request that carries one. One hook, `useConnectorSignIn`, binds the tested `runOauthSignIn` sequence to the real in-app browser and REST client.

**Tech Stack:** Expo SDK 57 / React Native 0.86, expo-router, `expo-web-browser` and `expo-local-authentication` (both already dependencies and already in the installed builds), jest-expo with React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-01-mcp-connectors-design.md` (revision 3), §5.1, §5.3–§5.6, §5.9, §8, §9. Wire contract: `docs/contracts/mcp.md`.

**Builds on:** plans 1 and 2 (PRs #40 and #41). Branch `feat/mcp-connectors-add`, cut from `feat/mcp-connectors-manage`; its PR targets that branch.

**How this plan is written.** Plans 1 and 2 embedded every line of code, and each was reviewed twice: before building (by running the embedded code in a scratch copy) and after (on the branch). The second review found things the first could not, because the code had changed by then. This plan therefore fixes the interfaces, the behaviour and the test cases, is reviewed for design errors before building, and gets the same whole-branch review afterwards. Code is written test-first on the branch.

## Addendum: what the branch review changed

One independent review of the built branch (no blocker; no path found by which a typed token or
credential leaves the form other than in the request body; one major and thirteen minor findings):

- **C1 was not enough as a mount check.** A screen with a chat pushed on top is still mounted, so
  a late success popped that chat. Navigation after an await is now gated on the screen being
  **focused**; otherwise the result is shown when he returns.
- The "sign in when the detail opens" request expires after 60 s and is dropped by a detail that
  leaves without using it.
- The change-pending flag is counted, so a reload clears only the changes that existed when it
  started. It lives in `src/connector-state.ts`, which `connection.ts` resets on disconnect and
  when the gateway address changes.
- "Already added" always says so; a catalog OAuth entry is refused on a plain-HTTP gateway; a URL
  that carries a key gets a caution; Reload now has a latch; radios report `checked`; the submit
  button has a Face ID hint and a busy state.

The write pass in Task 7 was run on 2026-10-01 with `microsoft-learn`; spec §12 has what it showed.


## Global Constraints

- No new dependency, no native change.
- **Secrets (spec §5.9):** a typed value lives only in `ConnectorSecretForm`'s state and in the argument of `onSubmit`. It is never put in screen state, route params, a store, a ref outside the form, an error, a log, analytics or push. Face ID (`confirmWithBiometrics`) runs immediately before any request whose body carries a value; a failed or cancelled check sends nothing.
- Inputs for these values set `textContentType="none"`, `autoComplete="off"`, `autoCorrect={false}`, `spellCheck={false}`, `autoCapitalize="none"`. A field is masked unless `isPlainEnvField(name)`.
- **Slow REST requests** send a fast request first and may use the 45 s limit (spec §6.1): starting OAuth (already done) and, new here, installing a catalog entry, because the gateway connects to the server while installing (`mcp_catalog.install_entry` → `_apply_tool_selection` → `_probe_tools`).
- The app never calls `reload.mcp`.
- Gateway text that may be unredacted (the test RPC's error, an OAuth flow's error) is shown non-selectable and never logged.
- All colours from `useTheme()`; `borderCurve: 'continuous'`; `process.env.EXPO_OS`; no `@react-navigation/*`; no `eslint-disable`; no state setter called synchronously in an effect body.
- Reads and writes on a screen are sequenced the way plan 2's screens are (a generation counter; a write drops older reads).
- Before every commit: `npx tsc --noEmit && npx jest && npm run lint`, each gated on its own exit code. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## What may touch his live gateway in this plan's QA (approved 2026-10-01)

One write pass on the simulator: add one **no-auth** catalog entry, switch it, test it, remove it. Nothing else is written, and the entry is gone afterwards. OAuth sign-in and the bearer-token form are **not** exercised on the simulator: they need his accounts and Face ID, and are verified by tests here and on his phone.

## Findings from the gateway source that shape this plan

- **Removing a connector deletes only its `config.yaml` entry** (`mcp_config._remove_mcp_server`). Its OAuth tokens and any token in `.env` stay on the gateway. The confirmation says so.
- **A catalog install is named after its entry** (`install_entry` saves `mcp_servers.<entry.name>`), so the new server is `/connectors/server/<entry.name>`.
- **A catalog install is slow**: it probes the server after writing the config. The app gives it 45 s and sends a fast request first.
- **A missing required credential** makes the install fail with a 400 whose text names the variable.
- **A non-secret credential** (for example n8n's URL) is written into `config.yaml`, not `.env`; the form's note says "stored on the gateway" without naming a file.

## Review Focus

1. **He leaves the detail screen while a sign-in is running**: the flow must be cancelled on the gateway and no result may be written afterwards.
2. **A test is in flight when sign-in finishes** (or the reverse): the later result wins; an older one never overwrites it.
3. **An install or add times out**: the app must not let him create a duplicate; it re-reads and goes to the connector if it now exists.
4. **A catalog entry already added elsewhere** (desktop, CLI) between loading the catalog and pressing Add: the gateway's answer is shown, and a re-read offers "Open".
5. **Face ID is not set up on the device**: nothing is sent and the form says what to do.

## Amendments from the design review, and the restored reload (these supersede the task text below)

An independent reviewer checked this design against the gateway source, expo-router, expo-web-browser
and the existing code. Nothing was run. No blocker; four major and ten minor findings. Separately,
Gianluca restored "Reload now" (it shipped in #41), which adds C0.

**C0 (reload). Every change made here marks a reload as pending.** A successful install, add,
remove, and an approved sign-in call `markMcpChanged()`, so the list shows the reload banner on
return. The detail's footnote already points at it.

**C1 (major). A screen that was left during its request must not navigate or write state.**
`router.dismissTo('/connectors')` *replaces the current route* when `/connectors` is not in the
stack, so a late success after he backed out to the chat would replace the chat with the list.
Every screen here keeps a `mounted` ref; after any `await`, it navigates or sets state only while
mounted. This covers the three add paths, the "now installed, navigate" path, Remove, and the
detail's sign-in continuation (which would otherwise start a gateway probe from a dead screen).
An install's busy label reads "Adding… this can take a minute". Test: back out during a pending
install, resolve it, the pathname does not change.

**C2 (major). Starting a sign-in resets the test card to idle.** A test superseded by the sign-in
never writes, so on a sign-in error the card would otherwise stay on "Testing…" with Test disabled.

**C3 (major). One busy state on the detail.** The gateway snapshots the server's config when a
sign-in starts and saves that snapshot on approval, silently undoing a switch made in between.
While a sign-in runs, the switch, Test and Remove are disabled; during a Remove, the switch, Test
and Sign in are disabled. After a sign-in ends, for any reason, the server is re-read.

**C4 (major). An install of an already-installed entry is not rejected by the gateway; it
overwrites.** `installMcpCatalogEntry` already reads the server list first: if that list contains
the entry's name it does not POST and throws `McpAlreadyAddedError`. The entry screen then
re-reads and shows "Already added / Open", with no automatic navigation or sign-in. Review focus 4
is corrected accordingly.

**C5 (minor, hardening). The "sign in on open" intent is not a route param.** A link
`hermesmobileapp://connectors/server/<name>?signin=1` would start an OAuth flow without a tap, and
the param would restart one on any re-mount. The add screens instead call
`requestSignInOnOpen(name)` (a one-shot module value in `connector-sign-in.ts`), which the detail
consumes once with `consumeSignInRequest(name)` after the server has loaded.

**C6 (minor).** After a `McpPreflightError` nothing was sent: no "may already be stored" sentence
and no re-read.

**C7 (minor). Custom add after a timeout or a network failure:** re-read the list and navigate
only if a server of that name exists **and** its URL matches what was submitted; otherwise show
the message. On success, navigate with the `name` from the gateway's answer (it strips the name).

**C8 (minor). Hook details.** The last-cancel time is kept per server at module scope (a re-opened
detail is a new hook instance). A second `signIn` while one runs answers
`{kind: 'error', message: 'A sign-in is already running.'}`. The hook exposes `cancelling` so the
card can say "Cancelling…" during the up-to-45 s start. The unmount cleanup also calls
`dismissBrowser` best-effort. The cancel flag is reset when a sign-in starts.

**C9 (minor). The form.** It stays busy after `ok` (the screen navigates away). A missing required
field reads "<label> is required." A ref latch makes the double-press guard independent of render
timing, and the test presses twice. A test covers an unmount during the request.

**C10 (minor).** The custom screen sets `submitting` inside `onSubmit` and disables the URL, name
and auth controls while it is true.

**C11 (minor). Wording and docs.** The fast GET is outside `withSecrets`. "Face ID immediately
before any request" has two stated gaps, as in spec §5.9: the fast GET, and the single re-run by
`withAuthRetry` after a silent re-login. The comment at `MAX_REQUEST_TIMEOUT_MS` in
`restClient.ts` and spec §6.1 name the install too. Sign-in is owned by the detail screen only (a
recorded deviation from spec §5.4, which had the add screens start it).

**C12 (minor). The write pass.** `Alert.alert` is native: the pass patches it through the
debugger before pressing Remove (and Reload), captures the buttons, and calls the confirming one.
The entry chosen has no `required_env`. Besides "add, switch, test, remove", the pass makes the
gateway open three connections to the third-party server (the install's probe, the automatic test,
the explicit test), rewrites `config.yaml` five times, and reloads its connectors twice (once to
see the new connector load, once after removing it, so the gateway ends as it started). Whether a
new chat has the tools is deliberately not checked: that would be another write.

**C13 (minor). Tests added to the lists below.** Task 5: Remove, Test and the switch disabled during
a sign-in; Remove answering 404 navigates; `AuthError` from `signIn` goes to `/`. Task 4: `signIn`
rejecting with `AuthError` resets `phase`; a foreign `redirect_uri` through the real `checkUrl`
wiring. Task 6: no "About" link for a non-https `source`; "Already added / Open"; the unsupported
and empty catalog states; the name suggestion stops once he edits the name; `AuthError` on each add
path; the `+` button hidden when unsupported; the pushed route's params never contain the token.

**C14 (minor). Catalog states.** An empty catalog (the gateway answers 200 with no entries when
its own read fails) has its own text. The "Custom server" row stays visible when the catalog fails
to load.


## File Structure

| File | Responsibility |
| --- | --- |
| `src/api/mcp.ts` (modify) | `McpPreflightError` (renamed from `OauthPreflightError`); `installMcpCatalogEntry` sends a fast request first and uses 45 s. |
| `src/lib/mcp.ts` (modify) | `SecretField`, `secretFieldsForEntry`, `collectSecretValues`, `catalogAuthLabel`, `signInLabel`, `removeConfirmation`; `connectorError` understands `McpPreflightError`. |
| `src/lib/mcp-oauth.ts` (modify) | `oauthPhaseLine(phase)`; uses the renamed error. |
| `src/components/connector-secret-form.tsx` (create) | The secret fields, Face ID, and the submit button. |
| `src/components/connector-sign-in.ts` (create) | `useConnectorSignIn(profile)`. |
| `src/components/connector-sign-in-card.tsx` (create) | The Sign in button, the running phase with Cancel, and the outcome line. |
| `src/app/connectors/server/[name].tsx` (modify) | Sign in (also started by `?signin=1`), Remove. |
| `src/app/connectors.tsx` (modify) | The `+` header button; an Add button in the empty state. |
| `src/app/connectors/add.tsx` (create) | Catalog browser with search and a "Custom server" row. |
| `src/app/connectors/catalog/[name].tsx` (create) | One catalog entry and its Add form. |
| `src/app/connectors/custom.tsx` (create) | The custom server form. |
| `docs/contracts/mcp.md`, `AGENTS.md` (modify) | What was learned; architecture entries. |

---

### Task 1: The install request follows the slow-request rule

**Files:** `src/api/mcp.ts`, `src/lib/mcp.ts`, `src/lib/mcp-oauth.ts`; tests `__tests__/mcp.test.ts`, `__tests__/mcp-lib.test.ts`, `__tests__/mcp-oauth.test.ts`.

**Interfaces produced:**

- `export class McpPreflightError extends Error { readonly reason: unknown }` — the fast request sent before a slow one failed, so the slow request was **not** sent. Replaces `OauthPreflightError` everywhere (no alias).
- `export const INSTALL_TIMEOUT_MS = 45_000`.
- `installMcpCatalogEntry(rest, name, env, profile?)`: `GET /api/mcp/servers` first (an `AuthError` passes through; anything else becomes `McpPreflightError`), then the POST with `{ timeoutMs: INSTALL_TIMEOUT_MS }`, inside `withSecrets(Object.values(env), …)`.
- `connectorError(error, action)`: when `error` is a `McpPreflightError`, return `connectorError(error.reason, 'list')` — nothing was sent, and the failure is about reaching the gateway. `startFailure` in `mcp-oauth.ts` drops its own branch for it.

**Tests (written first):**

- install sends the GET first, then the POST with the 45 s limit; body `{name, env, enable: true}`; profile on both.
- install does not POST when the GET fails; a 401 on the GET is an `AuthError`; another failure is a `McpPreflightError` carrying the reason.
- an install error that echoes an env value is cleaned (stub `rest` whose `post` rejects with `HttpError(400, …value…)`; the existing test passed for the wrong reason once the GET exists).
- `connectorError(new McpPreflightError(new HttpError(0, …)), 'install')` is "The gateway did not answer in time." with **no** "Check the list" suffix (nothing was sent); with a 404 "Not Found" reason it is the unsupported message.
- the two existing preflight tests in `mcp-oauth.test.ts` keep passing with the renamed class.

Commit: `feat(mcp): catalog install follows the slow-request rule`.

---

### Task 2: Helpers for the add forms (`src/lib/mcp.ts`, `src/lib/mcp-oauth.ts`)

**Interfaces produced:**

```ts
export interface SecretField { key: string; label: string; masked: boolean; required: boolean }

/** One field per declared variable: label = the gateway's prompt (or the name), masked unless isPlainEnvField. */
export function secretFieldsForEntry(entry: McpCatalogEntry): SecretField[]

/** Trimmed non-blank values, and the first required field left blank (or null). */
export function collectSecretValues(fields: SecretField[], values: Record<string, string>):
  { env: Record<string, string>; missing: SecretField | null }

/** 'OAuth sign-in' | 'No sign-in needed' | the raw auth_type for anything else. */
export function catalogAuthLabel(entry: McpCatalogEntry): string

/** 'Sign in again' only when the last test reported tokensPresent === true (ok or failed); else 'Sign in'. */
export function signInLabel(outcome: McpTestOutcome | null): 'Sign in' | 'Sign in again'

/** Title and message of the Remove alert. The message says what stays on the gateway. */
export function removeConfirmation(name: string): { title: string; message: string }

// src/lib/mcp-oauth.ts
export function oauthPhaseLine(phase: OauthPhase): string
// starting → 'Starting sign-in…'; browser → 'Waiting for you to finish in the browser…'; finishing → 'Finishing sign-in…'
```

`removeConfirmation(name).message`: "The agent stops using it after the gateway restarts. Its sign-in and any stored token stay on the gateway until they are removed there."

**Tests:** each function, including an entry with `required_env` missing or with a blank `prompt`; `collectSecretValues` trimming, omitting blanks, and reporting the first missing required field; `signInLabel` for null, `error`, ok with `tokensPresent` true / null, failed with `tokensPresent` true / false.

Commit: `feat(mcp): helpers for the add forms`.

---

### Task 3: `ConnectorSecretForm` (`src/components/connector-secret-form.tsx`)

**Interface:**

```ts
export type SubmitResult = { ok: true } | { ok: false; message: string };

export function ConnectorSecretForm(props: {
  fields: SecretField[];            // may be empty: then no Face ID is asked
  submitLabel: string;              // also the button's accessibility label
  busyLabel?: string;               // default 'Adding…'
  beforeSubmit?: () => boolean;     // the screen's own checks; false stops before Face ID
  onSubmit: (values: Record<string, string>) => Promise<SubmitResult>;
  authenticate?: (reason: string) => Promise<BiometricOutcome>;   // default confirmWithBiometrics
}): JSX.Element
```

**Behaviour, in order, on press:** ignore while busy → clear the note → `beforeSubmit` → `collectSecretValues`; a missing required field shows "Enter <label>." and stops → if any value will be sent, Face ID; not ok shows the same three notes as the secure-entry card and stops → `onSubmit(env)`; a throw is replaced by a fixed message, never shown → on `ok` clear the values; otherwise keep them and show `message` (if not empty). After an unmount during Face ID or the request, nothing further happens.

The button reads "<submitLabel> with Face ID" when there are fields, "<busyLabel>" while busy. Under the fields: "Sent to your gateway and stored there. The app does not keep it."

**Tests** (`__tests__/connector-secret-form.test.tsx`): Face ID before `onSubmit`, and the value reaches only `onSubmit`; cancelled / failed / unavailable send nothing, show the note and keep the value; no fields → no Face ID; a required blank stops before Face ID; blank optional omitted and values trimmed; only blank optional fields → submit without Face ID; `beforeSubmit` false stops everything; cleared on success; kept with the message on failure; a throwing `onSubmit` shows the fixed message and never the thrown text; nothing logged; input props (masked vs plain, and the five "do not save or learn" props); disabled while the request is out; unmount during Face ID sends nothing.

Commit: `feat(mcp): ConnectorSecretForm — Face ID before any request that carries a value`.

---

### Task 4: `useConnectorSignIn` and the sign-in card

**Files:** `src/components/connector-sign-in.ts`, `src/components/connector-sign-in-card.tsx`; tests `__tests__/connector-sign-in.test.tsx`, `__tests__/connector-sign-in-card.test.tsx`.

**Interfaces:**

```ts
export interface ConnectorSignIn {
  phase: OauthPhase | null;                         // null when no sign-in is running
  signIn: (name: string) => Promise<OauthOutcome>;  // rejects only with AuthError
  cancel: () => void;                               // takes effect at the sequence's next tick
}
export function useConnectorSignIn(profile: string | null, timing?: Pick<OauthDeps, 'sleep' | 'now'>): ConnectorSignIn

export function ConnectorSignInCard(props: {
  label: 'Sign in' | 'Sign in again';
  phase: OauthPhase | null;
  note: { tone: 'error' | 'info'; text: string } | null;
  disabled?: boolean;
  onSignIn: () => void;
  onCancel: () => void;
}): JSX.Element
```

**Hook behaviour:**

- Refuses, without any request, when the gateway URL (`getRest().baseUrl`) is missing or not `https://`: `{kind: 'error', message: 'Sign-in needs the gateway on an https:// address; providers do not accept a plain-HTTP redirect.'}`.
- Refuses a second sign-in while one runs.
- Wires `runOauthSignIn`: `start`/`poll`/`cancel` through `withAuthRetry` and the plan 1 REST calls; `checkUrl` = `checkAuthorizationUrl(url, baseUrl)`; `retryConflict` true when this hook cancelled a flow for the same server in the last 10 s; `onPhase` into state (not after unmount); `isCancelled` reads a ref set by `cancel()` and on unmount.
- `openBrowser`: iOS → `WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'cancel' })` (its promise resolves when the page closes; `{type: 'locked'}` is handled by the sequence). Other platforms → open, then resolve when the app has left the foreground and come back (`AppState`), because a Custom Tab resolves at once.
- `dismissBrowser`: iOS → `WebBrowser.dismissBrowser()`; elsewhere a no-op.
- Leaving the screen sets the cancel flag, so the sequence cancels the flow (review focus 1). `phase` returns to null when the sequence ends.

**Card:** while `phase` is set, an activity indicator with `oauthPhaseLine(phase)` and a "Cancel" button (label "Cancel sign-in"); otherwise the Sign in button (disabled when `disabled`). The note, when present, below: error tone in the danger colour, **not selectable** (it can be gateway text).

**Tests:** hook, with `expo-web-browser`, `../src/connection` and `../src/api/mcp`'s three flow calls mocked and an injected `timing`: http gateway refused with no request; approved path returns the tools and resets `phase`; `cancel()` during the browser phase ends in `cancelled` and calls the cancel route; unmount during the flow calls the cancel route; a second concurrent `signIn` is refused; `retryConflict` is passed after a recent cancel. Card: button label and press; running state shows the phase line and Cancel; note tones; note not selectable.

Commit: `feat(mcp): useConnectorSignIn and the sign-in card`.

---

### Task 5: Sign in and Remove on the detail screen

**File:** `src/app/connectors/server/[name].tsx`; tests in `__tests__/connectors-screens.test.tsx` (the hook module is mocked there with a controllable `signIn`).

**Behaviour:**

- **Sign-in card** when `caps.canSignIn`. Label from `signInLabel(last test outcome)`.
- **Starting a sign-in** bumps the test sequence counter, so a test already in flight cannot overwrite what follows (review focus 2), clears the note, and calls `signIn(name)`.
  - `approved`: the test card shows the result as a passed test (`{kind: 'ok', tools, prompts: 0, resources: 0, tokensPresent: true}`), the note says "Signed in.", and the status line is re-read.
  - `cancelled`: note "Sign-in cancelled." (info), then run a test, so a sign-in that did complete on the gateway still shows.
  - `error`: the message as an error note; when `gone`, re-read the server (it then shows "Connector not found").
  - `AuthError`: to the sign-in screen, as everywhere.
- **`?signin=1`** (set by the add screens for an OAuth connector): once the server has loaded and `canSignIn`, start a sign-in once. The automatic test is skipped in that case; the sign-in's own result takes its place.
- **Remove** when `caps.canRemove`, disabled while a sign-in or a switch is running: `Alert.alert` with `removeConfirmation(name)` and a destructive "Remove" button → `removeMcpServer` → `router.dismissTo('/connectors')`. A 404 means it is already gone: same navigation. Another failure shows the message and stays.
- The Test button is disabled while a sign-in runs.

**Tests:** approved shows the tools and "Signed in."; a test that resolves after sign-in started does not overwrite it; cancelled shows the note and runs a test; error note; `gone` re-reads; `signin=1` starts exactly one sign-in and no automatic test; no sign-in card for a non-OAuth or plugin server; Remove asks first (spy on `Alert.alert`), calls the API on confirm and lands on `/connectors`; cancelling the alert does nothing; Remove failing shows the message; no Remove for stdio or plugin servers.

Commit: `feat(mcp): sign in and remove on the connector detail`.

---

### Task 6: The add screens and the entry points

**Files:** `src/app/connectors/add.tsx`, `src/app/connectors/catalog/[name].tsx`, `src/app/connectors/custom.tsx`, `src/app/connectors.tsx`; tests `__tests__/connectors-add-screens.test.tsx`.

**List (`connectors.tsx`):** a `+` header button ("Add connector") to `/connectors/add`; the empty state gains an "Add a connector" button. Not shown when the gateway is unsupported.

**Catalog (`add.tsx`):** title "Add connector". Loads `listMcpCatalog`; shows `remoteCatalogEntries`, filtered by the header search (`filterCatalog`). The first row is "Custom server — add one by URL" → `/connectors/custom`. Each entry row: name, description (two lines), `catalogAuthLabel`, and "Added" when `installed`. Pressing an installed entry opens its server detail; any other opens `/connectors/catalog/[name]`. Errors through `connectorError(e, 'catalog')`, including the unsupported state.

**Catalog entry (`catalog/[name].tsx`):** description; Address (the URL, selectable); Sign-in (`catalogAuthLabel`); "About this connector" link when `source` is `https://` (`Linking.openURL`). When already installed: "Already added" and an "Open" button instead of the form. Otherwise `ConnectorSecretForm` with `secretFieldsForEntry(entry)` and "Add connector".

- `onSubmit(env)`: `installMcpCatalogEntry`. On success → `router.dismissTo('/connectors')`, then push the detail with `signin: '1'` when `auth_type` is `oauth`; return `{ok: true}`.
- On failure: `AuthError` → sign-in screen. Otherwise re-read the catalog (review focus 3 and 4): if the entry is now installed, navigate as on success; if not, return the mapped message, followed by " What you entered may already be stored on the gateway." when `env` was not empty. The entry on screen is refreshed, so "Already added / Open" appears if that is now the truth.

**Custom (`custom.tsx`):** title "Custom server". Fields: URL, Name (suggested from the URL by `suggestServerName` until he edits the name), Authentication (None / Bearer token / OAuth, three radio buttons), and `ConnectorSecretForm` — keyed by the auth choice so a typed token is dropped when he switches away — with one masked required "Token" field for Bearer token and none otherwise.

- `beforeSubmit`: show the issues from `validateCustomServer({name, url, auth, hasToken: true})` and return whether it is valid (the form checks the token itself). The http caution shows as soon as the URL is http.
- OAuth chosen while the gateway is not on https: a note under the choice, and `beforeSubmit` returns false.
- `onSubmit(values)`: `addMcpServer` with the matching body (`bearer_token: values.token`). Success → `dismissTo('/connectors')` and push the detail, with `signin: '1'` for OAuth. Failure: `AuthError` → sign-in screen; on a timeout re-read the server list and navigate if the name now exists; otherwise return the mapped message.
- The keyboard must not cover the fields: `ScrollView` with `automaticallyAdjustKeyboardInsets` and `keyboardShouldPersistTaps="handled"`.

**Tests** (router tests with the REST layer, the hook and Face ID mocked): the catalog lists only remote entries and filters; the Custom row and an entry row navigate; an installed entry opens its detail; installing a no-auth entry lands on the detail **without** `signin`; an OAuth entry lands with `signin=1`; back from the detail goes to the list, not the form; an install failure shows the message and, with credentials, the "may already be stored" sentence; an install that failed but did install navigates; the custom form's validation messages; a bearer add calls Face ID first and sends the token only to `addMcpServer`; switching the auth choice drops a typed token; OAuth on an http gateway is refused with the note; a 409 shows the gateway's reason; a timeout that did create the server navigates.

Commit: `feat(mcp): add a connector from the catalog or by URL`.

---

### Task 7: Simulator pass, docs

- [ ] **Screenshots**, dark and light: list with `+`, catalog, an OAuth entry, a no-auth entry, the custom form with each auth choice (no token typed).
- [ ] **The approved write pass**, driven through the debugger on the simulator only:
  1. Add one no-auth catalog entry. Expect to land on its detail; the automatic test runs.
  2. Back on the list, expect its status "Not loaded yet · changes after restart" (this is spec R3: observed, not just read from the source). Record what it shows.
  3. Switch it off and on.
  4. Remove it; confirm through the alert's button handler. Expect the list without it.
  5. Read the list once more over REST to confirm it is gone.
- [ ] **Not exercised here:** OAuth sign-in and the bearer-token form (his accounts, Face ID): his device.
- [ ] `docs/contracts/mcp.md`: what removal leaves behind; install is named after its entry and probes the server; the install timeout.
- [ ] `AGENTS.md`: architecture entries for the three screens, the form, the hook and the card; a line in "Secure entry" that the connector forms follow the same rules through `ConnectorSecretForm`.

Commit: `docs: connectors add flow — contract notes and architecture entries`.

---

### Task 8: Whole-branch review and PR

One fresh reviewer over `git diff feat/mcp-connectors-manage...HEAD`, with the spec (`.expo/qa/spec.md`), focused on §5.9 (can a typed value reach anything but the request body?), the sign-in ownership on the detail screen, and the five review-focus cases. Address the findings; gate; push; open the PR against `feat/mcp-connectors-manage`; `gh pr checks --watch` must exit 0. Merge order is #39, #40, #41, then this one, each retargeted to `main` before its base branch is deleted.
