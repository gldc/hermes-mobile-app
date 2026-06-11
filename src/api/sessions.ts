// src/api/sessions.ts — session management (rename / delete).
// Contract: docs/contracts/sessions-extra.md → PATCH & DELETE /api/sessions/{id}
import type { RestClient } from './restClient';

export interface RenameResponse {
  ok: boolean;
  /** Current title after the update; empty/null when cleared. */
  title: string | null;
  /** Present only when `archived` was in the request. */
  archived?: boolean;
}

/** Rename a session. An empty title clears it (server-side semantics). */
export function renameSession(
  client: Pick<RestClient, 'patch'>,
  sessionId: string,
  title: string,
): Promise<RenameResponse> {
  return client.patch<RenameResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`, { title });
}

/** Permanently delete a session (children are orphaned, not cascaded). */
export function deleteSession(
  client: Pick<RestClient, 'del'>,
  sessionId: string,
): Promise<{ ok: boolean }> {
  return client.del<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}`);
}
