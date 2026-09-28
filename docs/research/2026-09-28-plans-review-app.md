# Adversarial review — app plans A / B / C (control path 0.21.5), 2026-09-28

Scope: `docs/superpowers/plans/2026-09-28-{00-interfaces,A-transport,B-turn-control-cards,C-polish}.md`
on `docs/control-path-0.21.5-spec` (9a3a885). Method: B's every symbol/anchor checked against A's actual
code blocks (Tasks 3–8), the real `main` sources (composer, message-row, export, skills, push, approval-card,
attach, `[id].tsx`), the upstream generated contract at `v2026.9.24`, and the npm registry.

**Counts:** 3 BLOCKER, 6 MAJOR, 16 MINOR/INFO. Fixed in the plans: 3 BLOCKER, 5 MAJOR, 13 MINOR.
**Needs a decision:** M5 (mid-turn replay loses pre-drop text), m8 (settled cards vanish after reconnect).

## BLOCKER (B would not execute cleanly on top of A)

| id | plan / task | issue | status |
|---|---|---|---|
| B1 | B T7 | Rewrote `ApprovalCard` to `{card, actionable}` but left A's `[id].tsx` `renderRequest` using `approval=/active=` and `type ApprovalInfo` → `tsc` gate fails at T7. The step also told the executor to delete `respondApproval`, which after A is A's **live** card-based function still referenced by `renderRequest`. | FIXED: T7 now edits A's approval branch (`isApprovalActionable`), drops `activeLegacyId`/`approvalInfo`/`ApprovalInfo`/`parseApprovalRequest`, keeps `respondApproval` until T11; grep check added. |
| B2 | B T11 | Created `mergeTranscript` + `TranscriptRow` in `transcript-rows.ts` → duplicate identifier with A's `type TranscriptRow` import in `[id].tsx`; different orphan semantics from A's `mergeRequestRows`; replaced FlatList props A had already rewritten (`reversedItems`, `renderItem({item})`); left A's `respondApproval`/`VAULT_NOTE`/`UNSUPPORTED_NOTE` dead; `registryRef.current.respond` on a nullable ref. | FIXED: `transcript-rows.ts` holds only generic `rowIndexOf` over A's rows; T11 replaces A's `renderRequest` in place (name kept → FlatList untouched except `ref` + `onScrollToIndexFailed`), deletes A's interim pieces, null-safe registry. |
| B3 | B T4 | Screen wiring assumed a screen-level `dispatchTurn({type:'event.message.complete'})` with `replayed` in scope and `e.payload?.status`; after A the store update happens in the transport and `applyEvent` has `status`/`live`. `gw().call(...)` on A's nullable `gw()` → tsc error. `resumeStored` re-implemented `session.resume` bypassing A's `resumeStored()` (store seeding, onResumed, claim). | FIXED: null-safe generic `callGw()`, `resumeStored` → `transportRef.current.resumeStored()`, exact old→new replacement of A's three `message.complete` lines using `completionEffects(status, !live)`. |

## MAJOR

| id | plan / task | issue | status |
|---|---|---|---|
| M1 | B T1 | Re-implemented D1/D2 (A already ships them with tests) and replaced A's `request.received`/`request.answered` cases. B's `answerRequest` dropped A's "only open cards settle" guard (a late lock/answer could flip `cancelled` → `answered`). | FIXED: T1 appends only `composerMode` + `isApprovalActionable`; D1/D2 tests kept as regression tests on A's reducer. |
| M2 | B T2 | Second `withStaleSessionRetry`/`STALE_SESSION_CODE` with a different signature than A's `src/api/stale-session.ts` (`(sid, run, resume→Promise<string>)`). | FIXED: B imports A's helper; `resumeStored` returns the live id; test harness updated. |
| M3 | B T2 (spec §5.3 × A dev. 6) | 15 s stop fallback → `reconnect('stop-timeout')`; if the server still reports `running`, A keeps `stopping` → composer stuck on disabled "Stopping…" forever. | FIXED: after the reconnect, still `stopping` → `stop.failed` (Stop re-enabled); new test. `'stop-timeout'` confirmed present in A's `ReconnectTrigger`. |
| M4 | B T9 | "Create `__tests__/skills.test.ts`" — file already exists on `main` (list/toggle/summary/filter/sort); would delete those tests. | FIXED: append a describe block reusing `fakeFetch`/`client`/`skill`. |
| M5 | A T5/T8 + spec §7/§10.2 | Mid-turn reconnect: watermark = highest seq seen, and `loadHistory` replaces `items` before the replay. The pre-drop streamed text is unpersisted, so the replace removes it and `events.since(last_seen=watermark)` does not bring it back — only gap text reappears. Spec §10.2 expects "partial text restored". The spec is itself inconsistent here (§7.4.1 vs §7.4.2/§10.2). | **NEEDS DECISION.** Options in A's revision log item 3: (a) accept + amend spec; (b) per-turn watermark (seq of last `message.complete`/`message.start`) used as `last_seen` while running — the existing "apply after last complete" rule dedupes; (c) keep the trailing incomplete assistant item across the replace. Recommend (b). B T11 Step 8 item 2b now observes/records it; contract §8 notes it. |
| M6 | B T4 / C T5 | Both edit `composer.tsx`; merge order unstated and B not written against C's file. | FIXED: order A → C → B stated in A, B, C and contract §8; B's composer steps keep C's lines explicitly; C has a re-anchor note if B lands first. |

