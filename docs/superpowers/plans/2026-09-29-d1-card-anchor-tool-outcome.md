# D1 card anchor + tool outcome icon — Implementation Plan

> **For agentic workers:** strict RED→GREEN TDD. One commit per task minimum. Do not push.

**Goal:** (1) After a mid-turn reconnect, an open request card stays below the tool row that asked
for it. (2) A tool row that was denied, interrupted or failed stops showing the green success check.

**Spec:** none separate; the defects are specified here from the 2026-09-29 QA report (item 6, D1)
and upstream research at hermes-agent `v2026.9.24` (cited below). Rulings made here are binding.

**Tech stack:** Expo SDK 56 / React Native / TypeScript, Jest (`npx jest`), `npx tsc --noEmit`,
`npm run lint`. Tests live in the repo-root `__tests__/` (e.g. `__tests__/transcript-rows.test.ts`)
and in `src/lib/__tests__/`.

## Global constraints
- No new dependencies. No changes under `src/vendor/`.
- Existing tests keep passing unchanged unless a task says otherwise.
- Light and dark themes both use existing tokens from `src/theme.ts` (`success`, `danger`, `textDim`).
- Every new SF symbol used by `<Icon sf=…>` must have an entry in `src/lib/icon-map.ts` (Android).

## Review focus
1. A card that settles (answered/cancelled) between the history reload and the end of the replay
   must still be drawn (not vanish) — the reason `reanchorAfterReplace` pins at all (Plan B I1).
2. Cold start / non-running resume: no card exists or no replay runs — nothing regresses.
3. Two reloads in one reconnect (the orchestrator can call `loadHistory` twice) — pins must union.
4. Terminal non-zero exit with `error: null` is a normal completion (command failed, tool worked) → `ok`.
5. History-reloaded tool rows get the same outcome as live ones.

---

### Task 1: D1 — pin re-anchored cards after the replay, not at the history reload

**Root cause.** On reconnect with a running turn the orchestrator (`src/lib/reconnect-orchestrator.ts`
`historyAndReplay`) does: `loadHistory` → then replays the unpersisted turn's events. The screen's
`loadHistory` (`src/app/chat/[id].tsx:419-433`) immediately calls
`reanchorAfterReplace(requests, prev, reloaded)`, which pins an open card whose anchor was re-keyed
away to the **reloaded history's last row**. History holds no in-flight tool row; the replay then
appends the running `clarify` tool row **after** that anchor. Observed: `i2:user, i3:assistant,
CARD(anchor=i3), i4:tool:clarify(running)`; expected: the card below `i4`.

**Fix (ruling).** Defer the pin to the end of the reconnect sequence. At a history replace, record
the ids of the OPEN cards whose effective anchor is gone (the same predicate `reanchorAfterReplace`
uses today); drop overrides whose card left the store; do NOT pin yet. While unpinned, those cards
are orphans, and `mergeRequestRows` (`src/lib/turn-controller.ts:265`) already draws open orphans at
the **tail** — i.e. after the replayed tool row, their final position. When the screen gets
`onPhase({kind:'ready'})` or `{kind:'failed'}` (both fire after `runSequence`, which includes the
replay and `flushParked`), pin every recorded id — **regardless of its current status** (Review
focus 1) — under the last item of the current list, then clear the record. Record ids union across
reloads (Review focus 3).

**Files:**
- Modify `src/lib/transcript-rows.ts`: add two pure functions and re-express `reanchorAfterReplace`
  as their composition (so its existing tests keep passing unchanged):
  ```ts
  /** At a history replace: ids of OPEN cards whose effective anchor (override ?? card.anchorKey)
   *  is null or not in `items`. */
  export function cardsLosingAnchor(requests: readonly RequestCardState[], anchors: CardAnchors,
    items: readonly { key: string }[]): string[]
  /** Overrides after a replace/replay: keep an override whose anchor is still in `items`; set every
   *  id in `pin` whose card is still in `requests` to the last item's key (skip when `items` is
   *  empty); drop everything else (cards gone from the store, dead anchors). */
  export function pinCards(requests: readonly RequestCardState[], anchors: CardAnchors,
    items: readonly { key: string }[], pin: readonly string[]): Record<string, string>
  export function reanchorAfterReplace(requests, anchors, items) {
    return pinCards(requests, anchors, items, cardsLosingAnchor(requests, anchors, items));
  }
  ```
  Check the composition against `reanchorAfterReplace`'s current body line by line (existing
  overrides whose anchor survives are kept; an override whose anchor died on a SETTLED card is
  dropped; an open card with lost anchor and empty items gets no override). If the composition
  cannot reproduce a current behaviour exactly, keep the old function body and add the two new ones
  beside it — do not change existing test expectations.
