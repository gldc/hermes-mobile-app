// src/lib/approval.ts
//
// Pure parsing for the gateway approval flow (docs/contracts/approvals.md).
// The `approval.request` event payload is exactly the engine's approval_data
// dict: { command, pattern_key, pattern_keys, description }. Approvals are
// session-keyed (no request_id): one FIFO queue per session, and a response
// resolves the OLDEST pending approval.

/** Verified `approval.request` payload (terminal + execute_code guards share the shape). */
export interface ApprovalRequest {
  /** Full command (or synthesized command for execute_code). */
  command: string;
  /** Combined human-readable description of why this needs approval. */
  description: string;
  /** Primary matched pattern key, e.g. "recursive delete". */
  patternKey: string;
  /** Every matched pattern key. */
  patternKeys: string[];
}

/** Canonical `approval.respond` choices (tools/approval.py). */
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

/**
 * Parse an `approval.request` event payload. Lenient about missing fields,
 * but returns null when there is nothing meaningful to show (no command and
 * no description) — the gateway will deny on timeout regardless.
 */
export function parseApprovalRequest(payload: unknown): ApprovalRequest | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const command = typeof p.command === 'string' ? p.command : '';
  const description = typeof p.description === 'string' ? p.description : '';
  if (!command.trim() && !description.trim()) return null;
  const rawKey = typeof p.pattern_key === 'string' ? p.pattern_key : '';
  const patternKeys = Array.isArray(p.pattern_keys)
    ? p.pattern_keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
    : [];
  return {
    command,
    description,
    patternKey: rawKey || patternKeys[0] || '',
    patternKeys: patternKeys.length > 0 ? patternKeys : rawKey ? [rawKey] : [],
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
