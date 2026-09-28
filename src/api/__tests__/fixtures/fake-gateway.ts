// src/api/__tests__/fixtures/fake-gateway.ts — a scripted gateway on top of FakeSocket for
// integration tests (shared with plan B). Each socket the factory builds auto-opens and sends
// `gateway.ready` on the next macrotask; outbound calls are answered by `responders`.
import { FakeSocket } from './fake-socket';
import { gatewayReady } from './frames';

export type Responder = (params: any, sock: FakeSocket) => unknown | { __error: { code: number; message: string } } | typeof HOLD;
/** Return HOLD from a responder to leave the call unanswered (answer later with sock.reply). */
export const HOLD = Symbol('hold');

export interface FakeGateway {
  factory: (url: string) => WebSocket;
  sockets: FakeSocket[];
  current(): FakeSocket;
  responders: Record<string, Responder>;
  /** gateway.ready payload for the next sockets (default: 0.21.5 shape). */
  ready: { heartbeat?: boolean; replay_epoch?: string } | null;
  /** Set false to leave new sockets CONNECTING (drive them by hand). */
  autoOpen: boolean;
}

export const rpcErr = (code: number, message: string) => ({ __error: { code, message } });

export function createFakeGateway(): FakeGateway {
  const gw: FakeGateway = {
    sockets: [],
    responders: { 'client.capabilities': () => ({ methods: [] }) },
    ready: { replay_epoch: 'e1' },
    autoOpen: true,
    current: () => gw.sockets[gw.sockets.length - 1],
    factory: (url) => {
      const sock = new FakeSocket(url);
      gw.sockets.push(sock);
      const origSend = sock.send.bind(sock);
      sock.send = (text: string) => {
        origSend(text);
        const frame = JSON.parse(text);
        if (typeof frame.method !== 'string' || frame.id === undefined) return; // responses to srq-*
        const r = gw.responders[frame.method];
        if (!r) return;
        const out = r(frame.params, sock);
        if (out === HOLD) return;
        setTimeout(() => {
          if (sock.closed) return;
          if (out && typeof out === 'object' && '__error' in (out as object)) {
            sock.serverSend({ jsonrpc: '2.0', id: frame.id, error: (out as any).__error });
          } else {
            sock.serverSend({ jsonrpc: '2.0', id: frame.id, result: out });
          }
        }, 0);
      };
      if (gw.autoOpen) {
        setTimeout(() => {
          if (sock.closed) return;
          sock.open();
          sock.serverSend(gatewayReady(gw.ready ?? {}));
        }, 0);
      }
      return sock as unknown as WebSocket;
    },
  };
  return gw;
}
