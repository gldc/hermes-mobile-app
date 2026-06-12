# Android Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the iOS-first Hermes Mobile app to full functional parity on Android, with zero behavior change on iOS.

**Architecture:** Every change is platform-gated with build-time `process.env.EXPO_OS` checks so Metro dead-code-eliminates the other platform's path. The iOS branch of every conditional is byte-for-byte the current code. One branch (`feat/android-parity`), one commit per task, sequential execution (tasks share the working tree).

**Tech Stack:** Expo SDK 56, expo-router, Reanimated 4, expo-image (`sf:` on iOS), `@expo/vector-icons` MaterialCommunityIcons (Android only), expo-notifications.

**Verification baseline (must not regress):** 279 jest tests green, `tsc --noEmit` clean, `expo lint` has exactly 10 pre-existing errors + 1 warning (thinking-dots, memory-file, models, skills/[name], sidebar×2 inherited) — do not add new ones.

**Hard rules for all tasks:**
- iOS rendering path must remain identical. When in doubt, gate with `process.env.EXPO_OS === 'ios'` and put the existing code in the iOS branch.
- Use `process.env.EXPO_OS`, never `Platform.OS` (build-time elimination; established convention).
- Run `npx jest --silent && npx tsc --noEmit` before every commit. Run `npx expo lint` and compare against the baseline.
- Commit on the current branch (`feat/android-parity`). Do NOT push. Do NOT switch branches.
- Commit messages: conventional commits, end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Cross-platform Icon component + SF→Material mapping

**Files:**
- Create: `src/lib/icon-map.ts`
- Create: `src/components/icon.tsx`
- Test: `src/__tests__/icon-map.test.ts`
- Modify: `package.json` (add `@expo/vector-icons`)

- [ ] **Step 1: Install the dependency**

Run: `npx expo install @expo/vector-icons`

- [ ] **Step 2: Write the failing tests**

```ts
// src/__tests__/icon-map.test.ts
import fs from 'fs';
import path from 'path';
import { SF_TO_MATERIAL } from '@/lib/icon-map';
// Glyphmap ships inside @expo/vector-icons; this path is stable for the MCI set.
import glyphmap from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';

/** Every Material name we map to must actually exist in the font. */
test('every mapped material icon exists in the MCI glyphmap', () => {
  for (const [sf, material] of Object.entries(SF_TO_MATERIAL)) {
    expect({ sf, material, exists: material in glyphmap }).toEqual({ sf, material, exists: true });
  }
});

/** Every sf: symbol used anywhere in src/ must have an Android mapping. */
test('every sf: symbol used in the app has a mapping', () => {
  const root = path.join(__dirname, '..');
  const used = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name) && !p.includes('__tests__')) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/['"`]sf:([a-z0-9._]+)['"`]/g)) {
          used.add(m[1]);
        }
      }
    }
  };
  walk(root);
  expect(used.size).toBeGreaterThan(0);
  for (const sf of used) {
    expect({ sf, mapped: sf in SF_TO_MATERIAL }).toEqual({ sf, mapped: true });
  }
});
```

NOTE: if the glyphmap import path differs in the installed version, find it with
`ls node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/ | grep -i materialcommunity` and adjust. If jest cannot import JSON from node_modules with the current config, read it with `fs.readFileSync(require.resolve(...))` instead.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest icon-map -t mapped`
Expected: FAIL (module `@/lib/icon-map` not found)

- [ ] **Step 4: Write the mapping**

```ts
// src/lib/icon-map.ts
/** SF Symbol name (without the `sf:` prefix) → MaterialCommunityIcons name.
 * Android-only; iOS renders SF Symbols natively via expo-image. */
export const SF_TO_MATERIAL: Record<string, string> = {
  'archivebox': 'archive-outline',
  'archivebox.fill': 'archive',
  'arrow.down.circle': 'arrow-down-circle-outline',
  'arrow.up': 'arrow-up',
  'books.vertical': 'bookshelf',
  'brain': 'brain',
  'bubble.left.and.bubble.right': 'forum-outline',
  'calendar.badge.plus': 'calendar-plus',
  'camera.fill': 'camera',
  'checkmark': 'check',
  'checkmark.circle.fill': 'check-circle',
  'checkmark.seal.fill': 'check-decagram',
  'chevron.down': 'chevron-down',
  'chevron.right': 'chevron-right',
  'chevron.up': 'chevron-up',
  'clock.arrow.2.circlepath': 'autorenew',
  'clock.arrow.circlepath': 'history',
  'cpu': 'chip',
  'doc.text': 'file-document-outline',
  'exclamationmark.shield.fill': 'shield-alert',
  'gearshape': 'cog-outline',
  'hammer.fill': 'hammer',
  'key': 'key-variant',
  'line.3.horizontal': 'menu',
  'magnifyingglass': 'magnify',
  'pencil': 'pencil',
  'person.crop.circle': 'account-circle-outline',
  'photo.on.rectangle': 'image-multiple-outline',
  'play.circle.fill': 'play-circle',
  'plus': 'plus',
  'qrcode.viewfinder': 'qrcode-scan',
  'questionmark.circle': 'help-circle-outline',
  'questionmark.folder': 'folder-question-outline',
  'slash.circle': 'cancel',
  'sparkles': 'creation',
  'square.and.arrow.up': 'export-variant',
  'square.and.pencil': 'square-edit-outline',
  'trash.fill': 'delete',
  'tray.and.arrow.up.fill': 'tray-arrow-up',
  'xmark': 'close',
  'xmark.circle.fill': 'close-circle',
};
```

