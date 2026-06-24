# Tier 3 — Cross-Surface Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reflect out-of-band activity across surfaces: the sidebar refreshes on app foreground, and a push notification deep-links to the specific session it concerns (claimed-only, device-targeted) instead of always opening `/chat/new`.

**Architecture:** Two independent asks shipped as **two PRs in two repos**. (A) App repo (`hermes-mobile-app`): a pure `routeForPushData` maps a push `data` payload to a route; the notification tap + cold-start paths consume it; the sidebar gains an `AppState` foreground-refresh effect. (B) Plugin repo (`hermes-mobile-plugin`): the in-process claim registry is extended to retain and return the **canonical stored route id** the app declared at claim time, so the `session_end` hook (which only sees the *live* id) can emit the stored id deterministically; sends become **device-targeted** and carry `data.session_id`. Cron pushes stay broadcast and id-free.

**Tech Stack:** TypeScript / React Native 0.85 / Expo SDK 56 / expo-router / expo-notifications, Jest (`jest-expo`); Python plugin (FastAPI router + in-process registry), pytest.

**Branches:**
- App: `feat/cross-surface-sync` (off `hermes-mobile-app` `main`).
- Plugin: `feat/push-deeplink` (off `hermes-mobile-plugin` `main`, at `/Users/gldc/Developer/hermes-mobile-plugin`).

**Spec:** `docs/superpowers/specs/2026-06-24-foreground-reconnect-rehydration-sync-design.md` §6, §8 #1/#5.

---

## How the blocking precondition (spec §8 #1) is resolved

`on_session_end` receives the **live** `session_id` (+ `task_id`); the route id the app navigates on is the **stored** `session_key`. The spec flagged the `session_end` emit as BLOCKED because the live→stored mapping wasn't recoverable. **Verified grounding:** the app's claim (`POST /api/plugins/mobile/session-claim`) already sends **both** `session_id` (live) and `session_key` (stored), and the registry stores both as keys → `device_id`. So we extend the registry to also retain the **route id** (the app-declared `session_key`) and return it from `resolve()`. Then `on_session_end`, even when it matches on the live id, returns the **stored** route id — the exact value the app supplied, not a guess. This satisfies §8 #1 *by construction*; no live id-equality verification is required. The approval path was already safe (`session_key` *is* the stored id) and is wired the same way.

---

## File Structure

### App repo (`hermes-mobile-app`)
- **Modify** `src/lib/push.ts` — add pure `routeForPushData(data: unknown): string`.
- **Modify** `__tests__/push.test.ts` — unit tests for `routeForPushData`.
- **Modify** `src/notifications.ts` — widen `setupNotificationHandling(onTap)` so `onTap` receives the push `data`; add `getColdStartRoute()`; add a handled-id guard against double-routing; fix the stale "carry no data" comment.
- **Modify** `src/app/_layout.tsx` — route taps via `routeForPushData`; fix comment.
- **Modify** `src/app/index.tsx` — on successful restore, replace to the cold-start deep-link target (or `/chat/new`).
- **Modify** `src/components/sidebar.tsx` — `AppState` foreground-refresh effect; `load({ silent })` to skip the spinner on that path.

### Plugin repo (`hermes-mobile-plugin`)
- **Modify** `hermes_mobile/session_notify.py` — registry retains/returns the route id; `_fan_out` becomes device-targeted + carries `session_id`; both hooks pass the resolved `(device_id, route_id)`; cron stays broadcast/id-free.
- **Modify** `hermes_mobile/plugin_api.py` — claim route passes `route_id` (the stored `session_key`).
- **Modify** `tests/test_session_notify.py` — assert emitted id == STORED (even when matched on live), two-device isolation, approval targeting, cron stays id-free.

