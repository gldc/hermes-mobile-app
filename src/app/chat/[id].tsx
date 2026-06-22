import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Share, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GatewayClient } from '@/api/gatewayClient';
import { getModelInfo } from '@/api/models';
import { setSessionModelTarget } from '@/session-model-store';
import { switchSessionModel, type SwitchOutcome } from '@/api/sessionModel';
import {
  ModelPillState,
  emptyModelPill,
  withFallbackModel,
  withResumedModel,
  withSessionModel,
  pillLabel,
  pillModelId,
} from '@/lib/model-pill';
import { withProfile } from '@/api/profiles';
import type { GatewayEvent, SessionCreateResult, SessionResumeResult } from '@/api/types';
import { setAttachHandler } from '@/attach-bus';
import { ApprovalCard } from '@/components/approval-card';
import { Icon } from '@/components/icon';
import { Composer } from '@/components/composer';
import { MessageRow, type ChatItem, type ToolInfo } from '@/components/message-row';
import { SubagentMonitorCard } from '@/components/subagent-monitor-card';
import { ThinkingDots } from '@/components/thinking-dots';
import { TodoCard } from '@/components/todo-card';
import { openGateway, withAuthRetry } from '@/connection';
import { getProfileState, hydrateProfileStore } from '@/profile-store';
import { openSidebar } from '@/sidebar-store';
import { showActionSheet } from '@/lib/action-sheet';
import { parseApprovalRequest, resolvedCount, type ApprovalChoice } from '@/lib/approval';
import { exportAsJsonl, exportAsText } from '@/lib/export';
import { greetingForHour } from '@/lib/greeting';
import { historyToItems } from '@/lib/history';
import { MAX_ATTACH_BYTES, base64ByteLength, buildAttachParams, type PickedImage } from '@/lib/image-attach';
import { emptyBatch, finalizeBatch, reduceSubagentEvent } from '@/lib/subagent-progress';
import { parseTodoList } from '@/lib/todo';
import { serif, useTheme } from '@/theme';

export { RouteError as ErrorBoundary } from '@/components/route-error';

const MAX_RECONNECT_ATTEMPTS = 5;

