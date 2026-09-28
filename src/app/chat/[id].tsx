import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, Share, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createChatTransport, type ChatTransport } from '@/api/chat-transport';
import { makeNativeSocket, type GatewayClient } from '@/api/gatewayClient';
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
import type { GatewayEvent, GatewayEventMap } from '@/vendor/hermes-gateway';
import { setAttachHandler } from '@/attach-bus';
import { ApprovalCard, type ApprovalInfo } from '@/components/approval-card';
import { Icon } from '@/components/icon';
import { Composer } from '@/components/composer';
import { MessageRow, type ChatItem, type ToolInfo } from '@/components/message-row';
import { SubagentMonitorCard } from '@/components/subagent-monitor-card';
import { ThinkingDots } from '@/components/thinking-dots';
import { TodoCard } from '@/components/todo-card';
import { mintGatewayUrl, withAuthRetry } from '@/connection';
import { getProfileState, hydrateProfileStore } from '@/profile-store';
import { openSidebar } from '@/sidebar-store';
import { showActionSheet } from '@/lib/action-sheet';
import { parseApprovalRequest, resolvedCount, type ApprovalChoice } from '@/lib/approval';
import { exportAsJsonl, exportAsText } from '@/lib/export';
import { greetingForHour } from '@/lib/greeting';
import { historyToItems } from '@/lib/history';
import { MAX_ATTACH_BYTES, base64ByteLength, buildAttachParams, type PickedImage } from '@/lib/image-attach';
import type { ReconnectOrchestrator, ReconnectPhase } from '@/lib/reconnect-orchestrator';
import type { RequestRegistry } from '@/lib/request-registry';
import { shouldWarn } from '@/lib/request-router';
import { emptyBatch, finalizeBatch, reduceSubagentEvent } from '@/lib/subagent-progress';
import { parseTodoList } from '@/lib/todo';
import { shouldReconnect } from '@/lib/reconnect';
import {
  cancelLabel,
  completeStatus,
  initialTurnModel,
  mergeRequestRows,
  type RequestCardState,
  type TranscriptRow,
  type TurnAction,
  type TurnModel,
} from '@/lib/turn-controller';
import { serif, useTheme } from '@/theme';

export { RouteError as ErrorBoundary } from '@/components/route-error';

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

/** Copy for request cards this build cannot answer yet (plan B adds the real cards). */
const VAULT_NOTE = 'Hermes asked for a password-manager action — declined on the phone.';
const UNSUPPORTED_NOTE = 'Hermes is waiting for an answer this version can’t show yet.';

type Row = TranscriptRow<ChatItem>;

