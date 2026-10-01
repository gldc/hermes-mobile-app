// src/session-mcp-store.ts — hands the active chat's socket to the Connectors
// screens for the two connector RPCs (test, runtime status), since those
// screens do not own a WebSocket. Same shape as session-model-store: module
// state + subscribe, consumed with useSyncExternalStore.
//
// Unlike session-model-store, targets are kept per publishing chat screen and
// the most recently MOUNTED one is the visible target: two chat screens can
// overlap during a transition, and neither the older one's cleanup nor a late
// republish from it may displace the newer one's target.
import type { McpRuntimeRow, McpTestOutcome } from '@/api/mcpSession';

export interface SessionMcpTarget {
  /** True while the chat's socket is ready for calls. */
  connected: boolean;
  /** Connect, list tools, disconnect — on the gateway. Never rejects. */
  test: (name: string, profile: string | null) => Promise<McpTestOutcome>;
  /** What the running gateway has loaded. `[]` when unavailable. */
  status: (profile: string | null) => Promise<McpRuntimeRow[]>;
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

/** Test-only: reset module state between cases. */
export function __resetSessionMcpStore(): void {
  targets.clear();
  current = null;
  listeners.clear();
}
