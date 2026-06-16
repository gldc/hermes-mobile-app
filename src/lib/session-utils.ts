import type { SessionSummary } from '@/api/types';

/** Durable id for pinning. The server projects compression roots forward to
 *  their continuation tips and writes `_lineage_root_id` on the merged row.
 *  Sessions that were never compressed have no lineage root — fall back to
 *  the live id. */
export function sessionPinId(
  session: Pick<SessionSummary, '_lineage_root_id' | 'id'>,
): string {
  return session._lineage_root_id || session.id;
}
