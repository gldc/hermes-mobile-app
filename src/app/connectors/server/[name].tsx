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

  /** Runtime status over the chat socket; a no-op without one. Never rejects. */
  const loadStatus = useCallback(() => {
    const t = getSessionMcpTarget();
    if (!t?.connected || typeof name !== 'string') return Promise.resolve();
    return t.status(profile).then((rows) => setRow(runtimeRowsByName(rows, profile !== null).get(name)));
  }, [name, profile]);

  // Every setter runs in a promise callback, never synchronously on the mount effect's path.
  // `keepError`: a re-read after a failed switch must not wipe that failure's message.
  const fetchServer = useCallback(
    (keepError = false) =>
      // No GET for one server exists — fetch the list and pick our row.
      withAuthRetry((r) => listMcpServers(r, profile))
        .then((list) => {
          setServer(list.find((s) => s.name === name) ?? null);
          if (!keepError) setError(null);
          void loadStatus(); // not awaited: the screen must not wait on the chat socket
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
    if (!autoTest || !connected || autoTested.current || !getSessionMcpTarget()?.connected) return;
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
      if (fail(e, 'switch') !== 'auth') void fetchServer(true); // the write may have landed: show the truth
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
