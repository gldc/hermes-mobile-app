// src/components/connector-sign-in.ts — binds the connector OAuth sequence (lib/mcp-oauth,
// where every rule is tested) to the real in-app browser and REST calls (spec §5.6).
//
// The gateway runs the OAuth client. The app shows the provider's page and polls the
// gateway; the provider redirects the browser back to the gateway's own HTTPS callback.
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { cancelMcpOauthFlow, getMcpOauthFlow, startMcpOauth } from '@/api/mcp';
import { getRest, withAuthRetry } from '@/connection';
import { checkAuthorizationUrl, gatewaySupportsOauth } from '@/lib/mcp';
import { runOauthSignIn, type OauthDeps, type OauthOutcome, type OauthPhase } from '@/lib/mcp-oauth';

/** After cancelling a flow, a new start may get a 409 while the gateway winds the old one down. */
const RETRY_CONFLICT_WINDOW_MS = 10_000;

const HTTPS_NEEDED =
  'Sign-in needs the gateway on an https:// address; providers do not accept a plain-HTTP redirect.';

// When this app last cancelled a flow, per connector. Module scope: a re-opened detail
// screen is a new hook instance and must still know.
const lastCancel = new Map<string, number>();

// "Start a sign-in when this connector's detail opens": set by the add screens, consumed
// once by the detail. In memory on purpose — as a route param, a link could start an OAuth
// flow without a tap, and a re-mount would start another.
let signInOnOpen: string | null = null;

export function requestSignInOnOpen(name: string): void {
  signInOnOpen = name;
}

/** True once for the connector the add screens named; false otherwise. */
export function consumeSignInRequest(name: string): boolean {
  if (signInOnOpen !== name) return false;
  signInOnOpen = null;
  return true;
}

/** Test-only: reset module state between cases. */
export function __resetConnectorSignIn(): void {
  lastCancel.clear();
  signInOnOpen = null;
}

/** The gateway address this app is connected to, or null when it is not connected. */
export function gatewayBaseUrl(): string | null {
  try {
    return getRest().baseUrl;
  } catch {
    return null; // not connected
  }
}

/** Resolves when the page has closed. iOS: that is `openBrowserAsync`'s own promise. A Custom
 * Tab (Android) resolves at once, so there the page counts as closed when the app has left
 * the foreground and come back. */
async function openAuthBrowser(url: string): Promise<unknown> {
  if (process.env.EXPO_OS === 'ios') {
    return WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'cancel' });
  }
  await WebBrowser.openBrowserAsync(url);
  return new Promise<void>((resolve) => {
    let left = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') left = true;
      else if (left) {
        sub.remove();
        resolve();
      }
    });
  });
}

/** Close the page if the platform lets the app do it (iOS). Best-effort. */
async function closeAuthBrowser(): Promise<void> {
  if (process.env.EXPO_OS !== 'ios') return;
  try {
    await WebBrowser.dismissBrowser();
  } catch {
    // no page was open
  }
}

const DEFAULT_TIMING: Pick<OauthDeps, 'sleep' | 'now'> = {
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
};

export interface ConnectorSignIn {
  /** What the running sign-in is doing; null when none runs. */
  phase: OauthPhase | null;
  /** Cancel was asked and the sequence has not ended yet (a start can take up to 45 s). */
  cancelling: boolean;
  /** Run one sign-in. Rejects only with AuthError. */
  signIn: (name: string) => Promise<OauthOutcome>;
  /** Takes effect at the sequence's next step; the flow is cancelled on the gateway. */
  cancel: () => void;
}

/** Leaving the screen cancels a running sign-in. `timing` is injectable for tests. */
export function useConnectorSignIn(
  profile: string | null,
  timing: Pick<OauthDeps, 'sleep' | 'now'> = DEFAULT_TIMING,
): ConnectorSignIn {
  const [phase, setPhase] = useState<OauthPhase | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const cancelled = useRef(false);
  const running = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelled.current = true; // the sequence cancels the flow at its next step
      if (running.current) void closeAuthBrowser(); // and do not leave the page up meanwhile
    };
  }, []);

  const signIn = useCallback(
    async (name: string): Promise<OauthOutcome> => {
      if (running.current) return { kind: 'error', message: 'A sign-in is already running.' };
      const base = gatewayBaseUrl();
      if (!base || !gatewaySupportsOauth(base)) return { kind: 'error', message: HTTPS_NEEDED };
      running.current = true;
      cancelled.current = false;
      if (mounted.current) setCancelling(false);
      const recent = lastCancel.get(name);
      try {
        const outcome = await runOauthSignIn({
          start: () => withAuthRetry((r) => startMcpOauth(r, name, profile)),
          poll: (flowId) => withAuthRetry((r) => getMcpOauthFlow(r, flowId)),
          cancel: (flowId) => withAuthRetry((r) => cancelMcpOauthFlow(r, flowId)),
          openBrowser: openAuthBrowser,
          dismissBrowser: closeAuthBrowser,
          checkUrl: (url) => checkAuthorizationUrl(url, base),
          sleep: timing.sleep,
          now: timing.now,
          onPhase: (p) => {
            if (mounted.current) setPhase(p);
          },
          isCancelled: () => cancelled.current,
          retryConflict: recent !== undefined && timing.now() - recent < RETRY_CONFLICT_WINDOW_MS,
        });
        if (outcome.kind === 'cancelled') lastCancel.set(name, timing.now());
        return outcome;
      } finally {
        running.current = false;
        if (mounted.current) {
          setPhase(null);
          setCancelling(false);
        }
      }
    },
    [profile, timing],
  );

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (running.current && mounted.current) setCancelling(true);
  }, []);

  return { phase, cancelling, signIn, cancel };
}
