// src/connector-state.ts — small in-memory state the Connectors screens share, and that
// belongs to the gateway the app is connected to. It imports nothing, so connection.ts can
// reset it on every connect and disconnect without pulling in the RPC client.
//
//  - "change pending": a connector was changed from the app and the running gateway has not
//    been reloaded since. Not persisted; after an app restart the list still sees a mismatch
//    between config and runtime in the status rows (lib/mcp needsReload).
//  - "sign in when the detail opens": set by the add screens for an OAuth connector, consumed
//    once by that connector's detail. In memory on purpose — as a route param, a link could
//    start an OAuth flow without a tap, and a re-mount would start another.
//  - when this app last cancelled a sign-in, per connector (a restart may get a 409).

// --- change pending --------------------------------------------------------
// Counted, not a boolean: a reload clears only the changes that existed when it started,
// so one made while it was running (a connector removed meanwhile) is not lost.

let changes = 0;
let clearedThrough = 0;
const changeListeners = new Set<() => void>();

function emitIfPendingChanged(before: boolean): void {
  if (before === getMcpChangePending()) return;
  for (const l of [...changeListeners]) l();
}

export function getMcpChangePending(): boolean {
  return changes > clearedThrough;
}

export function subscribeMcpChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** A connector was added, switched, removed or signed in to: the gateway needs a reload. */
export function markMcpChanged(): void {
  const before = getMcpChangePending();
  changes += 1;
  emitIfPendingChanged(before);
}

/** Read just before a reload starts; pass it to `clearMcpChanged` when the reload succeeds. */
export function mcpChangeMark(): number {
  return changes;
}

/** The gateway reloaded. With `mark`, only the changes made up to that mark are cleared. */
export function clearMcpChanged(mark: number = changes): void {
  const before = getMcpChangePending();
  clearedThrough = Math.max(clearedThrough, Math.min(mark, changes));
  emitIfPendingChanged(before);
}

// --- sign in when the detail opens -----------------------------------------

/** Long enough for the add screen to hand over to the detail; short enough that a detail
 * which could not use the request does not start a sign-in on some later visit. */
export const SIGN_IN_REQUEST_TTL_MS = 60_000;

let signInRequest: { name: string; at: number } | null = null;

export function requestSignInOnOpen(name: string, now: number = Date.now()): void {
  signInRequest = { name, at: now };
}

/** True once, for the connector the add screens named, while the request is fresh. */
export function consumeSignInRequest(name: string, now: number = Date.now()): boolean {
  if (!signInRequest) return false;
  if (now - signInRequest.at > SIGN_IN_REQUEST_TTL_MS) {
    signInRequest = null;
    return false;
  }
  if (signInRequest.name !== name) return false;
  signInRequest = null;
  return true;
}

/** The detail for `name` is going away without having used its request: forget it. */
export function dropSignInRequest(name: string): void {
  if (signInRequest?.name === name) signInRequest = null;
}

// --- last cancelled sign-in ------------------------------------------------

const cancelledAt = new Map<string, number>();

export function noteSignInCancelled(name: string, now: number): void {
  cancelledAt.set(name, now);
}

export function lastSignInCancel(name: string): number | undefined {
  return cancelledAt.get(name);
}

// --- a different gateway ---------------------------------------------------

/** All of the above belongs to one gateway: forget it on connect and on disconnect.
 * Subscribers stay subscribed. */
export function resetConnectorState(): void {
  const before = getMcpChangePending();
  changes = 0;
  clearedThrough = 0;
  signInRequest = null;
  cancelledAt.clear();
  emitIfPendingChanged(before);
}
