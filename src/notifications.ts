// src/notifications.ts — Expo push registration + tap handling.
// Pure logic (staleness, routes, payload shapes) lives in src/lib/push.ts;
// this module owns the Expo/OS surface (docs/contracts/push.md).
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Alert, Platform } from 'react-native';
import { getConnectionMode, getDeviceId, withAuthRetry } from '@/connection';
import {
  PUSH_TOKEN_ROUTE,
  isRegistrationFresh,
  parsePushRegistration,
} from '@/lib/push';

const REG_STORE_KEY = 'hermes-push-registration';
export const EAS_INIT_NOTE = 'Run eas init to enable push';

/** Settings-facing registration state (read with getPushStatus). */
export interface PushStatus {
  state: 'idle' | 'registered' | 'denied' | 'no-project-id' | 'unavailable' | 'error';
  /** One-line note for the settings screen, when there is something to say. */
  note?: string;
}

let status: PushStatus = { state: 'idle' };

export function getPushStatus(): PushStatus {
  return status;
}

/** EAS project id, required by getExpoPushTokenAsync in dev-client builds.
 * Written into app.json's extra.eas by `eas init` — absent until then. */
function easProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as Record<string, any> | undefined)?.eas?.projectId;
  const fromEas = (Constants as any).easConfig?.projectId;
  const id = fromExtra ?? fromEas;
  return typeof id === 'string' && id ? id : null;
}

/** Our own pre-permission prompt: the OS dialog is one-shot, so never burn it
 * without the user already having said yes once (soft-ask pattern). */
function softAskPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Enable notifications?',
      'Hermes can let you know when your agent sends you a message while the app is closed.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Enable', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Register (or refresh) this device's Expo push token with the gateway.
 *
 * Call with `softAsk: true` right after a device-mode pairing (may prompt),
 * and `softAsk: false` on app start (never prompts; only re-registers when
 * permission is already granted and the stored registration is stale —
 * >7 days, different token, or different pairing). No-ops in password mode,
 * on web/simulators, and when no EAS projectId is configured (in that case
 * settings shows "Run eas init to enable push"; we never run eas ourselves).
 * Failures are swallowed: push is best-effort, the next launch retries. */
export async function maybeRegisterPush(opts: { softAsk: boolean }): Promise<void> {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) {
      status = { state: 'unavailable', note: 'Push needs a physical device' };
      return;
    }
    if ((await getConnectionMode()) !== 'device') {
      // Password mode has no device identity → no push-token route access.
      status = { state: 'unavailable', note: 'Push needs QR device pairing' };
      return;
    }
    const deviceId = await getDeviceId();
    if (!deviceId) {
      status = { state: 'unavailable', note: 'Push needs QR device pairing' };
      return;
    }
    const projectId = easProjectId();
    if (!projectId) {
      status = { state: 'no-project-id', note: EAS_INIT_NOTE };
      return;
    }

    let perms = await Notifications.getPermissionsAsync();
    if (!perms.granted) {
      if (!opts.softAsk) {
        // App-start path: never prompt, just skip until the next pairing.
        status = perms.canAskAgain
          ? { state: 'idle' }
          : { state: 'denied', note: 'Notifications are off in system settings' };
        return;
      }
      if (!perms.canAskAgain) {
        status = { state: 'denied', note: 'Notifications are off in system settings' };
        return;
      }
      if (!(await softAskPermission())) {
        status = { state: 'idle' };
        return;
      }
      perms = await Notifications.requestPermissionsAsync();
      if (!perms.granted) {
        status = { state: 'denied', note: 'Notifications are off in system settings' };
        return;
      }
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const stored = parsePushRegistration(await SecureStore.getItemAsync(REG_STORE_KEY));
    if (isRegistrationFresh(stored, token, deviceId, Date.now())) {
      status = { state: 'registered' };
      return;
    }
    await withAuthRetry((r) => r.post<{ ok: boolean }>(PUSH_TOKEN_ROUTE, { token }));
    await SecureStore.setItemAsync(
      REG_STORE_KEY,
      JSON.stringify({ token, registeredAt: Date.now(), deviceId }),
    );
    status = { state: 'registered' };
  } catch (e) {
    // Best-effort by design (mailbox is the source of truth) — log and move on.
    console.warn('push registration skipped:', e instanceof Error ? e.message : e);
    status = { state: 'error', note: 'Push registration failed — will retry next launch' };
  }
}

/** Install the foreground handler (banner, no sound/badge) and the tap
 * listener. Gateway pushes carry no data payload (push.py sends title/body
 * only), so taps can only mean "go look" → caller navigates to /sessions.
 * Cold-start taps need no handling here: the app lands on the connect screen,
 * whose restore flow already replaces to /sessions. Returns an unsubscribe. */
export function setupNotificationHandling(onTap: () => void): () => void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  const sub = Notifications.addNotificationResponseReceivedListener(() => onTap());
  return () => sub.remove();
}