**Verbatim current anchors** (re-read before editing — line numbers may drift):
- App: `src/lib/push.ts` `shouldSuppressForeground` 15-20 (defensive-parse pattern to mirror); `SUPPRESSIBLE_PUSH_TYPES` 11. `src/notifications.ts` `setupNotificationHandling` 192-204; the tap listener at 202. `src/app/_layout.tsx` 16. `src/app/index.tsx` restore `.then` 33-38 (`router.replace('/chat/new')` at 35). `src/components/sidebar.tsx` react-native import 4-11; `load` 106-132 (`setRefreshing(true)` at 107); open effect 154-156.
- Plugin: `hermes_mobile/session_notify.py` — `SessionClaimRegistry` 30-59 (`_by_id` 39, `claim` 41-48, `resolve` 50-59), `_DEFAULT_TTL_SECONDS` 27; `on_session_end` 109-141 (resolve at 127, cron branch ~115-126, claimed `_fan_out` at 141); `on_pre_approval_request` 143-160 (resolve at 148); `_tokened_devices` 162-171; `_fan_out` 173-178. `hermes_mobile/plugin_api.py` `SessionClaimBody` 146-149, `claim_session` 151-158 (claim call at 157). `hermes_mobile/push.py` `send` 52-110 (forwards `data` verbatim, 76-77). `hermes_mobile/device_store.py` `get_push_token` 295-302, `list_devices` 304-307. `tests/test_session_notify.py` `RecordingPush` 33-39, fixtures 42-57, representative test 60-68.
- Plugin gate: `PYTHONPATH=/Users/gldc/Developer/hermes-agent python -m pytest tests/test_session_notify.py -q`.

---

# PART A — App repo (`hermes-mobile-app`, branch `feat/cross-surface-sync`)

## Task A1: Pure `routeForPushData`

**Files:**
- Modify: `src/lib/push.ts`
- Test: `__tests__/push.test.ts`

- [ ] **Step 1: Write the failing tests**

In `__tests__/push.test.ts`, add `routeForPushData` to the import from `../src/lib/push`, then add this `describe` block:

```typescript
describe('routeForPushData', () => {
  it('routes to the session when data carries a non-empty session_id', () => {
    expect(routeForPushData({ type: 'session_end', session_id: 'abc' })).toBe('/chat/abc');
    expect(routeForPushData({ type: 'approval_request', session_id: 'S-123' })).toBe('/chat/S-123');
  });
  it('falls back to /chat/new for missing/empty/blank session_id', () => {
    expect(routeForPushData({ type: 'session_end' })).toBe('/chat/new');
    expect(routeForPushData({ session_id: '' })).toBe('/chat/new');
    expect(routeForPushData({ session_id: '   ' })).toBe('/chat/new');
  });
  it('falls back to /chat/new for non-object / nullish / wrong-typed data', () => {
    expect(routeForPushData(undefined)).toBe('/chat/new');
    expect(routeForPushData(null)).toBe('/chat/new');
    expect(routeForPushData('nope')).toBe('/chat/new');
    expect(routeForPushData({ session_id: 42 })).toBe('/chat/new');
  });
  it('trims a padded session_id', () => {
    expect(routeForPushData({ session_id: '  abc  ' })).toBe('/chat/abc');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest __tests__/push.test.ts -t routeForPushData`
Expected: FAIL — `routeForPushData is not a function`.

- [ ] **Step 3: Implement `routeForPushData`**

In `src/lib/push.ts`, after `shouldSuppressForeground` (ends at line 20), add:

```typescript
/** Map a push notification's `data` payload to the route its tap should open.
 * The plugin emits the persistent STORED session id under `session_id` for
 * claimed sessions (docs/contracts/push.md); we deep-link there. Anything
 * missing/blank/malformed (e.g. cron pings, which carry no id) opens the chat
 * home. Defensive parse mirrors shouldSuppressForeground — never throws. */
export function routeForPushData(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '/chat/new';
  const id = (data as Record<string, unknown>).session_id;
  if (typeof id !== 'string') return '/chat/new';
  const trimmed = id.trim();
  return trimmed ? `/chat/${trimmed}` : '/chat/new';
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest __tests__/push.test.ts`
Expected: PASS (existing push tests + the new `routeForPushData` suite).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/push.ts __tests__/push.test.ts
git commit -m "feat(push): routeForPushData — deep-link a push to its session"
```

---

## Task A2: Pass push `data` through the tap + cold-start paths

**Files:**
- Modify: `src/notifications.ts`

This is the Expo/OS surface (glue) — verified on device. The pure routing (`routeForPushData`) is already tested in A1.

- [ ] **Step 1: Widen `setupNotificationHandling`, add cold-start route + double-route guard**

In `src/notifications.ts`, replace the whole `setupNotificationHandling` function (192-204) and its doc comment (187-191) with:

```typescript
// Response identifiers we've already routed, so the cold-start path
// (getColdStartRoute) and the live listener never double-navigate for the
// same tap. Module-level: both share it across the app's lifetime.
const handledResponseIds = new Set<string>();

