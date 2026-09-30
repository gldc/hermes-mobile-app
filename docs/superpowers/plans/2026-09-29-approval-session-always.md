# Approval card: session / always choices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The approval card offers every choice the server offers — `once`, `session`, `always`, `deny` — instead of only once/deny, and the settled card names the choice.

**Architecture:** A pure `approvalChoices(params)` in `src/lib/approval.ts` derives the extra choices from the request's precomputed `choices` (0.21.5 `approval` server request and legacy 0.20.4 `approval.request` both carry it), with the desktop client's fallback when it is absent. The card keeps Deny | Approve and adds a "More options" link under them that opens the existing native action sheet (`showActionSheet`) with "Allow for this session" and "Always allow…"; "Always allow…" confirms with a destructive `Alert` because it persists the pattern to the gateway's `config.yaml`. The responder (`request-answers.ts`) is already choice-agnostic and guards on the store's card, so no transport change.

**Tech Stack:** Expo SDK 56, React Native 0.85, TypeScript, jest-expo + @testing-library/react-native.

**Spec (decisions, 2026-09-29):**
- Gianluca picked the layout: "More… sheet" — Deny | Approve unchanged; a small "More options" link under them opens the native action sheet (`Allow for this session`, `Always allow…`, `Cancel`); `Always allow…` → confirm alert; resolved row names the choice (e.g. "✓ Allowed for this session").
- Server truth, hermes-agent `v2026.9.24` `tui_gateway/server.py::_approval_request_payload`: if `choices` is absent the server computes `["once"] + (["session"] + (["always"] if allow_permanent is not False) if not smart_denied and allow_session is not False) + ["deny"]`. The client must show only what `choices` contains.
- Desktop reference, `apps/desktop/src/components/assistant-ui/tool/approval.tsx` at `v2026.9.24`: `choices = request.choices ?? (smartDenied ? ['once','deny'] : undefined)`; `allowSession = choices ? choices.includes('session') : true`; `allowAlways = choices ? choices.includes('always') : allowPermanent !== false`; "Always allow" opens a confirm dialog explaining it adds the pattern to the permanent allowlist (`~/.hermes/config.yaml`) and Hermes stops asking, in this and future sessions.

## Global Constraints

- Branch `feat/approval-choices`, worktree `/Users/gldc/Developer/hermes-mobile-app/.claude/worktrees/approval-choices`. PR-only, never push `main`.
- Types only from `@/vendor/hermes-gateway` (`ApprovalChoice`, `ApprovalRequestParams`, `ApprovalResult`); no local aliases or parallel interfaces. Never edit `src/vendor/**`.
- No new dependencies; the sheet is `src/lib/action-sheet.ts`'s `showActionSheet`.
- Light and dark mode both legible; 44 pt minimum touch target for "More options"; Dynamic Type safe (no clipping at XXXL).
- Before every commit: `npx tsc --noEmit && npx jest`, each gated on its own exit code. (Lint: this branch starts from `main`, which has 11 pre-existing lint problems fixed on `chore/lint-ci`; after that PR merges, rebase and make `npm run lint` pass too.)
- **Never choose "Always allow" against the live gateway during verification** — it writes a permanent allowlist entry into dc1-1's live `config.yaml`. Live-verify `session`; verify `always` up to the confirm alert and Cancel, plus unit tests for the wire.

## Review Focus

