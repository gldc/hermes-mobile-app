import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import type { ApprovalInfo } from '@/components/approval-card';
import { MarkdownView } from '@/components/markdown-view';
import { useTheme } from '@/theme';

export interface ToolInfo {
  id: string;
  name: string;
  /** Human context from the gateway, e.g. the command or file involved. */
  context?: string;
  running: boolean;
  durationS?: number;
  /** One-line human outcome ("Extracted 3 pages"). */
  summary?: string;
  /** Expanded detail: result text / JSON, truncated by the chat screen. */
  detail?: string;
  /** Inline diff for edit tools, when the gateway provides one. */
  diff?: string;
}

export interface ChatItem {
  key: string;
  role: 'user' | 'assistant' | 'tool' | 'status' | 'approval';
  text: string;
  /** Assistant messages render plain text while streaming, markdown once complete. */
  complete?: boolean;
  tool?: ToolInfo;
  /** Gateway approval request, attached like ToolInfo. Rendered by the chat
   * screen via ApprovalCard (it owns the respond callback), not MessageRow. */
  approval?: ApprovalInfo;
}

function ToolCallCard({ tool }: { tool: ToolInfo }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(tool.detail || tool.diff);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Tool ${tool.name}${tool.running ? ', running' : ', finished'}${hasDetail ? ', tap for details' : ''}`}
      onPress={hasDetail ? () => setExpanded((e) => !e) : undefined}
      style={{
        backgroundColor: colors.raised,
        borderRadius: 14,
        borderCurve: 'continuous',
        paddingHorizontal: 12,
        paddingVertical: 9,
        gap: 6,
        alignSelf: 'stretch',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Image source="sf:hammer.fill" style={{ width: 12, height: 12 }} tintColor={colors.accent} />
        <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: '600' }}>{tool.name}</Text>
        {tool.context ? (
          <Text numberOfLines={1} style={{ color: colors.textDim, fontSize: 13, flexShrink: 1 }}>
            {tool.context}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {tool.running ? (
          <ActivityIndicator size="small" color={colors.textDim} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {tool.durationS !== undefined ? (
              <Text style={{ color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] }}>
                {tool.durationS < 10 ? tool.durationS.toFixed(1) : Math.round(tool.durationS)}s
              </Text>
            ) : null}
            <Image source="sf:checkmark.circle.fill" style={{ width: 13, height: 13 }} tintColor={colors.success} />
            {hasDetail ? (
              <Image
                source={expanded ? 'sf:chevron.up' : 'sf:chevron.down'}
                style={{ width: 11, height: 11 }}
                tintColor={colors.textFaint}
              />
            ) : null}
          </View>
        )}
      </View>

      {tool.summary && !tool.running ? (
        <Text style={{ color: colors.textDim, fontSize: 12.5 }}>{tool.summary}</Text>
      ) : null}

      {expanded && hasDetail ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 10,
            borderCurve: 'continuous',
            padding: 10,
          }}
        >
          <Text selectable style={{ color: colors.textDim, fontFamily: 'Menlo', fontSize: 11.5, lineHeight: 17 }}>
            {tool.diff ? tool.diff : tool.detail}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Claude/ChatGPT-style layout: user messages in a soft right-aligned bubble,
 * assistant replies as full-width prose, tools as expandable cards.
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
    // Markdown isn't selectable, so long-press opens the share sheet
    // (which includes Copy on iOS).
    return (
      <Pressable
        accessibilityLabel="Assistant message, long-press to share"
        onLongPress={
          item.complete
            ? () => {
                if (process.env.EXPO_OS === 'ios') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                Share.share({ message: item.text });
              }
            : undefined
        }
        style={{ paddingVertical: 6 }}
      >
        {item.complete ? (
          <MarkdownView text={item.text} />
        ) : (
          <Text selectable style={{ color: colors.text, fontSize: 16, lineHeight: 25 }}>
            {item.text}
            <Text style={{ color: colors.accent }}>▍</Text>
          </Text>
        )}
      </Pressable>
    );
  }

  if (item.role === 'tool' && item.tool) {
    return (
      <View style={{ paddingVertical: 4 }}>
        <ToolCallCard tool={item.tool} />
      </View>
    );
  }

  // Approval items are rendered by the chat screen (ApprovalCard needs the
  // respond callback); render nothing if one ever falls through here.
  if (item.role === 'approval') return null;

  // status
  return (
    <Text style={{ color: colors.textFaint, fontSize: 12.5, paddingVertical: 3 }}>{item.text}</Text>
  );
});
