// src/app/connectors/catalog/[name].tsx
//
// One catalog entry (spec §5.4): what it is, where the agent will connect, how it signs in,
// and Add. Credentials an entry asks for are typed into ConnectorSecretForm, which owns them
// and runs Face ID before they are sent (spec §5.9).
//
// Installing makes the gateway connect to the server, so it can take most of a minute. If
// the answer is lost, the catalog is read again before another attempt is allowed. Sign-in
// for an OAuth entry is not started here: the connector's own screen owns it.
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import {
  McpAlreadyAddedError,
  McpPreflightError,
  installMcpCatalogEntry,
  listMcpCatalog,
  type McpCatalogEntry,
} from '@/api/mcp';
import { CardButton } from '@/components/card-button';
import { ConnectorSecretForm, type SubmitResult } from '@/components/connector-secret-form';
import { requestSignInOnOpen } from '@/components/connector-sign-in';
import { Icon } from '@/components/icon';
import { withAuthRetry } from '@/connection';
import { catalogAuthLabel, connectorError, secretFieldsForEntry } from '@/lib/mcp';
import { getProfileState, subscribeProfiles } from '@/profile-store';
import { markMcpChanged } from '@/session-mcp-store';
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

function Field({ label, value, selectable = false }: { label: string; value: string; selectable?: boolean }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ padding: 16, gap: 4, minHeight: 44 }}>
      <Text style={{ color: colors.textFaint, fontSize: 12.5, fontWeight: '600' }}>{label}</Text>
      <Text selectable={selectable} style={{ color: colors.text, fontSize: 15 }}>
        {value}
      </Text>
    </View>
  );
}

/** Leave the add screens: the list, with the new connector's detail on top of it. */
function openConnector(name: string): void {
  router.dismissTo('/connectors');
  router.push({ pathname: '/connectors/server/[name]', params: { name } });
}

export default function CatalogEntryScreen() {
  const { colors } = useTheme();
  const { name } = useLocalSearchParams<{ name: string }>();
  const profiles = useSyncExternalStore(subscribeProfiles, getProfileState);
  const profile = profiles.selected;
  const [entry, setEntry] = useState<McpCatalogEntry | null>(null);
  // true until the first fetch settles: the RefreshControl spins on first load.
  const [refreshing, setRefreshing] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After an await, a screen that was left must not navigate or write state.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** This entry as the gateway has it now; null when it is not in the catalog. Rejects on failure. */
  const readEntry = useCallback(
    () =>
      withAuthRetry((r) => listMcpCatalog(r, profile)).then(
        (catalog) => (catalog.entries ?? []).find((e) => e.name === name) ?? null,
      ),
    [name, profile],
  );

  // Every setter runs in a promise callback, never synchronously on the mount effect's path.
  const fetchEntry = useCallback(
    () =>
      readEntry()
        .then((found) => {
          if (!mounted.current) return;
          setEntry(found);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!mounted.current) return;
          const mapped = connectorError(e, 'catalog');
          if (mapped.kind === 'auth') router.replace('/');
          else setError(mapped.message);
        })
        .finally(() => {
          if (!mounted.current) return;
          setRefreshing(false);
          setLoaded(true);
        }),
    [readEntry],
  );

  useEffect(() => {
    void fetchEntry();
  }, [fetchEntry]);

  function refresh() {
    setRefreshing(true);
    setError(null);
    void fetchEntry();
  }

  /** The connector exists on the gateway because of this screen: note it, then go to it. */
  function finish(added: McpCatalogEntry) {
    markMcpChanged(); // the running gateway does not have it yet: the list offers a reload
    if (!mounted.current) return;
    if (added.auth_type === 'oauth') requestSignInOnOpen(added.name);
    openConnector(added.name);
  }

  /** ConnectorSecretForm hands over the typed values here, after Face ID. They go into the
   * request and nowhere else. */
  async function install(current: McpCatalogEntry, env: Record<string, string>): Promise<SubmitResult> {
    const handled: SubmitResult = { ok: false, message: '' };
    try {
      await withAuthRetry((r) => installMcpCatalogEntry(r, current.name, env, profile));
    } catch (e) {
      if (!mounted.current) return handled;
      const mapped = connectorError(e, 'install');
      if (mapped.kind === 'auth') {
        router.replace('/');
        return handled;
      }
      // The fast request failed: nothing was sent, so nothing can have been stored or installed.
      if (e instanceof McpPreflightError) return { ok: false, message: mapped.message };
      // Someone else added it in the meantime: show that, do not adopt it as ours.
      if (e instanceof McpAlreadyAddedError) {
        void fetchEntry();
        return handled;
      }
      // The answer may have been lost after the gateway installed it: look before he retries.
      const now = await readEntry().catch(() => null);
      if (!mounted.current) return handled;
      if (now?.installed) {
        finish(now);
        return { ok: true };
      }
      if (now) setEntry(now);
      const stored = Object.keys(env).length > 0 ? ' What you entered may already be stored on the gateway.' : '';
      return { ok: false, message: `${mapped.message}${stored}` };
    }
    finish(current);
    return { ok: true };
  }

  const source = entry?.source && /^https:\/\//i.test(entry.source) ? entry.source : null;

  return (
    <ScrollView
      testID="connector-catalog-entry"
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
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
      ) : entry ? (
        <>
          {entry.description ? (
            <Text style={{ color: colors.text, fontSize: 15.5, marginHorizontal: 4 }}>{entry.description}</Text>
          ) : null}

          <Card>
            <Field label="Address" value={entry.url ?? 'Unknown'} selectable />
            <Separator />
            <Field label="Sign-in" value={catalogAuthLabel(entry)} />
          </Card>

          {source ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="About this connector"
              onPress={() => void Linking.openURL(source)}
              style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', marginHorizontal: 4, opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={{ color: colors.accent, fontSize: 15 }}>About this connector</Text>
            </Pressable>
          ) : null}

          {entry.installed ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: colors.textDim, fontSize: 14.5, marginHorizontal: 4 }}>Already added</Text>
              <CardButton label="Open" a11y="Open connector" onPress={() => openConnector(entry.name)} primary />
            </View>
          ) : (
            <ConnectorSecretForm
              fields={secretFieldsForEntry(entry)}
              submitLabel="Add connector"
              busyLabel="Adding… this can take a minute"
              onSubmit={(env) => install(entry, env)}
            />
          )}

          <Text style={{ color: colors.textFaint, fontSize: 12.5, marginHorizontal: 4 }}>
            Adding lets the agent on your gateway connect to the address above. The agent uses it after a reload
            (on the Connectors list) or a gateway restart.
          </Text>
        </>
      ) : !error ? (
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 96, paddingHorizontal: 32 }}>
          <Icon sf="questionmark.circle" size={44} color={colors.textFaint} />
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>Not in the catalog</Text>
          <Text style={{ color: colors.textDim, fontSize: 14, textAlign: 'center' }}>
            “{name}” is not in the gateway’s catalog. Pull to refresh.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