1. The card settles (timeout, answered on another surface, turn interrupted) while the action sheet or the Always confirm is open, then the user picks an option: nothing is sent and no error shows (the responder's `isPending` guard returns `{ok:true}`; the card must not crash on a stale closure).
2. Legacy FIFO card that is not the oldest (`actionable=false`): "More options" is disabled like Approve, and the sheet cannot open.
3. `choices` = `['once','deny']` (Tirith `smart_denied`) or `allow_session:false`: no "More options" link at all.
4. `choices` contains unknown strings or non-strings: they are ignored, never sent.
5. VoiceOver: "More options" announces as a button with a label saying what it does; the settled row's label names the choice ("Approval Allowed for this session").

---

### Task 1: `approvalChoices` — which extra choices the request offers

**Files:** Modify `src/lib/approval.ts`; Test `src/lib/__tests__/approval.test.ts`

**Interfaces:** Produces `export function approvalChoices(params: unknown): { session: boolean; always: boolean }`.

- [ ] Step 1: failing tests (append to `src/lib/__tests__/approval.test.ts`):

```ts
describe('approvalChoices', () => {
  test.each([
    [{ choices: ['once', 'session', 'always', 'deny'] }, { session: true, always: true }],
    [{ choices: ['once', 'session', 'deny'] }, { session: true, always: false }],
    [{ choices: ['once', 'deny'] }, { session: false, always: false }],
    [{ choices: ['once', 'deny'], allow_session: true, allow_permanent: true }, { session: false, always: false }], // choices win
    [{ choices: ['once', 'bogus', 7, 'always', 'deny'] }, { session: false, always: true }],
    [{}, { session: true, always: true }], // desktop fallback: no choices → session shown, always unless allow_permanent === false
    [{ allow_permanent: false }, { session: true, always: false }],
    [{ smart_denied: true }, { session: false, always: false }],
    [{ allow_session: false }, { session: false, always: false }],
    [null, { session: true, always: true }],
  ])('%j → %j', (params, expected) => {
    expect(approvalChoices(params)).toEqual(expected);
  });
});
```

  Run `npx jest src/lib/__tests__/approval.test.ts` → FAIL (`approvalChoices` not exported).
- [ ] Step 2: implement in `src/lib/approval.ts` (below `approvalView`), mirroring the server's fallback so `allow_session:false` hides both:

```ts
/** Which choices beyond once/deny the request offers. `choices` is precomputed server-side
 *  (`_approval_request_payload`, v2026.9.24) and wins; without it, the server's own rule. */
export function approvalChoices(params: unknown): { session: boolean; always: boolean } {
  const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
  if (Array.isArray(p.choices)) {
    const offered = new Set(p.choices.filter((c): c is ApprovalChoice => c === 'session' || c === 'always'));
    return { session: offered.has('session'), always: offered.has('always') };
  }
  const session = !p.smart_denied && p.allow_session !== false;
  return { session, always: session && p.allow_permanent !== false };
}
```

  (`import type { ApprovalChoice } from '@/vendor/hermes-gateway';` at the top.) Note the fallback follows the **server** (always requires session), which is stricter than desktop's; the `[{ allow_session: false }, …]` case pins it.
- [ ] Step 3: tests pass; tsc green. Commit `feat(approval): approvalChoices derives session/always from the request's choices`.

### Task 2: the card — More options sheet, Always confirm, settled labels

**Files:** Modify `src/components/approval-card.tsx`; Test `__tests__/approval-card.test.tsx`

**Interfaces:** Consumes `approvalChoices`; `showActionSheet(title, actions)` from `@/lib/action-sheet`; `Alert` from `react-native`. `onRespond(choice: ApprovalResult['choice'])` unchanged.

- [ ] Step 1: failing tests in `__tests__/approval-card.test.tsx`. Mock the sheet and capture the Alert:

```ts
const sheet = jest.fn();
jest.mock('../src/lib/action-sheet', () => ({ showActionSheet: (...a: unknown[]) => sheet(...a) }));
import { Alert } from 'react-native';
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
beforeEach(() => { sheet.mockReset(); alertSpy.mockClear(); });
const all4 = { session_id: 's', request_id: 'r', command: 'rm -rf build', description: 'Recursive delete', pattern_key: 'recursive delete', choices: ['once', 'session', 'always', 'deny'] };
```

  Tests:
  - offers both: press `More approval options` → `sheet` called once with title `'recursive delete'` and actions labelled `['Allow for this session', 'Always allow…']`; invoking action 0's `onPress` → `onRespond('session')`.
  - always confirms: invoke action 1's `onPress` → `onRespond` not called; `Alert.alert` called with title `'Always allow this command?'`, a message containing `recursive delete` and `config.yaml`, and buttons `[{text:'Cancel', style:'cancel'}, {text:'Always allow', style:'destructive', onPress}]`; invoking the destructive `onPress` → `onRespond('always')`; Cancel's absence of onPress sends nothing.
  - only session offered (`choices: ['once','session','deny']`) → sheet actions `['Allow for this session']`.
  - none offered (`choices: ['once','deny']`) → `queryByRole('button', { name: 'More approval options' })` is null.
  - legacy not-oldest (`legacy:true`, `actionable={false}`, full choices) → the button is disabled (`accessibilityState.disabled`), pressing it does not call `sheet`.
  - settled labels, extend the existing `test.each`: `resolution: 'session'` → `'Allowed for this session'`; `resolution: 'always'` → `'Always allowed'`; `'once'` stays `'Approved'`; `'deny'` stays `'Denied'`. And the row's accessibility label is `Approval ${label}`.
  - 44 pt: `More approval options` has `minHeight: 44`.
  - existing tests keep passing unchanged.

  Run `npx jest __tests__/approval-card.test.tsx` → FAIL.
- [ ] Step 2: implement.
  - `const extra = approvalChoices(card.params);` and `const hasMore = extra.session || extra.always;`
  - Under the Deny | Approve row, inside the `card.status === 'pending'` branch and above the legacy FIFO hint: when `hasMore`, a `Pressable` with `accessibilityRole="button"`, `accessibilityLabel="More approval options"`, `accessibilityHint="Allow for this session or always"`, `accessibilityState={{ disabled: !canAct }}`, `disabled={!canAct}`, `hitSlop={8}`, style `{ alignSelf: 'center', minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, opacity: !canAct ? 0.45 : pressed ? 0.6 : 1 }`, containing `Text` "More options" (`colors.textDim`, 13.5, weight 600) and `Icon sf="chevron.down"` size 11 `colors.textDim` (add the SF→fallback mapping to `src/lib/icon-map.ts` if `chevron.down` is not already mapped — check first).
  - `openMore()`: builds actions — `extra.session` → `{ label: 'Allow for this session', onPress: () => respond('session') }`; `extra.always` → `{ label: 'Always allow…', onPress: confirmAlways }` — and calls `showActionSheet(view.patternKey || undefined, actions)`.
  - `confirmAlways()`: `Alert.alert('Always allow this command?', \`Hermes adds “${view.patternKey || 'this pattern'}” to the gateway's permanent allowlist (config.yaml) and stops asking for matching commands, in this and future sessions.\`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Always allow', style: 'destructive', onPress: () => respond('always') }])`.
  - `ResolvedRow`: map `resolution` → `deny` → Denied (danger, xmark); `session` → "Allowed for this session"; `always` → "Always allowed"; anything else → "Approved" (success, checkmark).
  - Review Focus 1: `respond` already forwards to `onRespond`, whose responder no-ops on a non-pending card; do not add a second guard in the card, but make sure nothing in the sheet/alert callbacks reads state that could throw on a settled card.
- [ ] Step 3: tests pass; tsc green. Commit `feat(approval): More options sheet offers session/always; Always confirms; settled row names the choice`.

### Task 3: dev gallery, docs

**Files:** Modify `src/app/dev-cards.tsx`, `AGENTS.md` (Wire contract: approval choices bullet), `docs/contracts/approvals.md` (0.21.5 note: `choices` precomputed, client renders only those)

- [ ] Step 1: dev-cards "Approval" section: make `devApproval` carry `pattern_key: 'recursive delete'` and `choices: ['once','session','always','deny']` if it doesn't; add settled cards `resolution: 'session'` and `resolution: 'always'`, and one pending card with `choices: ['once','deny']` (no More options). Keep existing entries.
- [ ] Step 2: docs: one bullet in AGENTS.md's wire contract — "Approval choices: render only what `params.choices` offers (server-computed); `session`/`always` live behind More options; `always` confirms first (it persists to the gateway's config.yaml)." Add a short "0.21.5" paragraph to `docs/contracts/approvals.md` citing `_approval_request_payload` at v2026.9.24.
- [ ] Step 3: tsc + jest green. Commit `docs(approval): dev gallery and contract notes for session/always`.

