import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, Pressable, Share, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GatewayClient } from '@/api/gatewayClient';
import { getModelInfo, modelDisplayName } from '@/api/models';
import { withProfile } from '@/api/profiles';
import type { SessionCreateResult, SessionResumeResult } from '@/api/types';
import { setAttachHandler } from '@/attach-bus';
import { ApprovalCard } from '@/components/approval-card';
import { Composer } from '@/components/composer';
import { MessageRow, type ChatItem, type ToolInfo } from '@/components/message-row';
import { ThinkingDots } from '@/components/thinking-dots';
import { openGateway, withAuthRetry } from '@/connection';
import { getProfileState, hydrateProfileStore } from '@/profile-store';
import { openSidebar } from '@/sidebar-store';
import { parseApprovalRequest, resolvedCount, type ApprovalChoice } from '@/lib/approval';
import { exportAsJsonl, exportAsText } from '@/lib/export';
import { greetingForHour } from '@/lib/greeting';
import { historyToItems } from '@/lib/history';
import { MAX_ATTACH_BYTES, base64ByteLength, buildAttachParams, type PickedImage } from '@/lib/image-attach';
import { serif, useTheme } from '@/theme';

export { RouteError as ErrorBoundary } from '@/components/route-error';

const isIOS = process.env.EXPO_OS === 'ios';
const MAX_RECONNECT_ATTEMPTS = 5;

// Module-level so the pill shows instantly on later chat mounts; refreshed
// quietly on every mount (the picker can change it between visits).
let cachedModelName: string | null = null;

const hasLiquidGlass = isLiquidGlassAvailable();

/** Floating circular header button — the header bar itself is hidden.
 * Native liquid glass on iOS 26+, a solid surface circle elsewhere. */
function HeaderButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  const { colors, dark } = useTheme();

  if (hasLiquidGlass) {
    return (
      <GlassView isInteractive style={{ borderRadius: 23, overflow: 'hidden' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={4}
          onPress={onPress}
          style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}
        >
          <Image source={icon} style={{ width: 19.5, height: 19.5 }} tintColor={colors.text} />
        </Pressable>
      </GlassView>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.raised : colors.surface,
        boxShadow: dark ? '0 2px 10px rgba(0, 0, 0, 0.35)' : '0 2px 10px rgba(31, 30, 26, 0.10)',
      })}
    >
      <Image source={icon} style={{ width: 19.5, height: 19.5 }} tintColor={colors.text} />
    </Pressable>
  );
}

