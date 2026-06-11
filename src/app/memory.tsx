// src/app/memory.tsx
//
// Memory admin screen. Per docs/contracts/memory.md the gateway exposes no
// per-entry memory CRUD — only status, provider selection, and reset. So this
// screen manages the backend and the two built-in files; browsing/editing
// individual entries happens through the agent itself in a conversation.
import { Image } from 'expo-image';
import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import {
  BUILT_IN_PROVIDER,
  formatBytes,
  getMemoryStatus,
  providerLabel,
  resetMemory,
  setMemoryProvider,
  type MemoryResetTarget,
  type MemoryStatus,
} from '@/api/memory';
import { AuthError } from '@/api/restClient';
import { withAuthRetry } from '@/connection';
import { useTheme } from '@/theme';

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

function ProviderRow({
  label,
  description,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  description?: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Use ${label} memory backend`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        minHeight: 44,
        backgroundColor: pressed ? colors.raised : 'transparent',
        opacity: disabled && !selected ? 0.5 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: colors.text, fontSize: 15.5, fontWeight: selected ? '600' : '400' }}>{label}</Text>
        {description ? (
          <Text numberOfLines={2} style={{ color: colors.textFaint, fontSize: 13 }}>
            {description}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Image source="sf:checkmark" style={{ width: 17, height: 17 }} tintColor={colors.accent} />
      ) : null}
    </Pressable>
  );
}

function FileRow({ label, file, size }: { label: string; file: string; size: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel={`${label}, ${formatBytes(size)}`}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 16, minHeight: 44 }}
    >
      <View style={{ gap: 3, flexShrink: 1 }}>
        <Text style={{ color: colors.text, fontSize: 15.5 }}>{label}</Text>
        <Text style={{ color: colors.textFaint, fontSize: 13 }}>{file}</Text>
      </View>
      <Text style={{ color: size > 0 ? colors.textDim : colors.textFaint, fontSize: 15 }}>{formatBytes(size)}</Text>
    </View>
  );
}

function DangerRow({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        padding: 16,
        minHeight: 44,
        justifyContent: 'center',
        backgroundColor: pressed ? colors.raised : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={{ color: colors.danger, fontSize: 15.5, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

const RESET_LABELS: Record<MemoryResetTarget, { action: string; detail: string }> = {
  memory: { action: 'Reset agent memory', detail: 'This permanently deletes MEMORY.md on the gateway.' },
  user: { action: 'Reset user profile', detail: 'This permanently deletes USER.md on the gateway.' },
  all: { action: 'Reset all memory', detail: 'This permanently deletes MEMORY.md and USER.md on the gateway.' },
};

export default function MemoryScreen() {
  const { colors } = useTheme();
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setStatus(await withAuthRetry((r) => getMemoryStatus(r)));
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

  async function selectProvider(provider: string) {
    if (!status || busy || provider === status.active) return;
    setBusy(true);
    setError(null);
    try {
      const res = await withAuthRetry((r) => setMemoryProvider(r, provider));
      setStatus({ ...status, active: res.active });
    } catch (e) {
      handleError(e, `Could not switch to ${providerLabel(provider)}.`);
    } finally {
      setBusy(false);
    }
  }

  function confirmReset(target: MemoryResetTarget) {
    const { action, detail } = RESET_LABELS[target];
    Alert.alert(`${action}?`, `${detail} This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => doReset(target) },
    ]);
  }

  async function doReset(target: MemoryResetTarget) {
    setBusy(true);
    setError(null);
    try {
      await withAuthRetry((r) => resetMemory(r, target));
      setStatus(await withAuthRetry((r) => getMemoryStatus(r)));
    } catch (e) {
      handleError(e, 'Reset failed — the gateway did not accept the request.');
    } finally {
      setBusy(false);
    }
  }

  const builtinActive = status?.active === BUILT_IN_PROVIDER;
  const builtinEmpty =
    status != null && status.builtin_files.memory === 0 && status.builtin_files.user === 0;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.textDim} />}
    >
      <Stack.Screen options={{ title: 'Memory' }} />

      {error ? (
        <Text selectable style={{ color: colors.danger, fontSize: 14 }}>
          {error}
        </Text>
      ) : null}

      {!loaded ? (
        <Text style={{ color: colors.textFaint, fontSize: 14, textAlign: 'center', paddingTop: 48 }}>Loading…</Text>
      ) : status ? (
        <>
          <SectionTitle>Backend</SectionTitle>
          <Card>
            <ProviderRow
              label="Built-in files"
              description="Markdown files in the gateway's memories folder."
              selected={builtinActive}
              disabled={busy}
              onPress={() => selectProvider(BUILT_IN_PROVIDER)}
            />
            {status.providers.map((p) => (
              <View key={p.name}>
                <Separator />
                <ProviderRow
                  label={providerLabel(p.name)}
                  description={p.configured ? p.description : `${p.description} (not configured)`.trim()}
                  selected={status.active === p.name}
                  disabled={busy}
                  onPress={() => selectProvider(p.name)}
                />
              </View>
            ))}
          </Card>

          <View style={{ height: 8 }} />
          <SectionTitle>Built-in files</SectionTitle>
          <Card>
            <FileRow label="Agent memory" file="MEMORY.md" size={status.builtin_files.memory} />
            <Separator />
            <FileRow label="User profile" file="USER.md" size={status.builtin_files.user} />
          </Card>
          <Text style={{ color: colors.textFaint, fontSize: 12.5, marginHorizontal: 4 }}>
            {builtinEmpty
              ? 'Memory is empty — the agent fills it in as you chat.'
              : 'The gateway has no API to browse or edit individual entries — ask the agent in a chat to show or update its memory.'}
          </Text>

          <View style={{ height: 8 }} />
          <SectionTitle>Danger zone</SectionTitle>
          <Card>
            <DangerRow label="Reset agent memory…" disabled={busy} onPress={() => confirmReset('memory')} />
            <Separator />
            <DangerRow label="Reset user profile…" disabled={busy} onPress={() => confirmReset('user')} />
            <Separator />
            <DangerRow label="Reset all memory…" disabled={busy} onPress={() => confirmReset('all')} />
          </Card>
        </>
      ) : !error ? (
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 96, paddingHorizontal: 32 }}>
          <Image source="sf:brain" style={{ width: 44, height: 44 }} tintColor={colors.textFaint} />
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>Memory unavailable</Text>
          <Text style={{ color: colors.textDim, fontSize: 14, textAlign: 'center' }}>
            The gateway did not return a memory status. Pull to retry.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
