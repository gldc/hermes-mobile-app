# Pinned Chats in the Sidebar — Specification

**Date:** 2026-06-15
**Status:** Draft
**Owner:** [@gldc](https://github.com/gldc)
**Branch:** `feat/pinned-chats`

---

## 1. Overview

Add a "Pinned" section to the slide-over sidebar, above the existing "Recents"
list, mirroring the desktop app's pinned-sessions UX. Users can pin frequently-
used conversations for instant access, unpin them when they're no longer
relevant, and see pinned chats in a stable, user-ordered section that is
independent of recency pagination.

### 1.1 Goals

- Pin/unpin any session from the sidebar via a **swipe action** (consistent
  with the existing Archive / Rename / Delete swipe pattern).
- A collapsible **"Pinned" section** renders above "Recents", ordered by the
  user's pin sequence (not by `last_active`).
- Pins persist across app restarts.
- Zero server changes — pins are purely client-side state (same as the desktop).

### 1.2 Non-goals (this milestone)

- **Drag-to-reorder** pinned items. The desktop uses dnd-kit; React Native
  drag-and-drop inside a `FlatList` header is fragile and not worth the
  complexity for v1. Pins are ordered by insertion time (newest pinned
  appended last). Reordering can be added later as a long-press gesture.
- **Cross-device pin sync.** Pins live in device-local storage only. Each
  device maintains its own pin set.

### 1.3 Desktop parity — lineage-aware pins

The desktop stores pins keyed by `_lineage_root_id` so a pin survives
auto-compression (the session id rotates to a new continuation tip). **The
server already returns `_lineage_root_id`** on `GET /api/sessions` rows —
`hermes_state.py:2077` writes `merged["_lineage_root_id"] = s["id"]` when
projecting compression roots forward to their tips. The web server passes this
field through without stripping it. No server changes are needed.

This spec achieves full parity:

| Desktop mechanism | Mobile implementation |
|---|---|
| `sessionPinId(session)` → `_lineage_root_id ?? id` | Same 2-liner in `src/lib/session-utils.ts` |
| `sessionByAnyId` map (index by live id + lineage root) | Same pattern in `sidebar.tsx` |
| `mergeSessionPage()` keeps pinned sessions alive when paginated away | Same pattern in `sidebar.tsx` |
| Pin/unpin on context menu | Pin/unpin on swipe action |
| Drag-to-reorder | Deferred (see §1.2) |

---

## 2. Architecture

### 2.1 Data flow

```
┌─────────────┐      pin/unpin       ┌──────────────┐     persist      ┌──────────────┐
│  sidebar.tsx │ ───────────────────► │  pin-store.ts │ ──────────────► │  AsyncStorage│
│  (UI actions)│ ◄─────────────────── │  (state mgmt) │ ◄────────────── │  (on device) │
└──────┬──────┘  useSyncExternalStore └──────────────┘                  └──────────────┘
       │
       │  sessionByAnyId map
       │  (id + _lineage_root_id)
       ▼
  Pinned section resolves pin ids → live sessions
  (survives compression + pagination gaps)
```

### 2.2 New helper: `sessionPinId()` in `src/lib/session-utils.ts`

Durable id for pinning. Auto-compression rotates a conversation's session id
(root → continuation tip), so pins keyed on the live id evaporate. The lineage
root is stable across every compression, so we pin on that.

```ts
/** Durable id for pinning. The server projects compression roots forward to
 *  their continuation tips and writes `_lineage_root_id` on the merged row.
 *  Sessions that were never compressed have no lineage root — fall back to
 *  the live id. */
export function sessionPinId(
  session: Pick<SessionSummary, '_lineage_root_id' | 'id'>,
): string {
  return session._lineage_root_id ?? session.id;
}
```

This is the same helper the desktop uses (`apps/desktop/src/store/session.ts:90`).

### 2.3 New module: `src/pin-store.ts`

A module-level store following the same `useSyncExternalStore` pattern used by
`profile-store.ts` and `sidebar-store.ts`. Pure state transitions are exported
separately for unit testing; persistence is injectable.

**State shape:**

```ts
export interface PinStoreState {
  /** Ordered list of pinned session ids keyed by *lineage root* (insertion
   *  order; index 0 = top). Using the lineage root (not the live id) means
   *  pins survive auto-compression — the server rotates the session id to a
   *  new continuation tip but the root stays the same. For sessions that were
   *  never compressed, the lineage root equals the live id. */
  ids: string[];
  /** Whether the Pinned section body is collapsed (chevron ▸). Persisted. */
  collapsed: boolean;
  /** True once the persisted list has been read back from storage. */
  hydrated: boolean;
}
```

**API surface:**

```ts
// Subscriptions (useSyncExternalStore)
export function getPinState(): PinStoreState;
export function subscribePins(listener: () => void): () => void;

// Hydration
export function hydratePinStore(p?: PinPersistence): Promise<void>;

// Mutations — callers pass a lineage-root id (computed via sessionPinId()).
export function pinSession(pinId: string): void;
export function unpinSession(pinId: string): void;

// Lookup — accepts a lineage-root id.
export function isPinned(pinId: string): boolean;

// Collapse toggle
export function setPinsCollapsed(collapsed: boolean): void;

// Test helper — resets state AND the hydration promise to null.
export function __resetPinStore(): void;
```

> **No `prunePins` function.** The original spec called `prunePins()` after
> every session load to remove stale ids. Adversarial review found this
> **silently deletes valid cross-profile pins** — sessions load per-profile,
> so a pin from profile "default" won't appear in profile "work"'s loaded set.
> Instead, unresolvable pins are simply invisible (filtered out of
> `pinnedSessions` when `sessionByAnyId.get()` returns undefined). They
> reappear when the user switches back to the right profile. Pin removal
> happens only on explicit user action (unpin swipe, archive, delete).

**Persistence:** `expo-secure-store` (already a dependency — used by
`profile-store.ts`). The persistence interface mirrors `ProfilePersistence`:

```ts
export interface PinPersistence {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}
```

**Storage keys:**
- `hermes-pinned-sessions` — JSON-encoded `string[]`
- `hermes-pinned-collapsed` — JSON-encoded `boolean`

**Why a separate store and not inline state in `sidebar.tsx`?**

- The pin set must survive sidebar close/open cycles without re-fetching.
- Future features (chat header pin indicator, command palette pin toggle) can
  subscribe without depending on the sidebar component tree.
- Matches the existing pattern (`profile-store`, `sidebar-store`).

### 2.4 Why SecureStore (not AsyncStorage)?

`@react-native-async-storage/async-storage` is NOT bundled with Expo SDK 56
(it was deprecated from the SDK in SDK 49+) and is a **native module** — adding
it would force a dev-client rebuild, contradicting the project's AGENTS.md
guidance: "Adding a native module forces a dev-client rebuild and breaks hot
reload for anyone on the old binary — prefer pure-JS deps."

`expo-secure-store` is already a dependency, already used by `profile-store.ts`
with the same injectable persistence interface, and works fine for non-secret
data. Pins aren't secrets, but SecureStore avoids adding a native dependency
and keeps the pin store consistent with the profile store.

---

## 3. UI Changes

### 3.1 Sidebar layout (`src/components/sidebar.tsx`)

The sidebar currently renders: wordmark → search → destinations → recents
header + `FlatList` → floating New-chat pill. The pinned section inserts
between the destinations and the recents header.

```
┌─────────────────────────────────┐
│  Hermes              [avatar]   │
│  ┌─ Search ──────────────────┐  │
│  │ 🔍  Search                │  │
│  └───────────────────────────┘  │
│                                 │
│  💬 Chats                       │
│  🕐 Cron jobs                   │
│  📚 Memory                      │
│  ✨ Skills                      │
│  🖥  Models                     │
│                                 │
│  ─── Pinned ───  [▾]            │  ← NEW: collapsible section
│  📌 Session A                   │     (hidden when no pins)
│  📌 Session B                   │
│                                 │
│  ─── Recents ───  [profile] [🗄]│
│  Session C                      │
│  Session D                      │
│  …                              │
│                                 │
│        [  + New chat  ]         │
└─────────────────────────────────┘
```

**Key design decisions:**

1. **Pinned section is a `View` above the `FlatList`, not a `ListHeaderComponent`.**
   The existing `FlatList` is inverted (`inverted` isn't set, but the chat
   list *inside* a chat screen is; the sidebar list is standard top-down).
   Rendering pinned sessions as a static header `View` with its own map over
   pinned sessions keeps the code simple, avoids the inverted-list complexity,
   and lets the `FlatList` handle only the potentially-long recents list with
   its built-in pagination and virtualization.

2. **Hidden when empty.** The section renders only when `pinState.ids.length > 0`
   (after hydration). No "No pinned conversations" empty state — that's
   self-evident from the section's absence.

3. **Collapsible.** A chevron toggle (▸/▾) collapses the section body while
   keeping the "Pinned" header visible. Collapse state is persisted in the
   pin store (or a separate boolean in `AsyncStorage`), defaulting to open.

4. **Profile-scoped.** Pins are global (not per-profile), matching the desktop
   behavior. When viewing a non-default profile, pinned sessions that belong
   to a different profile still render in the Pinned section — the user
   explicitly chose to pin them, and they navigate to the session regardless
   of which profile it lives in.

### 3.2 Pin swipe action (`src/components/session-row.tsx`)

Add an optional `onPin` callback prop to `SessionRow`. When provided, a **Pin**
swipe action appears on the right side (alongside the existing Rename / Archive
/ Delete actions).

```ts
export const SessionRow = memo(function SessionRow({
  // …existing props…
  onPin,           // NEW: pin/unpin callback
  pinned = false,  // NEW: whether this session is currently pinned
}: {
  // …existing types…
  onPin?: () => void;
  pinned?: boolean;
}) { … });
```

**Swipe action appearance:**

| State | Icon (SF Symbol) | Background | Label |
|-------|-----------------|------------|-------|
| Unpinned | `pin.fill` | `colors.accent` | "Pin" |
| Pinned | `pin.slash.fill` | `colors.raised` | "Unpin" |

When `pinned={true}` and `onPin` is provided, the action reads "Unpin" with a
neutral background (removing a pin is a neutral action, not an accent one).

**SF Symbol Android mapping:** Add entries to the icon map:
- `pin.fill` → Material `push_pin`
- `pin.slash.fill` → Material `push_pin` (with a slash overlay, or fallback
  to `bookmark_remove` — verify availability in the Material Symbols set)

### 3.3 Sidebar integration

In `sidebar.tsx`:

1. **Hydrate pin store** inside the existing `load()` function (alongside
   `hydrateProfileStore()`), not in a separate `useEffect`.

2. **Subscribe to pin state** via `useSyncExternalStore(subscribePins, getPinState)`.

3. **Build `sessionByAnyId`** — a `Map<string, SessionSummary>` indexed by
   both the live `id` and the `_lineage_root_id` (when present). This lets a
   pin stored as a lineage root resolve to the current continuation tip,
   matching the desktop exactly:

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

4. **Compute `pinnedSessions`** by walking the pin id list and resolving each
   through `sessionByAnyId`. Deduplicate by live id (two pin ids could map to
   the same live session if lineage chains overlap):

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
   ```

5. **Keep pinned sessions alive on refresh.** When `load()` refreshes page 1,
   pinned sessions that fell off the server page must not be dropped — otherwise
   the Pinned section flickers empty. Apply a keep-alive filter in `load()`
   **only** (not in `loadMore`, which appends pages and doesn't replace the list):

   ```ts
   // In load(): replace setSessions(res.sessions) with:
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

   **`loadMore` is unchanged** — it appends the next page to the existing list
   with its current dedup logic. `mergeSessionPage` would reverse the order
   (prepending older sessions), so it must NOT be used there.

6. **Render pinned section** as a `View` with a section header and a list of
   `SessionRow` components (compact mode, same as recents). Each row gets:
   - `onPress` → `openChat(session.id)`
   - `onPin` → `unpinSession(sessionPinId(session))`
   - `pinned={true}`
   - `onRename`, `onArchive`, `onDelete` — same as recents rows
   - No swipe-to-reorder (v1)

7. **Add Pin action to recents rows.** Each recents `SessionRow` gets:
   - `onPin` → `pinSession(sessionPinId(session))` (if not already pinned)
   - `pinned={false}`

8. **No pruning on load.** Unlike the original spec, we do NOT call
   `prunePins()` after sessions load. Sessions load per-profile, so a pin from
   profile "default" won't appear in profile "work"'s loaded set — pruning would
   silently delete valid cross-profile pins. Unresolvable pins are simply
   invisible (filtered out of `pinnedSessions` when `sessionByAnyId.get()`
   returns undefined). They reappear when the user switches back.

9. **Exclude pinned from recents.** Filter pinned sessions in the `rows`
   derivation, NOT in `sessions` state. The `sessions` array must retain all
   server-returned sessions for correct pagination (`sessions.length >= total`
   guard in `loadMore`).

   ```ts
   const pinnedLiveIdSet = useMemo(
     () => new Set(pinnedSessions.map((s) => s.id)),
     [pinnedSessions],
   );
   ```

10. **Search interaction.** When searching (query is non-empty), the pinned
    section is hidden — same as the destinations list. Search results and the
    pinned section are mutually exclusive views.

### 3.4 Pinned section rendering

The Pinned section is **hidden when `showArchived` is true** (archiving unpins,
so there should never be archived+pinned sessions — hiding avoids edge cases).

```tsx
{/* Pinned section — only when there are pins, not searching, not archived view */}
{!searching && !showArchived && pinnedSessions.length > 0 ? (
  <View>
    {/* Section header */}
    <Pressable onPress={() => setPinsCollapsed(!pinState.collapsed)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 10, paddingTop: 8, paddingBottom: 2 }}>
        <Icon sf={pinState.collapsed ? 'chevron.right' : 'chevron.down'} size={12} color={colors.textFaint} />
        <Text style={{ flex: 1, color: colors.textFaint, fontSize: 13.5, fontWeight: '500', paddingLeft: 6 }}>
          Pinned
        </Text>
      </View>
    </Pressable>

    {/* Pinned session rows */}
    {!pinState.collapsed ? pinnedSessions.map((session) => (
      <SessionRow
        key={session.id}
        compact
        session={session}
        pinned
        onPress={() => openChat(session.id)}
        onPin={() => unpinSession(sessionPinId(session))}
        onRename={() => promptRename(session)}
        onArchive={() => toggleArchived(session)}
        onDelete={() => confirmDelete(session)}
      />
    )) : null}
  </View>
) : null}
```

### 3.5 Haptics

- **Pin:** `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)` — a
  slightly heavier tap than the New-chat pill to signal a "bookmark" action.
- **Unpin:** `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)`.

---

## 4. Interaction with existing actions

### 4.1 Delete

When a session is deleted, its pin is removed. The `confirmDelete` callback
already filters the session out of `sessions`; after the state update, the
`pinnedSessions` derivation naturally drops it. Additionally, `prunePins()`
cleans the persisted list so the stale id doesn't linger in storage.

### 4.2 Archive

Archiving a session **unpins** it. The desktop does the same (see
`use-session-actions.ts:856-867`). The `toggleArchived` callback should call
`unpinSession(sessionPinId(session))` **after** the server call succeeds (not
before), so a failed archive doesn't lose the pin:

```ts
const toggleArchived = useCallback(async (session) => {
  try {
    await withAuthRetry((r) => setSessionArchived(r, session.id, !showArchived, activeProfile));
    // Server call succeeded — now remove the pin.
    unpinSession(sessionPinId(session));
    setSessions((prev) => prev.filter((s) => s.id !== session.id));
    setTotal((t) => Math.max(0, t - 1));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    handleActionError(e, showArchived ? 'Unarchive' : 'Archive');
  }
}, [...]);
```

### 4.3 Rename

No interaction — renaming a session doesn't affect its pin state. The pin
references the session by id, and rename mutates the title only.

### 4.4 Profile switching

Pins are global. When switching profiles, pinned sessions from any profile
still appear in the Pinned section. Tapping a pinned session opens it via
`router.replace('/chat/${id}')`, which resumes the session on whatever profile
it belongs to (the `profile` param is threaded through the gateway call).

---

## 5. Testing

### 5.1 Unit tests (`__tests__/pin-store.test.ts`)

Following the existing pattern (injected I/O, pure transitions, `__resetPinStore` in `beforeEach`):

| Test | Description |
|------|-------------|
| `pinSession` adds an id to the end of the list | New pin appends |
| `pinSession` is idempotent | Pinning an already-pinned id is a no-op |
| `unpinSession` removes the id | Unpin drops the entry |
| `unpinSession` is idempotent | Unpinning an unpinned id is a no-op |
| `setPinsCollapsed` updates collapsed state | Collapse toggle works |
| `hydratePinStore` reads both keys from persistence | Storage round-trip works (ids + collapsed) |
| `hydratePinStore` handles corrupt JSON | Falls back to empty list / collapsed=false |
| `hydratePinStore` is idempotent | Second call is a no-op |
| `isPinned` returns correct boolean | Lookup helper |
| `__resetPinStore` resets state AND hydration promise | Test isolation works |

### 5.2 Unit tests (`__tests__/session-utils.test.ts`)

| Test | Description |
|------|-------------|
| `sessionPinId` returns `_lineage_root_id` when present | Compressed sessions use the root |
| `sessionPinId` returns `id` when no lineage root | Non-compressed sessions use the live id |
| `sessionPinId` handles empty-string lineage root | Falls back to `id` (not empty string) |

### 5.3 Swipe action — on-device only

Jest config matches `**/__tests__/**/*.test.ts` only (no `.tsx`). Component
rendering tests would require updating the config and adding `@testing-library/react-native`.
Swipe action appearance is verified on-device instead.

### 5.4 On-device verification

- Pin a session → appears in Pinned section above Recents.
- Unpin from Pinned section → disappears from Pinned, returns to Recents.
- Archive a pinned session → session is unpinned (pin removed AFTER server succeeds) and moves to Archived.
- Delete a pinned session → pin is removed.
- Kill and restart the app → pins survive (SecureStore persistence).
- Switch profile → cross-profile pins are invisible (not deleted), reappear on switch-back.
- Search → Pinned section hidden, search results show full list.
- Archived view → Pinned section hidden.
- Pinned session scrolls off page → still visible in Pinned section (keep-alive on refresh).
- Compressed session (long conversation) → pin survives compression (lineage root stable).
- Collapse Pinned section → state persists across sidebar close/open.

---

## 6. File changes summary

| File | Change |
|------|--------|
| `src/api/types.ts` | Add `_lineage_root_id?: string` to `SessionSummary`. **Must be done first** — all downstream code references it. |
| `src/pin-store.ts` | **New.** Pin state store with `expo-secure-store` persistence. |
| `src/lib/session-utils.ts` | **New.** `sessionPinId()` helper. |
| `__tests__/pin-store.test.ts` | **New.** Unit tests for pure transitions + hydration. |
| `__tests__/session-utils.test.ts` | **New.** Unit tests for `sessionPinId`. |
| `src/components/sidebar.tsx` | Import pin-store + session-utils; hydrate on open; build `sessionByAnyId`; compute `pinnedSessions`; render Pinned section; exclude pinned from recents `rows`; keep-alive in `load()`; add `onPin` to rows. |
| `src/components/session-row.tsx` | Add `onPin` and `pinned` props; render Pin/Unpin swipe action. |
| `src/lib/icon-map.ts` | Add `pin.fill` and `pin.slash.fill` Android mappings. |

No new dependencies (uses existing `expo-secure-store`). No server-side
changes. No changes to `restClient.ts`, `sessions.ts`, `sidebar-host.tsx`,
`sidebar-store.ts`, or `connection.ts`.

---

## 7. Edge cases

### 7.1 Session not in loaded page

A pinned session may not be in the current session page (first 40 by
`last_active`). The sidebar handles this with keep-alive in `load()` (§3.3
step 5): when page 1 refreshes, pinned sessions from the previous load are
retained in the in-memory list so the Pinned section never flickers empty.

`loadMore` does NOT use keep-alive (it appends pages, doesn't replace the
list). If a pinned session is beyond the loaded pages, it won't appear until
the user scrolls far enough or refreshes.

Cross-profile pins are invisible when their profile isn't loaded — they
reappear when the user switches back. No pruning occurs.

### 7.2 Rapid pin/unpin

The pin store mutations are synchronous (in-memory first), then persisted
async. Rapid toggling won't lose state because the in-memory state is the
source of truth; persistence catches up on the next write.

### 7.3 First-time use

On first launch (or after clearing storage), the pin store hydrates to an
empty list. The Pinned section is simply not rendered. No onboarding is
needed — the Pin swipe action is discoverable alongside the existing Archive /
Delete actions.

### 7.4 Maximum pins

No hard limit. The Pinned section scrolls within the sidebar if it grows very
long. In practice, users pin 5-10 sessions at most.

### 7.5 Compression lineage

When a long conversation auto-compresses, the server creates a new session
(the continuation tip) and marks the old one as `end_reason: 'compression'`.
The list response projects the root forward to the tip and writes
`_lineage_root_id` on the merged row.

**Pin stored as root:** The pin id is the lineage root (set at pin time via
`sessionPinId()`). After compression, the session re-appears in the list
under the new tip id, but `sessionByAnyId` maps the root id to the tip — so
the pin resolves correctly with no user action.

**Session never compressed:** `_lineage_root_id` is absent, `sessionPinId()`
returns the live `id`, and the pin works as a direct lookup.

**Multiple compressions:** The root id is always the *original* session id
(the first in the chain), not intermediate segments. The server's
`list_sessions_rich` walks the full chain forward to the tip
(`hermes_state.py:2059`), so `_lineage_root_id` is always the chain's
starting point regardless of how many compressions occurred.

---

## 8. Future considerations

- **Drag-to-reorder** — long-press + drag within the Pinned section. Would
  require a drag-and-drop library or custom gesture handler.
- **Pin count badge** on the sidebar destinations or settings.
- **Pin sync across devices** — store pins on the server as a per-user
  preference (would need a new API endpoint).
