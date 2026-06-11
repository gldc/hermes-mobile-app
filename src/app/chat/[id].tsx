import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GatewayClient } from '@/api/gatewayClient';
import type { SessionCreateResult } from '@/api/types';
import { Composer } from '@/components/composer';
import { MessageRow, type ChatItem, type ToolInfo } from '@/components/message-row';
import { ThinkingDots } from '@/components/thinking-dots';
import { getRest, openGateway } from '@/connection';
import { messageText } from '@/lib/message-text';
import { useTheme } from '@/theme';

const isIOS = process.env.EXPO_OS === 'ios';

export default function ChatScreen() {
  const { colors } = useTheme();
  // Standard compact nav bar (44pt) + status bar — what useHeaderHeight would report.
  const headerHeight = useSafeAreaInsets().top + 44;
  const { id } = useLocalSearchParams<{ id: string }>();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [waiting, setWaiting] = useState(false); // sent, no tokens yet
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const gwRef = useRef<GatewayClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const keyCounter = useRef(0);

  const nextKey = () => `i${keyCounter.current++}`;

  function append(role: ChatItem['role'], text: string, complete = true) {
    setItems((prev) => [...prev, { key: nextKey(), role, text, complete }]);
  }

  /** Append streamed text to the trailing assistant message (create if absent). */
  function appendDelta(text: string) {
    setWaiting(false);
    setItems((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && !last.complete) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { key: nextKey(), role: 'assistant', text, complete: false }];
    });
  }

  /** Close the trailing streaming segment: complete it, or drop it if it
   * holds only whitespace (prevents stranded carets around tool calls). */
  function finishAssistant() {
    setItems((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && !last.complete) {
        if (!last.text.trim()) return prev.slice(0, -1);
        return [...prev.slice(0, -1), { ...last, complete: true }];
      }
      return prev;
    });
  }

  function startTool(payload: any) {
    const tool: ToolInfo = {
      id: String(payload?.tool_id ?? `t${keyCounter.current}`),
      name: String(payload?.name ?? 'tool'),
      ...(payload?.context ? { context: String(payload.context) } : {}),
      running: true,
    };
    setItems((prev) => [...prev, { key: nextKey(), role: 'tool', text: tool.name, tool }]);
  }

  function completeTool(payload: any) {
    const id = String(payload?.tool_id ?? '');
    setItems((prev) => {
      // Find the matching running tool (by id, else last running with same name).
      let idx = prev.findIndex((it) => it.tool?.running && it.tool.id === id);
      if (idx < 0) {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].tool?.running && prev[i].tool!.name === String(payload?.name ?? '')) {
            idx = i;
            break;
          }
        }
      }
      if (idx < 0) return prev;
      const result = payload?.result;
      const rawDetail =
        typeof payload?.result_text === 'string' && payload.result_text
          ? payload.result_text
          : typeof result === 'string'
            ? result
            : result !== undefined && result !== null
              ? JSON.stringify(result, null, 2)
              : '';
      const tool: ToolInfo = {
        ...prev[idx].tool!,
        running: false,
        ...(typeof payload?.duration_s === 'number' ? { durationS: payload.duration_s } : {}),
        ...(payload?.summary ? { summary: String(payload.summary) } : {}),
        ...(rawDetail ? { detail: rawDetail.slice(0, 4000) } : {}),
        ...(payload?.inline_diff ? { diff: String(payload.inline_diff).slice(0, 4000) } : {}),
      };
      const next = [...prev];
      next[idx] = { ...prev[idx], tool };
      return next;
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
              .map((m) => ({
                key: nextKey(),
                role: m.role as 'user' | 'assistant',
                text: messageText(m),
                complete: true,
              }))
              .filter((m) => m.text.trim().length > 0),
          );
        }
        const gw = await openGateway();
        if (cancelled) {
          gw.close();
          return;
        }
        gwRef.current = gw;
        gw.onEvent((e) => {
          switch (e.type) {
            case 'message.delta':
              appendDelta(e.payload?.text ?? '');
              break;
            case 'message.complete':
              finishAssistant();
              setStreaming(false);
              setWaiting(false);
              if (isIOS) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              break;
            case 'tool.start':
              setWaiting(false);
              finishAssistant();
              startTool(e.payload);
              break;
            case 'tool.complete':
              completeTool(e.payload);
              break;
            case 'status.update':
              if (e.payload?.text) append('status', e.payload.text);
              break;
            case 'error':
              setStreaming(false);
              setWaiting(false);
              setError(e.payload?.message ?? 'agent error');
              break;
          }
        });
        gw.onClose(() => {
          setReady(false);
          setError('Connection lost — go back and reopen the chat.');
        });
        const created = await gw.call<SessionCreateResult>('session.create', {
          title: id === 'new' ? '' : `Continued from ${id.slice(0, 8)}`,
        });
        if (cancelled) return;
        sessionIdRef.current = created.session_id;
        setReady(true);
      } catch {
        if (!cancelled) setError('Could not open a live session. Check your VPN or Wi-Fi.');
      }
    })();
    return () => {
      cancelled = true;
      gwRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function send() {
    const text = input.trim();
    const gw = gwRef.current;
    const sid = sessionIdRef.current;
    if (!text || !gw || !sid || streaming) return;
    if (isIOS) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');
    setError(null);
    append('user', text);
    setStreaming(true);
    setWaiting(true);
    try {
      await gw.call('prompt.submit', { session_id: sid, text });
    } catch (e) {
      setStreaming(false);
      setWaiting(false);
      setError(e instanceof Error ? e.message : 'send failed');
    }
  }

  // Inverted list: index 0 renders at the visual bottom, so newest goes first.
  const reversedItems = useMemo(() => [...items].reverse(), [items]);

  const showGreeting = ready && items.length === 0 && !error;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={isIOS ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen options={{ title: id === 'new' ? 'New chat' : 'Chat' }} />

      {showGreeting ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.4 }}>
            What can I help with?
          </Text>
          <Text style={{ color: colors.textFaint, fontSize: 14.5 }}>Messages run on your own gateway.</Text>
        </View>
      ) : (
        <FlatList
          data={reversedItems}
          inverted
          keyExtractor={(i) => i.key}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
          renderItem={({ item }) => <MessageRow item={item} />}
          ListHeaderComponent={waiting ? <ThinkingDots /> : null}
        />
      )}

      {error ? (
        <Text selectable style={{ color: colors.danger, fontSize: 14, paddingHorizontal: 16, paddingBottom: 6 }}>
          {error}
        </Text>
      ) : null}
      {!ready && !error && !showGreeting && items.length === 0 ? (
        <View style={{ paddingBottom: 10 }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      <Composer value={input} onChangeText={setInput} onSend={send} disabled={!ready} streaming={streaming} />
    </KeyboardAvoidingView>
  );
}
