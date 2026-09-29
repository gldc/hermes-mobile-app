import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/icon';
import { approvalView } from '@/lib/approval';
import { cancelLabel, type RequestCardState } from '@/lib/turn-controller';
import { useTheme, type ThemeColors } from '@/theme';
import type { ApprovalResult } from '@/vendor/hermes-gateway';

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

      {view.description ? (
        <Text style={{ color: colors.textDim, fontSize: 13.5, lineHeight: 19 }}>{view.description}</Text>
      ) : null}

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
