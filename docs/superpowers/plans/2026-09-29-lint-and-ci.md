# Lint clean-up + GitHub Actions CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run lint` exits 0 with zero warnings on `main`, and every PR runs typecheck, tests and lint in GitHub Actions.

**Architecture:** Fix the 11 pre-existing problems (10 React Compiler `react-hooks/*` errors + 1 `exhaustive-deps` warning) by removing the patterns, not by disabling rules. Then add one workflow, `.github/workflows/ci.yml`, that runs `npx tsc --noEmit`, `npx jest --ci`, `npm run lint` on Node 22 with SHA-pinned actions.

**Tech Stack:** Expo SDK 56, React 19.2, React Native 0.85, eslint 9 + eslint-config-expo 56 (React Compiler lint rules), jest-expo, GitHub Actions.

**Spec:** HANDOFF.md (hermes-deploy) → Open follow-ups → App: "`npm run lint` fails on 11 pre-existing problems in 5 files; the repo has no CI." No separate spec; rulings below are provisional against that line.

## Global Constraints

- Branch `fix/lint-ci`, worktree `/Users/gldc/Developer/hermes-mobile-app/.claude/worktrees/lint-ci`. PR-only, never push `main`.
- No `eslint-disable` comments and no rule downgrades in `eslint.config.js`. If a site is a genuine false positive, stop and report it instead.
- No new dependencies.
- Never edit `src/vendor/hermes-gateway/**`.
- Visible behaviour of every touched screen stays the same (first-load loader, pull-to-refresh spinner, spinner when the drawer opens, error cleared on retry, profile/archive switches reload the list).
- Before every commit: `npx tsc --noEmit && npx jest && npm run lint`, each gated on its own exit code.
- Commit trailer lines exactly as the session's attribution reminder gives them.

## Review Focus

