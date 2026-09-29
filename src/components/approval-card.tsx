import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/icon';
import { approvalView } from '@/lib/approval';
import { cancelLabel, type RequestCardState } from '@/lib/turn-controller';
import { useTheme, type ThemeColors } from '@/theme';
import type { ApprovalResult } from '@/vendor/hermes-gateway';

/** Descriptions longer than this many lines (a Tirith scan runs ~10) clamp behind Show more (V11). */
const DESCRIPTION_LINES = 4;

function Description({ text, colors }: { text: string; colors: ThemeColors }) {
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const style = { color: colors.textDim, fontSize: 13.5, lineHeight: 19 };
  return (
    <View style={{ gap: 4 }}>
      <Text numberOfLines={expanded ? undefined : DESCRIPTION_LINES} style={style}>
        {text}
      </Text>
      {/* Unclamped twin, laid out invisibly at the same width: its line count says whether the
          clamp hides anything (a clamped Text only reports the lines it shows). */}
      <Text
        testID="approval-description-measure"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        onTextLayout={(e) => setOverflows(e.nativeEvent.lines.length > DESCRIPTION_LINES)}
        style={[style, { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 }]}
      >
        {text}
      </Text>
      {overflows ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show less of the description' : 'Show more of the description'}
          accessibilityState={{ expanded }}
          hitSlop={8}
          onPress={() => setExpanded((x) => !x)}
          style={{ alignSelf: 'flex-start' }}
        >
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{expanded ? 'Show less' : 'Show more'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ResolvedRow({ card, colors }: { card: RequestCardState; colors: ThemeColors }) {
  const m =
    card.status === 'answered'
      ? card.resolution === 'deny'
        ? { icon: 'xmark.circle.fill', tint: colors.danger, label: 'Denied' }
        : { icon: 'checkmark.circle.fill', tint: colors.success, label: 'Approved' }
      : { icon: 'slash.circle', tint: colors.textFaint, label: card.cancelReason ? cancelLabel(card.cancelReason) : 'Closed' };
  return (
    <View accessibilityLabel={`Approval ${m.label}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 }}>
      <Icon sf={m.icon} size={14} color={m.tint} />
      <Text style={{ color: m.tint, fontSize: 13.5, fontWeight: '600' }}>{m.label}</Text>
    </View>
  );
}

/**
 * Dangerous-command approval. 0.21.5 (`approval` server request): every pending card is actionable.
 * Legacy 0.20.4 (`approval.request` event): FIFO — only the oldest is `actionable`.
 */
export function ApprovalCard({
  card,
  actionable,
  onRespond,
}: {
  card: RequestCardState;
  actionable: boolean;
  onRespond: (choice: ApprovalResult['choice']) => void;
}) {
  const { colors } = useTheme();
  const view = approvalView(card.params);
  const pending = card.status === 'pending' || card.status === 'answering';
  const canAct = card.status === 'pending' && actionable;

  function respond(choice: ApprovalResult['choice']) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onRespond(choice);
  }

  return (
    <View
      accessibilityLabel={`Approval required: ${view.description || view.command}`}
      style={{
        backgroundColor: colors.raised,
        borderRadius: 16,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: pending ? colors.accent : colors.border,
        padding: 14,
        gap: 10,
        marginVertical: 6,
        alignSelf: 'stretch',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon sf="exclamationmark.shield.fill" size={15} color={pending ? colors.accent : colors.textFaint} />
        <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: '700', flexShrink: 1 }}>Approval required</Text>
        <View style={{ flex: 1 }} />
        {view.patternKey || view.toolName ? (
          <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 12, flexShrink: 1 }}>
            {view.patternKey || view.toolName}
          </Text>
        ) : null}
      </View>

      {view.description ? <Description text={view.description} colors={colors} /> : null}

      {view.command ? (
        <View style={{ backgroundColor: colors.surface, borderRadius: 10, borderCurve: 'continuous', padding: 10 }}>
          <Text selectable style={{ color: colors.text, fontFamily: 'Menlo', fontSize: 12.5, lineHeight: 18 }}>
            {view.command}
          </Text>
        </View>
      ) : null}

      {card.status === 'answering' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <ActivityIndicator size="small" color={colors.textDim} />
          <Text style={{ color: colors.textDim, fontSize: 13.5 }}>Sending…</Text>
        </View>
      ) : card.status === 'pending' ? (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Deny, block this command"
              accessibilityState={{ disabled: !canAct }}
              disabled={!canAct}
              onPress={() => respond('deny')}
              style={({ pressed }) => ({
                flex: 1, minHeight: 44, paddingVertical: 8, alignItems: 'center', justifyContent: 'center',
                borderRadius: 12, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.danger,
                opacity: !canAct ? 0.45 : pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: colors.danger, fontSize: 15.5, fontWeight: '600' }}>Deny</Text>
            </Pressable>
            {/* Disabled (waiting its FIFO turn): surface + secondary text, not a faded accent (sim S1 V7). */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Approve, run this command once"
              accessibilityState={{ disabled: !canAct }}
              disabled={!canAct}
              onPress={() => respond('once')}
              style={({ pressed }) => ({
                flex: 1, minHeight: 44, paddingVertical: 8, alignItems: 'center', justifyContent: 'center',
                borderRadius: 12, borderCurve: 'continuous',
                borderWidth: canAct ? 0 : 1, borderColor: colors.border,
                backgroundColor: !canAct ? colors.surface : pressed ? colors.accentPressed : colors.accent,
              })}
            >
              <Text style={{ color: canAct ? colors.onAccent : colors.textDim, fontSize: 15.5, fontWeight: '700' }}>Approve</Text>
            </Pressable>
          </View>
          {!canAct && card.legacy ? (
            <Text style={{ color: colors.textFaint, fontSize: 12.5 }}>Waiting for the earlier approval above…</Text>
          ) : null}
        </>
      ) : (
        <ResolvedRow card={card} colors={colors} />
      )}
    </View>
  );
}
