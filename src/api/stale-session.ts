// src/api/stale-session.ts — the `4001` rule (spec §3.2, §5.3, review m10): a stale runtime
// session id → resume the STORED id and retry ONCE with the fresh live id. Used by config.set
// (this plan) and by Stop/steer (plan B).
import { RpcError } from './gatewayClient';

export const STALE_SESSION_CODE = 4001;

export async function withStaleSessionRetry<T>(
  sessionId: string,
  run: (sid: string) => Promise<T>,
  resume: () => Promise<string>,
): Promise<T> {
  try {
    return await run(sessionId);
  } catch (e) {
    if (!(e instanceof RpcError) || e.code !== STALE_SESSION_CODE) throw e;
    return run(await resume());
  }
}