- Modify `createItemsMirror` in the same file: add `items: (): readonly T[] => current`.
- Modify `src/app/chat/[id].tsx`:
  - a `pendingPinRef = useRef<Set<string>>(new Set())` and a `cardAnchorsRef` kept equal to the
    latest `cardAnchors` (needed because `loadHistory` must read current overrides outside a setState
    updater; do not put side effects inside a `setCardAnchors` updater);
  - `loadHistory`: replace the `reanchorAfterReplace` call with: add
    `cardsLosingAnchor(requests, cardAnchorsRef.current, reloaded)` to `pendingPinRef.current`, then
    `setCardAnchors(prev => pinCards(requests, prev, reloaded, []))` (drops dead/gone overrides only);
    update the comment to explain the deferral (cite D1);
  - `onPhase`: on `ready` and on `failed`, if `pendingPinRef.current.size > 0`, take the ids, clear the
    set, and `setCardAnchors(prev => pinCards(readTurn().requests, prev, itemsMirror.items(), ids))`.
- Test: `__tests__/transcript-rows.test.ts`.

**Tests (write first, see them fail):**
1. `cardsLosingAnchor`: open card with dead anchor → included; open card with live override → not;
   settled card with dead anchor → not; open card with `anchorKey: null` and no override → included.
2. `pinCards`: pins to the last item; keeps a live override; drops a dead override not in `pin`;
   drops an id whose card left `requests`; empty `items` → no pin for that id.
3. **D1 scenario (the regression test).** Build: history reload items `[u(i2), a(i3)]`, an open
   clarify card with `anchorKey: 'i1'` (pre-reconnect key, now gone). Step 1: `ids =
   cardsLosingAnchor(...)`, anchors = `pinCards(req, {}, reloaded, [])` → `{}`. Step 2 (replay):
   items `[u(i2), a(i3), tool(i4)]`. Assert `mergeRequestRows(items, withCardAnchors(req, anchors))`
   renders the card AFTER i4 (tail). Step 3 (ready): anchors = `pinCards(req, anchors, items, ids)` →
   `{card: 'i4'}`; assert order `i2, i3, i4, CARD`. Step 4: card becomes `answered`, a new assistant
   row `i5` is appended → order `i2, i3, i4, CARD, i5` (the settled card is still drawn).
4. Settles-before-ready: same as 3 but mark the card `answered` BEFORE step 3 → after step 3 it is
   drawn after i4 (not dropped).
5. `createItemsMirror().items()` returns the latest list after `update`.
6. The existing `reanchorAfterReplace` tests pass unchanged.

- [ ] RED: write tests 1–5, run `npx jest __tests__/transcript-rows.test.ts` → fail (functions missing).
- [ ] GREEN: implement in `transcript-rows.ts`; tests pass.
- [ ] Wire `[id].tsx` as above; `npx tsc --noEmit` clean.
- [ ] Full `npx jest` green; `npm run lint` clean.
- [ ] Commit `fix(reconnect): pin re-anchored cards after the replay, not at the history reload (D1)`.

---

### Task 2: tool outcome — no green check on denied / interrupted / failed tools

**Root cause.** `ToolRow` (`src/components/message-row.tsx:115-129`) renders
`checkmark.circle.fill` in `colors.success` for every tool with `running: false`. `tool.complete`
carries no status field on the wire (upstream TUI comment, `ui-tui/src/app/turnController.ts:860`);
failure lives in `result`. Upstream facts at `v2026.9.24`:
- Denied / timed-out / withdrawn approval (terminal): result JSON
  `{"output":"","exit_code":-1,"error":"BLOCKED: …","status":"blocked","user_summary":"You denied this command — it did not run."}`
  (`tools/terminal_tool.py:858-934`, `tools/approval.py:505-532,711-721`).
- Interrupted tools: result is a plain string `"[Tool execution cancelled — {name} was skipped due to user interrupt]"`
  (also `… keyboard interrupt]`, `… was abandoned: {reason}]`) (`agent/tool_executor.py:926,1467,1527,1724,1811`).
  A terminal command killed by the interrupt: JSON with `exit_code: 130` and `output` ending in
  `[Command interrupted]` (`tools/environments/base.py:464`).
