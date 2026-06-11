import { memo } from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MarkdownView } from '@/components/markdown-view';
import { useTheme } from '@/theme';

export interface ChatItem {
  key: string;
  role: 'user' | 'assistant' | 'tool' | 'status';
  text: string;
  /** Assistant messages render plain text while streaming, markdown once complete. */
  complete?: boolean;
}

/**
 * Claude/ChatGPT-style layout: user messages in a soft right-aligned bubble,
 * assistant replies as full-width prose, tools and statuses as quiet chips.
 */
export const MessageRow = memo(function MessageRow({ item }: { item: ChatItem }) {
  const { colors } = useTheme();

  if (item.role === 'user') {
    return (
      <View style={{ alignItems: 'flex-end', paddingVertical: 6 }}>
        <View
          style={{
            maxWidth: '82%',
            backgroundColor: colors.userBubble,
            borderRadius: 20,
            borderCurve: 'continuous',
            paddingHorizontal: 16,
            paddingVertical: 11,
          }}
        >
          <Text selectable style={{ color: colors.text, fontSize: 16, lineHeight: 23 }}>
            {item.text}
          </Text>
        </View>
      </View>
    );
  }

  if (item.role === 'assistant') {
    return (
      <View style={{ paddingVertical: 6 }}>
        {item.complete ? (
          <MarkdownView text={item.text} />
        ) : (
          <Text selectable style={{ color: colors.text, fontSize: 16, lineHeight: 25 }}>
            {item.text}
            <Text style={{ color: colors.accent }}>▍</Text>
          </Text>
        )}
      </View>
    );
  }

  if (item.role === 'tool') {
    return (
      <View style={{ alignItems: 'flex-start', paddingVertical: 4 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: colors.raised,
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <Image
            source="sf:hammer.fill"
            style={{ width: 11, height: 11 }}
            tintColor={colors.textDim}
          />
          <Text style={{ color: colors.textDim, fontSize: 12.5, fontWeight: '500' }}>{item.text}</Text>
        </View>
      </View>
    );
  }

  // status
  return (
    <Text style={{ color: colors.textFaint, fontSize: 12.5, paddingVertical: 3 }}>{item.text}</Text>
  );
});
