// __tests__/gatewayClient.test.ts
import { GatewayClient } from '../src/api/gatewayClient';
import type { GatewayEvent } from '../src/api/types';

class FakeSocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.({ code: 1000, reason: '' }); }
  // test helpers
  open() { this.onopen?.(); }
  receive(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

function connected() {
  const sock = new FakeSocket();
  const client = new GatewayClient(() => sock as any);
  const ready = client.connect('ws://h/api/ws?ticket=t');
  sock.open();
  return { sock, client, ready };
}

describe('GatewayClient', () => {
  it('resolves connect() on open', async () => {
    const { ready } = connected();
    await expect(ready).resolves.toBeUndefined();
  });

  it('call() sends JSON-RPC and resolves with the matching result', async () => {
    const { sock, client, ready } = connected();
    await ready;
    const p = client.call('session.create', { title: 'hi' });
    const sentFrame = JSON.parse(sock.sent[0]);
    expect(sentFrame).toMatchObject({ jsonrpc: '2.0', method: 'session.create', params: { title: 'hi' } });
    sock.receive({ jsonrpc: '2.0', id: sentFrame.id, result: { session_id: 'abc' } });
    await expect(p).resolves.toEqual({ session_id: 'abc' });
  });

  it('call() rejects on JSON-RPC error response', async () => {
    const { sock, client, ready } = connected();
    await ready;
    const p = client.call('prompt.submit', { session_id: 'x', text: 'y' });
    const id = JSON.parse(sock.sent[0]).id;
    sock.receive({ jsonrpc: '2.0', id, error: { code: -32000, message: 'boom' } });
    await expect(p).rejects.toThrow('boom');
  });

  it('dispatches event frames to the handler', async () => {
    const { sock, client, ready } = connected();
    await ready;
    const events: GatewayEvent[] = [];
    client.onEvent((e) => events.push(e));
    sock.receive({ jsonrpc: '2.0', method: 'event',
      params: { type: 'message.delta', session_id: 's1', payload: { text: 'Hel' } } });
    sock.receive({ jsonrpc: '2.0', method: 'event',
      params: { type: 'message.complete', session_id: 's1' } });
    expect(events).toEqual([
      { type: 'message.delta', session_id: 's1', payload: { text: 'Hel' } },
      { type: 'message.complete', session_id: 's1' },
    ]);
  });

  it('rejects pending calls when the socket closes', async () => {
    const { sock, client, ready } = connected();
    await ready;
    const p = client.call('session.list', {});
    sock.close();
    await expect(p).rejects.toThrow(/closed/i);
  });
});
