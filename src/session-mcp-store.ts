// src/session-mcp-store.ts — hands the active chat's socket to the Connectors
// screens for the two connector RPCs (test, runtime status), since those
// screens do not own a WebSocket. Same shape as session-model-store: module
// state + subscribe, consumed with useSyncExternalStore.
//
// Unlike session-model-store, a clear is owner-checked: two chat screens can
// overlap during a transition, and the older one's cleanup must not clear the
// newer one's target.
import type { McpRuntimeRow, McpTestOutcome } from '@/api/mcpSession';

export interface SessionMcpTarget {
  /** True while the chat's socket is ready for calls. */
  connected: boolean;
  /** Connect, list tools, disconnect — on the gateway. Never rejects. */
  test: (name: string, profile: string | null) => Promise<McpTestOutcome>;
  /** What the running gateway has loaded. `[]` when unavailable. */
  status: (profile: string | null) => Promise<McpRuntimeRow[]>;
}

let owner: object | null = null;
let target: SessionMcpTarget | null = null;
const listeners = new Set<() => void>();

function emit(nextOwner: object | null, next: SessionMcpTarget | null): void {
  owner = nextOwner;
  target = next;
  for (const l of [...listeners]) l();
}

export function getSessionMcpTarget(): SessionMcpTarget | null {
  return target;
}

export function subscribeSessionMcpTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish the active chat's target. `by` identifies the publishing chat screen. */
export function publishSessionMcpTarget(by: object, next: SessionMcpTarget): void {
  emit(by, next);
}

/** Clear the target, but only if `by` is the chat that published it. */
export function clearSessionMcpTarget(by: object): void {
  if (owner !== by) return;
  emit(null, null);
}

/** Test-only: reset module state between cases. */
export function __resetSessionMcpStore(): void {
  owner = null;
  target = null;
  listeners.clear();
}
