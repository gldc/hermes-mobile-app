// src/lib/reconnect.ts — pure reconnect/liveness policy (no RN imports), so the
// foreground-reconnect decision and backoff schedule are unit-testable.

export const MAX_RECONNECT_ATTEMPTS = 5;

/** Exponential backoff for reconnect attempt N (1-based), capped at 8s. */
export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

/** Decide whether an AppState transition should trigger a reconnect. Reconnect
 * only on the 'active' edge and only when the live socket is gone or not OPEN —
 * a healthy socket is left alone (no needless single-use-ticket churn). */
export function shouldReconnect(args: {
  hasSocket: boolean;
  isOpen: boolean;
  appState: string;
}): boolean {
  return args.appState === 'active' && (!args.hasSocket || !args.isOpen);
}
