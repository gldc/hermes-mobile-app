# Pinned Chats Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a "Pinned" section to the slide-over sidebar with lineage-aware pinning.

**Architecture:** Pin state in a `useSyncExternalStore` module (like `profile-store`), persisted to `expo-secure-store`. Pins keyed by `_lineage_root_id` (survives compression). Pinned section renders as a `View` above the existing `Animated.FlatList` in the sidebar.

**Tech Stack:** React Native, Expo SDK 56, TypeScript, Jest, `expo-secure-store`, `expo-haptics`.

**Spec:** `docs/plans/pinned-chats-spec.md` (adversarially reviewed and corrected).

**Conventions (from AGENTS.md):**
- `process.env.EXPO_OS`, not `Platform.OS`
- All colors from `useTheme()`; never hardcode hex
- `borderCurve: 'continuous'` on rounded rects; inline styles
- SF Symbols via `expo-image` (`source="sf:name"`)
- Every SF symbol must have an Android mapping in `src/lib/icon-map.ts`
- Pure logic in `src/api`/`src/lib` with injected I/O and unit tests in `__tests__/`
- `npx tsc --noEmit && npx jest` before committing

---

### Task 1: Add `_lineage_root_id` to `SessionSummary`

**Objective:** Extend the type so all downstream code compiles.

**Files:**
- Modify: `src/api/types.ts:2-12`
- Test: existing tests still pass (no behavior change)

**Step 1: Add the optional field**

In `src/api/types.ts`, add to `SessionSummary`:
```ts
  /** Set by the server when a session is a compression continuation.
   *  Points to the original root session id. Absent on non-compressed sessions. */
  _lineage_root_id?: string;
```

**Step 2: Verify**

```bash
npx tsc --noEmit
npx jest
```

Expected: no new errors, all existing tests pass.

**Step 3: Commit**

```bash
git add src/api/types.ts
git commit -m "feat(types): add _lineage_root_id to SessionSummary"
```

---

### Task 2: Create `sessionPinId` helper with tests (TDD)

**Objective:** Durable id for pinning that survives compression.

**Files:**
- Create: `src/lib/session-utils.ts`
- Create: `__tests__/session-utils.test.ts`

**Step 1: Write failing tests**

```ts
// __tests__/session-utils.test.ts
import { sessionPinId } from '../src/lib/session-utils';

describe('sessionPinId', () => {
  it('returns _lineage_root_id when present', () => {
    expect(sessionPinId({ id: 'tip', _lineage_root_id: 'root' })).toBe('root');
  });

  it('returns id when no lineage root', () => {
    expect(sessionPinId({ id: 'abc' })).toBe('abc');
  });

  it('returns id when lineage root is empty string', () => {
    expect(sessionPinId({ id: 'abc', _lineage_root_id: '' })).toBe('abc');
  });
});
```

**Step 2: Run tests to verify failure**

```bash
npx jest __tests__/session-utils.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write implementation**

```ts
// src/lib/session-utils.ts
import type { SessionSummary } from '@/api/types';

/** Durable id for pinning. The server projects compression roots forward to
 *  their continuation tips and writes `_lineage_root_id` on the merged row.
 *  Sessions that were never compressed have no lineage root — fall back to
 *  the live id. */
export function sessionPinId(
  session: Pick<SessionSummary, '_lineage_root_id' | 'id'>,
): string {
  return session._lineage_root_id || session.id;
}
```

**Step 4: Run tests to verify pass**

```bash
npx jest __tests__/session-utils.test.ts
```

Expected: 3 passed.

**Step 5: Commit**

```bash
git add src/lib/session-utils.ts __tests__/session-utils.test.ts
git commit -m "feat: add sessionPinId helper for compression-safe pinning"
```

---

### Task 3: Create `pin-store` with tests (TDD)

**Objective:** Module-level store for pin state with SecureStore persistence.

**Files:**
- Create: `src/pin-store.ts`
- Create: `__tests__/pin-store.test.ts`

**Step 1: Write failing tests**

Follow the `profileStore.test.ts` pattern: inject a fake persistence, test pure transitions.

```ts
// __tests__/pin-store.test.ts
import {
  __resetPinStore, getPinState, hydratePinStore,
  pinSession, unpinSession, isPinned, setPinsCollapsed,
  type PinPersistence,
} from '../src/pin-store';

