import { Stack, router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { searchSessions, type SearchResult } from '@/api/search';
import { deleteSession, renameSession } from '@/api/sessions';
import type { SessionSummary } from '@/api/types';
import { SearchResultRow } from '@/components/search-result-row';
import { SessionRow } from '@/components/session-row';
import { AuthError } from '@/api/restClient';
import { withAuthRetry } from '@/connection';
import { useTheme } from '@/theme';

export { RouteError as ErrorBoundary } from '@/components/route-error';

const isIOS = process.env.EXPO_OS === 'ios';
const SEARCH_DEBOUNCE_MS = 300;

type Row =
  | { kind: 'session'; session: SessionSummary }
  | { kind: 'hit'; hit: SearchResult };

export default function SessionsScreen() {
  const { colors } = useTheme();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Server FTS hits, tagged with the query they answer so stale results
  // never render while a newer request is still in flight.
  const [hits, setHits] = useState<{ q: string; results: SearchResult[] } | null>(null);
  const [searchPending, setSearchPending] = useState(false);

  const handleLoadError = useCallback((e: unknown) => {
    if (e instanceof AuthError) {
      // Silent re-login already failed inside withAuthRetry — credentials are dead.
      router.replace('/');
      return;
    }
    setError('Gateway unreachable — check your VPN or Wi-Fi, then pull to retry.');
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await withAuthRetry((r) => r.listSessions());
      setSessions(res.sessions);
      setTotal(res.total);
    } catch (e) {
      handleLoadError(e);
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [handleLoadError]);

  const loadMore = useCallback(async () => {
    if (loadingMore || refreshing || query || sessions.length >= total) return;
    setLoadingMore(true);
    try {
      const res = await withAuthRetry((r) => r.listSessions(sessions.length));
      setTotal(res.total);
      setSessions((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...res.sessions.filter((s) => !seen.has(s.id))];
      });
    } catch (e) {
      handleLoadError(e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, refreshing, query, sessions, total, handleLoadError]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Debounced server-side full-text search. While a request is in flight the
  // list keeps showing the instant client-side filter below.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      setSearchPending(false);
      return;
    }
    setSearchPending(true);
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const res = await withAuthRetry((r) => searchSessions(r, q));
        if (!stale) setHits({ q, results: res.results });
      } catch (e) {
        if (stale) return;
        if (e instanceof AuthError) {
          router.replace('/');
          return;
        }
        // Network/server hiccup: silently fall back to the client-side filter.
        setHits(null);
      } finally {
        if (!stale) setSearchPending(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const handleActionError = useCallback((e: unknown, what: string) => {
    if (e instanceof AuthError) {
      router.replace('/');
      return;
    }
    Alert.alert(`${what} failed`, e instanceof Error ? e.message : 'Gateway unreachable.');
  }, []);

  const confirmDelete = useCallback(
    (session: SessionSummary) => {
      const title = session.title?.trim() || session.preview?.trim() || 'this conversation';
      Alert.alert(
        'Delete conversation?',
        `“${title}” will be permanently removed from your gateway.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await withAuthRetry((r) => deleteSession(r, session.id));
                setSessions((prev) => prev.filter((s) => s.id !== session.id));
                setTotal((t) => Math.max(0, t - 1));
                if (isIOS) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (e) {
                handleActionError(e, 'Delete');
              }
            },
          },
        ],
      );
    },
    [handleActionError],
  );

  const promptRename = useCallback(
    (session: SessionSummary) => {
      // Alert.prompt is iOS-only; this app ships iOS-first (see AGENTS.md).
      if (!isIOS) return;
      Alert.prompt(
        'Rename conversation',
        'Leave empty to clear the title.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Save',
            onPress: async (value?: string) => {
              const title = (value ?? '').trim();
              try {
                const res = await withAuthRetry((r) => renameSession(r, session.id, title));
                setSessions((prev) =>
                  prev.map((s) =>
                    s.id === session.id ? { ...s, title: res.title?.trim() || null } : s,
                  ),
                );
              } catch (e) {
                handleActionError(e, 'Rename');
              }
            },
          },
        ],
        'plain-text',
        session.title ?? '',
      );
    },
    [handleActionError],
  );

  const titleById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const s of sessions) map.set(s.id, s.title?.trim() || s.preview?.trim() || null);
    return map;
  }, [sessions]);

  const rows: Row[] = useMemo(() => {
    const q = query.trim();
    // Server FTS results, once they match the live query.
    if (q && hits && hits.q === q) {
      return hits.results.map((hit) => ({ kind: 'hit' as const, hit }));
    }
    // No query, or request still in flight → instant client-side filter.
    const lower = q.toLowerCase();
    const list = !lower
      ? sessions
      : sessions.filter(
          (s) =>
            (s.title ?? '').toLowerCase().includes(lower) ||
            (s.preview ?? '').toLowerCase().includes(lower),
        );
    return list.map((session) => ({ kind: 'session' as const, session }));
  }, [sessions, query, hits]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'Hermes',
          headerLargeTitle: true,
          headerLargeTitleStyle: { color: colors.text },
          headerLargeStyle: { backgroundColor: colors.bg },
          headerSearchBarOptions: {
            placeholder: 'Search conversations',
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            hideWhenScrolling: true,
          },
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Settings"
                hitSlop={4}
                onPress={() => router.push('/settings')}
                style={({ pressed }) => ({ padding: 10, opacity: pressed ? 0.5 : 1 })}
              >
                <Image source="sf:gearshape" style={{ width: 24, height: 24 }} tintColor={colors.textDim} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="New chat"
                hitSlop={4}
                onPress={() => router.push('/chat/new')}
                style={({ pressed }) => ({ padding: 10, opacity: pressed ? 0.5 : 1 })}
              >
                <Image source="sf:square.and.pencil" style={{ width: 24, height: 24 }} tintColor={colors.accent} />
              </Pressable>
            </View>
          ),
        }}
      />

      {error ? (
        <Text selectable style={{ color: colors.danger, fontSize: 14, paddingHorizontal: 16, paddingTop: 8 }}>
          {error}
        </Text>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(row, index) =>
          row.kind === 'session' ? `s:${row.session.id}` : `h:${row.hit.session_id}:${index}`
        }
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.textDim} />}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 16 }} />
        )}
        renderItem={({ item }) =>
          item.kind === 'hit' ? (
            <SearchResultRow
              hit={item.hit}
              title={titleById.get(item.hit.session_id)}
              onPress={() => router.push(`/chat/${item.hit.session_id}`)}
            />
          ) : (
            <SessionRow
              session={item.session}
              onPress={() => router.push(`/chat/${item.session.id}`)}
              onRename={isIOS ? () => promptRename(item.session) : undefined}
              onDelete={() => confirmDelete(item.session)}
            />
          )
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore || (searchPending && rows.length > 0) ? (
            <Text style={{ color: colors.textFaint, fontSize: 13, textAlign: 'center', padding: 14 }}>
              {loadingMore ? 'Loading…' : 'Searching…'}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          loaded && !refreshing ? (
            <View style={{ alignItems: 'center', gap: 14, paddingTop: 96, paddingHorizontal: 32 }}>
              <Image
                source="sf:bubble.left.and.bubble.right"
                style={{ width: 44, height: 44 }}
                tintColor={colors.textFaint}
              />
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>
                {query ? (searchPending ? 'Searching…' : 'No matches') : 'No conversations yet'}
              </Text>
              {!query && (
                <Pressable
                  onPress={() => router.push('/chat/new')}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? colors.accentPressed : colors.accent,
                    borderRadius: 999,
                    paddingHorizontal: 22,
                    paddingVertical: 12,
                  })}
                >
                  <Text style={{ color: colors.onAccent, fontSize: 15.5, fontWeight: '600' }}>Start chatting</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
      />
    </View>
  );
}
