// src/api/__tests__/fixtures/frames.ts — builders for inbound gateway frames (shared with plan B).

/** `gateway.ready`. Both options omitted = the 0.20.4 shape ({skin, change_events}). */
export function gatewayReady(opts: { heartbeat?: boolean; replay_epoch?: string } = {}): object {
  return {
    jsonrpc: '2.0',
    method: 'event',
    params: { type: 'gateway.ready', payload: { skin: {}, change_events: false, ...opts } },
  };
}

export function serverRequest(id: string, method: string, params: Record<string, unknown>): object {
  return { jsonrpc: '2.0', id, method, params };
}

export function event(
  type: string,
  payload: unknown,
  opts: { session_id?: string; seq?: number } = {},
): object {
  return { jsonrpc: '2.0', method: 'event', params: { type, payload, ...opts } };
}

export function rpcResult(id: string | number, result: unknown): object {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(id: string | number, code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
