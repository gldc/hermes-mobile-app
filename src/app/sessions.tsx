import { Stack, router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActionSheetIOS, Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { getActiveProfile, listProfiles, listSessionsForProfile } from '@/api/profiles';
import { searchSessions, type SearchResult } from '@/api/search';
import { deleteSession, renameSession } from '@/api/sessions';
import type { SessionSummary } from '@/api/types';
import { SearchResultRow } from '@/components/search-result-row';
import { SessionRow } from '@/components/session-row';
import { AuthError } from '@/api/restClient';
import { withAuthRetry } from '@/connection';
import {
  activeProfileLabel,
  canServerSearch,
  getProfileState,
  hydrateProfileStore,
  setSelectedProfile,
  setServerProfiles,
  subscribeProfiles,
} from '@/profile-store';
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
  const profiles = useSyncExternalStore(subscribeProfiles, getProfileState);
  const activeProfile = profiles.selected; // null = server default (no param sent)

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
      await hydrateProfileStore();
      const res = await withAuthRetry((r) =>
        listSessionsForProfile(r, getProfileState().selected),
      );
      setSessions(res.sessions);
      setTotal(res.total);
    } catch (e) {
      handleLoadError(e);
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [handleLoadError, activeProfile]);

  const loadMore = useCallback(async () => {
    if (loadingMore || refreshing || query || sessions.length >= total) return;
    setLoadingMore(true);
    try {
      const res = await withAuthRetry((r) =>
        listSessionsForProfile(r, activeProfile, sessions.length),
      );
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
  }, [loadingMore, refreshing, query, sessions, total, handleLoadError, activeProfile]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Profile discovery: the switcher pill appears only when the server knows
  // more than one profile. Failures keep the pill hidden — never blocking.
  useEffect(() => {
    (async () => {
      await hydrateProfileStore();
      try {
        const [list, active] = await Promise.all([
          withAuthRetry((r) => listProfiles(r)),
          withAuthRetry((r) => getActiveProfile(r)),
        ]);
        setServerProfiles(
          list.profiles.map((p) => p.name),
          active.current || null,
        );
      } catch {
        // offline or older server — single-profile behavior
      }
    })();
  }, []);

  const showProfilePicker = useCallback(() => {
    const { names, selected, serverCurrent } = getProfileState();
    const current = selected ?? serverCurrent;
    const labels = names.map((n) => (n === current ? `${n} ✓` : n));
    const pick = (index: number) => {
      if (index < 0 || index >= names.length || names[index] === current) return;
      if (isIOS) Haptics.selectionAsync();
      void setSelectedProfile(names[index]);
    };
    if (isIOS) {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Switch profile', options: [...labels, 'Cancel'], cancelButtonIndex: names.length },
        (index) => pick(index === names.length ? -1 : index),
      );
    } else {
      Alert.alert('Switch profile', undefined, [
        ...names.map((n, i) => ({ text: labels[i], onPress: () => pick(i) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, []);

  // Debounced server-side full-text search. While a request is in flight the
  // list keeps showing the instant client-side filter below.
  // FTS has no profile param (docs/contracts/sessions-extra.md) — it answers
  // for the backend's own profile only, so skip it for other targets and let
  // the client-side filter stand.
  const serverSearchOk = canServerSearch(profiles);
  useEffect(() => {
    const q = query.trim();
    if (!q || !serverSearchOk) {
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
  }, [query, serverSearchOk]);

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
                await withAuthRetry((r) => deleteSession(r, session.id, activeProfile));
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
    [handleActionError, activeProfile],
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
                const res = await withAuthRetry((r) =>
                  renameSession(r, session.id, title, activeProfile),
                );
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
    [handleActionError, activeProfile],
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {profiles.names.length > 1 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Active profile: ${activeProfileLabel(profiles)}. Switch profile`}
                  hitSlop={8}
                  onPress={showProfilePicker}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    maxWidth: 124,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    borderCurve: 'continuous',
                    backgroundColor: colors.raised,
                    opacity: pressed ? 0.5 : 1,
                  })}
                >
                  <Image
                    source="sf:person.crop.circle"
                    style={{ width: 16, height: 16 }}
                    tintColor={colors.accent}
                  />
                  <Text
                    numberOfLines={1}
                    style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}
                  >
                    {activeProfileLabel(profiles)}
                  </Text>
                </Pressable>
              ) : null}
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
