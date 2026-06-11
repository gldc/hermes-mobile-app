import { Stack, router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { SessionSummary } from '@/api/types';
import { SessionRow } from '@/components/session-row';
import { AuthError } from '@/api/restClient';
import { withAuthRetry } from '@/connection';
import { useTheme } from '@/theme';

export default function SessionsScreen() {
  const { colors } = useTheme();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) => (s.title ?? '').toLowerCase().includes(q) || (s.preview ?? '').toLowerCase().includes(q),
    );
  }, [sessions, query]);

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
                hitSlop={4}
                onPress={() => router.push('/settings')}
                style={({ pressed }) => ({ padding: 10, opacity: pressed ? 0.5 : 1 })}
              >
                <Image source="sf:gearshape" style={{ width: 24, height: 24 }} tintColor={colors.textDim} />
              </Pressable>
              <Pressable
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
        data={visible}
        keyExtractor={(s) => s.id}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.textDim} />}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 16 }} />
        )}
        renderItem={({ item }) => (
          <SessionRow session={item} onPress={() => router.push(`/chat/${item.id}`)} />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? <Text style={{ color: colors.textFaint, fontSize: 13, textAlign: 'center', padding: 14 }}>Loading…</Text> : null
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
                {query ? 'No matches' : 'No conversations yet'}
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
