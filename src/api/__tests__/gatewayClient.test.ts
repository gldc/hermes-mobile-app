import { GatewayClient, RpcError } from '@/api/gatewayClient';
import {
  FakeSocket,
  fakeSocketFactory,
  installFakeWebSocketGlobal,
  lastSocket,
  resetFakeSockets,
  restoreWebSocketGlobal,
} from './fixtures/fake-socket';
import { event, gatewayReady, serverRequest } from './fixtures/frames';

beforeAll(installFakeWebSocketGlobal);
afterAll(restoreWebSocketGlobal);
beforeEach(resetFakeSockets);

const clients: GatewayClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

function make(opts: { readyTimeoutMs?: number } = {}) {
  const c = new GatewayClient({ socketFactory: fakeSocketFactory, ...opts });
  clients.push(c);
  return c;
}

/** connect() and drive the fake through open + gateway.ready. */
async function connected(c: GatewayClient, ready: object = gatewayReady({ replay_epoch: 'e1' })) {
  const p = c.connect('ws://gw.test/api/ws?ticket=t');
  const sock = lastSocket();
  sock.open();
  sock.serverSend(ready);
  await p;
  return sock;
}

describe('GatewayClient.connect', () => {
  it('does not resolve on open alone — only after gateway.ready', async () => {
    const c = make();
    let resolved = false;
    const p = c.connect('ws://gw.test/api/ws?ticket=t').then(() => (resolved = true));
    lastSocket().open();
    await new Promise((r) => setTimeout(r, 5));
    expect(resolved).toBe(false);
    lastSocket().serverSend(gatewayReady({ replay_epoch: 'e1' }));
    await p;
    expect(resolved).toBe(true);
    expect(c.isOpen).toBe(true);
  });

  it('puts client.capabilities on the wire before the first app call (frame order)', async () => {
    const c = make();
    const sock = await connected(c);
    void c.call('session.resume', { session_id: 'stored-1' }).catch(() => {});
    expect(sock.sent.map((f) => f.method)).toEqual(['client.capabilities', 'session.resume']);
  });

  it('rejects with RpcError when the socket closes before gateway.ready', async () => {
    const c = make();
    const p = c.connect('ws://gw.test/api/ws?ticket=t');
    lastSocket().open();
    lastSocket().drop();
    await expect(p).rejects.toBeInstanceOf(RpcError);
    expect(c.isOpen).toBe(false);
  });

  it('rejects when gateway.ready never arrives', async () => {
    const c = make({ readyTimeoutMs: 20 });
    const p = c.connect('ws://gw.test/api/ws?ticket=t');
    lastSocket().open();
    await expect(p).rejects.toThrow(/gateway\.ready/);
  });

  it('is reusable: a second connect() after invalidate() dials a fresh socket', async () => {
    const c = make();
    const first = await connected(c);
    c.invalidate();
    expect(first.closed).toBe(true);
    const second = await connected(c);
    expect(second).not.toBe(first);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(c.isOpen).toBe(true);
  });

  it('connect() on a zombie OPEN socket redials instead of short-circuiting', async () => {
    const c = make();
    const zombie = await connected(c);
    const again = await connected(c); // no explicit invalidate
    expect(again).not.toBe(zombie);
    expect(zombie.closed).toBe(true);
  });

  it('isOpen reads false when the OS tore the socket down without a close event', async () => {
    const c = make();
    const sock = await connected(c);
    sock.readyState = FakeSocket.CLOSED; // iOS suspension
    expect(c.isOpen).toBe(false);
  });
});

