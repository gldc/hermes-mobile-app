// __tests__/secure-entry-data.test.ts
// Spec §6.4 data-handling rules, end to end through A's adapter: the value leaves only in the
// response frame — never in dispatched actions, the turn model, or any console.* call (even in __DEV__).
import { GatewayClient } from '../src/api/gatewayClient';
import {
  FakeSocket,
  installFakeWebSocketGlobal,
  restoreWebSocketGlobal,
} from '../src/api/__tests__/fixtures/fake-socket';
import { gatewayReady, serverRequest } from '../src/api/__tests__/fixtures/frames';
import { createRequestResponder } from '../src/lib/request-answers';
import { createRequestRegistry } from '../src/lib/request-registry';
import { initialTurnModel, reduceTurn, type RequestCardState, type TurnAction } from '../src/lib/turn-controller';

// Required by A's fixture contract: the vendored client reads the GLOBAL `WebSocket.OPEN`.
beforeAll(installFakeWebSocketGlobal);
afterAll(restoreWebSocketGlobal);

const SECRET = 'hunter2-DO-NOT-LEAK';

test.each([
  ['secret', { env_var: 'K', prompt: 'p', metadata: { skill_name: 'weather' } }],
  ['sudo', { command: 'apt-get install jq' }],
] as const)('%s value travels only in the response frame', async (method, extra) => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
  expect(__DEV__).toBe(true);
  const sock = new FakeSocket();
  const client = new GatewayClient({ socketFactory: () => sock as unknown as WebSocket });
  const registry = createRequestRegistry();
  client.onRequest((req) => {
    registry.put(req);
    return true;
  });
  const connected = client.connect('ws://gw.test/api/ws?ticket=t1');
  sock.open();
  sock.serverSend(gatewayReady({ replay_epoch: 'e1' }));
  await connected;
  const params = { session_id: 'live-1', ...extra };
  sock.serverSend(serverRequest('srq-v1', method, params));

  const actions: TurnAction[] = [];
  const fresh: Omit<RequestCardState, 'status'> = { id: 'srq-v1', kind: 'secure-entry', method, params, legacy: false, receivedAt: 0, anchorKey: null };
  const responder = createRequestResponder({
    registry,
    call: client.call.bind(client),
    dispatch: (a) => actions.push(a),
    liveSessionId: () => 'live-1',
    current: (id) => (id === fresh.id ? { ...fresh, status: 'pending' } : undefined),
  });
  expect(responder.value({ ...fresh, status: 'pending' }, SECRET)).toEqual({ ok: true });

  expect(sock.sent).toContainEqual(expect.objectContaining({ id: 'srq-v1', result: { value: SECRET } }));
  expect(JSON.stringify(actions)).not.toContain(SECRET);
  const model = actions.reduce(reduceTurn, reduceTurn(initialTurnModel(), { type: 'request.received', card: fresh }));
  expect(JSON.stringify(model)).not.toContain(SECRET);
  for (const s of spies) {
    expect(JSON.stringify(s.mock.calls)).not.toContain(SECRET);
    s.mockRestore();
  }
  client.close();
});
