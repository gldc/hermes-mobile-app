// src/app/skills/[name].tsx
//
// Skill detail. The gateway has no endpoint to read an installed skill's
// SKILL.md body (docs/contracts/skills.md — installed-content read NOT FOUND;
// /api/files/read is locked down for remote clients), so this renders the
// skill's frontmatter metadata — description (markdown), category, state —
// and offers the supported enable/disable toggle.
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { listSkills, toggleSkill, type SkillInfo } from '@/api/skills';
import { AuthError } from '@/api/restClient';
import { MarkdownView } from '@/components/markdown-view';
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

function MetaRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel={`${label}: ${value}`}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 16, minHeight: 44 }}
    >
      <Text style={{ color: colors.text, fontSize: 15.5 }}>{label}</Text>
      <Text style={{ color: colors.textDim, fontSize: 15 }}>{value}</Text>
    </View>
  );
}

export default function SkillDetailScreen() {
  const { colors } = useTheme();
  const { name } = useLocalSearchParams<{ name: string }>();
  const [skill, setSkill] = useState<SkillInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback((e: unknown, message: string) => {
    if (e instanceof AuthError) {
      router.replace('/');
      return;
    }
    setError(message);
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      // No GET /api/skills/{name} exists — fetch the list and pick our row.
      const skills = await withAuthRetry((r) => listSkills(r));
      setSkill(skills.find((s) => s.name === name) ?? null);
    } catch (e) {
      handleError(e, 'Gateway unreachable — check your VPN or Wi-Fi, then pull to retry.');
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [name, handleError]);

  useEffect(() => {
    load();
  }, [load]);

  /** Optimistic enable/disable — flip immediately, revert if the server says no. */
  async function toggle(current: SkillInfo) {
    if (busy) return;
    const enabling = !current.enabled;
    setBusy(true);
    setError(null);
    setSkill({ ...current, enabled: enabling });
    try {
      const res = await withAuthRetry((r) => toggleSkill(r, current.name, enabling));
      setSkill({ ...current, enabled: res.enabled });
    } catch (e) {
      setSkill(current); // revert
      handleError(e, `Couldn't ${enabling ? 'enable' : 'disable'} “${current.name}” — gateway unreachable.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.textDim} />}
    >
      <Stack.Screen options={{ title: typeof name === 'string' ? name : 'Skill' }} />

      {error ? (
        <Text selectable style={{ color: colors.danger, fontSize: 14 }}>
          {error}
        </Text>
      ) : null}

      {!loaded ? (
        <Text style={{ color: colors.textFaint, fontSize: 14, textAlign: 'center', paddingTop: 48 }}>Loading…</Text>
      ) : skill ? (
        <>
          <Card>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 16, minHeight: 44 }}
            >
              <Text style={{ color: colors.text, fontSize: 15.5 }}>Enabled</Text>
              <Switch
                value={skill.enabled}
                disabled={busy}
                onValueChange={() => toggle(skill)}
                accessibilityLabel={`${skill.name} ${skill.enabled ? 'enabled, double tap to disable' : 'disabled, double tap to enable'}`}
                trackColor={{ true: colors.accent }}
                hitSlop={8}
              />
            </View>
            {skill.category ? (
              <>
                <Separator />
                <MetaRow label="Category" value={skill.category} />
              </>
            ) : null}
          </Card>

          {skill.description ? (
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 16,
                borderCurve: 'continuous',
                borderWidth: 1,
                borderColor: colors.border,
                padding: 16,
              }}
            >
              <MarkdownView text={skill.description} />
            </View>
          ) : null}

          <Text style={{ color: colors.textFaint, fontSize: 12.5, marginHorizontal: 4 }}>
            The gateway exposes only a skill’s metadata over its API — to read the full SKILL.md,
            ask the agent in a chat or open it on the gateway.
          </Text>
        </>
      ) : !error ? (
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 96, paddingHorizontal: 32 }}>
          <Image source="sf:questionmark.circle" style={{ width: 44, height: 44 }} tintColor={colors.textFaint} />
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>Skill not found</Text>
          <Text style={{ color: colors.textDim, fontSize: 14, textAlign: 'center' }}>
            “{name}” is no longer installed on the gateway. Pull to refresh.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