/** Install the foreground handler (banner, no sound/badge) and the tap
 * listener. Pushes for claimed sessions carry `data.session_id` (the stored
 * route id); `onTap` receives the raw `data` so the caller can deep-link via
 * routeForPushData. Cron/legacy pushes carry no id → caller opens the chat
 * home. Cold-start taps (app was killed) are handled by getColdStartRoute,
 * sequenced after the connect-screen restore. Returns an unsubscribe. */
export function setupNotificationHandling(onTap: (data: unknown) => void): () => void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data;
      if (shouldSuppressForeground(data, AppState.currentState)) {
        return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
      }
      return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
    },
  });
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const id = response.notification.request.identifier;
    if (handledResponseIds.has(id)) return; // already routed by cold-start (or a prior fire)
    handledResponseIds.add(id);
    onTap(response.notification.request.content.data);
  });
  return () => sub.remove();
}

/** Route for the notification that cold-started the app (app was killed when
 * the user tapped), or null if the app wasn't launched from a notification.
 * Marks the response handled so the live listener won't re-route it. Call
 * AFTER the connect-screen restore so its replace() doesn't clobber the target. */
export async function getColdStartRoute(): Promise<string | null> {
  const response = await Notifications.getLastNotificationResponseAsync();
  if (!response) return null;
  handledResponseIds.add(response.notification.request.identifier);
  return routeForPushData(response.notification.request.content.data);
}
```

- [ ] **Step 2: Import `routeForPushData`**

In `src/notifications.ts`, add `routeForPushData` to the existing import from `@/lib/push` (the block at 10-16):

```typescript
import {
  PUSH_TOKEN_ROUTE,
  canJoinInFlight,
  isRegistrationFresh,
  parsePushRegistration,
  routeForPushData,
  shouldSuppressForeground,
} from '@/lib/push';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the only consumer of `setupNotificationHandling` is `_layout.tsx`, updated in A3 — typecheck may flag the arity there; A3 fixes it. If you implement A2 and A3 before the next tsc run, it stays clean. Run tsc again after A3.)

- [ ] **Step 4: Commit**

```bash
git add src/notifications.ts
git commit -m "feat(push): thread push data through tap + cold-start routing"
```

---

## Task A3: Wire deep-link routing in the layout + cold-start restore

**Files:**
- Modify: `src/app/_layout.tsx`
- Modify: `src/app/index.tsx`

Glue — device-verified.

- [ ] **Step 1: Route taps via `routeForPushData` in `_layout.tsx`**

In `src/app/_layout.tsx`, replace the comment + effect (12-16) with:

```tsx
  // Foreground banners; a tap deep-links to the session the push concerns
  // (claimed sessions carry data.session_id), else the chat home. Cold-start
  // taps are handled in the connect screen's restore (index.tsx).
  useEffect(
    () => setupNotificationHandling((data) => router.navigate(routeForPushData(data))),
    [],
  );
```

Add `routeForPushData` to the imports — change the `@/notifications` import (line 6) and add the push import:

```tsx
import { setupNotificationHandling } from '@/notifications';
import { routeForPushData } from '@/lib/push';
```

- [ ] **Step 2: Honor the cold-start deep-link in `index.tsx` restore**

In `src/app/index.tsx`, add `getColdStartRoute` to the `@/notifications` import (line 16):

```tsx
import { getColdStartRoute, maybeRegisterPush } from '@/notifications';
```

Then replace the restore success branch (33-38) so the replace target is the cold-start route when present:

```tsx
      .then(async (ok) => {
        if (ok) {
          // If a notification cold-started the app, land on its session;
          // else the chat home. Sequenced here (after restore) so this
          // replace is the deep-link target, not a clobbered /chat/new.
          const route = (await getColdStartRoute()) ?? '/chat/new';
          router.replace(route as Parameters<typeof router.replace>[0]);
          // Refresh a stale (>7 days) push registration; never prompts here.
          void maybeRegisterPush({ softAsk: false });
        }
      })
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: typecheck clean; all suites pass (no behavior change to tested pure logic; this is glue).

- [ ] **Step 4: Commit**

```bash
git add src/app/_layout.tsx src/app/index.tsx
git commit -m "feat(push): deep-link notification taps to their session (warm + cold start)"
```

---

## Task A4: Sidebar foreground refresh

**Files:**
- Modify: `src/components/sidebar.tsx`

Glue — device-verified. Reuses the existing `load()` (auth-retry + pinned-survivor merge).

- [ ] **Step 1: Add `AppState` to the react-native import**

In `src/components/sidebar.tsx`, add `AppState` to the import block (4-11):

```tsx
import {
  Alert,
  AppState,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
```

- [ ] **Step 2: Add a `silent` option to `load()` (skip the spinner on foreground)**

In `src/components/sidebar.tsx`, change `load`'s signature + first line (106-107) so the foreground path can skip the pull-to-refresh spinner:

```tsx
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setRefreshing(true);
```

(The rest of `load` is unchanged. The open-driven effect and `RefreshControl` keep calling `load()` with no args, so they still show the spinner.)

- [ ] **Step 3: Add the foreground-refresh effect**

In `src/components/sidebar.tsx`, immediately after the open-driven effect (154-156), add:

```tsx
  // Reflect out-of-band activity (web dashboard, another device): when the app
  // returns to the foreground with the drawer open, silently re-pull the list.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && open) load({ silent: true });
    });
    return () => sub.remove();
  }, [open, load]);
```

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: clean; all suites pass.

- [ ] **Step 5: On-device verification (manual, covers A2/A3/A4)**

Run: `npx expo run:ios --device` (or reload if JS hot-reloads). Verify:
1. **Sidebar foreground refresh:** open the drawer, background the app, start/rename a session from the web dashboard, foreground → the list updates with no pull-to-refresh spinner flash.
2. **Warm tap deep-link:** with the app open, trigger a `session_end` push for a claimed session → tapping the banner opens that session (`/chat/<id>`), not `/chat/new`. (Requires PART B deployed; until then the push has no `session_id` and correctly opens the home.)
3. **Cold-start deep-link:** force-quit the app, trigger a claimed `session_end` push, tap it from the lock screen → after restore the app lands on that session (not the home). Tapping a cron/id-less push opens the home.
4. **No double-nav:** a warm tap navigates exactly once; a cold-start tap doesn't re-navigate after landing.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat(sidebar): refresh the session list on app foreground"
```

---

# PART B — Plugin repo (`hermes-mobile-plugin`, branch `feat/push-deeplink`)

> All Part B work happens in `/Users/gldc/Developer/hermes-mobile-plugin`. Gate after each task:
> `PYTHONPATH=/Users/gldc/Developer/hermes-agent python -m pytest tests/test_session_notify.py -q`

## Task B1: Registry retains + returns the canonical route id

**Files:**
- Modify: `hermes_mobile/session_notify.py` (`SessionClaimRegistry`, 30-59)
- Modify: `hermes_mobile/plugin_api.py` (`claim_session`, 151-158)
- Test: `tests/test_session_notify.py`

- [ ] **Step 1: Confirm the only `resolve()` callers**

Run: `grep -rn "\.resolve(" hermes_mobile/`
Expected: only `on_session_end` (`session_notify.py:127`) and `on_pre_approval_request` (`session_notify.py:148`). Both are updated in B2. If any other caller exists, update it there too.

- [ ] **Step 2: Write the failing registry test**

In `tests/test_session_notify.py`, add (uses the existing `_clear_registry` autouse fixture):

```python
def test_registry_returns_canonical_route_id_even_when_matched_on_live_id():
    from hermes_mobile.session_notify import SessionClaimRegistry

    reg = SessionClaimRegistry()
    # App claims with BOTH ids; session_key (STORED) is the route id.
    reg.claim("dev-1", "LIVE-1", "STORED-1", route_id="STORED-1")
    # Resolving on the LIVE id still yields the STORED route id.
    assert reg.resolve("LIVE-1") == ("dev-1", "STORED-1")
    assert reg.resolve("STORED-1") == ("dev-1", "STORED-1")
    assert reg.resolve("nope") is None


def test_registry_route_id_falls_back_to_first_id_when_unspecified():
    from hermes_mobile.session_notify import SessionClaimRegistry

    reg = SessionClaimRegistry()
    reg.claim("dev-2", "ONLY-ID")
    assert reg.resolve("ONLY-ID") == ("dev-2", "ONLY-ID")
```

- [ ] **Step 3: Run to verify they fail**

Run: `PYTHONPATH=/Users/gldc/Developer/hermes-agent python -m pytest tests/test_session_notify.py -q -k canonical_route_id or route_id_falls_back`
Expected: FAIL — `claim()` rejects `route_id`, and `resolve()` returns a bare `device_id` string, not a tuple.