- Timeout: string `"Error executing tool '{name}': timed out after {N}s"` (`tool_executor.py:1462`).
- Generic error: `{"error": "<msg>", …}` (`tools/registry.py:1016`). Terminal success has `"error": null`;
  a non-zero `exit_code` with `error: null` is a normal completion.
- Upstream desktop's rule (`apps/desktop/src/lib/tool-result-summary.ts:24-30,372-381`):
  `success === false || ok === false || /^(error|failed|failure|fatal|exception)$/i.test(status) ||`
  any of `error|errors|failure|exception` holds a meaningful value (non-empty string not in
  `{'', '0','false','none','null','nil','ok','success','n/a','na'}` case-insensitive, `true`, a
  non-zero number, a non-empty array, a non-empty object).

**Files:**
- Create `src/lib/tool-outcome.ts`:
  ```ts
  export type ToolOutcome = 'ok' | 'failed' | 'denied' | 'interrupted';
  /** Classify a tool.complete `result` (already JSON-parsed by the gateway, or a raw string — a
   *  string that parses as a JSON object is classified as that object). Order: denied
   *  (status === 'blocked') → interrupted (string prefix "[Tool execution cancelled", or
   *  exit_code === 130 with string output ending "[Command interrupted]") → failed (string prefix
   *  "Error executing tool", or the desktop rule above) → ok. Anything else, including
   *  undefined/null/non-JSON strings/arrays, is 'ok'. Never throws. */
  export function toolOutcome(result: unknown): ToolOutcome;
  /** `user_summary` of a denied result, when it is a non-empty string (shown as the row summary). */
  export function deniedSummary(result: unknown): string | undefined;
  ```
- Modify `src/components/message-row.tsx`: `ToolInfo` gains `outcome?: ToolOutcome` (absent = ok).
  The finished-state icon: ok → `checkmark.circle.fill` / `colors.success`; failed →
  `xmark.circle.fill` / `colors.danger`; denied → `hand.raised.fill` / `colors.textDim`; interrupted
  → `stop.circle.fill` / `colors.textDim`. The accessibility label says `finished` / `failed` /
  `denied` / `interrupted` instead of always `finished`.
- Modify `src/lib/icon-map.ts`: add `'hand.raised.fill'` and `'stop.circle.fill'` (MaterialCommunityIcons
  names used by the map, e.g. `hand-back-right` and `stop-circle`; verify the names exist in the
  installed `@expo/vector-icons` MaterialCommunityIcons glyph map).
- Modify `src/app/chat/[id].tsx` `completeTool`: set `outcome: toolOutcome(payload?.result)`; if no
  `payload.summary` and the outcome is denied, use `deniedSummary(payload?.result)` as `summary`.
- Modify `src/lib/history.ts` (tool messages, ~line 45): classify the FULL `messageText(m)` (before
  the `MAX_TOOL_DETAIL` slice) with `toolOutcome`, and apply the same denied-summary fallback.
- Tests: `src/lib/__tests__/tool-outcome.test.ts` (new); extend the existing history test (find it
  with `grep -rl historyToItems __tests__ src/lib/__tests__`); a render assertion on the label or
  icon if `__tests__/transcript-markers.test.tsx` shows a workable pattern for `MessageRow`.

**Tests (write first):** `toolOutcome` table — the terminal denied JSON object → denied; the same as a
JSON string → denied; each cancelled string → interrupted; exit 130 + `[Command interrupted]` →
interrupted; timeout string → failed; `{"error":"boom"}` → failed; `{"error":null,"exit_code":2,"output":"x"}`
→ ok; `{"error":""}` → ok; `{"error":"none"}` → ok; `{"success":false}` → failed;
`{"status":"Error"}` → failed; `{"errors":[]}` → ok; `{"errors":["x"]}` → failed; `"plain text"` → ok;
`undefined`/`null`/`42`/`[]` → ok; malformed `"{not json"` → ok. `deniedSummary` returns the string and
undefined otherwise. History: a tool message whose content is the denied JSON → `outcome: 'denied'`
and `summary` = the user_summary; a normal one → `outcome: 'ok'`. Render: a row for each outcome has
the matching accessibility label.

- [ ] RED → GREEN for `tool-outcome.ts`; then history; then the row.
- [ ] `npx tsc --noEmit`, full `npx jest`, `npm run lint` clean.
- [ ] Commit `fix(tools): show denied, interrupted and failed tool rows as such, not as success`.

---

