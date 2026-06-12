import { router, usePathname, type Href } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getActiveProfile, listProfiles, listSessionsForProfile } from '@/api/profiles';
import { searchSessions, type SearchResult } from '@/api/search';
import { deleteSession, renameSession, setSessionArchived } from '@/api/sessions';
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
  setServerProfiles,
  subscribeProfiles,
} from '@/profile-store';
import { showProfilePicker } from '@/lib/profile-picker';
import { closeSidebar } from '@/sidebar-store';
import { serif, useTheme } from '@/theme';

const isIOS = process.env.EXPO_OS === 'ios';
const SEARCH_DEBOUNCE_MS = 300;

type Row =
  | { kind: 'session'; session: SessionSummary }
  | { kind: 'hit'; hit: SearchResult };

function NavItem({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        paddingHorizontal: 16,
        paddingVertical: 12.5,
        borderRadius: 10,
        borderCurve: 'continuous',
        backgroundColor: pressed ? colors.raised : 'transparent',
      })}
    >
      <Image source={icon} style={{ width: 20, height: 20 }} tintColor={colors.text} />
      <Text style={{ color: colors.text, fontSize: 16.5 }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Slide-over sidebar in the style of the Claude app: wordmark + avatar,
 * search, destination list, recents, and a floating New chat pill. Rendered
 * by SidebarHost behind the main content; `open` drives data loading.
 */
export function Sidebar({ open, width }: { open: boolean; width: number }) {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  // Server FTS hits, tagged with the query they answer so stale results
  // never render while a newer request is still in flight.
  const [hits, setHits] = useState<{ q: string; results: SearchResult[] } | null>(null);
  const [searchPending, setSearchPending] = useState(false);
  const profiles = useSyncExternalStore(subscribeProfiles, getProfileState);
  const activeProfile = profiles.selected; // null = server default (no param sent)

  const handleLoadError = useCallback((e: unknown) => {
    if (e instanceof AuthError) {
      // Silent re-login already failed inside withAuthRetry — credentials are dead.
      closeSidebar();
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
        listSessionsForProfile(r, getProfileState().selected, 0, showArchived ? 'only' : 'exclude'),
      );
      setSessions(res.sessions);
      setTotal(res.total);
    } catch (e) {
      handleLoadError(e);
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [handleLoadError, activeProfile, showArchived]);

  const loadMore = useCallback(async () => {
    if (loadingMore || refreshing || query || sessions.length >= total) return;
    setLoadingMore(true);
    try {
      const res = await withAuthRetry((r) =>
        listSessionsForProfile(r, activeProfile, sessions.length, showArchived ? 'only' : 'exclude'),
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
  }, [loadingMore, refreshing, query, sessions, total, handleLoadError, activeProfile, showArchived]);

  // Refresh whenever the drawer opens (and on archive/profile switches while open).
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Profile discovery: the switcher appears only when the server knows more
  // than one profile. Failures keep it hidden — never blocking.
  useEffect(() => {
    if (!open) return;
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
  }, [open]);

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
          closeSidebar();
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
      closeSidebar();
      router.replace('/');
      return;
    }
    Alert.alert(`${what} failed`, e instanceof Error ? e.message : 'Gateway unreachable.');
  }, []);

  const toggleArchived = useCallback(
    async (session: SessionSummary) => {
      try {
        await withAuthRetry((r) => setSessionArchived(r, session.id, !showArchived, activeProfile));
        // The session leaves the current view either way (archived from active,
        // restored from archived).
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
        setTotal((t) => Math.max(0, t - 1));
        if (isIOS) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e) {
        handleActionError(e, showArchived ? 'Unarchive' : 'Archive');
      }
    },
    [handleActionError, activeProfile, showArchived],
  );

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

  const openChat = useCallback(
    (sessionId: string) => {
      closeSidebar();
      if (pathname !== `/chat/${sessionId}`) router.replace(`/chat/${sessionId}`);
    },
    [pathname],
  );

  const newChat = useCallback(() => {
    if (isIOS) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    closeSidebar();
    if (pathname !== '/chat/new') router.replace('/chat/new');
  }, [pathname]);

  const pushRoute = useCallback((route: Href) => {
    closeSidebar();
    router.push(route);
  }, []);

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

  const searching = query.trim().length > 0;
  const profileInitial = (activeProfileLabel(profiles) || 'H')[0]?.toUpperCase() ?? 'H';

  return (
    <View style={{ width, flex: 1, paddingTop: insets.top + 10 }}>
      {/* Wordmark + avatar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 20,
          paddingRight: 14,
          paddingBottom: 10,
        }}
      >
        <Text style={{ fontFamily: serif, fontSize: 27, color: colors.text, letterSpacing: 0.2 }}>
          Hermes
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={6}
          onPress={() => pushRoute('/settings')}
          style={({ pressed }) => ({
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? colors.raised : colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          })}
        >
          <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: '600' }}>{profileInitial}</Text>
        </Pressable>
      </View>

      {/* Search */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginHorizontal: 14,
          marginBottom: 8,
          paddingHorizontal: 12,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.raised,
        }}
      >
        <Image source="sf:magnifyingglass" style={{ width: 16, height: 16 }} tintColor={colors.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={{ flex: 1, color: colors.text, fontSize: 16, height: 40 }}
        />
      </View>

      {/* Destinations (hidden while searching to give results room) */}
      {!searching ? (
        <View style={{ paddingHorizontal: 8, paddingBottom: 4 }}>
          <NavItem icon="sf:bubble.left.and.bubble.right" label="Chats" onPress={newChat} />
          <NavItem icon="sf:clock.arrow.circlepath" label="Cron jobs" onPress={() => pushRoute('/cron')} />
          <NavItem icon="sf:books.vertical" label="Memory" onPress={() => pushRoute('/memory')} />
          <NavItem icon="sf:sparkles" label="Skills" onPress={() => pushRoute('/skills')} />
          <NavItem icon="sf:cpu" label="Models" onPress={() => pushRoute('/models')} />
        </View>
      ) : null}

      {/* Recents header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 20,
          paddingRight: 10,
          paddingTop: 8,
          paddingBottom: 2,
          gap: 8,
        }}
      >
        <Text style={{ flex: 1, color: colors.textFaint, fontSize: 13.5, fontWeight: '500' }}>
          {searching ? 'Results' : showArchived ? 'Archived' : 'Recents'}
        </Text>
        {profiles.names.length > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Active profile: ${activeProfileLabel(profiles)}. Switch profile`}
            hitSlop={8}
            onPress={showProfilePicker}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              maxWidth: 110,
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: colors.raised,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Image source="sf:person.crop.circle" style={{ width: 13, height: 13 }} tintColor={colors.accent} />
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
              {activeProfileLabel(profiles)}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showArchived ? 'Show active conversations' : 'Show archived conversations'}
          accessibilityState={{ selected: showArchived }}
          hitSlop={8}
          onPress={() => {
            if (isIOS) Haptics.selectionAsync();
            setSessions([]);
            setTotal(0);
            setLoaded(false);
            setShowArchived((v) => !v);
          }}
          style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.5 : 1 })}
        >
          <Image
            source={showArchived ? 'sf:archivebox.fill' : 'sf:archivebox'}
            style={{ width: 17, height: 17 }}
            tintColor={showArchived ? colors.accent : colors.textFaint}
          />
        </Pressable>
      </View>

      {error ? (
        <Text selectable style={{ color: colors.danger, fontSize: 13.5, paddingHorizontal: 20, paddingTop: 6 }}>
          {error}
        </Text>
      ) : null}

      <Animated.FlatList
        data={rows}
        keyExtractor={(row, index) =>
          row.kind === 'session' ? `s:${row.session.id}` : `h:${row.hit.session_id}:${index}`
        }
        // Remaining rows slide up smoothly when one is archived or deleted.
        itemLayoutAnimation={LinearTransition.duration(220)}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: insets.bottom + 92 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.textDim} />}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) =>
          item.kind === 'hit' ? (
            <SearchResultRow
              hit={item.hit}
              title={titleById.get(item.hit.session_id)}
              onPress={() => openChat(item.hit.session_id)}
            />
          ) : (
            <SessionRow
              compact
              session={item.session}
              onPress={() => openChat(item.session.id)}
              onRename={isIOS && !showArchived ? () => promptRename(item.session) : undefined}
              onArchive={() => toggleArchived(item.session)}
              archiveLabel={showArchived ? 'Unarchive' : 'Archive'}
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
            <Text style={{ color: colors.textFaint, fontSize: 14, paddingHorizontal: 16, paddingTop: 18 }}>
              {searching
                ? searchPending
                  ? 'Searching…'
                  : 'No matches'
                : showArchived
                  ? 'No archived conversations'
                  : 'No conversations yet'}
            </Text>
          ) : null
        }
      />

      {/* Floating New chat pill */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: insets.bottom + 18,
          alignItems: 'center',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New chat"
          onPress={newChat}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            paddingHorizontal: 22,
            height: 48,
            borderRadius: 24,
            backgroundColor: colors.inverseSurface,
            opacity: pressed ? 0.85 : 1,
            boxShadow: dark ? '0 6px 22px rgba(0, 0, 0, 0.5)' : '0 6px 22px rgba(24, 24, 23, 0.3)',
          })}
        >
          <Image source="sf:plus" style={{ width: 16, height: 16 }} tintColor={colors.onInverse} />
          <Text style={{ color: colors.onInverse, fontSize: 16, fontWeight: '600' }}>New chat</Text>
        </Pressable>
      </View>
    </View>
  );
}
