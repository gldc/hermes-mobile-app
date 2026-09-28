# App A — Transport against hermes 0.21.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Revision log (review 2026-09-28)

1. Task 8 `onNewCard`: the Warning haptic no longer fires for `vault-declined` cards (declined on arrival,
   nothing to answer). One-line conditional; the verified code is otherwise unchanged.
2. **Merge order** (all three app plans): A merges first (B is cut from A's merged `main`); C is
   independent and merges before B (C and B both edit `composer.tsx`; B's plan is written against C's file).
3. **Open finding, needs a decision (not patched here):** the in-flight replay uses the highest seq seen
   as `last_seen`, and `loadHistory` replaces `items` before the replay. For a turn that was streaming
   when the socket dropped, the text streamed *before* the drop is unpersisted, so the history replace
   removes it and the replay (seq > watermark) does not bring it back — only text streamed during the gap
   reappears. Spec §10.2 expects "reconnect mid-turn → the partial text is restored". Options for
   Gianluca: (a) accept the loss and amend the spec; (b) track a second, per-turn watermark (the seq of the
   last `message.complete`/`message.start` seen) and replay from it while `running`, so the batch holds the
   whole unpersisted turn and the existing "apply after the last `message.complete`" rule dedupes it
   (bounded by the server buffer — `truncated` still skips); (c) keep the trailing incomplete assistant
   item across the history replace. (b) is the smallest change consistent with spec §7.4. Plan B Task 11
   Step 8 item 2b records what actually happens on 0.21.5.

**Goal:** Replace the hand-written WebSocket JSON-RPC client with the vendored upstream client behind a typed adapter, and move the chat screen to one persistent transport per screen. That transport includes server→client request routing, a server-driven turn controller, and a tested single-flight reconnect orchestrator (resume → history → in-flight replay). The result works on a 0.20.4 gateway (legacy approvals) and is ready for 0.21.5.

**Architecture:** `src/vendor/hermes-gateway/` holds byte-pinned upstream files, reached only through an app-owned barrel. `src/api/gatewayClient.ts` adapts `JsonRpcGatewayClient`: it gates `connect()` on `gateway.ready` plus one tick, maps errors to `RpcError`, and runs with `replay:false`. Four pure modules in `src/lib/` hold the logic:
- `turn-controller.ts` and `turn-store.ts`: turn state and request cards, outside React;
- `request-registry.ts` and `request-router.ts`: the live request objects and the routing rule;
- `reconnect-orchestrator.ts`: the §7 sequence.

`src/api/chat-transport.ts` builds one of each per screen and registers every handler at construction. `chat/[id].tsx` keeps only rendering and wiring.

**Tech Stack:** Expo SDK 56, React Native 0.85, TypeScript 6 (strict), jest-expo 56 (node env). No new dependencies. No `@testing-library/react-native` and no `jest.setup.ts` are introduced (contract R6).

**Spec:** `docs/superpowers/specs/2026-09-28-control-path-0.21.5-design.md` (rev 2, approved). **Binding contract:** `docs/superpowers/plans/2026-09-28-00-interfaces.md` (items assigned to A, including D1/D2/R1–R6). **Research:** `docs/research/2026-09-28-api-delta-0.21.5.md`, `docs/research/2026-09-28-spec-review.md`.

**Branch:** the executor creates `feat/transport-0.21.5` off `main` in a worktree (superpowers:using-git-worktrees): `git fetch origin && git worktree add ../hermes-mobile-app-A -b feat/transport-0.21.5 origin/main`. The spec and contract live on `docs/control-path-0.21.5-spec`; read them there, for example `git show docs/control-path-0.21.5-spec:docs/superpowers/specs/2026-09-28-control-path-0.21.5-design.md`. Never push `main`.

**Every code block below was compiled and run** (tsc exit 0, jest green) against a scratch copy of `main` (9d09258). If an exact-match `Edit` fails, stop: the tree has drifted.

## Global Constraints

- Vendor `apps/shared/src/{json-rpc-channel,json-rpc-gateway,gateway-events,gateway-contract.generated}.ts` plus repo-root `LICENSE` from `NousResearch/hermes-agent@v2026.9.24` (commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`) into `src/vendor/hermes-gateway/`. The **only** edit allowed is stripping the `.js` suffix from relative import specifiers.
- App code imports vendored symbols **only** through `@/vendor/hermes-gateway` (the barrel). The adapter is the only runtime user.
- There is **one** `JsonRpcGatewayClient` per chat screen, reused across reconnects: `invalidate()` → mint a fresh single-use ticket → `connect(newUrl)`.
- `onRequest`, the event subscriptions and state changes are registered **once, at construction, before the first `connect()`**, and never torn down and re-added.
- `connect()` resolves only after socket open, **`gateway.ready` received**, and one macrotask tick.
- The vendored client runs with `replay: false`. `requestTimeoutMs` defaults to `120_000`.
- `JsonRpcGatewayError{code}` → `RpcError(message, code)`. Any other rejection gets code `-1`.
- Every RPC params/result, server-request and event type comes from `gateway-contract.generated.ts`, and unknown param keys are a compile error. The one app-owned gateway type is the legacy `approval.request` payload, in `src/api/legacy-approval.ts`.
- No `-32601` may ever go out for `approval`, `clarify`, `sudo` or `secret`. Vault methods (`vault.unlock_prompt`, `vault.save_login`, `vault.code`) get `-32601` plus the note "Hermes asked for a password-manager action — declined on the phone." Desktop-only methods get a silent `-32601`.
- Every idle-state submit is `prompt.submit {session_id, text, queued:true}`.
- `4001` → resume the stored id, then retry **once**. This plan applies it to `config.set`; B uses the same helper for stop and steer.
- Events with `replayed:true` update state but never fire haptics or one-shot side effects.
- The adapter never logs outbound response frames, including `sudo` and `secret`, even in `__DEV__`.
- `src/api/types.ts` loses every overlapping gateway type. REST shapes stay.
- AGENTS.md rules apply:
  - `process.env.EXPO_OS`, never `Platform.OS`;
  - never import `@react-navigation/*`;
  - colors only from `useTheme()`;
  - the React Compiler is on, so add no new hand memoization. The screen keeps its existing `useMemo` pattern for list data, now applied to the merged rows.
- **Commit gate:** `npx tsc --noEmit && npx jest`, both exit 0. There is no CI workflow in this repo, so this local gate is the "CI green" gate, and it is judged on the **exit code**, not a `tail`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These are the five failure modes most likely to bite Gianluca that the spec implies but does not spell out as tests. Each is pinned by a test in the owning task:

1. **A reconnect during resume.** The socket drops again while `session.resume` is in flight. Expected: one clean single-flight run, a third socket, and the open clarify card still present and answerable. Test: Task 6, "reconnect DURING resume".
2. **A duplicate replay.** The same open request comes back through **both** `session.resume` and `session.events.since` in one reconnect, and a live delta races the replay response. Expected: one card, and each delta applied once. Tests: Task 6, "duplicate replay"; Task 5, "parks live events … deduped by seq".
3. **A heartbeat and a foreground in the same tick.** The vendored heartbeat `invalidate()` (→ `onState('closed')`) and the AppState foreground reconnect fire together after an iOS suspension. Expected: exactly one new socket. Tests: Task 6, "heartbeat-style invalidate + foreground"; Task 5, "close + heartbeat + foreground + stop-timeout during one run".
4. **A `-32601`/`-32603` on a supported method.** An `open_requests` replay arrives before any UI state exists, or a UI callback throws while a card is being created. The channel would answer `-32603`, which **withdraws an approval** at 0.21.5. Expected: a card, and nothing on the wire. Tests: Task 6, "open_requests … NO -32601" and "a throwing UI callback …"; Task 4 router try/catch.
5. **A stale live session id.** After a reconnect, `session.resume` returns a *different* runtime id (the session was rebuilt), and a later call on the old id gets `4001`. Expected: one resume, one retry on the fresh id, and a second `4001` surfaced rather than looped. Tests: Task 6, "stale live session id"; Task 7, `config.set` 4001.

## Contract deviations

All of these are additive or clarifications. Nothing listed in the contract is renamed or re-typed.

1. **Additions to `OrchestratorDeps` and `ReconnectOrchestrator` (§5).**
   - Two optional deps:
     - `onResumed?(res)` is needed for the model pill from `res.info`.
     - `onPhase?(p: ReconnectPhase)` is needed for the "reconnecting (n/5)" note, the final error and `ready`.
   - `ReconnectOrchestrator.start(): Promise<void>` is the initial connect: one attempt, no backoff, rejecting on failure. It shares the same single-flight slot, so a foreground trigger during the initial connect joins it. This replaces today's `reconnectingRef = true` hold-off.
2. **`applyReplayedEvent` is the single event sink.** Live events that are not parked, and parked events flushed after the replay, reach it unchanged (no `replayed` flag). Replayed events arrive as `{...e, replayed: true}`. The contract has no separate live sink, and adding one would re-home the dep.
3. **The barrel exports `JsonRpcGatewayError` as a value.** It is a class, and the adapter needs `instanceof`. Everything else is exported exactly as listed (`JsonRpcGatewayClient` is a value, the rest are types).
4. **`GatewayClientDeps.readyTimeoutMs?`** (optional, default 15 000) bounds the `gateway.ready` wait. `makeNativeSocket(url)` drops its unused `extraHeaders` parameter (review m1) and returns `WebSocket`.
5. **The `'heartbeat'` trigger cannot be told apart.** The vendored heartbeat failure calls `invalidate()`, which surfaces as `onState('closed')`, the same signal as a real socket close. The transport therefore calls `reconnect('close')` for both. `'heartbeat'` stays in the trigger union.
6. **`resume.seeded {running:true}` while `stopping` stays `stopping`.** A Stop already in flight keeps waiting for `message.complete`. The contract comment "true → streaming" holds for every other state.
7. **Additive exports that B should reuse:**
   - `src/lib/turn-controller.ts`: `turnActionFor`, `completeStatus`, `resumeRunning`, `toCancelReason`, `mergeRequestRows` / `TranscriptRow`;
   - `src/lib/turn-store.ts`: `createTurnStore` / `TurnStore`;
   - `src/lib/request-router.ts`: `createRequestRouter`, `VAULT_DECLINED_MESSAGE`. This is where the contract's routing rule lives;
   - `src/api/chat-transport.ts`: `createChatTransport` / `ChatTransport` with `resumeStored()`;
   - `src/api/stale-session.ts`: `withStaleSessionRetry`, `STALE_SESSION_CODE`;
   - `readLegacyApprovalPayload` in `legacy-approval.ts`;
   - a third fixture, `src/api/__tests__/fixtures/fake-gateway.ts`: `createFakeGateway`, `HOLD`, `rpcErr`;
   - `FakeSocket` helpers: `installFakeWebSocketGlobal()` (**required**, because the vendored client reads the global `WebSocket.OPEN`), `reply`, `replyError`, `drop`, `sentFor`, `lastSocket`, `resetFakeSockets`.
8. **Vault cards are settled at once.** After `req.fail(-32601,…)` the router dispatches `request.answered {skipped:true}`, so the card reads as settled.

## File map

| file | action | responsibility |
|---|---|---|
| `scripts/sync-gateway-contract.sh` | create | vendors the files at a tag, rewrites `.js` specifiers, writes `VENDORED.json`; `--verify` re-checks the upstream hashes |
| `src/vendor/hermes-gateway/{4 .ts, LICENSE, VENDORED.json}` | generated | upstream bytes, never hand-edited |
| `src/vendor/hermes-gateway/index.ts` | create | the barrel, with the runtime-dependency header |
| `src/vendor/hermes-gateway/__tests__/{drift,vendored-client}.test.ts` | create | drift guard; proof that the client runs under RN/jest |
| `src/api/__tests__/fixtures/{fake-socket,frames,fake-gateway}.ts` | create | shared test fixtures (contract §6) |
| `eslint.config.js` | modify | ignore the vendored files, so `--fix` can never touch them |
| `src/api/gatewayClient.ts` | rewrite | the adapter (contract §2) |
| `src/api/__tests__/gatewayClient.test.ts` | create (replaces `__tests__/gatewayClient.test.ts`) | adapter tests on the fake socket |
| `src/lib/turn-controller.ts`, `src/lib/turn-store.ts` | create | turn and request-card reducer; the external store |
| `src/api/legacy-approval.ts`, `src/lib/request-registry.ts`, `src/lib/request-router.ts` | create | the legacy type; live request objects; the routing rule |
| `src/lib/reconnect-orchestrator.ts` | create | the §7 single-flight sequence |
| `src/api/stale-session.ts`, `src/api/chat-transport.ts` | create | the 4001 rule; per-screen wiring |
| `src/api/sessionModel.ts`, `src/api/search.ts` | modify | `config.set` typing + 4001; `>>>…<<<` snippets |
| `src/connection.ts` | modify | `openGateway()` → `mintGatewayUrl()` |
| `src/lib/model-pill.ts` | modify | `withResumedModel` accepts the generated nullable `SessionLiveInfo` |
| `src/app/chat/[id].tsx` | modify | rendering and wiring only |
| `src/api/types.ts` | modify | delete the overlapping gateway types |
| `AGENTS.md` | modify | architecture and wire-contract lines |

---

### Task 1: Vendor the upstream client and prove it runs under RN/jest

**Files:**
- Create: `scripts/sync-gateway-contract.sh`, `src/vendor/hermes-gateway/index.ts`, `src/vendor/hermes-gateway/__tests__/vendored-client.test.ts`, `src/vendor/hermes-gateway/__tests__/drift.test.ts`, `src/api/__tests__/fixtures/fake-socket.ts`, `src/api/__tests__/fixtures/frames.ts`
- Generated: `src/vendor/hermes-gateway/{json-rpc-channel,json-rpc-gateway,gateway-events,gateway-contract.generated}.ts`, `LICENSE`, `VENDORED.json`
- Modify: `eslint.config.js`

**Interfaces:**
- Produces: the barrel (contract §1); `FakeSocket` (a zero-arg constructor is allowed; `open()`; `sent: any[]`, holding parsed frames; `serverSend(frame)`), `installFakeWebSocketGlobal()`, `fakeSocketFactory`, `lastSocket()`, `resetFakeSockets()`; `gatewayReady/serverRequest/event/rpcResult/rpcError`.

- [ ] **Step 1: Write the fixtures and the failing tests**

`src/api/__tests__/fixtures/fake-socket.ts`:

```ts
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
```

`src/api/__tests__/fixtures/frames.ts`:

```ts
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
```

`src/vendor/hermes-gateway/__tests__/vendored-client.test.ts`: this is the RN/jest proof that everything else depends on.

```ts
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

  it('module-top TextDecoder resolved (binary frame decodes)', async () => {
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
```

`src/vendor/hermes-gateway/__tests__/drift.test.ts`:

```ts
// Drift guard: the vendored files are byte-for-byte what scripts/sync-gateway-contract.sh wrote.
// Any hand edit fails here — re-vendor with the script instead.
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(dir, 'VENDORED.json'), 'utf8')) as {
  tag: string;
  commit: string;
  files: Record<string, { upstream_sha256: string; vendored_sha256: string }>;
};
const sha = (name: string) => createHash('sha256').update(readFileSync(join(dir, name))).digest('hex');

describe('vendored hermes-gateway drift guard', () => {
  it('pins v2026.9.24', () => {
    expect(manifest.tag).toBe('v2026.9.24');
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('covers exactly the four sources plus LICENSE', () => {
    expect(Object.keys(manifest.files).sort()).toEqual(
      ['LICENSE', 'gateway-contract.generated.ts', 'gateway-events.ts', 'json-rpc-channel.ts', 'json-rpc-gateway.ts'],
    );
  });

  it.each(Object.keys(manifest.files))('%s matches its recorded vendored_sha256', (name) => {
    expect(sha(name)).toBe(manifest.files[name].vendored_sha256);
  });

  it('no relative import keeps its .js suffix (the one mechanical edit)', () => {
    for (const name of Object.keys(manifest.files).filter((n) => n.endsWith('.ts'))) {
      expect(readFileSync(join(dir, name), 'utf8')).not.toMatch(/from '\.\/[^']+\.js'/);
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest src/vendor`
Expected: FAIL. `vendored-client.test.ts` fails with "Cannot find module '@/vendor/hermes-gateway'", and `drift.test.ts` fails with `ENOENT … VENDORED.json`.

- [ ] **Step 3: Write the sync script and vendor v2026.9.24**

`scripts/sync-gateway-contract.sh`:

```bash
#!/usr/bin/env bash
# Vendor hermes-agent's shared TS gateway client + generated contract.
#   scripts/sync-gateway-contract.sh <tag>            re-vendor at <tag>
#   scripts/sync-gateway-contract.sh --verify         re-check upstream hashes against VENDORED.json's tag
# Source: a local hermes-agent clone (HERMES_AGENT_REPO, default ~/Developer/hermes-agent).
# The ONLY edit applied: strip `.js` from relative import/export specifiers (Metro + tsc resolution).
set -euo pipefail

REPO="${HERMES_AGENT_REPO:-$HOME/Developer/hermes-agent}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src/vendor/hermes-gateway"
FILES=(json-rpc-channel.ts json-rpc-gateway.ts gateway-events.ts gateway-contract.generated.ts)

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
rewrite() { sed -E "s#(from '\./[^']+)\.js'#\1'#g"; }

if [[ "${1:-}" == "--verify" ]]; then
  TAG="$(node -p "require('$DEST/VENDORED.json').tag")"
  git -C "$REPO" rev-parse -q --verify "refs/tags/$TAG" >/dev/null || git -C "$REPO" fetch --tags --quiet
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  fail=0
  for f in "${FILES[@]}" LICENSE; do
    src="apps/shared/src/$f"; [[ "$f" == LICENSE ]] && src="LICENSE"
    git -C "$REPO" show "${TAG}:${src}" > "$TMP/$f"
    want="$(node -p "require('$DEST/VENDORED.json').files['$f'].upstream_sha256")"
    got="$(sha "$TMP/$f")"
    if [[ "$want" != "$got" ]]; then echo "DRIFT upstream $f: $got != $want" >&2; fail=1; fi
  done
  [[ $fail -eq 0 ]] && echo "upstream hashes match $TAG"
  exit $fail
fi

TAG="${1:?usage: sync-gateway-contract.sh <tag> | --verify}"
git -C "$REPO" rev-parse -q --verify "refs/tags/$TAG" >/dev/null || git -C "$REPO" fetch --tags --quiet
COMMIT="$(git -C "$REPO" rev-parse "${TAG}^{commit}")"
mkdir -p "$DEST"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
entries=""
for f in "${FILES[@]}" LICENSE; do
  src="apps/shared/src/$f"; [[ "$f" == LICENSE ]] && src="LICENSE"
  git -C "$REPO" show "${TAG}:${src}" > "$TMP/$f"
  if [[ "$f" == *.ts ]]; then rewrite < "$TMP/$f" > "$DEST/$f"; else cp "$TMP/$f" "$DEST/$f"; fi
  entries+="\"$f\":{\"upstream_sha256\":\"$(sha "$TMP/$f")\",\"vendored_sha256\":\"$(sha "$DEST/$f")\"},"
done
node -e '
  const [tag, commit, files] = process.argv.slice(1);
  const out = { tag, commit, source: "NousResearch/hermes-agent", files: JSON.parse("{" + files.replace(/,$/, "") + "}") };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
' "$TAG" "$COMMIT" "$entries" > "$DEST/VENDORED.json"
if grep -nE "from '\./[^']+\.js'" "$DEST"/*.ts; then echo "rewrite missed a .js specifier" >&2; exit 1; fi
echo "vendored $TAG ($COMMIT) into src/vendor/hermes-gateway"
```

Run: `chmod +x scripts/sync-gateway-contract.sh && scripts/sync-gateway-contract.sh v2026.9.24 && scripts/sync-gateway-contract.sh --verify`
Expected output ends with `vendored v2026.9.24 (f97608f178d1ffeca59860195ab7da295f7c8e5f) into src/vendor/hermes-gateway`, then `upstream hashes match v2026.9.24`. `VENDORED.json` records `json-rpc-channel.ts` with upstream `39ca0506…`, vendored `780b32c5…`, and `gateway-contract.generated.ts` unchanged at `e41fcf57…`.

- [ ] **Step 4: Write the barrel and the eslint ignore**

`src/vendor/hermes-gateway/index.ts`:

```ts
// src/vendor/hermes-gateway/index.ts — APP-OWNED barrel (the only non-vendored file here).
// App code imports vendored symbols ONLY through this module (`@/vendor/hermes-gateway`).
//
// Runtime dependencies of the vendored client (keep these true or the transport breaks):
//  - Hermes has TextEncoder but NO TextDecoder; json-rpc-channel.ts constructs `new TextDecoder()`
//    at module top. It works only because Expo's winter runtime installs TextDecoder, URL and
//    DOMException (node_modules/expo/src/winter/runtime.native.ts). Removing expo winter breaks this.
//  - RN 0.85's WebSocket provides `static OPEN` and EventTarget (`addEventListener` with `once`);
//    json-rpc-gateway.ts reads the global `WebSocket.OPEN`.
// Re-vendor with `scripts/sync-gateway-contract.sh <tag>`; never hand-edit the vendored files
// (the drift guard in src/vendor/hermes-gateway/__tests__/drift.test.ts fails on any edit).
export { JsonRpcGatewayClient } from './json-rpc-gateway';
export type { GatewayClientOptions, ConnectionState } from './json-rpc-gateway';
export { JsonRpcGatewayError } from './json-rpc-channel';
export type { ServerRequest, ServerRequestHandler } from './json-rpc-channel';
export type { GatewayEvent, GatewayEventName, GatewayEventMap } from './gateway-events';
export type {
  RpcMethods,
  ServerRequestMap,
  ApprovalRequestParams,
  ApprovalResult,
  ClarifyRequestParams,
  ClarifyResult,
  SecretRequestParams,
  SudoRequestParams,
  ValueResult,
} from './gateway-contract.generated';
```

In `eslint.config.js`, replace `    ignores: ["dist/*"],` with:

```js
    // Vendored upstream files: never lint (or --fix) them — the drift guard pins their bytes.
    ignores: ["dist/*", "src/vendor/hermes-gateway/json-rpc-*.ts", "src/vendor/hermes-gateway/gateway-*.ts"],
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx jest src/vendor`
Expected: PASS, 10 tests. Jest must exit on its own; an "open handles" warning means a client was not closed. If the vendored client cannot run under jest without editing vendored source, **stop**: the fallback to 1B (types only) is Gianluca's call (spec §4.1).

- [ ] **Step 6: Run the gate and commit**

Run: `npx tsc --noEmit && npx jest` (both must exit 0)

```bash
git add scripts/sync-gateway-contract.sh src/vendor src/api/__tests__/fixtures eslint.config.js
git commit -m "feat(transport): vendor hermes gateway client + contract at v2026.9.24 with drift guard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The adapter (`GatewayClient`) and the rewritten client tests

**Files:**
- Rewrite: `src/api/gatewayClient.ts`
- Create: `src/api/__tests__/gatewayClient.test.ts`; Delete: `__tests__/gatewayClient.test.ts`
- Modify: `src/api/sessionModel.ts`, `src/connection.ts`, `src/lib/model-pill.ts`, `src/app/chat/[id].tsx` (a mechanical compile shim; Task 8 replaces it)

**Interfaces:**
- Consumes: the barrel and fixtures from Task 1.
- Produces: contract §2 exactly: `RpcError`, `GatewayClientDeps {socketFactory, requestTimeoutMs?, readyTimeoutMs?}`, `GatewayClient {connect, invalidate, close, isOpen, call<M>, onEvent, onRequest, onState}`, `makeNativeSocket(url): WebSocket`; `mintGatewayUrl(): Promise<string>` in `src/connection.ts`.

- [ ] **Step 1: Write the failing test** at `src/api/__tests__/gatewayClient.test.ts`, then delete the old one: `git rm __tests__/gatewayClient.test.ts`

```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/api/__tests__/gatewayClient.test.ts`
Expected: FAIL. `connect()` never waits for `gateway.ready`, `call` rejects with a plain Error, and there is no `onRequest`. Every suite reports failures such as "c.onRequest is not a function".

- [ ] **Step 3: Write the adapter**

`src/api/gatewayClient.ts` (full replacement):

```ts
// src/api/gatewayClient.ts — app adapter over the vendored JsonRpcGatewayClient
// (spec §4.2, contract §2). One instance per chat screen, reused across reconnects.
import {
  JsonRpcGatewayClient,
  JsonRpcGatewayError,
  type ConnectionState,
  type GatewayEvent,
  type RpcMethods,
  type ServerRequestHandler,
} from '@/vendor/hermes-gateway';

/** A rejected JSON-RPC call, carrying the gateway's numeric error code
 * (e.g. 4009 = session busy, 4001 = stale session) so callers can branch on it
 * without string-matching. -1 = no gateway code (timeout, socket closed, …). */
export class RpcError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface GatewayClientDeps {
  /** Today's makeNativeSocket — no Origin header (spec §4.1, review m1). */
  socketFactory: (url: string) => WebSocket;
  /** Per-call timeout; default 120_000 (the vendored default). */
  requestTimeoutMs?: number;
  /** How long connect() waits for `gateway.ready` after open. Default 15_000. */
  readyTimeoutMs?: number;
}

const WS_OPEN = 1;

function toRpcError(e: unknown): RpcError {
  if (e instanceof RpcError) return e;
  if (e instanceof JsonRpcGatewayError) return new RpcError(e.message, e.code ?? -1);
  return new RpcError(e instanceof Error ? e.message : String(e), -1);
}

export class GatewayClient {
  private readonly inner: JsonRpcGatewayClient;
  private socket: WebSocket | null = null;
  private readyWaiter: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private readonly readyTimeoutMs: number;

  constructor(deps: GatewayClientDeps) {
    this.readyTimeoutMs = deps.readyTimeoutMs ?? 15_000;
    this.inner = new JsonRpcGatewayClient({
      socketFactory: (url) => (this.socket = deps.socketFactory(url)),
      requestTimeoutMs: deps.requestTimeoutMs ?? 120_000,
      replay: false, // replay is app-orchestrated (spec §7)
    });
    // Registered FIRST, before any app handler: resolves the connect() gate.
    this.inner.on('gateway.ready', () => {
      const w = this.readyWaiter;
      this.readyWaiter = null;
      w?.resolve();
    });
    this.inner.onState((s) => {
      if ((s === 'closed' || s === 'error') && this.readyWaiter) {
        const w = this.readyWaiter;
        this.readyWaiter = null;
        w.reject(new RpcError('socket closed before gateway.ready', -1));
      }
    });
  }

  /** Resolves only after socket open AND `gateway.ready` AND one macrotask tick,
   * so the channel's `client.capabilities` frame is on the wire before the caller
   * sends `session.resume` (review M2). Zombie-safe: drops any current socket first. */
  async connect(url: string): Promise<void> {
    this.inner.invalidate(); // no-op without a socket; drops a zombie/half-open one
    const ready = new Promise<void>((resolve, reject) => {
      this.readyWaiter = { resolve, reject };
    });
    ready.catch(() => {}); // observed below; avoid an unhandled rejection if connect() throws first
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.inner.connect(url);
      await Promise.race([
        ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new RpcError(`no gateway.ready within ${this.readyTimeoutMs} ms`, -1)),
            this.readyTimeoutMs,
          );
        }),
      ]);
    } catch (e) {
      this.readyWaiter = null;
      this.inner.invalidate();
      throw toRpcError(e);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    await new Promise<void>((r) => setTimeout(r, 0)); // one macrotask: capabilities frame already sent
  }

  invalidate(): void {
    this.inner.invalidate();
  }

  close(): void {
    this.inner.close();
  }

  /** True only while the current socket reads OPEN (a suspended-then-torn-down
   * iOS socket reads CLOSED even though no close event fired). */
  get isOpen(): boolean {
    return this.inner.connectionState === 'open' && this.socket?.readyState === WS_OPEN;
  }

  call<M extends keyof RpcMethods>(
    method: M,
    params: RpcMethods[M]['params'],
  ): Promise<RpcMethods[M]['result']> {
    return this.inner
      .request<RpcMethods[M]['result']>(method, params as unknown as Record<string, unknown>)
      .catch((e: unknown) => {
        throw toRpcError(e);
      });
  }

  onEvent(handler: (event: GatewayEvent) => void): () => void {
    return this.inner.onEvent(handler);
  }

  /** MUST be registered before the first connect() (review M3). */
  onRequest(handler: ServerRequestHandler): () => void {
    return this.inner.onRequest(handler);
  }

  onState(handler: (state: ConnectionState) => void): () => void {
    return this.inner.onState(handler);
  }
}

