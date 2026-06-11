// src/api/gatewayClient.ts
import type { GatewayEvent } from './types';

/** Minimal structural type so tests can inject a fake and RN's WebSocket fits. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class GatewayClient {
  private socket: SocketLike | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private eventHandlers = new Set<(e: GatewayEvent) => void>();
  private closeHandlers = new Set<(reason: string) => void>();

  constructor(private readonly makeSocket: (url: string) => SocketLike) {}

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = this.makeSocket(url);
      this.socket = sock;
      sock.onopen = () => resolve();
      sock.onerror = () => reject(new Error('websocket connection failed'));
      sock.onclose = (ev) => this.handleClose(ev.reason || `code ${ev.code}`);
      sock.onmessage = (ev) => this.handleFrame(ev.data);
    });
  }

  call<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
    const sock = this.socket;
    if (!sock) return Promise.reject(new Error('not connected'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      sock.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  onEvent(handler: (e: GatewayEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onClose(handler: (reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    this.socket?.close();
  }

  private handleFrame(data: string): void {
    let frame: any;
    try { frame = JSON.parse(data); } catch { return; }
    if (frame.method === 'event' && frame.params) {
      const e: GatewayEvent = {
        type: frame.params.type,
        ...(frame.params.session_id !== undefined && { session_id: frame.params.session_id }),
        ...(frame.params.payload !== undefined && { payload: frame.params.payload }),
      };
      for (const h of this.eventHandlers) h(e);
      return;
    }
    if (frame.id !== undefined) {
      const p = this.pending.get(frame.id);
      if (!p) return;
      this.pending.delete(frame.id);
      if (frame.error) p.reject(new Error(frame.error.message ?? 'gateway error'));
      else p.resolve(frame.result);
    }
  }

  private handleClose(reason: string): void {
    const err = new Error(`websocket closed: ${reason}`);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.socket = null;
    for (const h of this.closeHandlers) h(reason);
  }
}

/** Production socket factory. extraHeaders is the React Native WebSocket
 * options escape hatch — used only if the server's Origin check rejects us
 * (then pass { Origin: httpOrigin }). */
export function makeNativeSocket(url: string, extraHeaders?: Record<string, string>): SocketLike {
  // RN's WebSocket accepts an options object with headers as the 3rd arg.
  return new (WebSocket as any)(url, null, extraHeaders ? { headers: extraHeaders } : undefined);
}
