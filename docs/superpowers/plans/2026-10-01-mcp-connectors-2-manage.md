# MCP Connectors, Plan 2 of 3: Manage What Exists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Connectors screen, reached from the sidebar, that lists the gateway's configured MCP servers with their runtime status, lets him switch one on or off, and a detail screen that tests a connector and shows its tools.

**Architecture:** The list and the switch use the REST calls from plan 1 through `withAuthRetry`. Test and runtime status go over the active chat's socket: the chat screen publishes a target into `session-mcp-store`, and the Connectors screens read it with `useSyncExternalStore`. Rows and the test result are small components with their own tests; the two screens are glue.

**Tech Stack:** Expo SDK 57 / React Native 0.86, expo-router (typed routes), React Compiler, jest-expo with React Native Testing Library. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-01-mcp-connectors-design.md` (revision 3), §5.1–§5.3, §5.7, §5.8, §5.10, §8. Wire contract: `docs/contracts/mcp.md`.

**Builds on:** plan 1 (PR #40). This branch is cut from `feat/mcp-connectors-transport` and its PR targets that branch until #40 merges.

## Addendum: what changed after this plan was written

- **"Reload now" was restored** at Gianluca's request ("keep reload"), in this PR (#41). Where the
  text below says the app never calls `reload.mcp`, or that the agent uses changes after the
  gateway restarts, read spec §5.7 (revision 4) instead: the list shows a reload banner after a
  change, and `reloadMcp` always sends `confirm: true` and never `always`.
- **The branch review** (no blocker or major, six minor) led to: reads and switch writes sequenced
  by a generation counter; the list row split so VoiceOver can reach its switch; the list re-read
  on focus without raising the spinner; tests for those.


## Global Constraints

- Branch `feat/mcp-connectors-manage`. PR-only; never push `main`.
- No new dependency. No native change (no rebuild of the dev client).
- All colours from `useTheme()`; no hex in components. `borderCurve: 'continuous'` on rounded rects. Inline styles. Dark is primary; light must look right.
- `process.env.EXPO_OS`, not `Platform.OS`. Never import from `@react-navigation/*`.
- React Compiler is on: no hand-memoised render values, and no state setter called synchronously in an effect body (setters go in promise callbacks or event handlers). No `eslint-disable`.
- Every SF Symbol used needs an entry in `src/lib/icon-map.ts` (`__tests__/icon-map.test.ts` enforces it).
- The app never calls `reload.mcp` (spec §5.7).
- The test RPC's error text is unredacted gateway text: show it, never log it, and do not make it selectable (`docs/contracts/mcp.md`).
- Before every commit: `npx tsc --noEmit && npx jest && npm run lint`, each gated on its own exit code.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Live gateway: reading the list and status is fine, and **Test on `youtube-transcript`** is approved (it starts that stdio process on the gateway). Nothing in this plan's QA changes his gateway: the switch is not flipped on a real server (that is left for his device QA).

## Out of this plan (plan 3)

Add (catalog, custom), secrets, OAuth sign-in, Remove, and the `+` header button.

## Review Focus

1. **No chat underneath** (the screen opened by deep link, or the chat is reconnecting): the list must still load and switch; status lines are absent and Test is disabled with the reason. (Tasks 1, 3)
2. **A profile is selected and the gateway reports no runtime state for it**: no misleading "Not loaded yet" on every row. (Task 1)
3. **A test result that arrives after a newer test started** must be dropped. (Task 6, by construction; checked on the simulator)
4. **A server with a very long URL or name** must not push the switch off the row. (Task 3 test)
5. **The switch fails** (gateway unreachable, or the server was removed elsewhere): the row reverts and says why. (Task 5; checked by a forced failure on the simulator)

## Amendments from the plan review (these supersede the task text below)

An independent reviewer applied all fifteen code blocks to a scratch copy in task order: the
predicted RED failures appeared, then `jest` (77 suites, 1099 tests), `expo lint --max-warnings 0`
and `tsc` (with regenerated route types, and with none as in CI) all passed. It also mounted both
screens in a test router with a mocked REST layer. No blocker; two major and eight minor findings.

**B1 (major, Task 5). The "no longer exists" message was wiped by the reload.** `load` clears the
error before fetching. Split it, so a caller's message survives the re-read, and do not make the
spinner wait on the chat socket:

```ts
  /** The REST list, then the status lines. Leaves `error` alone, so a caller's message survives. */
  const fetchList = useCallback(async () => {
    try {
      setServers(await withAuthRetry((r) => listMcpServers(r, profile)));
      setUnsupported(null);
      void loadStatus(); // not awaited: the spinner must not wait on the chat socket
    } catch (e) {
      fail(e, 'list');
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [profile, loadStatus, fail]);

  const load = useCallback(() => {
    setRefreshing(true);
    setError(null);
    return fetchList();
  }, [fetchList]);
```

**B2 (minor, Tasks 5 and 6, spec §8). Any failed switch re-reads the list**, not only a 404: a
timed-out write may have been applied. In the list's `toggle` catch:

```ts
        replaceServer(server.name, server); // revert
        if (fail(e, 'switch') !== 'auth') void fetchList(); // the write may have landed: show the truth
```

with deps `[replaceServer, fail, fetchList, profile]`. On the detail screen `fetchServer` takes
`keepError` and the `toggle` catch calls `void fetchServer(true)` (see B3).

**B3 (minor, Task 6). The detail screen no longer couples REST to the socket.** The status read is
its own function and effect; the REST fetch does not wait on it and is not repeated when the socket
flips:

```ts
  /** Runtime status over the chat socket; a no-op without one. Never rejects. */
  const loadStatus = useCallback(() => {
    const t = getSessionMcpTarget();
    if (!t?.connected || typeof name !== 'string') return Promise.resolve();
    return t.status(profile).then((rows) => setRow(runtimeRowsByName(rows, profile !== null).get(name)));
  }, [name, profile]);

  // Every setter runs in a promise callback, never synchronously on the mount effect's path.
  const fetchServer = useCallback(
    (keepError = false) =>
      // No GET for one server exists — fetch the list and pick our row.
      withAuthRetry((r) => listMcpServers(r, profile))
        .then((list) => {
          setServer(list.find((s) => s.name === name) ?? null);
          if (!keepError) setError(null);
          void loadStatus();
        })
        .catch((e: unknown) => {
          fail(e, 'list');
        })
        .finally(() => {
          setRefreshing(false);
          setLoaded(true);
        }),
    [name, profile, fail, loadStatus],
  );

  useEffect(() => {
    void fetchServer();
  }, [fetchServer]);

  // The chat socket came up (or back): fill in the status line. No REST refetch.
  useEffect(() => {
    if (!connected) return;
    void loadStatus();
  }, [connected, loadStatus]);
```

and in `toggle`'s catch:

```ts
      setServer(current); // revert
      if (fail(e, 'switch') !== 'auth') void fetchServer(true); // the write may have landed
```

**B4 (minor, Task 6). The auto-test flag is set only when a test can run:**

```ts
    if (!autoTest || !connected || autoTested.current || !getSessionMcpTarget()?.connected) return;
```

**B5 (minor, Task 3). VoiceOver hears the badges and the note.** The row's label replaces its
children, so they go into it:

```ts
  const badges = connectorBadges(server);
  const a11y = [
    `${server.name} connector`,
    subtitle,
    ...badges,
    status,
    server.enabled ? null : 'switched off',
    caps.manageable ? null : 'cannot be changed from the app',
  ]
    .filter(Boolean)
    .join(', ');
```

The label test becomes `'linear connector, mcp.linear.app, OAuth, Off, switched off'`, and the row
renders `badges.map`.

**B6 (major, Task 7 step 5 and Review Focus 1). A cold deep link cannot show the list**, on this
or any other screen: the stored connection is restored only by the Connect screen. Step 5 becomes:
with the app on a chat, replace the route with `/connectors` through the debugger so the chat
unmounts and withdraws its target; expect the list without status lines and Test disabled with the
reason. The states themselves are pinned by the new screen tests (B8).

**B7 (minor, Task 7 step 7). Dropped.** Two tests of the same server return the same result, so
nothing can be observed, and it would start the stdio process twice more. Latest-wins is pinned
by a screen test instead (B8).

**B8 (new Task 6b). Screen tests**, adopted from the reviewer's probes
(`__tests__/connectors-screens.test.tsx`, in the style of `__tests__/memory-file-auth.test.tsx`):

- status fills in when the socket arrives and disappears when it goes;
- no refetch loop;
- a 404 on the switch shows "This connector no longer exists." after the re-read;
- a network failure reverts the switch and says why;
- the unsupported-gateway state;
- the detail auto-tests a remote server once, also when the socket arrives late, and not across a
  reconnect;
- a local server is not auto-tested;
- of two overlapping tests only the newer result is shown;
- an unknown name shows "Connector not found".

**B9 (minor, Tasks 4 and 6). Route types on demand.** If `tsc` rejects the new routes because
`.expo/types/router.d.ts` is stale, run `npx expo customize tsconfig.json`; it regenerates the file
and leaves `tsconfig.json` unchanged.

**B10 (Task 8).** The reviewer reads the spec from `.expo/qa/spec.md` or from the docs branch; it is
not on this branch.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/mcp.ts` (modify) | `runtimeRowsByName`, `connectorBadges`, `testSummary`. |
| `src/session-mcp-store.ts` (modify) | `createSessionMcpTarget(connected, getCall)`. |
| `src/app/chat/[id].tsx` (modify) | Publish and withdraw the chat's target. |
| `src/components/connector-row.tsx` (create) | One row of the list. |
| `src/components/connector-test-card.tsx` (create) | Test button and result. |
| `src/lib/icon-map.ts`, `src/components/sidebar.tsx` (modify) | The Connectors nav item. |
| `src/app/connectors.tsx` (create) | The list screen. |
| `src/app/connectors/server/[name].tsx` (create) | The detail screen. |
| `AGENTS.md` (modify) | Architecture entries. |

---

### Task 1: Logic additions (`src/lib/mcp.ts`, `src/session-mcp-store.ts`)

**Files:**
- Modify: `src/lib/mcp.ts`, `src/session-mcp-store.ts`
- Test: `__tests__/mcp-lib.test.ts`, `__tests__/session-mcp-store.test.ts`

**Interfaces:**
- Consumes: `McpServer`, `McpRuntimeRow`, `McpTestOutcome`, `testMcpServer`, `mcpServerStatus`, `authLabel`, `GatewayClient['call']`.
- Produces:
  - `runtimeRowsByName(rows: McpRuntimeRow[], profileSelected: boolean): Map<string, McpRuntimeRow>`
  - `connectorBadges(server: McpServer): string[]`
  - `testSummary(outcome: { tools: unknown[]; prompts: number; resources: number }): string`
  - `NOT_CONNECTED_MESSAGE: string` and `createSessionMcpTarget(connected: boolean, getCall: () => GatewayClient['call'] | null): SessionMcpTarget` (in `src/session-mcp-store.ts`)

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/mcp-lib.test.ts` (and add `connectorBadges`, `runtimeRowsByName`, `testSummary` to the import from `'../src/lib/mcp'`):

```ts
describe('runtimeRowsByName (spec §5.8)', () => {
  it('indexes rows by server name', () => {
    const map = runtimeRowsByName([row({ name: 'a' }), row({ name: 'b', status: 'failed' })], false);
    expect([...map.keys()]).toEqual(['a', 'b']);
    expect(map.get('b')?.status).toBe('failed');
  });

  it('keeps every row for the gateway default profile, even when nothing is loaded', () => {
    const map = runtimeRowsByName([row({ name: 'a', status: 'configured' })], false);
    expect(map.size).toBe(1);
  });

  it('hides all rows for a selected profile when the gateway reports no runtime state (review focus 2)', () => {
    const rows = [row({ name: 'a', status: 'configured' }), row({ name: 'b', status: 'disabled' })];
    expect(runtimeRowsByName(rows, true).size).toBe(0);
  });

  it('keeps rows for a selected profile once any row shows runtime state', () => {
    const rows = [row({ name: 'a', status: 'configured' }), row({ name: 'b', status: 'failed' })];
    expect(runtimeRowsByName(rows, true).size).toBe(2);
  });

  it('tolerates an empty or missing list (review focus 1)', () => {
    expect(runtimeRowsByName([], false).size).toBe(0);
    expect(runtimeRowsByName(undefined as unknown as McpRuntimeRow[], true).size).toBe(0);
  });
});

describe('connectorBadges', () => {
  it('lists auth, Local and Plugin in that order', () => {
    expect(connectorBadges(server())).toEqual(['OAuth']);
    expect(connectorBadges(server({ auth: 'header' }))).toEqual(['Token']);
    expect(connectorBadges(server({ auth: null }))).toEqual([]);
    expect(connectorBadges(server({ transport: 'stdio', url: null, command: 'uvx', auth: null }))).toEqual(['Local']);
    expect(connectorBadges(server({ source: 'plugin', plugin: 'p' }))).toEqual(['OAuth', 'Plugin']);
  });
});

describe('testSummary', () => {
  it('counts tools, and prompts and resources only when there are any', () => {
    expect(testSummary({ tools: [1, 2, 3], prompts: 0, resources: 0 })).toBe('Working · 3 tools');
    expect(testSummary({ tools: [1], prompts: 2, resources: 1 })).toBe('Working · 1 tool · 2 prompts · 1 resource');
    expect(testSummary({ tools: [], prompts: 1, resources: 0 })).toBe('Working · 0 tools · 1 prompt');
  });
});
```

Append to `__tests__/session-mcp-store.test.ts` (and add `NOT_CONNECTED_MESSAGE`, `createSessionMcpTarget` to its import):

```ts
describe('createSessionMcpTarget', () => {
  it('without a socket: test reports not connected and status is empty (review focus 1)', async () => {
    const t = createSessionMcpTarget(false, () => null);
    expect(t.connected).toBe(false);
    expect(await t.test('linear', null)).toEqual({ kind: 'error', message: NOT_CONNECTED_MESSAGE });
    expect(await t.status(null)).toEqual([]);
  });

  it('with a socket: delegates to the two RPCs with the profile', async () => {
    const calls: { method: string; params: unknown }[] = [];
    const call = (async (method: string, params: unknown) => {
      calls.push({ method, params });
      return method === 'mcp.servers.status'
        ? { servers: [{ name: 'linear', status: 'connected', tools: 3 }], checked_at: 1 }
        : { ok: true, tools: [], oauth_needed: false };
    }) as any;
    const t = createSessionMcpTarget(true, () => call);
    expect(t.connected).toBe(true);
    expect((await t.test('linear', 'work')).kind).toBe('ok');
    expect(await t.status('work')).toHaveLength(1);
    expect(calls).toEqual([
      { method: 'mcp.servers.test', params: { name: 'linear', profile: 'work' } },
      { method: 'mcp.servers.status', params: { profile: 'work' } },
    ]);
  });

  it('reads the socket at call time, not when the target was created', async () => {
    let live: any = null;
    const t = createSessionMcpTarget(true, () => live);
    expect((await t.test('x', null)).kind).toBe('error');
    live = async () => ({ ok: true, tools: [], oauth_needed: false });
    expect((await t.test('x', null)).kind).toBe('ok');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/mcp-lib.test.ts __tests__/session-mcp-store.test.ts`
Expected: FAIL at run time: `runtimeRowsByName is not a function`, `connectorBadges is not a function`, `testSummary is not a function`, `createSessionMcpTarget is not a function`.

- [ ] **Step 3: Implement**

In `src/lib/mcp.ts`, add after `statusLine`:

```ts
const RUNTIME_STATES = new Set(['connected', 'lazy', 'connecting', 'failed']);

/** Runtime rows by server name (spec §5.8). For an explicitly selected profile the gateway may
 * report no runtime state at all — every row then reads `configured` or `disabled` — and the map
 * is empty so the list shows no misleading "Not loaded yet". */
export function runtimeRowsByName(rows: McpRuntimeRow[], profileSelected: boolean): Map<string, McpRuntimeRow> {
  const list = rows ?? [];
  if (profileSelected && !list.some((r) => RUNTIME_STATES.has(r.status))) return new Map();
  return new Map(list.map((r) => [r.name, r]));
}

/** Small labels on a row: how it authenticates, whether it runs on the gateway, who provides it. */
export function connectorBadges(server: McpServer): string[] {
  const badges: string[] = [];
  const auth = authLabel(server);
  if (auth) badges.push(auth);
  if (server.transport === 'stdio') badges.push('Local');
  if (server.source === 'plugin') badges.push('Plugin');
  return badges;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** First line of a passed test: "Working · 3 tools · 2 prompts". */
export function testSummary(outcome: { tools: unknown[]; prompts: number; resources: number }): string {
  const parts = [`Working · ${plural(outcome.tools.length, 'tool')}`];
  if (outcome.prompts > 0) parts.push(plural(outcome.prompts, 'prompt'));
  if (outcome.resources > 0) parts.push(plural(outcome.resources, 'resource'));
  return parts.join(' · ');
}
```

In `src/session-mcp-store.ts`, change the import and add the factory after the `SessionMcpTarget` interface:

```ts
import type { GatewayClient } from '@/api/gatewayClient';
import { mcpServerStatus, testMcpServer, type McpRuntimeRow, type McpTestOutcome } from '@/api/mcpSession';
```

```ts
export const NOT_CONNECTED_MESSAGE = 'This needs a connected chat. Go back to the chat, wait for it to connect, then return.';

/** Build a chat's target. `getCall` is read at call time, so a reconnect that swaps the
 * socket is picked up without republishing. */
export function createSessionMcpTarget(
  connected: boolean,
  getCall: () => GatewayClient['call'] | null,
): SessionMcpTarget {
  return {
    connected,
    test: (name, profile) => {
      const call = getCall();
      if (!call) return Promise.resolve({ kind: 'error', message: NOT_CONNECTED_MESSAGE });
      return testMcpServer(call, name, profile);
    },
    status: (profile) => {
      const call = getCall();
      return call ? mcpServerStatus(call, profile) : Promise.resolve([]);
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/mcp-lib.test.ts __tests__/session-mcp-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate and commit**

Run: `npx tsc --noEmit && npx jest && npm run lint`

```bash
git add src/lib/mcp.ts src/session-mcp-store.ts __tests__/mcp-lib.test.ts __tests__/session-mcp-store.test.ts
git commit -m "feat(mcp): status rows by name, row badges, test summary, target factory" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The chat publishes its target (`src/app/chat/[id].tsx`)

**Files:**
- Modify: `src/app/chat/[id].tsx`

**Interfaces:**
- Consumes: `createSessionMcpTarget`, `publishSessionMcpTarget`, `clearSessionMcpTarget` (Task 1, plan 1); the screen's existing `ready` state and `transportRef`.
- Produces: while a chat screen is mounted, `getSessionMcpTarget()` returns a target whose `connected` follows `ready`.

Screens are glue (AGENTS.md "Testing"): this is verified on the simulator in Task 7.

- [ ] **Step 1: Add the import**

Next to the existing `import { setSessionModelTarget } from '@/session-model-store';`:

```ts
import { clearSessionMcpTarget, createSessionMcpTarget, publishSessionMcpTarget } from '@/session-mcp-store';
```

- [ ] **Step 2: Publish next to the model target**

Directly after the effect that calls `setSessionModelTarget` (the one ending `}, [id, currentModelId, busy, ready]);`), add:

```ts
  // Lend this chat's socket to the Connectors screens (test + runtime status).
  // One identity per mounted chat screen: the store shows the newest mounted chat,
  // so an overlap during a route transition cannot hide or clear the live one.
  const [mcpOwner] = useState(() => ({}));
  useEffect(() => {
    publishSessionMcpTarget(
      mcpOwner,
      createSessionMcpTarget(ready, () => {
        const t = transportRef.current;
        return t ? t.client.call.bind(t.client) : null;
      }),
    );
  }, [mcpOwner, ready]);
  useEffect(() => () => clearSessionMcpTarget(mcpOwner), [mcpOwner]);
```

- [ ] **Step 3: Full gate and commit**

Run: `npx tsc --noEmit && npx jest && npm run lint`
Expected: all exit 0. If lint flags the effect, do not disable the rule: the only setter-free fix needed is already in place (no state is set here).

```bash
git add "src/app/chat/[id].tsx"
git commit -m "feat(mcp): the chat lends its socket to the Connectors screens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Row and test-result components

**Files:**
- Create: `src/components/connector-row.tsx`, `src/components/connector-test-card.tsx`
- Test: `__tests__/connector-row.test.tsx`, `__tests__/connector-test-card.test.tsx`

**Interfaces:**
- Consumes: `McpServer`, `McpTestOutcome`, `serverCapabilities`, `serverSubtitle`, `connectorBadges`, `testSummary`, `CardButton`, `useTheme`.
- Produces:
  - `ConnectorRow({ server, status, onPress, onToggle }: { server: McpServer; status: string | null; onPress: (s: McpServer) => void; onToggle: (s: McpServer) => void })`
  - `type ConnectorTestState = { phase: 'idle' } | { phase: 'running' } | { phase: 'done'; outcome: McpTestOutcome }`
  - `ConnectorTestCard({ state, connected, onTest }: { state: ConnectorTestState; connected: boolean; onTest: () => void })`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/connector-row.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { McpServer } from '../src/api/mcp';
import { ConnectorRow } from '../src/components/connector-row';
import { palettes } from '../src/theme';

const colors = palettes.light; // jest's colour scheme

function server(over: Partial<McpServer> = {}): McpServer {
  return {
    name: 'linear',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    command: null,
    args: [],
    env: {},
    auth: 'oauth',
    enabled: true,
    tools: null,
    source: 'config',
    plugin: null,
    ...over,
  };
}

const noop = () => {};

test('shows the name, host, auth badge and status line', async () => {
  await render(<ConnectorRow server={server()} status="Connected · 12 tools" onPress={noop} onToggle={noop} />);
  expect(screen.getByText('linear')).toBeTruthy();
  expect(screen.getByText('mcp.linear.app')).toBeTruthy();
  expect(screen.getByText('OAuth')).toBeTruthy();
  expect(screen.getByText('Connected · 12 tools')).toHaveStyle({ color: colors.textDim });
});

test('a failed status is shown in the danger colour', async () => {
  await render(<ConnectorRow server={server()} status="Failed" onPress={noop} onToggle={noop} />);
  expect(screen.getByText('Failed')).toHaveStyle({ color: colors.danger });
});

test('no status line when status is unavailable', async () => {
  await render(<ConnectorRow server={server()} status={null} onPress={noop} onToggle={noop} />);
  expect(screen.queryByText(/Connected|Failed|Not loaded/)).toBeNull();
});

test('a local server shows its command and the Local badge', async () => {
  const local = server({ name: 'yt', transport: 'stdio', url: null, command: 'uvx', args: ['mcp-yt'], auth: null });
  await render(<ConnectorRow server={local} status={null} onPress={noop} onToggle={noop} />);
  expect(screen.getByText('uvx mcp-yt')).toBeTruthy();
  expect(screen.getByText('Local')).toBeTruthy();
});

test('the switch reflects enabled and reports a toggle', async () => {
  const onToggle = jest.fn();
  const s = server({ enabled: false });
  await render(<ConnectorRow server={s} status={null} onPress={noop} onToggle={onToggle} />);
  const sw = screen.getByRole('switch');
  expect(sw.props.value).toBe(false);
  fireEvent(sw, 'valueChange', true);
  expect(onToggle).toHaveBeenCalledWith(s);
});

test('a plugin server has no switch', async () => {
  await render(<ConnectorRow server={server({ source: 'plugin', plugin: 'p' })} status={null} onPress={noop} onToggle={noop} />);
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.getByText('Plugin')).toBeTruthy();
});

test('a name the gateway routes cannot address says so and has no switch', async () => {
  await render(<ConnectorRow server={server({ name: 'a/b' })} status={null} onPress={noop} onToggle={noop} />);
  expect(screen.getByText('Can’t be changed from the app: its name contains “/”.')).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
});

test('pressing the row opens it', async () => {
  const onPress = jest.fn();
  const s = server();
  await render(<ConnectorRow server={s} status={null} onPress={onPress} onToggle={noop} />);
  fireEvent.press(screen.getByRole('button', { name: /linear connector/ }));
  expect(onPress).toHaveBeenCalledWith(s);
});

test('a long name and URL are truncated to one line each, so the switch keeps its place (review focus 4)', async () => {
  const long = server({ name: 'a-very-long-connector-name-'.repeat(4), url: `https://${'sub.'.repeat(20)}example.com/mcp` });
  await render(<ConnectorRow server={long} status={null} onPress={noop} onToggle={noop} />);
  expect(screen.getByText(long.name).props.numberOfLines).toBe(1);
  expect(screen.getByText(`${'sub.'.repeat(20)}example.com`).props.numberOfLines).toBe(1);
  expect(screen.getByText(long.name)).toHaveStyle({ flexShrink: 1 });
  expect(screen.getByRole('switch')).toBeTruthy();
});

test('the accessibility label carries the state', async () => {
  await render(<ConnectorRow server={server({ enabled: false })} status="Off" onPress={noop} onToggle={noop} />);
  expect(screen.getByRole('button', { name: 'linear connector, mcp.linear.app, Off, switched off' })).toBeTruthy();
});
```

Create `__tests__/connector-test-card.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConnectorTestCard } from '../src/components/connector-test-card';
import { palettes } from '../src/theme';

const colors = palettes.light;
const noop = () => {};

test('idle and connected: an enabled Test button, no result', async () => {
  const onTest = jest.fn();
  await render(<ConnectorTestCard state={{ phase: 'idle' }} connected onTest={onTest} />);
  const button = screen.getByRole('button', { name: 'Test connection' });
  expect(button).not.toBeDisabled();
  fireEvent.press(button);
  expect(onTest).toHaveBeenCalledTimes(1);
});

test('not connected: the button is disabled and the reason is shown (review focus 1)', async () => {
  await render(<ConnectorTestCard state={{ phase: 'idle' }} connected={false} onTest={noop} />);
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  expect(screen.getByText('Testing needs a connected chat. Go back to the chat, wait for it to connect, then return.')).toBeTruthy();
});

test('running: the button is disabled and says Testing', async () => {
  await render(<ConnectorTestCard state={{ phase: 'running' }} connected onTest={noop} />);
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  expect(screen.getByText('Testing…')).toBeTruthy();
});

test('a passed test shows the summary and each tool', async () => {
  await render(
    <ConnectorTestCard
      connected
      onTest={noop}
      state={{
        phase: 'done',
        outcome: {
          kind: 'ok',
          tools: [
            { name: 'search_issues', description: 'Search issues' },
            { name: 'create_issue', description: '' },
          ],
          prompts: 1,
          resources: 0,
          tokensPresent: true,
        },
      }}
    />,
  );
  expect(screen.getByText('Working · 2 tools · 1 prompt')).toHaveStyle({ color: colors.success });
  expect(screen.getByText('search_issues')).toBeTruthy();
  expect(screen.getByText('Search issues')).toBeTruthy();
  expect(screen.getByText('create_issue')).toBeTruthy();
});

test('a failed test shows the gateway text, in danger, and not selectable', async () => {
  await render(
    <ConnectorTestCard
      connected
      onTest={noop}
      state={{ phase: 'done', outcome: { kind: 'failed', message: 'OAuth authentication required — no token found.', oauthNeeded: true, tokensPresent: false } }}
    />,
  );
  const text = screen.getByText('OAuth authentication required — no token found.');
  expect(text).toHaveStyle({ color: colors.danger });
  expect(text.props.selectable).toBe(false);
});

test('a call error is shown the same way', async () => {
  await render(
    <ConnectorTestCard connected onTest={noop} state={{ phase: 'done', outcome: { kind: 'error', message: 'socket closed' } }} />,
  );
  expect(screen.getByText('socket closed').props.selectable).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/connector-row.test.tsx __tests__/connector-test-card.test.tsx`
Expected: FAIL with "Cannot find module '../src/components/connector-row'" and "…connector-test-card'".

- [ ] **Step 3: Implement**

Create `src/components/connector-row.tsx`:

```tsx
// src/components/connector-row.tsx — one configured MCP connector in the list (spec §5.2).
import { Pressable, Switch, Text, View } from 'react-native';
import type { McpServer } from '@/api/mcp';
import { connectorBadges, serverCapabilities, serverSubtitle } from '@/lib/mcp';
import { useTheme } from '@/theme';

function Badge({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.raised,
        borderRadius: 6,
        borderCurve: 'continuous',
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color: colors.textDim, fontSize: 11.5, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function ConnectorRow({
  server,
  status,
  onPress,
  onToggle,
}: {
  server: McpServer;
  /** The runtime status line, or null when it is not available. */
  status: string | null;
  onPress: (server: McpServer) => void;
  onToggle: (server: McpServer) => void;
}) {
  const { colors } = useTheme();
  const caps = serverCapabilities(server);
  const subtitle = serverSubtitle(server);
  const a11y = [`${server.name} connector`, subtitle, status, server.enabled ? null : 'switched off']
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Shows connector details"
      onPress={() => onPress(server)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: pressed ? colors.raised : colors.surface,
        borderRadius: 16,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
        minHeight: 44,
      })}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text
            numberOfLines={1}
            style={{
              color: server.enabled ? colors.text : colors.textDim,
              fontSize: 16,
              fontWeight: '600',
              flexShrink: 1,
            }}
          >
            {server.name}
          </Text>
          {connectorBadges(server).map((label) => (
            <Badge key={label} label={label} />
          ))}
        </View>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 13.5 }}>
            {subtitle}
          </Text>
        ) : null}
        {status ? (
          <Text numberOfLines={1} style={{ color: status === 'Failed' ? colors.danger : colors.textDim, fontSize: 13 }}>
            {status}
          </Text>
        ) : null}
        {!caps.manageable ? (
          <Text style={{ color: colors.textFaint, fontSize: 12.5 }}>
            Can’t be changed from the app: its name contains “/”.
          </Text>
        ) : null}
      </View>
      {caps.canSwitch ? (
        <Switch
          value={server.enabled}
          onValueChange={() => onToggle(server)}
          accessibilityLabel={`${server.name} ${server.enabled ? 'on, double tap to switch off' : 'off, double tap to switch on'}`}
          trackColor={{ true: colors.accent }}
          hitSlop={8}
        />
      ) : null}
    </Pressable>
  );
}
```

Create `src/components/connector-test-card.tsx`:

```tsx
// src/components/connector-test-card.tsx — the Test button and its result (spec §5.3).
//
// A failed test shows the gateway's error text. That text is NOT redacted by the
// gateway (docs/contracts/mcp.md), so it is never logged and not selectable.
import { ActivityIndicator, Text, View } from 'react-native';
import type { McpTestOutcome } from '@/api/mcpSession';
import { CardButton } from '@/components/card-button';
import { testSummary } from '@/lib/mcp';
import { useTheme } from '@/theme';

export type ConnectorTestState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; outcome: McpTestOutcome };

function Result({ outcome }: { outcome: McpTestOutcome }) {
  const { colors } = useTheme();
  if (outcome.kind !== 'ok') {
    return (
      <Text selectable={false} style={{ color: colors.danger, fontSize: 14 }}>
        {outcome.message}
      </Text>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.success, fontSize: 14.5, fontWeight: '600' }}>{testSummary(outcome)}</Text>
      {outcome.tools.map((tool) => (
        <View key={tool.name} style={{ gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: '600' }}>{tool.name}</Text>
          {tool.description ? (
            <Text numberOfLines={3} style={{ color: colors.textDim, fontSize: 13.5 }}>
              {tool.description}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function ConnectorTestCard({
  state,
  connected,
  onTest,
}: {
  state: ConnectorTestState;
  /** False while no chat socket is available: Test cannot run. */
  connected: boolean;
  onTest: () => void;
}) {
  const { colors } = useTheme();
  const running = state.phase === 'running';
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
        gap: 12,
      }}
    >
      <CardButton label="Test connection" a11y="Test connection" onPress={onTest} disabled={running || !connected} />
      {!connected ? (
        <Text style={{ color: colors.textFaint, fontSize: 13 }}>
          Testing needs a connected chat. Go back to the chat, wait for it to connect, then return.
        </Text>
      ) : null}
      {running ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator color={colors.textDim} />
          <Text style={{ color: colors.textDim, fontSize: 14 }}>Testing…</Text>
        </View>
      ) : null}
      {state.phase === 'done' ? <Result outcome={state.outcome} /> : null}
    </View>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/connector-row.test.tsx __tests__/connector-test-card.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full gate and commit**

Run: `npx tsc --noEmit && npx jest && npm run lint`

```bash
git add src/components/connector-row.tsx src/components/connector-test-card.tsx __tests__/connector-row.test.tsx __tests__/connector-test-card.test.tsx
git commit -m "feat(mcp): connector row and test-result components" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sidebar item and icon

**Files:**
- Modify: `src/lib/icon-map.ts`, `src/components/sidebar.tsx`

`__tests__/icon-map.test.ts` already fails if an SF Symbol used in `src/` has no Android mapping, or maps to a glyph that does not exist. That is this task's test.

- [ ] **Step 1: Add the nav item (RED)**

In `src/components/sidebar.tsx`, after the Skills item:

```tsx
          <NavItem icon="powerplug" label="Connectors" onPress={() => pushRoute('/connectors')} />
```

Run: `npx jest __tests__/icon-map.test.ts`
Expected: FAIL: `{ sf: 'powerplug', mapped: false }`.

- [ ] **Step 2: Add the mapping (GREEN)**

In `src/lib/icon-map.ts`, in alphabetical position (after `'plus'`):

```ts
  'powerplug': 'power-plug-outline',
```

Run: `npx jest __tests__/icon-map.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit with Task 5**

`/connectors` does not exist as a route until Task 5, so `npx tsc --noEmit` may reject the typed route here. Do not commit yet; Task 5 commits both.

---

### Task 5: The list screen (`src/app/connectors.tsx`)

**Files:**
- Create: `src/app/connectors.tsx`

**Interfaces:**
- Consumes: `listMcpServers`, `setMcpServerEnabled`, `McpServer`, `McpRuntimeRow`, `ConnectorRow`, `connectorError`, `runtimeRowsByName`, `statusLine`, `getSessionMcpTarget`, `subscribeSessionMcpTarget`, `getProfileState`, `subscribeProfiles`, `withAuthRetry`.
- Produces: route `/connectors`; pushes `/connectors/server/[name]`.

- [ ] **Step 1: Create the screen**

```tsx
// src/app/connectors.tsx
//
// MCP connectors configured on the gateway (docs/contracts/mcp.md, spec §5.2).
// The list and the on/off switch are REST. The status line comes from the
// active chat's socket (session-mcp-store) and is simply absent without one.
// The agent picks a change up after the gateway restarts (spec §5.7).
import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { listMcpServers, setMcpServerEnabled, type McpServer } from '@/api/mcp';
import type { McpRuntimeRow } from '@/api/mcpSession';
import { ConnectorRow } from '@/components/connector-row';
import { Icon } from '@/components/icon';
import { withAuthRetry } from '@/connection';
import { connectorError, runtimeRowsByName, statusLine, type ConnectorAction } from '@/lib/mcp';
import { getProfileState, subscribeProfiles } from '@/profile-store';
import { getSessionMcpTarget, subscribeSessionMcpTarget } from '@/session-mcp-store';
import { useTheme } from '@/theme';

export { RouteError as ErrorBoundary } from '@/components/route-error';

const RESTART_NOTE = 'The agent uses changes after the gateway restarts.';

export default function ConnectorsScreen() {
  const { colors } = useTheme();
  const profiles = useSyncExternalStore(subscribeProfiles, getProfileState);
  const target = useSyncExternalStore(subscribeSessionMcpTarget, getSessionMcpTarget);
  const connected = target?.connected ?? false;
  const profile = profiles.selected;
  const [servers, setServers] = useState<McpServer[]>([]);
  const [rows, setRows] = useState<Map<string, McpRuntimeRow>>(() => new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);

  /** Show a failure; returns its kind so the caller can react (e.g. reload after `gone`). */
  const fail = useCallback((e: unknown, action: ConnectorAction) => {
    const mapped = connectorError(e, action);
    if (mapped.kind === 'auth') {
      // Silent re-login already failed inside withAuthRetry — credentials are dead.
      router.replace('/');
    } else if (mapped.kind === 'unsupported') {
      setUnsupported(mapped.message);
    } else {
      setError(mapped.message);
    }
    return mapped.kind;
  }, []);

  /** Runtime status over the chat socket; a no-op without one. Never rejects. */
  const loadStatus = useCallback(() => {
    const t = getSessionMcpTarget();
    if (!t?.connected) return Promise.resolve();
    return t.status(profile).then((r) => setRows(runtimeRowsByName(r, profile !== null)));
  }, [profile]);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setServers(await withAuthRetry((r) => listMcpServers(r, profile)));
      setUnsupported(null);
      await loadStatus();
    } catch (e) {
      fail(e, 'list');
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [profile, loadStatus, fail]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // The chat socket came up (or back) after the list loaded: fill in the status lines.
  useEffect(() => {
    if (!connected) return;
    void loadStatus();
  }, [connected, loadStatus]);

  const replaceServer = useCallback((name: string, next: McpServer) => {
    setServers((prev) => prev.map((s) => (s.name === name ? next : s)));
  }, []);

  /** Optimistic on/off — flip immediately, revert if the gateway says no. */
  const toggle = useCallback(
    async (server: McpServer) => {
      const enabling = !server.enabled;
      setError(null);
      replaceServer(server.name, { ...server, enabled: enabling });
      try {
        const res = await withAuthRetry((r) => setMcpServerEnabled(r, server.name, enabling, profile));
        replaceServer(server.name, { ...server, enabled: res.enabled });
      } catch (e) {
        replaceServer(server.name, server); // revert
        if (fail(e, 'switch') === 'gone') void load();
      }
    },
    [replaceServer, fail, load, profile],
  );

  const openDetail = useCallback((server: McpServer) => {
    router.push({ pathname: '/connectors/server/[name]', params: { name: server.name } });
  }, []);

  const profileName = profile ?? profiles.serverCurrent;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Connectors' }} />

      {error ? (
        <Text selectable style={{ color: colors.danger, fontSize: 14, paddingHorizontal: 16, paddingTop: 8 }}>
          {error}
        </Text>
      ) : null}

      <FlatList
        data={unsupported ? [] : servers}
        keyExtractor={(s) => s.name}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.textDim} />}
        renderItem={({ item }) => (
          <ConnectorRow
            server={item}
            status={connected ? statusLine(item, rows.get(item.name)) : null}
            onPress={openDetail}
            onToggle={toggle}
          />
        )}
        ListHeaderComponent={
          profiles.names.length > 1 && profileName && !unsupported ? (
            <Text style={{ color: colors.textFaint, fontSize: 13, marginHorizontal: 4 }}>Profile: {profileName}</Text>
          ) : null
        }
        ListFooterComponent={
          servers.length > 0 && !unsupported ? (
            <Text style={{ color: colors.textFaint, fontSize: 12.5, marginHorizontal: 4, marginTop: 6 }}>
              {RESTART_NOTE}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          unsupported ? (
            <View style={{ alignItems: 'center', gap: 14, paddingTop: 96, paddingHorizontal: 32 }}>
              <Icon sf="powerplug" size={44} color={colors.textFaint} />
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' }}>
                Connectors aren’t available
              </Text>
              <Text style={{ color: colors.textDim, fontSize: 14, textAlign: 'center' }}>{unsupported}</Text>
            </View>
          ) : loaded && !refreshing && !error ? (
            <View style={{ alignItems: 'center', gap: 14, paddingTop: 96, paddingHorizontal: 32 }}>
              <Icon sf="powerplug" size={44} color={colors.textFaint} />
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>No connectors yet</Text>
              <Text style={{ color: colors.textDim, fontSize: 14, textAlign: 'center' }}>
                MCP servers configured on your gateway show up here.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
```

- [ ] **Step 2: Gate (the detail route is created in Task 6)**

`openDetail` pushes a route that does not exist yet, so typed routes may reject it. Continue to Task 6 and gate there.

---

### Task 6: The detail screen (`src/app/connectors/server/[name].tsx`)

**Files:**
- Create: `src/app/connectors/server/[name].tsx`

**Interfaces:**
- Consumes: everything Task 5 consumes, plus `ConnectorTestCard`, `ConnectorTestState`, `authLabel`, `serverCapabilities`. The restart note is repeated here as text; route files are not modules to import from.
- Produces: route `/connectors/server/[name]`.

- [ ] **Step 1: Create the screen**

```tsx
// src/app/connectors/server/[name].tsx
//
// One MCP connector (spec §5.3): what it is, its on/off switch, and Test.
// Test really connects on the gateway, over the active chat's socket. Only
// the latest test counts: a result that arrives after a newer one started is
// dropped. Remote servers are tested when the screen opens; a local (stdio)
// one only on demand, because a test starts its process on the gateway.
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { listMcpServers, setMcpServerEnabled, type McpServer } from '@/api/mcp';
import type { McpRuntimeRow } from '@/api/mcpSession';
import { ConnectorTestCard, type ConnectorTestState } from '@/components/connector-test-card';
import { Icon } from '@/components/icon';
import { withAuthRetry } from '@/connection';
import {
  authLabel,
  connectorError,
  runtimeRowsByName,
  serverCapabilities,
  statusLine,
  type ConnectorAction,
} from '@/lib/mcp';
import { getProfileState, subscribeProfiles } from '@/profile-store';
import { getSessionMcpTarget, subscribeSessionMcpTarget } from '@/session-mcp-store';
import { useTheme } from '@/theme';

export { RouteError as ErrorBoundary } from '@/components/route-error';

function Card({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function Separator() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 16 }} />;
}

/** Label above value: connector addresses are too long for a one-line row. */
function Field({ label, value, selectable = false }: { label: string; value: string; selectable?: boolean }) {
  const { colors } = useTheme();
  return (
    <View accessibilityLabel={`${label}: ${value}`} style={{ padding: 16, gap: 4, minHeight: 44 }}>
      <Text style={{ color: colors.textFaint, fontSize: 12.5, fontWeight: '600' }}>{label}</Text>
      <Text selectable={selectable} style={{ color: colors.text, fontSize: 15 }}>
        {value}
      </Text>
    </View>
  );
}

export default function ConnectorDetailScreen() {
  const { colors } = useTheme();
  const { name } = useLocalSearchParams<{ name: string }>();
  const profiles = useSyncExternalStore(subscribeProfiles, getProfileState);
  const target = useSyncExternalStore(subscribeSessionMcpTarget, getSessionMcpTarget);
  const connected = target?.connected ?? false;
  const profile = profiles.selected;
  const [server, setServer] = useState<McpServer | null>(null);
  const [row, setRow] = useState<McpRuntimeRow | undefined>(undefined);
  // true until the first fetch settles: the RefreshControl spins on first load.
  const [refreshing, setRefreshing] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<ConnectorTestState>({ phase: 'idle' });
  const testSeq = useRef(0);
  const autoTested = useRef(false);

  const fail = useCallback((e: unknown, action: ConnectorAction) => {
    const mapped = connectorError(e, action);
    if (mapped.kind === 'auth') router.replace('/');
    else setError(mapped.message);
    return mapped.kind;
  }, []);

  // Every setter runs in a promise callback, never synchronously on the mount effect's path.
  const fetchServer = useCallback(
    () =>
      // No GET for one server exists — fetch the list and pick our row.
      withAuthRetry((r) => listMcpServers(r, profile))
        .then((list) => {
          setServer(list.find((s) => s.name === name) ?? null);
          setError(null);
          const t = getSessionMcpTarget();
          if (!t?.connected) return undefined;
          return t.status(profile).then((rows) => {
            setRow(typeof name === 'string' ? runtimeRowsByName(rows, profile !== null).get(name) : undefined);
          });
        })
        .catch((e: unknown) => {
          fail(e, 'list');
        })
        .finally(() => {
          setRefreshing(false);
          setLoaded(true);
        }),
    [name, profile, fail],
  );

  useEffect(() => {
    void fetchServer();
  }, [fetchServer, connected]);

  function refresh() {
    setRefreshing(true);
    setError(null);
    void fetchServer();
  }

  /** Run a test. Only the latest one may write its result. */
  const runTest = useCallback(() => {
    const t = getSessionMcpTarget();
    if (!t?.connected || typeof name !== 'string') return Promise.resolve();
    const seq = ++testSeq.current;
    return Promise.resolve()
      .then(() => {
        setTest({ phase: 'running' });
        return t.test(name, profile);
      })
      .then((outcome) => {
        if (seq === testSeq.current) setTest({ phase: 'done', outcome });
      });
  }, [name, profile]);

  const caps = server ? serverCapabilities(server) : null;
  const autoTest = caps?.autoTest ?? false;

  // Remote connectors are tested once, as soon as both the server and a chat socket are known.
  useEffect(() => {
    if (!autoTest || !connected || autoTested.current) return;
    autoTested.current = true;
    void runTest();
  }, [autoTest, connected, runTest]);

  /** Optimistic on/off — flip immediately, revert if the gateway says no. */
  async function toggle(current: McpServer) {
    if (busy) return;
    const enabling = !current.enabled;
    setBusy(true);
    setError(null);
    setServer({ ...current, enabled: enabling });
    try {
      const res = await withAuthRetry((r) => setMcpServerEnabled(r, current.name, enabling, profile));
      setServer({ ...current, enabled: res.enabled });
    } catch (e) {
      setServer(current); // revert
      if (fail(e, 'switch') === 'gone') setServer(null);
    } finally {
      setBusy(false);
    }
  }

  const status = server && connected ? statusLine(server, row) : null;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textDim} />}
    >
      <Stack.Screen options={{ title: typeof name === 'string' ? name : 'Connector' }} />

      {error ? (
        <Text selectable style={{ color: colors.danger, fontSize: 14 }}>
          {error}
        </Text>
      ) : null}

      {!loaded ? (
        <Text style={{ color: colors.textFaint, fontSize: 14, textAlign: 'center', paddingTop: 48 }}>Loading…</Text>
      ) : server && caps ? (
        <>
          <Card>
            {caps.canSwitch ? (
              <>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 16, minHeight: 44 }}
                >
                  <Text style={{ color: colors.text, fontSize: 15.5 }}>Enabled</Text>
                  <Switch
                    value={server.enabled}
                    disabled={busy}
                    onValueChange={() => toggle(server)}
                    accessibilityLabel={`${server.name} ${server.enabled ? 'on, double tap to switch off' : 'off, double tap to switch on'}`}
                    trackColor={{ true: colors.accent }}
                    hitSlop={8}
                  />
                </View>
                <Separator />
              </>
            ) : null}
            {server.url ? (
              <Field label="Address" value={server.url} selectable />
            ) : (
              <Field label="Command" value={[server.command ?? '', ...server.args].join(' ').trim() || 'Unknown'} selectable />
            )}
            <Separator />
            <Field label="Authentication" value={authLabel(server) ?? 'None'} />
            {status ? (
              <>
                <Separator />
                <Field label="Status" value={status} />
              </>
            ) : null}
            {server.plugin ? (
              <>
                <Separator />
                <Field label="Provided by" value={`Plugin: ${server.plugin}`} />
              </>
            ) : null}
          </Card>

          {caps.canTest ? <ConnectorTestCard state={test} connected={connected} onTest={() => void runTest()} /> : null}

          <Text style={{ color: colors.textFaint, fontSize: 12.5, marginHorizontal: 4 }}>
            {!caps.manageable
              ? 'This connector can’t be changed from the app: its name contains “/”. '
              : server.source === 'plugin'
                ? 'This connector comes from a plugin, so it is changed in that plugin’s settings. '
                : server.transport === 'stdio'
                  ? 'Local connectors run on the gateway. They can be switched and tested here; edit them on the gateway. '
                  : ''}
            The agent uses changes after the gateway restarts.
          </Text>
        </>
      ) : !error ? (
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 96, paddingHorizontal: 32 }}>
          <Icon sf="questionmark.circle" size={44} color={colors.textFaint} />
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>Connector not found</Text>
          <Text style={{ color: colors.textDim, fontSize: 14, textAlign: 'center' }}>
            “{name}” is no longer configured on the gateway. Pull to refresh.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Full gate**

Run: `npx tsc --noEmit && npx jest && npm run lint`
Expected: all exit 0. Metro (running from this worktree) regenerates `.expo/types/router.d.ts` when the route files appear; if `tsc` still rejects `/connectors` or `/connectors/server/[name]`, wait for the regeneration and re-run rather than casting the route.

- [ ] **Step 3: Commit Tasks 4–6**

```bash
git add src/lib/icon-map.ts src/components/sidebar.tsx src/app/connectors.tsx "src/app/connectors/server/[name].tsx"
git commit -m "feat(mcp): Connectors list and detail screens, reached from the sidebar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Simulator verification and architecture entries

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Architecture entries**

In the Architecture block of `AGENTS.md`, after the `dev-cards.tsx` lines:

```
  connectors.tsx  MCP connectors on the gateway: list, on/off, status from the chat socket
  connectors/server/[name].tsx  one connector: details, on/off, Test (over the chat socket)
```

and after the `approval-card / clarify-card / secure-entry-card` line:

```
  connector-row / connector-test-card  the Connectors list row and the Test button + result
```

- [ ] **Step 2: Simulator checks (iPhone 17 Pro, dev client, Metro from this worktree)**

Drive the app through the debugger only (`.expo/qa/cdp.mjs`, target `deviceName === 'iPhone 17 Pro'`); never the phone.

1. From a chat, press the sidebar's Connectors item (call its `onPress` through the fiber helper). Expect the list with `youtube-transcript`, a "Local" badge, its command, and a status line.
2. Screenshot in dark and light (`xcrun simctl ui <udid> appearance dark|light`); restore dark.
3. Open the detail. Expect Command, Authentication "None", Status, the Test button enabled, and the local-connector note.
4. Press Test (approved: it starts the stdio process on the gateway). Expect "Testing…", then "Working · N tools" with the tools listed. Screenshot.
5. Cold-start the app straight to `hermesmobileapp://connectors` (no chat underneath). Expect the list without status lines; on the detail, Test disabled with the reason. Screenshot. (Review focus 1.)
6. Forced switch failure without writing to the gateway (review focus 5): through the debugger, call the list's `onToggle` for a server object whose `name` is `qa-does-not-exist`. Expect the 404 → "This connector no longer exists." and a reload. This sends one `PUT …/enabled` for a name that does not exist; the gateway changes nothing.
7. Latest-wins (review focus 3): on the detail, call `onTest` twice in quick succession; expect one final result and no flicker back to an older one.

The switch on a real server is **not** exercised (it would write to his gateway); it is left for his device QA.

- [ ] **Step 3: Gate and commit**

```bash
git add AGENTS.md
git commit -m "docs: architecture entries for the Connectors screens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Whole-branch review and PR

- [ ] **Step 1:** One fresh reviewer over `git diff feat/mcp-connectors-transport...HEAD` with the spec, checking the screens against §5.2, §5.3, §5.7, §5.8 and AGENTS.md conventions (theme colours, React Compiler rules, accessibility labels, light and dark). Address what it finds; re-run the gate.
- [ ] **Step 2:** `git push -u origin feat/mcp-connectors-manage`; open the PR with base `feat/mcp-connectors-transport`, with the screenshots' findings in words and what was and was not exercised against the live gateway.
- [ ] **Step 3:** `gh pr checks <number> --watch`; expected exit 0. CI runs on pull requests, so a stacked PR is checked too. Merge is Gianluca's call; when #40 merges, retarget this PR to `main` before deleting #40's branch.