function fakePersistence(data: Record<string, string> = {}): PinPersistence {
  const store = new Map(Object.entries(data));
  return {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => { store.set(k, v); },
    del: async (k) => { store.delete(k); },
  };
}

beforeEach(() => __resetPinStore());

describe('pinSession / unpinSession', () => {
  it('appends a new pin', () => {
    pinSession('a');
    expect(getPinState().ids).toEqual(['a']);
  });

  it('is idempotent', () => {
    pinSession('a');
    pinSession('a');
    expect(getPinState().ids).toEqual(['a']);
  });

  it('removes on unpin', () => {
    pinSession('a');
    pinSession('b');
    unpinSession('a');
    expect(getPinState().ids).toEqual(['b']);
  });

  it('unpin is idempotent', () => {
    unpinSession('x');
    expect(getPinState().ids).toEqual([]);
  });
});

describe('isPinned', () => {
  it('returns true for pinned ids', () => {
    pinSession('a');
    expect(isPinned('a')).toBe(true);
    expect(isPinned('b')).toBe(false);
  });
});

describe('setPinsCollapsed', () => {
  it('updates collapsed state', () => {
    setPinsCollapsed(true);
    expect(getPinState().collapsed).toBe(true);
    setPinsCollapsed(false);
    expect(getPinState().collapsed).toBe(false);
  });
});

describe('hydratePinStore', () => {
  it('reads both keys from persistence', async () => {
    const p = fakePersistence({
      'hermes-pinned-sessions': '["a","b"]',
      'hermes-pinned-collapsed': 'true',
    });
    await hydratePinStore(p);
    const state = getPinState();
    expect(state.ids).toEqual(['a', 'b']);
    expect(state.collapsed).toBe(true);
    expect(state.hydrated).toBe(true);
  });

  it('falls back on corrupt JSON', async () => {
    const p = fakePersistence({ 'hermes-pinned-sessions': 'not-json' });
    await hydratePinStore(p);
    expect(getPinState().ids).toEqual([]);
    expect(getPinState().collapsed).toBe(false);
  });

  it('is idempotent', async () => {
    const p = fakePersistence({ 'hermes-pinned-sessions': '["a"]' });
    await hydratePinStore(p);
    pinSession('b');
    await hydratePinStore(p); // second call is no-op
    expect(getPinState().ids).toEqual(['a', 'b']);
  });
});

describe('__resetPinStore', () => {
  it('resets hydration promise so re-hydration works', async () => {
    const p = fakePersistence({ 'hermes-pinned-sessions': '["a"]' });
    await hydratePinStore(p);
    expect(getPinState().ids).toEqual(['a']);
    __resetPinStore();
    expect(getPinState().ids).toEqual([]);
    expect(getPinState().hydrated).toBe(false);
    const p2 = fakePersistence({ 'hermes-pinned-sessions': '["b"]' });
    await hydratePinStore(p2);
    expect(getPinState().ids).toEqual(['b']);
  });
});
```

**Step 2: Run tests to verify failure**

```bash
npx jest __tests__/pin-store.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write implementation**

