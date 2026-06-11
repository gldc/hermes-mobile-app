import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { SessionSummary } from '@/api/types';
import { timeAgo } from '@/lib/format';
import { useTheme } from '@/theme';

export const SessionRow = memo(function SessionRow({
  session,
  onPress,
}: {
  session: SessionSummary;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const title = session.title?.trim() || session.preview?.trim() || 'Untitled conversation';
  const preview = session.title?.trim() ? session.preview?.trim() : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Conversation: ${title}`}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 3,
        backgroundColor: pressed ? colors.raised : 'transparent',
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
});