- [ ] **Step 4: Extend the registry**

In `hermes_mobile/session_notify.py`, replace the `SessionClaimRegistry` body (the `_by_id` field 39, `claim` 41-48, `resolve` 50-59) with:

```python
        self._by_id: dict[str, tuple[str, str, float]] = {}

    def claim(self, device_id: str, *ids: Optional[str], route_id: Optional[str] = None) -> None:
        """Bind every id in *ids* to *device_id* and the canonical *route_id*.

        *route_id* is the stored/route session id the app navigates on (its
        `session_key`); when omitted it falls back to the first non-empty id.
        Retaining it lets `on_session_end` (which sees only the live id) emit
        the stored id deterministically.
        """
        if not device_id:
            return
        route = (route_id or next((str(i) for i in ids if i), "")) or ""
        expires = self._clock() + self._ttl
        with self._lock:
            for i in ids:
                if i:
                    self._by_id[str(i)] = (device_id, route, expires)

    def resolve(self, *ids: Optional[str]) -> Optional[tuple[str, str]]:
        """First non-expired match → (device_id, route_id), else None."""
        now = self._clock()
        with self._lock:
            for i in ids:
                if not i:
                    continue
                hit = self._by_id.get(str(i))
                if hit is not None and hit[2] > now:
                    return (hit[0], hit[1])
            return None
```

- [ ] **Step 5: Update the claim route to pass the route id**

In `hermes_mobile/plugin_api.py`, replace the body of `claim_session` (152-158) so the stored `session_key` is the route id:

```python
def claim_session(body: SessionClaimBody, request: Request) -> Dict[str, Any]:
    """Bind the calling device to a session so session-stop hooks can target it."""
    device_id = _require_device_id(request)
    from .session_notify import get_registry

    sid = body.session_id.strip()
    skey = body.session_key.strip()
    # session_key is the persistent/stored id the app routes on; prefer it as
    # the canonical route id, falling back to session_id when absent.
    get_registry().claim(device_id, sid, skey, route_id=(skey or sid))
    return {"ok": True}
```

- [ ] **Step 6: Run to verify pass**