If a glyphmap assertion fails for any name, search the glyphmap for the closest match
(`grep -o '"[a-z-]*<keyword>[a-z-]*"' <glyphmap>`) and substitute — visual closeness to the SF original is the criterion.

- [ ] **Step 5: Write the Icon component**

```tsx
// src/components/icon.tsx
import { Image } from 'expo-image';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { SF_TO_MATERIAL } from '@/lib/icon-map';

const isIOS = process.env.EXPO_OS === 'ios';
// Build-time branch: Metro strips this require (and the MCI font) from iOS bundles.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MaterialCommunityIcons = isIOS ? null : require('@expo/vector-icons/MaterialCommunityIcons').default;

/** Cross-platform icon. iOS: native SF Symbol via expo-image (identical to the
 * previous inline usage). Android: MaterialCommunityIcons equivalent. */
export function Icon({
  sf,
  size = 20,
  width,
  height,
  color,
  style,
}: {
  sf: string;
  size?: number;
  /** Override for non-square SF symbols; Android uses max(width, height). */
  width?: number;
  height?: number;
  color?: string;
  style?: StyleProp<ViewStyle & TextStyle>;
}) {
  const w = width ?? size;
  const h = height ?? size;
  if (isIOS) {
    return <Image source={`sf:${sf}`} style={[{ width: w, height: h }, style]} tintColor={color} />;
  }
  return (
    <MaterialCommunityIcons
      name={SF_TO_MATERIAL[sf] ?? 'help-circle-outline'}
      size={Math.max(w, h)}
      color={color}
      style={style}
    />
  );
}
```

- [ ] **Step 6: Run the full suite** — `npx jest --silent && npx tsc --noEmit`. Expected: all green (281 tests).

- [ ] **Step 7: Commit** — `feat(android): cross-platform Icon component with SF→Material mapping`

---

### Task 2: Sweep all sf: call sites to `<Icon>`

**Files (all that contain `sf:` literals):** `src/app/index.tsx`, `src/app/pair.tsx`, `src/app/settings.tsx`, `src/app/attach.tsx`, `src/app/skills.tsx`, `src/app/cron-edit.tsx`, `src/app/skills/[name].tsx`, `src/app/cron.tsx`, `src/app/models.tsx`, `src/app/chat/[id].tsx`, `src/app/memory-file.tsx`, `src/app/memory.tsx`, `src/components/composer.tsx`, `src/components/session-row.tsx`, `src/components/approval-card.tsx`, `src/components/message-row.tsx`, `src/components/sidebar.tsx`

- [ ] **Step 1: Convert every usage mechanically.** Pattern:

```tsx
// BEFORE
<Image source="sf:gearshape" style={{ width: 20, height: 20 }} tintColor={colors.text} />
// AFTER
<Icon sf="gearshape" size={20} color={colors.text} />
```

Rules:
- `style={{ width: N, height: N }}` → `size={N}`. Unequal w/h → `width={W} height={H}`.
- `tintColor={X}` → `color={X}`.
- Extra style props (margins, opacity, transforms) → keep in `style={...}` on `<Icon>`.
- Dynamic names (e.g., ternaries producing `sf:` strings) → move the ternary into the `sf` prop: `<Icon sf={cond ? 'a' : 'b'} ...>`. The `sf:` prefix never appears at call sites afterward.
- Do NOT touch `Image` usages that are not SF symbols (photos, the wordmark PNG, QR previews).
- Remove `Image` imports that become unused; keep them where still used for non-symbol images.

- [ ] **Step 2: Verify zero leftovers** — `grep -rn "sf:" src --include="*.tsx" --include="*.ts" | grep -v icon.tsx | grep -v icon-map | grep -v __tests__` → empty output.

- [ ] **Step 3: Full verification** — `npx jest --silent && npx tsc --noEmit && npx expo lint` (lint: baseline only).

- [ ] **Step 4: Commit** — `refactor(android): route all SF symbol usage through Icon`

