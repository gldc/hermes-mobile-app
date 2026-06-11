import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { SessionSummary } from '@/api/types';
import { timeAgo } from '@/lib/format';
import { useTheme } from '@/theme';

const ACTION_WIDTH = 74;

function SwipeAction({
  icon,
  label,
  background,
  tint,
  accessibilityLabel,
  onPress,
}: {
  icon: string;
  label: string;
  background: string;
  tint: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        width: ACTION_WIDTH,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Image source={icon} style={{ width: 20, height: 20 }} tintColor={tint} />
      <Text style={{ color: tint, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export const SessionRow = memo(function SessionRow({
  session,
  onPress,
  onRename,
  onDelete,
}: {
  session: SessionSummary;
  onPress: () => void;
  /** When provided, swiping left reveals a Rename action. */
  onRename?: () => void;
  /** When provided, swiping left reveals a destructive Delete action. */
  onDelete?: () => void;
}) {
  const { colors } = useTheme();
  const title = session.title?.trim() || session.preview?.trim() || 'Untitled conversation';
  const preview = session.title?.trim() ? session.preview?.trim() : undefined;
  const swipeable = Boolean(onRename || onDelete);

  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Conversation: ${title}`}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 3,
        // Opaque over the swipe actions, identical to the screen background.
        backgroundColor: pressed ? colors.raised : swipeable ? colors.bg : 'transparent',
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text
          numberOfLines={1}
          style={{ flex: 1, color: colors.text, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 }}
        >
          {title}
        </Text>
        <Text style={{ color: colors.textFaint, fontSize: 13, fontVariant: ['tabular-nums'] }}>
          {timeAgo(session.last_active)}
        </Text>
      </View>
      {preview ? (
        <Text numberOfLines={1} style={{ color: colors.textDim, fontSize: 14.5 }}>
          {preview}
        </Text>
      ) : null}
      <Text style={{ color: colors.textFaint, fontSize: 12.5, fontVariant: ['tabular-nums'] }}>
        {session.message_count} messages
      </Text>
    </Pressable>
  );

  if (!swipeable) return row;

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      renderRightActions={(_progress, _translation, methods: SwipeableMethods) => (
        <View style={{ flexDirection: 'row' }}>
          {onRename ? (
            <SwipeAction
              icon="sf:pencil"
              label="Rename"
              background={colors.raised}
              tint={colors.text}
              accessibilityLabel={`Rename conversation: ${title}`}
              onPress={() => {
                methods.close();
                onRename();
              }}
            />
          ) : null}
          {onDelete ? (
            <SwipeAction
              icon="sf:trash.fill"
              label="Delete"
              background={colors.danger}
              tint={colors.onDanger}
              accessibilityLabel={`Delete conversation: ${title}`}
              onPress={() => {
                methods.close();
                onDelete();
              }}
            />
          ) : null}
        </View>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  );
});
