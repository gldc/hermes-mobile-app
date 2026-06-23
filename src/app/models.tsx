// src/app/models.tsx
//
// Model switcher. Per docs/contracts/models.md: GET /api/model/info (current),
// GET /api/model/options (grouped picker w/ pricing + capability hints),
// POST /api/model/set scope=main. The set endpoint writes the backend
// process's own profile (the default profile) and applies to NEW sessions
// only — running chats keep their model.
import * as Haptics from 'expo-haptics';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import {
  capabilityBadges,
  formatContext,
  getModelInfo,
  getModelOptions,
  hintBadges,
  isModelUnavailable,
  modelDisplayName,
  pricingLine,
  setMainModel,
  type ModelInfo,
  type ModelOptionsResponse,
  type ProviderRow,
} from '@/api/models';
import { AuthError } from '@/api/restClient';
import { Icon } from '@/components/icon';
import { withAuthRetry } from '@/connection';
import { useTheme } from '@/theme';
import {
  getSessionModelTarget,
  subscribeSessionModelTarget,
  type SessionModelTarget,
} from '@/session-model-store';

export { RouteError as ErrorBoundary } from '@/components/route-error';

function Card({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function Separator() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 16 }} />;
}

function SectionTitle({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <Text style={{ color: colors.textDim, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 4 }}>
      {children}
    </Text>
  );
}

function Badge({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.raised,
        borderRadius: 6,
        borderCurve: 'continuous',
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color: colors.textDim, fontSize: 11, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

function CurrentModelCard({ info, current }: { info: ModelInfo | null; current: Selection | null }) {
  const { colors } = useTheme();
  const model = current?.model ?? info?.model ?? '';
  const provider = current?.provider ?? info?.provider ?? '';
  const badges = capabilityBadges(info?.capabilities);
  const context = formatContext(info?.effective_context_length ?? 0);
  const detail = [provider || null, context].filter(Boolean).join(' · ');
  return (
    <Card>
      <View
        accessibilityLabel={`Current model ${modelDisplayName(model)}${detail ? `, ${detail}` : ''}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, minHeight: 44 }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            borderCurve: 'continuous',
            backgroundColor: colors.raised,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon sf="cpu" size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16.5, fontWeight: '600' }}>
            {modelDisplayName(model)}
          </Text>
          {detail ? (
            <Text numberOfLines={1} style={{ color: colors.textDim, fontSize: 13 }}>
              {detail}
            </Text>
          ) : null}
          {badges.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 3 }}>
              {badges.map((b) => (
                <Badge key={b} label={b} />
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

function ModelRow({
  modelId,
  selected,
  disabled,
  unavailable,
  pricing,
  badges,
  onPress,
}: {
  modelId: string;
  selected: boolean;
  disabled: boolean;
  unavailable: boolean;
  pricing: string | null;
  badges: string[];
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const name = modelDisplayName(modelId);
  const hintParts = [unavailable ? 'Unavailable on your plan' : null, pricing, ...badges].filter(Boolean) as string[];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Switch to ${name}${hintParts.length ? `, ${hintParts.join(', ')}` : ''}`}
      accessibilityState={{ selected, disabled: disabled || unavailable }}
      disabled={disabled || unavailable}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        minHeight: 44,
        backgroundColor: pressed ? colors.raised : 'transparent',
        opacity: unavailable ? 0.4 : disabled && !selected ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15.5, fontWeight: selected ? '600' : '400' }}>
          {name}
        </Text>
        {name !== modelId ? (
          <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 12.5 }}>
            {modelId}
          </Text>
        ) : null}
        {hintParts.length > 0 ? (
          <Text numberOfLines={1} style={{ color: unavailable ? colors.textFaint : colors.textDim, fontSize: 12.5 }}>
            {hintParts.join('  ·  ')}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Icon sf="checkmark" size={17} color={colors.accent} />
      ) : null}
    </Pressable>
  );
}