---

### Task 3: Per-platform fonts

**Files:** Modify: `src/theme.ts:27-28`

- [ ] **Step 1:**

```ts
/** Display face for the wordmark and greetings — warm serif. Georgia is built into
 * iOS; Android maps 'serif' to Noto Serif. */
export const serif = process.env.EXPO_OS === 'ios' ? 'Georgia' : 'serif';
```

- [ ] **Step 2:** `npx jest --silent && npx tsc --noEmit`
- [ ] **Step 3: Commit** — `fix(android): platform serif font (Georgia is iOS-only)`

---

### Task 4: Keyboard behavior on Android

**Files:** Modify: `src/app/chat/[id].tsx` (FlatList props + `useAnimatedKeyboard` call)

- [ ] **Step 1:** `keyboardDismissMode="interactive"` → `keyboardDismissMode={process.env.EXPO_OS === 'ios' ? 'interactive' : 'on-drag'}` ('interactive' is iOS-only; Android ignores it entirely).

- [ ] **Step 2:** SDK 56 Android is edge-to-edge; Reanimated's `useAnimatedKeyboard` needs translucency flags there or heights are off by the bar heights:

```ts
const keyboard = useAnimatedKeyboard({
  isStatusBarTranslucentAndroid: true,
  isNavigationBarTranslucentAndroid: true,
});
```

(Options are ignored on iOS — no behavior change.) Verify the option names against the installed Reanimated version's types (`node_modules/react-native-reanimated/lib/typescript/hook/useAnimatedKeyboard.d.ts` or similar) — adjust if the installed major renamed them.

- [ ] **Step 3:** `npx jest --silent && npx tsc --noEmit`
- [ ] **Step 4: Commit** — `fix(android): keyboard dismiss mode + edge-to-edge keyboard insets`

---

### Task 5: Hardware back closes the drawer

**Files:** Modify: `src/components/sidebar-host.tsx`

- [ ] **Step 1:** Add a `BackHandler` subscription active only while the drawer is open. `BackHandler` events never fire on iOS, but gate registration anyway for symmetry:

```tsx
import { BackHandler } from 'react-native';

// inside SidebarHost, after `open` state and `settle` exist:
useEffect(() => {
  if (process.env.EXPO_OS === 'ios' || !open) return;
  const sub = BackHandler.addEventListener('hardwareBackPress', () => {
    close(); // the existing close path (settle(false) + setOpen(false))
    return true; // consume: do not pop the chat route
  });
  return () => sub.remove();
}, [open]);
```

Use whatever the component's existing close function is called — read the file first; do not invent a new close path. If the effect needs values the lint rules flag, follow the file's existing eslint-disable conventions (it already has a documented file-level disable).

- [ ] **Step 2:** `npx jest --silent && npx tsc --noEmit`
- [ ] **Step 3: Commit** — `feat(android): hardware back closes the sidebar drawer`

---

### Task 6: Cross-platform action sheet + rename prompt

**Files:**
- Create: `src/lib/action-sheet.ts`
- Create: `src/components/prompt-dialog.tsx`
- Modify: `src/app/chat/[id].tsx` (~line 448, export menu), `src/lib/profile-picker.ts`, `src/components/sidebar.tsx` (~line 256, rename)
- Test: `src/__tests__/action-sheet.test.ts`

- [ ] **Step 1: Generic action-sheet helper** (extract the pattern already in `profile-picker.ts`):

```ts
// src/lib/action-sheet.ts
import { ActionSheetIOS, Alert } from 'react-native';

export interface SheetAction {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

const isIOS = process.env.EXPO_OS === 'ios';

/** Native action sheet on iOS; Alert-based menu elsewhere. */
export function showActionSheet(title: string | undefined, actions: SheetAction[]) {
  if (isIOS) {
    const options = [...actions.map((a) => a.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options,
        cancelButtonIndex: options.length - 1,
        destructiveButtonIndex: actions.findIndex((a) => a.destructive) >= 0
          ? actions.findIndex((a) => a.destructive)
          : undefined,
      },
      (i) => {
        if (i < actions.length) actions[i].onPress();
      },
    );
    return;
  }
  Alert.alert(title ?? '', undefined, [
    ...actions.map((a) => ({
      text: a.label,
      style: a.destructive ? ('destructive' as const) : undefined,
      onPress: a.onPress,
    })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}
```

Write a test that mocks `ActionSheetIOS.showActionSheetWithOptions` / `Alert.alert` and asserts the option order, cancel index, and that selecting index N calls action N (mirror the structure of existing tests in `src/__tests__/`).

- [ ] **Step 2: Replace the chat export menu** (`chat/[id].tsx` ~448) and **refactor `profile-picker.ts`** to call `showActionSheet`. Behavior on iOS must be identical (same labels, same order, same destructive flags).

