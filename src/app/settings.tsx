import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { connectionInfo, disconnect } from '@/connection';
import { useTheme } from '@/theme';

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

export default function SettingsScreen() {
  const { colors } = useTheme();
  const [info, setInfo] = useState<{ baseUrl: string; username: string } | null>(null);

  useEffect(() => {
    connectionInfo().then(setInfo);
  }, []);

  async function onDisconnect() {
    await disconnect();
    router.dismissAll();
    router.replace('/');
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 20, paddingTop: 28 }}
    >
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>Settings</Text>

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
        <Row label="Gateway" value={info?.baseUrl ?? '—'} />
        <View style={{ height: 1, backgroundColor: colors.border }} />
        <Row label="User" value={info?.username ?? '—'} />
        <View style={{ height: 1, backgroundColor: colors.border }} />
        <Row label="Version" value={Constants.expoConfig?.version ?? 'dev'} />
      </View>

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
        <NavRow icon="sf:clock.arrow.circlepath" label="Cron Jobs" href="/cron" />
        <View style={{ height: 1, backgroundColor: colors.border }} />
        <NavRow icon="sf:brain" label="Memory" href="/memory" />
      </View>

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