1. Sidebar reopened after an error: the error must clear and the list reload, as today.
2. Sidebar profile switch / archive toggle while open: the list must reload (today this rides on `load`'s `activeProfile` dep).
3. Search typed then cleared, or typed while the request fails: no stale "Searching…" spinner and no stale hits for a different query.
4. Memory file with unsaved edits: back gesture still prompts "Discard changes?"; after Save, it no longer prompts.
5. Models/skill screens: first open shows the same loading UI as before; pull-to-refresh still spins.

---

### Task 1: `thinking-dots.tsx` — no ref read during render

**Files:** Modify `src/components/thinking-dots.tsx`

- [ ] Step 1: `npm run lint` — confirm the four `react-hooks/refs` errors at lines 8 and 27 (RED).
- [ ] Step 2: Replace `const anims = useRef([0, 1, 2].map(() => new Animated.Value(0.25))).current;` with `const [anims] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.25)));` (import `useState`, drop `useRef`).
- [ ] Step 3: lint shows no `thinking-dots.tsx` problems; tsc + jest green. Commit `fix(lint): thinking-dots holds its Animated values in state, not a ref read during render`.

### Task 2: `memory-file.tsx` — ref write during render + setState in the load effect

**Files:** Modify `src/app/memory-file.tsx`

- [ ] Step 1: confirm `react-hooks/refs` at 86 and `react-hooks/set-state-in-effect` at 107 (RED).
- [ ] Step 2 (ref): delete `dirtyRef`; the `beforeRemove` effect reads `dirty` directly and lists it in its deps (`[navigation, dirty]`), so the listener re-subscribes when dirtiness changes. Keep every other line of the listener identical. If the listener's Discard/Save paths depend on the ref being current *after* a `setState` in the same tick (e.g. Save clears dirty then navigates), keep that path working — check the Save → `router.back()` flow and, if it navigates in the same tick as the state change, drop the guard with a local `skipGuard` flag scoped to that navigation rather than reintroducing a render-time ref write.
- [ ] Step 3 (effect): split `load` into `fetchFile` (async; calls `setX` only after `await`) and `refresh` (the pull-to-refresh handler: `setRefreshing(true); setError(null);` then `await fetchFile()` then `setRefreshing(false)`). The mount effect calls `void fetchFile()` only. First-load UI is driven by `content === null` today — confirm that, so dropping the synchronous `setRefreshing(true)` on mount changes nothing visible; if the first-load UI does read `refreshing`, initialise it with `useState(true)` instead.
- [ ] Step 4: lint clean for the file; tsc + jest green. Commit `fix(lint): memory-file reads dirty in its listener deps and fetches without sync setState in the effect`.

### Task 3: `models.tsx` and `skills/[name].tsx` — same split

**Files:** Modify `src/app/models.tsx`, `src/app/skills/[name].tsx`

- [ ] Step 1: confirm `set-state-in-effect` at models:263 and skills:89 (RED).
- [ ] Step 2: same shape as Task 2 Step 3 in each file: a fetch function that only sets state after `await`, called by the mount effect; a `refresh` for pull-to-refresh that sets `refreshing`/clears `error` first. Keep `handleError` and every setter call the fetch makes. Check each file's first-load UI (`loaded === false`) and keep it identical.
- [ ] Step 3: lint clean for both; tsc + jest green. Commit `fix(lint): models and skill screens fetch without sync setState in the mount effect`.

### Task 4: `sidebar.tsx` — load trigger, search state, and the `activeProfile` dep

**Files:** Modify `src/components/sidebar.tsx`; Create `src/lib/sidebar-search.ts`, `src/lib/__tests__/sidebar-search.test.ts`

- [ ] Step 1: confirm the warning at 133 (`useCallback` unnecessary dep `activeProfile`) and `set-state-in-effect` at 156 and 198 (RED).
- [ ] Step 2 (warning): remove `activeProfile` from `load`'s deps (load reads `getProfileState().selected` after hydrating on purpose). Add `activeProfile` and `showArchived` to the deps of the effect `if (open) load()` so a profile/archive switch while open still reloads — this is what Review Focus 2 pins.
- [ ] Step 3 (156, drawer open → load): the effect must not reach a setter synchronously. Ruling: reorder `load` so its first statement is `await hydrateProfileStore(); await hydratePinStore();` and only then `if (!opts?.silent) setRefreshing(true); setError(null);`, followed by the network call as today. The effect body stays `if (open) void load();`. Hydration is memoised after the first call, so the spinner still appears in the same frame the drawer opens; pull-to-refresh and the foreground re-pull call the same function. If lint still flags the effect after this reorder, stop and report rather than restructuring further. Task 6 verifies the spinner on open and that an old error clears.
- [ ] Step 4 (198, search): make search state derived. Write the failing test first in `src/lib/__tests__/sidebar-search.test.ts` for a pure function

```ts
export interface SearchHits { q: string; results: SearchResult[] | null } // null = the request for q failed
export function searchView(query: string, hits: SearchHits | null, serverSearchOk: boolean):
  { pending: boolean; results: SearchResult[] | null }
```

  Cases: empty/blank query → `{pending:false, results:null}`; `serverSearchOk=false` → `{pending:false, results:null}`; hits for a different q → `{pending:true, results:null}`; hits for this q with results → `{pending:false, results}`; hits for this q with `results:null` (failed) → `{pending:false, results:null}`; query with surrounding spaces matches trimmed q.
  Then implement it in `src/lib/sidebar-search.ts`, and in the sidebar: delete the `searchPending` state; the effect only schedules the debounced request and, in its async callback, calls `setHits({ q, results: res.results })` on success or `setHits({ q, results: null })` on a non-auth failure (auth failure keeps its close + redirect). No setter runs synchronously in the effect body. Rows (line ~375) and the footer (lines ~611/621) read `searchView(query, hits, serverSearchOk)`.
- [ ] Step 5: `npm run lint` exits 0 with `0 problems`; tsc + jest green. Commit `fix(lint): sidebar search state is derived; load deps and drawer-open reload no longer set state synchronously`.

### Task 5: zero-warning lint + CI workflow + docs

**Files:** Modify `package.json` (`"lint": "expo lint --max-warnings 0"`), `AGENTS.md` (Commands + Git workflow: CI runs tsc, jest, lint on every PR; lint must be clean); Create `.github/workflows/ci.yml`

- [ ] Step 1: resolve action SHAs with `gh api repos/actions/checkout/git/ref/tags/<latest v tag>` and the same for `actions/setup-node` (dereference annotated tags to the commit). Use the checkout SHA the plugin repo already pins (`3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`) if it is still the latest v7.
- [ ] Step 2: write `ci.yml`:

```yaml
# Typecheck, unit tests and lint on every PR and on main. Merge only when this is green.
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<sha> # <tag>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<sha> # <tag>
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Typecheck
        run: npx tsc --noEmit
      - name: Unit tests
        run: npx jest --ci
      - name: Lint
        run: npm run lint
```

- [ ] Step 3: `npm run lint` (with `--max-warnings 0`) exits 0 locally. Also run `npx jest --ci` locally once (CI mode fails on obsolete snapshots). Commit `ci: typecheck, jest and lint on every PR`.
- [ ] Step 4: push the branch, open the PR (body: what changed per file, the CI job, Review Focus results). Poll `gh pr checks <n> --watch`; gate on its exit code, never on `| tail`. If CI fails for an environment reason (e.g. a test depending on the Mac's timezone/locale), fix the test or the workflow env, not by skipping.

### Task 6: simulator smoke of the touched screens

- [ ] On the iPhone 17 Pro sim (password session, already signed in), Metro from this worktree on a free port: open the sidebar (spinner, list), switch archive view and back, type a search and clear it, open Memory → a file, edit, back-gesture → "Discard changes?", open Models, open a Skill, pull-to-refresh on each; watch the thinking dots on a prompt. Screenshot each to `$CLAUDE_JOB_DIR/tmp/lintci-*.png`. Record results in the PR body.

---

## Review rulings (2026-09-29 adversarial review — BINDING; they override the task text above where they conflict)

R1 (critical). `react-hooks/set-state-in-effect` (eslint-plugin-react-hooks 7.1.1) scans every block of a function called from an effect and ignores `await` boundaries, so "setters after `await`" is still flagged. Setters that live inside nested callbacks (`.then/.catch/.finally`, `setTimeout`) pass. Therefore, in Tasks 2, 3 and 4 Step 3, the shared fetch function is a `useCallback` that returns a promise chain with EVERY setter inside `.then/.catch/.finally` callbacks, e.g. for the sidebar:
`load = useCallback((opts?) => hydrateProfileStore().then(() => { if (!opts?.silent) setRefreshing(true); setError(null); return hydratePinStore().then(() => withAuthRetry(...)).then(onOk, onFail).finally(() => { setRefreshing(false); setLoaded(true); }); }), [...])`, with the effect `if (open) void load();` and deps `[open, load, activeProfile, showArchived]`. Banned: wrapping a call in `(async () => { await load(); })()` or any other shape whose only effect is hiding a synchronous setter from the rule — the goal is that no setter runs synchronously on the effect's path, not that lint goes quiet. No `async` function body may call a setter before its first await either.

R2. `memory-file.tsx:253`, `models.tsx:387`, `skills/[name].tsx:115` bind `RefreshControl refreshing`, so first load shows the native spinner today. Keep it: initialise `refreshing` with `useState(true)` in all three, and clear it in the fetch chain's `.finally` (not only in `refresh`). `memory-file` must still clear `error` when the `name` param changes: clear it inside the fetch chain's success `.then`. Pull-to-refresh (`refresh`) sets `refreshing`/clears `error` in the event handler (not an effect), then calls the same fetch.

R3. Task 2 Step 2: the `[navigation, dirty]` listener deps pass lint and follow the React Navigation pattern; `skipGuard` is not needed (Save does not navigate, `memory-file.tsx:152-170`).

R4. Per-commit gate for Tasks 1–3: `npx eslint <touched files>` exit 0 (plus tsc + jest). The full `npm run lint` gate starts at Task 4.

R5. Task 4 Step 4 additions: test `searchView('abc', null, true)` → `{pending:true, results:null}`; test that a retyped earlier query whose hits are still held shows those hits immediately (accepted behaviour). The `rows` memo (`sidebar.tsx:~375`) must treat `results: null` as "no server hits" (client-side filter stands). `src/lib/__tests__/sidebar-search.test.ts` is under `src/`, so `expo lint --max-warnings 0` lints it — keep it warning-free. AGENTS.md note: `npm run lint` covers `src/` only (expo lint's default inputs); top-level `__tests__/` is not linted.

R6. Task 6 safety: never Save on the memory screen (it PUTs the live MEMORY.md) — verify the guard with an edit + back gesture + Discard only. The profile switcher only appears with >1 server profile; if hidden, verify Review Focus 2 via the archive toggle and say so. Nothing in the smoke test writes to the gateway.