- [ ] **Step 3: Rename prompt.** `Alert.prompt` is iOS-only; sidebar.tsx:256 currently iOS-gates rename. Create a minimal controlled dialog used only on Android:

```tsx
// src/components/prompt-dialog.tsx
import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme';

/** Android stand-in for Alert.prompt. Render near the root of the screen that needs it. */
export function PromptDialog({
  visible,
  title,
  initialValue,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [value, setValue] = useState(initialValue);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 }}
        onPress={onCancel}
      >
        <Pressable
          onPress={() => {}}
          style={{ alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: 16, borderCurve: 'continuous', padding: 18, gap: 12 }}
        >
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{title}</Text>
          <TextInput
            autoFocus
            defaultValue={initialValue}
            onChangeText={setValue}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: colors.text, fontSize: 16 }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18 }}>
            <Pressable onPress={onCancel} hitSlop={8}><Text style={{ color: colors.textDim, fontSize: 16 }}>Cancel</Text></Pressable>
            <Pressable onPress={() => onSubmit(value)} hitSlop={8}><Text style={{ color: colors.accent, fontSize: 16, fontWeight: '600' }}>Save</Text></Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
```

Wire it in `sidebar.tsx`: keep `Alert.prompt` on iOS; on Android set state that renders `PromptDialog` with the same submit handler. Match theme token names to what `useTheme()` actually exposes (read theme.ts; e.g. use the real accent/border names).

- [ ] **Step 4:** `npx jest --silent && npx tsc --noEmit && npx expo lint` (baseline only)
- [ ] **Step 5: Commit** — `feat(android): cross-platform action sheets and rename dialog`

---

### Task 7: Android notifications plumbing

**Files:** Modify: `src/notifications.ts`, `app.json`. Create: `assets/images/notification-icon.png` (96×96 white-on-transparent, derive from `assets/images/android-icon-monochrome.png` via `sips -Z 96`).

- [ ] **Step 1: Notification channel.** Android 8+ requires a channel before any notification shows. In the existing registration path in `notifications.ts`, before token fetch:

```ts
if (process.env.EXPO_OS === 'android') {
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Hermes',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250],
  });
}
```

- [ ] **Step 2: Plugin config.** In `app.json` plugins, expand the existing `"expo-notifications"` entry:

```json
["expo-notifications", { "icon": "./assets/images/notification-icon.png", "color": "#D97757" }]
```

- [ ] **Step 3: Graceful no-FCM degradation.** `getExpoPushTokenAsync` throws on Android until a Firebase project (`google-services.json` + EAS FCM credentials) exists. Confirm the existing catch (notifications.ts:124) swallows it without breaking login; extend the comment to say Android push stays off until FCM is configured. Add a short "Android push setup" subsection to `READY.md` documenting: create Firebase project → download `google-services.json` to repo root → set `android.googleServicesFile` in app.json → `eas credentials` to upload the FCM V1 key.

- [ ] **Step 4:** `npx jest --silent && npx tsc --noEmit`
- [ ] **Step 5: Commit** — `feat(android): notification channel, icon, and FCM setup docs`

---

### Task 8: Enable haptics on Android

**Files:** Modify: every site gating `Haptics.*` behind an iOS check (`grep -rn "Haptics" src` — message-row.tsx:175 and others).

- [ ] **Step 1:** Remove the `process.env.EXPO_OS === 'ios' &&` / `if (isIOS)` guards around `Haptics.impactAsync`/`notificationAsync`/`selectionAsync` calls. Keep the calls otherwise identical (expo-haptics maps them to Android vibration effects). Where a guard variable becomes unused, clean it up.

- [ ] **Step 2:** `npx jest --silent && npx tsc --noEmit && npx expo lint` (baseline only)
- [ ] **Step 3: Commit** — `feat(android): enable haptics`

---

### Task 9: Final verification + prebuild check

- [ ] **Step 1:** Full suite: `npx jest --silent && npx tsc --noEmit && npx expo lint` — tests ≥ 281 green, tsc clean, lint at baseline.
- [ ] **Step 2:** Config sanity: `npx expo prebuild -p android --clean` must complete without error (validates app.json plugin changes; `android/` is gitignored, nothing to commit).
- [ ] **Step 3:** `grep -rn "sf:" src | grep -v icon` → only icon.tsx/icon-map/tests.
- [ ] **Step 4:** Commit any stragglers, then STOP. Do not push, do not open a PR (the orchestrator does that).

**Known device-test checklist (manual, after PR):** formSheet detent behavior on Android (attach + settings sheets), sidebar edge-pan vs system back-gesture, keyboard inset correctness in chat, icon visual pass, glass-fallback header buttons.
