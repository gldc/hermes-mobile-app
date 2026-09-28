// src/api/legacy-approval.ts — the ONE app-owned gateway type (spec §4.3, review m5).
// The 0.20.4 `approval.request` EVENT is absent from the v2026.9.24 contract; its payload shape
// is from hermes-agent v2026.8.18 tui_gateway/server.py `_approval_request_payload`.
// DELETE this file when 0.20.4 support is dropped.

export interface LegacyApprovalRequestPayload {
  command: string;
  description?: string;
  choices?: string[];
  allow_permanent?: boolean;
  allow_session?: boolean;
  smart_denied?: boolean;
  tool_name?: string;
  [k: string]: unknown;
}

export function isLegacyApprovalEvent(e: { type: string }): boolean {
  return e.type === 'approval.request';
}

/** The event payload if it has something displayable (a command or description), else null. */
export function readLegacyApprovalPayload(payload: unknown): LegacyApprovalRequestPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const command = typeof p.command === 'string' ? p.command : '';
  const description = typeof p.description === 'string' ? p.description : '';
  if (!command.trim() && !description.trim()) return null;
  return { ...p, command } as LegacyApprovalRequestPayload;
}