describe('GatewayClient.call', () => {
  it('resolves with the matching result', async () => {
    const c = make();
    const sock = await connected(c);
    const p = c.call('session.create', {});
    sock.reply('session.create', { session_id: 'live-1' });
    await expect(p).resolves.toEqual({ session_id: 'live-1' });
  });

  it('maps a gateway error to RpcError with its code', async () => {
    const c = make();
    const sock = await connected(c);
    const p = c.call('config.set', { session_id: 's', key: 'model', value: 'm' });
    sock.replyError('config.set', 4009, 'session busy');
    await expect(p).rejects.toBeInstanceOf(RpcError);
    await expect(p).rejects.toMatchObject({ code: 4009, message: 'session busy' });
  });

  it('uses code -1 when the error frame has no code', async () => {
    const c = make();
    const sock = await connected(c);
    const p = c.call('session.interrupt', { session_id: 's' });
    sock.serverSend({ jsonrpc: '2.0', id: sock.sentFor('session.interrupt')[0].id, error: { message: 'no code' } });
    await expect(p).rejects.toMatchObject({ code: -1, message: 'no code' });
  });

  it('rejects pending calls as RpcError(-1) when the socket drops', async () => {
    const c = make();
    const sock = await connected(c);
    const p = c.call('prompt.submit', { session_id: 's', text: 'x', queued: true });
    sock.drop();
    await expect(p).rejects.toMatchObject({ code: -1 });
  });

  it('rejects immediately when not connected', async () => {
    const c = make();
    await expect(c.call('session.create', {})).rejects.toBeInstanceOf(RpcError);
  });
});

describe('GatewayClient events and server requests', () => {
  it('delivers events (live and legacy) to onEvent', async () => {
    const c = make();
    const seen: string[] = [];
    c.onEvent((e) => seen.push(e.type));
    const sock = await connected(c);
    sock.serverSend(event('message.delta', { text: 'hi' }, { session_id: 'live-1', seq: 3 }));
    sock.serverSend(event('approval.request', { command: 'rm -rf /tmp/x' }, { session_id: 'live-1' }));
    expect(seen).toEqual(['gateway.ready', 'message.delta', 'approval.request']);
  });

  it('answers an unhandled desktop-only request with -32601', async () => {
    const c = make();
    c.onRequest((req) => (req.method === 'approval' ? true : false));
    const sock = await connected(c);
    sock.serverSend(serverRequest('srq-1', 'terminal.read', { session_id: 'live-1' }));
    expect(sock.sent.find((f) => f.id === 'srq-1')).toMatchObject({ error: { code: -32601 } });
  });

  it('routes a respond() for an accepted request out on the current socket, never logging it', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      jest.spyOn(console, k).mockImplementation(() => {}),
    );
    const c = make();
    c.onRequest((req) => {
      if (req.method !== 'secret') return false;
      req.respond({ value: 'hunter2-secret' });
      return true;
    });
    const sock = await connected(c);
    sock.serverSend(serverRequest('srq-9', 'secret', { session_id: 'live-1', env_var: 'K', prompt: 'p' }));
    expect(sock.sent.find((f) => f.id === 'srq-9')).toEqual({ jsonrpc: '2.0', id: 'srq-9', result: { value: 'hunter2-secret' } });
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain('hunter2-secret');
      s.mockRestore();
    }
  });
});

describe('0.20.4 legacy gateway', () => {
  it('survives a ready without heartbeat/replay_epoch and a -32601 for client.capabilities', async () => {
    const c = make();
    const events: string[] = [];
    c.onEvent((e) => events.push(e.type));
    const sock = await connected(c, gatewayReady());
    sock.replyError('client.capabilities', -32601, 'unknown method');
    sock.serverSend(event('approval.request', { command: 'rm -rf build' }, { session_id: 'live-1' }));
    const p = c.call('approval.respond', { session_id: 'live-1', choice: 'once' });
    sock.reply('approval.respond', { resolved: 1 });
    await expect(p).resolves.toEqual({ resolved: 1 });
    expect(events).toEqual(['gateway.ready', 'approval.request']);
    expect(c.isOpen).toBe(true);
  });
});

// Compile-level checks (tsc runs over test files; this function never executes).
function _typecheckOnly(c: GatewayClient) {
  // @ts-expect-error — unknown param key is a compile error (spec §4.3)
  void c.call('prompt.submit', { session_id: 's', text: 'x', bogus: true });
  // @ts-expect-error — unknown method is a compile error
  void c.call('not.a.method', {});
}
void _typecheckOnly;