```ts
// src/pin-store.ts
import * as SecureStore from 'expo-secure-store';

export const PINNED_SESSIONS_KEY = 'hermes-pinned-sessions';
export const PINNED_COLLAPSED_KEY = 'hermes-pinned-collapsed';

export interface PinStoreState {
  ids: string[];
  collapsed: boolean;
  hydrated: boolean;
}

export interface PinPersistence {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const securePersistence: PinPersistence = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  del: (k) => SecureStore.deleteItemAsync(k),
};

const initialState: PinStoreState = { ids: [], collapsed: false, hydrated: false };
let state: PinStoreState = initialState;
const listeners = new Set<() => void>();

function emit(next: PinStoreState): void {
  state = next;
  for (const l of [...listeners]) l();
}

export function getPinState(): PinStoreState { return state; }
export function subscribePins(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isPinned(pinId: string): boolean {
  return state.ids.includes(pinId);
}

export function pinSession(pinId: string): void {
  if (state.ids.includes(pinId)) return;
  const next = { ...state, ids: [...state.ids, pinId] };
  emit(next);
  persistIds(next.ids);
}

export function unpinSession(pinId: string): void {
  const ids = state.ids.filter((id) => id !== pinId);
  if (ids.length === state.ids.length) return;
  const next = { ...state, ids };
  emit(next);
  persistIds(ids);
}

export function setPinsCollapsed(collapsed: boolean): void {
  if (state.collapsed === collapsed) return;
  emit({ ...state, collapsed });
  persistCollapsed(collapsed);
}

// --- persistence (fire-and-forget, best-effort) ---

function persistIds(ids: string[]): void {
  securePersistence.set(PINNED_SESSIONS_KEY, JSON.stringify(ids)).catch(() => {});
}

function persistCollapsed(collapsed: boolean): void {
  securePersistence.set(PINNED_COLLAPSED_KEY, JSON.stringify(collapsed)).catch(() => {});
}

// --- hydration ---

let hydration: Promise<void> | null = null;

export function hydratePinStore(p: PinPersistence = securePersistence): Promise<void> {
  if (!hydration) {
    hydration = (async () => {
      let ids: string[] = [];
      let collapsed = false;
      try {
        const raw = await p.get(PINNED_SESSIONS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) ids = parsed.filter((x) => typeof x === 'string');
        }
      } catch { /* corrupt — fall back to empty */ }
      try {
        const raw = await p.get(PINNED_COLLAPSED_KEY);
        if (raw) collapsed = JSON.parse(raw) === true;
      } catch { /* corrupt — fall back to false */ }
      emit({ ids, collapsed, hydrated: true });
    })();
  }
  return hydration;
}

// --- test helper ---

export function __resetPinStore(): void {
  state = initialState;
  listeners.clear();
  hydration = null;
}
```

**Step 4: Run tests to verify pass**

```bash
npx jest __tests__/pin-store.test.ts
```

Expected: all pass.

**Step 5: Run full suite**

```bash
npx tsc --noEmit && npx jest
```

Expected: no errors.

**Step 6: Commit**

```bash
git add src/pin-store.ts __tests__/pin-store.test.ts
git commit -m "feat: add pin-store with SecureStore persistence"
```

---

### Task 4: Add Pin/Unpin swipe action to `SessionRow`

**Objective:** Extend `SessionRow` with `onPin` and `pinned` props.

**Files:**
- Modify: `src/components/session-row.tsx`

**Step 1: Add props**

Add to the component signature:
```ts
  onPin?: () => void;
  pinned?: boolean;
```

**Step 2: Add swipe action**

In the `renderRightActions` View, add Pin/Unpin **before** Rename:

```tsx
{onPin ? (
  <SwipeAction
    icon={pinned ? 'pin.slash.fill' : 'pin.fill'}
    label={pinned ? 'Unpin' : 'Pin'}
    compact={compact}
    background={pinned ? colors.raised : colors.accent}
    tint={pinned ? colors.text : colors.onAccent}
    accessibilityLabel={`${pinned ? 'Unpin' : 'Pin'} conversation: ${title}`}
    onPress={() => { methods.close(); onPin(); }}
  />
) : null}
```

**Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/components/session-row.tsx
git commit -m "feat(session-row): add Pin/Unpin swipe action"
```

---

### Task 5: Add icon map entries

**Objective:** Map `pin.fill` and `pin.slash.fill` for Android.

**Files:**
- Modify: `src/lib/icon-map.ts`

**Step 1: Add mappings**

```ts
'pin.fill': 'pin',
'pin.slash.fill': 'pin-outline',
```

> Verify `pin` and `pin-outline` exist in the MaterialCommunityIcons glyphmap
> by running the icon-map test — it validates every Material icon name.

**Step 2: Run icon-map test**

```bash
npx jest __tests__/icon-map.test.ts
```

Expected: pass (validates both that the Material icon names exist AND that every SF symbol in `src/` has a mapping).

**Step 3: Commit**

```bash
git add src/lib/icon-map.ts
git commit -m "feat(icon-map): add pin.fill and pin.slash.fill Android mappings"
```

---

### Task 6: Integrate pinned section into sidebar

**Objective:** Wire pin-store into `sidebar.tsx` — hydrate, resolve, render, keep-alive.

**Files:**
- Modify: `src/components/sidebar.tsx`

This is the largest task. Steps follow the spec §3.3 exactly:

**Step 1: Add imports**

```ts
import { getPinState, hydratePinStore, pinSession, setPinsCollapsed, subscribePins, unpinSession } from '@/pin-store';
import { sessionPinId } from '@/lib/session-utils';
```

**Step 2: Subscribe to pin state**

After the existing `useSyncExternalStore(subscribeProfiles, getProfileState)`:
```ts
const pinState = useSyncExternalStore(subscribePins, getPinState);
```

**Step 3: Hydrate in `load()`**

Inside the existing `load` function, after `await hydrateProfileStore()`:
```ts
await hydratePinStore();
```

**Step 4: Build `sessionByAnyId`**

```ts
const sessionByAnyId = useMemo(() => {
  const map = new Map<string, SessionSummary>();
  for (const s of sessions) {
    map.set(s.id, s);
    if (s._lineage_root_id && !map.has(s._lineage_root_id)) {
      map.set(s._lineage_root_id, s);
    }
  }
  return map;
}, [sessions]);
```

**Step 5: Compute `pinnedSessions`**

```ts
const pinnedSessions = useMemo(() => {
  const seen = new Set<string>();
  const out: SessionSummary[] = [];
  for (const pinId of pinState.ids) {
    const session = sessionByAnyId.get(pinId);
    if (session && !seen.has(session.id)) {
      seen.add(session.id);
      out.push(session);
    }
  }
  return out;
}, [pinState.ids, sessionByAnyId]);

const pinnedLiveIdSet = useMemo(
  () => new Set(pinnedSessions.map((s) => s.id)),
  [pinnedSessions],
);
```

**Step 6: Keep-alive in `load()`**

Replace `setSessions(res.sessions)` in `load()` with:
```ts
const pinIds = new Set(pinState.ids);
setSessions((prev) => {
  if (prev.length === 0 || pinIds.size === 0) return res.sessions;
  const incomingIds = new Set(res.sessions.map((s) => s.id));
  const survivors = prev.filter(
    (s) => !incomingIds.has(s.id) &&
      (pinIds.has(s.id) || (s._lineage_root_id && pinIds.has(s._lineage_root_id))),
  );
  return [...res.sessions, ...survivors];
});
```

**Step 7: Exclude pinned from recents `rows`**

In the existing `rows` useMemo, filter out pinned sessions:
```ts
// After computing list from sessions:
const filteredList = list.filter((s) => !pinnedLiveIdSet.has(s.id));
return filteredList.map((session) => ({ kind: 'session' as const, session }));
```

**Step 8: Render Pinned section**

Insert between the destinations `View` and the recents header `View`. Use the code from spec §3.4.

**Step 9: Add `onPin` to SessionRow renders**

For recents rows:
```tsx
onPin={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); pinSession(sessionPinId(item.session)); }}
pinned={false}
```

For pinned rows:
```tsx
onPin={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); unpinSession(sessionPinId(session)); }}
pinned={true}
```

**Step 10: Update `toggleArchived`**

Add `unpinSession(sessionPinId(session))` **after** the `await` succeeds (see spec §4.2).

**Step 11: Verify**

```bash
npx tsc --noEmit && npx jest
```

Expected: no errors, all tests pass.

**Step 12: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat(sidebar): add Pinned section with lineage-aware pinning"
```

---

### Task 7: Final verification

**Objective:** Full test suite + typecheck clean.

```bash
npx tsc --noEmit && npx jest
```

Expected: all pass, zero errors.

```bash
git diff --stat main
```

Verify only the expected files were changed.

```bash
git commit --allow-empty -m "chore: pinned chats — final verification"
```

---

## Task Dependency Graph

```
Task 1 (types)
  └── Task 2 (sessionPinId)
  └── Task 3 (pin-store)
        └── Task 4 (session-row)  ── depends on Task 2 + 3
        └── Task 5 (icon-map)     ── independent
              └── Task 6 (sidebar) ── depends on Tasks 2-5
                    └── Task 7 (verify)
```

Tasks 2 and 3 are independent of each other (both depend only on Task 1).
Tasks 4 and 5 are independent of each other (both depend on Tasks 2+3).
Task 6 depends on all preceding tasks.