### Task 3 (controller, not the implementer): docs + simulator verification
- CHANGELOG.md / STATE.md (if present in this repo) updated in the same PR.
- Sim verify (controller): D1 repro from QA item 6 (clarify card pending → background ~90 s →
  foreground → card below the running clarify row, and stays there after answering); a denied
  approval shows the hand icon + "You denied this command — it did not run."; a Stop mid-tool shows
  the stop icon. Both themes.

---

## Review rulings (adversarial plan review, 2026-09-29) — these OVERRIDE the task text above

Full review: `/Users/gldc/.claude/jobs/b3346b34/tmp/plan-review.md` (findings 1–9 apply here).

**R1 (finding 1, pin target).** Do not pin to "the last item". Pin each recorded card to its
*requester row*, chosen at sequence end from the current items:
1. kind `clarify`: the last tool row named `clarify` (a running one if any);
2. otherwise the last tool row with `running: true`;
3. otherwise the settled anchor (`itemsMirror.anchorKey()`, which reads through `closeStreaming` —
   finding 7), i.e. today's behaviour.
Known limitation (ledger it in the PR body, do not solve): an approval card that SETTLES inside the
reconnect window whose continuation already appended rows falls to rule 3 and can sit below them.
Add the reviewer's test: clarify card settles in the window, then `tool.complete` for clarify and an
assistant row `i5` arrive before sequence end → order `…, i4(clarify), CARD, i5`.

**R2 (finding 2, test the wiring).** Put the pending-pin state in a small pure controller in
`src/lib/transcript-rows.ts`, e.g.
```ts
export function createCardPinner(): {
  /** A history replace happened: record open cards whose anchor the reload removed; returns the
   *  overrides to keep (dead/gone ones dropped; nothing pinned yet). */
  onHistoryReplace(requests, anchors, items): Record<string, string>;
  /** A card was created while a reconnect sequence was in flight (finding 5): record it. */
  onCardCreatedDuringSequence(id: string): void;
  sequenceStarted(): void;             // attempt / start()
  /** Sequence ended (ready, failed, or start() rejected — finding 6): pin every recorded id to its
   *  requester row (R1), clear the record, return the new overrides, or null when nothing recorded. */
  onSequenceEnd(requests, anchors, items, settledAnchor: string | null): Record<string, string> | null;
  inSequence(): boolean;
}
```
`[id].tsx` only forwards to it: `loadHistory` → `onHistoryReplace` (capture `readTurn().requests`
BEFORE `setCardAnchors`, as today); `onPhase` attempt → `sequenceStarted`; `onNewCard` when a
sequence is in flight → `onCardCreatedDuringSequence`; `onPhase` ready/failed and the `start()` catch
(`[id].tsx` ~604) → `onSequenceEnd` with `reqs`, `itemsMirror.items()` and `itemsMirror.anchorKey()`
captured outside the updater (finding 7); `start()` also calls `sequenceStarted` first. No
`cardAnchorsRef` (after a reload every old key is dead; pass `{}` or `prev` as appropriate).
**The D1 regression test must drive a real `createReconnectOrchestrator`** in
`src/lib/__tests__/reconnect-orchestrator.test.ts` (reuse its existing fakes): running resume → fake
`loadHistory` replaces items and calls the pinner → replay of `tool.start{name:'clarify'}` appends a
running tool row → a parked live event → `ready` → the merged order has the card right after the
clarify row. Add a two-reload case (the tail-has-complete branch) and a failed-attempt-then-retry
case. Keep the pure-function tests too.

**R3 (finding 3).** `denied` when `status === 'blocked'` OR `user_summary` is a non-empty string
(execute_code's gate returns `{"status":"error","error":"BLOCKED: …","user_summary":"You denied this code — it did not run."}`).
`deniedSummary` reads `user_summary` whatever the status. Add that shape to the table.

**R4 (finding 4).** When the whole-string parse fails and the trimmed text starts with `{`, classify
the JSON prefix: try the text before the first `"\n\n["`, else scan for the matching closing `}`
(string-aware). Table rows: denied JSON + `"\n\n[Tool loop warning: x]"` → denied;
`{"error":"x"}` + `"\n\n<subdir hint text>"` → failed.

**R8 (finding 8).** `status === 'cancelled'` → interrupted; the terminal marker test is
`output.includes('[Command interrupted]')` (with exit 130); arrays are meaningful when
`arr.some(meaningful)` (`{"errors":[""]}` → ok).

**R9 (finding 9).** Add `pinCards([], {gone:'i7'}, reloaded, [])` → `{}` where `i7` IS in `reloaded`.
