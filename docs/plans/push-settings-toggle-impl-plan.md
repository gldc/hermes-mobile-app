# Push Settings Toggle — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the Notifications row in Settings tappable to enable/re-enable push notifications without re-pairing.

**Architecture:** Add `canAskAgain` to `PushStatus`, add re-entrancy guard to `maybeRegisterPush`, export `requestPushPermission()` from `notifications.ts`, and replace the static `<Row>` in settings with a tappable `<PushRow>`.

**Tech Stack:** React Native (`Linking`, `ActivityIndicator`), Expo SDK 56, TypeScript.

**Spec:** `docs/plans/push-settings-toggle-spec.md`.

---

### Task 1: Extend push API in `notifications.ts`

**Objective:** Add `canAskAgain`, re-entrancy guard, and `requestPushPermission()` export.

**Files:**
- Modify: `src/notifications.ts`

**Step 1: Add `canAskAgain` to `PushStatus` interface**

Add the field with JSDoc:
```ts
  canAskAgain?: boolean;
```

**Step 2: Set `canAskAgain` at every status assignment point**

- Line ~93 (app-start, idle, can ask): `status = perms.canAskAgain ? { state: 'idle', canAskAgain: true } : { state: 'denied', ..., canAskAgain: false }`
- Line ~102 (soft-ask dismissed): `status = { state: 'idle', canAskAgain: true }`
- Line ~98 (can't ask again): `status = { state: 'denied', ..., canAskAgain: false }`
- Line ~107 (OS prompt denied): `status = { state: 'denied', ..., canAskAgain: false }`
- Line ~139 (error): `status = { state: 'error', ..., canAskAgain: true }`

**Step 3: Add re-entrancy guard to `maybeRegisterPush`**

Add module-level `let inFlight: Promise<void> | null = null;` and wrap the function body:
```ts
export async function maybeRegisterPush(opts: { softAsk: boolean }): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    // ... existing body (try/catch) ...
  })();
  try { await inFlight; } finally { inFlight = null; }
}
```

**Step 4: Add `requestPushPermission()` export**

After `getPushStatus()`:
```ts
export async function requestPushPermission(): Promise<PushStatus> {
  await maybeRegisterPush({ softAsk: true });
  return { ...status };
}
```

**Step 5: Verify**

```bash
npx tsc --noEmit && npx jest
```

**Step 6: Commit**

```bash
git add src/notifications.ts
git commit -m "feat(notifications): add canAskAgain, re-entrancy guard, requestPushPermission"
```

---

### Task 2: Make Notifications row tappable in Settings

**Objective:** Replace static `<Row>` with interactive `<PushRow>` component.

**Files:**
- Modify: `src/app/settings.tsx`

**Step 1: Add imports**

Add to `react-native` import: `ActivityIndicator, Linking`
Add new imports:
```ts
import { useRef } from 'react';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { getPushStatus, requestPushPermission, type PushStatus } from '@/notifications';
```
(Remove old `getPushStatus` import to avoid duplication.)

**Step 2: Add `PushRow` component** (before `SettingsScreen`)

Per spec §3.2 — renders as `<Pressable>` when tappable, static `<View>` otherwise. Shows `ActivityIndicator` when `registering` is true. Chevron on tappable rows.

**Step 3: Update SettingsScreen state**

```ts
const mounted = useRef(true);
useEffect(() => () => { mounted.current = false; }, []);
const [push, setPush] = useState<PushStatus>(() => getPushStatus());
const [registering, setRegistering] = useState(false);
```

**Step 4: Add tap handler**

```ts
async function onNotificationsTap() {
  if (push.state === 'denied' && push.canAskAgain === false) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Linking.openSettings();
    const perms = await Notifications.getPermissionsAsync();
    if (perms.granted) {
      setRegistering(true);
      const result = await requestPushPermission();
      if (mounted.current) { setPush(result); setRegistering(false); }
    } else if (mounted.current) {
      setPush(getPushStatus());
    }
    return;
  }
  Haptics.selectionAsync();
  setRegistering(true);
  const result = await requestPushPermission();
  if (mounted.current) {
    setPush(result);
    setRegistering(false);
    if (result.state === 'registered') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (result.state === 'error') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }
}
```

**Step 5: Replace Notifications row in JSX**

Replace `<Row label="Notifications" value={pushLabel(push)} />` with:
```tsx
<PushRow push={push} registering={registering} onTap={onNotificationsTap} />
```

**Step 6: Hide note while registering**

Change `{deviceMode && push.note ? (` to `{deviceMode && push.note && !registering ? (`

**Step 7: Verify**

```bash
npx tsc --noEmit && npx jest
```

**Step 8: Commit**

```bash
git add src/app/settings.tsx
git commit -m "feat(settings): tappable Notifications row with state-dependent behavior"
```

---

### Task 3: Final verification

```bash
npx tsc --noEmit && npx jest
git diff --stat main
```

---

## Task Dependency Graph

```
Task 1 (notifications.ts API)
  └── Task 2 (settings UI)
        └── Task 3 (verify)
```

All sequential. Total: 2 files changed.
