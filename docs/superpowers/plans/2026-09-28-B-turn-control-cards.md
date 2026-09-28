# Turn control + server-request cards (App B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Revision log (review 2026-09-28)

This plan was written before Plan A's final code existed. The adversarial review re-based it on A's
actual code blocks (`2026-09-28-A-transport.md` Tasks 3–8). Changes:

1. **Task 1** no longer re-implements D1/D2 (A's reducer already does `resolution`, re-delivery reset and
   the `params.answers` merge). B only appends `composerMode` + `isApprovalActionable`; the D1/D2 tests stay
   as regression tests against A's reducer. B's `answerRequest` was dropped (it removed A's "only open
   cards can be answered" guard).
2. **Task 2** uses A's `withStaleSessionRetry(sessionId, run, resume)` from `src/api/stale-session.ts`
   instead of a second copy with a different signature; `resumeStored` now returns the fresh live id
   (A's `ChatTransport.resumeStored()`). The 15 s stop fallback now re-enables Stop (`stop.failed`) if the
   `stop-timeout` reconnect finds the turn still running (A keeps `stopping` on `resume.seeded{running}`).
3. **Task 4** wiring rewritten against A's screen: `callGw()` null-safe helper (A's `gw()` is nullable),
   `resumeStored` via A's transport, and the "Stopped" marker edited inside A's `applyEvent` (A has no
   screen-level `dispatchTurn(event.message.complete)` and no `replayed` variable; it has `live`/`status`).
4. **Task 7** keeps `tsc` green: it updates A's `renderRequest` approval branch to the new `ApprovalCard`
   props and deletes A's `activeLegacyId`/`approvalInfo` — it must **not** delete A's `respondApproval`
   (still used until Task 11).
5. **Task 9** appends to the existing `__tests__/skills.test.ts` (the old step would have overwritten it).
6. **Task 10** data test installs the fake `WebSocket` global (A's fixture contract).
7. **Task 11** uses A's `mergeRequestRows`/`TranscriptRow`/`reversedRows` (B's `mergeTranscript` would
   clash with A's `TranscriptRow` import and change orphan semantics); `transcript-rows.ts` now holds only
   `rowIndexOf`. It replaces A's `renderRequest` and `respondApproval` instead of the FlatList props.
8. **Merge order with Plan C** made explicit (C merges first; Task 4's composer edits are written
   against C's file). Gate-then-commit made exit-code-safe. Setup moved to the top. A 0.21.5
   "reconnect mid-turn → partial text restored" check added to Task 11 Step 8.
9. **Re-anchored on Plan C's shipped code (2026-09-28 final review of C).** C's plan text changed mid-
   implementation — the `onContentSizeChange`/`height`/`contentHeight` shape below never shipped. Task 4's
   "Merge order with Plan C" note and Step 3 are corrected to C's actual `composer.tsx` at HEAD
   (`useLayoutEffect, useState` import, `composerMinHeight` from `@/lib/composer-height`, the
   `emptyCommitted` state + `useLayoutEffect` block, and `minHeight`/`maxHeight` in `style` — no
   `onContentSizeChange`, no `style.height`). Task 4 also gets a new requirement: C's fix only re-measures a
   JS-driven clear, not the steer-failure restore this plan adds, so Task 4 must add its own follow-up-commit
   trigger for that case.

**Goal:** Give the chat screen a Stop button, steer-while-running, and interactive cards for every
mobile-supported server request (approval on both paths, clarify single + batch, sudo/secret secure
entry behind Face ID, the vault-declined note), on top of Plan A's transport.

**Architecture:** All decisions live in pure, injected modules under `src/lib/` (composer mode,
stop/steer commands, request answering, clarify view model, secure-entry copy/countdown, transcript
merge) with unit tests. Components under `src/components/` are thin and tested with React Native
Testing Library. `src/app/chat/[id].tsx` only wires them to Plan A's client, turn controller,
request registry and reconnect orchestrator. Secret values exist only in one unmountable form
component's local state.

**Tech Stack:** Expo SDK 56, React Native 0.85, React 19.2 (React Compiler on), TypeScript, jest-expo,
`@testing-library/react-native` 14 (new dev dep), `expo-local-authentication` ~56.0.5 (new native dep).

**Spec:** `docs/superpowers/specs/2026-09-28-control-path-0.21.5-design.md` (rev 2, approved) —
§5.2, §5.3, §6.0–§6.4, §10.1 "Turn controller / Cards / Clarify / Secure entry". **Binding contract:**
`docs/superpowers/plans/2026-09-28-00-interfaces.md` (Plan A produces §1–§6 there; this plan consumes
them). Evidence: `docs/research/2026-09-28-api-delta-0.21.5.md` §1–§2, `docs/research/2026-09-28-spec-review.md`
(M5, M8, M10, m9, m11, m12, m14, m15, m16).

**Base:** Plan A (`2026-09-28-A-transport.md`) is **merged to `main` first**. This branch,
`feat/turn-control-cards`, is cut from A's merged `main` — run the **Setup** step in "Branch
verification and PR" (end of this plan) **before Task 1**.

**Merge order with Plan C:** C (`fix/attach-sheet-composer-height`, independent, small) **merges before
B**. Task 4's composer edits are written against C's resulting `composer.tsx` — re-anchored 2026-09-28 on
what C actually shipped (C's plan text changed mid-implementation; see
`.superpowers/sdd/2026-09-28-C-polish/task-5-report.md` "Rework (opus)" and `final-review.md` Important #1):
C adds `import { useLayoutEffect, useState } from 'react'`, imports `composerMinHeight` from
`@/lib/composer-height`, and right after the `canSend` line adds an `emptyCommitted` state plus a
`useLayoutEffect(() => setEmptyCommitted(value === ''), [value])`. The `TextInput`'s `style` stays one
object, gaining `minHeight: composerMinHeight(value, emptyCommitted)` and `maxHeight: 120` — there is no
`contentHeight`/`composerHeight` block, no `onContentSizeChange`, and no `style.height`. B's edits (the
`canSend` line itself, props, placeholder, the right-hand button cluster) touch none of C's lines. Before
Task 4, `git fetch && git rebase origin/main` so C is in the tree; if C has **not** merged yet, Task 4 still
applies (every anchor below exists on both versions) and C rebases over B instead.

**Known gap this plan must close:** C's fix only re-measures a JS-driven **clear** (`value -> ''`) — see
`src/lib/composer-height.ts`'s header comment. Task 4's steer-failure restore
(`setInput((cur) => restoreSteerText(cur, text))`, Step 5) is a JS-driven **non-empty** set and hits the
same one-commit measure lag: a failed multi-line steer would restore at one-line height until the next
keystroke. Task 4 adds the follow-up-commit trigger for that case (see the requirement in Task 4 below).

## Global Constraints

- Colors only from `useTheme()`; never a hex literal in a component. Dark is primary, light must work.
- Stop button: `colors.text` icon on `colors.raised`; the accent is reserved for primary send/steer/confirm.
- `borderCurve: 'continuous'` on every rounded rect; inline styles; no hand memoization (React Compiler).
- SF Symbols only through `<Icon sf="…">` (expo-image); every new symbol gets an Android entry in
  `src/lib/icon-map.ts` (enforced by `__tests__/icon-map.test.ts`).
- `process.env.EXPO_OS`, never `Platform.OS`; never import `@react-navigation/*`.
- Vendored symbols are imported only via `@/vendor/hermes-gateway`; no local aliases of SDK types
  (write `ApprovalResult['choice']`, `RpcMethods['session.resume']['result']`).
- Every idle-state or fallback submit is `prompt.submit {session_id, text, queued: true}`; never a plain submit.
- Steer result handling: `queued` → "steered" bubble; `rejected` → queued submit; `4010` → queued submit;
  `4001` → resume stored id + retry once; anything else → inline error, text back in the input.
- Stop: `session.interrupt {session_id}`; result ignored; `4001` → resume + retry once; other error →
  inline error + Stop re-enabled; no `message.complete` within **15 s** → `orchestrator.reconnect('stop-timeout')`.
- `message.complete status:"interrupted"` → "Stopped" marker, **no success haptic**; replayed events never fire haptics.
- Cards answer optimistically on send (no ack at 0.21.5). Legacy (0.20.4) approvals are FIFO via
  `approval.respond {session_id, choice}`; 0.21.5 approvals are independently actionable. `all` is never sent.
- Clarify single: response `{answer}` (`""` = skip), never `clarify.lock`. Batch: `clarify.lock
  {request_id, question_id, answer}` per question, per-question skip locks `""`, **Submit all** locks the
  remaining in order, **Skip all** responds `{}` (no `answers`), `expired` → "Timed out", multi-select locks a real JSON array.
- Cancel labels (from A's `cancelLabel`): interrupted "Stopped", timeout "Timed out", resolved "Answered elsewhere", session_closed/shutdown "Closed".
- Vault note text, verbatim: "Hermes asked for a password-manager action — declined on the phone."
- Secure entry: secret timeout **300 s**, sudo **120 s**; titles "Administrator password" / "Value for `ENV_VAR`";
  label "Requested by the agent"; warning on **every** secret card, verbatim: "Only continue if you asked
  for this — the agent can write or edit the skill that's asking."; destination verbatim: "Saved to the
  gateway's .env — the agent can read it."; provenance `hub`/`bundled`/`agent` shown as information,
  failed lookup shows "unknown"; field `secureTextEntry`, `autoCorrect={false}`, `autoCapitalize="none"`,
  `spellCheck={false}`, `textContentType` **`password` for sudo, `none` for secret**; Skip responds
  `{value:""}`; Send requires Face ID (`expo-local-authentication`, passcode fallback) immediately before responding.
- Secret value: only in the form component's local state; never in the turn controller, `items`, history,
  AsyncStorage, SecureStore, `console.*`, an error message or telemetry; cleared on send, skip, cancel,
  timeout, unmount and interrupt; afterwards the card shows only "Sent"/"Skipped".
- `NSFaceIDUsageDescription` only via the `expo-local-authentication` config plugin (`faceIDPermission`)
  in `app.json` `plugins`. Adding it forces a **native rebuild** (`npx expo prebuild -p ios --clean && npx expo run:ios`).
- Every new control has an `accessibilityRole` + `accessibilityLabel`; toggles expose `accessibilityState`.
- Every task ends with `npx tsc --noEmit && npx jest` exiting 0 (there is no CI workflow in this repo;
  gate on the exit code, never on tailed output), then a commit. PR-only; never push `main`. The
  "Full gate + commit" blocks are **not** a script: run the gate line alone, confirm `echo $?` prints `0`,
  and only then run `git add`/`git commit` (or chain them: `npx tsc --noEmit && npx jest && git add … && git commit …`).

**Screenshot procedure** (run by every task that changes UI, with that task's `NAME`):

```bash
cd ~/Developer/hermes-mobile-app   # or the worktree path
OUT=docs/screenshots/turn-control; mkdir -p "$OUT"
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null || true; open -a Simulator
# Metro running in another terminal: `npx expo start` (dev client installed by `npx expo run:ios --device "iPhone 17 Pro"`)
xcrun simctl openurl booted "hermesmobileapp://dev-cards"
for THEME in dark light; do
  xcrun simctl ui booted appearance $THEME; sleep 2
  xcrun simctl io booted screenshot "$OUT/$NAME-$THEME.png"
done
xcrun simctl ui booted content_size accessibility-large; sleep 2
xcrun simctl io booted screenshot "$OUT/$NAME-dark-a11y.png"; xcrun simctl ui booted content_size large
```

Open every PNG with the Read tool and check: text legible in both themes, borders visible on
`colors.raised` in light, accent only on the primary action, nothing clipped at the large text size.
Scroll the gallery (drag in Simulator) and repeat the loop if the task's section is below the fold.

**A's merged `src/app/chat/[id].tsx`** (Tasks 4, 7 and 11) — these names come from A Task 8 (R3/R7/R9)
and exist verbatim; verify with
`grep -n -E "const gw = |const readTurn|const dispatchTurn|registryRef|orchestratorRef|transportRef|const resumeParams|function applyEvent|function respondApproval|function renderRequest|const reversedRows|type Row" 'src/app/chat/[id].tsx'`
(never add a second store, client or registry):

| A's name | type / meaning |
|---|---|
| `gw()` | `GatewayClient \| null` — **nullable**; B code calls through `callGw()` (Task 4) |
| `transportRef.current` | `ChatTransport \| null` — `.resumeStored(): Promise<string>` (resume the stored id, seeds the store, returns the fresh live id) |
| `turn` | `TurnModel` React state (render snapshot, mirrored from the store) |
| `readTurn()` | synchronous `store.getState()` |
| `dispatchTurn(a)` | `store.dispatch(a)` |
| `registryRef.current` | `RequestRegistry \| null` |
| `orchestratorRef.current` | `ReconnectOrchestrator \| null` (`reconnect('stop-timeout')` exists) |
| `resumeParams()` | `RpcMethods['session.resume']['params']` builder |
| `busy` | `turn.turn !== 'idle'` |
| `thinking` / `setThinking` | replaces `main`'s `waiting`/`setWaiting` (ThinkingDots) |
| `applyEvent(e)` | the transcript sink; its `case 'message.complete'` has `p`, `status` (`CompleteStatus`) and `live` (= `!e.replayed`) in scope. The store update (`event.message.complete` with `status`/`replayed`) happens in A's transport, **not** in the screen |
| `respondApproval(card, choice)` | A's interim approval answering (replaced in Task 11) |
| `rows`, `reversedRows`, `type Row = TranscriptRow<ChatItem>` | A's merged transcript (`mergeRequestRows`), newest-first for the inverted `FlatList` |
| `renderRequest(card)` | A's request-row renderer used by the `FlatList` `renderItem` (replaced in Task 11) |
| `send()` | A's idle submit (already `prompt.submit {queued:true}`) |
| `liveIdRef`, `profileRef`, `items`, `setItems`, `nextKey`, `append`, `input`, `setInput`, `stagedImage`, `setStagedImage`, `setError`, `ready` | as on `main` today |

## Review Focus

1. **Face ID prompt while the card closes or the app backgrounds.** A `request.cancel`, local timeout,
   interrupt or unmount during the system prompt must send nothing; a background (`app_cancel`) keeps the
   card open with the typed value. Tests: Task 10 "closed during Face ID", "backgrounded", "unmounted".
2. **An answered card is re-delivered after a reconnect** (the response frame died with the old socket).
   It must return to `pending` so it can be answered again through the new delivery, keep its original
   `receivedAt`, and never duplicate. Tests: Task 1 "re-delivery", Task 5 "answer again after re-delivery".
3. **Steer racing the end of the turn.** `rejected` after the turn ended locally → one queued submit and
   `submit.sent`; a late `queued` → steered bubble and no submit; `4010` never hard-interrupts. Tests:
   Task 2 "steer racing turn end".
4. **Clarify batch partially locked, then reconnect.** Replayed `answers` merge with local locks; Submit
   all locks only unlocked questions; `expired` mid-run stops and shows "Timed out"; a failed lock keeps
   earlier locks and returns the card to pending. Tests: Task 1 "merges replayed answers", Task 5
   "submitAll …", Task 8 "Submit all only sends unlocked questions".
5. **Keyboard covering a card's input** (inverted list; a tall 5-question card). Focusing an "Other…"
   or secret field must scroll that card into view. Tests: Task 8 / Task 10 "onInputFocus", Task 11
   `rowIndexOf`, plus the Task 11 keyboard screenshot.

---

## File map

| file | status | responsibility |
|---|---|---|
| `src/lib/turn-controller.ts` | modify (A's) | + `ComposerMode`, `composerMode`, `isApprovalActionable` (D1/D2 are A's) |
| `src/lib/turn-commands.ts` | create | stop/steer/queued-submit, 4010 rule, 15 s fallback, `restoreSteerText`, `completionEffects` (4001 via A's `withStaleSessionRetry`) |
| `src/lib/request-answers.ts` | create | contract result builders + `createRequestResponder` |
| `src/lib/clarify.ts` | create | clarify view model, drafts, locked-answer labels |
| `src/lib/secure-entry.ts` | create | timeouts, countdown, copy, skill name, provenance |
| `src/lib/biometric.ts` | create | `confirmWithBiometrics` over `expo-local-authentication` |
| `src/lib/transcript-rows.ts` | create | `rowIndexOf` over A's `TranscriptRow` (the merge itself is A's `mergeRequestRows`) |
| `src/lib/approval.ts` | modify | + `approvalView(params)` for both approval shapes |
| `src/lib/icon-map.ts` | modify | Android names for new SF symbols |
| `src/api/skills.ts` | modify | `provenance` on `SkillInfo`; `listSkills(rest, profile?)` |
| `src/components/composer.tsx` | modify (after C) | stop/steer UI driven by `ComposerMode` |
| `src/components/message-row.tsx` | modify | "Stopped" marker, "Steered" caption; drop dead `approval` item |
| `src/components/card-button.tsx` | create | shared card button |
| `src/components/approval-card.tsx` | rewrite | renders a `RequestCardState` (both paths) |
| `src/components/clarify-card.tsx` | create | single + batch clarify card |
| `src/components/secure-entry-card.tsx` | create | sudo/secret card + value-holding form |
| `src/components/vault-declined-note.tsx` | create | the vault note row |
| `src/app/dev-cards.tsx` | create | `__DEV__`-only gallery for screenshots |
| `src/app/chat/[id].tsx` | modify (A's) | wiring only |
| `src/lib/push.ts` | modify | `clarify_request` banner suppressed in the foreground |
| `src/lib/export.ts` | modify | drop dead `approval` item branches |
| `app.json`, `package.json`, `jest.setup.ts` | modify/create | local-auth plugin + deps, RNTL harness |

---

### Task 1: Turn-controller extensions (composer mode, approval actionability, re-delivery)

**Files:**
- Modify: `src/lib/turn-controller.ts`
- Test: `src/lib/__tests__/turn-controller-b.test.ts`

**Interfaces:**
- Consumes (A): `TurnModel`, `TurnState`, `RequestCardState` (already has `resolution?`, D1), `TurnAction`,
  `initialTurnModel`, `reduceTurn` (already implements D2: re-delivery → `pending`, keeps `receivedAt`/`anchorKey`,
  clears `cancelReason`/`resolution`, merges `params.answers`; `request.answered` only settles open cards).
- Produces: `ComposerMode`, `composerMode(model, hasText, hasImage)`, `isApprovalActionable(requests, id): boolean`.
  **Do not touch A's reducer cases.** The re-delivery tests below are regression tests pinning A's D1/D2
  behaviour that B's cards rely on (Review Focus 2, 4).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/turn-controller-b.test.ts
import {
  composerMode,
  initialTurnModel,
  isApprovalActionable,
  reduceTurn,
  type RequestCardState,
  type TurnModel,
} from '../turn-controller';

type NewCard = Omit<RequestCardState, 'status'>;
function card(over: Partial<NewCard> & { id: string }): NewCard {
  return {
    kind: 'approval',
    method: 'approval',
    params: { session_id: 's1', request_id: 'r1', command: 'rm -rf build' },
    legacy: false,
    receivedAt: 1000,
    anchorKey: null,
    ...over,
  };
}
const at = (turn: TurnModel['turn']): TurnModel => ({ ...initialTurnModel(), turn });
const recv = (m: TurnModel, c: NewCard) => reduceTurn(m, { type: 'request.received', card: c });

describe('composerMode', () => {
  it('idle: send, enabled by text or by a staged photo alone (review m9)', () => {
    expect(composerMode(at('idle'), false, false)).toEqual({ kind: 'send', enabled: false });
    expect(composerMode(at('idle'), true, false)).toEqual({ kind: 'send', enabled: true });
    expect(composerMode(at('idle'), false, true)).toEqual({ kind: 'send', enabled: true });
  });
  it('waiting/streaming: Stop always; steer only with text (images are not steerable)', () => {
    for (const t of ['waiting', 'streaming'] as const) {
      expect(composerMode(at(t), false, false)).toEqual({ kind: 'stop+steer', stopEnabled: true, steerEnabled: false });
      expect(composerMode(at(t), true, true)).toEqual({ kind: 'stop+steer', stopEnabled: true, steerEnabled: true });
      expect(composerMode(at(t), false, true)).toEqual({ kind: 'stop+steer', stopEnabled: true, steerEnabled: false });
    }
  });
  it('stopping: Stop and steer disabled', () => {
    expect(composerMode(at('stopping'), true, false)).toEqual({ kind: 'stop+steer', stopEnabled: false, steerEnabled: false });
  });
});

describe('isApprovalActionable', () => {
  it('0.21.5 approvals are independently actionable', () => {
    let m = recv(initialTurnModel(), card({ id: 'srq-a' }));
    m = recv(m, card({ id: 'srq-b' }));
    expect(isApprovalActionable(m.requests, 'srq-a')).toBe(true);
    expect(isApprovalActionable(m.requests, 'srq-b')).toBe(true);
  });
  it('legacy approvals are FIFO: only the oldest unresolved legacy card', () => {
    let m = recv(initialTurnModel(), card({ id: 'legacy:1', legacy: true }));
    m = recv(m, card({ id: 'legacy:2', legacy: true }));
    expect(isApprovalActionable(m.requests, 'legacy:1')).toBe(true);
    expect(isApprovalActionable(m.requests, 'legacy:2')).toBe(false);
    m = reduceTurn(m, { type: 'request.answered', id: 'legacy:1', resolution: 'deny' });
    expect(isApprovalActionable(m.requests, 'legacy:2')).toBe(true);
  });
  it('settled, unknown and non-approval cards are never actionable', () => {
    let m = recv(initialTurnModel(), card({ id: 'srq-a' }));
    m = reduceTurn(m, { type: 'request.cancelled', id: 'srq-a', reason: 'timeout' });
    m = recv(m, card({ id: 'srq-c', kind: 'clarify', method: 'clarify', params: { session_id: 's1', question: 'q?' } }));
    expect(isApprovalActionable(m.requests, 'srq-a')).toBe(false);
    expect(isApprovalActionable(m.requests, 'srq-c')).toBe(false);
    expect(isApprovalActionable(m.requests, 'nope')).toBe(false);
  });
});

describe('request re-delivery and resolution (Review Focus 2, 4)', () => {
  it('re-delivery of an answered card returns it to pending, keeps receivedAt, never duplicates', () => {
    let m = recv(initialTurnModel(), card({ id: 'srq-1' }));
    m = reduceTurn(m, { type: 'request.answered', id: 'srq-1', resolution: 'once' });
    expect(m.requests[0]).toMatchObject({ status: 'answered', resolution: 'once' });
    m = recv(m, card({ id: 'srq-1', receivedAt: 99_999 }));
    expect(m.requests).toHaveLength(1);
    expect(m.requests[0]).toMatchObject({ status: 'pending', receivedAt: 1000 });
    expect(m.requests[0].resolution).toBeUndefined();
    expect(m.requests[0].cancelReason).toBeUndefined();
  });
  it('merges replayed clarify answers into lockedAnswers without dropping local locks', () => {
    const params = {
      session_id: 's1',
      questions: [
        { qid: 'q0', question: 'A?', choices: null, multi_select: false },
        { qid: 'q1', question: 'B?', choices: null, multi_select: false },
        { qid: 'q2', question: 'C?', choices: null, multi_select: false },
      ],
    };
    let m = recv(initialTurnModel(), card({ id: 'srq-c', kind: 'clarify', method: 'clarify', params }));
    m = reduceTurn(m, { type: 'request.locked', id: 'srq-c', qid: 'q0', answer: 'x' });
    m = recv(m, card({ id: 'srq-c', kind: 'clarify', method: 'clarify', params: { ...params, answers: { q1: 'y' } } }));
    expect(m.requests[0].lockedAnswers).toEqual({ q0: 'x', q1: 'y' });
    expect(m.requests[0].status).toBe('pending');
  });
  it('a first delivery that already carries replayed answers renders them as locked', () => {
    const m = recv(initialTurnModel(), card({
      id: 'srq-d', kind: 'clarify', method: 'clarify',
      params: { session_id: 's1', questions: [{ qid: 'q0', question: 'A?', choices: null, multi_select: false }], answers: { q0: 'z' } },
    }));
    expect(m.requests[0].lockedAnswers).toEqual({ q0: 'z' });
  });
  it('request.answered with skipped marks skipped and records no resolution', () => {
    let m = recv(initialTurnModel(), card({ id: 'srq-s', kind: 'secure-entry', method: 'secret', params: { session_id: 's1', env_var: 'K', prompt: 'p' } }));
    m = reduceTurn(m, { type: 'request.answered', id: 'srq-s', skipped: true });
    expect(m.requests[0].status).toBe('skipped');
    expect(m.requests[0].resolution).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/turn-controller-b.test.ts`
Expected: FAIL — `composerMode is not a function` / `isApprovalActionable is not a function`. The
"request re-delivery and resolution" tests already PASS (A implements D1/D2); if any of them FAILS, A's
reducer drifted from contract §7 — stop and fix A's reducer first, with its own test.

- [ ] **Step 3: Implement**

Append to the end of `src/lib/turn-controller.ts` (no new imports; nothing else in the file changes):

```ts
// ── Plan B: composer selectors and request-card semantics ───────────────────────────────────

export type ComposerMode =
  | { kind: 'send'; enabled: boolean } // idle
  | { kind: 'stop+steer'; stopEnabled: boolean; steerEnabled: boolean }; // waiting/streaming/stopping

/** Spec §5.2. Images are not steerable, so steer needs text; a staged photo waits for idle. */
export function composerMode(model: TurnModel, hasText: boolean, hasImage: boolean): ComposerMode {
  switch (model.turn) {
    case 'idle':
      return { kind: 'send', enabled: hasText || hasImage };
    case 'waiting':
    case 'streaming':
      return { kind: 'stop+steer', stopEnabled: true, steerEnabled: hasText };
    case 'stopping':
      return { kind: 'stop+steer', stopEnabled: false, steerEnabled: false };
  }
}

/** 0.21.5 approvals resolve per request id (all actionable). Legacy approvals resolve the OLDEST
 *  pending one server-side, so only the oldest unresolved legacy card is actionable (spec §6.1). */
export function isApprovalActionable(requests: RequestCardState[], id: string): boolean {
  const card = requests.find((r) => r.id === id);
  if (!card || card.kind !== 'approval' || card.status !== 'pending') return false;
  if (!card.legacy) return true;
  const oldest = requests.find(
    (r) => r.kind === 'approval' && r.legacy && (r.status === 'pending' || r.status === 'answering'),
  );
  return oldest?.id === id;
}
```

(A's `[id].tsx` has an equivalent inline `activeLegacyId`; Task 7 replaces it with this selector.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/turn-controller-b.test.ts src/lib/__tests__/turn-controller.test.ts`
Expected: PASS (A's own suite stays green).

- [ ] **Step 5: Full gate + commit**

```bash
npx tsc --noEmit && npx jest
git add src/lib/turn-controller.ts src/lib/__tests__/turn-controller-b.test.ts
git commit -m "feat(turn): composer mode, approval actionability; pin re-delivery semantics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stop / steer commands (pure, injected)

**Files:**
- Create: `src/lib/turn-commands.ts`
- Test: `__tests__/turn-commands.test.ts`

**Interfaces:**
- Consumes: `GatewayClient['call']`, `RpcError` (A, `src/api/gatewayClient.ts`);
  `withStaleSessionRetry(sessionId, run: (sid) => Promise<T>, resume: () => Promise<string>)` (A, `src/api/stale-session.ts`
  — the single 4001 rule, also used by A's `config.set`); `TurnAction`, `TurnState`, `CompleteStatus` (A).
- Produces: `TurnCommandDeps`, `createTurnCommands(deps): TurnCommands` with `stop(): Promise<StopOutcome>`,
  `steer(text): Promise<SteerOutcome>`, `dispose()`; `restoreSteerText(current, failed)`,
  `completionEffects(status, replayed)`, constants `AGENT_BUILDING_CODE=4010`, `STOP_FALLBACK_MS=15000`.
  (No second `withStaleSessionRetry`/`STALE_SESSION_CODE` — import A's.)

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/turn-commands.test.ts
import { RpcError } from '../src/api/gatewayClient';
import {
  completionEffects,
  createTurnCommands,
  restoreSteerText,
  STOP_FALLBACK_MS,
  type TurnCommandDeps,
} from '../src/lib/turn-commands';
import type { TurnAction, TurnState } from '../src/lib/turn-controller';

function harness() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const actions: TurnAction[] = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const replies: Record<string, unknown[]> = {};
  let state: TurnState = 'streaming';
  let live = 'live-1';
  const onCall: Array<(method: string) => void> = [];
  const deps: TurnCommandDeps = {
    call: (async (method: string, params: unknown) => {
      calls.push({ method, params });
      onCall.forEach((f) => f(method));
      const next = replies[method]?.shift();
      if (next instanceof Error) throw next;
      return next ?? {};
    }) as unknown as TurnCommandDeps['call'],
    dispatch: (a) => {
      actions.push(a);
      if (a.type === 'stop.sent') state = 'stopping';
      if (a.type === 'stop.failed') state = 'streaming';
      if (a.type === 'submit.sent' && state === 'idle') state = 'waiting';
    },
    liveSessionId: () => live,
    turnState: () => state,
    resumeStored: jest.fn(async () => {
      live = 'live-2';
      return live; // A's ChatTransport.resumeStored() resolves the fresh live id
    }),
    reconnect: jest.fn(async () => {}),
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
  };
  const reply = (method: string, ...values: unknown[]) => {
    replies[method] = values;
  };
  return { deps, calls, actions, timers, reply, onCall, setState: (s: TurnState) => (state = s) };
}

describe('stop', () => {
  it('goes to stopping, interrupts the live session, ignores the result, arms the 15 s fallback', async () => {
    const h = harness();
    h.reply('session.interrupt', { status: 'not_interrupted' });
    const out = await createTurnCommands(h.deps).stop();
    expect(out).toEqual({ ok: true });
    expect(h.actions).toEqual([{ type: 'stop.sent' }]);
    expect(h.calls).toEqual([{ method: 'session.interrupt', params: { session_id: 'live-1' } }]);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(STOP_FALLBACK_MS);
  });
  it('4001 → resumes the stored id and retries once on the new live id', async () => {
    const h = harness();
    h.reply('session.interrupt', new RpcError('session not found', 4001), { status: 'interrupted' });
    expect(await createTurnCommands(h.deps).stop()).toEqual({ ok: true });
    expect(h.deps.resumeStored).toHaveBeenCalledTimes(1);
    expect(h.calls.map((c) => c.params)).toEqual([{ session_id: 'live-1' }, { session_id: 'live-2' }]);
  });
  it('4001 twice → stop.failed and an inline error', async () => {
    const h = harness();
    h.reply('session.interrupt', new RpcError('gone', 4001), new RpcError('gone again', 4001));
    const out = await createTurnCommands(h.deps).stop();
    expect(out).toEqual({ ok: false, message: 'gone again' });
    expect(h.actions).toEqual([{ type: 'stop.sent' }, { type: 'stop.failed' }]);
    expect(h.timers).toHaveLength(0);
  });
  it('any other error → stop.failed, Stop re-enabled, no resume', async () => {
    const h = harness();
    h.reply('session.interrupt', new RpcError('boom', 5000));
    expect(await createTurnCommands(h.deps).stop()).toEqual({ ok: false, message: 'boom' });
    expect(h.deps.resumeStored).not.toHaveBeenCalled();
    expect(h.actions.at(-1)).toEqual({ type: 'stop.failed' });
  });
  it('a second tap while stopping sends nothing', async () => {
    const h = harness();
    h.setState('stopping');
    await createTurnCommands(h.deps).stop();
    expect(h.calls).toHaveLength(0);
  });
  it('fallback fires a stop-timeout reconnect only if still stopping', async () => {
    const h = harness();
    const cmds = createTurnCommands(h.deps);
    await cmds.stop();
    h.timers[0].fn();
    expect(h.deps.reconnect).toHaveBeenCalledWith('stop-timeout');
    const h2 = harness();
    await createTurnCommands(h2.deps).stop();
    h2.setState('idle'); // message.complete{interrupted} arrived
    h2.timers[0].fn();
    expect(h2.deps.reconnect).not.toHaveBeenCalled();
  });
  it('after the stop-timeout reconnect, a turn still "stopping" re-enables Stop (never stuck on Stopping…)', async () => {
    // A keeps `stopping` on resume.seeded{running:true} (A deviation 6), so if the interrupt never
    // landed the composer would otherwise stay disabled forever.
    const h = harness();
    await createTurnCommands(h.deps).stop();
    h.timers[0].fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.actions.at(-1)).toEqual({ type: 'stop.failed' });
    const h2 = harness();
    await createTurnCommands(h2.deps).stop();
    (h2.deps.reconnect as jest.Mock).mockImplementationOnce(async () => h2.setState('idle')); // resume: not running
    h2.timers[0].fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(h2.actions).toEqual([{ type: 'stop.sent' }]);
  });
  it('a new stop cancels the previous timer; dispose cancels the current one', async () => {
    const h = harness();
    const cmds = createTurnCommands(h.deps);
    await cmds.stop();
    h.setState('streaming');
    await cmds.stop();
    expect(h.timers[0].cancelled).toBe(true);
    cmds.dispose();
    expect(h.timers[1].cancelled).toBe(true);
  });
});

describe('steer', () => {
  it('queued → steered, exactly one session.steer, no submit', async () => {
    const h = harness();
    h.reply('session.steer', { status: 'queued', text: 'use tabs' });
    expect(await createTurnCommands(h.deps).steer('use tabs')).toEqual({ kind: 'steered' });
    expect(h.calls).toEqual([{ method: 'session.steer', params: { session_id: 'live-1', text: 'use tabs' } }]);
  });
  it('rejected → prompt.submit with queued:true and submit.sent', async () => {
    const h = harness();
    h.reply('session.steer', { status: 'rejected', text: 'x' });
    expect(await createTurnCommands(h.deps).steer('x')).toEqual({ kind: 'submitted' });
    expect(h.calls[1]).toEqual({ method: 'prompt.submit', params: { session_id: 'live-1', text: 'x', queued: true } });
    expect(h.actions).toEqual([{ type: 'submit.sent' }]);
  });
  it('4010 (agent still building) → queued submit, never a plain submit', async () => {
    const h = harness();
    h.reply('session.steer', new RpcError('agent not ready', 4010));
    expect(await createTurnCommands(h.deps).steer('x')).toEqual({ kind: 'submitted' });
    expect(h.calls[1].params).toEqual({ session_id: 'live-1', text: 'x', queued: true });
  });
  it('4001 → resume and retry the steer once', async () => {
    const h = harness();
    h.reply('session.steer', new RpcError('stale', 4001), { status: 'queued', text: 'x' });
    expect(await createTurnCommands(h.deps).steer('x')).toEqual({ kind: 'steered' });
    expect(h.calls.map((c) => c.params)).toEqual([
      { session_id: 'live-1', text: 'x' },
      { session_id: 'live-2', text: 'x' },
    ]);
  });
  it('other errors → error outcome, no submit', async () => {
    const h = harness();
    h.reply('session.steer', new RpcError('failed', 5000));
    expect(await createTurnCommands(h.deps).steer('x')).toEqual({ kind: 'error', message: 'failed' });
    expect(h.calls).toHaveLength(1);
  });
  it('a failing fallback submit is an error outcome', async () => {
    const h = harness();
    h.reply('session.steer', { status: 'rejected', text: 'x' });
    h.reply('prompt.submit', new RpcError('slot limit', 4090));
    expect(await createTurnCommands(h.deps).steer('x')).toEqual({ kind: 'error', message: 'slot limit' });
  });
  describe('steer racing turn end (Review Focus 3)', () => {
    it('turn ends locally while the steer is in flight, server still queued it → steered, no submit', async () => {
      const h = harness();
      h.onCall.push((m) => m === 'session.steer' && h.setState('idle'));
      h.reply('session.steer', { status: 'queued', text: 'x' });
      expect(await createTurnCommands(h.deps).steer('x')).toEqual({ kind: 'steered' });
      expect(h.calls.map((c) => c.method)).toEqual(['session.steer']);
    });
    it('turn ended server-side → rejected → one queued submit that moves idle to waiting', async () => {
      const h = harness();
      h.onCall.push((m) => m === 'session.steer' && h.setState('idle'));
      h.reply('session.steer', { status: 'rejected', text: 'x' });
      await createTurnCommands(h.deps).steer('x');
      expect(h.calls.filter((c) => c.method === 'prompt.submit')).toHaveLength(1);
      expect(h.deps.turnState()).toBe('waiting');
    });
  });
});

describe('helpers', () => {
  it('restoreSteerText puts the failed text back without clobbering new typing', () => {
    expect(restoreSteerText('', 'use tabs')).toBe('use tabs');
    expect(restoreSteerText('  ', 'use tabs')).toBe('use tabs');
    expect(restoreSteerText('and spaces', 'use tabs')).toBe('use tabs\nand spaces');
  });
  it('completionEffects: Stopped marker on interrupted, success haptic only for live complete', () => {
    expect(completionEffects('interrupted', false)).toEqual({ stoppedMarker: true, successHaptic: false });
    expect(completionEffects('complete', false)).toEqual({ stoppedMarker: false, successHaptic: true });
    expect(completionEffects('complete', true)).toEqual({ stoppedMarker: false, successHaptic: false });
    expect(completionEffects(null, false)).toEqual({ stoppedMarker: false, successHaptic: true });
    expect(completionEffects('error', false)).toEqual({ stoppedMarker: false, successHaptic: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/turn-commands.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/turn-commands'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/turn-commands.ts
//
// Stop and steer decisions (spec §5.3), pure with injected I/O. The chat screen supplies the
// gateway call, the turn dispatch and the reconnect trigger; nothing here touches React.
import { RpcError, type GatewayClient } from '@/api/gatewayClient';
import { withStaleSessionRetry } from '@/api/stale-session'; // A: the one 4001 rule (resume + retry once)
import type { CompleteStatus, TurnAction, TurnState } from '@/lib/turn-controller';

export const AGENT_BUILDING_CODE = 4010; // steer while the agent is still being built
export const STOP_FALLBACK_MS = 15_000;

export interface TurnCommandDeps {
  call: GatewayClient['call'];
  dispatch: (a: TurnAction) => void;
  liveSessionId: () => string | null;
  turnState: () => TurnState;
  /** A's `ChatTransport.resumeStored()`: `session.resume` on the stored id over the current socket;
   *  updates the live id + seeds the store; resolves the fresh live id. */
  resumeStored: () => Promise<string>;
  reconnect: (trigger: 'stop-timeout') => Promise<void>;
  /** setTimeout wrapper returning a canceller (injected for tests). */
  setTimer: (fn: () => void, ms: number) => () => void;
}

export type StopOutcome = { ok: true } | { ok: false; message: string };
export type SteerOutcome = { kind: 'steered' } | { kind: 'submitted' } | { kind: 'error'; message: string };

export interface TurnCommands {
  stop(): Promise<StopOutcome>;
  steer(text: string): Promise<SteerOutcome>;
  dispose(): void;
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Failed steer: its text goes back in the input, ahead of anything typed since. */
export function restoreSteerText(current: string, failed: string): string {
  return current.trim() ? `${failed}\n${current}` : failed;
}

/** `message.complete` side effects: "Stopped" marker on interrupt; success haptic only for a live
 *  (non-replayed) normal completion (spec §5.1, review m16). */
export function completionEffects(
  status: CompleteStatus | null | undefined,
  replayed: boolean,
): { stoppedMarker: boolean; successHaptic: boolean } {
  const s = status ?? 'complete';
  return { stoppedMarker: s === 'interrupted', successHaptic: s === 'complete' && !replayed };
}

export function createTurnCommands(deps: TurnCommandDeps): TurnCommands {
  let cancelFallback: (() => void) | null = null;
  const clearFallback = () => {
    cancelFallback?.();
    cancelFallback = null;
  };

  function liveId(): string {
    const id = deps.liveSessionId();
    if (!id) throw new Error('Not connected.');
    return id;
  }

  /** Run `op` on the live id; a 4001 resumes the stored id and retries ONCE on the fresh id (A's rule). */
  function onLiveSession<T>(op: (sid: string) => Promise<T>): Promise<T> {
    return withStaleSessionRetry(liveId(), op, deps.resumeStored);
  }

  async function submitQueued(text: string): Promise<void> {
    await onLiveSession((sid) => deps.call('prompt.submit', { session_id: sid, text, queued: true }));
    deps.dispatch({ type: 'submit.sent' });
  }

  async function stop(): Promise<StopOutcome> {
    const state = deps.turnState();
    if (state !== 'waiting' && state !== 'streaming') return { ok: true };
    deps.dispatch({ type: 'stop.sent' });
    try {
      // The result is ignored: it reports "interrupted" even for an idle session.
      await onLiveSession((sid) => deps.call('session.interrupt', { session_id: sid }));
    } catch (e) {
      deps.dispatch({ type: 'stop.failed' });
      return { ok: false, message: messageOf(e, 'Could not stop the response.') };
    }
    clearFallback();
    cancelFallback = deps.setTimer(() => {
      cancelFallback = null;
      if (deps.turnState() !== 'stopping') return;
      void deps.reconnect('stop-timeout').then(() => {
        // The reconnect re-seeds from session.resume. A keeps `stopping` while the server still
        // reports the turn running (A deviation 6), so re-enable Stop rather than leave it stuck.
        if (deps.turnState() === 'stopping') deps.dispatch({ type: 'stop.failed' });
      });
    }, STOP_FALLBACK_MS);
    return { ok: true };
  }

  async function steer(text: string): Promise<SteerOutcome> {
    let status: string;
    try {
      const res = await onLiveSession((sid) => deps.call('session.steer', { session_id: sid, text }));
      status = res.status;
    } catch (e) {
      if (!(e instanceof RpcError) || e.code !== AGENT_BUILDING_CODE) {
        return { kind: 'error', message: messageOf(e, 'Could not steer.') };
      }
      status = 'rejected'; // agent still building: queue it (a plain submit would hard-interrupt)
    }
    if (status !== 'rejected') return { kind: 'steered' };
    try {
      await submitQueued(text);
      return { kind: 'submitted' };
    } catch (e) {
      return { kind: 'error', message: messageOf(e, 'Could not send.') };
    }
  }

  return { stop, steer, dispose: clearFallback };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/turn-commands.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Full gate + commit**

```bash
npx tsc --noEmit && npx jest
git add src/lib/turn-commands.ts __tests__/turn-commands.test.ts
git commit -m "feat(turn): stop and steer commands (A's 4001 rule, 4010, 15s fallback that re-enables Stop)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Component-test harness, transcript markers ("Stopped", "Steered"), dev gallery

**Files:**
- Modify: `package.json` (devDeps + jest config), `src/components/message-row.tsx`, `src/lib/icon-map.ts`
- Create: `jest.setup.ts`, `src/app/dev-cards.tsx`
- Test: `__tests__/transcript-markers.test.tsx`

**Interfaces:**
- Produces: `ChatItem.steered?: boolean`, `ChatItem.marker?: 'stopped'`; the `DevCards` route with a
  `{/* dev-cards:end */}` insertion marker that later tasks extend; `.test.tsx` component tests.

- [ ] **Step 1: Install the harness (dev-only, pure JS)**

```bash
npm install --save-dev @testing-library/react-native@14.0.1 test-renderer@1.2.0
```

A adds neither RNTL nor `jest.setup.ts` (A's Tech Stack line), so B owns them (contract R6). A leaves
the `"jest"` block exactly as on `main` (`{"preset": "jest-expo", "testMatch": ["**/__tests__/**/*.test.ts"]}`);
the new block below keeps that pattern (so A's `src/**/__tests__/*.test.ts` suites and the non-test fixtures
under `src/api/__tests__/fixtures/` behave as before) and adds `.test.tsx` plus the setup file.
In `package.json` replace the `"jest"` block with:

```json
  "jest": {
    "preset": "jest-expo",
    "setupFilesAfterEnv": ["<rootDir>/jest.setup.ts"],
    "testMatch": [
      "**/__tests__/**/*.test.ts",
      "**/__tests__/**/*.test.tsx"
    ]
  },
```

Create:

```ts
// jest.setup.ts — global mocks for component tests (React Native Testing Library).
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
```

- [ ] **Step 2: Write the failing test**

```tsx
// __tests__/transcript-markers.test.tsx
import { render, screen } from '@testing-library/react-native';
import { MessageRow } from '../src/components/message-row';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: 'light' } }));

test('a steered user message shows a "Steered" caption and says so to VoiceOver', async () => {
  await render(<MessageRow item={{ key: 'i1', role: 'user', text: 'use tabs', complete: true, steered: true }} />);
  expect(screen.getByText('Steered')).toBeOnTheScreen();
  expect(screen.getByLabelText('You steered: use tabs')).toBeOnTheScreen();
});

test('a plain user message has no Steered caption', async () => {
  await render(<MessageRow item={{ key: 'i1', role: 'user', text: 'hi', complete: true }} />);
  expect(screen.queryByText('Steered')).toBeNull();
});

test('the stopped marker renders as "Stopped" with an accessible label', async () => {
  await render(<MessageRow item={{ key: 'i2', role: 'status', text: 'Stopped', marker: 'stopped' }} />);
  expect(screen.getByLabelText('Response stopped')).toBeOnTheScreen();
  expect(screen.getByText('Stopped')).toBeOnTheScreen();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/transcript-markers.test.tsx`
Expected: FAIL — TS/Babel accepts the unknown props, but `getByText('Steered')` and `getByLabelText('Response stopped')` find nothing.
(If it fails earlier with a Reanimated/worklets import error, the `jest.setup.ts` mocks are not being
applied — check the `setupFilesAfterEnv` path before continuing.)

- [ ] **Step 4: Implement the markers**

In `src/components/message-row.tsx`, add to `ChatItem` (after `imageHeight?`):

```ts
  /** User message delivered via session.steer into the running turn (spec §5.3). */
  steered?: boolean;
  /** Status rows with special rendering. 'stopped' = the turn ended with status "interrupted". */
  marker?: 'stopped';
```

Replace the user-bubble `{item.text ? ( <View style={{ maxWidth: '82%', … }}> … </View> ) : null}` block with:

```tsx
        {item.text ? (
          <View
            accessible
            accessibilityLabel={item.steered ? `You steered: ${item.text}` : undefined}
            style={{
              maxWidth: '82%',
              backgroundColor: colors.userBubble,
              borderRadius: 20,
              borderCurve: 'continuous',
              paddingHorizontal: 16,
              paddingVertical: 11,
            }}
          >
            <Text selectable style={{ color: colors.text, fontSize: 17, lineHeight: 24 }}>
              {item.text}
            </Text>
          </View>
        ) : null}
        {item.steered ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 4, paddingRight: 6 }}>
            <Icon sf="arrow.turn.down.right" size={11} color={colors.textFaint} />
            <Text style={{ color: colors.textFaint, fontSize: 12, fontWeight: '600' }}>Steered</Text>
          </View>
        ) : null}
```

Replace the final `// status` return with:

```tsx
  // status
  if (item.marker === 'stopped') {
    return (
      <View
        accessible
        accessibilityLabel="Response stopped"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}
      >
        <Icon sf="stop.circle" size={13} color={colors.textDim} />
        <Text style={{ color: colors.textDim, fontSize: 13, fontWeight: '600' }}>Stopped</Text>
      </View>
    );
  }
  return (
    <Text style={{ color: colors.textFaint, fontSize: 12.5, paddingVertical: 3 }}>{item.text}</Text>
  );
```

In `src/lib/icon-map.ts` add (keep alphabetical order):

```ts
  'arrow.turn.down.right': 'arrow-right-bottom',
  'checkmark.square.fill': 'checkbox-marked',
  'circle': 'radiobox-blank',
  'faceid': 'face-recognition',
  'hourglass': 'timer-sand',
  'largecircle.fill.circle': 'radiobox-marked',
  'lock.fill': 'lock',
  'questionmark.bubble': 'message-question-outline',
  'square': 'checkbox-blank-outline',
  'stop.circle': 'stop-circle-outline',
  'stop.fill': 'stop',
```

- [ ] **Step 5: Create the dev gallery**

```tsx
// src/app/dev-cards.tsx
//
// __DEV__-only gallery of the turn-control UI in every state, for simulator screenshots in both
// themes: `xcrun simctl openurl booted hermesmobileapp://dev-cards`. Release builds redirect away.
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageRow } from '@/components/message-row';
import { useTheme } from '@/theme';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.textFaint, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{title}</Text>
      {children}
    </View>
  );
}

export default function DevCards() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40, gap: 24 }}
    >
      <Section title="Transcript markers">
        <MessageRow item={{ key: 'd1', role: 'user', text: 'Actually, use tabs.', complete: true, steered: true }} />
        <MessageRow item={{ key: 'd2', role: 'status', text: 'Stopped', marker: 'stopped' }} />
      </Section>
      {/* dev-cards:end */}
    </ScrollView>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/transcript-markers.test.tsx __tests__/icon-map.test.ts`
Expected: PASS.

- [ ] **Step 7: Screenshots** — Screenshot procedure with `NAME=markers`. Check "Steered" caption sits
right-aligned under the bubble and "Stopped" reads as a quiet status in both themes.

- [ ] **Step 8: Full gate + commit**

```bash
npx tsc --noEmit && npx jest
git add package.json package-lock.json jest.setup.ts src/components/message-row.tsx src/lib/icon-map.ts src/app/dev-cards.tsx __tests__/transcript-markers.test.tsx docs/screenshots/turn-control/markers-*.png
git commit -m "feat(chat): Stopped and Steered transcript markers, RNTL harness, dev gallery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Composer Stop / steer UI and chat-screen wiring

**Files:**
- Modify: `src/components/composer.tsx`, `src/app/chat/[id].tsx`, `src/app/dev-cards.tsx`
- Test: `__tests__/composer.test.tsx`

**Interfaces:**
- Consumes: `ComposerMode`, `composerMode` (Task 1); `createTurnCommands`, `restoreSteerText`, `completionEffects` (Task 2); wiring names (header table).
- Produces: `Composer` props `mode: ComposerMode`, `onSend`, `onStop`, `onSteer` (the `streaming` prop is removed).

**Requirement — composer-height follow-up trigger for steer restore (added in the 2026-09-28 re-anchor):**
Plan C's `composerMinHeight` (`src/lib/composer-height.ts`) only re-measures a JS-driven **clear**; its
header comment says so explicitly. Step 5's `setInput((cur) => restoreSteerText(cur, text))` on a failed
steer is a JS-driven **non-empty** set and hits the same one-commit measure lag — the restored text would
render at whatever height was current when the restore committed (typically one line), not at the height
the restored multi-line text needs. This task must add its own follow-up-commit trigger for non-empty
programmatic sets, following the approach sketched in `composer-height.ts`'s header (record the last
`onChangeText` text in a ref; in the `value` `useLayoutEffect`, flip a boolean when
`value !== lastEmittedRef.current`, not just on `value === ''`). Step 7's device check must confirm a
failed multi-line steer restores the composer at full height, not one line.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/composer.test.tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Composer } from '../src/components/composer';
import type { ComposerMode } from '../src/lib/turn-controller';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));

function setup(mode: ComposerMode, extra: { value?: string; stagedImageUri?: string | null; disabled?: boolean } = {}) {
  const handlers = { onSend: jest.fn(), onStop: jest.fn(), onSteer: jest.fn(), onChangeText: jest.fn() };
  return { handlers, el: <Composer value={extra.value ?? ''} mode={mode} stagedImageUri={extra.stagedImageUri ?? null} disabled={extra.disabled} {...handlers} /> };
}

test('idle with only a staged photo: Send is enabled (review m9)', async () => {
  const { el, handlers } = setup({ kind: 'send', enabled: true }, { stagedImageUri: 'file:///p.jpg' });
  await render(el);
  await fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
  expect(handlers.onSend).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Stop response' })).toBeNull();
});

test('idle, empty: Send disabled, placeholder "Chat with Hermes"', async () => {
  const { el } = setup({ kind: 'send', enabled: false });
  await render(el);
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  expect(screen.getByPlaceholderText('Chat with Hermes')).toBeOnTheScreen();
});

test('streaming, empty input: Stop only, placeholder "Steer Hermes…", input editable', async () => {
  const { el, handlers } = setup({ kind: 'stop+steer', stopEnabled: true, steerEnabled: false });
  await render(el);
  expect(screen.getByPlaceholderText('Steer Hermes…').props.editable).toBe(true);
  expect(screen.queryByRole('button', { name: 'Send steer message' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Stop response' }));
  expect(handlers.onStop).toHaveBeenCalledTimes(1);
});

test('streaming with text: Stop + steer-send; steer never calls onSend', async () => {
  const { el, handlers } = setup({ kind: 'stop+steer', stopEnabled: true, steerEnabled: true }, { value: 'use tabs' });
  await render(el);
  await fireEvent.press(screen.getByRole('button', { name: 'Send steer message' }));
  expect(handlers.onSteer).toHaveBeenCalledTimes(1);
  expect(handlers.onSend).not.toHaveBeenCalled();
});

test('stopping: "Stopping…", Stop and steer disabled', async () => {
  const { el, handlers } = setup({ kind: 'stop+steer', stopEnabled: false, steerEnabled: false }, { value: 'x' });
  await render(el);
  expect(screen.getByText('Stopping…')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Stopping response' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send steer message' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Stopping response' }));
  expect(handlers.onStop).not.toHaveBeenCalled();
});

test('a staged photo while streaming says it waits for the turn to finish', async () => {
  const { el } = setup({ kind: 'stop+steer', stopEnabled: true, steerEnabled: false }, { stagedImageUri: 'file:///p.jpg' });
  await render(el);
  expect(screen.getByText('Sends after Hermes finishes')).toBeOnTheScreen();
});

test('not ready: Stop disabled too', async () => {
  const { el } = setup({ kind: 'stop+steer', stopEnabled: true, steerEnabled: false }, { disabled: true });
  await render(el);
  expect(screen.getByRole('button', { name: 'Stop response' })).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/composer.test.tsx`
Expected: FAIL — no "Stop response" button, placeholder is "Hermes is responding…".

- [ ] **Step 3: Implement the composer**

In `src/components/composer.tsx` (after Plan C merged — see "Merge order with Plan C"; keep every line C
added: the `useLayoutEffect, useState` import, the `composerMinHeight` import from `@/lib/composer-height`,
the `emptyCommitted` state + its `useLayoutEffect` block after `canSend`, and the TextInput `style`'s
`minHeight: composerMinHeight(value, emptyCommitted)` + `maxHeight: 120` — plus the follow-up-commit
trigger for non-empty sets required above):

1. Imports: change the `react-native` import to `import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';` and
   add `import type { ComposerMode } from '@/lib/turn-controller';` (C's `useLayoutEffect, useState` import stays).
2. In `ComposerProps` replace the `streaming?: boolean;` member (and its comment) with:

```ts
  /** From `composerMode(turn, hasText, hasImage)` — spec §5.2. */
  mode: ComposerMode;
  /** Running turn: `session.interrupt`. */
  onStop: () => void;
  /** Running turn: `session.steer` with the current text. */
  onSteer: () => void;
```

3. In the destructuring replace `streaming,` with `mode, onStop, onSteer,`, and replace **only** the
   `const canSend = !disabled && !streaming && …;` line (C's block right after it stays) with:

```ts
  const running = mode.kind === 'stop+steer';
  const stopping = running && !mode.stopEnabled;
  const canSend = !disabled && mode.kind === 'send' && mode.enabled;
  const canStop = !disabled && running && mode.stopEnabled;
  const canSteer = !disabled && running && mode.steerEnabled;
  const hasText = value.trim().length > 0;
```

4. In the staged-image chip, after the closing `</View>` of the 64×64 thumbnail wrapper (still inside
   the `Animated.View`), add:

```tsx
            {running ? (
              <Text style={{ color: colors.textFaint, fontSize: 12.5, alignSelf: 'center', marginLeft: 10, flexShrink: 1 }}>
                Sends after Hermes finishes
              </Text>
            ) : null}
```

5. `TextInput`: change only the placeholder prop (`placeholder={streaming ? 'Hermes is responding…' : 'Chat with Hermes'}`,
   unchanged by C) to `placeholder={running ? 'Steer Hermes…' : 'Chat with Hermes'}`. Leave C's `style`
   (the `minHeight: composerMinHeight(value, emptyCommitted)` / `maxHeight: 120` pair, plus this task's
   follow-up-commit trigger) untouched here. Afterwards `grep -n streaming src/components/composer.tsx`
   must print nothing (exit 1).
6. Replace the whole Send `<Pressable accessibilityLabel="Send message" …>…</Pressable>` with:

```tsx
          {running ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={stopping ? 'Stopping response' : 'Stop response'}
                accessibilityState={{ disabled: !canStop, busy: stopping }}
                onPress={onStop}
                disabled={!canStop}
                hitSlop={6}
                style={({ pressed }) => ({
                  height: 36,
                  minWidth: 36,
                  paddingHorizontal: stopping ? 12 : 0,
                  borderRadius: 18,
                  borderCurve: 'continuous',
                  flexDirection: 'row',
                  gap: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? colors.userBubble : colors.raised,
                  opacity: !canStop && !stopping ? 0.5 : 1,
                })}
              >
                {stopping ? (
                  <>
                    <ActivityIndicator size="small" color={colors.textDim} />
                    <Text style={{ color: colors.textDim, fontSize: 14, fontWeight: '500' }}>Stopping…</Text>
                  </>
                ) : (
                  <Icon sf="stop.fill" size={13} color={colors.text} />
                )}
              </Pressable>
              {hasText ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send steer message"
                  accessibilityState={{ disabled: !canSteer }}
                  onPress={onSteer}
                  disabled={!canSteer}
                  hitSlop={6}
                  style={({ pressed }) => ({
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: canSteer ? (pressed ? colors.accentPressed : colors.accent) : colors.raised,
                  })}
                >
                  <Icon sf="arrow.up" size={16} color={canSteer ? colors.onAccent : colors.textFaint} />
                </Pressable>
              ) : null}
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !canSend }}
              onPress={onSend}
              disabled={!canSend}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: canSend ? (pressed ? colors.accentPressed : colors.accent) : colors.raised,
              })}
            >
              <Icon sf="arrow.up" size={16} color={canSend ? colors.onAccent : colors.textFaint} />
            </Pressable>
          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/composer.test.tsx`
Expected: PASS (7 tests). `npx tsc --noEmit` now FAILS in `src/app/chat/[id].tsx` (Composer props) — fixed next.

- [ ] **Step 5: Wire stop/steer into the chat screen**

Verify A's names first (header grep). In `src/app/chat/[id].tsx`:

Imports (merge into A's existing import statements from the same modules — do not add duplicate
import lines):

- add `composerMode` to A's `import { cancelLabel, completeStatus, … } from '@/lib/turn-controller';` list;
- change A's `import { makeNativeSocket, type GatewayClient } from '@/api/gatewayClient';` to
  `import { RpcError, makeNativeSocket, type GatewayClient } from '@/api/gatewayClient';`;
- change A's `import type { GatewayEvent, GatewayEventMap } from '@/vendor/hermes-gateway';` to
  `import type { GatewayEvent, GatewayEventMap, RpcMethods } from '@/vendor/hermes-gateway';`;
- add `import { completionEffects, createTurnCommands, restoreSteerText } from '@/lib/turn-commands';`.

Inside `ChatScreen`, directly after A's `const resumeParams = () => …;` line (end of A's R3 block):

```ts
  /** Typed call on this screen's single client. A's `gw()` is null before mount/after unmount;
   *  this rejects (never throws synchronously) so command/answer code can treat it as a failure. */
  function callGw<M extends keyof RpcMethods>(
    method: M,
    params: RpcMethods[M]['params'],
  ): Promise<RpcMethods[M]['result']> {
    const client = gw();
    return client ? client.call(method, params) : Promise.reject(new RpcError('Not connected.', -1));
  }

  // Stop / steer (spec §5.3). Created once; every dep reads refs at call time.
  const [commands] = useState(() =>
    createTurnCommands({
      call: callGw,
      dispatch: (a) => dispatchTurn(a),
      liveSessionId: () => liveIdRef.current,
      turnState: () => readTurn().turn,
      // A's transport: session.resume on the stored id, updates liveIdRef + seeds the store.
      resumeStored: () =>
        transportRef.current?.resumeStored() ?? Promise.reject(new RpcError('Not connected.', -1)),
      reconnect: (trigger) => orchestratorRef.current?.reconnect(trigger) ?? Promise.resolve(),
      setTimer: (fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
    }),
  );
  useEffect(() => () => commands.dispose(), [commands]);

  async function stop() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const out = await commands.stop();
    if (!out.ok) setError(out.message);
  }

  async function steer() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const out = await commands.steer(text);
    if (out.kind === 'error') {
      setError(out.message);
      setInput((cur) => restoreSteerText(cur, text));
      return;
    }
    setItems((prev) => [
      ...prev,
      { key: nextKey(), role: 'user', text, complete: true, ...(out.kind === 'steered' ? { steered: true } : {}) },
    ]);
  }
```

In A's `applyEvent`, `case 'message.complete'` (the store transition itself already happened in A's
transport sink via `turnActionFor`, with `status` and `replayed`), replace A's three lines

```tsx
        if (status === 'interrupted') append('status', 'Stopped');
        else if (status === 'error') setError(p?.error || 'The turn failed.');
        else if (live) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
```

with:

```tsx
        const fx = completionEffects(status, !live);
        if (fx.stoppedMarker) {
          setItems((prev) => [...prev, { key: nextKey(), role: 'status', text: 'Stopped', marker: 'stopped' }]);
        } else if (status === 'error') {
          setError(p?.error || 'The turn failed.');
        }
        if (fx.successHaptic) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
```

Replace the `<Composer …/>` element (after A it carries `streaming={busy}`) with:

```tsx
      <Composer
        value={input}
        onChangeText={setInput}
        mode={composerMode(turn, input.trim().length > 0, Boolean(stagedImage))}
        onSend={send}
        onStop={() => void stop()}
        onSteer={() => void steer()}
        disabled={!ready}
        stagedImageUri={stagedImage?.uri ?? null}
        onAttachPress={() => router.push('/attach')}
        onRemoveImage={() => setStagedImage(null)}
        modelName={modelName}
        onModelPress={() => router.push('/models?scope=session')}
      />
```

- [ ] **Step 6: Gallery section** — in `src/app/dev-cards.tsx` add
`import { useState } from 'react'; import { Composer } from '@/components/composer'; import type { ComposerMode } from '@/lib/turn-controller';`,
this helper above `DevCards`:

```tsx
function DevComposer({ mode, initial = '', image = false }: { mode: ComposerMode; initial?: string; image?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <Composer
      value={value}
      onChangeText={setValue}
      mode={mode}
      onSend={() => {}}
      onStop={() => {}}
      onSteer={() => {}}
      stagedImageUri={image ? 'https://picsum.photos/seed/hermes/128' : null}
    />
  );
}
```

and before `{/* dev-cards:end */}`:

```tsx
      <Section title="Composer">
        <DevComposer mode={{ kind: 'send', enabled: false }} />
        <DevComposer mode={{ kind: 'stop+steer', stopEnabled: true, steerEnabled: false }} />
        <DevComposer mode={{ kind: 'stop+steer', stopEnabled: true, steerEnabled: true }} initial="Actually, use tabs." />
        <DevComposer mode={{ kind: 'stop+steer', stopEnabled: false, steerEnabled: false }} initial="Actually, use tabs." />
        <DevComposer mode={{ kind: 'stop+steer', stopEnabled: true, steerEnabled: false }} image />
      </Section>
```

- [ ] **Step 7: Screenshots** — Screenshot procedure with `NAME=composer`. Check: Stop is a neutral
`raised` circle (not accent) in both themes, steer arrow is accent, "Stopping…" pill fits, chip caption wraps.
Also device-check the composer-height requirement above: send a failed multi-line steer and confirm the
composer restores at full height (not one line).

- [ ] **Step 8: Full gate + commit**

```bash
npx tsc --noEmit && npx jest
git add src/components/composer.tsx 'src/app/chat/[id].tsx' src/app/dev-cards.tsx __tests__/composer.test.tsx docs/screenshots/turn-control/composer-*.png
git commit -m "feat(composer): Stop and steer while a turn runs; Stopped marker without success haptic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Request answering (`src/lib/request-answers.ts`)

**Files:**
- Create: `src/lib/request-answers.ts`
- Test: `__tests__/request-answers.test.ts`

**Interfaces:**
- Consumes: `RequestRegistry` (A, `src/lib/request-registry.ts`), `RequestCardState`, `TurnAction` (A/Task 1),
  `GatewayClient['call']`, `resolvedCount` (`src/lib/approval.ts`, kept by A).
- Ownership (vs A): A's router owns arrival (`request.received`, `registry.put`), `request.cancel`
  (`request.cancelled` + `registry.drop`), the vault `-32601` + `request.answered{skipped}`, and the live-only
  Warning haptic (`onNewCard`). This module owns **answering** only; it never dispatches `request.received`,
  so nothing is dispatched twice. An answered 0.21.5 card leaves the registry (`respond` deletes it); a
  reconnect re-delivery `put`s it back and A's reducer re-arms the card to `pending`.
- Produces: contract helpers `approvalResult`, `clarifySingleResult`, `clarifySkipAllResult`, `valueResult`;
  `ClarifyAnswer = string | string[]`; `AnswerOutcome`; `LockOutcome = 'ok'|'resolved'|'expired'|'failed'`;
  `createRequestResponder(deps): RequestResponder` with `approve(card, choice): Promise<AnswerOutcome>`,
  `clarifySingle(card, answer): AnswerOutcome`, `clarifyLock(card, qid, answer): Promise<LockOutcome>`,
  `clarifySubmitAll(card, answers: {qid; answer}[]): Promise<LockOutcome>`, `clarifySkipAll(card): AnswerOutcome`,
  `value(card, value): AnswerOutcome`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/request-answers.test.ts
import { RpcError } from '../src/api/gatewayClient';
import {
  approvalResult,
  clarifySingleResult,
  clarifySkipAllResult,
  createRequestResponder,
  valueResult,
  type ResponderDeps,
} from '../src/lib/request-answers';
import type { RequestCardState, TurnAction } from '../src/lib/turn-controller';

const base = (over: Partial<RequestCardState>): RequestCardState => ({
  id: 'srq-1', kind: 'approval', method: 'approval', params: {}, status: 'pending',
  legacy: false, receivedAt: 0, anchorKey: null, ...over,
});

function harness(respondOk = true) {
  const actions: TurnAction[] = [];
  const calls: Array<{ method: string; params: unknown }> = [];
  const replies: Record<string, unknown[]> = {};
  const respond = jest.fn((_id: string, _r: Record<string, unknown>) => respondOk);
  const deps: ResponderDeps = {
    registry: { respond },
    call: (async (method: string, params: unknown) => {
      calls.push({ method, params });
      const next = replies[method]?.shift();
      if (next instanceof Error) throw next;
      return next;
    }) as unknown as ResponderDeps['call'],
    dispatch: (a) => actions.push(a),
    liveSessionId: () => 'live-1',
  };
  return { r: createRequestResponder(deps), actions, calls, respond, reply: (m: string, ...v: unknown[]) => (replies[m] = v) };
}

test('result builders match the wire contract exactly', () => {
  expect(approvalResult('once')).toEqual({ choice: 'once' });
  expect(clarifySingleResult('')).toEqual({ answer: '' });
  expect(clarifySkipAllResult()).toEqual({});
  expect('answers' in clarifySkipAllResult()).toBe(false);
  expect(valueResult('v')).toEqual({ value: 'v' });
});

describe('approve', () => {
  it('0.21.5: responds {choice} through the registry, optimistic, no RPC, never `all`', async () => {
    const h = harness();
    expect(await h.r.approve(base({}), 'once')).toEqual({ ok: true });
    expect(h.respond).toHaveBeenCalledWith('srq-1', { choice: 'once' });
    expect(h.actions).toEqual([{ type: 'request.answered', id: 'srq-1', resolution: 'once' }]);
    expect(h.calls).toHaveLength(0);
  });
  it('0.21.5: unknown id in the registry → card closed, error outcome', async () => {
    const h = harness(false);
    expect(await h.r.approve(base({}), 'deny')).toEqual({ ok: false, message: 'This request is no longer open.' });
    expect(h.actions).toEqual([{ type: 'request.cancelled', id: 'srq-1', reason: 'session_closed' }]);
  });
  it('a settled card is not answered twice (double tap)', async () => {
    const h = harness();
    await h.r.approve(base({ status: 'answered' }), 'once');
    expect(h.respond).not.toHaveBeenCalled();
  });
  it('legacy: approval.respond {session_id, choice}; resolved>0 answers, 0 closes', async () => {
    const h = harness();
    h.reply('approval.respond', { resolved: 1 }, { resolved: 0 });
    await h.r.approve(base({ id: 'legacy:1', legacy: true }), 'deny');
    await h.r.approve(base({ id: 'legacy:2', legacy: true }), 'once');
    expect(h.calls).toEqual([
      { method: 'approval.respond', params: { session_id: 'live-1', choice: 'deny' } },
      { method: 'approval.respond', params: { session_id: 'live-1', choice: 'once' } },
    ]);
    expect(h.actions).toEqual([
      { type: 'request.answering', id: 'legacy:1' },
      { type: 'request.answered', id: 'legacy:1', resolution: 'deny' },
      { type: 'request.answering', id: 'legacy:2' },
      { type: 'request.cancelled', id: 'legacy:2', reason: 'resolved' },
    ]);
  });
  it('legacy: RPC failure re-arms the card', async () => {
    const h = harness();
    h.reply('approval.respond', new RpcError('socket closed', -1));
    expect(await h.r.approve(base({ id: 'legacy:1', legacy: true }), 'once')).toEqual({ ok: false, message: 'socket closed' });
    expect(h.actions.at(-1)).toEqual({ type: 'request.failed', id: 'legacy:1' });
  });
  it('answer again after re-delivery goes through the registry again (Review Focus 2)', async () => {
    const h = harness();
    await h.r.approve(base({}), 'once');
    await h.r.approve(base({ status: 'pending' }), 'once'); // reducer put it back to pending
    expect(h.respond).toHaveBeenCalledTimes(2);
  });
});

describe('clarify', () => {
  const clarify = (over: Partial<RequestCardState> = {}) => base({ kind: 'clarify', method: 'clarify', ...over });
  it('single: {answer}, never clarify.lock; "" is a skip; multi-select joins as a JSON array string', () => {
    const h = harness();
    h.r.clarifySingle(clarify(), 'Blue');
    h.r.clarifySingle(clarify({ id: 'srq-2' }), '');
    h.r.clarifySingle(clarify({ id: 'srq-3' }), ['A', 'C']);
    expect(h.respond.mock.calls).toEqual([
      ['srq-1', { answer: 'Blue' }],
      ['srq-2', { answer: '' }],
      ['srq-3', { answer: '["A","C"]' }],
    ]);
    expect(h.calls).toHaveLength(0);
    expect(h.actions).toEqual([
      { type: 'request.answered', id: 'srq-1', skipped: false, resolution: 'Blue' },
      { type: 'request.answered', id: 'srq-2', skipped: true, resolution: '' },
      { type: 'request.answered', id: 'srq-3', skipped: false, resolution: 'A, C' },
    ]);
  });
  it('lock: ok with remaining → locked; remaining [] → locked + answered (no response frame)', async () => {
    const h = harness();
    h.reply('clarify.lock', { status: 'ok', remaining: ['q1'] }, { status: 'ok', remaining: [] });
    expect(await h.r.clarifyLock(clarify(), 'q0', ['a', 'b'])).toBe('ok');
    expect(await h.r.clarifyLock(clarify(), 'q1', '')).toBe('resolved');
    expect(h.calls).toEqual([
      { method: 'clarify.lock', params: { request_id: 'srq-1', question_id: 'q0', answer: ['a', 'b'] } },
      { method: 'clarify.lock', params: { request_id: 'srq-1', question_id: 'q1', answer: '' } },
    ]);
    expect(h.actions).toEqual([
      { type: 'request.locked', id: 'srq-1', qid: 'q0', answer: ['a', 'b'] },
      { type: 'request.locked', id: 'srq-1', qid: 'q1', answer: '' },
      { type: 'request.answered', id: 'srq-1' },
    ]);
    expect(h.respond).not.toHaveBeenCalled();
  });
  it('lock: expired → Timed out', async () => {
    const h = harness();
    h.reply('clarify.lock', { status: 'expired' });
    expect(await h.r.clarifyLock(clarify(), 'q0', 'x')).toBe('expired');
    expect(h.actions).toEqual([{ type: 'request.cancelled', id: 'srq-1', reason: 'timeout' }]);
  });
  it('lock: RPC failure → failed, no state change', async () => {
    const h = harness();
    h.reply('clarify.lock', new RpcError('bad qid', 4002));
    expect(await h.r.clarifyLock(clarify(), 'q9', 'x')).toBe('failed');
    expect(h.actions).toEqual([]);
  });
  it('lock on a non-pending card does nothing', async () => {
    const h = harness();
    expect(await h.r.clarifyLock(clarify({ status: 'answering' }), 'q0', 'x')).toBe('failed');
    expect(h.calls).toHaveLength(0);
  });
  it('submitAll locks the given questions in order and resolves', async () => {
    const h = harness();
    h.reply('clarify.lock', { status: 'ok', remaining: ['q2'] }, { status: 'ok', remaining: [] });
    expect(await h.r.clarifySubmitAll(clarify(), [{ qid: 'q1', answer: 'x' }, { qid: 'q2', answer: '' }])).toBe('resolved');
    expect(h.calls.map((c) => (c.params as { question_id: string }).question_id)).toEqual(['q1', 'q2']);
    expect(h.actions[0]).toEqual({ type: 'request.answering', id: 'srq-1' });
  });
  it('submitAll stops at expired (Review Focus 4)', async () => {
    const h = harness();
    h.reply('clarify.lock', { status: 'ok', remaining: ['q2'] }, { status: 'expired' });
    expect(await h.r.clarifySubmitAll(clarify(), [{ qid: 'q1', answer: 'x' }, { qid: 'q2', answer: 'y' }, { qid: 'q3', answer: 'z' }])).toBe('expired');
    expect(h.calls).toHaveLength(2);
    expect(h.actions.at(-1)).toEqual({ type: 'request.cancelled', id: 'srq-1', reason: 'timeout' });
  });
  it('submitAll failure mid-way keeps earlier locks and re-arms the card (Review Focus 4)', async () => {
    const h = harness();
    h.reply('clarify.lock', { status: 'ok', remaining: ['q2'] }, new RpcError('socket closed', -1));
    expect(await h.r.clarifySubmitAll(clarify(), [{ qid: 'q1', answer: 'x' }, { qid: 'q2', answer: 'y' }])).toBe('failed');
    expect(h.actions).toEqual([
      { type: 'request.answering', id: 'srq-1' },
      { type: 'request.locked', id: 'srq-1', qid: 'q1', answer: 'x' },
      { type: 'request.failed', id: 'srq-1' },
    ]);
  });
  it('skipAll responds with no answers (cancel-all)', () => {
    const h = harness();
    expect(h.r.clarifySkipAll(clarify())).toEqual({ ok: true });
    expect(h.respond).toHaveBeenCalledWith('srq-1', {});
    expect(h.actions).toEqual([{ type: 'request.answered', id: 'srq-1', skipped: true }]);
  });
});

describe('value (sudo/secret)', () => {
  const SECRET = 'sk-live-DO-NOT-LEAK-4242';
  it('responds {value} and dispatches nothing that contains the value', () => {
    const h = harness();
    expect(h.r.value(base({ kind: 'secure-entry', method: 'secret' }), SECRET)).toEqual({ ok: true });
    expect(h.respond).toHaveBeenCalledWith('srq-1', { value: SECRET });
    expect(h.actions).toEqual([{ type: 'request.answered', id: 'srq-1', skipped: false }]);
    expect(JSON.stringify(h.actions)).not.toContain(SECRET);
  });
  it('"" is Skip', () => {
    const h = harness();
    h.r.value(base({ kind: 'secure-entry', method: 'sudo' }), '');
    expect(h.respond).toHaveBeenCalledWith('srq-1', { value: '' });
    expect(h.actions).toEqual([{ type: 'request.answered', id: 'srq-1', skipped: true }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/request-answers.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/request-answers'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/request-answers.ts
//
// Answering server→client requests (spec §6). Pure with injected I/O. Cards answer optimistically:
// 0.21.5 sends no ack for a response frame (review M10). Secret values pass straight through to
// `registry.respond` and are NEVER put into a dispatched action.
import type { GatewayClient } from '@/api/gatewayClient';
import { resolvedCount } from '@/lib/approval';
import type { RequestRegistry } from '@/lib/request-registry';
import type { RequestCardState, TurnAction } from '@/lib/turn-controller';
import type { ApprovalResult, ClarifyResult, ValueResult } from '@/vendor/hermes-gateway';

export function approvalResult(choice: ApprovalResult['choice']): ApprovalResult {
  return { choice };
}
export function clarifySingleResult(answer: string): ClarifyResult {
  return { answer };
}
export function clarifySkipAllResult(): ClarifyResult {
  return {};
}
export function valueResult(value: string): ValueResult {
  return { value };
}

export type ClarifyAnswer = string | string[];
export type AnswerOutcome = { ok: true } | { ok: false; message: string };
/** `resolved`: the last lock resolved the whole batch. `expired`: the wait already ended. */
export type LockOutcome = 'ok' | 'resolved' | 'expired' | 'failed';

export interface ResponderDeps {
  registry: Pick<RequestRegistry, 'respond'>;
  call: GatewayClient['call'];
  dispatch: (a: TurnAction) => void;
  liveSessionId: () => string | null;
}

export interface RequestResponder {
  approve(card: RequestCardState, choice: ApprovalResult['choice']): Promise<AnswerOutcome>;
  clarifySingle(card: RequestCardState, answer: ClarifyAnswer): AnswerOutcome;
  clarifyLock(card: RequestCardState, qid: string, answer: ClarifyAnswer): Promise<LockOutcome>;
  clarifySubmitAll(card: RequestCardState, answers: Array<{ qid: string; answer: ClarifyAnswer }>): Promise<LockOutcome>;
  clarifySkipAll(card: RequestCardState): AnswerOutcome;
  value(card: RequestCardState, value: string): AnswerOutcome;
}

const GONE: AnswerOutcome = { ok: false, message: 'This request is no longer open.' };

function summary(answer: ClarifyAnswer): string {
  return Array.isArray(answer) ? answer.join(', ') : answer;
}

export function createRequestResponder(deps: ResponderDeps): RequestResponder {
  /** Response frame via the latest delivery of this id; an unknown id means it's gone. */
  function respond(card: RequestCardState, result: Record<string, unknown>): boolean {
    if (deps.registry.respond(card.id, result)) return true;
    deps.dispatch({ type: 'request.cancelled', id: card.id, reason: 'session_closed' });
    return false;
  }

  async function lock(card: RequestCardState, qid: string, answer: ClarifyAnswer): Promise<LockOutcome> {
    try {
      const res = await deps.call('clarify.lock', { request_id: card.id, question_id: qid, answer });
      if (res.status === 'expired') {
        deps.dispatch({ type: 'request.cancelled', id: card.id, reason: 'timeout' });
        return 'expired';
      }
      deps.dispatch({ type: 'request.locked', id: card.id, qid, answer });
      if (Array.isArray(res.remaining) && res.remaining.length === 0) {
        deps.dispatch({ type: 'request.answered', id: card.id });
        return 'resolved';
      }
      return 'ok';
    } catch {
      return 'failed';
    }
  }

  return {
    async approve(card, choice) {
      if (card.status !== 'pending') return { ok: true };
      if (!card.legacy) {
        if (!respond(card, { ...approvalResult(choice) })) return GONE;
        deps.dispatch({ type: 'request.answered', id: card.id, resolution: choice });
        return { ok: true };
      }
      const sid = deps.liveSessionId();
      if (!sid) return { ok: false, message: 'Not connected.' };
      deps.dispatch({ type: 'request.answering', id: card.id });
      try {
        const res = await deps.call('approval.respond', { session_id: sid, choice });
        if (resolvedCount(res) > 0) deps.dispatch({ type: 'request.answered', id: card.id, resolution: choice });
        else deps.dispatch({ type: 'request.cancelled', id: card.id, reason: 'resolved' });
        return { ok: true };
      } catch (e) {
        deps.dispatch({ type: 'request.failed', id: card.id });
        return { ok: false, message: e instanceof Error && e.message ? e.message : 'Approval failed.' };
      }
    },

    clarifySingle(card, answer) {
      if (card.status !== 'pending') return { ok: true };
      // ClarifyResult.answer is a string; the gateway parses a JSON array for multi-select.
      const wire = Array.isArray(answer) ? JSON.stringify(answer) : answer;
      if (!respond(card, { ...clarifySingleResult(wire) })) return GONE;
      deps.dispatch({ type: 'request.answered', id: card.id, skipped: wire === '', resolution: summary(answer) });
      return { ok: true };
    },

    async clarifyLock(card, qid, answer) {
      if (card.status !== 'pending') return 'failed';
      return lock(card, qid, answer);
    },

    async clarifySubmitAll(card, answers) {
      if (card.status !== 'pending') return 'failed';
      deps.dispatch({ type: 'request.answering', id: card.id });
      for (const { qid, answer } of answers) {
        const out = await lock(card, qid, answer);
        if (out === 'resolved' || out === 'expired') return out;
        if (out === 'failed') {
          deps.dispatch({ type: 'request.failed', id: card.id });
          return 'failed';
        }
      }
      // Every question we know of is locked but the gateway still lists some open: stay answerable.
      deps.dispatch({ type: 'request.failed', id: card.id });
      return 'ok';
    },

    clarifySkipAll(card) {
      if (card.status !== 'pending') return { ok: true };
      if (!respond(card, { ...clarifySkipAllResult() })) return GONE;
      deps.dispatch({ type: 'request.answered', id: card.id, skipped: true });
      return { ok: true };
    },

    value(card, value) {
      if (card.status !== 'pending') return { ok: true };
      if (!respond(card, { ...valueResult(value) })) return GONE;
      deps.dispatch({ type: 'request.answered', id: card.id, skipped: value === '' });
      return { ok: true };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/request-answers.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate + commit**

```bash
npx tsc --noEmit && npx jest
git add src/lib/request-answers.ts __tests__/request-answers.test.ts
git commit -m "feat(cards): request answering — approval (both paths), clarify single/batch, value

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Clarify view model (`src/lib/clarify.ts`)

**Files:**
- Create: `src/lib/clarify.ts`
- Test: `__tests__/clarify.test.ts`

**Interfaces:**
- Consumes: `ClarifyRequestParams` (barrel), `ClarifyAnswer` (Task 5).
- Produces: `ClarifyChoiceView {label, recommended}`, `ClarifyQuestionView {qid, question, choices, multiSelect}`,
  `ClarifyView {batch, questions}`, `ClarifyDraft {selected, other}`, `EMPTY_DRAFT`, `SINGLE_QID`,
  `parseChoice`, `clarifyView`, `toggleChoice`, `setOther`, `draftAnswer`, `lockedAnswerLabel`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/clarify.test.ts
import {
  EMPTY_DRAFT, SINGLE_QID, clarifyView, draftAnswer, lockedAnswerLabel, parseChoice, setOther, toggleChoice,
} from '../src/lib/clarify';

test('parseChoice turns the wire "(Recommended)" suffix into a badge flag', () => {
  expect(parseChoice('Blue (Recommended)')).toEqual({ label: 'Blue', recommended: true });
  expect(parseChoice('Red')).toEqual({ label: 'Red', recommended: false });
});

test('single question view', () => {
  expect(clarifyView({ session_id: 's', question: 'Color?', choices: ['Blue (Recommended)', 'Red'], multi_select: true })).toEqual({
    batch: false,
    questions: [{ qid: SINGLE_QID, question: 'Color?', multiSelect: true, choices: [{ label: 'Blue', recommended: true }, { label: 'Red', recommended: false }] }],
  });
});

test('choices null means a text field only, and multi_select is ignored without choices', () => {
  const v = clarifyView({ session_id: 's', question: 'Why?', choices: null, multi_select: true });
  expect(v.questions[0]).toMatchObject({ choices: null, multiSelect: false });
});

test('batch view keeps qids and per-question multi_select', () => {
  const v = clarifyView({
    session_id: 's',
    questions: [
      { qid: 'q0', question: 'A?', choices: ['x', 'y'], multi_select: true },
      { qid: 'q1', question: 'B?', choices: null, multi_select: false },
    ],
  });
  expect(v.batch).toBe(true);
  expect(v.questions.map((q) => [q.qid, q.multiSelect])).toEqual([['q0', true], ['q1', false]]);
});

describe('drafts', () => {
  const radio = { qid: 'q0', question: '?', multiSelect: false, choices: [{ label: 'A', recommended: false }, { label: 'B', recommended: false }] };
  const multi = { ...radio, multiSelect: true };
  const open = { qid: 'q1', question: '?', multiSelect: false, choices: null };
  it('radio: selecting replaces; Other text replaces the choice', () => {
    let d = toggleChoice(radio, EMPTY_DRAFT, 'A');
    d = toggleChoice(radio, d, 'B');
    expect(draftAnswer(radio, d)).toBe('B');
    d = setOther(radio, d, 'Teal');
    expect(d.selected).toEqual([]);
    expect(draftAnswer(radio, d)).toBe('Teal');
  });
  it('multi: toggles, keeps choice order, appends Other', () => {
    let d = toggleChoice(multi, EMPTY_DRAFT, 'B');
    d = toggleChoice(multi, d, 'A');
    expect(draftAnswer(multi, d)).toEqual(['A', 'B']);
    d = toggleChoice(multi, d, 'A');
    d = setOther(multi, d, ' C ');
    expect(draftAnswer(multi, d)).toEqual(['B', 'C']);
  });
  it('nothing chosen → null; open question uses the text', () => {
    expect(draftAnswer(radio, EMPTY_DRAFT)).toBeNull();
    expect(draftAnswer(multi, EMPTY_DRAFT)).toBeNull();
    expect(draftAnswer(open, setOther(open, EMPTY_DRAFT, '  because  '))).toBe('because');
  });
});

test('lockedAnswerLabel renders replayed JSON-array strings, arrays and skips', () => {
  expect(lockedAnswerLabel('["a","b"]')).toBe('a, b');
  expect(lockedAnswerLabel(['a', 'b'])).toBe('a, b');
  expect(lockedAnswerLabel('plain')).toBe('plain');
  expect(lockedAnswerLabel('[not json')).toBe('[not json');
  expect(lockedAnswerLabel('')).toBe('');
  expect(lockedAnswerLabel(undefined)).toBe('');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/clarify.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/clarify'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/clarify.ts — view model for the clarify card (spec §6.2).
import type { ClarifyAnswer } from '@/lib/request-answers';
import type { ClarifyRequestParams } from '@/vendor/hermes-gateway';

const RECOMMENDED = /\s*\(recommended\)\s*$/i;
/** Pseudo-qid for the single-question shape (it has no qids; never sent on the wire). */
export const SINGLE_QID = 'single';

export interface ClarifyChoiceView { label: string; recommended: boolean }
export interface ClarifyQuestionView {
  qid: string;
  question: string;
  choices: ClarifyChoiceView[] | null;
  multiSelect: boolean;
}
export interface ClarifyView { batch: boolean; questions: ClarifyQuestionView[] }
/** `selected` holds choice labels (suffix stripped — the gateway strips it anyway). */
export interface ClarifyDraft { selected: string[]; other: string }
export const EMPTY_DRAFT: ClarifyDraft = { selected: [], other: '' };

export function parseChoice(wire: string): ClarifyChoiceView {
  const recommended = RECOMMENDED.test(wire);
  return { label: recommended ? wire.replace(RECOMMENDED, '') : wire, recommended };
}

function choicesOf(raw: string[] | null | undefined): ClarifyChoiceView[] | null {
  return Array.isArray(raw) && raw.length > 0 ? raw.map(parseChoice) : null;
}

export function clarifyView(params: ClarifyRequestParams): ClarifyView {
  if (Array.isArray(params.questions) && params.questions.length > 0) {
    return {
      batch: true,
      questions: params.questions.map((q) => {
        const choices = choicesOf(q.choices);
        return { qid: q.qid, question: q.question, choices, multiSelect: Boolean(q.multi_select) && choices !== null };
      }),
    };
  }
  const choices = choicesOf(params.choices);
  return {
    batch: false,
    questions: [{ qid: SINGLE_QID, question: params.question ?? '', choices, multiSelect: Boolean(params.multi_select) && choices !== null }],
  };
}

export function toggleChoice(q: ClarifyQuestionView, d: ClarifyDraft, label: string): ClarifyDraft {
  if (!q.multiSelect) return { selected: [label], other: '' };
  return d.selected.includes(label)
    ? { ...d, selected: d.selected.filter((s) => s !== label) }
    : { ...d, selected: [...d.selected, label] };
}

export function setOther(q: ClarifyQuestionView, d: ClarifyDraft, text: string): ClarifyDraft {
  if (q.multiSelect) return { ...d, other: text };
  return { selected: text.trim() ? [] : d.selected, other: text };
}

/** The answer to send, or null when nothing is chosen yet. */
export function draftAnswer(q: ClarifyQuestionView, d: ClarifyDraft): ClarifyAnswer | null {
  const other = d.other.trim();
  if (q.multiSelect) {
    const ordered = (q.choices ?? []).map((c) => c.label).filter((l) => d.selected.includes(l));
    const all = other ? [...ordered, other] : ordered;
    return all.length > 0 ? all : null;
  }
  if (other) return other;
  return d.selected[0] ?? null;
}

/** Display text for a locked answer ('' = skipped; replayed multi-select arrives as JSON text). */
export function lockedAnswerLabel(answer: unknown): string {
  if (Array.isArray(answer)) return answer.map(String).join(', ');
  if (typeof answer !== 'string') return '';
  if (answer.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(answer);
      if (Array.isArray(parsed)) return parsed.map(String).join(', ');
    } catch {
      // not JSON — show as typed
    }
  }
  return answer;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx jest __tests__/clarify.test.ts` → PASS.

- [ ] **Step 5: Full gate + commit**

```bash
npx tsc --noEmit && npx jest
git add src/lib/clarify.ts __tests__/clarify.test.ts
git commit -m "feat(cards): clarify view model — choices, Recommended badge, drafts, locked labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Approval card on `RequestCardState` (0.21.5 + legacy FIFO)

**Files:**
- Rewrite: `src/components/approval-card.tsx`
- Modify: `src/lib/approval.ts`, `src/components/message-row.tsx`, `src/lib/export.ts`, `__tests__/export.test.ts`, `src/app/dev-cards.tsx`, and `src/app/chat/[id].tsx` (A's `renderRequest` approval branch — required, or `tsc` fails on the new props)
- Test: `__tests__/approval-card.test.tsx`, `__tests__/approval.test.ts` (extend)

**Interfaces:**
- Consumes: `RequestCardState`, `cancelLabel` (A), `ApprovalResult` (barrel).
- Produces: `approvalView(params: unknown): ApprovalView {command, description, patternKey, toolName}`;
  `ApprovalCard({ card, actionable, onRespond(choice: ApprovalResult['choice']) })`.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/approval.test.ts`:

```ts
import { approvalView } from '../src/lib/approval';

describe('approvalView', () => {
  it('reads the 0.21.5 server-request params', () => {
    expect(approvalView({ session_id: 's', request_id: 'r', command: 'rm -rf x', description: 'delete', tool_name: 'terminal', choices: ['once', 'deny'] }))
      .toEqual({ command: 'rm -rf x', description: 'delete', patternKey: '', toolName: 'terminal' });
  });
  it('reads the legacy 0.20.4 event payload', () => {
    expect(approvalView({ command: 'rm -rf x', description: 'd', pattern_keys: ['recursive delete'] }))
      .toEqual({ command: 'rm -rf x', description: 'd', patternKey: 'recursive delete', toolName: '' });
  });
  it('tolerates garbage', () => {
    expect(approvalView(null)).toEqual({ command: '', description: '', patternKey: '', toolName: '' });
  });
});
```

```tsx
// __tests__/approval-card.test.tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApprovalCard } from '../src/components/approval-card';
import type { RequestCardState } from '../src/lib/turn-controller';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Medium: 'medium' } }));

const card = (over: Partial<RequestCardState> = {}): RequestCardState => ({
  id: 'srq-1', kind: 'approval', method: 'approval', status: 'pending', legacy: false, receivedAt: 0, anchorKey: null,
  params: { session_id: 's', request_id: 'r', command: 'rm -rf build', description: 'Recursive delete' },
  ...over,
});

test('pending + actionable: Approve sends once, Deny sends deny', async () => {
  const onRespond = jest.fn();
  await render(<ApprovalCard card={card()} actionable onRespond={onRespond} />);
  expect(screen.getByText('rm -rf build')).toBeOnTheScreen();
  expect(screen.getByText('Recursive delete')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Approve, run this command once' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Deny, block this command' }));
  expect(onRespond.mock.calls).toEqual([['once'], ['deny']]);
});

test('legacy, not the oldest: disabled with the FIFO hint', async () => {
  const onRespond = jest.fn();
  await render(<ApprovalCard card={card({ id: 'legacy:2', legacy: true })} actionable={false} onRespond={onRespond} />);
  expect(screen.getByText('Waiting for the earlier approval above…')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Approve, run this command once' }));
  expect(onRespond).not.toHaveBeenCalled();
});

test('answering shows Sending…', async () => {
  await render(<ApprovalCard card={card({ status: 'answering' })} actionable onRespond={jest.fn()} />);
  expect(screen.getByText('Sending…')).toBeOnTheScreen();
});

test.each([
  [{ status: 'answered', resolution: 'once' }, 'Approved'],
  [{ status: 'answered', resolution: 'deny' }, 'Denied'],
  [{ status: 'cancelled', cancelReason: 'interrupted' }, 'Stopped'],
  [{ status: 'cancelled', cancelReason: 'timeout' }, 'Timed out'],
  [{ status: 'cancelled', cancelReason: 'resolved' }, 'Answered elsewhere'],
  [{ status: 'cancelled', cancelReason: 'shutdown' }, 'Closed'],
] as Array<[Partial<RequestCardState>, string]>)('settled %o → %s, no buttons', async (over, label) => {
  await render(<ApprovalCard card={card(over)} actionable={false} onRespond={jest.fn()} />);
  expect(screen.getByText(label)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Approve, run this command once' })).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/approval.test.ts __tests__/approval-card.test.tsx`
Expected: FAIL — `approvalView` is not exported; `ApprovalCard` has no `card` prop.

- [ ] **Step 3: Implement `approvalView`** — append to `src/lib/approval.ts`:

```ts
/** Display fields for either approval shape: the 0.21.5 `approval` server-request params
 *  (ApprovalRequestParams) or the legacy 0.20.4 `approval.request` event payload. */
export interface ApprovalView {
  command: string;
  description: string;
  patternKey: string;
  toolName: string;
}

export function approvalView(params: unknown): ApprovalView {
  const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const keys = Array.isArray(p.pattern_keys)
    ? p.pattern_keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
    : [];
  return {
    command: str(p.command),
    description: str(p.description),
    patternKey: str(p.pattern_key) || keys[0] || '',
    toolName: str(p.tool_name),
  };
}
```

- [ ] **Step 4: Rewrite `src/components/approval-card.tsx`**

```tsx
import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/icon';
import { approvalView } from '@/lib/approval';
import { cancelLabel, type RequestCardState } from '@/lib/turn-controller';
import { useTheme, type ThemeColors } from '@/theme';
import type { ApprovalResult } from '@/vendor/hermes-gateway';

function ResolvedRow({ card, colors }: { card: RequestCardState; colors: ThemeColors }) {
  const m =
    card.status === 'answered'
      ? card.resolution === 'deny'
        ? { icon: 'xmark.circle.fill', tint: colors.danger, label: 'Denied' }
        : { icon: 'checkmark.circle.fill', tint: colors.success, label: 'Approved' }
      : { icon: 'slash.circle', tint: colors.textFaint, label: card.cancelReason ? cancelLabel(card.cancelReason) : 'Closed' };
  return (
    <View accessibilityLabel={`Approval ${m.label}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 }}>
      <Icon sf={m.icon} size={14} color={m.tint} />
      <Text style={{ color: m.tint, fontSize: 13.5, fontWeight: '600' }}>{m.label}</Text>
    </View>
  );
}

/**
 * Dangerous-command approval. 0.21.5 (`approval` server request): every pending card is actionable.
 * Legacy 0.20.4 (`approval.request` event): FIFO — only the oldest is `actionable`.
 */
export function ApprovalCard({
  card,
  actionable,
  onRespond,
}: {
  card: RequestCardState;
  actionable: boolean;
  onRespond: (choice: ApprovalResult['choice']) => void;
}) {
  const { colors } = useTheme();
  const view = approvalView(card.params);
  const pending = card.status === 'pending' || card.status === 'answering';
  const canAct = card.status === 'pending' && actionable;

  function respond(choice: ApprovalResult['choice']) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onRespond(choice);
  }

  return (
    <View
      accessibilityLabel={`Approval required: ${view.description || view.command}`}
      style={{
        backgroundColor: colors.raised,
        borderRadius: 16,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: pending ? colors.accent : colors.border,
        padding: 14,
        gap: 10,
        marginVertical: 6,
        alignSelf: 'stretch',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon sf="exclamationmark.shield.fill" size={15} color={pending ? colors.accent : colors.textFaint} />
        <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: '700', flexShrink: 1 }}>Approval required</Text>
        <View style={{ flex: 1 }} />
        {view.patternKey || view.toolName ? (
          <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 12, flexShrink: 1 }}>
            {view.patternKey || view.toolName}
          </Text>
        ) : null}
      </View>

      {view.description ? (
        <Text style={{ color: colors.textDim, fontSize: 13.5, lineHeight: 19 }}>{view.description}</Text>
      ) : null}

      {view.command ? (
        <View style={{ backgroundColor: colors.surface, borderRadius: 10, borderCurve: 'continuous', padding: 10 }}>
          <Text selectable style={{ color: colors.text, fontFamily: 'Menlo', fontSize: 12.5, lineHeight: 18 }}>
            {view.command}
          </Text>
        </View>
      ) : null}

      {card.status === 'answering' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <ActivityIndicator size="small" color={colors.textDim} />
          <Text style={{ color: colors.textDim, fontSize: 13.5 }}>Sending…</Text>
        </View>
      ) : card.status === 'pending' ? (
        <>
          <View style={{ flexDirection: 'row', gap: 10, opacity: canAct ? 1 : 0.45 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Deny, block this command"
              accessibilityState={{ disabled: !canAct }}
              disabled={!canAct}
              onPress={() => respond('deny')}
              style={({ pressed }) => ({
                flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
                borderRadius: 12, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.danger,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: colors.danger, fontSize: 15.5, fontWeight: '600' }}>Deny</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Approve, run this command once"
              accessibilityState={{ disabled: !canAct }}
              disabled={!canAct}
              onPress={() => respond('once')}
              style={({ pressed }) => ({
                flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
                borderRadius: 12, borderCurve: 'continuous',
                backgroundColor: pressed ? colors.accentPressed : colors.accent,
              })}
            >
              <Text style={{ color: colors.onAccent, fontSize: 15.5, fontWeight: '700' }}>Approve</Text>
            </Pressable>
          </View>
          {!canAct && card.legacy ? (
            <Text style={{ color: colors.textFaint, fontSize: 12.5 }}>Waiting for the earlier approval above…</Text>
          ) : null}
        </>
      ) : (
        <ResolvedRow card={card} colors={colors} />
      )}
    </View>
  );
}
```

- [ ] **Step 5: Remove the dead item-based approval path** (nothing produces `ChatItem.approval` after A;
run `grep -n "approval" src/components/message-row.tsx src/lib/export.ts __tests__/export.test.ts 'src/app/chat/[id].tsx'` and apply each edit that still matches):

- `message-row.tsx`: delete `import type { ApprovalInfo } from '@/components/approval-card';`, remove
  `'approval' | ` from the `role` union, delete the `approval?: ApprovalInfo;` member and its 2-line
  comment, and change `if (item.role === 'approval' || item.role === 'subagent' || item.role === 'todo') return null;`
  to `if (item.role === 'subagent' || item.role === 'todo') return null;`.
- `export.ts`: delete the `case 'approval': { … }` block in `textLine` and the `if (item.approval) { … }` block in `toRecord`.
- `export.test.ts`: replace the test `'renders status lines and approval lines with resolved status'` with

```ts
  it('renders status lines', () => {
    const mixed: ChatItem[] = [{ key: 'a', role: 'status', text: 'Compacting context…' }];
    expect(exportAsText(mixed)).toBe('[status] Compacting context…');
  });
```

  and delete the test `'serializes approval command, description and status'`.
- `[id].tsx` (A already removed `appendApproval`, `cancelPendingApprovals`, `activeApprovalKey` and the
  `item.approval` branch — contract R3). Keep `tsc` green against the new `ApprovalCard` props:
  1. change A's `import { ApprovalCard, type ApprovalInfo } from '@/components/approval-card';` to
     `import { ApprovalCard } from '@/components/approval-card';`;
  2. change A's `import { parseApprovalRequest, resolvedCount, type ApprovalChoice } from '@/lib/approval';` to
     `import { resolvedCount, type ApprovalChoice } from '@/lib/approval';` (A's `respondApproval` still uses both);
  3. add `isApprovalActionable` to the `@/lib/turn-controller` import;
  4. delete A's `activeLegacyId` constant (from `// Legacy (0.20.4) approvals are FIFO: only the oldest open legacy card is actionable.`
     through its `)?.id;`) and A's whole `function approvalInfo(card: RequestCardState): ApprovalInfo | null { … }`;
  5. in A's `renderRequest`, replace the `if (card.kind === 'approval') { … }` block with:

```tsx
    if (card.kind === 'approval') {
      return (
        <ApprovalCard
          card={card}
          actionable={isApprovalActionable(turn.requests, card.id)}
          onRespond={(choice) => void respondApproval(card, choice)}
        />
      );
    }
```

  **Do not delete A's `respondApproval`** here — Task 11 replaces it with the responder. Check:
  `grep -n -E "ApprovalInfo|approvalInfo|activeLegacyId|parseApprovalRequest" 'src/app/chat/[id].tsx' src/components/message-row.tsx; echo "exit=$?"`
  prints only `exit=1`.

- [ ] **Step 6: Gallery section** — in `src/app/dev-cards.tsx` add
`import { ApprovalCard } from '@/components/approval-card'; import type { RequestCardState } from '@/lib/turn-controller';`,
this helper above `DevCards`:

```tsx
function devCard(over: Partial<RequestCardState> & Pick<RequestCardState, 'id' | 'kind' | 'method' | 'params'>): RequestCardState {
  return { status: 'pending', legacy: false, receivedAt: Date.now(), anchorKey: null, ...over };
}
const devApproval = { session_id: 's', request_id: 'r', command: 'rm -rf build/ dist/', description: 'Recursive delete of two directories' };
```

and before `{/* dev-cards:end */}`:

```tsx
      <Section title="Approval">
        <ApprovalCard card={devCard({ id: 'a1', kind: 'approval', method: 'approval', params: devApproval })} actionable onRespond={() => {}} />
        <ApprovalCard card={devCard({ id: 'a2', kind: 'approval', method: 'approval', params: devApproval, legacy: true })} actionable={false} onRespond={() => {}} />
        <ApprovalCard card={devCard({ id: 'a3', kind: 'approval', method: 'approval', params: devApproval, status: 'answered', resolution: 'deny' })} actionable={false} onRespond={() => {}} />
        <ApprovalCard card={devCard({ id: 'a4', kind: 'approval', method: 'approval', params: devApproval, status: 'cancelled', cancelReason: 'interrupted' })} actionable={false} onRespond={() => {}} />
      </Section>
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest __tests__/approval.test.ts __tests__/approval-card.test.tsx __tests__/export.test.ts`
Expected: PASS.

- [ ] **Step 8: Screenshots** — Screenshot procedure with `NAME=approval`. Check the Deny outline
(`colors.danger`) is legible on `colors.raised` in light, and the dimmed FIFO card is visibly inactive.

- [ ] **Step 9: Full gate + commit**

```bash
npx tsc --noEmit && npx jest
git add src/components/approval-card.tsx src/lib/approval.ts src/components/message-row.tsx src/lib/export.ts 'src/app/chat/[id].tsx' src/app/dev-cards.tsx __tests__/approval.test.ts __tests__/approval-card.test.tsx __tests__/export.test.ts docs/screenshots/turn-control/approval-*.png
git commit -m "feat(cards): approval card on request state — per-id 0.21.5, FIFO legacy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Clarify card (single + batch)

**Files:**
- Create: `src/components/card-button.tsx`, `src/components/clarify-card.tsx`
- Modify: `src/app/dev-cards.tsx`
- Test: `__tests__/clarify-card.test.tsx`

**Interfaces:**
- Consumes: Task 5 `RequestResponder`, `ClarifyAnswer`; Task 6 view model; `cancelLabel` (A).
- Produces: `CardButton({ label, a11y, onPress, disabled?, primary?, flex? })`;
  `ClarifyCard({ card, responder: Pick<RequestResponder, 'clarifySingle'|'clarifyLock'|'clarifySubmitAll'|'clarifySkipAll'>, onInputFocus? })`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/clarify-card.test.tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ClarifyCard } from '../src/components/clarify-card';
import type { RequestCardState } from '../src/lib/turn-controller';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));

const card = (params: Record<string, unknown>, over: Partial<RequestCardState> = {}): RequestCardState => ({
  id: 'srq-c', kind: 'clarify', method: 'clarify', status: 'pending', legacy: false, receivedAt: 0, anchorKey: null,
  params: { session_id: 's', ...params }, ...over,
});
const responder = () => ({
  clarifySingle: jest.fn((_c: RequestCardState, _a: string | string[]) => ({ ok: true as const })),
  clarifyLock: jest.fn(async (_c: RequestCardState, _q: string, _a: string | string[]) => 'ok' as const),
  clarifySubmitAll: jest.fn(async (_c: RequestCardState, _a: Array<{ qid: string; answer: string | string[] }>) => 'resolved' as const),
  clarifySkipAll: jest.fn((_c: RequestCardState) => ({ ok: true as const })),
});
const batch = {
  questions: [
    { qid: 'q0', question: 'Which env?', choices: ['staging (Recommended)', 'prod'], multi_select: false },
    { qid: 'q1', question: 'Anything else?', choices: null, multi_select: false },
  ],
};

test('single: Recommended badge, radio choice, Send sends the label', async () => {
  const r = responder();
  const c = card({ question: 'Color?', choices: ['Blue (Recommended)', 'Red'] });
  await render(<ClarifyCard card={c} responder={r} />);
  expect(screen.getByText('Recommended')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('radio', { name: 'Blue, recommended' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
  expect(r.clarifySingle).toHaveBeenCalledWith(c, 'Blue');
  expect(r.clarifyLock).not.toHaveBeenCalled();
});

test('single: Other text replaces the radio choice', async () => {
  const r = responder();
  await render(<ClarifyCard card={card({ question: 'Color?', choices: ['Red'] })} responder={r} />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Red' }));
  await fireEvent.changeText(screen.getByLabelText('Other answer'), 'Teal');
  await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
  expect(r.clarifySingle.mock.calls[0][1]).toBe('Teal');
});

test('single: choices null → text field only; Skip sends ""', async () => {
  const r = responder();
  await render(<ClarifyCard card={card({ question: 'Why?', choices: null })} responder={r} />);
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(screen.getByLabelText('Answer')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Skip question' }));
  expect(r.clarifySingle.mock.calls[0][1]).toBe('');
});

test('single multi-select: checkboxes, sends an array', async () => {
  const r = responder();
  await render(<ClarifyCard card={card({ question: 'Pick', choices: ['A', 'B', 'C'], multi_select: true })} responder={r} />);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'C' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'A' }));
  expect(screen.getByRole('checkbox', { name: 'A' })).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
  expect(r.clarifySingle.mock.calls[0][1]).toEqual(['A', 'C']);
});

test('batch: Confirm locks one question, per-question Skip locks ""', async () => {
  const r = responder();
  const c = card(batch);
  await render(<ClarifyCard card={c} responder={r} />);
  expect(screen.getByText('Hermes has 2 questions')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('radio', { name: 'prod' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm answer to question 1' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Skip question 2' }));
  expect(r.clarifyLock.mock.calls).toEqual([[c, 'q0', 'prod'], [c, 'q1', '']]);
});

test('batch: Submit all only sends unlocked questions (Review Focus 4)', async () => {
  const r = responder();
  const c = card({ ...batch, answers: { q0: 'staging' } }, { lockedAnswers: { q0: 'staging' } });
  await render(<ClarifyCard card={c} responder={r} />);
  expect(screen.getByText('staging')).toBeOnTheScreen(); // replayed lock renders as answered
  expect(screen.queryByRole('radio', { name: 'prod' })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Answer for question 2'), 'no');
  await fireEvent.press(screen.getByRole('button', { name: 'Submit all answers' }));
  expect(r.clarifySubmitAll).toHaveBeenCalledWith(c, [{ qid: 'q1', answer: 'no' }]);
});

test('batch: replayed multi-select lock renders as a list; Skip all cancels', async () => {
  const r = responder();
  const c = card(batch, { lockedAnswers: { q0: '["a","b"]' } });
  await render(<ClarifyCard card={c} responder={r} />);
  expect(screen.getByText('a, b')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Skip all questions' }));
  expect(r.clarifySkipAll).toHaveBeenCalledWith(c);
});

test('a failed lock shows a retry note', async () => {
  const r = responder();
  r.clarifyLock.mockResolvedValueOnce('failed' as never);
  await render(<ClarifyCard card={card(batch)} responder={r} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Skip question 2' }));
  expect(await screen.findByText("Couldn't send that answer. Try again.")).toBeOnTheScreen();
});

test.each([
  [{ status: 'cancelled', cancelReason: 'timeout' }, 'Timed out'],
  [{ status: 'cancelled', cancelReason: 'interrupted' }, 'Stopped'],
  [{ status: 'skipped' }, 'Skipped'],
  [{ status: 'answered', resolution: 'Blue' }, 'Answered: Blue'],
] as Array<[Partial<RequestCardState>, string]>)('settled %o → %s, no controls', async (over, label) => {
  await render(<ClarifyCard card={card({ question: 'Color?', choices: ['Blue'] }, over)} responder={responder()} />);
  expect(screen.getByText(label)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Send answer' })).toBeNull();
});

test('focusing a free-text field asks the screen to scroll the card into view (Review Focus 5)', async () => {
  const onInputFocus = jest.fn();
  await render(<ClarifyCard card={card({ question: 'Why?', choices: null })} responder={responder()} onInputFocus={onInputFocus} />);
  await fireEvent(screen.getByLabelText('Answer'), 'focus');
  expect(onInputFocus).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/clarify-card.test.tsx`
Expected: FAIL — `Cannot find module '../src/components/clarify-card'`.

- [ ] **Step 3: Implement the shared button**

```tsx
// src/components/card-button.tsx — the action button used inside request cards.
import { Pressable, Text } from 'react-native';
import { useTheme } from '@/theme';

export function CardButton({
  label,
  a11y,
  onPress,
  disabled = false,
  primary = false,
  flex = false,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  flex?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: flex ? 1 : undefined,
        minHeight: 44,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? (pressed ? colors.accentPressed : colors.accent) : pressed ? colors.surface : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: colors.border,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Text style={{ color: primary ? colors.onAccent : colors.text, fontSize: 15, fontWeight: primary ? '700' : '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 4: Implement the card**

```tsx
// src/components/clarify-card.tsx — the agent's clarify question(s) (spec §6.2).
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { CardButton } from '@/components/card-button';
import { Icon } from '@/components/icon';
import {
  EMPTY_DRAFT, clarifyView, draftAnswer, lockedAnswerLabel, setOther, toggleChoice,
  type ClarifyDraft, type ClarifyQuestionView,
} from '@/lib/clarify';
import type { ClarifyAnswer, RequestResponder } from '@/lib/request-answers';
import { cancelLabel, type RequestCardState } from '@/lib/turn-controller';
import { useTheme } from '@/theme';
import type { ClarifyRequestParams } from '@/vendor/hermes-gateway';

type ClarifyResponder = Pick<RequestResponder, 'clarifySingle' | 'clarifyLock' | 'clarifySubmitAll' | 'clarifySkipAll'>;

function SettledRow({ card }: { card: RequestCardState }) {
  const { colors } = useTheme();
  if (card.status === 'answering') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}>
        <ActivityIndicator size="small" color={colors.textDim} />
        <Text style={{ color: colors.textDim, fontSize: 13.5 }}>Sending…</Text>
      </View>
    );
  }
  const label =
    card.status === 'cancelled'
      ? card.cancelReason ? cancelLabel(card.cancelReason) : 'Closed'
      : card.status === 'skipped'
        ? 'Skipped'
        : card.resolution ? `Answered: ${card.resolution}` : 'Answered';
  const answered = card.status === 'answered';
  return (
    <View accessibilityLabel={`Question ${label}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon sf={answered ? 'checkmark.circle.fill' : 'slash.circle'} size={14} color={answered ? colors.success : colors.textFaint} />
      <Text style={{ color: answered ? colors.success : colors.textFaint, fontSize: 13.5, fontWeight: '600', flexShrink: 1 }}>{label}</Text>
    </View>
  );
}

function QuestionBlock(props: {
  q: ClarifyQuestionView;
  index: number;
  batch: boolean;
  draft: ClarifyDraft;
  onChange: (d: ClarifyDraft) => void;
  locked: boolean;
  lockedAnswer: unknown;
  disabled: boolean;
  onSkip: () => void;
  onConfirm: (answer: ClarifyAnswer) => void;
  onInputFocus?: () => void;
}) {
  const { q, index, batch, draft, onChange, locked, lockedAnswer, disabled, onSkip, onConfirm, onInputFocus } = props;
  const { colors } = useTheme();
  const n = index + 1;
  const forQ = batch ? ` for question ${n}` : '';
  if (locked) {
    const label = lockedAnswerLabel(lockedAnswer);
    return (
      <View accessibilityLabel={`Question ${n} answered: ${label || 'skipped'}`} style={{ gap: 4 }}>
        <Text style={{ color: colors.textDim, fontSize: 14, lineHeight: 20 }}>{q.question}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon sf="checkmark.circle.fill" size={13} color={colors.success} />
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 }}>{label || 'Skipped'}</Text>
        </View>
      </View>
    );
  }
  const answer = draftAnswer(q, draft);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '600' }}>
        {batch ? `${n}. ` : ''}
        {q.question}
      </Text>
      {q.choices?.map((c) => {
        const on = draft.selected.includes(c.label);
        return (
          <Pressable
            key={c.label}
            accessibilityRole={q.multiSelect ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: on, disabled }}
            accessibilityLabel={`${c.label}${c.recommended ? ', recommended' : ''}`}
            disabled={disabled}
            onPress={() => onChange(toggleChoice(q, draft, c.label))}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 10,
              borderRadius: 10, borderCurve: 'continuous', borderWidth: 1,
              borderColor: on ? colors.accent : colors.border,
              backgroundColor: pressed ? colors.surface : 'transparent',
            })}
          >
            <Icon
              sf={q.multiSelect ? (on ? 'checkmark.square.fill' : 'square') : on ? 'largecircle.fill.circle' : 'circle'}
              size={18}
              color={on ? colors.accent : colors.textFaint}
            />
            <Text style={{ color: colors.text, fontSize: 15, flexShrink: 1 }}>{c.label}</Text>
            {c.recommended ? (
              <View style={{ borderRadius: 6, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>Recommended</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
      <TextInput
        value={draft.other}
        onChangeText={(t) => onChange(setOther(q, draft, t))}
        onFocus={onInputFocus}
        editable={!disabled}
        multiline
        placeholder={q.choices ? 'Other…' : 'Your answer'}
        placeholderTextColor={colors.placeholder}
        accessibilityLabel={q.choices ? `Other answer${forQ}` : `Answer${forQ}`}
        style={{
          color: colors.text, backgroundColor: colors.surface, borderRadius: 10, borderCurve: 'continuous',
          borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 10,
          fontSize: 15, maxHeight: 100,
        }}
      />
      {batch ? (
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
          <CardButton label="Skip" a11y={`Skip question ${n}`} onPress={onSkip} disabled={disabled} />
          <CardButton
            label="Confirm"
            a11y={`Confirm answer to question ${n}`}
            onPress={() => answer !== null && onConfirm(answer)}
            disabled={disabled || answer === null}
            primary
          />
        </View>
      ) : null}
    </View>
  );
}

export function ClarifyCard({
  card,
  responder,
  onInputFocus,
}: {
  card: RequestCardState;
  responder: ClarifyResponder;
  onInputFocus?: () => void;
}) {
  const { colors } = useTheme();
  const view = clarifyView(card.params as ClarifyRequestParams);
  const [drafts, setDrafts] = useState<Record<string, ClarifyDraft>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pending = card.status === 'pending';
  const locked = card.lockedAnswers ?? {};
  const draftOf = (qid: string) => drafts[qid] ?? EMPTY_DRAFT;
  const setDraft = (qid: string, d: ClarifyDraft) => setDrafts((prev) => ({ ...prev, [qid]: d }));

  async function lock(qid: string, answer: ClarifyAnswer) {
    setBusy(true);
    setNote(null);
    const out = await responder.clarifyLock(card, qid, answer);
    setBusy(false);
    if (out === 'failed') setNote("Couldn't send that answer. Try again.");
  }

  async function submitAll() {
    const answers = view.questions
      .filter((q) => !(q.qid in locked))
      .map((q) => ({ qid: q.qid, answer: draftAnswer(q, draftOf(q.qid)) ?? '' }));
    setBusy(true);
    setNote(null);
    const out = await responder.clarifySubmitAll(card, answers);
    setBusy(false);
    if (out === 'failed') setNote("Couldn't send every answer. Try again.");
  }

  function finish(result: { ok: true } | { ok: false; message: string }) {
    if (!result.ok) setNote(result.message);
  }

  const first = view.questions[0];
  const singleAnswer = first ? draftAnswer(first, draftOf(first.qid)) : null;
  const title = view.batch ? `Hermes has ${view.questions.length} questions` : 'Hermes has a question';

  return (
    <View
      accessibilityLabel={title}
      style={{
        backgroundColor: colors.raised, borderRadius: 16, borderCurve: 'continuous', borderWidth: 1,
        borderColor: pending ? colors.accent : colors.border, padding: 14, gap: 14, marginVertical: 6, alignSelf: 'stretch',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon sf="questionmark.bubble" size={15} color={pending ? colors.accent : colors.textFaint} />
        <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: '700' }}>{title}</Text>
      </View>
      {view.questions.map((q, i) => (
        <QuestionBlock
          key={q.qid}
          q={q}
          index={i}
          batch={view.batch}
          draft={draftOf(q.qid)}
          onChange={(d) => setDraft(q.qid, d)}
          locked={view.batch && q.qid in locked}
          lockedAnswer={locked[q.qid]}
          disabled={!pending || busy}
          onSkip={() => void lock(q.qid, '')}
          onConfirm={(a) => void lock(q.qid, a)}
          onInputFocus={onInputFocus}
        />
      ))}
      {pending ? (
        view.batch ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <CardButton label="Skip all" a11y="Skip all questions" onPress={() => finish(responder.clarifySkipAll(card))} disabled={busy} flex />
            <CardButton label="Submit all" a11y="Submit all answers" onPress={() => void submitAll()} disabled={busy} primary flex />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <CardButton label="Skip" a11y="Skip question" onPress={() => finish(responder.clarifySingle(card, ''))} flex />
            <CardButton
              label="Send"
              a11y="Send answer"
              onPress={() => singleAnswer !== null && finish(responder.clarifySingle(card, singleAnswer))}
              disabled={singleAnswer === null}
              primary
              flex
            />
          </View>
        )
      ) : (
        <SettledRow card={card} />
      )}
      {note ? <Text style={{ color: colors.danger, fontSize: 13 }}>{note}</Text> : null}
    </View>
  );
}
```

- [ ] **Step 5: Gallery section** — in `src/app/dev-cards.tsx` add `import { ClarifyCard } from '@/components/clarify-card';`,
this constant above `DevCards`:

```tsx
const devClarifyResponder = {
  clarifySingle: () => ({ ok: true as const }),
  clarifyLock: async () => 'ok' as const,
  clarifySubmitAll: async () => 'resolved' as const,
  clarifySkipAll: () => ({ ok: true as const }),
};
const devBatch = {
  session_id: 's',
  questions: [
    { qid: 'q0', question: 'Which environment should I deploy to?', choices: ['staging (Recommended)', 'production'], multi_select: false },
    { qid: 'q1', question: 'Which checks should run first?', choices: ['unit', 'lint', 'e2e'], multi_select: true },
    { qid: 'q2', question: 'Anything I should avoid?', choices: null, multi_select: false },
  ],
};
```

and before `{/* dev-cards:end */}`:

```tsx
      <Section title="Clarify">
        <ClarifyCard card={devCard({ id: 'c1', kind: 'clarify', method: 'clarify', params: { session_id: 's', question: 'Tabs or spaces?', choices: ['Tabs (Recommended)', 'Spaces'] } })} responder={devClarifyResponder} />
        <ClarifyCard card={devCard({ id: 'c2', kind: 'clarify', method: 'clarify', params: devBatch, lockedAnswers: { q0: 'staging' } })} responder={devClarifyResponder} />
        <ClarifyCard card={devCard({ id: 'c3', kind: 'clarify', method: 'clarify', params: { session_id: 's', question: 'Why?', choices: null }, status: 'cancelled', cancelReason: 'timeout' })} responder={devClarifyResponder} />
      </Section>
```

- [ ] **Step 6: Run test to verify it passes** — `npx jest __tests__/clarify-card.test.tsx` → PASS.

- [ ] **Step 7: Screenshots** — Screenshot procedure with `NAME=clarify`. Also tap the "Other…" field of
the batch card so the keyboard is up and capture `clarify-keyboard-dark.png`
(`xcrun simctl io booted screenshot docs/screenshots/turn-control/clarify-keyboard-dark.png`). Check the
Recommended badge contrast (accent on `raised`) in light, selected-row accent border, checkbox vs radio glyphs.

- [ ] **Step 8: Full gate + commit**

```bash
npx tsc --noEmit && npx jest
git add src/components/card-button.tsx src/components/clarify-card.tsx src/app/dev-cards.tsx __tests__/clarify-card.test.tsx docs/screenshots/turn-control/clarify-*.png
git commit -m "feat(cards): clarify card — single and batch, locks, skip, submit/skip all

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Secure-entry foundations — provenance, countdown/copy, Face ID, native dep

**Files:**
- Modify: `src/api/skills.ts`, `app.json`, `package.json`
- Create: `src/lib/secure-entry.ts`, `src/lib/biometric.ts`
- Test: `__tests__/skills.test.ts`, `__tests__/secure-entry.test.ts`, `__tests__/biometric.test.ts`, `__tests__/app-config.test.ts`

**Interfaces:**
- Produces: `SkillInfo.provenance?: 'hub'|'bundled'|'agent'`; `listSkills(rest, profile?: string | null)`;
  `SECURE_ENTRY_TIMEOUT_S`, `SecureMethod`, `ProvenanceLabel`, `secondsRemaining(method, receivedAt, nowMs)`,
  `formatCountdown(s)`, `countdownA11y(s)`, `skillNameOf(params)`, `provenanceFor(skills, name)`,
  `provenanceText(p)`, `SecureEntryCopy`, `secureEntryCopy(card)`; `BiometricOutcome`, `confirmWithBiometrics(promptMessage)`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/app-config.test.ts
import appJson from '../app.json';
import pkg from '../package.json';

test('Face ID usage string comes from the expo-local-authentication config plugin', () => {
  const plugin = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-local-authentication') as
    | [string, { faceIDPermission?: string }]
    | undefined;
  expect(plugin?.[1].faceIDPermission).toMatch(/Face ID/);
  expect(JSON.stringify(appJson.expo.ios.infoPlist)).not.toContain('NSFaceIDUsageDescription');
  expect((pkg.dependencies as Record<string, string>)['expo-local-authentication']).toMatch(/^~56\./);
});
```

`__tests__/skills.test.ts` **already exists on `main`** (list/toggle/summary/filter/sort suites). Do not
overwrite it: append this block at the end of the file, reusing its `fakeFetch`, `client` and `skill` helpers:

```ts

describe('listSkills — profile scope + provenance (secure-entry cards, spec §6.4)', () => {
  it('no profile → unchanged path', async () => {
    const f = fakeFetch(200, []);
    await listSkills(client(f));
    expect(f.calls[0].url).toBe('http://h/api/skills');
  });
  it('profile is passed as an encoded query param', async () => {
    const f = fakeFetch(200, []);
    await listSkills(client(f), 'work & play');
    expect(f.calls[0].url).toBe('http://h/api/skills?profile=work%20%26%20play');
  });
  it('provenance passes through', async () => {
    const f = fakeFetch(200, [skill({ provenance: 'agent' })]);
    expect((await listSkills(client(f), null))[0].provenance).toBe('agent');
  });
});
```

```ts
// __tests__/secure-entry.test.ts
import {
  countdownA11y, formatCountdown, provenanceFor, provenanceText, secondsRemaining, secureEntryCopy, skillNameOf,
} from '../src/lib/secure-entry';
import type { RequestCardState } from '../src/lib/turn-controller';

const card = (method: 'secret' | 'sudo', params: Record<string, unknown>): RequestCardState => ({
  id: 'srq-s', kind: 'secure-entry', method, params: { session_id: 's', ...params }, status: 'pending',
  legacy: false, receivedAt: 0, anchorKey: null,
});

test('timeouts: secret 300 s, sudo 120 s, never negative', () => {
  expect(secondsRemaining('secret', 1_000, 1_000)).toBe(300);
  expect(secondsRemaining('sudo', 1_000, 1_000)).toBe(120);
  expect(secondsRemaining('secret', 0, 60_500)).toBe(240);
  expect(secondsRemaining('sudo', 0, 999_999)).toBe(0);
});
test('countdown text and VoiceOver label', () => {
  expect(formatCountdown(300)).toBe('5:00');
  expect(formatCountdown(61)).toBe('1:01');
  expect(countdownA11y(61)).toBe('1 minute 1 second remaining');
  expect(countdownA11y(120)).toBe('2 minutes remaining');
});
test('skill name and provenance, "unknown" whenever the lookup cannot answer', () => {
  const skills = [{ name: 'weather', description: '', category: '', enabled: true, provenance: 'bundled' as const }];
  expect(skillNameOf({ session_id: 's', env_var: 'K', prompt: 'p', metadata: { skill_name: 'weather' } })).toBe('weather');
  expect(skillNameOf({ session_id: 's', env_var: 'K', prompt: 'p' })).toBeNull();
  expect(provenanceFor(skills, 'weather')).toBe('bundled');
  expect(provenanceFor(skills, 'other')).toBe('unknown');
  expect(provenanceFor(null, 'weather')).toBe('unknown');
  expect(provenanceFor([{ ...skills[0], provenance: undefined }], 'weather')).toBe('unknown');
  expect(provenanceText('hub')).toBe('Skills Hub');
  expect(provenanceText('unknown')).toBe('unknown');
});
test('secret copy: title, ask, warning, destination, no keychain autofill', () => {
  const c = secureEntryCopy(card('secret', { env_var: 'OPENWEATHER_API_KEY', prompt: 'Your API key', metadata: { skill_name: 'weather' } }));
  expect(c).toMatchObject({
    method: 'secret',
    title: 'Value for OPENWEATHER_API_KEY',
    ask: 'Your API key',
    command: null,
    textContentType: 'none',
    warning: "Only continue if you asked for this — the agent can write or edit the skill that's asking.",
    destination: "Saved to the gateway's .env — the agent can read it.",
    skillName: 'weather',
    fieldLabel: 'Value for OPENWEATHER_API_KEY',
  });
});
test('sudo copy: password autofill, command shown, no warning', () => {
  const c = secureEntryCopy(card('sudo', { command: 'apt-get install jq' }));
  expect(c).toMatchObject({ method: 'sudo', title: 'Administrator password', ask: null, command: 'apt-get install jq', textContentType: 'password', warning: null, destination: null, fieldLabel: 'Administrator password' });
});
```

```ts
// __tests__/biometric.test.ts
jest.mock('expo-local-authentication', () => ({ authenticateAsync: jest.fn() }));
import * as LocalAuthentication from 'expo-local-authentication';
import { confirmWithBiometrics } from '../src/lib/biometric';

const auth = LocalAuthentication.authenticateAsync as jest.Mock;

test('passes the reason and keeps the device-passcode fallback', async () => {
  auth.mockResolvedValueOnce({ success: true });
  expect(await confirmWithBiometrics('Send KEY to Hermes')).toEqual({ ok: true });
  expect(auth).toHaveBeenCalledWith({ promptMessage: 'Send KEY to Hermes', cancelLabel: 'Cancel', disableDeviceFallback: false });
});
test.each([
  ['user_cancel', 'cancelled'], ['app_cancel', 'cancelled'], ['system_cancel', 'cancelled'],
  ['passcode_not_set', 'unavailable'], ['not_enrolled', 'unavailable'], ['not_available', 'unavailable'],
  ['authentication_failed', 'failed'], ['lockout', 'failed'], ['unknown', 'failed'],
])('%s → %s', async (error, reason) => {
  auth.mockResolvedValueOnce({ success: false, error });
  expect(await confirmWithBiometrics('x')).toEqual({ ok: false, reason });
});
test('a thrown native error is a failure, never a send', async () => {
  auth.mockRejectedValueOnce(new Error('native'));
  expect(await confirmWithBiometrics('x')).toEqual({ ok: false, reason: 'failed' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/app-config.test.ts __tests__/skills.test.ts __tests__/secure-entry.test.ts __tests__/biometric.test.ts`
Expected: FAIL — no `expo-local-authentication` plugin/dependency, missing `secure-entry`/`biometric` modules, and `listSkills` ignores the profile (the existing skills tests stay green).

- [ ] **Step 3: Install the native dependency (SDK-matched) and add the config plugin**

```bash
npx expo install expo-local-authentication
grep '"expo-local-authentication"' package.json   # expect "~56.0.5"
```

`npx expo install` may itself append a bare `"expo-local-authentication"` string to `expo.plugins`; if it
did, replace that entry (never keep two). In `app.json` `expo.plugins`, after the `"expo-image-picker"` entry, add:

```json
      [
        "expo-local-authentication",
        {
          "faceIDPermission": "Hermes asks for Face ID before sending a password or secret to your gateway."
        }
      ],
```

**This is a native module: the dev client must be rebuilt** before any on-device/simulator use of
Task 10+: `npx expo prebuild -p ios --clean && npx expo run:ios --device "iPhone 17 Pro"` (simulator)
and, for his phone, `npx expo run:ios --device` with the phone selected. Hot reload on an old binary
will crash on `ExpoLocalAuthentication` — rebuild first.

- [ ] **Step 4: Implement**

`src/api/skills.ts` — add to `SkillInfo`:

```ts
  /** Where the gateway says the skill came from — a NAME lookup (review M8): information, not trust. */
  provenance?: 'hub' | 'bundled' | 'agent';
```

and replace `listSkills` with:

```ts
/** All installed skills, disabled ones included (bare JSON array, not wrapped). `profile` scopes the
 *  lookup to that profile (secure-entry cards pass the chat's profile). */
export function listSkills(rest: Rest, profile?: string | null): Promise<SkillInfo[]> {
  return rest.get<SkillInfo[]>(profile ? `/api/skills?profile=${encodeURIComponent(profile)}` : '/api/skills');
}
```

```ts
// src/lib/biometric.ts — Face ID (device-passcode fallback) right before a secure value is sent.
import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricOutcome = { ok: true } | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' };

const CANCELLED = new Set(['user_cancel', 'app_cancel', 'system_cancel']);
const UNAVAILABLE = new Set(['passcode_not_set', 'not_enrolled', 'not_available']);

export async function confirmWithBiometrics(promptMessage: string): Promise<BiometricOutcome> {
  try {
    const res = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: 'Cancel', disableDeviceFallback: false });
    if (res.success) return { ok: true };
    if (CANCELLED.has(res.error)) return { ok: false, reason: 'cancelled' };
    if (UNAVAILABLE.has(res.error)) return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
```

```ts
// src/lib/secure-entry.ts — copy, countdown and provenance for sudo/secret cards (spec §6.4).
// Nothing here ever sees the typed value.
import type { SkillInfo } from '@/api/skills';
import type { RequestCardState } from '@/lib/turn-controller';
import type { SecretRequestParams, SudoRequestParams } from '@/vendor/hermes-gateway';

export const SECURE_ENTRY_TIMEOUT_S = { secret: 300, sudo: 120 } as const;
export type SecureMethod = keyof typeof SECURE_ENTRY_TIMEOUT_S;
export type ProvenanceLabel = NonNullable<SkillInfo['provenance']> | 'unknown';

export function secondsRemaining(method: SecureMethod, receivedAt: number, nowMs: number): number {
  return Math.max(0, Math.ceil(SECURE_ENTRY_TIMEOUT_S[method] - (nowMs - receivedAt) / 1000));
}

export function formatCountdown(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function countdownA11y(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  const parts = [m ? `${m} minute${m === 1 ? '' : 's'}` : '', r ? `${r} second${r === 1 ? '' : 's'}` : ''].filter(Boolean);
  return `${parts.join(' ') || '0 seconds'} remaining`;
}

export function skillNameOf(params: SecretRequestParams): string | null {
  const n = params.metadata?.skill_name;
  return typeof n === 'string' && n.trim() ? n.trim() : null;
}

export function provenanceFor(skills: SkillInfo[] | null, skillName: string | null): ProvenanceLabel {
  if (!skills || !skillName) return 'unknown';
  return skills.find((s) => s.name === skillName)?.provenance ?? 'unknown';
}

export function provenanceText(p: ProvenanceLabel): string {
  return { hub: 'Skills Hub', bundled: 'bundled with Hermes', agent: 'written by the agent', unknown: 'unknown' }[p];
}

export interface SecureEntryCopy {
  method: SecureMethod;
  title: string;
  ask: string | null;
  command: string | null;
  textContentType: 'password' | 'none';
  warning: string | null;
  destination: string | null;
  skillName: string | null;
  fieldLabel: string;
  placeholder: string;
  authReason: string;
}

export function secureEntryCopy(card: RequestCardState): SecureEntryCopy {
  if (card.method === 'sudo') {
    const p = card.params as SudoRequestParams;
    return {
      method: 'sudo', title: 'Administrator password', ask: null, command: p.command || null,
      textContentType: 'password', warning: null, destination: null, skillName: null,
      fieldLabel: 'Administrator password', placeholder: 'Password',
      authReason: 'Send the administrator password to Hermes',
    };
  }
  const p = card.params as SecretRequestParams;
  return {
    method: 'secret',
    title: `Value for ${p.env_var}`,
    ask: p.prompt || null,
    command: null,
    textContentType: 'none', // never offer to save an API key to Passwords (review m14)
    warning: "Only continue if you asked for this — the agent can write or edit the skill that's asking.",
    destination: "Saved to the gateway's .env — the agent can read it.",
    skillName: skillNameOf(p),
    fieldLabel: `Value for ${p.env_var}`,
    placeholder: 'Paste or type the value',
    authReason: `Send ${p.env_var} to Hermes`,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass** — same command as Step 2 → PASS.

- [ ] **Step 6: Full gate + commit**

```bash
npx tsc --noEmit && npx jest
git add package.json package-lock.json app.json src/api/skills.ts src/lib/secure-entry.ts src/lib/biometric.ts __tests__/app-config.test.ts __tests__/skills.test.ts __tests__/secure-entry.test.ts __tests__/biometric.test.ts
git commit -m "feat(secure-entry): provenance lookup, countdown/copy, Face ID via expo-local-authentication

Adds a native module (config plugin faceIDPermission): dev client must be rebuilt.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Secure-entry card and the data-handling guarantees

**Files:**
- Create: `src/components/secure-entry-card.tsx`
- Modify: `src/app/dev-cards.tsx`
- Test: `__tests__/secure-entry-card.test.tsx`, `__tests__/secure-entry-data.test.ts`

**Interfaces:**
- Consumes: Task 9 (`secureEntryCopy`, countdown, `provenanceText`, `ProvenanceLabel`, `confirmWithBiometrics`, `BiometricOutcome`), `CardButton` (Task 8), `cancelLabel` (A);
  for the data test: `GatewayClient` (A), `createRequestRegistry` (A), `FakeSocket` + `gatewayReady`/`serverRequest` fixtures (A §6), `createRequestResponder` (Task 5).
- Produces: `SecureEntryCard({ card, provenance: ProvenanceLabel | null, onSend(value), onSkip(), authenticate?, now?, onInputFocus? })`.

- [ ] **Step 1: Write the failing component test**

```tsx
// __tests__/secure-entry-card.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SecureEntryCard } from '../src/components/secure-entry-card';
import type { BiometricOutcome } from '../src/lib/biometric';
import type { RequestCardState } from '../src/lib/turn-controller';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));
jest.mock('expo-local-authentication', () => ({ authenticateAsync: jest.fn() }));

const SECRET = 'sk-live-DO-NOT-LEAK-4242';
const T0 = 1_700_000_000_000;
const secret = (over: Partial<RequestCardState> = {}): RequestCardState => ({
  id: 'srq-s', kind: 'secure-entry', method: 'secret', status: 'pending', legacy: false, receivedAt: T0, anchorKey: null,
  params: { session_id: 's', env_var: 'OPENWEATHER_API_KEY', prompt: 'Your OpenWeather API key', metadata: { skill_name: 'weather' } },
  ...over,
});
const sudo = (): RequestCardState => ({ ...secret(), method: 'sudo', params: { session_id: 's', command: 'apt-get install jq' } });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let spies: jest.SpyInstance[] = [];
beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  for (const s of spies) {
    expect(JSON.stringify(s.mock.calls)).not.toContain(SECRET); // never logged, on any path
    s.mockRestore();
  }
  jest.useRealTimers();
});

const ok = async (): Promise<BiometricOutcome> => ({ ok: true });
const field = () => screen.getByLabelText('Value for OPENWEATHER_API_KEY');

test('secret card: ask, skill + provenance as information, warning, destination, textContentType none', async () => {
  await render(<SecureEntryCard card={secret()} provenance="agent" onSend={jest.fn()} onSkip={jest.fn()} authenticate={ok} now={() => T0} />);
  expect(screen.getByText('Value for OPENWEATHER_API_KEY')).toBeOnTheScreen();
  expect(screen.getByText('Requested by the agent')).toBeOnTheScreen();
  expect(screen.getByText('Your OpenWeather API key')).toBeOnTheScreen();
  expect(screen.getByText('Skill: weather · source: written by the agent')).toBeOnTheScreen();
  expect(screen.getByText("Only continue if you asked for this — the agent can write or edit the skill that's asking.")).toBeOnTheScreen();
  expect(screen.getByText("Saved to the gateway's .env — the agent can read it.")).toBeOnTheScreen();
  expect(field().props).toMatchObject({ secureTextEntry: true, autoCorrect: false, autoCapitalize: 'none', spellCheck: false, textContentType: 'none' });
});

test('provenance: failed lookup shows unknown; loading shows checking…', async () => {
  const { rerender } = await render(<SecureEntryCard card={secret()} provenance={null} onSend={jest.fn()} onSkip={jest.fn()} now={() => T0} />);
  expect(screen.getByText('Skill: weather · source: checking…')).toBeOnTheScreen();
  await rerender(<SecureEntryCard card={secret()} provenance="unknown" onSend={jest.fn()} onSkip={jest.fn()} now={() => T0} />);
  expect(screen.getByText('Skill: weather · source: unknown')).toBeOnTheScreen();
});

test('sudo card: title, command, password autofill, no warning', async () => {
  await render(<SecureEntryCard card={sudo()} provenance={null} onSend={jest.fn()} onSkip={jest.fn()} now={() => T0} />);
  expect(screen.getByText('apt-get install jq')).toBeOnTheScreen();
  expect(screen.getByLabelText('Administrator password').props.textContentType).toBe('password');
  expect(screen.queryByText(/Only continue if you asked/)).toBeNull();
  expect(screen.getByText('2:00')).toBeOnTheScreen();
});

test('Face ID success: sends the value once, then the field is gone and the card never shows it', async () => {
  const onSend = jest.fn();
  const { rerender } = await render(<SecureEntryCard card={secret()} provenance="hub" onSend={onSend} onSkip={jest.fn()} authenticate={ok} now={() => T0} />);
  await fireEvent.changeText(field(), SECRET);
  await fireEvent.press(screen.getByRole('button', { name: 'Send with Face ID' }));
  expect(onSend).toHaveBeenCalledWith(SECRET);
  await rerender(<SecureEntryCard card={secret({ status: 'answered' })} provenance="hub" onSend={onSend} onSkip={jest.fn()} authenticate={ok} now={() => T0} />);
  expect(screen.getByText('Sent')).toBeOnTheScreen();
  expect(screen.queryByDisplayValue(SECRET)).toBeNull();
  expect(screen.queryByText(new RegExp(`${SECRET.length}`))).toBeNull(); // no length shown either
});

test('Face ID failure sends nothing and keeps the card open', async () => {
  const onSend = jest.fn();
  await render(<SecureEntryCard card={secret()} provenance="hub" onSend={onSend} onSkip={jest.fn()} authenticate={async () => ({ ok: false, reason: 'failed' })} now={() => T0} />);
  await fireEvent.changeText(field(), SECRET);
  await fireEvent.press(screen.getByRole('button', { name: 'Send with Face ID' }));
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.getByText("Face ID didn't match. Nothing was sent.")).toBeOnTheScreen();
  expect(field()).toBeOnTheScreen();
});

test('app backgrounded during the prompt (app_cancel): nothing sent, value kept to retry (Review Focus 1)', async () => {
  const onSend = jest.fn();
  await render(<SecureEntryCard card={secret()} provenance="hub" onSend={onSend} onSkip={jest.fn()} authenticate={async () => ({ ok: false, reason: 'cancelled' })} now={() => T0} />);
  await fireEvent.changeText(field(), SECRET);
  await fireEvent.press(screen.getByRole('button', { name: 'Send with Face ID' }));
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.getByText('Cancelled. Nothing was sent.')).toBeOnTheScreen();
  expect(field().props.value).toBe(SECRET);
});

test('card closed (request.cancel) while the Face ID prompt is up: nothing sent (Review Focus 1)', async () => {
  const onSend = jest.fn();
  const d = deferred<BiometricOutcome>();
  const el = (c: RequestCardState) => <SecureEntryCard card={c} provenance="hub" onSend={onSend} onSkip={jest.fn()} authenticate={() => d.promise} now={() => T0} />;
  const { rerender } = await render(el(secret()));
  await fireEvent.changeText(field(), SECRET);
  await fireEvent.press(screen.getByRole('button', { name: 'Send with Face ID' }));
  await rerender(el(secret({ status: 'cancelled', cancelReason: 'resolved' })));
  await act(async () => d.resolve({ ok: true }));
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.getByText('Answered elsewhere')).toBeOnTheScreen();
});

test('unmounted while the Face ID prompt is up: nothing sent (Review Focus 1)', async () => {
  const onSend = jest.fn();
  const d = deferred<BiometricOutcome>();
  const { unmount } = await render(<SecureEntryCard card={secret()} provenance="hub" onSend={onSend} onSkip={jest.fn()} authenticate={() => d.promise} now={() => T0} />);
  await fireEvent.changeText(field(), SECRET);
  await fireEvent.press(screen.getByRole('button', { name: 'Send with Face ID' }));
  await unmount();
  await act(async () => d.resolve({ ok: true }));
  expect(onSend).not.toHaveBeenCalled();
});

test('Skip responds without a value and clears the field', async () => {
  const onSkip = jest.fn();
  const onSend = jest.fn();
  await render(<SecureEntryCard card={secret()} provenance="hub" onSend={onSend} onSkip={onSkip} authenticate={ok} now={() => T0} />);
  await fireEvent.changeText(field(), SECRET);
  await fireEvent.press(screen.getByRole('button', { name: "Skip, don't send a value" }));
  expect(onSkip).toHaveBeenCalledTimes(1);
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue(SECRET)).toBeNull();
});

test.each([
  ['interrupted', 'Stopped'],
  ['resolved', 'Answered elsewhere'],
  ['session_closed', 'Closed'],
] as const)('cancel (%s) clears the value: a re-delivered card starts empty', async (reason, label) => {
  const el = (c: RequestCardState) => <SecureEntryCard card={c} provenance="hub" onSend={jest.fn()} onSkip={jest.fn()} authenticate={ok} now={() => T0} />;
  const { rerender } = await render(el(secret()));
  await fireEvent.changeText(field(), SECRET);
  await rerender(el(secret({ status: 'cancelled', cancelReason: reason })));
  expect(screen.getByText(label)).toBeOnTheScreen();
  await rerender(el(secret()));
  expect(field().props.value).toBe('');
});

test('countdown ticks and the card times out locally (value cleared)', async () => {
  jest.useFakeTimers({ now: T0 });
  await render(<SecureEntryCard card={secret()} provenance="hub" onSend={jest.fn()} onSkip={jest.fn()} authenticate={ok} />);
  expect(screen.getByText('5:00')).toBeOnTheScreen();
  await fireEvent.changeText(field(), SECRET);
  await act(async () => jest.advanceTimersByTime(60_000));
  expect(screen.getByText('4:00')).toBeOnTheScreen();
  await act(async () => jest.advanceTimersByTime(240_000));
  expect(screen.getByText('Timed out')).toBeOnTheScreen();
  expect(screen.queryByDisplayValue(SECRET)).toBeNull();
});

test('focusing the field asks the screen to scroll the card into view (Review Focus 5)', async () => {
  const onInputFocus = jest.fn();
  await render(<SecureEntryCard card={secret()} provenance="hub" onSend={jest.fn()} onSkip={jest.fn()} onInputFocus={onInputFocus} now={() => T0} />);
  await fireEvent(field(), 'focus');
  expect(onInputFocus).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Write the failing data-path test**

```ts
// __tests__/secure-entry-data.test.ts
// Spec §6.4 data-handling rules, end to end through A's adapter: the value leaves only in the
// response frame — never in dispatched actions, the turn model, or any console.* call (even in __DEV__).
import { GatewayClient } from '../src/api/gatewayClient';
import {
  FakeSocket,
  installFakeWebSocketGlobal,
  restoreWebSocketGlobal,
} from '../src/api/__tests__/fixtures/fake-socket';
import { gatewayReady, serverRequest } from '../src/api/__tests__/fixtures/frames';
import { createRequestResponder } from '../src/lib/request-answers';
import { createRequestRegistry } from '../src/lib/request-registry';
import { initialTurnModel, reduceTurn, type RequestCardState, type TurnAction } from '../src/lib/turn-controller';

// Required by A's fixture contract: the vendored client reads the GLOBAL `WebSocket.OPEN`.
beforeAll(installFakeWebSocketGlobal);
afterAll(restoreWebSocketGlobal);

const SECRET = 'hunter2-DO-NOT-LEAK';

test.each([
  ['secret', { env_var: 'K', prompt: 'p', metadata: { skill_name: 'weather' } }],
  ['sudo', { command: 'apt-get install jq' }],
] as const)('%s value travels only in the response frame', async (method, extra) => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
  expect(__DEV__).toBe(true);
  const sock = new FakeSocket();
  const client = new GatewayClient({ socketFactory: () => sock as unknown as WebSocket });
  const registry = createRequestRegistry();
  client.onRequest((req) => {
    registry.put(req);
    return true;
  });
  const connected = client.connect('ws://gw.test/api/ws?ticket=t1');
  sock.open();
  sock.serverSend(gatewayReady({ replay_epoch: 'e1' }));
  await connected;
  const params = { session_id: 'live-1', ...extra };
  sock.serverSend(serverRequest('srq-v1', method, params));

  const actions: TurnAction[] = [];
  const responder = createRequestResponder({
    registry,
    call: client.call.bind(client),
    dispatch: (a) => actions.push(a),
    liveSessionId: () => 'live-1',
  });
  const fresh: Omit<RequestCardState, 'status'> = { id: 'srq-v1', kind: 'secure-entry', method, params, legacy: false, receivedAt: 0, anchorKey: null };
  expect(responder.value({ ...fresh, status: 'pending' }, SECRET)).toEqual({ ok: true });

  expect(sock.sent).toContainEqual(expect.objectContaining({ id: 'srq-v1', result: { value: SECRET } }));
  expect(JSON.stringify(actions)).not.toContain(SECRET);
  const model = actions.reduce(reduceTurn, reduceTurn(initialTurnModel(), { type: 'request.received', card: fresh }));
  expect(JSON.stringify(model)).not.toContain(SECRET);
  for (const s of spies) {
    expect(JSON.stringify(s.mock.calls)).not.toContain(SECRET);
    s.mockRestore();
  }
  client.close();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest __tests__/secure-entry-card.test.tsx __tests__/secure-entry-data.test.ts`
Expected: FAIL — `secure-entry-card` module missing. (`secure-entry-data` may already PASS if A's
adapter never logs; that is the contract check for A. If it FAILS on a console assertion, A's adapter
logs outbound frames — fix it in `src/api/gatewayClient.ts` by removing that log for `sudo`/`secret`
responses, per spec §6.4, and note it in the PR.)

- [ ] **Step 4: Implement the card**

```tsx
// src/components/secure-entry-card.tsx — sudo / secret prompt (spec §6.4).
//
// DATA RULE: the typed value exists only in SecureEntryForm's local state. The form is rendered only
// while the card is open, so every exit path (send, skip, request.cancel, interrupt, local timeout,
// unmount) unmounts it and the value is gone. It is never lifted, logged, or put in the turn controller.
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { CardButton } from '@/components/card-button';
import { Icon } from '@/components/icon';
import { confirmWithBiometrics, type BiometricOutcome } from '@/lib/biometric';
import {
  countdownA11y, formatCountdown, provenanceText, secondsRemaining, secureEntryCopy,
  type ProvenanceLabel, type SecureEntryCopy,
} from '@/lib/secure-entry';
import { cancelLabel, type RequestCardState } from '@/lib/turn-controller';
import { useTheme } from '@/theme';

export interface SecureEntryCardProps {
  card: RequestCardState;
  /** Secret cards: provenance of `metadata.skill_name`; null while the lookup runs. */
  provenance: ProvenanceLabel | null;
  onSend: (value: string) => void;
  onSkip: () => void;
  authenticate?: (reason: string) => Promise<BiometricOutcome>;
  now?: () => number;
  onInputFocus?: () => void;
}

const AUTH_NOTES = {
  cancelled: 'Cancelled. Nothing was sent.',
  unavailable: 'Set up Face ID or a device passcode to send this.',
  failed: "Face ID didn't match. Nothing was sent.",
} as const;

function SecureEntryForm({
  copy,
  authenticate,
  onSend,
  onSkip,
  onInputFocus,
}: {
  copy: SecureEntryCopy;
  authenticate: (reason: string) => Promise<BiometricOutcome>;
  onSend: (value: string) => void;
  onSkip: () => void;
  onInputFocus?: () => void;
}) {
  const { colors } = useTheme();
  const [value, setValue] = useState('');
  const [authing, setAuthing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function send() {
    if (!value || authing) return;
    setAuthing(true);
    setNote(null);
    const outcome = await authenticate(copy.authReason);
    if (!mounted.current) return; // card closed during the prompt: send nothing
    setAuthing(false);
    if (!outcome.ok) {
      setNote(AUTH_NOTES[outcome.reason]);
      return;
    }
    const toSend = value;
    setValue('');
    onSend(toSend);
  }

  function skip() {
    setValue('');
    onSkip();
  }

  return (
    <View style={{ gap: 10 }}>
      <TextInput
        value={value}
        onChangeText={setValue}
        onFocus={onInputFocus}
        editable={!authing}
        secureTextEntry
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        textContentType={copy.textContentType}
        autoComplete={copy.textContentType === 'password' ? 'current-password' : 'off'}
        placeholder={copy.placeholder}
        placeholderTextColor={colors.placeholder}
        accessibilityLabel={copy.fieldLabel}
        style={{
          color: colors.text, backgroundColor: colors.surface, borderRadius: 10, borderCurve: 'continuous',
          borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 44, fontSize: 16,
        }}
      />
      {note ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontSize: 13 }}>
          {note}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <CardButton label="Skip" a11y="Skip, don't send a value" onPress={skip} disabled={authing} flex />
        <CardButton
          label={authing ? 'Checking…' : 'Send with Face ID'}
          a11y="Send with Face ID"
          onPress={() => void send()}
          disabled={!value || authing}
          primary
          flex
        />
      </View>
    </View>
  );
}

export function SecureEntryCard({
  card,
  provenance,
  onSend,
  onSkip,
  authenticate = confirmWithBiometrics,
  now = Date.now,
  onInputFocus,
}: SecureEntryCardProps) {
  const { colors } = useTheme();
  const copy = secureEntryCopy(card);
  const [nowMs, setNowMs] = useState(() => now());
  const pending = card.status === 'pending';
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNowMs(now()), 1000);
    return () => clearInterval(t);
  }, [pending, now]);
  const remaining = secondsRemaining(copy.method, card.receivedAt, nowMs);
  const open = pending && remaining > 0;

  const settled =
    card.status === 'answered'
      ? { label: 'Sent', icon: 'checkmark.circle.fill', tint: colors.success }
      : card.status === 'skipped'
        ? { label: 'Skipped', icon: 'slash.circle', tint: colors.textFaint }
        : card.status === 'cancelled'
          ? { label: card.cancelReason ? cancelLabel(card.cancelReason) : 'Closed', icon: 'slash.circle', tint: colors.textFaint }
          : { label: 'Timed out', icon: 'slash.circle', tint: colors.textFaint };

  return (
    <View
      accessibilityLabel={copy.method === 'sudo' ? 'Administrator password request' : `Secret request: ${copy.title}`}
      style={{
        backgroundColor: colors.raised, borderRadius: 16, borderCurve: 'continuous', borderWidth: 1,
        borderColor: open ? colors.accent : colors.border, padding: 14, gap: 10, marginVertical: 6, alignSelf: 'stretch',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon sf="lock.fill" size={14} color={open ? colors.accent : colors.textFaint} />
        <Text numberOfLines={2} style={{ color: colors.text, fontSize: 14.5, fontWeight: '700', flexShrink: 1 }}>
          {copy.title}
        </Text>
        <View style={{ flex: 1 }} />
        {open ? (
          <View accessible accessibilityLabel={countdownA11y(remaining)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon sf="hourglass" size={12} color={remaining <= 30 ? colors.danger : colors.textFaint} />
            <Text style={{ color: remaining <= 30 ? colors.danger : colors.textFaint, fontSize: 12.5, fontVariant: ['tabular-nums'] }}>
              {formatCountdown(remaining)}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.textFaint, fontSize: 12, fontWeight: '600' }}>Requested by the agent</Text>
        {copy.ask ? <Text selectable style={{ color: colors.text, fontSize: 14.5, lineHeight: 20 }}>{copy.ask}</Text> : null}
        {copy.command ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: 10, borderCurve: 'continuous', padding: 10 }}>
            <Text selectable style={{ color: colors.text, fontFamily: 'Menlo', fontSize: 12.5, lineHeight: 18 }}>{copy.command}</Text>
          </View>
        ) : null}
      </View>

      {copy.method === 'secret' ? (
        <Text style={{ color: colors.textDim, fontSize: 13 }}>
          {`Skill: ${copy.skillName ?? 'unknown'} · source: ${provenance === null ? 'checking…' : provenanceText(provenance)}`}
        </Text>
      ) : null}

      {copy.warning ? (
        <View
          style={{
            flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, borderCurve: 'continuous',
            borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface,
          }}
        >
          <Icon sf="exclamationmark.shield.fill" size={14} color={colors.danger} />
          <Text style={{ color: colors.text, fontSize: 13.5, lineHeight: 19, flexShrink: 1 }}>{copy.warning}</Text>
        </View>
      ) : null}
      {copy.destination ? <Text style={{ color: colors.textDim, fontSize: 12.5 }}>{copy.destination}</Text> : null}

      {open ? (
        <SecureEntryForm copy={copy} authenticate={authenticate} onSend={onSend} onSkip={onSkip} onInputFocus={onInputFocus} />
      ) : (
        <View accessibilityLabel={settled.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon sf={settled.icon} size={14} color={settled.tint} />
          <Text style={{ color: settled.tint, fontSize: 13.5, fontWeight: '600' }}>{settled.label}</Text>
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 5: Gallery section** — in `src/app/dev-cards.tsx` add `import { SecureEntryCard } from '@/components/secure-entry-card';`
and before `{/* dev-cards:end */}` (these use the real Face ID wrapper only on press; the gallery never sends anything):

```tsx
      <Section title="Secure entry">
        <SecureEntryCard
          card={devCard({ id: 's1', kind: 'secure-entry', method: 'secret', params: { session_id: 's', env_var: 'OPENWEATHER_API_KEY', prompt: 'Your OpenWeather API key (free tier is fine)', metadata: { skill_name: 'weather' } } })}
          provenance="agent"
          onSend={() => {}}
          onSkip={() => {}}
        />
        <SecureEntryCard card={devCard({ id: 's2', kind: 'secure-entry', method: 'sudo', params: { session_id: 's', command: 'apt-get install -y jq' } })} provenance={null} onSend={() => {}} onSkip={() => {}} />
        <SecureEntryCard card={devCard({ id: 's3', kind: 'secure-entry', method: 'secret', params: { session_id: 's', env_var: 'K', prompt: 'p' }, status: 'answered' })} provenance="unknown" onSend={() => {}} onSkip={() => {}} />
      </Section>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/secure-entry-card.test.tsx __tests__/secure-entry-data.test.ts`
Expected: PASS.

- [ ] **Step 7: Screenshots** — rebuild the dev client first (Task 9 native dep:
`npx expo prebuild -p ios --clean && npx expo run:ios --device "iPhone 17 Pro"`), then Screenshot
procedure with `NAME=secure-entry`. Enable Simulator ▸ Features ▸ Face ID ▸ Enrolled, type into the
secret field, press Send, choose Features ▸ Face ID ▸ Non-matching Face, capture
`secure-entry-faceid-fail-dark.png`. Check: warning box readable (danger border on `surface`) in light,
countdown turns danger under 30 s, iOS offers **no** "Save Password" after Skip (secret) — screenshot if it does and stop.

- [ ] **Step 8: Full gate + commit**

```bash
npx tsc --noEmit && npx jest
git add src/components/secure-entry-card.tsx src/app/dev-cards.tsx __tests__/secure-entry-card.test.tsx __tests__/secure-entry-data.test.ts docs/screenshots/turn-control/secure-entry-*.png
git commit -m "feat(secure-entry): sudo/secret card behind Face ID; value never leaves the form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Cards in the transcript — merge, vault note, chat-screen wiring

**Files:**
- Create: `src/lib/transcript-rows.ts`, `src/components/vault-declined-note.tsx`
- Modify: `src/app/chat/[id].tsx`, `src/app/dev-cards.tsx`
- Test: `__tests__/transcript-rows.test.ts`, `__tests__/vault-declined-note.test.tsx`

**Interfaces:**
- Consumes: everything above; A's `mergeRequestRows`/`TranscriptRow` (`src/lib/turn-controller.ts`), and in
  `[id].tsx` A's `turn.requests`, `registryRef`, `dispatchTurn`, `reversedRows`, `type Row`, `renderRequest`,
  `respondApproval`, `VAULT_NOTE`/`UNSUPPORTED_NOTE`, plus Task 4's `callGw`.
- Produces: `rowIndexOf(rowsNewestFirst, cardId)` (over A's `TranscriptRow<T>`); `VaultDeclinedNote()`,
  `VAULT_DECLINED_TEXT`. **No second merge function**: A's `mergeRequestRows` is the one transcript merge
  (it also defines the orphan rule — open cards whose anchor vanished in a history replace move to the end;
  settled orphans are not re-rendered).

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/transcript-rows.test.ts
import type { ChatItem } from '../src/components/message-row';
import { rowIndexOf } from '../src/lib/transcript-rows';
import { mergeRequestRows, type RequestCardState } from '../src/lib/turn-controller';

const item = (key: string): ChatItem => ({ key, role: 'assistant', text: key, complete: true });
const req = (id: string, anchorKey: string | null): RequestCardState => ({
  id, kind: 'approval', method: 'approval', params: {}, status: 'pending', legacy: false, receivedAt: 0, anchorKey,
});

test('rowIndexOf finds a card in the newest-first (inverted list) order', () => {
  const rows = mergeRequestRows([item('i0'), item('i1')], [req('a', 'i0')]).reverse();
  expect(rowIndexOf(rows, 'a')).toBe(1);
  expect(rowIndexOf(rows, 'zz')).toBe(-1);
});

test('an open card orphaned by a history replace is still findable (it sits at the newest end)', () => {
  const rows = mergeRequestRows([item('h0'), item('h1')], [req('a', 'gone')]).reverse();
  expect(rowIndexOf(rows, 'a')).toBe(0);
});
```

```tsx
// __tests__/vault-declined-note.test.tsx
import { render, screen } from '@testing-library/react-native';
import { VAULT_DECLINED_TEXT, VaultDeclinedNote } from '../src/components/vault-declined-note';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));

test('the vault note says it was declined on the phone (review m12)', async () => {
  expect(VAULT_DECLINED_TEXT).toBe('Hermes asked for a password-manager action — declined on the phone.');
  await render(<VaultDeclinedNote />);
  expect(screen.getByText(VAULT_DECLINED_TEXT)).toBeOnTheScreen();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/transcript-rows.test.ts __tests__/vault-declined-note.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

```ts
// src/lib/transcript-rows.ts — helpers over A's merged transcript rows. The merge itself is A's
// `mergeRequestRows` (src/lib/turn-controller.ts): cards live outside `items` (spec §6.0, review B1.3).
import type { TranscriptRow } from '@/lib/turn-controller';

/** Index of a request card in the newest-first rows the inverted FlatList renders, or -1. */
export function rowIndexOf<T>(rowsNewestFirst: TranscriptRow<T>[], cardId: string): number {
  return rowsNewestFirst.findIndex((r) => r.kind === 'request' && r.card.id === cardId);
}
```

```tsx
// src/components/vault-declined-note.tsx — vault.* requests are answered -32601 by A's routing (spec §6.3).
import { Text, View } from 'react-native';
import { Icon } from '@/components/icon';
import { useTheme } from '@/theme';

export const VAULT_DECLINED_TEXT = 'Hermes asked for a password-manager action — declined on the phone.';

export function VaultDeclinedNote() {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={VAULT_DECLINED_TEXT} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
      <Icon sf="key" size={12} color={colors.textFaint} />
      <Text style={{ color: colors.textFaint, fontSize: 12.5, flexShrink: 1 }}>{VAULT_DECLINED_TEXT}</Text>
    </View>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass** — same command → PASS.

- [ ] **Step 5: Wire cards into `src/app/chat/[id].tsx`** (verify A's names first — header table)

Imports (merge into A's existing statements; `ApprovalCard` and `isApprovalActionable` are already
imported since Task 7, `RequestCardState` since A):

```ts
import { listSkills, type SkillInfo } from '@/api/skills';
import { ClarifyCard } from '@/components/clarify-card';
import { SecureEntryCard } from '@/components/secure-entry-card';
import { VaultDeclinedNote } from '@/components/vault-declined-note';
import { createRequestResponder } from '@/lib/request-answers';
import { provenanceFor, skillNameOf } from '@/lib/secure-entry';
import { rowIndexOf } from '@/lib/transcript-rows';
```

and add `SecretRequestParams` to A's `import type { GatewayEvent, GatewayEventMap, RpcMethods } from '@/vendor/hermes-gateway';`.

Delete A's interim pieces this task supersedes:
- the whole `async function respondApproval(card: RequestCardState, choice: ApprovalChoice) { … }` (A's R7,
  from its `/** Answer an approval card. 0.21.5: …` doc comment through its closing `}`), and then the
  `import { resolvedCount, type ApprovalChoice } from '@/lib/approval';` line (now unused);
- A's `VAULT_NOTE` and `UNSUPPORTED_NOTE` constants and their `/** Copy for request cards this build cannot
  answer yet … */` comment (A's R2; keep `type Row = TranscriptRow<ChatItem>;`);
- `cancelLabel` from the `@/lib/turn-controller` import if `tsc`/eslint reports it unused.

Inside `ChatScreen`, next to `commands` (Task 4):

```ts
  const listRef = useRef<FlatList<Row>>(null);
  const [responder] = useState(() =>
    createRequestResponder({
      // A's registry is null only before mount / after unmount → "no longer open".
      registry: { respond: (id, result) => registryRef.current?.respond(id, result) ?? false },
      call: callGw,
      dispatch: (a) => dispatchTurn(a),
      liveSessionId: () => liveIdRef.current,
    }),
  );

  // Provenance for pending secret cards: one lookup per new card set, scoped to this chat's profile.
  // Failure → "unknown" (spec §6.4). Keyed by card ids so a just-created skill is found.
  const pendingSecretIds = turn.requests
    .filter((r) => r.method === 'secret' && r.status === 'pending')
    .map((r) => r.id)
    .join(',');
  const [skills, setSkills] = useState<{ key: string; list: SkillInfo[] | null } | null>(null);
  useEffect(() => {
    if (!pendingSecretIds) return;
    let stale = false;
    withAuthRetry((r) => listSkills(r, profileRef.current))
      .then((list) => !stale && setSkills({ key: pendingSecretIds, list }))
      .catch(() => !stale && setSkills({ key: pendingSecretIds, list: null }));
    return () => {
      stale = true;
    };
  }, [pendingSecretIds]);

  function provenanceOf(card: RequestCardState) {
    if (!skills || skills.key !== pendingSecretIds) return null; // still looking up
    return provenanceFor(skills.list, skillNameOf(card.params as SecretRequestParams));
  }

  function scrollCardIntoView(cardId: string) {
    // Wait for the keyboard inset (containerStyle paddingBottom) to apply, then bring the card up.
    // A's `reversedRows` is the newest-first data the inverted FlatList renders.
    setTimeout(() => {
      const index = rowIndexOf(reversedRows, cardId);
      if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
    }, 300);
  }
```

Replace A's whole `renderRequest` function (after Task 7 it runs from `function renderRequest(card: RequestCardState) {`
through `return <MessageRow item={{ key: \`req:${card.id}\`, role: 'status', text }} />;` and its closing `}`)
with the version below. It keeps the name `renderRequest`, so A's `FlatList` `renderItem`
(`row.kind === 'request' ? renderRequest(row.card) : …`) stays as is. (`scrollCardIntoView` reads A's
`reversedRows` only when it runs, after render, so the block above can sit next to `commands`; keep its
`useState`/`useEffect` calls unconditional, above any early return.)

```tsx
  function renderRequest(card: RequestCardState) {
    const focus = () => scrollCardIntoView(card.id);
    switch (card.kind) {
      case 'approval':
        return (
          <ApprovalCard
            card={card}
            actionable={isApprovalActionable(turn.requests, card.id)}
            onRespond={(choice) =>
              void responder.approve(card, choice).then((out) => {
                if (!out.ok) setError(out.message);
              })
            }
          />
        );
      case 'clarify':
        return <ClarifyCard card={card} responder={responder} onInputFocus={focus} />;
      case 'secure-entry':
        return (
          <SecureEntryCard
            card={card}
            provenance={card.method === 'secret' ? provenanceOf(card) : null}
            onSend={(v) => {
              const out = responder.value(card, v);
              if (!out.ok) setError(out.message);
            }}
            onSkip={() => {
              const out = responder.value(card, '');
              if (!out.ok) setError(out.message);
            }}
            onInputFocus={focus}
          />
        );
      case 'vault-declined':
        return <VaultDeclinedNote />;
    }
  }
```

In A's `<FlatList`, keep every prop (A's `data={reversedRows}`, `keyExtractor`, `renderItem`, …) and
add two, replacing

```tsx
        <FlatList
          data={reversedRows}
          inverted
```

with

```tsx
        <FlatList
          ref={listRef}
          data={reversedRows}
          inverted
          onScrollToIndexFailed={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
```

(A already merged the rows, deleted `reversedItems`, and made `showGreeting` include
`turn.requests.length === 0` — nothing to do there.) Check:
`grep -n -E "mergeTranscript|respondApproval|VAULT_NOTE|UNSUPPORTED_NOTE|approvalInfo" 'src/app/chat/[id].tsx'; echo "exit=$?"` prints only `exit=1`.

- [ ] **Step 6: Gallery** — in `src/app/dev-cards.tsx` add `import { VaultDeclinedNote } from '@/components/vault-declined-note';` and before `{/* dev-cards:end */}`:

```tsx
      <Section title="Vault">
        <VaultDeclinedNote />
      </Section>
```

- [ ] **Step 7: Full gate**

Run: `npx tsc --noEmit && npx jest`
Expected: exit 0.

- [ ] **Step 8: Simulator pass against a real gateway (both themes)**

With the throwaway 0.21.5 container tunnelled (`ssh -L 19119:127.0.0.1:19119 root@dc1-1.local`, spec §10.2)
and the app connected to `http://127.0.0.1:19119`, in dark then light (`xcrun simctl ui booted appearance …`):
1. Ask for a clarify batch ("Before you start, ask me 3 clarifying questions with the clarify tool,
   one multi-select"). Tap the first question's "Other…" field: the keyboard must not cover it — the card
   scrolls up. If the card lands under the floating header instead, change `viewPosition: 0` to
   `viewPosition: 1` in `scrollCardIntoView`, re-check, and note which one is right for the inverted list.
   Capture `chat-clarify-keyboard-{dark,light}.png`.
2. Confirm one question, then kill Wi-Fi for 5 s (Simulator ▸ I/O ▸ … or `sudo ifconfig en0 down/up`
   on the Mac) → after reconnect the card is still there with that question locked; Submit all → answered.
2b. Reconnect mid-turn on 0.21.5 (spec §10.2; A's smoke only covered 0.20.4, which has no replay): start
   a long streamed answer, drop Wi-Fi for 5 s mid-stream → after reconnect the composer shows Stop (not
   idle), no paragraph is duplicated, the text streamed *during* the drop appears (replay), and the turn
   finishes with one success haptic. Also record whether the text streamed *before* the drop is still
   there: with A's watermark (= highest seq seen) plus the history replace, it is expected to be **lost**
   until the open finding "replay watermark vs history replace" (Plan A, Revision log item 3) is decided —
   do not patch it ad hoc in B; record the result in the PR. Capture `chat-replay-{dark,light}.png`.
3. "Run `rm -rf /tmp/hermes-b-test`" → approval card → Approve. Capture `chat-approval-{dark,light}.png`.
4. A long answer → Stop mid-stream → "Stopping…" then "Stopped", no success haptic. Capture `chat-stopped-{dark,light}.png`.
5. During a long tool run, type "also print the date" → steer → "Steered" bubble. Capture `chat-steered-{dark,light}.png`.
6. A throwaway skill declaring `required_environment_variables: [HERMES_B_TEST]` → secret card with
   warning + provenance "written by the agent" → Face ID (Simulator ▸ Features ▸ Face ID ▸ Matching Face)
   → "Sent". Capture `chat-secret-{dark,light}.png`.
Save under `docs/screenshots/turn-control/`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/transcript-rows.ts src/components/vault-declined-note.tsx 'src/app/chat/[id].tsx' src/app/dev-cards.tsx __tests__/transcript-rows.test.ts __tests__/vault-declined-note.test.tsx docs/screenshots/turn-control/chat-*.png
git commit -m "feat(chat): render request cards in the transcript; responder, provenance, focus scroll

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Clarify push — suppress the banner in the foreground, tap opens the session

The plugin (Plan P, spec §6.5 / §9.1) sends a device-targeted push with `data.type = "clarify_request"`
and `data.session_id` (the stored id) when the agent calls `clarify`.

**Files:**
- Modify: `src/lib/push.ts`
- Test: `__tests__/push.test.ts` (extend)

**Interfaces:**
- Consumes: `SUPPRESSIBLE_PUSH_TYPES`, `shouldSuppressForeground`, `routeForPushData` (existing).
- Produces: `SUPPRESSIBLE_PUSH_TYPES = ['session_end', 'approval_request', 'clarify_request']`.

- [ ] **Step 1: Write the failing test** — append inside `describe('shouldSuppressForeground', …)`:

```ts
  it('suppresses the clarify push while the app is active, shows it otherwise', () => {
    expect(shouldSuppressForeground({ type: 'clarify_request', session_id: 'S-1' }, 'active')).toBe(true);
    expect(shouldSuppressForeground({ type: 'clarify_request', session_id: 'S-1' }, 'background')).toBe(false);
    expect(shouldSuppressForeground({ type: 'clarify_request', session_id: 'S-1' }, 'inactive')).toBe(false);
  });
```

and inside `describe('routeForPushData', …)` (characterization: routing is type-agnostic and already
covers this; the test pins it so a future per-type router can't drop clarify):

```ts
  it('a clarify push tap opens its session (resume then re-delivers the card, spec §7)', () => {
    expect(routeForPushData({ type: 'clarify_request', session_id: 'S-9' })).toBe('/chat/S-9');
    expect(routeForPushData({ type: 'clarify_request' })).toBe('/chat/new');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/push.test.ts -t clarify`
Expected: FAIL on `shouldSuppressForeground(… 'active')` (returns false); the routing test PASSES already.

- [ ] **Step 3: Implement** — in `src/lib/push.ts`:

```ts
export const SUPPRESSIBLE_PUSH_TYPES = ['session_end', 'approval_request', 'clarify_request'] as const;
```

and change the doc comment above `shouldSuppressForeground` to
`/** Suppress the banner for our session pings (stop, approval, clarify) while the app is the`
`  * active (foreground) app — the open chat shows the card itself. Anything else shows. */`.

- [ ] **Step 4: Run test to verify it passes** — `npx jest __tests__/push.test.ts` → PASS.

- [ ] **Step 5: Full gate + commit**

```bash
npx tsc --noEmit && npx jest
git add src/lib/push.ts __tests__/push.test.ts
git commit -m "feat(push): suppress the clarify_request banner in the foreground; pin tap routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

On-device (his QA, spec §10.3): background the app, have the agent call clarify, tap the push → the
chat opens and the card is there (resume re-delivers it via `open_requests`).

---

## Branch verification and PR (after Task 12)

- [ ] **Setup (do this before Task 1; referenced from "Base" at the top):**

```bash
cd ~/Developer/hermes-mobile-app && git fetch origin
test -f src/vendor/hermes-gateway/index.ts && test -f src/lib/request-registry.ts \
  && test -f src/lib/reconnect-orchestrator.ts && test -f src/api/__tests__/fixtures/fake-socket.ts \
  && test -f src/api/stale-session.ts && test -f src/api/chat-transport.ts && test -f src/lib/turn-store.ts \
  || { echo "Plan A is not merged on origin/main — stop"; exit 1; }
git worktree add .claude/worktrees/turn-control-cards -b feat/turn-control-cards origin/main
cd .claude/worktrees/turn-control-cards && npm ci && npx tsc --noEmit && npx jest
```

- [ ] **Legacy 0.20.4 check (live dc1-1, before the bump):** connect the simulator build to the live
  gateway; a dangerous command → legacy approval card (FIFO hint on a second one) → Approve; Stop mid-turn
  → "Stopped"; steer mid-turn is best-effort (a "Steered" bubble may later vanish after a rehydrate — accepted, spec §5.3).
- [ ] **Final gate:** `npx tsc --noEmit; echo "tsc=$?"; npx jest; echo "jest=$?"` — both must print `=0`.
- [ ] **PR:**

```bash
git push -u origin feat/turn-control-cards
gh pr create --title "App B: Stop, steer and server-request cards (approval, clarify, secure entry)" --body "$(cat <<'EOF'
Implements spec §5.2–§5.3 and §6.0–§6.4 on top of App A.
- Stop (`session.interrupt`, 4001 retry, 15 s stop-timeout reconnect), steer (`queued`/`rejected`/4010/4001)
- Approval cards: 0.21.5 per id, 0.20.4 FIFO
- Clarify single + batch (`clarify.lock`, skip, submit all, skip all, multi-select arrays, Recommended badge)
- Secure entry (sudo/secret) behind Face ID; value only in form state (tests: spy + exit paths)
- Vault note; Stopped / Steered markers
- `clarify_request` push suppressed while foregrounded; tap routing pinned by test
**Native:** adds `expo-local-authentication` (config plugin `faceIDPermission`) — rebuild the dev client.
**New dev deps:** `@testing-library/react-native`, `test-renderer` (component tests for the §6.4 data rules).
Screenshots (dark + light): `docs/screenshots/turn-control/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Adversarial review** (fresh reviewer, opus): the Review Focus list, the §6.4 data rules, and
  every place `[id].tsx` maps A's names. Address findings, re-run the final gate, then merge.
- [ ] **His QA gate (spec §10.3):** after the bump, native rebuild on his iPhone (`npx expo prebuild -p ios --clean && npx expo run:ios --device`), then stop, steer, approval, clarify batch incl. push-tap, a secret via a throwaway skill, background mid-clarify **under 10 minutes**, both themes.

---

## Contract items — resolved against A's final plan (review 2026-09-28)

- **D1/D2:** implemented by **A** (`turn-controller.ts` Task 3, with tests). B does not touch the reducer;
  Task 1 keeps regression tests for them.
- **R1:** A exposes every name in the header table; `event.message.complete` carries `status`/`replayed`
  through A's transport (`turnActionFor`), and the screen's `applyEvent` has `status` + `live` in scope.
  `gw()` is nullable → B's `callGw()`.
- **R2:** `FakeSocket` has a zero-arg constructor, `open()`, parsed `sent`; tests must also call
  `installFakeWebSocketGlobal()` (A deviation 7).
- **R3:** A removes the item-based path from `[id].tsx`; B Task 7 removes the leftovers in `message-row`
  and `export`, and replaces A's interim `respondApproval`/`renderRequest` in Task 11.
- **R4:** A fires the Warning haptic from `onNewCard` only for `!replayed` (vault cards excluded after the
  A revision); B adds no arrival haptic.
- **R5:** A owns `config.set` 4001, `queued:true` on idle `send()`, and `status` in `event.message.complete`.
  B reuses A's `withStaleSessionRetry` for stop/steer/fallback submit.
- **R6:** A adds neither RNTL nor `jest.setup.ts`; B Task 3 owns both.
- **Reducer ownership:** A implements every `RequestAction` case (incl. D2); B adds only selectors
  (`composerMode`, `isApprovalActionable`).