/** Production socket factory (RN WebSocket). No headers: the gateway accepts
 * `?ticket=` without an Origin check (review m1). */
export function makeNativeSocket(url: string): WebSocket {
  return new WebSocket(url);
}
```

- [ ] **Step 4: Update the callers to the typed `call` (mechanical; keeps the tree compiling)**

`src/api/sessionModel.ts`:
1. Delete the whole `ConfigSetModelResult` interface block, which starts at `/** Gateway \`config.set\` reply shape for key:'model'. */`. It is now `ConfigSetResult` from the contract, and nothing else imports it.
2. Replace `const res = await call<ConfigSetModelResult>('config.set', {` with `const res = await call('config.set', {`.
3. Replace `return { kind: 'ok', model: res?.value ?? null };` with `return { kind: 'ok', model: typeof res?.value === 'string' ? res.value : null };`.

`src/lib/model-pill.ts`: in `withResumedModel`, replace the parameter type `info: { model?: string; lazy?: boolean } | undefined,` with `info: { model?: string | null; lazy?: boolean | null } | null | undefined,`.

`src/connection.ts`: replace the whole `openGateway` function and its doc comment (the last function in the file) with:

```ts
/** Mint a fresh single-use ticket and return the ws URL to dial (tickets live
 * 30s — always mint immediately before connecting). */
export async function mintGatewayUrl(): Promise<string> {
  const { ticket } = await withAuthRetry((r) => r.wsTicket());
  return getRest().wsUrl(ticket);
}

/** Transitional — deleted in Task 8 when the chat screen owns one client per screen. */
export async function openGateway(): Promise<GatewayClient> {
  const url = await mintGatewayUrl();
  const gw = new GatewayClient({ socketFactory: makeNativeSocket });
  await gw.connect(url);
  return gw;
}
```

`src/app/chat/[id].tsx`: a compile shim that changes no behaviour. Apply each exact replacement below. Each `old` occurs exactly once.

1. Replace:

```tsx
import type { GatewayEvent, SessionCreateResult, SessionResumeResult } from '@/api/types';
```

with:

```tsx
import type { GatewayEvent } from '@/vendor/hermes-gateway';
```

2. Replace:

```tsx
  function handleSubagentEvent(e: GatewayEvent) {
    const ts = Date.now();
    setItems((prev) => {
```

with:

```tsx
  function handleSubagentEvent(e: GatewayEvent) {
    const ts = Date.now();
    const sub = { type: e.type, payload: e.payload as Record<string, unknown> | undefined };
    setItems((prev) => {
```

3. Replace:

```tsx
subagent: reduceSubagentEvent(prev[idx].subagent!, e, ts)
```

with:

```tsx
subagent: reduceSubagentEvent(prev[idx].subagent!, sub, ts)
```

4. Replace:

```tsx
subagent: reduceSubagentEvent(emptyBatch(), e, ts)
```

with:

```tsx
subagent: reduceSubagentEvent(emptyBatch(), sub, ts)
```

5. Replace:

```tsx
    const offEvent = gw.onEvent((e) => {
      switch (e.type) {
        case 'message.delta':
          appendDelta(e.payload?.text ?? '');
```

with:

```tsx
    const offEvent = gw.onEvent((e) => {
      const pl = e.payload as any; // transitional (Task 2): Task 8 types each event
      switch (e.type as string) {
        case 'message.delta':
          appendDelta(pl?.text ?? '');
```

6. Replace:

```tsx
          if (e.payload?.name === 'todo') break; // todo renders as TodoCard on complete
          startTool(e.payload);
```

with:

```tsx
          if (pl?.name === 'todo') break; // todo renders as TodoCard on complete
          startTool(pl);
```

7. Replace:

```tsx
          if (e.payload?.name === 'todo') {
            if (!upsertTodo(e.payload)) append('status', 'Todo update failed');
            break;
          }
          completeTool(e.payload);
```

with:

```tsx
          if (pl?.name === 'todo') {
            if (!upsertTodo(pl)) append('status', 'Todo update failed');
            break;
          }
          completeTool(pl);
```

8. Replace:

```tsx
          if (e.payload?.text) append('status', e.payload.text);
```

with:

```tsx
          if (pl?.text) append('status', pl.text);
```

9. Replace:

```tsx
          appendApproval(e.payload);
```

with:

```tsx
          appendApproval(pl);
```

10. Replace:

```tsx
          if (e.payload?.model) setPill((p) => withSessionModel(p, e.payload.model));
```

with:

```tsx
          if (pl?.model) setPill((p) => withSessionModel(p, pl.model));
```

11. Replace:

```tsx
          setError(e.payload?.message ?? 'agent error');
```

with:

```tsx
          setError(pl?.message ?? 'agent error');
```

12. Replace:

```tsx
    const offClose = gw.onClose(() => dropAndReconnect());
```

with:

```tsx
    const offClose = gw.onState((state) => {
      if (state === 'closed') dropAndReconnect();
    });
```

13. Replace:

```tsx
      const resumed = await gw.call<SessionResumeResult>(
```

with:

```tsx
      const resumed = await gw.call(
```

14. Replace:

```tsx
        const created = await gw.call<SessionCreateResult>(
```

with:

```tsx
        const created = await gw.call(
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx jest src/api/__tests__/gatewayClient.test.ts __tests__/sessionModel.test.ts`
Expected: PASS. That covers 16 adapter tests (the `@ts-expect-error` lines are checked by tsc in the next step) and the existing 11 sessionModel tests.

- [ ] **Step 6: Run the gate and commit**

Run: `npx tsc --noEmit && npx jest`. tsc exit 0 proves that the two `@ts-expect-error` lines, an unknown param key and an unknown method, really are compile errors.

```bash
git add -A src/api src/connection.ts src/lib/model-pill.ts "src/app/chat/[id].tsx" __tests__/gatewayClient.test.ts
git commit -m "feat(transport): adapter over vendored JsonRpcGatewayClient (ready-gated connect, RpcError mapping, replay off)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Turn controller and turn store (pure)

**Files:**
- Create: `src/lib/turn-controller.ts`, `src/lib/turn-store.ts`
- Test: `src/lib/__tests__/turn-controller.test.ts`, `src/lib/__tests__/turn-store.test.ts`

**Interfaces:**
- Produces: contract §3 and §4 types and functions exactly, including D1 (`resolution?`) and D2 (the re-delivery reset and `params.answers` merge): `TurnState`, `CompleteStatus`, `TurnModel`, `TurnAction`, `RequestKind`, `RequestStatus`, `CancelReason`, `RequestCardState`, `RequestAction`, `initialTurnModel`, `reduceTurn`, `shouldFireSideEffects`, `kindForMethod`, `cancelLabel`. It also adds `turnActionFor(e)`, `completeStatus(payload)`, `resumeRunning(res)`, `toCancelReason(raw)`, `mergeRequestRows(items, requests): TranscriptRow<T>[]`, and `createTurnStore(): TurnStore {getState, dispatch, subscribe}`. B adds `composerMode` to `turn-controller.ts`.

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/turn-controller.test.ts`:

```ts
import {
  cancelLabel,
  completeStatus,
  initialTurnModel,
  kindForMethod,
  mergeRequestRows,
  reduceTurn,
  resumeRunning,
  shouldFireSideEffects,
  toCancelReason,
  turnActionFor,
  type RequestCardState,
  type TurnAction,
  type TurnModel,
} from '../turn-controller';

const run = (actions: TurnAction[], from: TurnModel = initialTurnModel()) => actions.reduce(reduceTurn, from);
const card = (over: Partial<Omit<RequestCardState, 'status'>> = {}): Omit<RequestCardState, 'status'> => ({
  id: 'srq-1', kind: 'approval', method: 'approval', params: { command: 'rm' }, legacy: false,
  receivedAt: 1000, anchorKey: 'i3', ...over,
});

describe('turn state (spec §5.1)', () => {
  it('starts idle', () => {
    expect(initialTurnModel()).toEqual({ turn: 'idle', lastStatus: null, requests: [] });
  });
  it('submit: idle → waiting; message.start → streaming; complete → idle with status', () => {
    const m = run([{ type: 'submit.sent' }, { type: 'event.message.start', replayed: false }]);
    expect(m.turn).toBe('streaming');
    expect(reduceTurn(m, { type: 'event.message.complete', status: 'complete', replayed: false })).toMatchObject({ turn: 'idle', lastStatus: 'complete' });
  });
  it('message.start with no local send → streaming (server-started turn)', () => {
    expect(run([{ type: 'event.message.start', replayed: false }]).turn).toBe('streaming');
  });
  it('interrupted complete records "interrupted" (UI shows Stopped)', () => {
    const m = run([{ type: 'event.message.start', replayed: false }, { type: 'event.message.complete', status: 'interrupted', replayed: false }]);
    expect(m).toMatchObject({ turn: 'idle', lastStatus: 'interrupted' });
  });
  it('error in waiting ends the turn; error in streaming does not', () => {
    expect(run([{ type: 'submit.sent' }, { type: 'event.error', replayed: false }])).toMatchObject({ turn: 'idle', lastStatus: 'error' });
    expect(run([{ type: 'event.message.start', replayed: false }, { type: 'event.error', replayed: false }]).turn).toBe('streaming');
  });
  it('stop.sent from waiting/streaming → stopping; stop.failed → streaming; idle ignores stop', () => {
    expect(run([{ type: 'submit.sent' }, { type: 'stop.sent' }]).turn).toBe('stopping');
    expect(run([{ type: 'event.message.start', replayed: false }, { type: 'stop.sent' }, { type: 'stop.failed' }]).turn).toBe('streaming');
    expect(run([{ type: 'stop.sent' }]).turn).toBe('idle');
  });
  it('resume.seeded running → streaming (Stop visible after reconnect), not running → idle', () => {
    expect(run([{ type: 'resume.seeded', running: true }]).turn).toBe('streaming');
    expect(run([{ type: 'submit.sent' }, { type: 'resume.seeded', running: false }]).turn).toBe('idle');
  });
  it('resume.seeded running keeps an in-flight stop as stopping', () => {
    expect(run([{ type: 'event.message.start', replayed: false }, { type: 'stop.sent' }, { type: 'resume.seeded', running: true }]).turn).toBe('stopping');
  });
  it('socket.lost keeps the turn state (NOT forced idle — replaces PR #22 setStreaming(false))', () => {
    expect(run([{ type: 'event.message.start', replayed: false }, { type: 'socket.lost' }]).turn).toBe('streaming');
  });
  it('submit while not idle is a no-op (the composer never sends a plain submit mid-turn)', () => {
    const m = run([{ type: 'event.message.start', replayed: false }]);
    expect(reduceTurn(m, { type: 'submit.sent' })).toBe(m);
  });
});

describe('side-effect gate', () => {
  it('replayed events never fire haptics / one-shots', () => {
    expect(shouldFireSideEffects({ type: 'event.message.complete', status: 'complete', replayed: true })).toBe(false);
    expect(shouldFireSideEffects({ type: 'event.message.complete', status: 'complete', replayed: false })).toBe(true);
    expect(shouldFireSideEffects({ type: 'submit.sent' })).toBe(true);
  });
});

describe('event → action', () => {
  it('maps message.start / message.complete(status) / error and carries replayed', () => {
    expect(turnActionFor({ type: 'message.start', replayed: true })).toEqual({ type: 'event.message.start', replayed: true });
    expect(turnActionFor({ type: 'message.complete', payload: { status: 'error' } })).toEqual({ type: 'event.message.complete', status: 'error', replayed: false });
    expect(turnActionFor({ type: 'error', payload: { message: 'x' } })).toEqual({ type: 'event.error', replayed: false });
    expect(turnActionFor({ type: 'message.delta' })).toBeNull();
  });
  it('completeStatus defaults to complete for absent/unknown values', () => {
    expect(completeStatus(undefined)).toBe('complete');
    expect(completeStatus({ status: 'weird' })).toBe('complete');
    expect(completeStatus({ status: 'interrupted' })).toBe('interrupted');
  });
  it('resumeRunning reads running / status / inflight', () => {
    expect(resumeRunning({ running: true })).toBe(true);
    expect(resumeRunning({ status: 'working' })).toBe(true);
    expect(resumeRunning({ status: 'waiting' })).toBe(true);
    expect(resumeRunning({ inflight: { streaming: true } })).toBe(true);
    expect(resumeRunning({ running: false, status: 'idle', inflight: null })).toBe(false);
  });
});

describe('request cards (spec §6.0)', () => {
  it('received → pending; re-delivery updates in place (no duplicate), keeps anchor and receivedAt, re-arms pending', () => {
    let m = run([{ type: 'request.received', card: card() }]);
    m = reduceTurn(m, { type: 'request.answered', id: 'srq-1' });
    m = reduceTurn(m, { type: 'request.received', card: card({ anchorKey: 'i99', receivedAt: 5000, params: { command: 'rm2' } }) });
    expect(m.requests).toEqual([expect.objectContaining({ id: 'srq-1', status: 'pending', anchorKey: 'i3', receivedAt: 1000, params: { command: 'rm2' } })]);
  });
  it('params.answers (clarify batch replay) seed lockedAnswers on first delivery and merge on re-delivery', () => {
    const clar = (answers?: Record<string, string>) =>
      card({ kind: 'clarify', method: 'clarify', params: { session_id: 's', questions: [], ...(answers ? { answers } : {}) } });
    let m = run([{ type: 'request.received', card: clar({ q0: 'a' }) }]);
    expect(m.requests[0].lockedAnswers).toEqual({ q0: 'a' });
    m = reduceTurn(m, { type: 'request.locked', id: 'srq-1', qid: 'q1', answer: ['x', 'y'] });
    m = reduceTurn(m, { type: 'request.received', card: clar({ q2: 'c' }) });
    expect(m.requests[0].lockedAnswers).toEqual({ q0: 'a', q1: ['x', 'y'], q2: 'c' });
  });
  it('re-delivery clears cancelReason and resolution (contract D2)', () => {
    let m = run([{ type: 'request.received', card: card() }, { type: 'request.answered', id: 'srq-1', resolution: 'deny' }]);
    expect(m.requests[0]).toMatchObject({ status: 'answered', resolution: 'deny' });
    m = reduceTurn(m, { type: 'request.received', card: card() });
    expect(m.requests[0].status).toBe('pending');
    expect(m.requests[0].resolution).toBeUndefined();
    expect(m.requests[0].cancelReason).toBeUndefined();
  });
  it('answering → answered (optimistic) / skipped; failed re-arms', () => {
    let m = run([{ type: 'request.received', card: card() }, { type: 'request.answering', id: 'srq-1' }]);
    expect(m.requests[0].status).toBe('answering');
    expect(reduceTurn(m, { type: 'request.failed', id: 'srq-1' }).requests[0].status).toBe('pending');
    expect(reduceTurn(m, { type: 'request.answered', id: 'srq-1', skipped: true }).requests[0].status).toBe('skipped');
  });
  it.each([
    ['interrupted', 'Stopped'],
    ['timeout', 'Timed out'],
    ['resolved', 'Answered elsewhere'],
    ['session_closed', 'Closed'],
    ['shutdown', 'Closed'],
  ] as const)('cancel %s → cancelled with label "%s"', (reason, label) => {
    const m = run([{ type: 'request.received', card: card() }, { type: 'request.cancelled', id: 'srq-1', reason }]);
    expect(m.requests[0]).toMatchObject({ status: 'cancelled', cancelReason: reason });
    expect(cancelLabel(reason)).toBe(label);
  });
  it('cancel after an answer keeps the answer', () => {
    const m = run([{ type: 'request.received', card: card() }, { type: 'request.answered', id: 'srq-1' }, { type: 'request.cancelled', id: 'srq-1', reason: 'resolved' }]);
    expect(m.requests[0].status).toBe('answered');
  });
  it('unknown ids are no-ops (same object)', () => {
    const m = initialTurnModel();
    expect(reduceTurn(m, { type: 'request.cancelled', id: 'nope', reason: 'timeout' })).toBe(m);
  });
  it('turn end and socket loss close only LEGACY open cards', () => {
    const m = run([
      { type: 'request.received', card: card({ id: 'legacy:1', legacy: true }) },
      { type: 'request.received', card: card({ id: 'srq-2' }) },
    ]);
    const done = reduceTurn(m, { type: 'event.message.complete', status: 'interrupted', replayed: false });
    expect(done.requests.map((r) => [r.id, r.status, r.cancelReason])).toEqual([
      ['legacy:1', 'cancelled', 'interrupted'],
      ['srq-2', 'pending', undefined],
    ]);
    expect(reduceTurn(m, { type: 'socket.lost' }).requests[0]).toMatchObject({ status: 'cancelled', cancelReason: 'session_closed' });
  });
  it('toCancelReason maps unknown wire reasons to session_closed', () => {
    expect(toCancelReason('timeout')).toBe('timeout');
    expect(toCancelReason('bogus')).toBe('session_closed');
    expect(toCancelReason(undefined)).toBe('session_closed');
  });
});

describe('kindForMethod', () => {
  it.each([
    ['approval', 'approval'], ['clarify', 'clarify'], ['sudo', 'secure-entry'], ['secret', 'secure-entry'],
    ['vault.unlock_prompt', 'vault-declined'], ['vault.save_login', 'vault-declined'], ['vault.code', 'vault-declined'],
    ['terminal.read', null], ['preview.read', null], ['preview.act', null], ['window.read', null], ['tour', null],
    ['display.install.sudo', null], ['something.new', null],
  ])('%s → %s', (method, kind) => {
    expect(kindForMethod(method)).toBe(kind);
  });
});

describe('mergeRequestRows', () => {
  const items = [{ key: 'i1' }, { key: 'i2' }, { key: 'i3' }];
  it('places each card after its anchor item', () => {
    const cards = [{ ...card({ id: 'a', anchorKey: 'i1' }), status: 'pending' as const }];
    expect(mergeRequestRows(items, cards).map((r) => (r.kind === 'item' ? r.item.key : r.card.id))).toEqual(['i1', 'a', 'i2', 'i3']);
  });
  it('after a history replace (anchors gone) open cards move to the end; settled ones are not re-rendered', () => {
    const cards = [
      { ...card({ id: 'open', anchorKey: 'gone' }), status: 'pending' as const },
      { ...card({ id: 'done', anchorKey: 'gone' }), status: 'answered' as const },
      { ...card({ id: 'first', anchorKey: null }), status: 'answered' as const },
    ];
    expect(mergeRequestRows(items, cards).map((r) => (r.kind === 'item' ? r.item.key : r.card.id))).toEqual(['i1', 'i2', 'i3', 'open', 'first']);
  });
});
```

`src/lib/__tests__/turn-store.test.ts`:

```ts
import { createTurnStore } from '../turn-store';

describe('turn store', () => {
  it('dispatch reduces, notifies subscribers, and skips no-op actions', () => {
    const store = createTurnStore();
    const seen: string[] = [];
    const off = store.subscribe(() => seen.push(store.getState().turn));
    store.dispatch({ type: 'submit.sent' });
    store.dispatch({ type: 'submit.sent' }); // no-op in waiting → no notification
    store.dispatch({ type: 'event.message.start', replayed: false });
    off();
    store.dispatch({ type: 'event.message.complete', status: 'complete', replayed: false });
    expect(seen).toEqual(['waiting', 'streaming']);
    expect(store.getState().turn).toBe('idle');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest src/lib/__tests__/turn-controller.test.ts src/lib/__tests__/turn-store.test.ts`
Expected: FAIL with "Cannot find module '../turn-controller'" and "Cannot find module '../turn-store'".

- [ ] **Step 3: Implement**

`src/lib/turn-controller.ts`:

```ts
// src/lib/turn-controller.ts — pure turn-state + request-card reducer (spec §4.4, §5.1, §6.0;
// contract §3–§4). No React Native imports. Plan B adds composerMode() here.

export type TurnState = 'idle' | 'waiting' | 'streaming' | 'stopping';
export type CompleteStatus = 'complete' | 'error' | 'interrupted';

export type RequestKind = 'approval' | 'clarify' | 'secure-entry' | 'vault-declined';
export type RequestStatus = 'pending' | 'answering' | 'answered' | 'skipped' | 'cancelled';
export type CancelReason = 'interrupted' | 'timeout' | 'resolved' | 'session_closed' | 'shutdown';

export interface RequestCardState {
  id: string;
  kind: RequestKind;
  method: string;
  params: unknown;
  status: RequestStatus;
  cancelReason?: CancelReason;
  legacy: boolean;
  receivedAt: number;
  lockedAnswers?: Record<string, unknown>;
  anchorKey: string | null;
  /** Display-only outcome set on answer: the approval choice or a clarify summary.
   * NEVER a secret/sudo value. */
  resolution?: string;
}

export type RequestAction =
  | { type: 'request.received'; card: Omit<RequestCardState, 'status'> }
  | { type: 'request.answering'; id: string }
  | { type: 'request.answered'; id: string; skipped?: boolean; resolution?: string }
  | { type: 'request.failed'; id: string }
  | { type: 'request.locked'; id: string; qid: string; answer: unknown }
  | { type: 'request.cancelled'; id: string; reason: CancelReason };

export interface TurnModel {
  turn: TurnState;
  lastStatus: CompleteStatus | null;
  requests: RequestCardState[];
}

export type TurnAction =
  | { type: 'submit.sent' }
  | { type: 'event.message.start'; replayed: boolean }
  | { type: 'event.message.complete'; status: CompleteStatus; replayed: boolean }
  | { type: 'event.error'; replayed: boolean }
  | { type: 'stop.sent' }
  | { type: 'stop.failed' }
  | { type: 'resume.seeded'; running: boolean }
  | { type: 'socket.lost' }
  | RequestAction;

export function initialTurnModel(): TurnModel {
  return { turn: 'idle', lastStatus: null, requests: [] };
}

const OPEN: ReadonlySet<RequestStatus> = new Set(['pending', 'answering']);

/** Close still-open LEGACY (0.20.4) approval cards: the old gateway force-denies them at turn
 * end and they cannot be answered across a dead socket. 0.21.5 cards close on request.cancel. */
function closeLegacy(requests: RequestCardState[], reason: CancelReason): RequestCardState[] {
  if (!requests.some((r) => r.legacy && OPEN.has(r.status))) return requests;
  return requests.map((r) =>
    r.legacy && OPEN.has(r.status) ? { ...r, status: 'cancelled', cancelReason: reason } : r,
  );
}

function mapCard(
  requests: RequestCardState[],
  id: string,
  fn: (r: RequestCardState) => RequestCardState,
): RequestCardState[] {
  const idx = requests.findIndex((r) => r.id === id);
  if (idx < 0) return requests;
  const next = fn(requests[idx]);
  if (next === requests[idx]) return requests;
  const out = [...requests];
  out[idx] = next;
  return out;
}

/** Clarify batch replay carries already-locked answers as `params.answers` ({qid: str}). */
function paramAnswers(params: unknown): Record<string, unknown> | undefined {
  const a = (params as { answers?: unknown } | null | undefined)?.answers;
  return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : undefined;
}

function mergeLocked(...parts: (Record<string, unknown> | undefined)[]): Record<string, unknown> | undefined {
  const present = parts.filter((p): p is Record<string, unknown> => p !== undefined);
  return present.length ? Object.assign({}, ...present) : undefined;
}

function reduceRequests(requests: RequestCardState[], a: RequestAction): RequestCardState[] {
  switch (a.type) {
    case 'request.received': {
      const idx = requests.findIndex((r) => r.id === a.card.id);
      const incoming = mergeLocked(a.card.lockedAnswers, paramAnswers(a.card.params));
      if (idx < 0) return [...requests, { ...a.card, lockedAnswers: incoming, status: 'pending' }];
      // Re-delivery (open_requests replay) = the server says it is still open: update in
      // place, keep position (anchorKey) and the original receivedAt, re-arm as pending,
      // clear cancelReason/resolution, merge replayed answers into lockedAnswers (contract D2).
      const prev = requests[idx];
      const out = [...requests];
      out[idx] = {
        ...prev,
        kind: a.card.kind,
        method: a.card.method,
        params: a.card.params,
        legacy: a.card.legacy,
        status: 'pending',
        cancelReason: undefined,
        resolution: undefined,
        lockedAnswers: mergeLocked(prev.lockedAnswers, incoming),
      };
      return out;
    }
    case 'request.answering':
      return mapCard(requests, a.id, (r) => (r.status === 'pending' ? { ...r, status: 'answering' } : r));
    case 'request.answered':
      return mapCard(requests, a.id, (r) =>
        OPEN.has(r.status)
          ? {
              ...r,
              status: a.skipped ? 'skipped' : 'answered',
              ...(a.resolution !== undefined ? { resolution: a.resolution } : {}),
            }
          : r,
      );
    case 'request.failed':
      return mapCard(requests, a.id, (r) => (r.status === 'answering' ? { ...r, status: 'pending' } : r));
    case 'request.locked':
      return mapCard(requests, a.id, (r) => ({
        ...r,
        lockedAnswers: { ...r.lockedAnswers, [a.qid]: a.answer },
      }));
    case 'request.cancelled':
      return mapCard(requests, a.id, (r) =>
        OPEN.has(r.status) ? { ...r, status: 'cancelled', cancelReason: a.reason } : r,
      );
  }
}

export function reduceTurn(model: TurnModel, action: TurnAction): TurnModel {
  switch (action.type) {
    case 'submit.sent':
      return model.turn === 'idle' ? { ...model, turn: 'waiting', lastStatus: null } : model;
    case 'event.message.start':
      return { ...model, turn: 'streaming', lastStatus: null };
    case 'event.message.complete':
      return {
        ...model,
        turn: 'idle',
        lastStatus: action.status,
        requests: closeLegacy(model.requests, action.status === 'interrupted' ? 'interrupted' : 'session_closed'),
      };
    case 'event.error':
      // Before message.start an error means no message.complete will follow (review M6).
      return model.turn === 'waiting' ? { ...model, turn: 'idle', lastStatus: 'error' } : model;
    case 'stop.sent':
      return model.turn === 'waiting' || model.turn === 'streaming' ? { ...model, turn: 'stopping' } : model;
    case 'stop.failed':
      return model.turn === 'stopping' ? { ...model, turn: 'streaming' } : model;
    case 'resume.seeded':
      if (!action.running) return { ...model, turn: 'idle' };
      // A Stop already in flight stays 'stopping' until message.complete arrives.
      return { ...model, turn: model.turn === 'stopping' ? 'stopping' : 'streaming' };
    case 'socket.lost':
      return { ...model, requests: closeLegacy(model.requests, 'session_closed') };
    default: {
      const requests = reduceRequests(model.requests, action);
      return requests === model.requests ? model : { ...model, requests };
    }
  }
}

/** Haptics and one-shot UI fire only for live (non-replayed) events (spec §5.1, review m16). */
export function shouldFireSideEffects(action: TurnAction): boolean {
  return !('replayed' in action && action.replayed);
}

// ── event → action mapping ──

export function completeStatus(payload: unknown): CompleteStatus {
  const s = (payload as { status?: unknown } | null | undefined)?.status;
  return s === 'error' || s === 'interrupted' ? s : 'complete';
}

/** The turn-state action a gateway event implies, or null. */
export function turnActionFor(e: { type: string; payload?: unknown; replayed?: boolean }): TurnAction | null {
  const replayed = e.replayed === true;
  switch (e.type) {
    case 'message.start':
      return { type: 'event.message.start', replayed };
    case 'message.complete':
      return { type: 'event.message.complete', status: completeStatus(e.payload), replayed };
    case 'error':
      return { type: 'event.error', replayed };
    default:
      return null;
  }
}

/** Is a turn running, per a `session.resume` result (0.21.5 `running`/`status`, both tags `inflight`)? */
export function resumeRunning(res: {
  running?: boolean | null;
  status?: string | null;
  inflight?: { streaming?: boolean } | null;
}): boolean {
  return (
    res.running === true ||
    res.inflight?.streaming === true ||
    res.status === 'working' ||
    res.status === 'waiting' ||
    res.status === 'starting'
  );
}

// ── request helpers ──

const VAULT = new Set(['vault.unlock_prompt', 'vault.save_login', 'vault.code']);

/** null ⇒ not mobile-supported: the handler declines and the channel answers -32601. */
export function kindForMethod(method: string): RequestKind | null {
  if (method === 'approval') return 'approval';
  if (method === 'clarify') return 'clarify';
  if (method === 'sudo' || method === 'secret') return 'secure-entry';
  if (VAULT.has(method)) return 'vault-declined';
  return null;
}

const LABELS: Record<CancelReason, string> = {
  interrupted: 'Stopped',
  timeout: 'Timed out',
  resolved: 'Answered elsewhere',
  session_closed: 'Closed',
  shutdown: 'Closed',
};

export function cancelLabel(reason: CancelReason): string {
  return LABELS[reason];
}

/** Wire `request.cancel.reason` is a plain string; unknown values read as "Closed". */
export function toCancelReason(raw: unknown): CancelReason {
  return typeof raw === 'string' && raw in LABELS ? (raw as CancelReason) : 'session_closed';
}

/** Transcript rows with request cards merged in after their anchor item (cards live
 * outside `items`, so a history replace cannot drop them — spec §6.0, review B1.3). */
export type TranscriptRow<T> = { kind: 'item'; item: T } | { kind: 'request'; card: RequestCardState };

export function mergeRequestRows<T extends { key: string }>(
  items: T[],
  requests: RequestCardState[],
): TranscriptRow<T>[] {
  const byAnchor = new Map<string, RequestCardState[]>();
  const tail: RequestCardState[] = [];
  const keys = new Set(items.map((i) => i.key));
  for (const r of requests) {
    if (r.anchorKey !== null && keys.has(r.anchorKey)) {
      const list = byAnchor.get(r.anchorKey) ?? [];
      list.push(r);
      byAnchor.set(r.anchorKey, list);
    } else if (r.anchorKey === null || OPEN.has(r.status)) {
      // Orphaned by a history replace: open cards stay visible at the end; settled ones are
      // already reflected in the reloaded history, so they are not re-rendered out of place.
      tail.push(r);
    }
  }
  const rows: TranscriptRow<T>[] = [];
  for (const item of items) {
    rows.push({ kind: 'item', item });
    for (const card of byAnchor.get(item.key) ?? []) rows.push({ kind: 'request', card });
  }
  for (const card of tail) rows.push({ kind: 'request', card });
  return rows;
}
```

`src/lib/turn-store.ts`:

```ts
// src/lib/turn-store.ts — the turn model held OUTSIDE React (spec §4.2: the request handler
// enqueues here even before any chat UI state exists). Screens read it with
// useSyncExternalStore(store.subscribe, store.getState).
import { initialTurnModel, reduceTurn, type TurnAction, type TurnModel } from './turn-controller';

export interface TurnStore {
  getState(): TurnModel;
  dispatch(action: TurnAction): void;
  subscribe(listener: () => void): () => void;
}

export function createTurnStore(initial: TurnModel = initialTurnModel()): TurnStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reduceTurn(state, action);
      if (next === state) return;
      state = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest src/lib/__tests__/turn-controller.test.ts src/lib/__tests__/turn-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

Run: `npx tsc --noEmit && npx jest`

```bash
git add src/lib/turn-controller.ts src/lib/turn-store.ts src/lib/__tests__/turn-controller.test.ts src/lib/__tests__/turn-store.test.ts
git commit -m "feat(turn): server-driven turn controller + request-card reducer + external store" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Legacy approval type, request registry, request router

**Files:**
- Create: `src/api/legacy-approval.ts`, `src/lib/request-registry.ts`, `src/lib/request-router.ts`
- Test: `src/api/__tests__/legacy-approval.test.ts`, `src/lib/__tests__/request-registry.test.ts`, `src/lib/__tests__/request-router.test.ts`

**Interfaces:**
- Consumes: `TurnStore`, `kindForMethod`, `toCancelReason`, `RequestCardState` (Task 3); `ServerRequest`, `GatewayEvent` (barrel).
- Produces:
  - `LegacyApprovalRequestPayload`, `isLegacyApprovalEvent(e)`, `readLegacyApprovalPayload(payload)`;
  - `RequestRegistry`, `createRequestRegistry()` (contract §4);
  - `createRequestRouter({store, registry, anchorKey, now?, onNewCard?}): {handleRequest(req): boolean; handleEvent(e): boolean}`, and `VAULT_DECLINED_MESSAGE`.
- The routing rule is exactly contract §4:
  - a supported method → `registry.put`, a card, and `true`;
  - a vault method → a card, `req.fail(-32601, …)`, and `true`;
  - anything else → `false`, so the channel sends `-32601`;
  - `request.cancel` → `request.cancelled` + `registry.drop`;
  - legacy `approval.request` → a `legacy:<n>` card.
- `onNewCard` fires only for a new id. Its errors are swallowed, so they can never become a `-32603` (Review Focus 4).

- [ ] **Step 1: Write the failing tests**

`src/api/__tests__/legacy-approval.test.ts`:

```ts
import { isLegacyApprovalEvent, readLegacyApprovalPayload } from '@/api/legacy-approval';

describe('legacy (0.20.4) approval.request event', () => {
  it('is recognised by type only', () => {
    expect(isLegacyApprovalEvent({ type: 'approval.request' })).toBe(true);
    expect(isLegacyApprovalEvent({ type: 'approval' })).toBe(false);
  });
  it('keeps displayable payloads (command or description) with all extra keys', () => {
    expect(readLegacyApprovalPayload({ command: 'rm -rf x', pattern_key: 'recursive delete' })).toEqual({
      command: 'rm -rf x',
      pattern_key: 'recursive delete',
    });
    expect(readLegacyApprovalPayload({ description: 'danger' })).toEqual({ description: 'danger', command: '' });
  });
  it('rejects empty or non-object payloads', () => {
    expect(readLegacyApprovalPayload({ command: ' ', description: '' })).toBeNull();
    expect(readLegacyApprovalPayload(null)).toBeNull();
    expect(readLegacyApprovalPayload('x')).toBeNull();
  });
});
```

`src/lib/__tests__/request-registry.test.ts`:

```ts
import { createRequestRegistry } from '../request-registry';
import type { ServerRequest } from '@/vendor/hermes-gateway';

function req(id: string) {
  const out: [string, unknown][] = [];
  const r: ServerRequest = {
    id, method: 'clarify', params: {},
    respond: (result) => out.push(['respond', result]),
    fail: (code, message) => out.push(['fail', { code, message }]),
  };
  return { r, out };
}

describe('request registry', () => {
  it('respond routes to the live request once, then forgets it', () => {
    const reg = createRequestRegistry();
    const { r, out } = req('srq-1');
    reg.put(r);
    expect(reg.respond('srq-1', { answer: 'x' })).toBe(true);
    expect(reg.respond('srq-1', { answer: 'y' })).toBe(false);
    expect(out).toEqual([['respond', { answer: 'x' }]]);
  });
  it('latest delivery wins (a replay re-delivers the same id on the new socket)', () => {
    const reg = createRequestRegistry();
    const old = req('srq-1');
    const fresh = req('srq-1');
    reg.put(old.r);
    reg.put(fresh.r);
    reg.respond('srq-1', { answer: 'x' });
    expect(old.out).toEqual([]);
    expect(fresh.out).toEqual([['respond', { answer: 'x' }]]);
  });
  it('fail and drop', () => {
    const reg = createRequestRegistry();
    const a = req('a');
    reg.put(a.r);
    expect(reg.fail('a', -32601, 'nope')).toBe(true);
    expect(a.out).toEqual([['fail', { code: -32601, message: 'nope' }]]);
    const b = req('b');
    reg.put(b.r);
    reg.drop('b');
    expect(reg.respond('b', {})).toBe(false);
    expect(reg.fail('unknown', 1, 'x')).toBe(false);
  });
});
```

`src/lib/__tests__/request-router.test.ts`:

```ts
import { createRequestRegistry } from '../request-registry';
import { createRequestRouter, VAULT_DECLINED_MESSAGE } from '../request-router';
import { createTurnStore } from '../turn-store';
import type { ServerRequest } from '@/vendor/hermes-gateway';

function srq(id: string, method: string, params: Record<string, unknown> = {}, replayed = false) {
  const wire: unknown[] = [];
  const req: ServerRequest = {
    id, method, params, replayed,
    respond: (result) => wire.push({ result }),
    fail: (code, message) => wire.push({ error: { code, message } }),
  };
  return { req, wire };
}

function setup() {
  const store = createTurnStore();
  const registry = createRequestRegistry();
  const newCards: [string, boolean][] = [];
  let anchor: string | null = 'i7';
  const router = createRequestRouter({
    store, registry, anchorKey: () => anchor, now: () => 42,
    onNewCard: (c, replayed) => newCards.push([c.id, replayed]),
  });
  return { store, registry, router, newCards, setAnchor: (a: string | null) => (anchor = a) };
}

describe('request router', () => {
  it.each(['approval', 'clarify', 'sudo', 'secret'])('accepts %s: card + registry, no wire answer', (method) => {
    const { store, registry, router } = setup();
    const { req, wire } = srq('srq-1', method, { session_id: 's' });
    expect(router.handleRequest(req)).toBe(true);
    expect(wire).toEqual([]);
    expect(store.getState().requests[0]).toMatchObject({ id: 'srq-1', method, legacy: false, receivedAt: 42, anchorKey: 'i7', status: 'pending' });
    expect(registry.respond('srq-1', { x: 1 })).toBe(true);
  });

  it('declines desktop-only methods (the channel then answers -32601) and makes no card', () => {
    const { store, router } = setup();
    for (const m of ['terminal.read', 'preview.read', 'preview.act', 'window.read', 'tour', 'display.install.sudo']) {
      expect(router.handleRequest(srq(`srq-${m}`, m).req)).toBe(false);
    }
    expect(store.getState().requests).toEqual([]);
  });

  it('vault: a declined card, an immediate -32601, and accepted (true)', () => {
    const { store, router } = setup();
    const { req, wire } = srq('srq-v', 'vault.code', { session_id: 's' });
    expect(router.handleRequest(req)).toBe(true);
    expect(wire).toEqual([{ error: { code: -32601, message: VAULT_DECLINED_MESSAGE } }]);
    expect(store.getState().requests[0]).toMatchObject({ kind: 'vault-declined', status: 'skipped' });
  });

  it('batch clarify replay answers seed lockedAnswers', () => {
    const { store, router } = setup();
    router.handleRequest(srq('srq-c', 'clarify', { session_id: 's', questions: [], answers: { q0: 'yes' } }, true).req);
    expect(store.getState().requests[0].lockedAnswers).toEqual({ q0: 'yes' });
  });

  it('onNewCard fires once per id with the replayed flag; a re-delivery is an update', () => {
    const { store, router, newCards } = setup();
    router.handleRequest(srq('srq-1', 'approval').req);
    router.handleRequest(srq('srq-1', 'approval', {}, true).req);
    expect(newCards).toEqual([['srq-1', false]]);
    expect(store.getState().requests).toHaveLength(1);
  });

  it('request.cancel → cancelled with reason; unknown reason → session_closed; consumed', () => {
    const { store, registry, router } = setup();
    router.handleRequest(srq('a', 'approval').req);
    router.handleRequest(srq('b', 'clarify').req);
    expect(router.handleEvent({ type: 'request.cancel', payload: { id: 'a', method: 'approval', reason: 'timeout' } })).toBe(true);
    router.handleEvent({ type: 'request.cancel', payload: { id: 'b', method: 'clarify', reason: 'weird' } });
    expect(store.getState().requests.map((r) => [r.id, r.status, r.cancelReason])).toEqual([
      ['a', 'cancelled', 'timeout'],
      ['b', 'cancelled', 'session_closed'],
    ]);
    expect(registry.respond('a', {})).toBe(false);
  });

  it('legacy approval.request → legacy:<n> cards in arrival order; undisplayable payloads are consumed but dropped', () => {
    const { store, router } = setup();
    expect(router.handleEvent({ type: 'approval.request', payload: { command: 'rm -rf a' } })).toBe(true);
    expect(router.handleEvent({ type: 'approval.request', payload: { command: '', description: '' } })).toBe(true);
    router.handleEvent({ type: 'approval.request', payload: { description: 'danger' } });
    expect(store.getState().requests.map((r) => [r.id, r.legacy, r.kind])).toEqual([
      ['legacy:1', true, 'approval'],
      ['legacy:2', true, 'approval'],
    ]);
  });

  it('other events are not consumed', () => {
    const { router } = setup();
    expect(router.handleEvent({ type: 'message.delta', payload: { text: 'x' } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest src/api/__tests__/legacy-approval.test.ts src/lib/__tests__/request-registry.test.ts src/lib/__tests__/request-router.test.ts`
Expected: FAIL. All three suites fail with "Cannot find module".

- [ ] **Step 3: Implement**

`src/api/legacy-approval.ts`:

```ts
// src/api/legacy-approval.ts — the ONE app-owned gateway type (spec §4.3, review m5).
// The 0.20.4 `approval.request` EVENT is absent from the v2026.9.24 contract; its payload shape
// is from hermes-agent v2026.8.18 tui_gateway/server.py `_approval_request_payload`.
// DELETE this file when 0.20.4 support is dropped.

export interface LegacyApprovalRequestPayload {
  command: string;
  description?: string;
  choices?: string[];
  allow_permanent?: boolean;
  allow_session?: boolean;
  smart_denied?: boolean;
  tool_name?: string;
  [k: string]: unknown;
}

export function isLegacyApprovalEvent(e: { type: string }): boolean {
  return e.type === 'approval.request';
}

/** The event payload if it has something displayable (a command or description), else null. */
export function readLegacyApprovalPayload(payload: unknown): LegacyApprovalRequestPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const command = typeof p.command === 'string' ? p.command : '';
  const description = typeof p.description === 'string' ? p.description : '';
  if (!command.trim() && !description.trim()) return null;
  return { ...p, command } as LegacyApprovalRequestPayload;
}
```

`src/lib/request-registry.ts`:

```ts
// src/lib/request-registry.ts — live ServerRequest objects by id (contract §4). The reducer
// holds data only; the respond/fail closures live here. Never stores a result value.
import type { ServerRequest } from '@/vendor/hermes-gateway';

export interface RequestRegistry {
  put(req: ServerRequest): void;
  respond(id: string, result: Record<string, unknown>): boolean;
  fail(id: string, code: number, message: string): boolean;
  drop(id: string): void;
}

export function createRequestRegistry(): RequestRegistry {
  const live = new Map<string, ServerRequest>();
  return {
    put(req) {
      live.set(req.id, req); // a replay re-delivers the same id: latest delivery wins
    },
    respond(id, result) {
      const req = live.get(id);
      if (!req) return false;
      live.delete(id);
      req.respond(result);
      return true;
    },
    fail(id, code, message) {
      const req = live.get(id);
      if (!req) return false;
      live.delete(id);
      req.fail(code, message);
      return true;
    },
    drop(id) {
      live.delete(id);
    },
  };
}
```

`src/lib/request-router.ts`:

```ts
// src/lib/request-router.ts — routes server→client requests and request-related events into
// the turn store (contract §4 routing rule, spec §6.0/§6.3). Registered at client
// construction, before the first connect(): a -32601 for a supported method is destructive
// at 0.21.5 (approval withdrawn, clarify blanked — review M3).
import type { GatewayEvent, ServerRequest } from '@/vendor/hermes-gateway';
import { isLegacyApprovalEvent, readLegacyApprovalPayload } from '@/api/legacy-approval';
import type { RequestRegistry } from './request-registry';
import { kindForMethod, toCancelReason, type RequestCardState } from './turn-controller';
import type { TurnStore } from './turn-store';

export const VAULT_DECLINED_MESSAGE = 'not supported on mobile';

export interface RequestRouterDeps {
  store: TurnStore;
  registry: RequestRegistry;
  /** Key of the last transcript item right now (the card's anchor), or null. */
  anchorKey: () => string | null;
  now?: () => number;
  /** A card appeared that was not already present (for haptics / closing the stream segment). */
  onNewCard?: (card: RequestCardState, replayed: boolean) => void;
}

export interface RequestRouter {
  /** The ServerRequestHandler: true = accepted (no -32601), false = decline. */
  handleRequest(req: ServerRequest): boolean;
  /** Consumes request.cancel and the legacy approval.request event. true = consumed. */
  handleEvent(e: GatewayEvent | { type: string; payload?: unknown; replayed?: boolean }): boolean;
}

export function createRequestRouter(deps: RequestRouterDeps): RequestRouter {
  const now = deps.now ?? Date.now;
  let legacyCounter = 0;

  function receive(card: Omit<RequestCardState, 'status'>, replayed: boolean): void {
    const existed = deps.store.getState().requests.some((r) => r.id === card.id);
    deps.store.dispatch({ type: 'request.received', card });
    if (!existed) {
      const created = deps.store.getState().requests.find((r) => r.id === card.id);
      try {
        if (created) deps.onNewCard?.(created, replayed);
      } catch {
        // A UI callback must never escape: the channel would answer -32603, which withdraws
        // an approval / blanks a clarify at 0.21.5 (review M3).
      }
    }
  }

  return {
    handleRequest(req) {
      const kind = kindForMethod(req.method);
      if (kind === null) return false; // desktop-only: channel answers -32601
      receive(
        {
          id: req.id,
          kind,
          method: req.method,
          params: req.params,
          legacy: false,
          receivedAt: now(),
          anchorKey: deps.anchorKey(),
        },
        req.replayed === true,
      );
      if (kind === 'vault-declined') {
        req.fail(-32601, VAULT_DECLINED_MESSAGE); // first response wins → unanswered for all (spec §6.3)
        deps.store.dispatch({ type: 'request.answered', id: req.id, skipped: true });
        return true;
      }
      deps.registry.put(req);
      return true;
    },
    handleEvent(e) {
      if (e.type === 'request.cancel') {
        const p = (e.payload ?? {}) as { id?: unknown; reason?: unknown };
        if (typeof p.id === 'string') {
          deps.store.dispatch({ type: 'request.cancelled', id: p.id, reason: toCancelReason(p.reason) });
          deps.registry.drop(p.id);
        }
        return true;
      }
      if (isLegacyApprovalEvent(e)) {
        const payload = readLegacyApprovalPayload(e.payload);
        if (payload) {
          receive(
            {
              id: `legacy:${++legacyCounter}`,
              kind: 'approval',
              method: 'approval',
              params: payload,
              legacy: true,
              receivedAt: now(),
              anchorKey: deps.anchorKey(),
            },
            e.replayed === true,
          );
        }
        return true;
      }
      return false;
    },
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the same command as Step 2. Expected: PASS, 3 suites.

- [ ] **Step 5: Run the gate and commit**

Run: `npx tsc --noEmit && npx jest`

```bash
git add src/api/legacy-approval.ts src/lib/request-registry.ts src/lib/request-router.ts src/api/__tests__/legacy-approval.test.ts src/lib/__tests__/request-registry.test.ts src/lib/__tests__/request-router.test.ts
git commit -m "feat(requests): server-request routing (no -32601 for supported methods), registry, legacy approval type" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reconnect orchestrator (PR #22's hardening, extracted and tested)

**Files:**
- Create: `src/lib/reconnect-orchestrator.ts`
- Test: `src/lib/__tests__/reconnect-orchestrator.test.ts`

**Interfaces:**
- Consumes: `GatewayClient` (the `Pick<'connect'|'invalidate'|'call'|'isOpen'>` type only), `RpcMethods`, `GatewayEvent` (barrel); `backoffMs`, `MAX_RECONNECT_ATTEMPTS` (`src/lib/reconnect.ts`); `resumeRunning`, `TurnAction` (Task 3).
- Produces: contract §5 plus deviation 1: `OrchestratorDeps` (with optional `onResumed`, `onPhase`), `ReconnectOrchestrator {reconnect(trigger), start(), onLiveEvent(e), noteSeq(sid, seq), dispose()}`, `ReconnectTrigger`, `ReconnectPhase`, `createReconnectOrchestrator(deps)`.
- The rules, per spec §7:
  - single-flight across every trigger and `start()`;
  - `client.invalidate()` before minting a ticket, so the old generation's late frames and close are inert;
  - the watermark is app-tracked and never reset across reconnects, except when the `replay_epoch` changes (a backend restart);
  - only events after the last `message.complete` in the replay batch are applied;
  - replay is skipped on `truncated` or when there is no watermark;
  - live events are parked during steps 2–4 and flushed in `seq` order, deduped against the replay;
  - `dispose()` makes every later trigger a no-op.

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/reconnect-orchestrator.test.ts`:

```ts
import { createReconnectOrchestrator, type OrchestratorDeps } from '../reconnect-orchestrator';
import type { TurnAction } from '../turn-controller';

type Ev = { type: string; session_id?: string; seq?: number; payload?: unknown; replayed?: boolean };

/** Scriptable fake client + recorder. Every dep call lands in `log` so order is assertable. */
function harness(over: Partial<OrchestratorDeps> = {}) {
  const log: string[] = [];
  const applied: Ev[] = [];
  const actions: TurnAction[] = [];
  const results: Record<string, unknown[]> = {};
  let tickets = 0;
  const gates: Record<string, (() => void)[]> = {};
  const gate = (name: string) => new Promise<void>((r) => (gates[name] ??= []).push(r));
  const open = (name: string) => (gates[name] ?? []).splice(0).forEach((r) => r());
  const client = {
    isOpen: false,
    invalidate: jest.fn(() => log.push('invalidate')),
    connect: jest.fn(async (url: string) => {
      log.push(`connect:${url}`);
      const r = results.connect?.shift();
      if (r instanceof Error) throw r;
      client.isOpen = true;
    }),
    call: jest.fn(async (method: string, params: unknown) => {
      log.push(`call:${method}`);
      const r = results[method]?.shift();
      if (r instanceof Error) throw r;
      if (method === 'session.resume') await (gates.resume ? gate('resumeHeld') : undefined);
      return r as any;
    }),
  };
  let stored: string | null = 'stored-1';
  const deps: OrchestratorDeps = {
    client: client as any,
    mintUrl: jest.fn(async () => {
      log.push('mint');
      return `ws://gw/t${++tickets}`;
    }),
    storedSessionId: () => stored,
    resumeParams: () => ({ session_id: stored! }),
    loadHistory: jest.fn(async (id: string) => {
      log.push(`history:${id}`);
      if (gates.history) await gate('historyHeld');
    }),
    dispatch: (a) => {
      actions.push(a);
      log.push(`dispatch:${a.type}`);
    },
    applyReplayedEvent: (e) => {
      applied.push(e as Ev);
      log.push(`apply:${e.type}${(e as Ev).replayed ? ':replayed' : ''}`);
    },
    onLiveSessionId: (id) => log.push(`live:${id}`),
    sleep: jest.fn(async () => {}),
    ...over,
  };
  const orch = createReconnectOrchestrator(deps);
  return {
    orch, deps, client, log, applied, actions, results, open,
    holdResume: () => (gates.resume = []),
    holdHistory: () => (gates.history = []),
    setStored: (s: string | null) => (stored = s),
  };
}

const resume = (extra: object = {}) => ({ session_id: 'live-1', message_count: 0, messages: [], info: {}, ...extra });
const since = (events: Ev[], extra: object = {}) => ({ events, latest_seq: 0, truncated: false, count: events.length, epoch: 'e1', open_requests: [], ...extra });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('sequence order', () => {
  it('mint → connect → resume → seed → history, and no replay when idle', async () => {
    const h = harness();
    h.results['session.resume'] = [resume({ running: false })];
    await h.orch.reconnect('close');
    expect(h.log).toEqual([
      'dispatch:socket.lost', 'invalidate', 'mint', 'connect:ws://gw/t1', 'call:session.resume', 'live:live-1',
      'dispatch:resume.seeded', 'history:stored-1',
    ]);
    expect(h.actions).toContainEqual({ type: 'resume.seeded', running: false });
  });

  it('running turn with a watermark: resume → history → events.since, applying only post-last-complete events', async () => {
    const h = harness();
    h.orch.noteSeq('live-1', 10);
    h.results['session.resume'] = [resume({ running: true })];
    h.results['session.events.since'] = [
      since([
        { type: 'message.delta', session_id: 'live-1', seq: 11, payload: { text: 'old' } },
        { type: 'message.complete', session_id: 'live-1', seq: 12 },
        { type: 'message.start', session_id: 'live-1', seq: 13 },
        { type: 'message.delta', session_id: 'live-1', seq: 14, payload: { text: 'new' } },
      ]),
    ];
    await h.orch.reconnect('foreground');
    expect(h.log.indexOf('history:stored-1')).toBeLessThan(h.log.indexOf('call:session.events.since'));
    expect(h.client.call).toHaveBeenCalledWith('session.events.since', { session_id: 'live-1', last_seen: 10 });
    expect(h.applied.map((e) => [e.type, e.seq, e.replayed])).toEqual([
      ['message.start', 13, true],
      ['message.delta', 14, true],
    ]);
  });

  it('skips replay with no watermark yet (cold start / fresh screen)', async () => {
    const h = harness();
    h.results['session.resume'] = [resume({ running: true })];
    await h.orch.reconnect('close');
    expect(h.client.call).not.toHaveBeenCalledWith('session.events.since', expect.anything());
    expect(h.actions).toContainEqual({ type: 'resume.seeded', running: true });
  });

  it('skips replay when the result is truncated', async () => {
    const h = harness();
    h.orch.noteSeq('live-1', 3);
    h.results['session.resume'] = [resume({ running: true })];
    h.results['session.events.since'] = [since([{ type: 'message.delta', session_id: 'live-1', seq: 900 }], { truncated: true })];
    await h.orch.reconnect('close');
    expect(h.applied).toEqual([]);
  });

  it('a replay failure (0.20.4 -32601) is swallowed and the run still succeeds', async () => {
    const phases: string[] = [];
    const h = harness({ onPhase: (p) => phases.push(p.kind) });
    h.orch.noteSeq('live-1', 3);
    h.results['session.resume'] = [resume({ running: true })];
    h.results['session.events.since'] = [new Error('unknown method')];
    await h.orch.reconnect('close');
    expect(phases).toEqual(['attempt', 'ready']);
  });

  it('seeds from inflight.streaming alone (0.20.4 shape)', async () => {
    const h = harness();
    h.results['session.resume'] = [resume({ inflight: { streaming: true } })];
    await h.orch.reconnect('close');
    expect(h.actions).toContainEqual({ type: 'resume.seeded', running: true });
  });

  it('a fresh chat (no stored id) only connects', async () => {
    const h = harness();
    h.setStored(null);
    await h.orch.reconnect('close');
    expect(h.log).toEqual(['dispatch:socket.lost', 'invalidate', 'mint', 'connect:ws://gw/t1']);
  });
});

describe('single-flight', () => {
  it('close + heartbeat + foreground + stop-timeout during one run → one mint, one connect', async () => {
    const h = harness();
    h.holdResume();
    h.results['session.resume'] = [resume()];
    const a = h.orch.reconnect('close');
    await flush();
    const b = h.orch.reconnect('heartbeat');
    const c = h.orch.reconnect('foreground');
    const d = h.orch.reconnect('stop-timeout');
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(d).toBe(a);
    h.open('resumeHeld');
    await a;
    expect(h.deps.mintUrl).toHaveBeenCalledTimes(1);
    expect(h.client.connect).toHaveBeenCalledTimes(1);
  });

  it('start() and a foreground reconnect share one slot (initial connect holds off reconnects)', async () => {
    const h = harness();
    h.holdResume();
    h.results['session.resume'] = [resume()];
    const s = h.orch.start();
    await flush();
    expect(h.orch.reconnect('foreground')).toBe(s);
    h.open('resumeHeld');
    await s;
    expect(h.client.connect).toHaveBeenCalledTimes(1);
  });

  it('a trigger after the run finished starts a new run', async () => {
    const h = harness();
    h.results['session.resume'] = [resume(), resume()];
    await h.orch.reconnect('close');
    await h.orch.reconnect('close');
    expect(h.client.connect).toHaveBeenCalledTimes(2);
  });

  it('retries with backoff, re-minting a ticket per attempt, then reports failed', async () => {
    const phases: string[] = [];
    const h = harness({ onPhase: (p) => phases.push(p.kind === 'attempt' ? `attempt${p.attempt}` : p.kind) });
    h.results.connect = [new Error('x'), new Error('x'), new Error('x'), new Error('x'), new Error('x')];
    await h.orch.reconnect('close');
    expect(h.deps.sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(h.deps.sleep).toHaveBeenNthCalledWith(5, 8000);
    expect(h.deps.mintUrl).toHaveBeenCalledTimes(5);
    expect(phases).toEqual(['attempt1', 'attempt2', 'attempt3', 'attempt4', 'attempt5', 'failed']);
  });

  it('start() is a single attempt and rejects on failure', async () => {
    const h = harness();
    h.results.connect = [new Error('offline')];
    await expect(h.orch.start()).rejects.toThrow('offline');
    expect(h.deps.sleep).not.toHaveBeenCalled();
  });
});

describe('parking live events during steps 2–4', () => {
  it('parks live events during history, applies them after replay in seq order, deduped by seq', async () => {
    const h = harness();
    h.orch.noteSeq('live-1', 10);
    h.holdHistory();
    h.results['session.resume'] = [resume({ running: true })];
    h.results['session.events.since'] = [since([
      { type: 'message.delta', session_id: 'live-1', seq: 11, payload: { text: 'a' } },
      { type: 'message.delta', session_id: 'live-1', seq: 12, payload: { text: 'b' } },
    ])];
    const run = h.orch.reconnect('close');
    await flush();
    // live frames racing the reconnect: 12 duplicates the replay, 14 arrives before 13
    h.orch.onLiveEvent({ type: 'message.delta', session_id: 'live-1', seq: 12, payload: { text: 'b' } } as any);
    h.orch.onLiveEvent({ type: 'message.delta', session_id: 'live-1', seq: 14, payload: { text: 'd' } } as any);
    h.orch.onLiveEvent({ type: 'message.delta', session_id: 'live-1', seq: 13, payload: { text: 'c' } } as any);
    expect(h.applied).toEqual([]); // nothing applied while parked
    h.open('historyHeld');
    await run;
    expect(h.applied.map((e) => [e.seq, !!e.replayed])).toEqual([
      [11, true], [12, true], [13, false], [14, false],
    ]);
  });

  it('after the run, live events apply immediately and advance the watermark', async () => {
    const h = harness();
    h.results['session.resume'] = [resume()];
    await h.orch.reconnect('close');
    h.orch.onLiveEvent({ type: 'message.delta', session_id: 'live-1', seq: 5 } as any);
    expect(h.applied.map((e) => e.seq)).toEqual([5]);
    h.results['session.resume'] = [resume({ running: true })];
    h.results['session.events.since'] = [since([])];
    await h.orch.reconnect('close');
    expect(h.client.call).toHaveBeenCalledWith('session.events.since', { session_id: 'live-1', last_seen: 5 });
  });

  it('a failed attempt drops its parked frames; the next attempt re-resumes', async () => {
    const h = harness();
    h.results['session.resume'] = [new Error('boom'), resume()];
    const run = h.orch.reconnect('close');
    await run;
    expect(h.client.call.mock.calls.filter((c) => c[0] === 'session.resume')).toHaveLength(2);
  });
});

describe('epoch (backend restart)', () => {
  it('a changed gateway.ready replay_epoch clears watermarks, so replay is skipped', async () => {
    const h = harness();
    h.orch.onLiveEvent({ type: 'gateway.ready', payload: { replay_epoch: 'e1' } } as any);
    h.orch.noteSeq('live-1', 97);
    h.orch.onLiveEvent({ type: 'gateway.ready', payload: { replay_epoch: 'e2' } } as any);
    h.results['session.resume'] = [resume({ running: true })];
    await h.orch.reconnect('close');
    expect(h.client.call).not.toHaveBeenCalledWith('session.events.since', expect.anything());
  });
});

describe('dispose', () => {
  it('stops an in-flight run and makes later triggers no-ops', async () => {
    const h = harness();
    h.holdResume();
    h.results['session.resume'] = [resume()];
    const run = h.orch.reconnect('close');
    await flush();
    h.orch.dispose();
    h.open('resumeHeld');
    await run;
    expect(h.deps.loadHistory).not.toHaveBeenCalled();
    await h.orch.reconnect('foreground');
    expect(h.deps.mintUrl).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/lib/__tests__/reconnect-orchestrator.test.ts`
Expected: FAIL with "Cannot find module '../reconnect-orchestrator'".

- [ ] **Step 3: Implement**

`src/lib/reconnect-orchestrator.ts`:

```ts
// src/lib/reconnect-orchestrator.ts — the single-flight reconnect sequence (spec §7, contract §5).
// Extracted from chat/[id].tsx (PR #22 hardening) and injected, so it is unit-testable.
//
// Sequence per attempt:
//   1. client.connect(fresh ticket URL) — the adapter invalidates the old generation first and
//      resolves only after gateway.ready (+1 tick), so capabilities precede resume.
//   2. session.resume (open_requests are routed into cards by the channel before it resolves;
//      running/status/inflight seed the turn state).
//   3. history replace (cards live outside items, so they survive).
//   4. in-flight replay via session.events.since with the app-tracked watermark; apply only
//      events after the batch's last message.complete; skip on truncated / no watermark.
//   5. live events that arrived during 2–4 were parked; flush them in seq order, deduped.
import type { GatewayClient } from '@/api/gatewayClient';
import type { GatewayEvent, RpcMethods } from '@/vendor/hermes-gateway';
import { backoffMs, MAX_RECONNECT_ATTEMPTS } from './reconnect';
import { resumeRunning, type TurnAction } from './turn-controller';

type ResumeResult = RpcMethods['session.resume']['result'];

export type ReconnectTrigger = 'close' | 'heartbeat' | 'foreground' | 'stop-timeout';

export type ReconnectPhase =
  | { kind: 'attempt'; attempt: number; max: number }
  | { kind: 'ready' }
  | { kind: 'failed' };

export interface OrchestratorDeps {
  client: Pick<GatewayClient, 'connect' | 'invalidate' | 'call' | 'isOpen'>;
  mintUrl: () => Promise<string>;
  storedSessionId: () => string | null;
  resumeParams: () => RpcMethods['session.resume']['params'];
  loadHistory: (storedId: string) => Promise<void>;
  dispatch: (a: TurnAction) => void;
  /** The ONE event sink (live and replayed). Replayed events arrive with `replayed: true`. */
  applyReplayedEvent: (e: GatewayEvent) => void;
  onLiveSessionId: (liveId: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** Additive (see plan "Contract deviations"): the full resume result (model pill, claim). */
  onResumed?: (res: ResumeResult) => void;
  /** Additive: progress for the reconnect note / error line / ready flag. */
  onPhase?: (p: ReconnectPhase) => void;
}

export interface ReconnectOrchestrator {
  reconnect(trigger: ReconnectTrigger): Promise<void>;
  /** Additive: the initial connect — one attempt, no backoff, same single-flight slot. Rejects on failure. */
  start(): Promise<void>;
  onLiveEvent(e: GatewayEvent): void;
  noteSeq(sessionId: string, seq: number): void;
  dispose(): void;
}

function seqOf(e: GatewayEvent): number | null {
  return typeof e.seq === 'number' && Number.isFinite(e.seq) ? e.seq : null;
}

export function createReconnectOrchestrator(deps: OrchestratorDeps): ReconnectOrchestrator {
  const watermarks = new Map<string, number>();
  let epoch: string | null = null;
  let inflight: Promise<void> | null = null;
  let parked: GatewayEvent[] | null = null;
  let disposed = false;

  function noteSeq(sessionId: string, seq: number): void {
    if ((watermarks.get(sessionId) ?? 0) < seq) watermarks.set(sessionId, seq);
  }

  function applyLive(e: GatewayEvent): void {
    const s = seqOf(e);
    if (e.session_id && s !== null) noteSeq(e.session_id, s);
    deps.applyReplayedEvent(e);
  }

  function adoptEpoch(e: GatewayEvent): void {
    const next = (e.payload as { replay_epoch?: unknown } | undefined)?.replay_epoch;
    if (typeof next !== 'string' || !next) return;
    // Backend restart: seq counters reset, old watermarks describe a numbering that no longer exists.
    if (epoch !== null && epoch !== next) watermarks.clear();
    epoch = next;
  }

  async function replay(liveId: string): Promise<void> {
    const last = watermarks.get(liveId);
    if (last === undefined) return; // cold start / fresh screen: nothing to anchor a replay on
    let res: RpcMethods['session.events.since']['result'];
    try {
      res = await deps.client.call('session.events.since', { session_id: liveId, last_seen: last });
    } catch {
      return; // 0.20.4 (-32601) or a transient failure: the live stream carries on
    }
    if (res.truncated) return;
    if (epoch !== null && res.epoch && res.epoch !== epoch) {
      watermarks.clear();
      epoch = res.epoch;
      return;
    }
    const events = (Array.isArray(res.events) ? res.events : []) as unknown as GatewayEvent[];
    let lastComplete = -1;
    events.forEach((e, i) => {
      if (e?.type === 'message.complete') lastComplete = i;
    });
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const s = seqOf(e);
      if (s !== null) noteSeq(liveId, s); // history covers everything up to the last complete
      if (i > lastComplete && e?.type) deps.applyReplayedEvent({ ...e, replayed: true });
    }
  }

  function flushParked(): void {
    const batch = parked ?? [];
    parked = null;
    const ordered = batch
      .map((e, i) => ({ e, i }))
      .sort((a, b) => {
        const sa = seqOf(a.e);
        const sb = seqOf(b.e);
        return sa !== null && sb !== null && a.e.session_id === b.e.session_id ? sa - sb : a.i - b.i;
      });
    for (const { e } of ordered) {
      const s = seqOf(e);
      if (e.session_id && s !== null && s <= (watermarks.get(e.session_id) ?? 0)) continue; // replayed already
      applyLive(e);
    }
  }

  async function runSequence(): Promise<void> {
    parked = [];
    try {
      deps.client.invalidate(); // drop the old generation FIRST: its late frames/close are inert
      const url = await deps.mintUrl();
      if (disposed) return;
      await deps.client.connect(url);
      if (disposed) return;
      const storedId = deps.storedSessionId();
      if (storedId) {
        const res = await deps.client.call('session.resume', deps.resumeParams());
        if (disposed) return;
        deps.onLiveSessionId(res.session_id);
        deps.onResumed?.(res);
        const running = resumeRunning(res);
        deps.dispatch({ type: 'resume.seeded', running });
        await deps.loadHistory(storedId);
        if (disposed) return;
        if (running) await replay(res.session_id);
        if (disposed) return;
      }
      flushParked();
    } catch (e) {
      parked = null; // this generation's parked frames die with it; the next attempt re-resumes
      throw e;
    }
  }

  function singleFlight(body: () => Promise<void>): Promise<void> {
    if (disposed) return Promise.resolve();
    if (inflight) return inflight;
    const run = body().finally(() => {
      if (inflight === run) inflight = null;
    });
    inflight = run;
    return run;
  }

  return {
    reconnect(_trigger) {
      return singleFlight(async () => {
        deps.dispatch({ type: 'socket.lost' });
        for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
          if (disposed) return;
          deps.onPhase?.({ kind: 'attempt', attempt, max: MAX_RECONNECT_ATTEMPTS });
          await deps.sleep(backoffMs(attempt));
          if (disposed) return;
          try {
            await runSequence();
            if (!disposed) deps.onPhase?.({ kind: 'ready' });
            return;
          } catch {
            // next attempt, longer backoff
          }
        }
        if (!disposed) deps.onPhase?.({ kind: 'failed' });
      });
    },
    start() {
      return singleFlight(async () => {
        await runSequence();
        if (!disposed) deps.onPhase?.({ kind: 'ready' });
      });
    },
    onLiveEvent(e) {
      if (e.type === 'gateway.ready') adoptEpoch(e);
      if (parked) {
        parked.push(e);
        return;
      }
      applyLive(e);
    },
    noteSeq,
    dispose() {
      disposed = true;
      parked = null;
    },
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/lib/__tests__/reconnect-orchestrator.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Run the gate and commit**

Run: `npx tsc --noEmit && npx jest`

```bash
git add src/lib/reconnect-orchestrator.ts src/lib/__tests__/reconnect-orchestrator.test.ts
git commit -m "feat(reconnect): single-flight orchestrator — resume → history → in-flight replay, parked live events" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Per-screen chat transport, the 4001 helper, and integration tests for the review-focus races

**Files:**
- Create: `src/api/stale-session.ts`, `src/api/chat-transport.ts`, `src/api/__tests__/fixtures/fake-gateway.ts`
- Test: `src/api/__tests__/chat-transport.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces:
  - `withStaleSessionRetry(sessionId, run, resume)` and `STALE_SESSION_CODE = 4001`;
  - `createChatTransport(opts: ChatTransportOptions): ChatTransport {client, store, registry, orchestrator, resumeStored(), dispose()}`;
  - `createFakeGateway(): FakeGateway {factory, sockets, current(), responders, ready, autoOpen}`, `HOLD`, `rpcErr(code, message)`.
- The per-event sink order is: router (`request.cancel`, legacy approval) → `turnActionFor` into the store → `opts.applyEvent`.
- Registration order at construction: `onRequest`, then `onEvent`, then `onState('closed') → reconnect('close')`.
- `dispose()` disposes the orchestrator **before** closing the client.

- [ ] **Step 1: Write the fixture and the failing test**

`src/api/__tests__/fixtures/fake-gateway.ts`:

```ts
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
```

`src/api/__tests__/chat-transport.test.ts`:

```ts
import { createChatTransport, type ChatTransport } from '@/api/chat-transport';
import { RpcError } from '@/api/gatewayClient';
import { withStaleSessionRetry } from '@/api/stale-session';
import type { GatewayEvent } from '@/vendor/hermes-gateway';
import { installFakeWebSocketGlobal, restoreWebSocketGlobal } from './fixtures/fake-socket';
import { createFakeGateway, HOLD, rpcErr, type FakeGateway } from './fixtures/fake-gateway';
import { event, serverRequest } from './fixtures/frames';

beforeAll(installFakeWebSocketGlobal);
afterAll(restoreWebSocketGlobal);

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 6) {
  for (let i = 0; i < n; i++) await tick();
}

const CLARIFY = { session_id: 'live-1', questions: [{ qid: 'q0', question: 'Which?', choices: ['a', 'b'], multi_select: false }] };

let live: ChatTransport[] = [];
afterEach(() => {
  for (const t of live.splice(0)) t.dispose();
});

function setup(opts: { stored?: string | null; history?: () => Promise<void>; onNewCard?: () => void } = {}) {
  const gw: FakeGateway = createFakeGateway();
  let stored: string | null = opts.stored === undefined ? 'stored-1' : opts.stored;
  let liveId: string | null = null;
  let tickets = 0;
  const applied: GatewayEvent[] = [];
  const historyCalls: string[] = [];
  gw.responders['session.resume'] = () => ({ session_id: 'live-1', message_count: 0, messages: [], info: {} });
  const t = createChatTransport({
    socketFactory: gw.factory,
    mintUrl: async () => `ws://gw.test/api/ws?ticket=t${++tickets}`,
    storedSessionId: () => stored,
    resumeParams: () => ({ session_id: stored! }),
    loadHistory: async (id) => {
      historyCalls.push(id);
      await opts.history?.();
    },
    onLiveSessionId: (id) => (liveId = id),
    applyEvent: (e) => applied.push(e),
    anchorKey: () => null,
    onNewCard: opts.onNewCard,
    sleep: async () => {},
  });
  live.push(t);
  return { gw, t, applied, historyCalls, getLive: () => liveId, setStored: (s: string) => (stored = s) };
}

describe('handshake', () => {
  it('frame order on the wire: client.capabilities before session.resume', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    expect(gw.current().sent.map((f) => f.method).filter(Boolean)).toEqual(['client.capabilities', 'session.resume']);
  });
});

describe('server requests before any UI state (review M3)', () => {
  it('open_requests in the resume result become cards with NO -32601, before resume resolves', async () => {
    const { gw, t } = setup();
    gw.responders['session.resume'] = () => ({
      session_id: 'live-1', message_count: 0, messages: [], info: {},
      open_requests: [
        { id: 'srq-a', method: 'approval', params: { session_id: 'live-1', request_id: 'r1', command: 'rm -rf x' } },
        { id: 'srq-c', method: 'clarify', params: CLARIFY },
        { id: 'srq-s', method: 'secret', params: { session_id: 'live-1', env_var: 'K', prompt: 'p' } },
        { id: 'srq-u', method: 'sudo', params: { session_id: 'live-1', command: 'apt' } },
      ],
      pending_approval: { command: 'rm -rf x' }, // duplicates srq-a at 0.21.5 — must be ignored
    });
    await t.orchestrator.start();
    const cards = t.store.getState().requests;
    expect(cards.map((c) => [c.id, c.kind, c.status])).toEqual([
      ['srq-a', 'approval', 'pending'],
      ['srq-c', 'clarify', 'pending'],
      ['srq-s', 'secure-entry', 'pending'],
      ['srq-u', 'secure-entry', 'pending'],
    ]);
    const errors = gw.current().sent.filter((f) => typeof f.id === 'string' && f.id.startsWith('srq-') && f.error);
    expect(errors).toEqual([]);
  });

  it('desktop-only requests get -32601; vault gets -32601 plus a declined card', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-t', 'terminal.read', { session_id: 'live-1' }));
    gw.current().serverSend(serverRequest('srq-v', 'vault.unlock_prompt', { session_id: 'live-1', backend: 'op', display_name: '1P' }));
    const sent = gw.current().sent;
    expect(sent.find((f) => f.id === 'srq-t')).toMatchObject({ error: { code: -32601 } });
    expect(sent.find((f) => f.id === 'srq-v')).toMatchObject({ error: { code: -32601 } });
    expect(t.store.getState().requests.map((c) => [c.id, c.kind, c.status])).toEqual([['srq-v', 'vault-declined', 'skipped']]);
  });
});

describe('review focus: supported methods never get -32601/-32603', () => {
  it('a throwing UI callback on a new card does not become a -32603 (approval stays answerable)', async () => {
    const { gw, t } = setup({ onNewCard: () => { throw new Error('render bug'); } });
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-a', 'approval', { session_id: 'live-1', request_id: 'r', command: 'x' }));
    expect(gw.current().sent.find((f) => f.id === 'srq-a')).toBeUndefined();
    expect(t.store.getState().requests[0]).toMatchObject({ id: 'srq-a', status: 'pending' });
    expect(t.registry.respond('srq-a', { choice: 'deny' })).toBe(true);
  });
});

describe('review focus: duplicate replay', () => {
  it('the same open request re-delivered by resume AND events.since, plus a racing live delta → one card, one delta', async () => {
    const { gw, t, applied } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(event('message.start', {}, { session_id: 'live-1', seq: 1 }));
    gw.current().serverSend(serverRequest('srq-c', 'clarify', CLARIFY));
    const open = [{ id: 'srq-c', method: 'clarify', params: CLARIFY }];
    gw.responders['session.resume'] = () => ({ session_id: 'live-1', message_count: 0, messages: [], info: {}, running: true, open_requests: open });
    gw.responders['session.events.since'] = (_p, sock) => {
      // a live frame races the replay response on the new socket
      sock.serverSend(event('message.delta', { text: 'B' }, { session_id: 'live-1', seq: 3 }));
      return { events: [{ type: 'message.delta', session_id: 'live-1', seq: 2, payload: { text: 'A' } }, { type: 'message.delta', session_id: 'live-1', seq: 3, payload: { text: 'B' } }], latest_seq: 3, truncated: false, count: 2, epoch: 'e1', open_requests: open };
    };
    gw.current().drop();
    await settle(10);
    expect(t.store.getState().requests.map((c) => c.id)).toEqual(['srq-c']);
    const deltas = applied.filter((e) => e.type === 'message.delta').map((e) => [(e.payload as any).text, !!e.replayed]);
    expect(deltas).toEqual([['A', true], ['B', true]]);
  });
});

describe('reconnect mid-clarify (review B1)', () => {
  it('socket drop → resume re-delivers → history replace → card still present and answerable on the NEW socket', async () => {
    const { gw, t, historyCalls } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-c', 'clarify', CLARIFY));
    expect(t.store.getState().requests).toHaveLength(1);
    const first = gw.current();
    gw.responders['session.resume'] = () => ({
      session_id: 'live-1', message_count: 0, messages: [], info: {}, running: true,
      open_requests: [{ id: 'srq-c', method: 'clarify', params: CLARIFY }],
    });
    first.drop();
    await settle();
    expect(gw.sockets).toHaveLength(2);
    expect(historyCalls).toEqual(['stored-1', 'stored-1']);
    const cards = t.store.getState().requests;
    expect(cards).toHaveLength(1); // deduped by id, not duplicated
    expect(cards[0]).toMatchObject({ id: 'srq-c', status: 'pending' });
    expect(t.registry.respond('srq-c', { answers: { q0: 'a' } })).toBe(true);
    expect(gw.current().sent.find((f) => f.id === 'srq-c')).toEqual({ jsonrpc: '2.0', id: 'srq-c', result: { answers: { q0: 'a' } } });
    expect(first.sent.find((f) => f.id === 'srq-c')).toBeUndefined();
  });

  it('reconnect DURING resume: the second drop joins/restarts cleanly and the card survives', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-c', 'clarify', CLARIFY));
    let holdOnce = true;
    gw.responders['session.resume'] = (_p, sock) => {
      if (holdOnce) {
        holdOnce = false;
        setTimeout(() => sock.drop(), 0); // drop while resume is in flight
        return HOLD;
      }
      return { session_id: 'live-1', message_count: 0, messages: [], info: {}, open_requests: [{ id: 'srq-c', method: 'clarify', params: CLARIFY }] };
    };
    gw.sockets[0].drop();
    await settle(12);
    expect(gw.sockets).toHaveLength(3);
    expect(t.store.getState().requests.map((c) => [c.id, c.status])).toEqual([['srq-c', 'pending']]);
    expect(t.client.isOpen).toBe(true);
  });
});

describe('teardown order (PR #22 hardening)', () => {
  it("the old socket's late close after a successful reconnect starts no second run", async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    const old = gw.current();
    old.readyState = 3; // OS tore it down silently (iOS suspension) — no close event yet
    await t.orchestrator.reconnect('foreground');
    expect(gw.sockets).toHaveLength(2);
    old.drop(); // the late close finally fires
    await settle();
    expect(gw.sockets).toHaveLength(2);
    expect(t.client.isOpen).toBe(true);
  });

  it('dispose() closes the socket without reconnecting', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    t.dispose();
    await settle();
    expect(gw.sockets).toHaveLength(1);
    expect(gw.sockets[0].closed).toBe(true);
  });

  it('heartbeat-style invalidate + foreground in the same tick → one new socket', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    t.client.invalidate(); // what the vendored heartbeat does on deadline → onState('closed')
    void t.orchestrator.reconnect('foreground');
    await settle();
    expect(gw.sockets).toHaveLength(2);
  });
});

describe('events', () => {
  it('request.cancel closes the card and drops the live request', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(serverRequest('srq-a', 'approval', { session_id: 'live-1', request_id: 'r', command: 'x' }));
    gw.current().serverSend(event('request.cancel', { id: 'srq-a', method: 'approval', reason: 'interrupted' }, { session_id: 'live-1', seq: 4 }));
    expect(t.store.getState().requests[0]).toMatchObject({ status: 'cancelled', cancelReason: 'interrupted' });
    expect(t.registry.respond('srq-a', { choice: 'once' })).toBe(false);
  });

  it('message.start with no local send drives streaming; error while waiting ends the turn', async () => {
    const { gw, t, applied } = setup();
    await t.orchestrator.start();
    gw.current().serverSend(event('message.start', {}, { session_id: 'live-1', seq: 1 }));
    expect(t.store.getState().turn).toBe('streaming');
    gw.current().serverSend(event('message.complete', { status: 'interrupted' }, { session_id: 'live-1', seq: 2 }));
    expect(t.store.getState()).toMatchObject({ turn: 'idle', lastStatus: 'interrupted' });
    t.store.dispatch({ type: 'submit.sent' });
    gw.current().serverSend(event('error', { message: 'agent init failed' }, { session_id: 'live-1', seq: 3 }));
    expect(t.store.getState().turn).toBe('idle');
    expect(applied.map((e) => e.type)).toEqual(['gateway.ready', 'message.start', 'message.complete', 'error']);
  });

  it('0.20.4: approval.request event → legacy card; approval.respond is typed and callable', async () => {
    const { gw, t } = setup();
    gw.ready = {}; // 0.20.4 ready: no heartbeat, no replay_epoch
    gw.responders['client.capabilities'] = () => rpcErr(-32601, 'unknown method');
    gw.responders['approval.respond'] = () => ({ resolved: 1 });
    await t.orchestrator.start();
    gw.current().serverSend(event('approval.request', { command: 'rm -rf build', description: 'recursive delete' }, { session_id: 'live-1' }));
    expect(t.store.getState().requests).toEqual([
      expect.objectContaining({ id: 'legacy:1', kind: 'approval', legacy: true, status: 'pending' }),
    ]);
    await expect(t.client.call('approval.respond', { session_id: 'live-1', choice: 'once' })).resolves.toEqual({ resolved: 1 });
  });
});

describe('stale live session id (4001)', () => {
  it('resumeStored() + withStaleSessionRetry retries once with the fresh live id', async () => {
    const { gw, t, getLive } = setup();
    await t.orchestrator.start();
    let calls = 0;
    gw.responders['session.interrupt'] = (p) => (++calls === 1 ? rpcErr(4001, 'session not found') : { status: 'interrupted', seen: p.session_id });
    gw.responders['session.resume'] = () => ({ session_id: 'live-2', message_count: 0, messages: [], info: {} });
    const out = await withStaleSessionRetry(
      'live-1',
      (sid) => t.client.call('session.interrupt', { session_id: sid }),
      () => t.resumeStored(),
    );
    expect(out).toMatchObject({ seen: 'live-2' });
    expect(getLive()).toBe('live-2');
  });

  it('a second 4001 is surfaced, not retried forever', async () => {
    const { gw, t } = setup();
    await t.orchestrator.start();
    gw.responders['session.interrupt'] = () => rpcErr(4001, 'session not found');
    await expect(
      withStaleSessionRetry('live-1', (sid) => t.client.call('session.interrupt', { session_id: sid }), () => t.resumeStored()),
    ).rejects.toEqual(expect.objectContaining({ code: 4001 }));
    expect(new RpcError('x', 4001)).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/api/__tests__/chat-transport.test.ts`
Expected: FAIL with "Cannot find module '@/api/chat-transport'".

- [ ] **Step 3: Implement**

`src/api/stale-session.ts`:

```ts
// src/api/stale-session.ts — the `4001` rule (spec §3.2, §5.3, review m10): a stale runtime
// session id → resume the STORED id and retry ONCE with the fresh live id. Used by config.set
// (this plan) and by Stop/steer (plan B).
import { RpcError } from './gatewayClient';

export const STALE_SESSION_CODE = 4001;

export async function withStaleSessionRetry<T>(
  sessionId: string,
  run: (sid: string) => Promise<T>,
  resume: () => Promise<string>,
): Promise<T> {
  try {
    return await run(sessionId);
  } catch (e) {
    if (!(e instanceof RpcError) || e.code !== STALE_SESSION_CODE) throw e;
    return run(await resume());
  }
}
```

`src/api/chat-transport.ts`:

```ts
// src/api/chat-transport.ts — one chat screen's transport, built ONCE per screen (spec §4.2):
// the GatewayClient, the turn store, the request registry/router and the reconnect
// orchestrator, with every handler registered at construction, before the first connect().
import type { GatewayEvent, RpcMethods } from '@/vendor/hermes-gateway';
import { createReconnectOrchestrator, type ReconnectOrchestrator, type ReconnectPhase } from '@/lib/reconnect-orchestrator';
import { createRequestRegistry, type RequestRegistry } from '@/lib/request-registry';
import { createRequestRouter } from '@/lib/request-router';
import { resumeRunning, turnActionFor, type RequestCardState } from '@/lib/turn-controller';
import { createTurnStore, type TurnStore } from '@/lib/turn-store';
import { GatewayClient } from './gatewayClient';

type ResumeResult = RpcMethods['session.resume']['result'];

export interface ChatTransportOptions {
  socketFactory: (url: string) => WebSocket;
  mintUrl: () => Promise<string>;
  storedSessionId: () => string | null;
  resumeParams: () => RpcMethods['session.resume']['params'];
  loadHistory: (storedId: string) => Promise<void>;
  onLiveSessionId: (liveId: string) => void;
  onResumed?: (res: ResumeResult) => void;
  onPhase?: (p: ReconnectPhase) => void;
  /** Transcript side of every event (live and replayed), AFTER the turn store has been updated.
   * Not called for events the request router consumed (request.cancel, legacy approval.request). */
  applyEvent: (e: GatewayEvent) => void;
  /** Key of the last transcript item (a new card's anchor). */
  anchorKey: () => string | null;
  onNewCard?: (card: RequestCardState, replayed: boolean) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  requestTimeoutMs?: number;
}

export interface ChatTransport {
  client: GatewayClient;
  store: TurnStore;
  registry: RequestRegistry;
  orchestrator: ReconnectOrchestrator;
  /** session.resume on the stored id → fresh live id (the 4001 stale-session recovery). */
  resumeStored(): Promise<string>;
  dispose(): void;
}

export function createChatTransport(opts: ChatTransportOptions): ChatTransport {
  const client = new GatewayClient({ socketFactory: opts.socketFactory, requestTimeoutMs: opts.requestTimeoutMs });
  const store = createTurnStore();
  const registry = createRequestRegistry();
  const router = createRequestRouter({
    store,
    registry,
    anchorKey: opts.anchorKey,
    now: opts.now,
    onNewCard: opts.onNewCard,
  });

  /** The single event sink: request routing, then turn state, then the transcript. */
  function sink(e: GatewayEvent): void {
    if (router.handleEvent(e)) return;
    const action = turnActionFor(e);
    if (action) store.dispatch(action);
    opts.applyEvent(e);
  }

  const orchestrator = createReconnectOrchestrator({
    client,
    mintUrl: opts.mintUrl,
    storedSessionId: opts.storedSessionId,
    resumeParams: opts.resumeParams,
    loadHistory: opts.loadHistory,
    dispatch: (a) => store.dispatch(a),
    applyReplayedEvent: sink,
    onLiveSessionId: opts.onLiveSessionId,
    onResumed: opts.onResumed,
    onPhase: opts.onPhase,
    sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  });

  // Registration order matters: requests first (review M3), then events, then state.
  client.onRequest((req) => router.handleRequest(req));
  client.onEvent((e) => orchestrator.onLiveEvent(e));
  client.onState((s) => {
    if (s === 'closed') void orchestrator.reconnect('close');
  });

  let disposed = false;
  return {
    client,
    store,
    registry,
    orchestrator,
    async resumeStored() {
      const res = await client.call('session.resume', opts.resumeParams());
      opts.onLiveSessionId(res.session_id);
      opts.onResumed?.(res);
      store.dispatch({ type: 'resume.seeded', running: resumeRunning(res) });
      return res.session_id;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      orchestrator.dispose(); // FIRST: the close below must not start a reconnect
      client.close();
    },
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/api/__tests__/chat-transport.test.ts`
Expected: PASS, 15 tests, including "reconnect DURING resume", "duplicate replay", "heartbeat-style invalidate + foreground", "open_requests … NO -32601", "a throwing UI callback …" and "stale live session id".

- [ ] **Step 5: Run the gate and commit**

Run: `npx tsc --noEmit && npx jest`

```bash
git add src/api/stale-session.ts src/api/chat-transport.ts src/api/__tests__/fixtures/fake-gateway.ts src/api/__tests__/chat-transport.test.ts
git commit -m "feat(transport): per-screen chat transport (handlers at construction) + 4001 resume-and-retry-once" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 0.21.5 correctness: `config.set` 4001 retry, and `>>>…<<<` search snippets

**Files:**
- Modify: `src/api/sessionModel.ts`, `src/api/search.ts`
- Test: `__tests__/sessionModel.test.ts`, `__tests__/search.test.ts` (append)

**Interfaces:**
- Consumes: `withStaleSessionRetry` (Task 6).
- Produces: `switchSessionModel(call, {sessionId, provider, model, confirmExpensive?, resumeSession?})`, where a present `resumeSession` enables resume-and-retry-once on `4001`. `parseSnippet` understands `>>>…<<<` (and still `<b>…</b>`).

- [ ] **Step 1: Write the failing tests.** Append inside the `describe('switchSessionModel', …)` block of `__tests__/sessionModel.test.ts`, before its final `});`:

```ts
  it('4001 (stale live id) → resumeSession once → retries with the fresh id', async () => {
    const seen: string[] = [];
    const call = async (_m: string, params: any) => {
      seen.push(params.session_id);
      if (seen.length === 1) throw new RpcError('session not found', 4001);
      return { key: 'model', value: 'openrouter/glm-5.2' };
    };
    const resumeSession = jest.fn(async () => 's2');
    expect(await switchSessionModel(call as any, { ...args, resumeSession })).toEqual({ kind: 'ok', model: 'openrouter/glm-5.2' });
    expect(resumeSession).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['s1', 's2']);
  });

  it('a second 4001 surfaces as an error (retry once only)', async () => {
    const call = async () => {
      throw new RpcError('session not found', 4001);
    };
    const resumeSession = jest.fn(async () => 's2');
    expect(await switchSessionModel(call as any, { ...args, resumeSession })).toEqual({ kind: 'error', message: 'session not found' });
    expect(resumeSession).toHaveBeenCalledTimes(1);
  });

  it('without resumeSession a 4001 is a plain error', async () => {
    const call = async () => {
      throw new RpcError('session not found', 4001);
    };
    expect(await switchSessionModel(call as any, args)).toEqual({ kind: 'error', message: 'session not found' });
  });
```

Append to the end of `__tests__/search.test.ts`:

```ts

describe('parseSnippet — FTS5 >>>…<<< markers (the server format at both tags)', () => {
  it('splits >>>match<<< runs', () => {
    expect(parseSnippet('before >>>match<<< after')).toEqual([
      { text: 'before ', match: false },
      { text: 'match', match: true },
      { text: ' after', match: false },
    ]);
  });
  it('never shows the literal markers', () => {
    const text = parseSnippet('>>>a<<< mid >>>b<<<').map((s) => s.text).join('');
    expect(text).toBe('a mid b');
  });
  it('decodes entities inside a match', () => {
    expect(parseSnippet('>>>a &amp; b<<<')).toEqual([{ text: 'a & b', match: true }]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest __tests__/sessionModel.test.ts __tests__/search.test.ts`
Expected: FAIL. The 4001 test gets `{kind:'error'}` and `resumeSession` is never called. The snippet tests show the literal `>>>`.

- [ ] **Step 3: Implement.** In `src/api/sessionModel.ts`:
1. Add `import { withStaleSessionRetry } from './stale-session';` after the `RpcError` import.
2. Replace the doc comment and signature of `switchSessionModel`, through the end of the `const res = await call('config.set', {…});` statement, with:

```ts
/** Switch THIS session's model via the gateway `config.set` RPC.
 * `call` is `GatewayClient['call']` (injected for tests). A stale live id (4001 at
 * 0.21.5) is recovered once through `resumeSession` (spec §5.3, review m10). */
export async function switchSessionModel(
  call: GatewayClient['call'],
  args: {
    sessionId: string;
    provider: string;
    model: string;
    confirmExpensive?: boolean;
    /** Re-resume the stored session; resolves the fresh live id. */
    resumeSession?: () => Promise<string>;
  },
): Promise<SwitchOutcome> {
  const run = (sid: string) =>
    call('config.set', {
      session_id: sid,
      key: 'model',
      value: buildSessionModelValue(args.provider, args.model),
      confirm_expensive_model: Boolean(args.confirmExpensive),
    });
  try {
    const res = args.resumeSession
      ? await withStaleSessionRetry(args.sessionId, run, args.resumeSession)
      : await run(args.sessionId);
```

The rest of the `try`/`catch` stays as it is.

In `src/api/search.ts`:
- Replace the `snippet` field's doc comment (`/** Matched excerpt; matches are wrapped in <b>…</b> by the server. */`) with:

```ts
  /** Matched excerpt; FTS5 wraps matches in >>>…<<< at both 0.20.4 and 0.21.5
   * (hermes_state_search.py). Legacy <b>…</b> is still accepted. */
```

- Replace the `match` field's doc comment (`/** True when this run was inside <b>…</b> (an FTS match). */`) with `/** True when this run was inside >>>…<<< (or legacy <b>…</b>) — an FTS match. */`.
- In `parseSnippet`:
  - `snippet.split(/(<\/?b>)/)` → `snippet.split(/(>>>|<<<|<\/?b>)/)`;
  - `if (tok === '<b>') {` → `if (tok === '>>>' || tok === '<b>') {`;
  - `if (tok === '</b>') {` → `if (tok === '<<<' || tok === '</b>') {`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest __tests__/sessionModel.test.ts __tests__/search.test.ts`
Expected: PASS, 14 + 15 tests.

- [ ] **Step 5: Run the gate and commit**

Run: `npx tsc --noEmit && npx jest`

```bash
git add src/api/sessionModel.ts src/api/search.ts __tests__/sessionModel.test.ts __tests__/search.test.ts
git commit -m "fix: config.set 4001 resume+retry once; parse FTS >>>…<<< snippet markers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Rewire `chat/[id].tsx` onto the transport, and delete the overlapping types

**Files:**
- Modify: `src/app/chat/[id].tsx`, `src/connection.ts`, `src/api/types.ts`

**Interfaces:**
- Consumes: `createChatTransport` (Task 6); `mergeRequestRows`, `completeStatus`, `cancelLabel`, `initialTurnModel` (Task 3); `mintGatewayUrl` (Task 2).
- Produces, for plan B (contract R1), these screen-local names: `gw()` (the current `GatewayClient | null`), `turn` (`TurnModel` React state), `readTurn()` (the latest model, read from the store), `dispatchTurn(a)`, `registryRef` (`RequestRegistry | null`), `orchestratorRef` (`ReconnectOrchestrator | null`), `resumeParams()`, `transportRef`, `busy`, and `respondApproval(card, choice)`. `event.message.complete` carries `status` and `replayed` through `turnActionFor` (R5).
- Behaviour:
  - approvals render from the store with the existing `ApprovalCard`. 0.21.5 cards resolve per id, optimistically, with `resolution` = choice. Legacy cards go through `approval.respond` FIFO;
  - the item-based approval path is gone (R3);
  - the Warning haptic fires only for `!replayed` (R4);
  - clarify and secure-entry cards show a status-row placeholder, which B replaces;
  - vault cards show the declined note.

This task is glue: screens are verified on device (AGENTS.md "Testing"). Its tests are the gate, plus the simulator smoke in Task 9. There is no RED jest step, because every behaviour it wires is already pinned by the Task 2–7 tests.

- [ ] **Step 1: Apply the region replacements to `src/app/chat/[id].tsx`.** Each region runs from its first line to its last line, inclusive, and every region occurs exactly once. Apply them in order. (The replacement set was checked mechanically: applying it to the post-Task-2 file reproduces the verified final file byte for byte.)

**R1. imports.** Replace from the line `import { GlassView` through the **first** following line that reads `import { serif, useTheme } from '@/theme';`, with:

```tsx
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, Share, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createChatTransport, type ChatTransport } from '@/api/chat-transport';
import { makeNativeSocket, type GatewayClient } from '@/api/gatewayClient';
import { getModelInfo } from '@/api/models';
import { setSessionModelTarget } from '@/session-model-store';
import { switchSessionModel, type SwitchOutcome } from '@/api/sessionModel';
import {
  ModelPillState,
  emptyModelPill,
  withFallbackModel,
  withResumedModel,
  withSessionModel,
  pillLabel,
  pillModelId,
} from '@/lib/model-pill';
import { withProfile } from '@/api/profiles';
import type { GatewayEvent, GatewayEventMap } from '@/vendor/hermes-gateway';
import { setAttachHandler } from '@/attach-bus';
import { ApprovalCard, type ApprovalInfo } from '@/components/approval-card';
import { Icon } from '@/components/icon';
import { Composer } from '@/components/composer';
import { MessageRow, type ChatItem, type ToolInfo } from '@/components/message-row';
import { SubagentMonitorCard } from '@/components/subagent-monitor-card';
import { ThinkingDots } from '@/components/thinking-dots';
import { TodoCard } from '@/components/todo-card';
import { mintGatewayUrl, withAuthRetry } from '@/connection';
import { getProfileState, hydrateProfileStore } from '@/profile-store';
import { openSidebar } from '@/sidebar-store';
import { showActionSheet } from '@/lib/action-sheet';
import { parseApprovalRequest, resolvedCount, type ApprovalChoice } from '@/lib/approval';
import { exportAsJsonl, exportAsText } from '@/lib/export';
import { greetingForHour } from '@/lib/greeting';
import { historyToItems } from '@/lib/history';
import { MAX_ATTACH_BYTES, base64ByteLength, buildAttachParams, type PickedImage } from '@/lib/image-attach';
import type { ReconnectOrchestrator, ReconnectPhase } from '@/lib/reconnect-orchestrator';
import type { RequestRegistry } from '@/lib/request-registry';
import { emptyBatch, finalizeBatch, reduceSubagentEvent } from '@/lib/subagent-progress';
import { parseTodoList } from '@/lib/todo';
import { shouldReconnect } from '@/lib/reconnect';
import {
  cancelLabel,
  completeStatus,
  initialTurnModel,
  mergeRequestRows,
  type RequestCardState,
  type TranscriptRow,
  type TurnAction,
  type TurnModel,
} from '@/lib/turn-controller';
import { serif, useTheme } from '@/theme';
```

**R2. module constants before the component.** Replace

```tsx
export default function ChatScreen() {
```

with:

```tsx
/** Copy for request cards this build cannot answer yet (plan B adds the real cards). */
const VAULT_NOTE = 'Hermes asked for a password-manager action — declined on the phone.';
const UNSUPPORTED_NOTE = 'Hermes is waiting for an answer this version can’t show yet.';

type Row = TranscriptRow<ChatItem>;

export default function ChatScreen() {
```

**R3. state, refs and the contract R1 accessors.** Replace from the line `const [streaming, setStreaming] = useState(false);` through the **first** following line that reads `` const nextKey = () => `i${keyCounter.current++}`; ``, with:

```tsx
  const [thinking, setThinking] = useState(false); // sent / turn started, no tokens yet
  const [turn, setTurn] = useState<TurnModel>(initialTurnModel); // server-driven (spec §5.1)
  const [error, setError] = useState<string | null>(null);
  const [reconnectNote, setReconnectNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pill, setPill] = useState<ModelPillState>(() =>
    withFallbackModel(emptyModelPill(), cachedModelId),
  );
  const modelName = pillLabel(pill);
  const currentModelId = pillModelId(pill);
  const busy = turn.turn !== 'idle';
  // One transport per screen (spec §4.2): client + turn store + request router + reconnect
  // orchestrator, all handlers registered at construction, reused across reconnects.
  const transportRef = useRef<ChatTransport | null>(null);
  const registryRef = useRef<RequestRegistry | null>(null);
  const orchestratorRef = useRef<ReconnectOrchestrator | null>(null);
  const liveIdRef = useRef<string | null>(null); // gateway (live) session handle
  const storedIdRef = useRef<string | null>(null); // persistent id, survives reconnects
  const cancelledRef = useRef(false);
  // Profile target captured at mount — keeps create/resume/history consistent
  // for this chat even if the user switches profiles elsewhere mid-session.
  const profileRef = useRef<string | null>(getProfileState().selected);
  const keyCounter = useRef(0);
  const activeSubagentKeyRef = useRef<string | null>(null);
  const todoKeyRef = useRef<string | null>(null);
  const itemsRef = useRef<ChatItem[]>([]); // for request-card anchors (read off-render)
  // Latest render's handlers, read by the transport's long-lived callbacks.
  const handlersRef = useRef<{
    applyEvent: (e: GatewayEvent) => void;
    loadHistory: (storedId: string) => Promise<void>;
    onPhase: (p: ReconnectPhase) => void;
    onNewCard: (card: RequestCardState, replayed: boolean) => void;
  } | null>(null);

  const nextKey = () => `i${keyCounter.current++}`;
  // Names plan B builds on (contract R1).
  const gw = (): GatewayClient | null => transportRef.current?.client ?? null;
  const readTurn = (): TurnModel => transportRef.current?.store.getState() ?? initialTurnModel();
  const dispatchTurn = (a: TurnAction): void => transportRef.current?.store.dispatch(a);
  const resumeParams = () => withProfile({ session_id: storedIdRef.current ?? '' }, profileRef.current);
```

**R4. appendDelta clears `thinking`.** Replace

```tsx
  function appendDelta(text: string) {
    setWaiting(false);
```

with:

```tsx
  function appendDelta(text: string) {
    setThinking(false);
```

**R5. delete the item-based approval path (contract R3).** Delete from the line

```tsx
  /** Append a pending approval card for a gateway `approval.request` event. */
```

up to, but **not** including, the line `` /** Reduce a `subagent.*` event … ``. That removes the whole `appendApproval` function and its trailing blank line.

**R6. no subagent haptic for replayed events.** Replace

```tsx
    if (e.type === 'subagent.complete') {
```

with:

```tsx
    if (e.type === 'subagent.complete' && !e.replayed) {
```

**R7. approval answering, history, the transport sink and lifecycle (replaces everything from cancelPendingApprovals through the mount effect).** Replace from the line `/** Turn ended / interrupted / connection lost: the gateway force-denies` through the **first** following line that reads `}, [id]);`, with:

```tsx
  /** Answer an approval card. 0.21.5: the response frame for THIS request id, marked answered
   * optimistically (no ack exists — review M10). 0.20.4 legacy: approval.respond, which resolves
   * the OLDEST pending approval (FIFO), so only the oldest legacy card is actionable. */
  async function respondApproval(card: RequestCardState, choice: ApprovalChoice) {
    const client = gw();
    if (!client) return;
    if (!card.legacy) {
      const sent = registryRef.current?.respond(card.id, { choice }) ?? false;
      dispatchTurn(
        sent
          ? { type: 'request.answered', id: card.id, resolution: choice }
          : { type: 'request.cancelled', id: card.id, reason: 'resolved' },
      );
      return;
    }
    const sid = liveIdRef.current;
    if (!sid) return;
    dispatchTurn({ type: 'request.answering', id: card.id });
    try {
      const result = await client.call('approval.respond', { session_id: sid, choice });
      // resolved=0 means nothing was pending server-side (stale/raced).
      dispatchTurn(
        resolvedCount(result) > 0
          ? { type: 'request.answered', id: card.id, resolution: choice }
          : { type: 'request.cancelled', id: card.id, reason: 'resolved' },
      );
    } catch (e) {
      dispatchTurn({ type: 'request.failed', id: card.id }); // re-arm so the user can retry
      setError(e instanceof Error ? e.message : 'approval response failed');
    }
  }

  async function loadHistory(storedId: string) {
    const history = await withAuthRetry((r) => r.getMessages(storedId, profileRef.current ?? undefined));
    if (cancelledRef.current) return;
    setItems(historyToItems(history.messages, nextKey));
    // historyToItems never emits subagent/todo rows; clear stale live-card keys
    // so a reconnect/history replace can't update a row that no longer exists.
    // Request cards live in the turn store, NOT in items, so they survive this replace.
    activeSubagentKeyRef.current = null;
    todoKeyRef.current = null;
  }

  function onPhase(p: ReconnectPhase) {
    if (cancelledRef.current) return;
    if (p.kind === 'attempt') {
      setReady(false);
      if (p.attempt === 1) finalizeSubagents(); // socket drop mid-delegation: seal the card
      setReconnectNote(`Connection lost — reconnecting (${p.attempt}/${p.max})…`);
    } else if (p.kind === 'ready') {
      setReconnectNote(null);
      setError(null);
      setReady(true);
    } else {
      setReconnectNote(null);
      setError('Could not reconnect. Check your VPN or Wi-Fi, then reopen this chat.');
    }
  }

  /** A request card appeared (live or replayed): close the streaming segment so later text
   * renders after the card; warn only for live arrivals (replays never fire haptics). */
  function onNewCard(card: RequestCardState, replayed: boolean) {
    setThinking(false);
    finishAssistant();
    // Vault prompts are declined on arrival (spec §6.3): nothing to answer, so no "needs you" haptic.
    if (!replayed && card.kind !== 'vault-declined') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  }

  /** Transcript side of every gateway event (live and replayed). The transport has already
   * updated the turn store (message.start/complete/error) and consumed request events. */
  function applyEvent(e: GatewayEvent) {
    const live = !e.replayed;
    switch (e.type) {
      case 'message.start':
        setThinking(true);
        break;
      case 'message.delta':
        appendDelta((e.payload as GatewayEventMap['message.delta'] | undefined)?.text ?? '');
        break;
      case 'message.complete': {
        const p = e.payload as GatewayEventMap['message.complete'] | undefined;
        const status = completeStatus(p);
        setThinking(false);
        finishAssistant();
        finalizeSubagents();
        if (status === 'interrupted') append('status', 'Stopped');
        else if (status === 'error') setError(p?.error || 'The turn failed.');
        else if (live) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        break;
      }
      case 'tool.start': {
        const p = e.payload as GatewayEventMap['tool.start'] | undefined;
        setThinking(false);
        finishAssistant();
        if (p?.name === 'todo') break; // todo renders as TodoCard on complete
        startTool(p);
        break;
      }
      case 'tool.complete': {
        const p = e.payload as GatewayEventMap['tool.complete'] | undefined;
        if (p?.name === 'todo') {
          if (!upsertTodo(p)) append('status', 'Todo update failed');
          break;
        }
        completeTool(p);
        break;
      }
      case 'status.update': {
        const p = e.payload as GatewayEventMap['status.update'] | undefined;
        if (p?.text) append('status', p.text);
        break;
      }
      case 'subagent.spawn_requested':
      case 'subagent.start':
      case 'subagent.thinking':
      case 'subagent.tool':
      case 'subagent.progress':
      case 'subagent.complete':
        handleSubagentEvent(e);
        break;
      case 'session.info': {
        const p = e.payload as GatewayEventMap['session.info'] | undefined;
        if (p?.model) {
          const m = p.model;
          setPill((prev) => withSessionModel(prev, m));
        }
        break;
      }
      case 'error': {
        // "Outside a turn" at 0.21.5: ends the turn only while waiting (the store already
        // decided); in streaming it is an inline notice and the turn continues (review M6).
        const p = e.payload as GatewayEventMap['error'] | undefined;
        setThinking(false);
        if (readTurn().turn === 'idle') finalizeSubagents();
        setError(p?.message ?? 'agent error');
        break;
      }
    }
  }

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Keep the transport's long-lived callbacks pointed at this render's closures.
  // Declared BEFORE the mount effect so it runs first.
  useEffect(() => {
    handlersRef.current = { applyEvent, loadHistory, onPhase, onNewCard };
  });

  useEffect(() => {
    cancelledRef.current = false;
    const t = createChatTransport({
      socketFactory: makeNativeSocket,
      mintUrl: mintGatewayUrl,
      storedSessionId: () => storedIdRef.current,
      resumeParams: () => resumeParams(),
      loadHistory: (sid) => handlersRef.current!.loadHistory(sid),
      onLiveSessionId: (liveId) => {
        liveIdRef.current = liveId;
        // Best-effort: re-bind this device to the session (live id changes on
        // resume) so session-stop push hooks can target it. Never block the flow.
        void withAuthRetry((r) => r.claimSession(liveId, storedIdRef.current ?? liveId)).catch(() => {});
      },
      // Only adopt a built (non-lazy) resume's model — a lazy reattach reports the gateway
      // default, and an info-less resume omits it; neither may clobber the known model.
      onResumed: (res) => setPill((p) => withResumedModel(p, res.info)),
      onPhase: (p) => handlersRef.current?.onPhase(p),
      applyEvent: (e) => handlersRef.current?.applyEvent(e),
      anchorKey: () => itemsRef.current[itemsRef.current.length - 1]?.key ?? null,
      onNewCard: (card, replayed) => handlersRef.current?.onNewCard(card, replayed),
    });
    transportRef.current = t;
    registryRef.current = t.registry;
    orchestratorRef.current = t.orchestrator;
    setTurn(t.store.getState());
    const unsubStore = t.store.subscribe(() => setTurn(t.store.getState()));
    (async () => {
      try {
        await hydrateProfileStore(); // no-op when sessions screen already ran
        profileRef.current = getProfileState().selected;
        if (id !== 'new') {
          storedIdRef.current = id;
          await handlersRef.current!.loadHistory(id); // fast first paint, before the socket
        }
        await t.orchestrator.start(); // connect → resume → history (spec §7)
      } catch {
        if (!cancelledRef.current) setError('Could not open a live session. Check your VPN or Wi-Fi.');
      }
    })();
    // Foreground revival: iOS suspends the runtime and the OS tears the socket
    // down without a close event. On return, if the socket is not OPEN, run the
    // single-flight reconnect (it joins a heartbeat/close-triggered run).
    const sub = AppState.addEventListener('change', (next) => {
      if (cancelledRef.current) return;
      if (shouldReconnect({ hasSocket: true, isOpen: t.client.isOpen, appState: next })) {
        void t.orchestrator.reconnect('foreground');
      }
    });
    return () => {
      cancelledRef.current = true;
      sub.remove();
      unsubStore();
      t.dispose(); // orchestrator first, then the socket — no reconnect on unmount
      if (transportRef.current === t) {
        transportRef.current = null;
        registryRef.current = null;
        orchestratorRef.current = null;
      }
    };
  }, [id]);
```

**R8. session-model target: `busy` and the 4001 resume.** Replace from the line `// Publish this chat's switch target` through the **first** following line that reads `}, [id, currentModelId, streaming, ready]);`, with:

```tsx
  // Publish this chat's switch target so the /models picker (session mode) can
  // switch THIS chat over its live socket. Re-keyed on `id` so navigating
  // between chats clears the prior target and republishes for the active one;
  // the switchModel closure also reads the refs at call time, so the switch
  // always lands on the live session even within a re-establish window.
  useEffect(() => {
    setSessionModelTarget({
      sessionId: liveIdRef.current ?? '',
      modelId: currentModelId,
      streaming: busy,
      switchModel: (provider, model, confirmExpensive) => {
        const t = transportRef.current;
        const sid = liveIdRef.current;
        if (!t || !sid) {
          return Promise.resolve({ kind: 'error', message: 'Not connected.' } as SwitchOutcome);
        }
        return switchSessionModel(t.client.call.bind(t.client), {
          sessionId: sid,
          provider,
          model,
          confirmExpensive,
          resumeSession: () => t.resumeStored(), // 4001 → resume + retry once
        });
      },
    });
    return () => setSessionModelTarget(null);
  }, [id, currentModelId, busy, ready]);
```

**R9. send() from idle with `queued:true`, request-row merge, approval mapping.** Replace from the line `async function send() {` through the **first** following line that reads `const showGreeting = ready && items.length === 0 && !error;`, with:

```tsx
  async function send() {
    const text = input.trim();
    const image = stagedImage;
    const t = transportRef.current;
    // Server-driven turn state: sending is only possible from idle (plan B adds steer).
    if ((!text && !image) || !t || !t.client.isOpen || readTurn().turn !== 'idle') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');
    setStagedImage(null);
    setError(null);
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        role: 'user',
        text,
        complete: true,
        ...(image
          ? { imageUri: image.uri, imageWidth: image.width, imageHeight: image.height }
          : {}),
      },
    ]);
    dispatchTurn({ type: 'submit.sent' });
    setThinking(true);
    try {
      // Sessions are minted lazily on the first message so abandoned "new
      // chat" screens never create empty sessions server-side.
      if (!liveIdRef.current) {
        const created = await t.client.call('session.create', withProfile({}, profileRef.current));
        liveIdRef.current = created.session_id;
        setPill((p) => withResumedModel(p, created.info));
        if (created.stored_session_id) storedIdRef.current = created.stored_session_id;
        // Best-effort: bind this device to the new session so session-stop push
        // hooks can target it. Never block the send flow on the claim.
        const liveId = created.session_id;
        void withAuthRetry((r) => r.claimSession(liveId, storedIdRef.current ?? liveId)).catch(() => {});
      }
      const sid = liveIdRef.current;
      // prompt.submit has no image params — stage the photo server-side first;
      // the next submit drains the attached-images queue (docs/contracts/attachments.md).
      if (image) await t.client.call('image.attach_bytes', buildAttachParams(sid, image));
      // queued:true — never redirects or interrupts a busy session, even if our view of
      // the turn state is stale (dc1-1 runs busy_input_mode: interrupt; spec §5.1).
      await t.client.call('prompt.submit', { session_id: sid, text, queued: true });
    } catch (e) {
      dispatchTurn({ type: 'event.error', replayed: false }); // waiting → idle
      setThinking(false);
      setError(e instanceof Error ? e.message : 'send failed');
    }
  }

  // Request cards live in the turn store (outside items) and merge in after their anchor.
  const rows = useMemo(() => mergeRequestRows(items, turn.requests), [items, turn.requests]);
  // Inverted list: index 0 renders at the visual bottom, so newest goes first.
  const reversedRows = useMemo(() => [...rows].reverse(), [rows]);

  // Legacy (0.20.4) approvals are FIFO: only the oldest open legacy card is actionable.
  // 0.21.5 approvals resolve per request id, so every pending one is actionable.
  const activeLegacyId = turn.requests.find(
    (r) => r.legacy && (r.status === 'pending' || r.status === 'answering'),
  )?.id;

  function approvalInfo(card: RequestCardState): ApprovalInfo | null {
    const request = parseApprovalRequest(card.params);
    if (!request) return null;
    const status =
      card.status === 'pending' || card.status === 'answering'
        ? card.status
        : card.status === 'answered'
          ? card.resolution === 'deny'
            ? ('denied' as const)
            : ('approved' as const)
          : ('cancelled' as const);
    return { request, status };
  }

  function renderRequest(card: RequestCardState) {
    if (card.kind === 'approval') {
      const approval = approvalInfo(card);
      if (!approval) return null;
      return (
        <ApprovalCard
          approval={approval}
          active={card.legacy ? card.id === activeLegacyId : card.status === 'pending'}
          onRespond={(choice) => void respondApproval(card, choice)}
        />
      );
    }
    const text =
      card.kind === 'vault-declined'
        ? VAULT_NOTE
        : card.status === 'cancelled' && card.cancelReason
          ? `${UNSUPPORTED_NOTE} (${cancelLabel(card.cancelReason)})`
          : UNSUPPORTED_NOTE;
    return <MessageRow item={{ key: `req:${card.id}`, role: 'status', text }} />;
  }

  const showGreeting = ready && items.length === 0 && turn.requests.length === 0 && !error;
```

**R10. FlatList rows.** Replace

```tsx
        <FlatList
          data={reversedItems}
          inverted
          keyExtractor={(i) => i.key}
```

with:

```tsx
        <FlatList
          data={reversedRows}
          inverted
          keyExtractor={(r: Row) => (r.kind === 'item' ? r.item.key : `req:${r.card.id}`)}
```

**R11. renderItem for request rows, thinking dots.** Replace from the line `renderItem={({ item }) => (` through the **first** following line that reads `waiting ? (`, with:

```tsx
          renderItem={({ item: row }) => (
            // Entering-only fade (exiting animations orphan views — see
            // sidebar-host). Streaming updates keep the key, so no re-runs.
            <Animated.View entering={FadeIn.duration(180)}>
              {row.kind === 'request' ? (
                renderRequest(row.card)
              ) : row.item.subagent ? (
                <SubagentMonitorCard batch={row.item.subagent} />
              ) : row.item.todo ? (
                <TodoCard items={row.item.todo} />
              ) : (
                <MessageRow item={row.item} />
              )}
            </Animated.View>
          )}
          ListHeaderComponent={
            thinking ? (
```

**R12. Composer busy prop.** Replace

```tsx
        streaming={streaming}
```

with:

```tsx
        streaming={busy}
```

- [ ] **Step 2: Delete the transitional code**

In `src/connection.ts`, delete the `/** Transitional — deleted in Task 8 … */` doc comment and the whole `openGateway` function, and delete the import line `import { GatewayClient, makeNativeSocket } from './api/gatewayClient';`.

In `src/api/types.ts`, delete everything from `export interface SessionCreateResult {` to the end of the file, which removes `SessionCreateResult`, `SessionResumeResult`, `GatewayEventType` and `GatewayEvent`. The file then ends with `WsTicketResponse`.

- [ ] **Step 3: Verify that nothing references the removed paths**

Run: `grep -rnE "openGateway|SessionResumeResult|SessionCreateResult|GatewayEventType|from '@/api/types'.*GatewayEvent|gwRef|setStreaming|appendApproval|dropAndReconnect" src; echo "exit=$?"`
Expected: no matches, `exit=1`.

Run: `grep -rn "hermes-gateway/" src --include='*.ts' --include='*.tsx' | grep -v "^src/vendor/" | grep -v "__tests__"; echo "exit=$?"`
Expected: no matches, `exit=1`. App code reaches the vendored module only through the barrel.

- [ ] **Step 4: Run the gate**

Run: `npx tsc --noEmit && npx jest`
Expected: both exit 0. In the reference run the whole suite was 43 suites and 542 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/chat/[id].tsx" src/connection.ts src/api/types.ts
git commit -m "feat(chat): one transport per screen — server-driven turn state, request cards outside items, queued idle submits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation, a live smoke against 0.20.4, and the PR

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update `AGENTS.md`**

- Under **Architecture**, replace the line `  gatewayClient.ts JSON-RPC 2.0 over WebSocket` with:

```
  gatewayClient.ts adapter over the vendored upstream JsonRpcGatewayClient
  chat-transport.ts one per chat screen: client + turn store + request router +
                  reconnect orchestrator, all handlers registered before connect
src/vendor/hermes-gateway/  upstream client + generated contract, pinned by
                  VENDORED.json (re-vendor: scripts/sync-gateway-contract.sh <tag>)
```

- Under **Wire contract**, replace the `- RPC:` bullet with:

```
- RPC: types come ONLY from src/vendor/hermes-gateway (generated at v2026.9.24); an unknown
  param key is a compile error. `session.create` (lazy), `session.resume` (after the
  capability handshake), `prompt.submit {queued:true}` from idle. Server→client requests
  (approval/clarify/sudo/secret) are answered on the socket; never -32601 them. 0.20.4's
  `approval.request` event + `approval.respond` stay supported (src/api/legacy-approval.ts).
```

- [ ] **Step 2: Run the live smoke against the live 0.20.4 gateway** (spec §10.2, "Also against live 0.20.4"). The app is pure JS here, so no native rebuild is needed.

Run: `npx expo start`, then open the dev build on the iOS simulator connected to dc1-1, and check:
1. A normal chat: send, stream, complete. The success haptic and markdown render as before.
2. A legacy approval: ask Hermes to run `rm -rf /tmp/hermes-a-smoke` (a dangerous pattern). The approval card appears, Approve works (the card reads "Approved"), and the command runs.
3. Reconnect mid-turn: start a long answer, background the app for under 60 s, then foreground. The note reads "reconnecting (1/5)", the composer is **not** idle while the turn runs (server-driven `running` seed), the history reloads, and the turn finishes.
4. Search: a term shows highlighted matches with no literal `>>>`.

Record each result, plus screenshots in dark and light, for the PR body. Any failure is a bug: fix it with a RED test in the owning module first.

- [ ] **Step 3: Run the final gate and push**

Run: `npx tsc --noEmit; echo "tsc=$?"; npx jest; echo "jest=$?"`
Expected: `tsc=0`, `jest=0`. Do not open the PR unless both are 0.

```bash
git add AGENTS.md
git commit -m "docs(agents): vendored transport + per-screen chat transport" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/transport-0.21.5
gh pr create --base main --title "App A: transport against hermes 0.21.5 (vendored client, server requests, reconnect orchestrator)" --body "$(cat <<'EOF'
Implements plan A (docs/superpowers/plans/2026-09-28-A-transport.md) of the control-path spec rev 2.

- Vendored upstream JsonRpcGatewayClient + generated contract at v2026.9.24 (drift-guarded), typed adapter with gateway.ready-gated connect.
- One transport per chat screen; server-request handlers registered at construction (no -32601 for approval/clarify/sudo/secret).
- Server-driven turn state; idle submits are prompt.submit{queued:true}; message.complete status drives "Stopped".
- Tested single-flight reconnect orchestrator: resume → history → in-flight replay via session.events.since.
- Legacy 0.20.4 approval.request path kept; config.set 4001 resume+retry; >>>…<<< search snippets.

Gate: `npx tsc --noEmit` exit 0, `npx jest` exit 0. Live 0.20.4 smoke results + screenshots below.

Not shippable to a 0.21.5 gateway without plan B (clarify/secure-entry cards are placeholders here).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Paste the Step 2 results and screenshots into the PR as a comment. Merging waits for an adversarial review (superpowers:requesting-code-review) and Gianluca's QA.

---

## Self-review

1. **Spec coverage:**
   - §3 item 1: Tasks 1, 2, 6 and 8.
   - §3 item 2:
     - server-driven state: Tasks 3 and 8;
     - message.complete / error-in-waiting: Task 3;
     - "Stopped" with no haptic: Task 8 `applyEvent`;
     - `queued:true`: Task 8 `send`;
     - unknown params: Task 2 `@ts-expect-error`;
     - 4001: Tasks 6 and 7;
     - `>>>…<<<`: Task 7;
     - replayed side effects: Tasks 3 and 8.
   - §3 item 6 (`open_requests`, replay): Tasks 5 and 6.
   - §4.1–4.4: Tasks 1–6.
   - §4.3 legacy: Tasks 2, 4 and 8.
   - §5.1 core: Task 3.
   - §6.0 routing, registry, cancel labels, dedupe, "`open_requests` wins": Tasks 3, 4 and 6. `pending_approval` is never read; the Task 6 test sends both.
   - §6.3 vault / desktop `-32601`: Tasks 4 and 6.
   - §7: Tasks 5 and 6.
   - §10.1 transport, legacy, orchestrator, card and misc bullets: covered.
   - Stop, steer, the clarify, secure-entry and approval-v2 UI, and composer modes are plan B's.
2. **Placeholder scan:** every code step carries full code or exact old→new text. Task 8 carries no RED jest step, deliberately: it is screen glue, per AGENTS.md.
3. **Type consistency:** the names match contract §§1–6 plus D1/D2/R1–R6. The deviations are listed above.
4. **Review Focus:** the five items each have a named test in Tasks 4, 5, 6 and 7.