## MINOR / INFO

| id | plan / task | issue | status |
|---|---|---|---|
| m1 | B T10 | `secure-entry-data.test.ts` omitted `installFakeWebSocketGlobal()` (A dev. 7 "required"). | FIXED |
| m2 | B T10 | `call: (m,p) => client.call(m,p)` relies on contextual generic inference. | FIXED → `client.call.bind(client)` |
| m3 | B T9 | `npx expo install expo-local-authentication` may auto-append a bare plugin → duplicate entry. | FIXED (note) |
| m4 | B all tasks | "Full gate + commit" blocks: pasted as a script, the commit runs even when the gate fails. | FIXED (constraint: run gate alone / chain with `&&`) |
| m5 | B | Setup (A-merged check, worktree) only at the end. | FIXED (referenced from "Base"; checks A's new files too) |
| m6 | spec §10.2 coverage | No 0.21.5 "reconnect mid-turn" check anywhere (A's smoke is 0.20.4, which has no replay). | FIXED (B T11 Step 8 item 2b) |
| m7 | A T8 | Warning haptic fired for vault-declined cards (nothing to answer). | FIXED (one conditional) |
| m8 | A T3 `mergeRequestRows` | Every reconnect re-keys `items`, so every settled card loses its anchor and is **not re-rendered** (e.g. an answered approval disappears after the phone sleeps), while a settled card with `anchorKey:null` stays. | **NEEDS DECISION (UX).** Keep settled orphans at the end too, or accept. Not changed (A's tests pin it). |
| m9 | C | Commit trailer `Claude Sonnet 5`. | FIXED → Opus 5.5 |
| m10 | C | No worktree/branch creation step. | FIXED |
| m11 | C T2/T4 | Committed after `tsc` only. | FIXED (full gate, exit-code checked) |
| m12 | C T2 | `attach.tsx` line refs wrong (137-194 → 109-194). | FIXED |
| m13 | C T5 | `height: undefined` may not force the native view to shrink (same root cause as the bug); `contentSize.height` may exclude the 10/2 pt padding → clipping. | FIXED (explicit RED→GREEN fallbacks + device check) |
| m14 | C T6 | Screenshots "dragged into the PR in a browser" — not doable autonomously; PR body lacked attribution. | FIXED (commit under `docs/screenshots/polish/`) |
| m15 | B | B's code was never compiled/run (A's was). Verified externally: RNTL 14.0.1 exists (peer `test-renderer ^1`, matchers auto-registered on import, async `render`), `test-renderer@1.2.0`, `expo-local-authentication@56.0.5`, mocks at `react-native-reanimated/mock.js` and `react-native-worklets/src/mock.ts`. Component tests remain unverified — expect small RNTL fixes in T3/T4. | INFO |
| m16 | all | CLAUDE.md "STATE.md / CHANGELOG.md in the same PR": this repo has neither; A updates AGENTS.md. | INFO |

## Checked and correct (no change)

- `session.steer` params `{session_id, profile?, text}`, result `status: 'queued'|'redirected'|'rejected'`; `session.interrupt` result ignored; `prompt.submit.queued` typed.
- `clarify.lock {request_id, question_id, answer?: unknown}` → `{status:'ok'|'expired', remaining?}`; server json-dumps non-string answers; last lock resolves. Single `ClarifyResult.answer` is a string; B's JSON-array text for single multi-select is parsed by upstream `_parse_multi_select_response`.
- The vendored channel re-delivers `open_requests` from **any** result, incl. `session.events.since` (spec §7.4.4).
- `ApprovalResult['choice']` ≡ app `ApprovalChoice`; `SecretRequestParams.metadata` exists; `ClarifyRequestParams.answers` exists.
- Theme tokens B uses all exist; `hermesmobileapp://` scheme; iPhone 17 Pro / 17 Pro Max / 16e simulators installed.
- No double dispatch: A's router owns arrival/cancel/vault/haptic; B's responder owns answering only; registry deletes on respond, re-`put` on re-delivery, A's reducer re-arms to `pending`.
- Spec coverage A+B+C: §3–§8 and §10.1 each have an owning task; 4001 (stop/steer via A helper, config.set in A), `queued:true` (A send, B fallbacks), error-in-waiting (A), replayed gating (A applyEvent/onNewCard + B `completionEffects`), secure-entry data rules (B T10 incl. spy + exit paths), clarify batch semantics (B T5/T8), `clarify_request` suppression (B T12), `>>>…<<<` snippets (A T7).
- Each plan has Spec line, Global Constraints, Review Focus with tests, TDD steps, exit-code gates, branch/worktree, PR + adversarial-review gate, dark+light simulator screenshots (after fixes).
