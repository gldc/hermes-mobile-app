// src/lib/approval.ts
//
// Pure parsing for the gateway approval flow (docs/contracts/approvals.md).
// Two wire shapes share a display: 0.21.5's per-request `approval` server
// request (session_id, request_id, tool_name, ...) and legacy 0.20.4's
// session-keyed `approval.request` event (no request_id — one FIFO queue per
// session, and a response resolves the OLDEST pending approval).

/** Canonical `approval.respond` choices (tools/approval.py). */
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

/** Display fields for either approval shape: the 0.21.5 `approval` server-request params
 *  (ApprovalRequestParams) or the legacy 0.20.4 `approval.request` event payload. */
export interface ApprovalView {
  command: string;
  description: string;
  patternKey: string;
  toolName: string;
}

export function approvalView(params: unknown): ApprovalView {
  const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const keys = Array.isArray(p.pattern_keys)
    ? p.pattern_keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
    : [];
  return {
    command: str(p.command),
    description: str(p.description),
    patternKey: str(p.pattern_key) || keys[0] || '',
    toolName: str(p.tool_name),
  };
}

/**
 * Normalize the `approval.respond` result. The server returns
 * `{ resolved: <int> }` (count of approvals resolved; 0 = nothing was
 * pending — stale/raced), but be tolerant of a boolean like the desktop
 * client assumes.
 */
export function resolvedCount(result: unknown): number {
  if (typeof result !== 'object' || result === null) return 0;
  const r = (result as Record<string, unknown>).resolved;
  if (typeof r === 'number' && Number.isFinite(r)) return Math.max(0, Math.trunc(r));
  if (typeof r === 'boolean') return r ? 1 : 0;
  return 0;
}
