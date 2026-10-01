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
  // true until the first fetch settles: the RefreshControl spins on first load.
  const [refreshing, setRefreshing] = useState(true);
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

  /** Pull to refresh. */
  const load = useCallback(() => {
    setRefreshing(true);
    setError(null);
    return fetchList();
  }, [fetchList]);

  // Re-read on every focus (a change made on the detail screen shows on return), without
  // raising the spinner: started from code on a re-focus, it leaves the list pushed down.
  useFocusEffect(
    useCallback(() => {
      setError(null);
      void fetchList();
    }, [fetchList]),
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
        if (fail(e, 'switch') !== 'auth') void fetchList(); // the write may have landed: show the truth
      }
    },
    [replaceServer, fail, fetchList, profile],
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
