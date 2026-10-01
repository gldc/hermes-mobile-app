// src/api/mcpSession.ts — the connector RPCs that ride the active chat's socket
// (docs/contracts/mcp.md). Test goes here, not over REST, because it really
// connects and can take a minute: a slow REST request can lose a refresh-token
// rotation (spec §4). I/O is injected (`call`) so this is unit-testable.
import type { RpcMethods } from '@/vendor/hermes-gateway';
import type { GatewayClient } from './gatewayClient';
import type { McpTool } from './mcp';
import { withProfile } from './profiles';

/** One row of `mcp.servers.status`: what the running gateway has loaded. */
export type McpRuntimeRow = RpcMethods['mcp.servers.status']['result']['servers'][number];

export type McpTestOutcome =
  | { kind: 'ok'; tools: McpTool[]; prompts: number; resources: number; tokensPresent: boolean | null }
  /** The gateway ran the test and the connector failed it. */
  | { kind: 'failed'; message: string; oauthNeeded: boolean; tokensPresent: boolean | null }
  /** The call itself failed (socket closed, unknown server, timeout). */
  | { kind: 'error'; message: string };

/** Connect, list tools, disconnect. Never rejects. */
export async function testMcpServer(
  call: GatewayClient['call'],
  name: string,
  profile?: string | null,
): Promise<McpTestOutcome> {
  try {
    const res = await call('mcp.servers.test', withProfile({ name }, profile));
    const tokensPresent = res.oauth_tokens_present ?? null;
    if (!res.ok) {
      return {
        kind: 'failed',
        message: res.error || 'The connector did not respond.',
        oauthNeeded: Boolean(res.oauth_needed),
        tokensPresent,
      };
    }
    return { kind: 'ok', tools: res.tools ?? [], prompts: res.prompts ?? 0, resources: res.resources ?? 0, tokensPresent };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Cached runtime state per configured server; the gateway never connects for this. `[]` on failure. */
export async function mcpServerStatus(call: GatewayClient['call'], profile?: string | null): Promise<McpRuntimeRow[]> {
  try {
    const res = await call('mcp.servers.status', withProfile({}, profile));
    return res.servers ?? [];
  } catch {
    return [];
  }
}
