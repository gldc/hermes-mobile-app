// src/session-mcp-store.ts — hands the active chat's socket to the Connectors
// screens for the connector RPCs (test, runtime status, reload), since those
// screens do not own a WebSocket. Same shape as session-model-store: module
// state + subscribe, consumed with useSyncExternalStore.
//
// Unlike session-model-store, targets are kept per publishing chat screen and
// the most recently MOUNTED one is the visible target: two chat screens can
// overlap during a transition, and neither the older one's cleanup nor a late
// republish from it may displace the newer one's target.
//
// It also holds the "change pending" flag: a connector was changed from the
// app and the running gateway has not been reloaded since.
import type { GatewayClient } from '@/api/gatewayClient';
import {
  mcpServerStatus,
  reloadMcp,
  testMcpServer,
  type McpReloadOutcome,
  type McpRuntimeRow,
  type McpTestOutcome,
} from '@/api/mcpSession';

export interface SessionMcpTarget {
  /** True while the chat's socket is ready for calls. */
  connected: boolean;
  /** True while a turn runs in this chat: a reload would pull its tools out mid-turn. */
  streaming: boolean;
  /** Connect, list tools, disconnect — on the gateway. Never rejects. */
  test: (name: string, profile: string | null) => Promise<McpTestOutcome>;
  /** What the running gateway has loaded. `[]` when unavailable. */
  status: (profile: string | null) => Promise<McpRuntimeRow[]>;
  /** Reconnect every connector on the gateway (the screen asks first). Never rejects. */
  reload: () => Promise<McpReloadOutcome>;
}

export const NOT_CONNECTED_MESSAGE =
  'This needs a connected chat. Go back to the chat, wait for it to connect, then return.';

/** Build a chat's target. `getCall` and `getSessionId` are read at call time, so a
 * reconnect that swaps the socket, or a session created later, is picked up without
 * republishing. */
export function createSessionMcpTarget(opts: {
  connected: boolean;
  streaming: boolean;
  getCall: () => GatewayClient['call'] | null;
  /** The chat's live session id; null for a chat that has none yet. */
  getSessionId: () => string | null;
}): SessionMcpTarget {
  const { connected, streaming, getCall, getSessionId } = opts;
  return {
    connected,
    streaming,
    test: (name, profile) => {
      const call = getCall();
      if (!call) return Promise.resolve({ kind: 'error', message: NOT_CONNECTED_MESSAGE });
      return testMcpServer(call, name, profile);
    },
    status: (profile) => {
      const call = getCall();
      return call ? mcpServerStatus(call, profile) : Promise.resolve([]);
    },
    reload: () => {
      const call = getCall();
      if (!call) return Promise.resolve({ kind: 'error', message: NOT_CONNECTED_MESSAGE });
      return reloadMcp(call, getSessionId());
    },
  };
}

// Insertion order = mount order; a republish by the same chat keeps its place.
const targets = new Map<object, SessionMcpTarget>();
let current: SessionMcpTarget | null = null;
const listeners = new Set<() => void>();

function refresh(): void {
  let newest: SessionMcpTarget | null = null;
  for (const t of targets.values()) newest = t;
  if (newest === current) return;
  current = newest;
  for (const l of [...listeners]) l();
}

export function getSessionMcpTarget(): SessionMcpTarget | null {
  return current;
}

export function subscribeSessionMcpTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish (or update) a chat's target. `by` identifies the publishing chat screen. */
export function publishSessionMcpTarget(by: object, next: SessionMcpTarget): void {
  targets.set(by, next);
  refresh();
}

/** Withdraw a chat's target (its screen unmounted). */
export function clearSessionMcpTarget(by: object): void {
  if (!targets.delete(by)) return;
  refresh();
}

// --- change pending --------------------------------------------------------
// Not persisted: after an app restart the list still shows a mismatch between
// the config and the running gateway from the status rows (lib/mcp needsReload).

let changePending = false;
const changeListeners = new Set<() => void>();

function setChangePending(next: boolean): void {
  if (changePending === next) return;
  changePending = next;
  for (const l of [...changeListeners]) l();
}

export function getMcpChangePending(): boolean {
  return changePending;
}

export function subscribeMcpChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** A connector was added, switched, removed or signed in to: the gateway needs a reload. */
export function markMcpChanged(): void {
  setChangePending(true);
}

/** The gateway reloaded (or the app disconnected from it). */
export function clearMcpChanged(): void {
  setChangePending(false);
}

/** Test-only: reset module state between cases. */
export function __resetSessionMcpStore(): void {
  targets.clear();
  current = null;
  listeners.clear();
  changePending = false;
  changeListeners.clear();
}
