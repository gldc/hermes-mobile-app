import { Stack, router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { SessionSummary } from '@/api/types';
import { SessionRow } from '@/components/session-row';
import { getRest } from '@/connection';
import { useTheme } from '@/theme';

export default function SessionsScreen() {
  const { colors } = useTheme();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await getRest().listSessions();
      setSessions(res.sessions);
    } catch {
      setError('Gateway unreachable — check your VPN or Wi-Fi, then pull to retry.');
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, []);

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
