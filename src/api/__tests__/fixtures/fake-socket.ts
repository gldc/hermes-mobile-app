// src/api/__tests__/fixtures/fake-socket.ts — EventTarget-style fake WebSocket shared by A's and B's
// tests. The vendored client uses addEventListener (never onopen/onmessage) and reads the GLOBAL
// `WebSocket.OPEN`, so tests call installFakeWebSocketGlobal() once (beforeAll).

type Listener = (ev: any) => void;

export class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  /** Every socket the factory built, in order (reconnects append). */
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  /** Outbound frames, parsed. */
  sent: any[] = [];
  closed = false;
  private listeners = new Map<string, Set<{ fn: Listener; once: boolean }>>();

  /** Zero-arg construction is supported (contract R2); the factory passes the dialed url. */
  constructor(public url = '') {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, fn: Listener, opts?: { once?: boolean }): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add({ fn, once: !!opts?.once });
  }

  removeEventListener(type: string, fn: Listener): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const l of set) if (l.fn === fn) set.delete(l);
  }

  private emit(type: string, ev: any): void {
    for (const l of [...(this.listeners.get(type) ?? [])]) {
      if (l.once) this.listeners.get(type)!.delete(l);
      l.fn(ev);
    }
  }

  send(text: string): void {
    if (this.readyState !== FakeSocket.OPEN) throw new Error('fake socket not open');
    this.sent.push(JSON.parse(text));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = FakeSocket.CLOSED;
    this.emit('close', { code: 1000, reason: '' });
  }

  // ── test drivers ──
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit('open', {});
  }
  /** Push one inbound frame (object → JSON text). */
  serverSend(frame: object): void {
    this.emit('message', { data: JSON.stringify(frame) });
  }
  /** Server-side drop (no client close() call). */
  drop(code = 1006): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = FakeSocket.CLOSED;
    this.emit('close', { code, reason: '' });
  }
  fail(): void {
    this.emit('error', {});
  }
  /** Outbound frames for one method. */
  sentFor(method: string): any[] {
    return this.sent.filter((f) => f.method === method);
  }
  /** Reply to the last outbound call of `method` with `result`. */
  reply(method: string, result: unknown): void {
    const f = [...this.sentFor(method)].pop();
    if (!f) throw new Error(`no outbound ${method}`);
    this.serverSend({ jsonrpc: '2.0', id: f.id, result });
  }
  replyError(method: string, code: number, message: string): void {
    const f = [...this.sentFor(method)].pop();
    if (!f) throw new Error(`no outbound ${method}`);
    this.serverSend({ jsonrpc: '2.0', id: f.id, error: { code, message } });
  }
}

let saved: unknown;
/** Install FakeSocket as globalThis.WebSocket (the vendored client reads WebSocket.OPEN). */
export function installFakeWebSocketGlobal(): void {
  saved = (globalThis as any).WebSocket;
  (globalThis as any).WebSocket = FakeSocket;
}
export function restoreWebSocketGlobal(): void {
  (globalThis as any).WebSocket = saved;
}
/** socketFactory for GatewayClient deps / JsonRpcGatewayClient options. */
export const fakeSocketFactory = (url: string) => new FakeSocket(url) as unknown as WebSocket;
export const lastSocket = (): FakeSocket => FakeSocket.instances[FakeSocket.instances.length - 1];
export function resetFakeSockets(): void {
  FakeSocket.instances = [];
}
