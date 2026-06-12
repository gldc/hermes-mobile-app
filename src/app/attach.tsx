import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { getModelInfo, modelDisplayName } from '@/api/models';
import { requestAttach, type AttachAction } from '@/attach-bus';
import { withAuthRetry } from '@/connection';
import { showProfilePicker } from '@/lib/profile-picker';
import { activeProfileLabel, getProfileState, subscribeProfiles } from '@/profile-store';
import { useTheme } from '@/theme';

export { RouteError as ErrorBoundary } from '@/components/route-error';

/** Give the sheet time to dismiss before presenting a system picker or
 * pushing a screen — overlapping presentations get cancelled by iOS. */
const DISMISS_MS = 420;

function Tile({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 92,
        borderRadius: 18,
        borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: pressed ? colors.userBubble : colors.raised,
      })}
    >
      <Image source={icon} style={{ width: 26, height: 26 }} tintColor={colors.text} />
      <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

function Row({
  icon,
  label,
  value,
  last,
  onPress,
}: {
  icon: string;
  label: string;
  value?: string | null;
  last?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.raised : 'transparent' })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 16, height: 52 }}>
        <Image source={icon} style={{ width: 20, height: 20 }} tintColor={colors.text} />
        <Text style={{ flex: 1, color: colors.text, fontSize: 16.5 }}>{label}</Text>
        {value ? (
          <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 15.5, maxWidth: 150 }}>
            {value}
          </Text>
        ) : null}
        <Image source="sf:chevron.right" style={{ width: 12, height: 12 }} tintColor={colors.textFaint} />
      </View>
      {!last ? <View style={{ height: 1, marginLeft: 49, backgroundColor: colors.border }} /> : null}
    </Pressable>
  );
}

/** Add-to-chat sheet, in the style of the Claude app: photo sources up top,
 * then the chat's knobs (model, profile) and hermes destinations. */
export default function AttachSheet() {
  const { colors } = useTheme();
  const profiles = useSyncExternalStore(subscribeProfiles, getProfileState);
  const [modelName, setModelName] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    withAuthRetry((r) => getModelInfo(r))
      .then((info) => {
        if (!stale) setModelName(modelDisplayName(info.model));
      })
      .catch(() => {
        // offline — row just shows no value
      });
    return () => {
      stale = true;
    };
  }, []);

  const attach = (action: AttachAction) => {
    router.back();
    setTimeout(() => requestAttach(action), DISMISS_MS);
  };

  const go = (push: () => void) => {
    router.back();
    setTimeout(push, DISMISS_MS);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header: close + centered title */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          onPress={() => router.back()}
          style={({ pressed }) => ({
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? colors.raised : colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          })}
        >
          <Image source="sf:xmark" style={{ width: 13, height: 13 }} tintColor={colors.text} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '600' }}>
          Add to chat
        </Text>
        {/* Spacer balancing the close button so the title stays centered. */}
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, gap: 14 }} alwaysBounceVertical={false}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Tile icon="sf:camera.fill" label="Camera" onPress={() => attach('camera')} />
          <Tile icon="sf:photo.on.rectangle" label="Photos" onPress={() => attach('library')} />
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
          <Row
            icon="sf:cpu"
            label="Model"
            value={modelName}
            onPress={() => go(() => router.push('/models'))}
          />
          <Row
            icon="sf:person.crop.circle"
            label="Profile"
            value={activeProfileLabel(profiles)}
            last
            onPress={profiles.names.length > 1 ? showProfilePicker : () => go(() => router.push('/settings'))}
          />
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
          <Row
            icon="sf:calendar.badge.plus"
            label="Schedule a task"
            onPress={() => go(() => router.push('/cron-edit'))}
          />
          <Row icon="sf:sparkles" label="Skills" onPress={() => go(() => router.push('/skills'))} />
          <Row
            icon="sf:books.vertical"
            label="Memory"
            last
            onPress={() => go(() => router.push('/memory'))}
          />
        </View>
      </ScrollView>
    </View>
  );
}
