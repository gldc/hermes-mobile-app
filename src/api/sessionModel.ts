// src/api/sessionModel.ts
//
// In-chat (session-scoped) model switch — see
// docs/superpowers/specs/2026-06-20-per-chat-model-design.md (Feature 1).
//
// Rides the gateway's existing `config.set` RPC ({session_id, key:'model',
// value, confirm_expensive_model}) — no core or plugin change. The composer
// pill updates from the resulting `session.info` event (handled in
// chat/[id].tsx); this module only performs the switch and classifies the
// gateway's reply. I/O is injected (`call`) so it is unit-testable.
import type { GatewayClient } from './gatewayClient';
import { RpcError } from './gatewayClient';

/** Gateway `config.set` reply shape for key:'model'. */
export interface ConfigSetModelResult {
  value?: string;
  warning?: string;
  confirm_required?: boolean;
  confirm_message?: string;
}

export type SwitchOutcome =
  | { kind: 'ok'; model: string | null } // switched; `model` is the resolved id (if returned)
  | { kind: 'confirm'; message: string } // expensive-model gate — re-call with confirmExpensive
  | { kind: 'busy' } // a turn is in flight (RPC 4009)
  | { kind: 'error'; message: string };

/** RPC code the gateway returns when a turn is in flight (server.py:7709). */
export const SESSION_BUSY_CODE = 4009;
const BUSY_RE = /session busy/i;

/** Build the `config.set` value: model id bare, provider via --provider,
 * --session = explicit session scope (also the gateway's default scope). */
export function buildSessionModelValue(provider: string, model: string): string {
  return `${model} --provider ${provider} --session`;
}

/** Switch THIS session's model via the gateway `config.set` RPC.
 * `call` is `GatewayClient['call']` (injected for tests). */
export async function switchSessionModel(
  call: GatewayClient['call'],
  args: { sessionId: string; provider: string; model: string; confirmExpensive?: boolean },
): Promise<SwitchOutcome> {
  try {
    const res = await call<ConfigSetModelResult>('config.set', {
      session_id: args.sessionId,
      key: 'model',
      value: buildSessionModelValue(args.provider, args.model),
      confirm_expensive_model: Boolean(args.confirmExpensive),
    });
    if (res?.confirm_required) {
      return {
        kind: 'confirm',
        message: res.confirm_message || res.warning || 'This model may be costly. Switch anyway?',
      };
    }
    if (res?.warning && BUSY_RE.test(res.warning)) return { kind: 'busy' };
    return { kind: 'ok', model: res?.value ?? null };
  } catch (e) {
    if (e instanceof RpcError && e.code === SESSION_BUSY_CODE) return { kind: 'busy' };
    const message = e instanceof Error ? e.message : String(e);
    if (BUSY_RE.test(message)) return { kind: 'busy' };
    return { kind: 'error', message };
  }
}
