// Connectors list and detail: how they behave around the chat socket (status lines, Test) and
// around a failed switch. The REST layer is mocked; the session-mcp-store is the real one.
import { Stack, router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import type { McpServer } from '../src/api/mcp';
import type { McpTestOutcome } from '../src/api/mcpSession';
import { AuthError, HttpError } from '../src/api/restClient';
import ConnectorsScreen from '../src/app/connectors';
import ConnectorDetailScreen from '../src/app/connectors/server/[name]';
import {
  __resetSessionMcpStore,
  clearSessionMcpTarget,
  publishSessionMcpTarget,
  type SessionMcpTarget,
} from '../src/session-mcp-store';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));
jest.mock('../src/connection', () => ({
  withAuthRetry: (fn: (r: unknown) => Promise<unknown>) => fn({}),
}));
const mockList = jest.fn();
const mockSet = jest.fn();
jest.mock('../src/api/mcp', () => ({
  ...jest.requireActual('../src/api/mcp'),
  listMcpServers: (...a: unknown[]) => mockList(...a),
  setMcpServerEnabled: (...a: unknown[]) => mockSet(...a),
}));

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

const local = server({ name: 'yt', transport: 'stdio', url: null, command: 'uvx', auth: null });

const owner = {};
let statusCalls = 0;
let testCalls: { resolve: (o: McpTestOutcome) => void }[] = [];

/** A chat's target: status answers at once, tests stay pending until the case resolves them. */
function target(connected: boolean): SessionMcpTarget {
  return {
    connected,
    status: async () => {
      statusCalls++;
      return [
        { name: 'linear', transport: 'http', tools: 3, connected: true, disabled: false, status: 'connected', source: 'config', plugin: null },
      ];
    },
    test: () => new Promise<McpTestOutcome>((resolve) => testCalls.push({ resolve })),
  };
}

const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

let pathname: () => string;

async function open(url: string) {
  const rendered = renderRouter(
    {
      _layout: () => <Stack />,
      index: () => <Text>sign in</Text>,
      connectors: ConnectorsScreen,
      'connectors/server/[name]': ConnectorDetailScreen,
    },
    { initialUrl: '/' },
  );
  pathname = () => rendered.getPathname();
  await rendered;
  await act(async () => router.push(url as never));
  await flush();
}

beforeEach(() => {
  __resetSessionMcpStore();
  statusCalls = 0;
  testCalls = [];
  mockList.mockReset();
  mockSet.mockReset();
  mockList.mockImplementation(async () => [server(), local]);
});

describe('Connectors list', () => {
  it('shows the status line when a chat socket is connected, and does not refetch in a loop', async () => {
    publishSessionMcpTarget(owner, target(true));
    await open('/connectors');
    expect(screen.getByText('Connected · 3 tools')).toBeTruthy();
    expect(screen.getByText('The agent uses changes after the gateway restarts.')).toBeTruthy();
    const before = mockList.mock.calls.length;
    await flush(50);
    expect(mockList.mock.calls.length).toBe(before);
    expect(before).toBe(1);
  });

  it('loads without a chat socket: rows, no status lines; fills them in when the socket arrives; drops them when it goes', async () => {
    await open('/connectors');
    expect(screen.getByText('linear')).toBeTruthy();
    expect(screen.getByText('yt')).toBeTruthy();
    expect(screen.queryByText(/Connected/)).toBeNull();
    expect(statusCalls).toBe(0);

    await act(async () => publishSessionMcpTarget(owner, target(true)));
    await flush();
    expect(screen.getByText('Connected · 3 tools')).toBeTruthy();
    expect(mockList.mock.calls.length).toBe(1); // the status arriving does not refetch the list

    await act(async () => publishSessionMcpTarget(owner, target(false))); // the chat is reconnecting
    await flush();
    expect(screen.queryByText(/Connected/)).toBeNull();

    await act(async () => clearSessionMcpTarget(owner)); // the chat unmounted
    await flush();
    expect(screen.queryByText(/Connected/)).toBeNull();
    expect(screen.getByText('linear')).toBeTruthy();
  });

  it('a switch that fails with 404 says the connector is gone, and the message survives the re-read', async () => {
    await open('/connectors');
    mockSet.mockRejectedValue(new HttpError(404, "Server 'linear' not found"));
    mockList.mockImplementation(async () => [local]);
    await act(async () => fireEvent(screen.getAllByRole('switch')[0], 'valueChange', false));
    await flush(30);
    expect(mockSet).toHaveBeenCalledWith({}, 'linear', false, null);
    expect(screen.getByText('This connector no longer exists.')).toBeTruthy();
    expect(screen.queryByText('linear')).toBeNull();
    expect(screen.getByText('yt')).toBeTruthy();
  });

  it('a switch that fails on the network reverts, says why, and re-reads the list', async () => {
    await open('/connectors');
    mockSet.mockRejectedValue(new TypeError('Network request failed'));
    await act(async () => fireEvent(screen.getAllByRole('switch')[0], 'valueChange', false));
    await flush(30);
    expect(screen.getAllByRole('switch')[0].props.value).toBe(true);
    expect(screen.getByText('Gateway unreachable — check your VPN or Wi-Fi.')).toBeTruthy();
    expect(mockList.mock.calls.length).toBe(2);
  });

  it('a switch that succeeds keeps the new value and does not re-read', async () => {
    await open('/connectors');
    mockSet.mockResolvedValue({ ok: true, name: 'linear', enabled: false });
    await act(async () => fireEvent(screen.getAllByRole('switch')[0], 'valueChange', false));
    await flush();
    expect(screen.getAllByRole('switch')[0].props.value).toBe(false);
    expect(mockList.mock.calls.length).toBe(1);
  });

  it('a gateway without the connector routes gets its own empty state', async () => {
    mockList.mockRejectedValue(new HttpError(404, 'Not Found'));
    await open('/connectors');
    expect(screen.getByText('Connectors aren’t available')).toBeTruthy();
    expect(screen.getByText("This gateway doesn't support connectors (needs Hermes 0.21.5 or later).")).toBeTruthy();
  });

  it('no connectors: the empty state', async () => {
    mockList.mockImplementation(async () => []);
    await open('/connectors');
    expect(screen.getByText('No connectors yet')).toBeTruthy();
    expect(screen.queryByText('The agent uses changes after the gateway restarts.')).toBeNull();
  });

  it('a dead session goes to sign-in', async () => {
    mockList.mockRejectedValue(new AuthError('session expired'));
    await open('/connectors');
    expect(pathname()).toBe('/');
  });

  it('pressing a row opens its detail', async () => {
    await open('/connectors');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: /^yt connector/ })));
    await flush();
    expect(pathname()).toBe('/connectors/server/yt');
  });
});

