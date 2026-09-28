// src/api/chat-transport.ts — one chat screen's transport, built ONCE per screen (spec §4.2):
// the GatewayClient, the turn store, the request registry/router and the reconnect
// orchestrator, with every handler registered at construction, before the first connect().
import type { GatewayEvent, RpcMethods } from '@/vendor/hermes-gateway';
import {
  createReconnectOrchestrator,
  seedFromResume,
  type ReconnectOrchestrator,
  type ReconnectPhase,
} from '@/lib/reconnect-orchestrator';
import { createRequestRegistry, type RequestRegistry } from '@/lib/request-registry';
import { createRequestRouter } from '@/lib/request-router';
import { turnActionFor, type RequestCardState } from '@/lib/turn-controller';
import { createTurnStore, type TurnStore } from '@/lib/turn-store';
import { GatewayClient } from './gatewayClient';

type ResumeResult = RpcMethods['session.resume']['result'];

export interface ChatTransportOptions {
  socketFactory: (url: string) => WebSocket;
  mintUrl: () => Promise<string>;
  storedSessionId: () => string | null;
  resumeParams: () => RpcMethods['session.resume']['params'];
  loadHistory: (storedId: string) => Promise<void>;
  onLiveSessionId: (liveId: string) => void;
  onResumed?: (res: ResumeResult) => void;
  onPhase?: (p: ReconnectPhase) => void;
  /** Transcript side of every event (live and replayed), AFTER the turn store has been updated.
   * Not called for events the request router consumed (request.cancel, legacy approval.request). */
  applyEvent: (e: GatewayEvent) => void;
  /** Key of the last transcript item (a new card's anchor). */
  anchorKey: () => string | null;
  onNewCard?: (card: RequestCardState, replayed: boolean) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  requestTimeoutMs?: number;
}

export interface ChatTransport {
  client: GatewayClient;
  store: TurnStore;
  registry: RequestRegistry;
  orchestrator: ReconnectOrchestrator;
  /** session.resume on the stored id → fresh live id (the 4001 stale-session recovery). */
  resumeStored(): Promise<string>;
  dispose(): void;
}

export function createChatTransport(opts: ChatTransportOptions): ChatTransport {
  const client = new GatewayClient({ socketFactory: opts.socketFactory, requestTimeoutMs: opts.requestTimeoutMs });
  const store = createTurnStore();
  const registry = createRequestRegistry();
  const router = createRequestRouter({
    store,
    registry,
    anchorKey: opts.anchorKey,
    now: opts.now,
    onNewCard: opts.onNewCard,
  });

  /** The single event sink: request routing, then turn state, then the transcript. */
  function sink(e: GatewayEvent): void {
    if (router.handleEvent(e)) return;
    const action = turnActionFor(e);
    if (action) store.dispatch(action);
    opts.applyEvent(e);
  }

  const orchestrator = createReconnectOrchestrator({
    client,
    mintUrl: opts.mintUrl,
    storedSessionId: opts.storedSessionId,
    resumeParams: opts.resumeParams,
    loadHistory: opts.loadHistory,
    dispatch: (a) => store.dispatch(a),
    applyReplayedEvent: sink,
    onLiveSessionId: opts.onLiveSessionId,
    onResumed: opts.onResumed,
    onPhase: opts.onPhase,
    sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  });

  // Registration order matters: requests first (review M3), then events, then state.
  client.onRequest((req) => router.handleRequest(req));
  client.onEvent((e) => orchestrator.onLiveEvent(e));
  client.onState((s) => {
    // start()'s caller owns a failure this reconnect may join; reconnect's own attempts never reject.
    if (s === 'closed') orchestrator.reconnect('close').catch(() => {});
  });

  let disposed = false;
  return {
    client,
    store,
    registry,
    orchestrator,
    async resumeStored() {
      const res = await client.call('session.resume', opts.resumeParams());
      seedFromResume(res, { onLiveSessionId: opts.onLiveSessionId, onResumed: opts.onResumed, dispatch: store.dispatch });
      return res.session_id;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      orchestrator.dispose(); // FIRST: the close below must not start a reconnect
      client.close();
    },
  };
}