function UnconfiguredRow({ row }: { row: ProviderRow }) {
  const { colors } = useTheme();
  const hint = row.warning || (row.key_env ? `Set ${row.key_env} on the gateway to enable.` : 'Not configured on the gateway.');
  return (
    <View
      accessibilityLabel={`${row.name}, not configured. ${hint}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 44 }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: colors.textDim, fontSize: 15.5 }}>{row.name}</Text>
        <Text numberOfLines={2} style={{ color: colors.textFaint, fontSize: 12.5 }}>
          {hint}
        </Text>
      </View>
      <Icon sf="key" size={15} color={colors.textFaint} />
    </View>
  );
}

interface Selection {
  provider: string;
  model: string;
}

export default function ModelsScreen() {
  const { colors } = useTheme();
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  const target = useSyncExternalStore(subscribeSessionModelTarget, getSessionModelTarget);
  // Session mode only when opened from a chat that actually has a live session.
  const sessionMode = scope === 'session' && !!target && target.sessionId.length > 0;
  const sessionModelId = sessionMode ? target!.modelId : null;
  const sessionStreaming = sessionMode && !!target!.streaming;
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [options, setOptions] = useState<ModelOptionsResponse | null>(null);
  const [current, setCurrent] = useState<Selection | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleError = useCallback((e: unknown, fallback: string) => {
    if (e instanceof AuthError) {
      router.replace('/');
      return;
    }
    setError(e instanceof Error && e.message ? e.message : fallback);
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [i, o] = await Promise.all([
        withAuthRetry((r) => getModelInfo(r)),
        withAuthRetry((r) => getModelOptions(r)),
      ]);
      setInfo(i);
      setOptions(o);
      setCurrent({ provider: o.provider || i.provider, model: o.model || i.model });
    } catch (e) {
      handleError(e, 'Gateway unreachable — check your VPN or Wi-Fi, then pull to retry.');
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [handleError]);

  useEffect(() => {
    load();
  }, [load]);

  async function applySwitch(provider: string, model: string, confirmExpensive: boolean, previous: Selection | null) {
    try {
      const res = await withAuthRetry((r) => setMainModel(r, provider, model, confirmExpensive));
      if (!res.ok && res.confirm_required) {
        Alert.alert('Expensive model', res.confirm_message || 'This model may be costly. Continue?', [
          { text: 'Cancel', style: 'cancel', onPress: () => setCurrent(previous) },
          { text: 'Switch anyway', style: 'destructive', onPress: () => applySwitch(provider, model, true, previous) },
        ]);
        return;
      }
      if (!res.ok) {
        setCurrent(previous);
        setError('The gateway did not accept the model switch.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (res.stale_aux && res.stale_aux.length > 0) {
        setNotice(
          `Switched. ${res.stale_aux.length} auxiliary task slot${res.stale_aux.length === 1 ? ' is' : 's are'} still pinned to another provider — manage them from the desktop app if needed.`,
        );
      } else {
        setNotice(null);
      }
      // Refresh the info card (context length / capabilities) in the background.
      withAuthRetry((r) => getModelInfo(r))
        .then(setInfo)
        .catch(() => {});
    } catch (e) {
      setCurrent(previous);
      handleError(e, `Could not switch to ${modelDisplayName(model)}.`);
    } finally {
      setBusy(false);
    }
  }

  function requestSwitch(provider: ProviderRow, modelId: string) {
    if (busy || !current) return;
    if (current.provider === provider.slug && current.model === modelId) return;
    Alert.alert(
      'Switch model?',
      `New chats will use ${modelDisplayName(modelId)} via ${provider.name}. Running chats keep their current model.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: () => {
            const previous = current;
            setBusy(true);
            setError(null);
            setNotice(null);
            setCurrent({ provider: provider.slug, model: modelId }); // optimistic
            applySwitch(provider.slug, modelId, false, previous);
          },
        },
      ],
    );
  }

  function requestSessionSwitch(provider: ProviderRow, modelId: string) {
    const t = target;
    if (busy || !t) return;
    if (t.streaming) {
      Alert.alert('Hermes is responding', 'Stop the current turn before switching this chat’s model.');
      return;
    }
    // Compare on the display name: session.info.model and /api/model/options
    // ids may differ in provider-namespacing, but their trailing segment matches.
    if (t.modelId && modelDisplayName(modelId) === modelDisplayName(t.modelId)) return;
    Alert.alert(
      'Switch this chat?',
      `This chat will use ${modelDisplayName(modelId)} via ${provider.name}. Other chats and new chats are unaffected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', onPress: () => void applySessionSwitch(t, provider.slug, modelId, false) },
      ],
    );
  }

  async function applySessionSwitch(
    t: SessionModelTarget,
    provider: string,
    model: string,
    confirmExpensive: boolean,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const outcome = await t.switchModel(provider, model, confirmExpensive);
    setBusy(false);
    switch (outcome.kind) {
      case 'ok':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back(); // back to the chat; the pill updates from session.info
        break;
      case 'confirm':
        Alert.alert('Expensive model', outcome.message, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Switch anyway',
            style: 'destructive',
            onPress: () => void applySessionSwitch(t, provider, model, true),
          },
        ]);
        break;
      case 'busy':
        Alert.alert('Hermes is responding', 'Stop the current turn before switching this chat’s model.');
        break;
      case 'error':
        setError(outcome.message || 'The gateway did not accept the model switch.');
        break;
    }
  }

  const configured = options?.providers.filter((p) => p.authenticated && p.models.length > 0) ?? [];
  const unconfigured = options?.providers.filter((p) => !p.authenticated) ?? [];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.textDim} />}
    >
      <Stack.Screen options={{ title: sessionMode ? 'Switch model' : 'Model' }} />

      {error ? (
        <Text selectable style={{ color: colors.danger, fontSize: 14 }}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text style={{ color: colors.success, fontSize: 13.5 }}>{notice}</Text>
      ) : null}

      {!loaded ? (
        <Text style={{ color: colors.textFaint, fontSize: 14, textAlign: 'center', paddingTop: 48 }}>Loading…</Text>
      ) : options || info ? (
        <>
          <SectionTitle>{sessionMode ? 'This chat' : 'Current'}</SectionTitle>
          <CurrentModelCard
            info={sessionMode ? null : info}
            current={sessionMode ? { provider: '', model: sessionModelId ?? '' } : current}
          />
          <Text style={{ color: colors.textFaint, fontSize: 12.5, marginHorizontal: 4 }}>
            {sessionMode
              ? 'Switches this chat only. New chats use the default (change it in Settings).'
              : 'Changes apply to new chats on the gateway’s default profile — running chats keep their model.'}
          </Text>
          {sessionStreaming ? (
            <Text style={{ color: colors.textDim, fontSize: 12.5, marginHorizontal: 4 }}>
              Hermes is responding — stop the current turn to switch this chat&apos;s model.
            </Text>
          ) : null}

          {configured.map((p) => (
            <View key={p.slug} style={{ gap: 12 }}>
              <View style={{ height: 8 }} />
              <SectionTitle>{p.free_tier ? `${p.name} (free tier)` : p.name}</SectionTitle>
              <Card>
                {p.models.map((m, idx) => (
                  <View key={m}>
                    {idx > 0 ? <Separator /> : null}
                    <ModelRow
                      modelId={m}
                      selected={
                        sessionMode
                          ? !!sessionModelId && modelDisplayName(m) === modelDisplayName(sessionModelId)
                          : current?.provider === p.slug && current?.model === m
                      }
                      disabled={busy || sessionStreaming}
                      unavailable={isModelUnavailable(p, m)}
                      pricing={pricingLine(p.pricing?.[m])}
                      badges={hintBadges(p.capabilities?.[m])}
                      onPress={() => (sessionMode ? requestSessionSwitch(p, m) : requestSwitch(p, m))}
                    />
                  </View>
                ))}
              </Card>
              {p.total_models > p.models.length ? (
                <Text style={{ color: colors.textFaint, fontSize: 12.5, marginHorizontal: 4 }}>
                  Showing {p.models.length} curated of {p.total_models} models.
                </Text>
              ) : null}
            </View>
          ))}

          {unconfigured.length > 0 ? (
            <>
              <View style={{ height: 8 }} />
              <SectionTitle>Not configured</SectionTitle>
              <Card>
                {unconfigured.map((p, idx) => (
                  <View key={p.slug}>
                    {idx > 0 ? <Separator /> : null}
                    <UnconfiguredRow row={p} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : !error ? (
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 96, paddingHorizontal: 32 }}>
          <Icon sf="cpu" size={44} color={colors.textFaint} />
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>Models unavailable</Text>
          <Text style={{ color: colors.textDim, fontSize: 14, textAlign: 'center' }}>
            The gateway did not return any model options. Pull to retry.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
