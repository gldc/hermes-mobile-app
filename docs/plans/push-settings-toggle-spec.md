# Tappable Notifications Row in Settings — Specification

**Date:** 2026-06-15
**Status:** Draft
**Owner:** [@gldc](https://github.com/gldc)
**Branch:** `feat/push-settings-toggle`

---

## 1. Overview

The Notifications row in the Settings screen currently displays a static status
label ("Off", "On", "Retrying", etc.) with no interaction. If the user dismisses
the soft-ask dialog during QR pairing, or denies the OS prompt, there is no way
to re-trigger the permission request — the only recovery is to re-pair the
device entirely.

This feature makes the Notifications row **tappable**, with behavior that adapts
to the current push state:

| Push state | Row label | Tap behavior |
|---|---|---|
| `idle` (not yet asked) | "Off" | Show soft-ask dialog → OS prompt → register |
| `registered` | "On" | No action (row is not tappable) |
| `denied` + `canAskAgain` | "Off" | OS prompt directly → register |
| `denied` + `!canAskAgain` | "Off" + note | Open iOS Settings app |
| `no-project-id` | "Not set up" | No action (row is not tappable) |
| `unavailable` | "Unavailable" | No action (row is not tappable) |
| `error` | "Retrying" | Re-trigger `maybeRegisterPush({ softAsk: true })` |

### 1.1 Goals

- User can enable notifications from Settings without re-pairing.
- If the OS permission was denied, tapping opens the iOS Settings app
  (`Linking.openSettings()`) so the user can toggle it on manually.
- The status label and note update reactively after the action completes.
- A brief loading indicator shows while registration is in progress.

### 1.2 Non-goals

- **Disabling notifications** from the app. The "registered" state row stays
  read-only. Disabling is done in iOS Settings (or by disconnecting).
- **Push deep links** (tap notification → specific chat). Blocked on gateway
  adding `data` payload to push.py.
- **Mailbox drain + display** (inbox UI). Separate milestone.

---

## 2. Architecture

### 2.1 Data flow

```
┌──────────────┐    tap     ┌──────────────────┐   permission   ┌──────────────┐
│  settings.tsx │ ────────► │ notifications.ts  │ ──────────────►│ iOS Settings │
│  (UI action)  │ ◄──────── │ (push status)     │                │ or OS prompt │
└──────────────┘  setPush   └──────────────────┘                └──────────────┘
```

### 2.2 Changes to `src/notifications.ts`

**Add `canAskAgain` to `PushStatus`:**

```ts
export interface PushStatus {
  state: 'idle' | 'registered' | 'denied' | 'no-project-id' | 'unavailable' | 'error';
  note?: string;
  /** Whether the OS permission prompt can still be shown. `true` when the
   *  user hasn't seen the OS dialog yet (idle, error); `false` when they
   *  denied at the OS level and must go to Settings to re-enable. Undefined
   *  for states where the concept doesn't apply (registered, unavailable). */
  canAskAgain?: boolean;
}
```

Set `canAskAgain` at **every** status assignment point:
- `idle` → `canAskAgain: true` (OS prompt still available)
- `denied` → `canAskAgain: false` (three denial points: line ~94, ~98, ~107)
- `error` → `canAskAgain: true` (retry makes sense)
- `registered`, `unavailable`, `no-project-id` → omitted (not applicable)

**Add re-entrancy guard to `maybeRegisterPush`:**

```ts
let inFlight: Promise<void> | null = null;

export async function maybeRegisterPush(opts: { softAsk: boolean }): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    // ... existing body ...
  })();
  try { await inFlight; } finally { inFlight = null; }
}
```

This prevents concurrent calls (app-start + settings tap) from corrupting the
shared `status` variable.

**Export `requestPushPermission()`:**

```ts
/** Re-attempt push registration with permission prompt. Returns a copy of
 *  the resulting status (callers get a snapshot, not a mutable reference). */
export async function requestPushPermission(): Promise<PushStatus> {
  await maybeRegisterPush({ softAsk: true });
  return { ...status };
}
```

Returns a **copy** of `status` — not the module-level reference — so later
mutations of `status` don't bleed into a previously returned snapshot.

> **`canOpenSystemSettings()` was removed** during adversarial review — it
> read the module-level `status` (potentially stale) while the UI should
> check its own React state. The tap handler inlines the check instead.

### 2.3 Changes to `src/app/settings.tsx`

**Make push status reactive:**

Change `const [push] = useState(...)` to `const [push, setPush] = useState(...)`
so the row can update after a tap action.

**Make the Notifications row tappable:**

Replace the `<Row>` component for Notifications with a new `<PushRow>` that
renders as a `<Pressable>` when the state allows interaction, and as a static
`<View>` otherwise.

**Tap handler logic:**

```ts
const mounted = useRef(true);
useEffect(() => () => { mounted.current = false; }, []);
const [registering, setRegistering] = useState(false);

async function onNotificationsTap() {
  if (push.state === 'denied' && push.canAskAgain === false) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Linking.openSettings();
    // Re-check OS permission — user may have enabled in Settings.
    const perms = await Notifications.getPermissionsAsync();
    if (perms.granted) {
      setRegistering(true);
      const result = await requestPushPermission();
      if (mounted.current) { setPush(result); setRegistering(false); }
    } else if (mounted.current) {
      setPush(getPushStatus()); // still denied
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

Key fixes from adversarial review:
- **OS re-check after Settings return** — without this, the user who enables
  notifications in iOS Settings gets stuck in an infinite "open Settings" loop
- **`mounted` ref** — prevents state updates on unmounted component if user
  navigates away during the async registration
- **Error haptic** — tactile feedback on failure, not just success

**Loading indicator:**

When `registering` is true, the row shows a small `ActivityIndicator` (from
`react-native`) in place of the status label. This gives the user feedback
that the OS permission dialog or token fetch is in progress.

### 2.4 New import: `Linking` from `react-native`

`Linking.openSettings()` opens the iOS Settings app to the app's own
permissions page. It's part of `react-native` — no new dependency. Already
used by other Expo apps; no native rebuild required.

---

## 3. UI Changes

### 3.1 Notifications row appearance

```
┌─────────────────────────────────────────────┐
│  Gateway          http://100.67.102.57:9119 │
│─────────────────────────────────────────────│
│  Device                    d98ec036bbe95799 │
│─────────────────────────────────────────────│
│  Notifications                    Off  ›    │  ← tappable, chevron added
│─────────────────────────────────────────────│
│  Version                              1.0.0 │
└─────────────────────────────────────────────┘
```

**Visual changes:**
- A `>` chevron appears on the right when the row is tappable (same as `NavRow`)
- The status label becomes the accent color when tappable (visual affordance)
- When `registering` is true, an `ActivityIndicator` replaces the label
- When `state === 'registered'`, no chevron — row is read-only

### 3.2 Row component

```tsx
function PushRow({
  push,
  registering,
  onTap,
}: {
  push: PushStatus;
  registering: boolean;
  onTap: () => void;
}) {
  const { colors } = useTheme();
  const tappable = push.state !== 'registered'
    && push.state !== 'no-project-id'
    && push.state !== 'unavailable';
  const label = pushLabel(push);

  const content = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, gap: 16 }}>
      <Text style={{ color: colors.textDim, fontSize: 15 }}>Notifications</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
        {registering ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Text
            selectable={!tappable}
            numberOfLines={1}
            style={{ color: tappable ? colors.accent : colors.text, fontSize: 15, flexShrink: 1 }}
          >
            {label}
          </Text>
        )}
        {tappable && !registering ? (
          <Icon sf="chevron.right" size={13} color={colors.textFaint} />
        ) : null}
      </View>
    </View>
  );

  if (!tappable) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Notifications: ${label}. Tap to ${push.state === 'denied' && push.canAskAgain === false ? 'open system settings' : 'enable'}`}
      onPress={onTap}
      disabled={registering}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.raised : 'transparent',
      })}
    >
      {content}
    </Pressable>
  );
}
```