Run: `PYTHONPATH=/Users/gldc/Developer/hermes-agent python -m pytest tests/test_session_notify.py -q -k canonical_route_id or route_id_falls_back`
Expected: PASS. (Other tests in the file will fail until B2 updates the hooks/`_fan_out` and their assertions — that's expected; B2 makes the whole file green.)

- [ ] **Step 7: Commit**

```bash
git add hermes_mobile/session_notify.py hermes_mobile/plugin_api.py tests/test_session_notify.py
git commit -m "feat(notify): registry retains + returns the canonical route id"
```

---

## Task B2: Device-targeted send carrying `session_id`; hooks emit the route id

**Files:**
- Modify: `hermes_mobile/session_notify.py` (`_fan_out` 173-178, `on_session_end` 109-141, `on_pre_approval_request` 143-160)
- Test: `tests/test_session_notify.py`

- [ ] **Step 1: Write the failing tests**

In `tests/test_session_notify.py`, add (mirrors the existing `RecordingPush`/`store`/`_tokened`/`_clear_registry` fixtures):

```python
def test_session_end_emits_stored_id_and_targets_only_the_claiming_device(store):
    # Two devices, each claims a distinct session.
    dev_a = _tokened(store, name="A", token="ExponentPushToken[A]")
    dev_b = _tokened(store, name="B", token="ExponentPushToken[B]")
    push = RecordingPush()
    reg = get_registry()
    reg.claim(dev_a, "LIVE-A", "STORED-A", route_id="STORED-A")
    reg.claim(dev_b, "LIVE-B", "STORED-B", route_id="STORED-B")
    n = SessionNotifier(store=store, push=push, registry=reg)
    # Hook fires with A's LIVE id (what the gateway actually passes).
    n.on_session_end(session_id="LIVE-A", task_id=None, interrupted=False)
    assert len(push.sent) == 1
    assert push.sent[0]["token"] == "ExponentPushToken[A]"  # only A, never B
    assert push.sent[0]["data"] == {"type": "session_end", "session_id": "STORED-A"}


def test_approval_emits_stored_id_and_targets_the_claiming_device(store):
    dev = _tokened(store)
    push = RecordingPush()
    reg = get_registry()
    reg.claim(dev, "LIVE-X", "STORED-X", route_id="STORED-X")
    n = SessionNotifier(store=store, push=push, registry=reg)
    n.on_pre_approval_request(session_key="STORED-X", surface="gateway")
    assert len(push.sent) == 1
    assert push.sent[0]["data"] == {"type": "approval_request", "session_id": "STORED-X"}


def test_session_end_unclaimed_sends_nothing(store):
    _tokened(store)
    push = RecordingPush()
    n = SessionNotifier(store=store, push=push, registry=get_registry())
    n.on_session_end(session_id="UNCLAIMED", task_id=None, interrupted=False)
    assert push.sent == []
```

Update the existing claimed-session test (`test_session_end_pushes_for_claimed_session`, ~60-68) so its claim supplies a route id and its assertion expects the id in `data`:

```python
def test_session_end_pushes_for_claimed_session(store):
    _tokened(store)
    push = RecordingPush()
    get_registry().claim("dev-x", "SID", "SKEY", route_id="SKEY")
    n = SessionNotifier(store=store, push=push, registry=get_registry())
    n.on_session_end(session_id="SID", task_id="SKEY", interrupted=False)
    assert len(push.sent) == 1
    assert push.sent[0]["data"] == {"type": "session_end", "session_id": "SKEY"}
    assert push.sent[0]["body"] == "Your session is ready — tap to check"
```

> If a cron test exists (`_is_cron_run()` path), leave its `data` assertion as `{"type": "session_end"}` — cron stays broadcast and id-free (verified by Step 3 of this task). If it asserts a specific number of sends across N devices, that still holds.

- [ ] **Step 2: Run to verify they fail**

Run: `PYTHONPATH=/Users/gldc/Developer/hermes-agent python -m pytest tests/test_session_notify.py -q -k "stored_id or unclaimed_sends_nothing or pushes_for_claimed"`
Expected: FAIL — `_fan_out` broadcasts and omits `session_id`; the hooks discard the resolved id.

- [ ] **Step 3: Rewrite `_fan_out` (targeted + id) and update both hooks**

In `hermes_mobile/session_notify.py`, replace `_fan_out` (173-178) with:

```python
    def _fan_out(
        self,
        body: str,
        notif_type: str,
        *,
        device_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> None:
        """Send a redacted push. When *device_id* is given (a claimed session),
        target that one device and include the route *session_id* in `data`.
        Otherwise (cron) broadcast to every tokened device with id-less data."""
        data = {"type": notif_type}
        if session_id:
            data["session_id"] = session_id
        if device_id is not None:
            token = self._store.get_push_token(device_id)
            if token:
                try:
                    self._push.send(token, body=body, data=data)
                except Exception:
                    logger.debug("hermes-mobile: push send failed", exc_info=True)
            return
        for d in self._tokened_devices():
            try:
                self._push.send(d["push_token"], body=body, data=data)
            except Exception:
                logger.debug("hermes-mobile: push send failed", exc_info=True)
```

In `on_session_end` (109-141): the cron branch is unchanged in spirit but its final emit must stay broadcast/id-free, while the claimed branch resolves and targets. Replace the resolution + emit so it reads:

```python
        if _is_cron_run():
            if _already_delivered_to_mobile():
                logger.debug(
                    "hermes-mobile: session-notify cron end already delivered to "
                    "mobile; skipping"
                )
                return
            logger.debug("hermes-mobile: session-notify cron end -> notifying devices")
            self._fan_out(SESSION_END_BODY, "session_end")  # broadcast, no id
            return

        hit = self._registry.resolve(session_id, task_id)
        if hit is None:
            logger.debug(
                "hermes-mobile: session-notify session end unclaimed "
                "(session_id=%s task_id=%s); skipping",
                session_id,
                task_id,
            )
            return
        device_id, route_id = hit
        logger.debug(
            "hermes-mobile: session-notify session end claimed by device %s "
            "-> notifying",
            device_id,
        )
        self._fan_out(SESSION_END_BODY, "session_end", device_id=device_id, session_id=route_id)
```

> This restructures the original `if cron: … else: resolve` (115-141) into `if cron: …; return` followed by the claimed path, so each branch ends in its own `_fan_out`. Preserve the existing `_already_delivered_to_mobile()` guard and log lines verbatim.

In `on_pre_approval_request` (143-160), replace the resolve + emit:

```python
        hit = self._registry.resolve(session_key)
        if hit is None:
            logger.debug(
                "hermes-mobile: session-notify approval unclaimed "
                "(session_key=%s); skipping",
                session_key,
            )
            return
        device_id, route_id = hit
        logger.debug(
            "hermes-mobile: session-notify approval claimed by device %s -> notifying",
            device_id,
        )
        self._fan_out(APPROVAL_BODY, "approval_request", device_id=device_id, session_id=route_id)
```

- [ ] **Step 4: Run the full plugin notify suite**

Run: `PYTHONPATH=/Users/gldc/Developer/hermes-agent python -m pytest tests/test_session_notify.py -q`
Expected: PASS (all pre-existing tests + the new B1/B2 tests). If `test_already_delivered_reads_session_context_not_os_environ` fails, confirm `PYTHONPATH` points at the hermes-agent checkout (it needs `gateway.session_context`).

- [ ] **Step 5: Commit**

```bash
git add hermes_mobile/session_notify.py tests/test_session_notify.py
git commit -m "feat(notify): device-targeted push carrying the route session_id"
```

---

## Self-Review (completed during authoring)

**Spec coverage (§6):**
- §6a sidebar foreground refresh → Task A4 (`AppState` effect + `load({silent})`, reuses `load()`).
- §6b app: `routeForPushData` → A1; widen `setupNotificationHandling` + cold-start `getLastNotificationResponseAsync` (required) → A2; `_layout.tsx` rewire + `index.tsx` cold-start sequencing after restore (resolves open Q#4) → A3; `chat/[id].tsx` unchanged (route param `id` is already the stored id) → respected (no task).
- §6b plugin: emit STORED id (registry extension, option ii — resolves §8 #1 by construction) → B1; device-targeted send via `get_push_token` + `data.session_id`, cron stays broadcast/id-free → B2.
- §6b Tests: app `routeForPushData` truth table → A1; plugin emitted-id-==-STORED + two-device isolation (required) → B2; registry route-id retention → B1.
- §6 live/running status → correctly NOT attempted (server-required; out of scope per §6/§2).

**Deferred / verify-on-device (documented, not silently dropped):**
- **Approval deep-link landing (spec §8 #5):** the push now carries the correct `session_id`, but whether the approval *card* reappears depends on the gateway re-emitting pending approvals on `session.resume`. Worst case the user lands on the correct session instead of `/chat/new` (strictly better) without the live prompt. Verify on device; a follow-up can add pending-approval fetch/replay. Not blocking — within the "claimed-only + device-targeted" locked decision.
- **Cold-start ordering (Expo SDK 56):** A2/A3 guard double-routing with `handledResponseIds` and both paths converge on the same `/chat/<id>` target, so a race can only cause a redundant (idempotent) navigation, never a clobber to `/chat/new`. Verify the exact `getLastNotificationResponseAsync` vs. live-listener ordering on device (A4 Step 5 #3/#4).
- **`SessionClaimRegistry` TTL/restart:** in-process, 24h TTL → a gateway restart or >24h gap drops the claim and the deep link falls back to `/chat/new` (pre-existing bound, not introduced here).

**Placeholder scan:** none — every code step has complete code; every run step has the command + expected result.

**Type/name consistency:** `routeForPushData(data: unknown): string` defined in A1, consumed in A2 (`getColdStartRoute`) and A3 (`_layout.tsx`). `setupNotificationHandling(onTap: (data: unknown) => void)` redefined in A2, consumed in A3. `getColdStartRoute` defined in A2, consumed in A3. Registry `claim(device_id, *ids, route_id=)` / `resolve(*ids) -> (device_id, route_id)` defined in B1, consumed in B1 (`plugin_api.py`) and B2 (both hooks). `_fan_out(body, notif_type, *, device_id=, session_id=)` defined in B2, consumed in both hooks (B2) and the cron branch (broadcast form).

---

## Execution

PR per repo, gated before opening:
- App: `npx tsc --noEmit && npx jest`, PR `feat/cross-surface-sync` → `hermes-mobile-app` `main`.
- Plugin: `PYTHONPATH=/Users/gldc/Developer/hermes-agent python -m pytest tests/test_session_notify.py -q`, PR `feat/push-deeplink` → `hermes-mobile-plugin` `main`.

Ship the plugin PR alongside/just before the app PR — the app's deep-link is inert (correctly falls back to `/chat/new`) until the plugin emits `data.session_id`.