describe('Connector detail', () => {
  it('tests a remote connector once when it opens, and not again across a reconnect', async () => {
    publishSessionMcpTarget(owner, target(true));
    await open('/connectors/server/linear');
    expect(testCalls).toHaveLength(1);
    expect(screen.getByText('Testing…')).toBeTruthy();
    expect(screen.getByText('Connected · 3 tools')).toBeTruthy(); // the Status field

    await act(async () => publishSessionMcpTarget(owner, target(false)));
    await flush();
    await act(async () => publishSessionMcpTarget(owner, target(true)));
    await flush();
    expect(testCalls).toHaveLength(1);
    expect(mockList.mock.calls.length).toBe(1); // the socket flipping does not refetch over REST

    await act(async () =>
      testCalls[0].resolve({ kind: 'ok', tools: [{ name: 'search', description: 'Search issues' }], prompts: 0, resources: 0, tokensPresent: true }),
    );
    await flush();
    expect(screen.getByText('Working · 1 tool')).toBeTruthy();
    expect(screen.getByText('search')).toBeTruthy();
  });

  it('without a chat socket Test is disabled with the reason; it runs when the socket arrives', async () => {
    await open('/connectors/server/linear');
    expect(testCalls).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    expect(
      screen.getByText('Testing needs a connected chat. Go back to the chat, wait for it to connect, then return.'),
    ).toBeTruthy();
    await act(async () => publishSessionMcpTarget(owner, target(true)));
    await flush();
    expect(testCalls).toHaveLength(1);
  });

  it('a local connector is not tested until asked, and of two overlapping tests only the newer result shows', async () => {
    publishSessionMcpTarget(owner, target(true));
    await open('/connectors/server/yt');
    await flush(20);
    expect(testCalls).toHaveLength(0);
    expect(screen.getByText('uvx')).toBeTruthy();

    const button = screen.getByRole('button', { name: 'Test connection' });
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    await flush();
    expect(testCalls).toHaveLength(2);

    await act(async () => testCalls[1].resolve({ kind: 'ok', tools: [], prompts: 0, resources: 0, tokensPresent: null }));
    await flush();
    expect(screen.getByText('Working · 0 tools')).toBeTruthy();
    await act(async () => testCalls[0].resolve({ kind: 'error', message: 'OLD RESULT' }));
    await flush();
    expect(screen.queryByText('OLD RESULT')).toBeNull();
    expect(screen.getByText('Working · 0 tools')).toBeTruthy();
  });

  it('a switch that fails with 404 says so and re-reads; the connector is then gone', async () => {
    await open('/connectors/server/linear');
    mockSet.mockRejectedValue(new HttpError(404, "Server 'linear' not found"));
    mockList.mockImplementation(async () => [local]);
    await act(async () => fireEvent(screen.getByRole('switch'), 'valueChange', false));
    await flush(30);
    expect(screen.getByText('This connector no longer exists.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('a switch that times out reverts, says to check, and re-reads what the gateway has', async () => {
    await open('/connectors/server/linear');
    mockSet.mockRejectedValue(new HttpError(0, 'request timed out after 20s'));
    mockList.mockImplementation(async () => [server({ enabled: false }), local]); // the write had landed
    await act(async () => fireEvent(screen.getByRole('switch'), 'valueChange', false));
    await flush(30);
    expect(screen.getByText('The gateway did not answer in time.')).toBeTruthy();
    expect(screen.getByRole('switch').props.value).toBe(false);
  });

  it('an unknown name shows Connector not found', async () => {
    await open('/connectors/server/nope');
    expect(screen.getByText('Connector not found')).toBeTruthy();
  });

  it('a plugin connector has no switch, and says where to change it', async () => {
    mockList.mockImplementation(async () => [server({ source: 'plugin', plugin: 'acme' })]);
    await open('/connectors/server/linear');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('Plugin: acme')).toBeTruthy();
    expect(screen.getByText(/comes from a plugin/)).toBeTruthy();
  });
});
