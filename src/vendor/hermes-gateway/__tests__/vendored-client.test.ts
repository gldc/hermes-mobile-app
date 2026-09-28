import { JsonRpcGatewayClient } from '@/vendor/hermes-gateway';
import {
  fakeSocketFactory,
  installFakeWebSocketGlobal,
  lastSocket,
  resetFakeSockets,
  restoreWebSocketGlobal,
} from '@/api/__tests__/fixtures/fake-socket';
import { gatewayReady } from '@/api/__tests__/fixtures/frames';

beforeAll(installFakeWebSocketGlobal);
afterAll(restoreWebSocketGlobal);
beforeEach(resetFakeSockets);

const clients: JsonRpcGatewayClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close(); // rejects the pending capabilities call → no open timers
});

describe('vendored JsonRpcGatewayClient under jest-expo (RN env)', () => {
  it('connects through an injected EventTarget socket and advertises capabilities on gateway.ready', async () => {
    const client = new JsonRpcGatewayClient({ socketFactory: fakeSocketFactory, replay: false });
    clients.push(client);
    const connected = client.connect('ws://gw.test/api/ws?ticket=t1');
    const sock = lastSocket();
    expect(sock.url).toBe('ws://gw.test/api/ws?ticket=t1');
    sock.open();
    await connected;
    expect(client.connectionState).toBe('open');
    expect(sock.sent).toEqual([]); // nothing before gateway.ready
    sock.serverSend(gatewayReady({ replay_epoch: 'e1' }));
    expect(sock.sent).toEqual([
      expect.objectContaining({ method: 'client.capabilities', params: { server_requests: true } }),
    ]);
  });

  it('decodes a binary (ArrayBuffer) frame', async () => {
    const client = new JsonRpcGatewayClient({ socketFactory: fakeSocketFactory, replay: false });
    clients.push(client);
    const seen: string[] = [];
    client.onAny((e) => seen.push(e.type));
    const p = client.connect('ws://gw.test/api/ws?ticket=t2');
    const sock = lastSocket();
    sock.open();
    await p;
    const bytes = new TextEncoder().encode(JSON.stringify(gatewayReady()));
    (sock as any).emit('message', { data: bytes.buffer });
    expect(seen).toEqual(['gateway.ready']);
  });
});
