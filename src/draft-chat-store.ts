// src/draft-chat-store.ts — the session a /chat/new screen lazily minted, so the sidebar can
// tell a started new chat from an empty draft (see lib/chat-route). Read at tap time only, so
// there are no subscribers. The chat screen sets it on session.create and clears it on unmount.

let startedDraft: string | null = null;

export function getStartedDraft(): string | null {
  return startedDraft;
}

export function setStartedDraft(sessionId: string): void {
  startedDraft = sessionId;
}

/** Clears only `sessionId`'s entry: a screen unmounting late can't wipe a newer draft's. */
export function clearStartedDraft(sessionId: string | null): void {
  if (sessionId != null && startedDraft === sessionId) startedDraft = null;
}

/** Test-only: reset module state between cases. */
export function __resetDraftChatStore(): void {
  startedDraft = null;
}
