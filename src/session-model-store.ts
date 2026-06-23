// src/session-model-store.ts — hands the active chat's switch target to the
// /models picker (session mode), since the picker doesn't own the chat's
// WebSocket. Same shape as profile-store: module state + subscribe, consumed
// with useSyncExternalStore. The active chat publishes on connect/model/
// streaming change and clears (null) on unmount.
import type { SwitchOutcome } from '@/api/sessionModel';

export interface SessionModelTarget {
  /** Live session id to switch; '' when no session exists yet (new chat). */
  sessionId: string;
  /** Raw current model id of the chat (best-effort) — for the picker's current/selected display. */
  modelId: string | null;
  /** True while a turn is in flight — the picker disables switching. */
  streaming: boolean;
  /** Switch THIS chat's model on its live socket (session-scoped). */
  switchModel: (provider: string, model: string, confirmExpensive: boolean) => Promise<SwitchOutcome>;
}

let target: SessionModelTarget | null = null;
const listeners = new Set<() => void>();

function emit(next: SessionModelTarget | null): void {
  target = next;
  for (const l of [...listeners]) l();
}

export function getSessionModelTarget(): SessionModelTarget | null {
  return target;
}

export function subscribeSessionModelTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish (or clear with null) the active chat's switch target. */
export function setSessionModelTarget(next: SessionModelTarget | null): void {
  emit(next);
}

/** Test-only: reset module state between cases. */
export function __resetSessionModelStore(): void {
  target = null;
  listeners.clear();
}
