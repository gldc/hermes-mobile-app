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

**Add a soft-ask-aware re-entrancy guard to `maybeRegisterPush`:**

The body moves into a `registerPushImpl(opts)` helper that mutates `status`;
`maybeRegisterPush` wraps it to serialize callers and resolve with the status
the run produced.

```ts
// canJoinInFlight(inFlightSoftAsk, requestSoftAsk) lives in src/lib/push.ts
// (pure + unit-tested): coalesce only when the in-flight run is at least as
// strong as the new request.
let inFlight: Promise<PushStatus> | null = null;
let inFlightSoftAsk = false;

export async function maybeRegisterPush(opts: { softAsk: boolean }): Promise<PushStatus> {
  if (inFlight && canJoinInFlight(inFlightSoftAsk, opts.softAsk)) return inFlight;
  if (inFlight) await inFlight.catch(() => {}); // stronger request waits out the weaker run
  inFlightSoftAsk = opts.softAsk;
  inFlight = (async () => { await registerPushImpl(opts); return status; })();
  try { return await inFlight; } finally { inFlight = null; inFlightSoftAsk = false; }
}
```

A naive `if (inFlight) return inFlight` guard would let an app-start
`softAsk:false` run (which never prompts) satisfy a settings-tap `softAsk:true`
caller, silently swallowing the OS dialog. Coalescing only onto an
equal-or-stronger run prevents that; a soft-ask arriving mid app-start waits the
weaker run out, then starts a fresh prompting run.

**Export `requestPushPermission()`:**

```ts
/** Re-attempt push registration with permission prompt. Returns a copy of
 *  the status THIS run produced (not a re-read of the module-level `status`,
 *  which a coalesced run could own). */
export async function requestPushPermission(): Promise<PushStatus> {
  return { ...(await maybeRegisterPush({ softAsk: true })) };
}
```

Returns a **copy** of the status the run resolved with — not a post-await
re-read of the module-level reference — so a coalesced or later-mutated
`status` can't bleed into a previously returned snapshot.

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

// OS-denied recovery: the only way back is the system Settings app, so re-check
// permission when the app returns to the foreground. Linking.openSettings()
// resolves when iOS *switches* apps, not when the user returns — a synchronous
// re-check after it would read the pre-toggle (still-denied) value — so the
// AppState 'active' edge is the real "user came back" signal.
useEffect(() => {
  if (push.state !== 'denied') return;
  const sub = AppState.addEventListener('change', async (next) => {
    if (next !== 'active') return;
    let started = false;
    try {
      const perms = await Notifications.getPermissionsAsync();
      if (!perms.granted || !mounted.current) return;
      started = true;
      setRegistering(true);
      const result = await requestPushPermission();
      if (mounted.current) setPush(result);
    } catch {
      if (mounted.current) setPush(getPushStatus());
    } finally {
      if (started && mounted.current) setRegistering(false);
    }
  });
  return () => sub.remove();
}, [push.state]);

async function onNotificationsTap() {
  if (push.state === 'denied' && push.canAskAgain === false) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Hand off to iOS Settings; the AppState 'active' listener re-registers if
    // the user flips the toggle and returns.
    try { await Linking.openSettings(); } catch { /* no settings deep-link available */ }
    return;
  }
  void Haptics.selectionAsync().catch(() => {});
  setRegistering(true);
  try {
    const result = await requestPushPermission();
    if (mounted.current) {
      setPush(result);
      if (result.state === 'registered') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else if (result.state === 'error') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
    }
  } finally {
    if (mounted.current) setRegistering(false);
  }
}
```

Key points (revised during implementation / adversarial review):
- **Foreground re-check, not a synchronous one.** `Linking.openSettings()`
  resolves when iOS switches apps, so re-checking permission immediately after
  it reads the stale (pre-toggle) value and never registers on return. An
  `AppState 'active'` listener — active only while `state === 'denied'` — is the
  real "user came back" signal and re-registers once permission flips to
  granted. (The earlier draft's "synchronous re-check prevents an infinite
  open-Settings loop" reasoning was wrong: there is no loop; the re-check simply
  never fired at the right moment.)
- **`registering` reset in `finally`** on both tap branches and the listener, so
  the spinner always clears even if an await throws.
- **`mounted` ref** — prevents state updates after the component unmounts mid
  registration.
- **Unawaited haptics are `void …​.catch(() => {})`** — no unhandled-rejection
  warnings on devices without a Taptic engine, and the deny-path impact no
  longer depends on the surrounding try/catch.

**Loading indicator:**

When `registering` is true, the row shows a small `ActivityIndicator` (from
`react-native`) in place of the status label. This gives the user feedback
that the OS permission dialog or token fetch is in progress.

### 2.4 New imports: `Linking` and `AppState` from `react-native`

`Linking.openSettings()` opens the iOS Settings app to the app's own
permissions page. `AppState` drives the foreground re-check after the user
returns from Settings (§2.3). Both are part of `react-native` — no new
dependency, no native rebuild required.

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

Tapping the row only opens iOS Settings. An `AppState 'active'` listener
(registered while `state === 'denied'`) re-checks
`Notifications.getPermissionsAsync()` when the app returns to the foreground; if
granted, it calls `requestPushPermission()` and the row transitions "Off" → "On"
with no app restart and no second tap.

If the user returns without enabling, the foreground check is `!granted` and the
row stays "Off." (A synchronous re-check right after `openSettings()` would not
work: that call resolves when iOS *switches* apps, before the user has toggled
anything.)

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

When the user toggles notifications on in iOS Settings and returns, the Settings
screen's `AppState 'active'` listener (§4.1) re-registers immediately — no app
restart needed. Even if the Settings screen is not mounted, the next app-start
`maybeRegisterPush({ softAsk: false })` detects the granted permission and
registers the token automatically.

---

## 5. Testing

### 5.1 Unit tests

The coalescing decision is extracted into a pure helper and unit-tested:

- `canJoinInFlight(inFlightSoftAsk, requestSoftAsk)` in `src/lib/push.ts` —
  covered by `__tests__/push.test.ts`: a soft-ask tap must NOT join an in-flight
  app-start run; equal-or-stronger runs coalesce.

The rest of `notifications.ts` has heavy Expo/OS dependencies (no injected I/O),
and the `settings.tsx` AppState/tap flow is screen glue — both are verified
on-device per the repo convention.

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
| `src/lib/push.ts` | Add pure `canJoinInFlight()` coalescing-decision helper |
| `src/notifications.ts` | Add `canAskAgain` to `PushStatus` (set at every assignment point); split body into `registerPushImpl`; soft-ask-aware `inFlight` guard via `canJoinInFlight`; `maybeRegisterPush` resolves with the produced `PushStatus`; `requestPushPermission()` returns that snapshot |
| `src/app/settings.tsx` | Add `AppState`, `Linking`, `ActivityIndicator`, `Haptics`, `Notifications` imports; add `PushRow` component; make Notifications row tappable with state-dependent behavior; `AppState 'active'` listener for the deny → Settings → return path; `registering` loading state reset in `finally`; `mounted` ref for cleanup; hide note while registering |
| `__tests__/push.test.ts` | Add `canJoinInFlight` cases |

No new files. No new dependencies (`AppState`, `Linking`, `ActivityIndicator`
from `react-native`; `Haptics` from `expo-haptics`; `Notifications` from
`expo-notifications` — all already in the project). No `connection.ts` or
server-side changes.