// The gateway DEFAULT model id (from /api/model/info), cached module-level so
// the pill's fallback shows instantly on later chat mounts. Never a session
// model — each ChatScreen starts with session=null — so sharing it globally is
// safe; it only seeds the fallback slot, which pillLabel yields when no
// session model is known.
let cachedModelId: string | null = null;

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
          <Icon sf={icon} size={19.5} color={colors.text} />
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
      <Icon sf={icon} size={19.5} color={colors.text} />
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
  const [pill, setPill] = useState<ModelPillState>(() =>
    withFallbackModel(emptyModelPill(), cachedModelId),
  );
  const modelName = pillLabel(pill);
  const currentModelId = pillModelId(pill);
  const gwRef = useRef<GatewayClient | null>(null);
  const liveIdRef = useRef<string | null>(null); // gateway (live) session handle
  const storedIdRef = useRef<string | null>(null); // persistent id, survives reconnects
  const cancelledRef = useRef(false);
  // Profile target captured at mount — keeps create/resume/history consistent
  // for this chat even if the user switches profiles elsewhere mid-session.
  const profileRef = useRef<string | null>(getProfileState().selected);
  const keyCounter = useRef(0);
  const activeSubagentKeyRef = useRef<string | null>(null);
  const todoKeyRef = useRef<string | null>(null);

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

  /** Reduce a `subagent.*` event into the active batch item (create one if the
   * last batch finalized / none exists). */
  function handleSubagentEvent(e: GatewayEvent) {
    const ts = Date.now();
    setItems((prev) => {
      const k = activeSubagentKeyRef.current;
      const idx = k ? prev.findIndex((it) => it.key === k) : -1;
      if (idx >= 0 && prev[idx].subagent && !prev[idx].subagent!.finalized) {
        const next = [...prev];
        next[idx] = { ...prev[idx], subagent: reduceSubagentEvent(prev[idx].subagent!, e, ts) };
        return next;
      }
      const key = nextKey();
      activeSubagentKeyRef.current = key;
      return [...prev, { key, role: 'subagent', text: '', subagent: reduceSubagentEvent(emptyBatch(), e, ts) }];
    });
    if (e.type === 'subagent.complete') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }

  /** Turn ended / interrupted: stop any still-running subagents and seal the card. */
  function finalizeSubagents() {
    const k = activeSubagentKeyRef.current;
    if (!k) return;
    activeSubagentKeyRef.current = null;
    setItems((prev) => prev.map((it) => (it.key === k && it.subagent ? { ...it, subagent: finalizeBatch(it.subagent) } : it)));
  }

  /** Update (or create) the single todo card from a `todo` tool.complete.
   * Returns false when the payload carried no list (e.g. an internal tool_error),
   * so the caller can surface the failure instead of dropping it silently. */
  function upsertTodo(payload: any): boolean {
    const list = parseTodoList(payload);
    if (list === null) return false;
    setItems((prev) => {
      const k = todoKeyRef.current;
      const idx = k ? prev.findIndex((it) => it.key === k) : -1;
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...prev[idx], todo: list };
        return next;
      }
      const key = nextKey();
      todoKeyRef.current = key;
      return [...prev, { key, role: 'todo', text: '', todo: list }];
    });
    return true;
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
    // historyToItems never emits subagent/todo rows; clear stale live-card keys
    // so a reconnect/history replace can't update a row that no longer exists.
    activeSubagentKeyRef.current = null;
    todoKeyRef.current = null;
  }

  function wireGateway(gw: GatewayClient) {
    gw.onEvent((e) => {
      switch (e.type) {
        case 'message.delta':
          appendDelta(e.payload?.text ?? '');
          break;
        case 'message.complete':
          finishAssistant();
          finalizeSubagents();
          cancelPendingApprovals(); // gateway force-denies leftovers on turn end
          setStreaming(false);
          setWaiting(false);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        case 'tool.start':
          setWaiting(false);
          finishAssistant();
          if (e.payload?.name === 'todo') break; // todo renders as TodoCard on complete
          startTool(e.payload);
          break;
        case 'tool.complete':
          if (e.payload?.name === 'todo') {
            // A todo write returns the full list; if it carried none (rare
            // internal tool_error), surface it rather than dropping silently.
            if (!upsertTodo(e.payload)) append('status', 'Todo update failed');
            break;
          }
          completeTool(e.payload);
          break;
        case 'status.update':
          if (e.payload?.text) append('status', e.payload.text);
          break;
        case 'approval.request':
          setWaiting(false);
          finishAssistant();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          appendApproval(e.payload);
          break;
        case 'subagent.spawn_requested':
        case 'subagent.start':
        case 'subagent.thinking':
        case 'subagent.tool':
        case 'subagent.progress':
        case 'subagent.complete':
          handleSubagentEvent(e);
          break;
        case 'session.info':
          // The gateway pushes this when a session's model changes (e.g. an
          // in-chat /model switch). payload is the _session_info dict.
          if (e.payload?.model) setPill((p) => withSessionModel(p, e.payload.model));
          break;
        case 'error':
          cancelPendingApprovals(); // gateway force-denies on interrupt/failure
          finalizeSubagents();
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
      finalizeSubagents(); // socket drop mid-delegation: seal the card / stop the ticker
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
      // Only adopt a built (non-lazy) resume's model — a lazy reattach reports
      // the gateway default, and an info-less resume omits it; neither must
      // clobber the model we already know.
      setPill((p) => withResumedModel(p, resumed.info));
      // Best-effort: re-bind this device to the session (live id changes on
      // resume) so session-stop push hooks can target it. Never block the flow.
      void withAuthRetry((r) =>
        r.claimSession(liveIdRef.current!, storedIdRef.current ?? liveIdRef.current!),
      ).catch(() => {});
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
        cachedModelId = info.model;
        if (!stale) setPill((p) => withFallbackModel(p, info.model));
      })
      .catch(() => {
        // offline or older server — pill simply stays hidden
      });
    return () => {
      stale = true;
    };
  }, []);

  // Publish this chat's switch target so the /models picker (session mode) can
  // switch THIS chat over its live socket. The switchModel closure reads the
  // refs at call time, so it stays correct even if this object is stale.
  useEffect(() => {
    setSessionModelTarget({
      sessionId: liveIdRef.current ?? '',
      modelId: currentModelId,
      streaming,
      switchModel: (provider, model, confirmExpensive) => {
        const gw = gwRef.current;
        const sid = liveIdRef.current;
        if (!gw || !sid) {
          return Promise.resolve({ kind: 'error', message: 'Not connected.' } as SwitchOutcome);
        }
        return switchSessionModel(gw.call.bind(gw), { sessionId: sid, provider, model, confirmExpensive });
      },
    });
    return () => setSessionModelTarget(null);
  }, [currentModelId, streaming, ready]);

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
    showActionSheet('Export conversation', [
      { label: 'Text', onPress: () => void shareExport('text') },
      { label: 'JSONL', onPress: () => void shareExport('jsonl') },
    ]);
  }

  async function send() {
    const text = input.trim();
    const image = stagedImage;
    const gw = gwRef.current;
    if ((!text && !image) || !gw || streaming) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
        setPill((p) => withResumedModel(p, created.info));
        if (created.stored_session_id) storedIdRef.current = created.stored_session_id;
        // Best-effort: bind this device to the new session so session-stop push
        // hooks can target it. Never block the send flow on the claim.
        void withAuthRetry((r) =>
          r.claimSession(liveIdRef.current!, storedIdRef.current ?? liveIdRef.current!),
        ).catch(() => {});
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
  // Android (SDK 56) renders edge-to-edge; without the translucency flags
  // Reanimated reports keyboard heights offset by the system bar heights.
  // Both options are ignored on iOS.
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
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
          // 'interactive' is iOS-only; Android ignores it, so fall back to on-drag.
          keyboardDismissMode={process.env.EXPO_OS === 'ios' ? 'interactive' : 'on-drag'}
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
              ) : item.subagent ? (
                <SubagentMonitorCard batch={item.subagent} />
              ) : item.todo ? (
                <TodoCard items={item.todo} />
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
        <HeaderButton icon="line.3.horizontal" label="Open menu" onPress={openSidebar} />
        <View style={{ flex: 1 }} />
        {items.length > 0 ? (
          <Animated.View entering={FadeIn.duration(200)}>
            <HeaderButton icon="square.and.arrow.up" label="Export conversation" onPress={showExportSheet} />
          </Animated.View>
        ) : null}
        {id !== 'new' ? (
          <HeaderButton
            icon="square.and.pencil"
            label="New chat"
            onPress={() => router.replace('/chat/new')}
          />
        ) : (
          <HeaderButton icon="gearshape" label="Settings" onPress={() => router.push('/settings')} />
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
        onModelPress={() => router.push('/models?scope=session')}
      />
    </Animated.View>
  );
}