export default function ChatScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [stagedImage, setStagedImage] = useState<PickedImage | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [waiting, setWaiting] = useState(false); // sent, no tokens yet
  const [error, setError] = useState<string | null>(null);
  const [reconnectNote, setReconnectNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [modelName, setModelName] = useState<string | null>(cachedModelName);
  const gwRef = useRef<GatewayClient | null>(null);
  const liveIdRef = useRef<string | null>(null); // gateway (live) session handle
  const storedIdRef = useRef<string | null>(null); // persistent id, survives reconnects
  const cancelledRef = useRef(false);
  // Profile target captured at mount — keeps create/resume/history consistent
  // for this chat even if the user switches profiles elsewhere mid-session.
  const profileRef = useRef<string | null>(getProfileState().selected);
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
    const tid = String(payload?.tool_id ?? '');
    setItems((prev) => {
      let idx = prev.findIndex((it) => it.tool?.running && it.tool.id === tid);
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

  /** Append a pending approval card for a gateway `approval.request` event. */
  function appendApproval(payload: any) {
    const request = parseApprovalRequest(payload);
    if (!request) return; // nothing displayable; gateway will deny on timeout
    setItems((prev) => [
      ...prev,
      { key: nextKey(), role: 'approval', text: request.command, approval: { request, status: 'pending' } },
    ]);
  }

  /** Turn ended / interrupted / connection lost: the gateway force-denies
   * pending approvals, so drop any still-interactive cards. */
  function cancelPendingApprovals() {
    setItems((prev) => {
      if (!prev.some((it) => it.approval && it.approval.status !== 'approved' && it.approval.status !== 'denied' && it.approval.status !== 'cancelled')) {
        return prev;
      }
      return prev.map((it) =>
        it.approval && (it.approval.status === 'pending' || it.approval.status === 'answering')
          ? { ...it, approval: { ...it.approval, status: 'cancelled' as const } }
          : it,
      );
    });
  }

  /** Send the verified approval.respond RPC. Approvals are FIFO per session,
   * so only the oldest pending card is actionable and `key` is that card. */
  async function respondApproval(key: string, choice: ApprovalChoice) {
    const gw = gwRef.current;
    const sid = liveIdRef.current;
    if (!gw || !sid) return;
    setItems((prev) =>
      prev.map((it) =>
        it.key === key && it.approval?.status === 'pending'
          ? { ...it, approval: { ...it.approval, status: 'answering' as const } }
          : it,
      ),
    );
    try {
      const result = await gw.call('approval.respond', { session_id: sid, choice });
      // resolved=0 means nothing was pending server-side (stale/raced).
      const resolved = resolvedCount(result) > 0;
      const status = resolved ? (choice === 'deny' ? ('denied' as const) : ('approved' as const)) : ('cancelled' as const);
      setItems((prev) =>
        prev.map((it) => (it.key === key && it.approval ? { ...it, approval: { ...it.approval, status } } : it)),
      );
    } catch (e) {
      // Re-arm the card so the user can retry.
      setItems((prev) =>
        prev.map((it) =>
          it.key === key && it.approval?.status === 'answering'
            ? { ...it, approval: { ...it.approval, status: 'pending' as const } }
            : it,
        ),
      );
      setError(e instanceof Error ? e.message : 'approval response failed');
    }
  }

  async function loadHistory(storedId: string) {
    const history = await withAuthRetry((r) => r.getMessages(storedId, profileRef.current ?? undefined));
    if (cancelledRef.current) return;
    setItems(historyToItems(history.messages, nextKey));
  }

  function wireGateway(gw: GatewayClient) {
    gw.onEvent((e) => {
      switch (e.type) {
        case 'message.delta':
          appendDelta(e.payload?.text ?? '');
          break;
        case 'message.complete':
          finishAssistant();
          cancelPendingApprovals(); // gateway force-denies leftovers on turn end
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
        case 'approval.request':
          setWaiting(false);
          finishAssistant();
          if (isIOS) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          appendApproval(e.payload);
          break;
        case 'error':
          cancelPendingApprovals(); // gateway force-denies on interrupt/failure
          setStreaming(false);
          setWaiting(false);
          setError(e.payload?.message ?? 'agent error');
          break;
      }
    });
    gw.onClose(() => {
      if (cancelledRef.current) return;
      setReady(false);
      setStreaming(false);
      setWaiting(false);
      cancelPendingApprovals(); // can't answer across a dead socket
      void reconnect();
    });
  }

  /** Open the gateway (fresh single-use ticket) and re-attach the persistent
   * session, if there is one. */
  async function establish(): Promise<void> {
    const gw = await openGateway();
    if (cancelledRef.current) {
      gw.close();
      throw new Error('cancelled');
    }
    gwRef.current = gw;
    wireGateway(gw);
    if (storedIdRef.current) {
      const resumed = await gw.call<SessionResumeResult>(
        'session.resume',
        withProfile({ session_id: storedIdRef.current }, profileRef.current),
      );
      liveIdRef.current = resumed.session_id;
    }
  }

  async function reconnect(): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      if (cancelledRef.current) return;
      setReconnectNote(`Connection lost — reconnecting (${attempt}/${MAX_RECONNECT_ATTEMPTS})…`);
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 8000)));
      if (cancelledRef.current) return;
      try {
        await establish();
        // Resync from the store: anything streamed while offline never reached us.
        if (storedIdRef.current) await loadHistory(storedIdRef.current);
        if (cancelledRef.current) return;
        setReconnectNote(null);
        setError(null);
        setReady(true);
        return;
      } catch {
        // next attempt with longer backoff
      }
    }
    if (!cancelledRef.current) {
      setReconnectNote(null);
      setError('Could not reconnect. Check your VPN or Wi-Fi, then reopen this chat.');
    }
  }

  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      try {
        await hydrateProfileStore(); // no-op when sessions screen already ran
        profileRef.current = getProfileState().selected;
        if (id !== 'new') {
          storedIdRef.current = id;
          await loadHistory(id);
        }
        await establish();
        if (!cancelledRef.current) setReady(true);
      } catch {
        if (!cancelledRef.current) setError('Could not open a live session. Check your VPN or Wi-Fi.');
      }
    })();
    return () => {
      cancelledRef.current = true;
      gwRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Composer model pill — best-effort, never blocks the chat.
  useEffect(() => {
    let stale = false;
    withAuthRetry((r) => getModelInfo(r))
      .then((info) => {
        const name = modelDisplayName(info.model);
        cachedModelName = name;
        if (!stale) setModelName(name);
      })
      .catch(() => {
        // offline or older server — pill simply stays hidden
      });
    return () => {
      stale = true;
    };
  }, []);

  /** Photo picking — staged locally, uploaded via image.attach_bytes on send. */
  async function pickImage(source: 'camera' | 'library') {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setError('Camera access is off. Enable it in Settings to take photos.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        base64: true,
        quality: 0.7,
        exif: false,
      };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64) {
        setError('Could not read that image — try a different one.');
        return;
      }
      if (base64ByteLength(asset.base64) > MAX_ATTACH_BYTES) {
        setError('That image is over 25 MB — the gateway cannot accept it.');
        return;
      }
      setStagedImage({
        uri: asset.uri,
        base64: asset.base64,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the image picker.');
    }
  }

  // The add-to-chat sheet (its own formSheet route) fires camera/library
  // requests over the attach bus once it has dismissed itself.
  useEffect(() => setAttachHandler((action) => void pickImage(action)), []);

  /** Share the current conversation via the system share sheet. */
  async function shareExport(format: 'text' | 'jsonl') {
    try {
      const message = format === 'text' ? exportAsText(items) : exportAsJsonl(items);
      if (!message) return;
      await Share.share({ message });
    } catch {
      // user dismissed the share sheet or sharing is unavailable — not an error
    }
  }

  function showExportSheet() {
    if (items.length === 0) return;
    if (isIOS) {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Export conversation', options: ['Text', 'JSONL', 'Cancel'], cancelButtonIndex: 2 },
        (index) => {
          if (index === 0) void shareExport('text');
          else if (index === 1) void shareExport('jsonl');
        },
      );
    } else {
      Alert.alert('Export conversation', undefined, [
        { text: 'Text', onPress: () => void shareExport('text') },
        { text: 'JSONL', onPress: () => void shareExport('jsonl') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  async function send() {
    const text = input.trim();
    const image = stagedImage;
    const gw = gwRef.current;
    if ((!text && !image) || !gw || streaming) return;
    if (isIOS) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');
    setStagedImage(null);
    setError(null);
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        role: 'user',
        text,
        complete: true,
        ...(image
          ? { imageUri: image.uri, imageWidth: image.width, imageHeight: image.height }
          : {}),
      },
    ]);
    setStreaming(true);
    setWaiting(true);
    try {
      // Sessions are minted lazily on the first message so abandoned "new
      // chat" screens never create empty sessions server-side.
      if (!liveIdRef.current) {
        const created = await gw.call<SessionCreateResult>(
          'session.create',
          withProfile({}, profileRef.current),
        );
        liveIdRef.current = created.session_id;
        if (created.stored_session_id) storedIdRef.current = created.stored_session_id;
      }
      // prompt.submit has no image params — stage the photo server-side first;
      // the next submit drains the attached-images queue (docs/contracts/attachments.md).
      if (image) {
        await gw.call('image.attach_bytes', buildAttachParams(liveIdRef.current, image));
      }
      await gw.call('prompt.submit', { session_id: liveIdRef.current, text });
    } catch (e) {
      setStreaming(false);
      setWaiting(false);
      setError(e instanceof Error ? e.message : 'send failed');
    }
  }

  // Inverted list: index 0 renders at the visual bottom, so newest goes first.
  const reversedItems = useMemo(() => [...items].reverse(), [items]);

  // FIFO approvals: the oldest unresolved card is the only actionable one
  // (the server resolves the oldest pending approval on respond).
  const activeApprovalKey = items.find(
    (it) => it.approval?.status === 'pending' || it.approval?.status === 'answering',
  )?.key;

  const showGreeting = ready && items.length === 0 && !error;

  // Per-frame keyboard tracking (UI thread) — the composer rides the keyboard
  // instead of jumping when it appears. One continuous function: home-indicator
  // padding at rest, an 8pt gap above the keyboard once it's up.
  const keyboard = useAnimatedKeyboard();
  const containerStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(insets.bottom, 10, keyboard.height.value + 8),
  }));

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: colors.bg }, containerStyle]}>
      {showGreeting ? (
        <Animated.View
          entering={FadeIn.duration(350)}
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
            gap: 18,
            // Center between the floating header and the composer, not the
            // full screen — matches where the Claude app parks its greeting.
            paddingTop: insets.top + 52 + 32,
          }}
        >
          <Image
            // Pre-rasterized at 3× from the lobehub HermesAgent.Text SVG —
            // expo-image's SVG coder mangles its evenodd paths.
            source={require('../../../assets/images/hermesagent-text.png')}
            accessibilityLabel="Hermes Agent"
            contentFit="contain"
            tintColor={colors.text}
            // 52×24 lockup; size 56 matches HermesAgent.Text.
            style={{ height: 56, width: (56 * 52) / 24 }}
          />
          <Text style={{ fontFamily: serif, color: colors.text, fontSize: 30, textAlign: 'center' }}>
            {greetingForHour(new Date().getHours())}
          </Text>
          <Text style={{ color: colors.textFaint, fontSize: 14 }}>Messages run on your own gateway.</Text>
        </Animated.View>
      ) : (
        <FlatList
          data={reversedItems}
          inverted
          keyExtractor={(i) => i.key}
          keyboardDismissMode="interactive"
          // Inverted list: contentContainer paddingBottom is the visual top —
          // clearance for the floating header buttons.
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.top + 64,
          }}
          renderItem={({ item }) => (
            // Entering-only fade (exiting animations orphan views — see
            // sidebar-host). Streaming updates keep the key, so no re-runs.
            <Animated.View entering={FadeIn.duration(180)}>
              {item.approval ? (
                <ApprovalCard
                  approval={item.approval}
                  active={item.key === activeApprovalKey}
                  onRespond={(choice) => respondApproval(item.key, choice)}
                />
              ) : (
                <MessageRow item={item} />
              )}
            </Animated.View>
          )}
          ListHeaderComponent={
            waiting ? (
              <Animated.View entering={FadeIn.duration(200)}>
                <ThinkingDots />
              </Animated.View>
            ) : null
          }
        />
      )}

      {/* Top fade: keeps the status bar and floating buttons readable while
          messages scroll beneath. CSS gradient — no native module needed. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top + 78,
          // Fade to bg-at-zero-alpha (#RRGGBBAA), not `transparent` — black-alpha
          // interpolation leaves a gray smudge mid-fade.
          experimental_backgroundImage: `linear-gradient(to bottom, ${colors.bg} 0%, ${colors.bg} 35%, ${colors.bg}00 100%)`,
        }}
      />

      {/* Floating header — the native bar is hidden on chat routes. */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: insets.top + 6,
          left: 14,
          right: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <HeaderButton icon="sf:line.3.horizontal" label="Open menu" onPress={openSidebar} />
        <View style={{ flex: 1 }} />
        {items.length > 0 ? (
          <Animated.View entering={FadeIn.duration(200)}>
            <HeaderButton icon="sf:square.and.arrow.up" label="Export conversation" onPress={showExportSheet} />
          </Animated.View>
        ) : null}
        {id !== 'new' ? (
          <HeaderButton
            icon="sf:square.and.pencil"
            label="New chat"
            onPress={() => router.replace('/chat/new')}
          />
        ) : (
          <HeaderButton icon="sf:gearshape" label="Settings" onPress={() => router.push('/settings')} />
        )}
      </View>

      {reconnectNote ? (
        <Animated.Text
          entering={FadeIn.duration(200)}
          style={{ color: colors.textDim, fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 }}
        >
          {reconnectNote}
        </Animated.Text>
      ) : null}
      {error ? (
        <Animated.Text
          entering={FadeIn.duration(200)}
          selectable
          style={{ color: colors.danger, fontSize: 14, paddingHorizontal: 16, paddingBottom: 6 }}
        >
          {error}
        </Animated.Text>
      ) : null}
      {!ready && !error && !reconnectNote && !showGreeting && items.length === 0 ? (
        <View style={{ paddingBottom: 10 }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      <Composer
        value={input}
        onChangeText={setInput}
        onSend={send}
        disabled={!ready}
        streaming={streaming}
        stagedImageUri={stagedImage?.uri ?? null}
        onAttachPress={() => router.push('/attach')}
        onRemoveImage={() => setStagedImage(null)}
        modelName={modelName}
        onModelPress={() => router.push('/models')}
      />
    </Animated.View>
  );
}
