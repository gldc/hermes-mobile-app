import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { connectionInfo, disconnect } from '@/connection';
import { getPushStatus, type PushStatus } from '@/notifications';
import { useTheme } from '@/theme';

function pushLabel(s: PushStatus): string {
  switch (s.state) {
    case 'registered': return 'On';
    case 'denied': return 'Off';
    case 'no-project-id': return 'Not set up';
    case 'unavailable': return 'Unavailable';
    case 'error': return 'Retrying';
    default: return 'Off';
  }
}

export { RouteError as ErrorBoundary } from '@/components/route-error';

function NavRow({ icon, label, href }: { icon: string; label: string; href: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(href as any)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        minHeight: 52,
        backgroundColor: pressed ? colors.raised : 'transparent',
      })}
    >
      <Image source={icon} style={{ width: 20, height: 20 }} tintColor={colors.accent} />
      <Text style={{ color: colors.text, fontSize: 15.5, flex: 1 }}>{label}</Text>
      <Image source="sf:chevron.right" style={{ width: 13, height: 13 }} tintColor={colors.textFaint} />
    </Pressable>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, gap: 16 }}>
      <Text style={{ color: colors.textDim, fontSize: 15 }}>{label}</Text>
      <Text selectable numberOfLines={1} style={{ color: colors.text, fontSize: 15, flexShrink: 1 }}>
        {value}
      </Text>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        color: colors.textFaint,
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        paddingHorizontal: 4,
        marginBottom: -10,
      }}
    >
      {children}
    </Text>
  );
}

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

function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

type Info = Awaited<ReturnType<typeof connectionInfo>>;

export default function SettingsScreen() {
  const { colors } = useTheme();
  const [info, setInfo] = useState<Info>(null);
  // Snapshot of the in-memory push state (set by maybeRegisterPush at
  // connect/app-start time) — read once per open, not live.
  const [push] = useState<PushStatus>(() => getPushStatus());

  useEffect(() => {
    connectionInfo().then(setInfo);
  }, []);

  async function onDisconnect() {
    await disconnect();
    router.dismissAll();
    router.replace('/');
  }

  const deviceMode = info?.mode === 'device';

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 20, paddingTop: 28 }}
    >
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>Settings</Text>

      <SectionLabel>Connection</SectionLabel>
      <Card>
        <Row label="Gateway" value={info?.baseUrl ?? '—'} />
        {deviceMode ? (
          <>
            <Divider />
            <Row label="Device" value={info?.deviceId ?? '—'} />
            <Divider />
            <Row label="Notifications" value={pushLabel(push)} />
          </>
        ) : (
          <>
            <Divider />
            <Row label="User" value={info?.username || '—'} />
          </>
        )}
        <Divider />
        <Row label="Version" value={Constants.expoConfig?.version ?? 'dev'} />
      </Card>

      {deviceMode && push.note ? (
        <Text style={{ color: colors.textFaint, fontSize: 13, paddingHorizontal: 4, marginTop: -12 }}>
          {push.note}
        </Text>
      ) : null}

      <SectionLabel>Control</SectionLabel>
      <Card>
        <NavRow icon="sf:clock.arrow.circlepath" label="Cron Jobs" href="/cron" />
        <Divider />
        <NavRow icon="sf:brain" label="Memory" href="/memory" />
        <Divider />
        <NavRow icon="sf:sparkles" label="Skills" href="/skills" />
        <Divider />
        <NavRow icon="sf:cpu" label="Model" href="/models" />
      </Card>

      <SectionLabel>Danger</SectionLabel>
      <Pressable
        onPress={onDisconnect}
        style={({ pressed }) => ({
          backgroundColor: pressed ? colors.raised : colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 16,
          borderCurve: 'continuous',
          paddingVertical: 15,
          alignItems: 'center',
        })}
      >
        <Text style={{ color: colors.danger, fontSize: 16, fontWeight: '600' }}>Disconnect</Text>
      </Pressable>

      <Text style={{ color: colors.textFaint, fontSize: 12.5, textAlign: 'center' }}>
        Unofficial open-source client for hermes-agent.{'\n'}Talks only to your own gateway.
      </Text>
    </ScrollView>
  );
}
