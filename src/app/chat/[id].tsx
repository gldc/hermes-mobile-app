// app/chat/[id].tsx
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Button, FlatList, KeyboardAvoidingView,
  Platform, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { GatewayClient } from '../../api/gatewayClient';
import type { SessionCreateResult } from '../../api/types';
import { getRest, openGateway } from '../../connection';

interface ChatItem {
  key: string;
  role: 'user' | 'assistant' | 'tool' | 'status';
  text: string;
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const gwRef = useRef<GatewayClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<ChatItem>>(null);
  const keyCounter = useRef(0);

  const nextKey = () => `i${keyCounter.current++}`;

  function append(role: ChatItem['role'], text: string) {
    setItems((prev) => [...prev, { key: nextKey(), role, text }]);
  }

  /** Append streamed text to the trailing assistant bubble (create if absent). */
  function appendDelta(text: string) {
    setItems((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { key: nextKey(), role: 'assistant', text }];
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (id !== 'new') {
          const history = await getRest().getMessages(id);
          if (cancelled) return;
          setItems(
            history.messages
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => ({ key: nextKey(), role: m.role as 'user' | 'assistant', text: m.text ?? '' })),
          );
        }
        const gw = await openGateway();
        if (cancelled) { gw.close(); return; }
        gwRef.current = gw;
        gw.onEvent((e) => {
          switch (e.type) {
            case 'message.delta': appendDelta(e.payload?.text ?? ''); break;
            case 'message.complete': setStreaming(false); break;
            case 'tool.start': append('status', `⚙ ${e.payload?.tool_name ?? 'tool'}…`); break;
            case 'status.update': append('status', e.payload?.text ?? ''); break;
            case 'error': setStreaming(false); setError(e.payload?.message ?? 'agent error'); break;
          }
        });
        gw.onClose(() => { setReady(false); setError('Connection lost. Go back and reopen the chat.'); });
        const created = await gw.call<SessionCreateResult>('session.create', {
          title: id === 'new' ? '' : `Continued from ${id.slice(0, 8)}`,
        });
        if (cancelled) return;
        sessionIdRef.current = created.session_id;
        setReady(true);
      } catch {
        if (!cancelled) setError('Could not open a live session. Check your VPN connection.');
      }
    })();
    return () => { cancelled = true; gwRef.current?.close(); };
  }, [id]);

  async function send() {
    const text = input.trim();
    const gw = gwRef.current;
    const sid = sessionIdRef.current;
    if (!text || !gw || !sid || streaming) return;
    setInput('');
    setError(null);
    append('user', text);
    setStreaming(true);
    try {
      await gw.call('prompt.submit', { session_id: sid, text });
    } catch (e) {
      setStreaming(false);
      setError(e instanceof Error ? e.message : 'send failed');
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(i) => i.key}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={[styles.bubble, bubbleStyle[item.role]]}>
            <Text style={item.role === 'status' ? styles.statusText : styles.bubbleText}>{item.text}</Text>
          </View>
        )}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      {!ready && !error && <ActivityIndicator />}
      <View style={styles.inputRow}>
        <TextInput style={styles.input} value={input} onChangeText={setInput}
          placeholder={streaming ? 'Hermes is responding…' : 'Message'}
          editable={ready && !streaming} multiline />
        <Button title="Send" onPress={send} disabled={!ready || streaming || !input.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 8 },
  bubble: { marginVertical: 4, padding: 10, borderRadius: 12, maxWidth: '85%' },
  bubbleText: { fontSize: 15 },
  statusText: { fontSize: 12, color: '#666', fontStyle: 'italic' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, maxHeight: 120 },
  error: { color: '#c00', padding: 4 },
});

const bubbleStyle = StyleSheet.create({
  user: { alignSelf: 'flex-end', backgroundColor: '#d0e8ff' },
  assistant: { alignSelf: 'flex-start', backgroundColor: '#f0f0f0' },
  tool: { alignSelf: 'flex-start', backgroundColor: '#fff7d6' },
  status: { alignSelf: 'center', backgroundColor: 'transparent' },
});
