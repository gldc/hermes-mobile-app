import { memo } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Icon } from '@/components/icon';
import { MarkdownView } from '@/components/markdown-view';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceNote,
  TraceTitle,
} from '@/components/trace';
import { bubbleImageSize } from '@/lib/image-attach';
import type { SubagentBatch } from '@/lib/subagent-progress';
import type { ToolOutcome } from '@/lib/tool-outcome';
import type { TodoItem } from '@/lib/todo';
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
  /** How the finished tool ended, read from its result (absent = ok). */
  outcome?: ToolOutcome;
}

/** The finished line's glyph and what VoiceOver says for each outcome. A tool that ended fine
 * keeps its tool glyph — a Trace line marks only what went wrong. */
const OUTCOME_MARK = {
  ok: { sf: 'hammer.fill', label: 'finished' },
  failed: { sf: 'xmark.circle.fill', label: 'failed' },
  denied: { sf: 'hand.raised.fill', label: 'denied' },
  interrupted: { sf: 'stop.circle.fill', label: 'interrupted' },
} as const;

export interface ChatItem {
  key: string;
  role: 'user' | 'assistant' | 'tool' | 'status' | 'subagent' | 'todo';
  text: string;
  /** Assistant messages render plain text while streaming, markdown once complete. */
  complete?: boolean;
  /** Assistant reasoning trace, rehydrated from history; rendered as a
   * collapsible disclosure above the prose. History-only (no live event yet). */
  reasoning?: string;
  tool?: ToolInfo;
  /** Live subagent batch — rendered by the chat screen via SubagentMonitorCard. */
  subagent?: SubagentBatch;
  /** Current todo list — rendered by the chat screen via TodoCard. */
  todo?: TodoItem[];
  /** Local uri of a photo sent with this (user) message. */
  imageUri?: string;
  /** Natural dimensions of the attached photo, for aspect-correct layout. */
  imageWidth?: number;
  imageHeight?: number;
  /** User message delivered via session.steer into the running turn (spec §5.3). */
  steered?: boolean;
  /** Status rows with special rendering. 'stopped' = the turn ended with status "interrupted". */
  marker?: 'stopped';
}

function ReasoningLine({ text }: { text: string }) {
  return (
    <Trace style={{ marginBottom: 10 }}>
      <TraceCollapsible>
        <TraceCollapsibleTrigger accessibilityLabel={(open) => `Reasoning, ${open ? 'tap to collapse' : 'tap to expand'}`}>
          <TraceLine>
            <TraceIcon sf="brain" />
            <TraceTitle>Reasoning</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <MarkdownView text={text} muted />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function ToolLine({ tool }: { tool: ToolInfo }) {
  const { colors } = useTheme();
  const hasDetail = Boolean(tool.detail || tool.diff);
  const outcome = tool.outcome ?? 'ok';
  const mark = OUTCOME_MARK[outcome];
  const summary = tool.summary && !tool.running ? tool.summary : null;
  const label = `Tool ${tool.name}, ${tool.running ? 'running' : mark.label}${
    // A summary's closing period would read ".," before the details hint (sim QA nit).
    summary ? `, ${hasDetail ? summary.replace(/\.+$/, '') : summary}` : ''
  }${hasDetail ? ', tap for details' : ''}`;

  const head = (
    <>
      <TraceLine status={tool.running ? 'running' : outcome === 'failed' ? 'error' : undefined}>
        <TraceIcon sf={tool.running ? 'hammer.fill' : mark.sf} />
        <TraceTitle>
          <Text style={{ fontWeight: '600' }}>{tool.name}</Text>
          {tool.context ? `  ${tool.context}` : null}
        </TraceTitle>
        {!tool.running && tool.durationS !== undefined ? (
          <TraceDescription>{tool.durationS < 10 ? tool.durationS.toFixed(1) : Math.round(tool.durationS)}s</TraceDescription>
        ) : null}
      </TraceLine>
      {summary ? <TraceNote>{summary}</TraceNote> : null}
    </>
  );

  if (!hasDetail) {
    return (
      <View accessible accessibilityLabel={label} style={{ gap: 2 }}>
        {head}
      </View>
    );
  }
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger accessibilityLabel={label}>{head}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <View testID="tool-detail" style={{ backgroundColor: colors.raised, borderRadius: 10, borderCurve: 'continuous', padding: 10 }}>
          <Text selectable style={{ color: colors.textDim, fontFamily: 'Menlo', fontSize: 11.5, lineHeight: 17 }}>
            {tool.diff ? tool.diff : tool.detail}
          </Text>
        </View>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/**
 * Claude/ChatGPT-style layout: user messages in a soft right-aligned bubble,
 * assistant replies as full-width prose, tools and reasoning as Trace lines.
 */
export const MessageRow = memo(function MessageRow({ item }: { item: ChatItem }) {
  const { colors } = useTheme();

  if (item.role === 'user') {
    const imageSize = item.imageUri ? bubbleImageSize(item.imageWidth, item.imageHeight) : null;
    return (
      <View style={{ alignItems: 'flex-end', paddingVertical: 6 }}>
        {item.imageUri && imageSize ? (
          <Image
            source={{ uri: item.imageUri }}
            accessibilityLabel="Photo you sent"
            contentFit="cover"
            style={{
              width: imageSize.width,
              height: imageSize.height,
              borderRadius: 16,
              backgroundColor: colors.raised,
              marginBottom: item.text ? 5 : 0,
            }}
          />
        ) : null}
        {item.text ? (
          <View
            accessible
            accessibilityLabel={item.steered ? `You steered: ${item.text}` : undefined}
            style={{
              maxWidth: '82%',
              backgroundColor: colors.userBubble,
              borderRadius: 20,
              borderCurve: 'continuous',
              paddingHorizontal: 16,
              paddingVertical: 11,
            }}
          >
            <Text selectable style={{ color: colors.text, fontSize: 17, lineHeight: 24 }}>
              {item.text}
            </Text>
          </View>
        ) : null}
        {item.steered ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 4, paddingRight: 6 }}>
            <Icon sf="arrow.turn.down.right" size={11} color={colors.textFaint} />
            <Text style={{ color: colors.textFaint, fontSize: 12, fontWeight: '600' }}>Steered</Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (item.role === 'assistant') {
    // Markdown isn't selectable, so long-press opens the share sheet
    // (which includes Copy on iOS). Reasoning-only items have empty text.
    return (
      <Pressable
        accessibilityLabel="Assistant message, long-press to share"
        onLongPress={
          item.complete && item.text.trim()
            ? () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                Share.share({ message: item.text });
              }
            : undefined
        }
        style={{ paddingVertical: 6 }}
      >
        {item.reasoning ? <ReasoningLine text={item.reasoning} /> : null}
        {item.complete ? (
          item.text.trim() ? <MarkdownView text={item.text} /> : null
        ) : (
          <Text selectable style={{ color: colors.text, fontSize: 17, lineHeight: 27 }}>
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
        <ToolLine tool={item.tool} />
      </View>
    );
  }

  // Rendered by the chat screen (they own their components); render nothing here.
  if (item.role === 'subagent' || item.role === 'todo') return null;

  // status
  if (item.marker === 'stopped') {
    return (
      <View style={{ paddingVertical: 6 }}>
        <TraceLine accessibilityLabel="Response stopped">
          <TraceIcon sf="stop.circle" />
          <TraceTitle>Stopped</TraceTitle>
        </TraceLine>
      </View>
    );
  }
  return (
    <Text style={{ color: colors.textFaint, fontSize: 12.5, paddingVertical: 3 }}>{item.text}</Text>
  );
});
