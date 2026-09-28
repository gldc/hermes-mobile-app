// src/lib/request-router.ts — routes server→client requests and request-related events into
// the turn store (contract §4 routing rule, spec §6.0/§6.3). Registered at client
// construction, before the first connect(): a -32601 for a supported method is destructive
// at 0.21.5 (approval withdrawn, clarify blanked — review M3).
import type { GatewayEvent, ServerRequest } from '@/vendor/hermes-gateway';
import { isLegacyApprovalEvent, readLegacyApprovalPayload } from '@/api/legacy-approval';
import type { RequestRegistry } from './request-registry';
import { kindForMethod, toCancelReason, type RequestCardState } from './turn-controller';
import type { TurnStore } from './turn-store';

export const VAULT_DECLINED_MESSAGE = 'not supported on mobile';

export interface RequestRouterDeps {
  store: TurnStore;
  registry: RequestRegistry;
  /** Key of the last transcript item right now (the card's anchor), or null. */
  anchorKey: () => string | null;
  now?: () => number;
  /** A card appeared that was not already present (for haptics / closing the stream segment). */
  onNewCard?: (card: RequestCardState, replayed: boolean) => void;
}

export interface RequestRouter {
  /** The ServerRequestHandler: true = accepted, false = decline (the channel then answers
   * -32601). The vault branch answers its own -32601 via `req.fail` before returning true. */
  handleRequest(req: ServerRequest): boolean;
  /** Consumes request.cancel and the legacy approval.request event. true = consumed. */
  handleEvent(e: GatewayEvent | { type: string; payload?: unknown; replayed?: boolean }): boolean;
}

/** Never let a dependency call escape: the vendored channel answers ANY onRequest handler
 * throw with -32603, which withdraws an approval / blanks a clarify at 0.21.5 (review M3 /
 * Review Focus 4). `fallback` is a thunk so it's only evaluated when `fn` actually throws. */
function safely<T>(fn: () => T, fallback: () => T): T {
  try {
    return fn();
  } catch {
    return fallback();
  }
}

export function createRequestRouter(deps: RequestRouterDeps): RequestRouter {
  const now = deps.now ?? Date.now;
  let legacyCounter = 0;

  function receive(card: Omit<RequestCardState, 'status'>, replayed: boolean): void {
    const existed = deps.store.getState().requests.some((r) => r.id === card.id);
    deps.store.dispatch({ type: 'request.received', card });
    if (!existed) {
      const created = deps.store.getState().requests.find((r) => r.id === card.id);
      try {
        if (created) deps.onNewCard?.(created, replayed);
      } catch {
        // A UI callback must never escape: the channel would answer -32603, which withdraws
        // an approval / blanks a clarify at 0.21.5 (review M3).
      }
    }
  }

  return {
    handleRequest(req) {
      const kind = kindForMethod(req.method);
      if (kind === null) return false; // desktop-only: channel answers -32601
      receive(
        {
          id: req.id,
          kind,
          method: req.method,
          params: req.params,
          legacy: false,
          receivedAt: safely(now, Date.now),
          anchorKey: safely(deps.anchorKey, () => null),
        },
        req.replayed === true,
      );
      if (kind === 'vault-declined') {
        req.fail(-32601, VAULT_DECLINED_MESSAGE); // first response wins → unanswered for all (spec §6.3)
        deps.store.dispatch({ type: 'request.answered', id: req.id, skipped: true });
        return true;
      }
      deps.registry.put(req);
      return true;
    },
    handleEvent(e) {
      if (e.type === 'request.cancel') {
        const p = (e.payload ?? {}) as { id?: unknown; reason?: unknown };
        if (typeof p.id === 'string') {
          deps.store.dispatch({ type: 'request.cancelled', id: p.id, reason: toCancelReason(p.reason) });
          deps.registry.drop(p.id);
        }
        return true;
      }
      if (isLegacyApprovalEvent(e)) {
        const payload = readLegacyApprovalPayload(e.payload);
        if (payload) {
          receive(
            {
              id: `legacy:${++legacyCounter}`,
              kind: 'approval',
              method: 'approval',
              params: payload,
              legacy: true,
              receivedAt: safely(now, Date.now),
              anchorKey: safely(deps.anchorKey, () => null),
            },
            e.replayed === true,
          );
        }
        return true;
      }
      return false;
    },
  };
}

/**
 * Live request cards warrant the Warning haptic; replayed deliveries and vault-declined
 * cards — nothing to answer — never do (contract §7 R4 / §8). Pure: fires no haptic itself
 * (no RN imports here) — the screen's `onNewCard` calls this and fires the haptic on true.
 */
export function shouldWarn(card: RequestCardState, replayed: boolean): boolean {
  return !replayed && card.kind !== 'vault-declined';
}