### Task 4: simulator verification (iPhone 17 Pro sim, password session)

- [ ] Metro from this worktree on a free port (8082 if free), dev client on the booted iPhone 17 Pro (26.5, `4C1AF3F4-…`).
- [ ] V1 gallery: `xcrun simctl openurl booted hermesmobileapp://dev-cards` → screenshot Approval section, light and dark (`xcrun simctl ui booted appearance dark|light`), and at XXXL (`xcrun simctl ui booted content_size accessibility-extra-extra-extra-large`, reset to `large` after).
- [ ] V2 sheet: on a pending gallery card tap More options → native sheet lists both options + Cancel (screenshot); tap Always allow… → confirm alert (screenshot) → Cancel.
- [ ] V3 live session: in a new chat ask the agent to run a command that needs approval (e.g. `rm -rf /tmp/hermes-approval-test`) → card shows More options → Allow for this session → settled row "Allowed for this session"; ask for a second matching command in the same chat → it runs without a new card (server honoured `session`). Screenshots.
- [ ] V4 live always (no persist): trigger another card, More options → Always allow… → Cancel → card still pending → Deny → "Denied".
- [ ] Record V1–V4 in the PR body with screenshot paths; then open the PR, CI green (once `chore/lint-ci` is merged and this branch rebased), hand to Gianluca for QA.

---

## Review rulings (2026-09-29 adversarial review — BINDING; they override the task text above where they conflict)

R1. Task 2 test: `jest.mock` factories may only reference `mock`-prefixed variables — name the sheet spy `mockSheet` (precedent: `mockIcon` in `__tests__/transcript-markers.test.tsx`).

R2. Task 1 test path: append to the existing `__tests__/approval.test.ts` (imports `../src/lib/approval`); add `approvalChoices` to its import. `src/lib/__tests__/approval.test.ts` does not exist — do not create it.

R3. Legacy wording: 0.20.4's `_approval_request_payload` (`v2026.8.18` `server.py:1922`) adds `choices` only when `smart_denied` is set or `allow_permanent` is present (the notify path always sends `allow_permanent: True`), and its `approval.respond` accepts every choice (`session`/`always` honoured). `approvalChoices` covers both shapes unchanged. 0.21.5 downgrades Tirith pattern keys from `always` to session scope (`tools/approval.py::_persist_choice`); keep the label "Always allowed" but note this in the PR body.

R4. Verification safety (replaces Task 4 V3/V4):
- V2 (gallery) is the only place "Always allow…" is opened; there tap it, screenshot the alert, Cancel. The gallery's `onRespond` is a no-op.
- V3 live: use a throwaway new chat; after the check, archive that chat. The `session` approval lives in the gateway's memory for that chat only.
- V4 live: in a second throwaway chat, trigger a card, open More options, dismiss the sheet with Cancel (card stays pending), then Deny → "Denied". Archive that chat too. Never open "Always allow…" against the live gateway.
- Never change `approvals.mode`, yolo, or any gateway config to force a card. If no card appears (the smart guardian auto-approves), try a command the static patterns flag (e.g. `chmod -R 777 /tmp/hermes-approval-test`); if still none, report instead of changing config.