export default function ChatScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [stagedImage, setStagedImage] = useState<PickedImage | null>(null);
  const [thinking, setThinking] = useState(false); // sent / turn started, no tokens yet
  const [turn, setTurn] = useState<TurnModel>(initialTurnModel); // server-driven (spec §5.1)
  const [error, setError] = useState<string | null>(null);
  const [reconnectNote, setReconnectNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pill, setPill] = useState<ModelPillState>(() =>
    withFallbackModel(emptyModelPill(), cachedModelId),
  );
  const modelName = pillLabel(pill);
  const currentModelId = pillModelId(pill);
  const busy = turn.turn !== 'idle';
  // One transport per screen (spec §4.2): client + turn store + request router + reconnect
  // orchestrator, all handlers registered at construction, reused across reconnects.
  const transportRef = useRef<ChatTransport | null>(null);
  const registryRef = useRef<RequestRegistry | null>(null);
  const orchestratorRef = useRef<ReconnectOrchestrator | null>(null);
  const liveIdRef = useRef<string | null>(null); // gateway (live) session handle
  const storedIdRef = useRef<string | null>(null); // persistent id, survives reconnects
  const cancelledRef = useRef(false);
  // Profile target captured at mount — keeps create/resume/history consistent
  // for this chat even if the user switches profiles elsewhere mid-session.
  const profileRef = useRef<string | null>(getProfileState().selected);
  const keyCounter = useRef(0);
  const activeSubagentKeyRef = useRef<string | null>(null);
  const todoKeyRef = useRef<string | null>(null);
  const itemsRef = useRef<ChatItem[]>([]); // for request-card anchors (read off-render)
  // Latest render's handlers, read by the transport's long-lived callbacks.
  const handlersRef = useRef<{
    applyEvent: (e: GatewayEvent) => void;
    loadHistory: (storedId: string) => Promise<void>;
    onPhase: (p: ReconnectPhase) => void;
    onNewCard: (card: RequestCardState, replayed: boolean) => void;
  } | null>(null);

  const nextKey = () => `i${keyCounter.current++}`;
  // Names plan B builds on (contract R1).
  const gw = (): GatewayClient | null => transportRef.current?.client ?? null;
  const readTurn = (): TurnModel => transportRef.current?.store.getState() ?? initialTurnModel();
  const dispatchTurn = (a: TurnAction): void => transportRef.current?.store.dispatch(a);
  const resumeParams = () => withProfile({ session_id: storedIdRef.current ?? '' }, profileRef.current);

  function append(role: ChatItem['role'], text: string, complete = true) {
    setItems((prev) => [...prev, { key: nextKey(), role, text, complete }]);
  }

  /** Append streamed text to the trailing assistant message (create if absent). */
  function appendDelta(text: string) {
    setThinking(false);
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

  /** Reduce a `subagent.*` event into the active batch item (create one if the
   * last batch finalized / none exists). */
  function handleSubagentEvent(e: GatewayEvent) {
    const ts = Date.now();
    const sub = { type: e.type, payload: e.payload as Record<string, unknown> | undefined };
    setItems((prev) => {
      const k = activeSubagentKeyRef.current;
      const idx = k ? prev.findIndex((it) => it.key === k) : -1;
      if (idx >= 0 && prev[idx].subagent && !prev[idx].subagent!.finalized) {
        const next = [...prev];
        next[idx] = { ...prev[idx], subagent: reduceSubagentEvent(prev[idx].subagent!, sub, ts) };
        return next;
      }
      const key = nextKey();
      activeSubagentKeyRef.current = key;
      return [...prev, { key, role: 'subagent', text: '', subagent: reduceSubagentEvent(emptyBatch(), sub, ts) }];
    });
    if (e.type === 'subagent.complete' && !e.replayed) {
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

  /** Answer an approval card. 0.21.5: the response frame for THIS request id, marked answered
   * optimistically (no ack exists — review M10). 0.20.4 legacy: approval.respond, which resolves
   * the OLDEST pending approval (FIFO), so only the oldest legacy card is actionable. */
  async function respondApproval(card: RequestCardState, choice: ApprovalChoice) {
    const client = gw();
    if (!client) return;
    if (!card.legacy) {
      const sent = registryRef.current?.respond(card.id, { choice }) ?? false;
      dispatchTurn(
        sent
          ? { type: 'request.answered', id: card.id, resolution: choice }
          : { type: 'request.cancelled', id: card.id, reason: 'resolved' },
      );
      return;
    }
    const sid = liveIdRef.current;
    if (!sid) return;
    dispatchTurn({ type: 'request.answering', id: card.id });
    try {
      const result = await client.call('approval.respond', { session_id: sid, choice });
      // resolved=0 means nothing was pending server-side (stale/raced).
      dispatchTurn(
        resolvedCount(result) > 0
          ? { type: 'request.answered', id: card.id, resolution: choice }
          : { type: 'request.cancelled', id: card.id, reason: 'resolved' },
      );
    } catch (e) {
      dispatchTurn({ type: 'request.failed', id: card.id }); // re-arm so the user can retry
      setError(e instanceof Error ? e.message : 'approval response failed');
    }
  }

  async function loadHistory(storedId: string) {
    const history = await withAuthRetry((r) => r.getMessages(storedId, profileRef.current ?? undefined));
    if (cancelledRef.current) return;
    setItems(historyToItems(history.messages, nextKey));
    // historyToItems never emits subagent/todo rows; clear stale live-card keys
    // so a reconnect/history replace can't update a row that no longer exists.
    // Request cards live in the turn store, NOT in items, so they survive this replace.
    activeSubagentKeyRef.current = null;
    todoKeyRef.current = null;
  }

  function onPhase(p: ReconnectPhase) {
    if (cancelledRef.current) return;
    if (p.kind === 'attempt') {
      setReady(false);
      if (p.attempt === 1) finalizeSubagents(); // socket drop mid-delegation: seal the card
      setReconnectNote(`Connection lost — reconnecting (${p.attempt}/${p.max})…`);
    } else if (p.kind === 'ready') {
      // A turn that finished while the socket was down never delivers message.complete
      // (resume reports running:false, replay is skipped) — drop the stale thinking flag.
      if (readTurn().turn === 'idle') setThinking(false);
      setReconnectNote(null);
      setError(null);
      setReady(true);
    } else {
      setReconnectNote(null);
      setError('Could not reconnect. Check your VPN or Wi-Fi, then reopen this chat.');
    }
  }

  /** A request card appeared (live or replayed): close the streaming segment so later text
   * renders after the card; warn only for live arrivals (replays never fire haptics). */
  function onNewCard(card: RequestCardState, replayed: boolean) {
    setThinking(false);
    finishAssistant();
    // Live arrivals only, and not vault prompts — those are declined on arrival (spec §6.3),
    // so there is nothing to answer and no "needs you" haptic.
    if (shouldWarn(card, replayed)) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  }

  /** Transcript side of every gateway event (live and replayed). The transport has already
   * updated the turn store (message.start/complete/error) and consumed request events. */
  function applyEvent(e: GatewayEvent) {
    const live = !e.replayed;
    switch (e.type) {
      case 'message.start':
        setThinking(true);
        break;
      case 'message.delta':
        appendDelta((e.payload as GatewayEventMap['message.delta'] | undefined)?.text ?? '');
        break;
      case 'message.complete': {
        const p = e.payload as GatewayEventMap['message.complete'] | undefined;
        const status = completeStatus(p);
        setThinking(false);
        finishAssistant();
        finalizeSubagents();
        if (status === 'interrupted') append('status', 'Stopped');
        else if (status === 'error') setError(p?.error || 'The turn failed.');
        else if (live) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        break;
      }
      case 'tool.start': {
        const p = e.payload as GatewayEventMap['tool.start'] | undefined;
        setThinking(false);
        finishAssistant();
        if (p?.name === 'todo') break; // todo renders as TodoCard on complete
        startTool(p);
        break;
      }
      case 'tool.complete': {
        const p = e.payload as GatewayEventMap['tool.complete'] | undefined;
        if (p?.name === 'todo') {
          if (!upsertTodo(p)) append('status', 'Todo update failed');
          break;
        }
        completeTool(p);
        break;
      }
      case 'status.update': {
        const p = e.payload as GatewayEventMap['status.update'] | undefined;
        if (p?.text) append('status', p.text);
        break;
      }
      case 'subagent.spawn_requested':
      case 'subagent.start':
      case 'subagent.thinking':
      case 'subagent.tool':
      case 'subagent.progress':
      case 'subagent.complete':
        handleSubagentEvent(e);
        break;
      case 'session.info': {
        const p = e.payload as GatewayEventMap['session.info'] | undefined;
        if (p?.model) {
          const m = p.model;
          setPill((prev) => withSessionModel(prev, m));
        }
        break;
      }
      case 'error': {
        // "Outside a turn" at 0.21.5: ends the turn only while waiting (the store already
        // decided); in streaming it is an inline notice and the turn continues (review M6).
        const p = e.payload as GatewayEventMap['error'] | undefined;
        setThinking(false);
        if (readTurn().turn === 'idle') finalizeSubagents();
        setError(p?.message ?? 'agent error');
        break;
      }
    }
  }

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Keep the transport's long-lived callbacks pointed at this render's closures.
  // Declared BEFORE the mount effect so it runs first.
  useEffect(() => {
    handlersRef.current = { applyEvent, loadHistory, onPhase, onNewCard };
  });

  useEffect(() => {
    cancelledRef.current = false;
    const t = createChatTransport({
      socketFactory: makeNativeSocket,
      mintUrl: mintGatewayUrl,
      storedSessionId: () => storedIdRef.current,
      resumeParams: () => resumeParams(),
      loadHistory: (sid) => handlersRef.current!.loadHistory(sid),
      onLiveSessionId: (liveId) => {
        liveIdRef.current = liveId;
        // Best-effort: re-bind this device to the session (live id changes on
        // resume) so session-stop push hooks can target it. Never block the flow.
        void withAuthRetry((r) => r.claimSession(liveId, storedIdRef.current ?? liveId)).catch(() => {});
      },
      // Only adopt a built (non-lazy) resume's model — a lazy reattach reports the gateway
      // default, and an info-less resume omits it; neither may clobber the known model.
      onResumed: (res) => setPill((p) => withResumedModel(p, res.info)),
      onPhase: (p) => handlersRef.current?.onPhase(p),
      applyEvent: (e) => handlersRef.current?.applyEvent(e),
      anchorKey: () => itemsRef.current[itemsRef.current.length - 1]?.key ?? null,
      onNewCard: (card, replayed) => handlersRef.current?.onNewCard(card, replayed),
    });
    transportRef.current = t;
    registryRef.current = t.registry;
    orchestratorRef.current = t.orchestrator;
    setTurn(t.store.getState());
    const unsubStore = t.store.subscribe(() => setTurn(t.store.getState()));
    (async () => {
      try {
        await hydrateProfileStore(); // no-op when sessions screen already ran
        profileRef.current = getProfileState().selected;
        if (id !== 'new') {
          storedIdRef.current = id;
          await handlersRef.current!.loadHistory(id); // fast first paint, before the socket
        }
        await t.orchestrator.start(); // connect → resume → history (spec §7)
      } catch {
        if (!cancelledRef.current) setError('Could not open a live session. Check your VPN or Wi-Fi.');
      }
    })();
    // Foreground revival: iOS suspends the runtime and the OS tears the socket
    // down without a close event. On return, if the socket is not OPEN, run the
    // single-flight reconnect (it joins a heartbeat/close-triggered run).
    const sub = AppState.addEventListener('change', (next) => {
      if (cancelledRef.current) return;
      if (shouldReconnect({ hasSocket: true, isOpen: t.client.isOpen, appState: next })) {
        void t.orchestrator.reconnect('foreground');
      }
    });
    return () => {
      cancelledRef.current = true;
      sub.remove();
      unsubStore();
      t.dispose(); // orchestrator first, then the socket — no reconnect on unmount
      if (transportRef.current === t) {
        transportRef.current = null;
        registryRef.current = null;
        orchestratorRef.current = null;
      }
    };
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
  // switch THIS chat over its live socket. Re-keyed on `id` so navigating
  // between chats clears the prior target and republishes for the active one;
  // the switchModel closure also reads the refs at call time, so the switch
  // always lands on the live session even within a re-establish window.
  useEffect(() => {
    setSessionModelTarget({
      sessionId: liveIdRef.current ?? '',
      modelId: currentModelId,
      streaming: busy,
      switchModel: (provider, model, confirmExpensive) => {
        const t = transportRef.current;
        const sid = liveIdRef.current;
        if (!t || !sid) {
          return Promise.resolve({ kind: 'error', message: 'Not connected.' } as SwitchOutcome);
        }
        return switchSessionModel(t.client.call.bind(t.client), {
          sessionId: sid,
          provider,
          model,
          confirmExpensive,
          resumeSession: () => t.resumeStored(), // 4001 → resume + retry once
        });
      },
    });
    return () => setSessionModelTarget(null);
  }, [id, currentModelId, busy, ready]);

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
    const t = transportRef.current;
    // Server-driven turn state: sending is only possible from idle (plan B adds steer).
    if ((!text && !image) || !t || !t.client.isOpen || readTurn().turn !== 'idle') return;
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
    dispatchTurn({ type: 'submit.sent' });
    setThinking(true);
    try {
      // Sessions are minted lazily on the first message so abandoned "new
      // chat" screens never create empty sessions server-side.
      if (!liveIdRef.current) {
        const created = await t.client.call('session.create', withProfile({}, profileRef.current));
        liveIdRef.current = created.session_id;
        setPill((p) => withResumedModel(p, created.info));
        if (created.stored_session_id) storedIdRef.current = created.stored_session_id;
        // Best-effort: bind this device to the new session so session-stop push
        // hooks can target it. Never block the send flow on the claim.
        const liveId = created.session_id;
        void withAuthRetry((r) => r.claimSession(liveId, storedIdRef.current ?? liveId)).catch(() => {});
      }
      const sid = liveIdRef.current;
      // prompt.submit has no image params — stage the photo server-side first;
      // the next submit drains the attached-images queue (docs/contracts/attachments.md).
      if (image) await t.client.call('image.attach_bytes', buildAttachParams(sid, image));
      // queued:true — never redirects or interrupts a busy session, even if our view of
      // the turn state is stale (dc1-1 runs busy_input_mode: interrupt; spec §5.1).
      await t.client.call('prompt.submit', { session_id: sid, text, queued: true });
    } catch (e) {
      dispatchTurn({ type: 'event.error', replayed: false }); // waiting → idle
      setThinking(false);
      setError(e instanceof Error ? e.message : 'send failed');
    }
  }

  // Request cards live in the turn store (outside items) and merge in after their anchor.
  const rows = useMemo(() => mergeRequestRows(items, turn.requests), [items, turn.requests]);
  // Inverted list: index 0 renders at the visual bottom, so newest goes first.
  const reversedRows = useMemo(() => [...rows].reverse(), [rows]);

  // Legacy (0.20.4) approvals are FIFO: only the oldest open legacy card is actionable.
  // 0.21.5 approvals resolve per request id, so every pending one is actionable.
  const activeLegacyId = turn.requests.find(
    (r) => r.legacy && (r.status === 'pending' || r.status === 'answering'),
  )?.id;

  function approvalInfo(card: RequestCardState): ApprovalInfo | null {
    const request = parseApprovalRequest(card.params);
    if (!request) return null;
    const status =
      card.status === 'pending' || card.status === 'answering'
        ? card.status
        : card.status === 'answered'
          ? card.resolution === 'deny'
            ? ('denied' as const)
            : ('approved' as const)
          : ('cancelled' as const);
    return { request, status };
  }

  function renderRequest(card: RequestCardState) {
    if (card.kind === 'approval') {
      const approval = approvalInfo(card);
      if (!approval) return null;
      return (
        <ApprovalCard
          approval={approval}
          active={card.legacy ? card.id === activeLegacyId : card.status === 'pending'}
          onRespond={(choice) => void respondApproval(card, choice)}
        />
      );
    }
    const text =
      card.kind === 'vault-declined'
        ? VAULT_NOTE
        : card.status === 'cancelled' && card.cancelReason
          ? `${UNSUPPORTED_NOTE} (${cancelLabel(card.cancelReason)})`
          : UNSUPPORTED_NOTE;
    return <MessageRow item={{ key: `req:${card.id}`, role: 'status', text }} />;
  }

  const showGreeting = ready && items.length === 0 && turn.requests.length === 0 && !error;

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
          data={reversedRows}
          inverted
          keyExtractor={(r: Row) => (r.kind === 'item' ? r.item.key : `req:${r.card.id}`)}
          // 'interactive' is iOS-only; Android ignores it, so fall back to on-drag.
          keyboardDismissMode={process.env.EXPO_OS === 'ios' ? 'interactive' : 'on-drag'}
          // Inverted list: contentContainer paddingBottom is the visual top —
          // clearance for the floating header buttons.
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.top + 64,
          }}
          renderItem={({ item: row }) => (
            // Entering-only fade (exiting animations orphan views — see
            // sidebar-host). Streaming updates keep the key, so no re-runs.
            <Animated.View entering={FadeIn.duration(180)}>
              {row.kind === 'request' ? (
                renderRequest(row.card)
              ) : row.item.subagent ? (
                <SubagentMonitorCard batch={row.item.subagent} />
              ) : row.item.todo ? (
                <TodoCard items={row.item.todo} />
              ) : (
                <MessageRow item={row.item} />
              )}
            </Animated.View>
          )}
          ListHeaderComponent={
            // Server-driven turn state is the authority: never show dots on an idle turn.
            thinking && busy ? (
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
        streaming={busy}
        stagedImageUri={stagedImage?.uri ?? null}
        onAttachPress={() => router.push('/attach')}
        onRemoveImage={() => setStagedImage(null)}
        modelName={modelName}
        onModelPress={() => router.push('/models?scope=session')}
      />
    </Animated.View>
  );
}
