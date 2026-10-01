// __tests__/mcpSession.test.ts
import { RpcError } from '../src/api/gatewayClient';
import { mcpServerStatus, testMcpServer } from '../src/api/mcpSession';

function recorder(result: unknown) {
  const calls: { method: string; params: unknown }[] = [];
  const call = async (method: string, params: unknown) => {
    calls.push({ method, params });
    if (result instanceof Error) throw result;
    return result;
  };
  return { call: call as any, calls };
}

describe('testMcpServer', () => {
  it('calls mcp.servers.test with the name and maps a success', async () => {
    const r = recorder({
      ok: true,
      tools: [{ name: 'search', description: 'Search issues' }],
      prompts: 2,
      resources: 1,
      oauth_needed: true,
      oauth_tokens_present: true,
    });
    const out = await testMcpServer(r.call, 'linear');
    expect(r.calls).toEqual([{ method: 'mcp.servers.test', params: { name: 'linear' } }]);
    expect(out).toEqual({
      kind: 'ok',
      tools: [{ name: 'search', description: 'Search issues' }],
      prompts: 2,
      resources: 1,
      tokensPresent: true,
    });
  });

  it('adds the profile only when one is selected', async () => {
    const r = recorder({ ok: true, tools: [], oauth_needed: false });
    await testMcpServer(r.call, 'x', 'work');
    await testMcpServer(r.call, 'x', null);
    expect(r.calls[0].params).toEqual({ name: 'x', profile: 'work' });
    expect(r.calls[1].params).toEqual({ name: 'x' });
  });

  it('defaults missing counts to 0 and a missing token flag to null', async () => {
    const r = recorder({ ok: true, tools: [], oauth_needed: false });
    expect(await testMcpServer(r.call, 'x')).toEqual({ kind: 'ok', tools: [], prompts: 0, resources: 0, tokensPresent: null });
  });

  it('maps ok:false to failed with the gateway error and the token flag', async () => {
    const r = recorder({
      ok: false,
      tools: [],
      error: 'OAuth authentication required — no token found.',
      oauth_needed: true,
      oauth_tokens_present: false,
    });
    expect(await testMcpServer(r.call, 'x')).toEqual({
      kind: 'failed',
      message: 'OAuth authentication required — no token found.',
      oauthNeeded: true,
      tokensPresent: false,
    });
  });

  it('gives a failed test without error text a plain message', async () => {
    const r = recorder({ ok: false, tools: [], oauth_needed: false });
    const out = await testMcpServer(r.call, 'x');
    expect(out).toEqual({ kind: 'failed', message: 'The connector did not respond.', oauthNeeded: false, tokensPresent: null });
  });

  it('maps a rejected call to error instead of throwing', async () => {
    const r = recorder(new RpcError("server 'x' not found", 4064));
    expect(await testMcpServer(r.call, 'x')).toEqual({ kind: 'error', message: "server 'x' not found" });
  });
});

describe('mcpServerStatus', () => {
  const row = { name: 'linear', transport: 'http', tools: 12, connected: true, disabled: false, status: 'connected', source: 'config', plugin: null };

  it('returns the rows', async () => {
    const r = recorder({ servers: [row], checked_at: 1 });
    expect(await mcpServerStatus(r.call, 'work')).toEqual([row]);
    expect(r.calls).toEqual([{ method: 'mcp.servers.status', params: { profile: 'work' } }]);
  });

  it('sends no profile for the gateway default', async () => {
    const r = recorder({ servers: [], checked_at: 1 });
    await mcpServerStatus(r.call);
    expect(r.calls[0].params).toEqual({});
  });

  it('returns [] when the call fails', async () => {
    const r = recorder(new RpcError('socket closed', -1));
    expect(await mcpServerStatus(r.call)).toEqual([]);
  });
});
