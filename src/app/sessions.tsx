// app/sessions.tsx
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { SessionSummary } from '../api/types';
import { disconnect, getRest } from '../connection';

export default function SessionsScreen() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await getRest().listSessions();
      setSessions(res.sessions);
    } catch {
      setError('Could not load sessions. Check your VPN connection.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onDisconnect() {
    await disconnect();
    router.replace('/');
  }

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/chat/${item.id}`)}>
            <Text style={styles.title} numberOfLines={1}>{item.title || item.preview || item.id}</Text>
            <Text style={styles.meta}>{item.message_count} messages · {new Date(item.last_active * 1000).toLocaleString()}</Text>
          </Pressable>
        )}
        ListEmptyComponent={!refreshing ? <Text style={styles.meta}>No sessions yet.</Text> : null}
      />
      <Button title="New chat" onPress={() => router.push('/chat/new')} />
      <Button title="Disconnect" color="#c00" onPress={onDisconnect} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, gap: 8 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { color: '#666', fontSize: 12, marginTop: 2 },
  error: { color: '#c00' },
});