### 3.3 Haptics

- **Tap (enable path):** `Haptics.selectionAsync()` — light tap, same as other interactive rows
- **Tap (open settings path):** `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)` — signals navigation away from the app
- **Registration success:** `Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)` — fired inside `maybeRegisterPush` already (no, actually it isn't — add it in the settings tap handler after `result.state === 'registered'`)

---

## 4. Edge Cases

### 4.1 User returns from iOS Settings after enabling

After `Linking.openSettings()`, the tap handler re-checks
`Notifications.getPermissionsAsync()`. If granted, it proceeds with
`requestPushPermission()` to register the token — the row transitions from
"Off" to "On" without requiring an app restart.

If the user returns without enabling, the permission check returns `!granted`
and `setPush(getPushStatus())` keeps the row showing "Off." The user can tap
again to re-open Settings — no dead-end loop.

### 4.2 Rapid tapping

The `registering` boolean disables the `Pressable` (`disabled={registering}`),
preventing double-taps while registration is in flight. The `inFlight` mutex
in `maybeRegisterPush` provides a second layer of protection.

### 4.3 Soft-ask dismissal

If the user taps the row, sees the soft-ask dialog, and taps "Not now,"
`maybeRegisterPush` returns with `status.state === 'idle'`. The row stays
tappable — the user can try again later.

### 4.4 Network failure during registration

If `getExpoPushTokenAsync` or the `POST /push-token` fails, the status
becomes `{ state: 'error', note: '...' }`. The row shows "Retrying" and
remains tappable — the user can tap to try again.

### 4.5 App foregrounded after settings change

When the user opens iOS Settings and toggles notifications on, then returns
to the app, the push status is stale. On next app-start, `maybeRegisterPush({ softAsk: false })` will detect the granted permission and register the token automatically. The user doesn't need to tap the row again.

---

## 5. Testing

### 5.1 Unit tests

The pure logic changes are minimal:

- `canOpenSystemSettings()` — returns true only when `state === 'denied'` AND `canAskAgain === false`
- `requestPushPermission()` — calls `maybeRegisterPush({ softAsk: true })` and returns the status

Since `notifications.ts` has heavy Expo/OS dependencies (no injected I/O),
these are best tested on-device. The existing `__tests__/push.test.ts` covers
the pure logic in `src/lib/push.ts` which is unchanged.

### 5.2 On-device verification

- Settings → Notifications row shows "Off" with chevron (tappable)
- Tap → soft-ask dialog appears
- Dismiss soft-ask → row stays "Off" with chevron
- Tap again → soft-ask → Enable → OS prompt → Allow → row shows "On"
- Kill and restart → row still shows "On"
- Manually disable in iOS Settings → restart app → row shows "Off"
- Tap → OS prompt directly (skips soft-ask since permission was previously granted then revoked... actually `canAskAgain` would be false) → row shows "Off" + note, tap opens iOS Settings
- From iOS Settings, enable → return to app → tap row → registers successfully → "On"

---

## 6. File changes summary

| File | Change |
|------|--------|
| `src/notifications.ts` | Add `canAskAgain` to `PushStatus` (set at every assignment point); add `inFlight` mutex to `maybeRegisterPush`; export `requestPushPermission()` (returns copy) |
| `src/app/settings.tsx` | Add `Linking`, `ActivityIndicator`, `Haptics`, `Notifications` imports; add `PushRow` component; make Notifications row tappable with state-dependent behavior; add `registering` loading state; add `mounted` ref for cleanup; hide note while registering |

No new files. No new dependencies (`Linking`, `ActivityIndicator` are from
`react-native`; `Haptics` from `expo-haptics`; `Notifications` from
`expo-notifications` — all already in the project). No changes to
`connection.ts`, `src/lib/push.ts`, or any test files. No server-side changes.
