import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/icon';
import type { ApprovalChoice, ApprovalRequest } from '@/lib/approval';
import { useTheme, type ThemeColors } from '@/theme';

export type ApprovalStatus =
  | 'pending' // waiting for the user
  | 'answering' // approval.respond in flight
  | 'approved' // resolved: allowed
  | 'denied' // resolved: blocked
  | 'cancelled'; // superseded — turn ended/interrupted/stale, gateway force-denied

export interface ApprovalInfo {
  request: ApprovalRequest;
  status: ApprovalStatus;
}

function ResolvedRow({ status, colors }: { status: ApprovalStatus; colors: ThemeColors }) {
  const map = {
    approved: { icon: 'checkmark.circle.fill', tint: colors.success, label: 'Approved' },
    denied: { icon: 'xmark.circle.fill', tint: colors.danger, label: 'Denied' },
    cancelled: { icon: 'slash.circle', tint: colors.textFaint, label: 'No longer pending' },
  } as const;
  const m = map[status as 'approved' | 'denied' | 'cancelled'];
  return (
    <View
      accessibilityLabel={`Approval ${m.label}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 }}
    >
      <Icon sf={m.icon} size={14} color={m.tint} />
      <Text style={{ color: m.tint, fontSize: 13.5, fontWeight: '600' }}>{m.label}</Text>
    </View>
  );
}

/**
 * High-salience card asking the user to approve or deny a dangerous command
 * (gateway `approval.request`). Approvals are FIFO per session, so only the
 * oldest pending card is actionable (`active`); younger ones wait their turn.
 */
export function ApprovalCard({
  approval,
  active,
  onRespond,
}: {
  approval: ApprovalInfo;
  /** True when this is the oldest unresolved approval in the session. */
  active: boolean;
  onRespond: (choice: ApprovalChoice) => void;
}) {
  const { colors } = useTheme();
  const { request, status } = approval;
  const pending = status === 'pending' || status === 'answering';
  const actionable = status === 'pending' && active;

  function respond(choice: ApprovalChoice) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onRespond(choice);
  }

  return (
    <View
      accessibilityLabel={`Approval required: ${request.description || request.command}`}
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
        <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: '700', flexShrink: 1 }}>
          Approval required
        </Text>
        <View style={{ flex: 1 }} />
        {request.patternKey ? (
          <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 12, flexShrink: 1 }}>
            {request.patternKey}
          </Text>
        ) : null}
      </View>

      {request.description ? (
        <Text style={{ color: colors.textDim, fontSize: 13.5, lineHeight: 19 }}>{request.description}</Text>
      ) : null}

      {request.command ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 10,
            borderCurve: 'continuous',
            padding: 10,
          }}
        >
          <Text selectable style={{ color: colors.text, fontFamily: 'Menlo', fontSize: 12.5, lineHeight: 18 }}>
            {request.command}
          </Text>
        </View>
      ) : null}

      {status === 'answering' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <ActivityIndicator size="small" color={colors.textDim} />
          <Text style={{ color: colors.textDim, fontSize: 13.5 }}>Sending…</Text>
        </View>
      ) : pending ? (
        <>
          <View style={{ flexDirection: 'row', gap: 10, opacity: actionable ? 1 : 0.45 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Deny, block this command"
              accessibilityState={{ disabled: !actionable }}
              disabled={!actionable}
              onPress={() => respond('deny')}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                borderCurve: 'continuous',
                borderWidth: 1,
                borderColor: colors.danger,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: colors.danger, fontSize: 15.5, fontWeight: '600' }}>Deny</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Approve, run this command once"
              accessibilityState={{ disabled: !actionable }}
              disabled={!actionable}
              onPress={() => respond('once')}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                borderCurve: 'continuous',
                backgroundColor: pressed ? colors.accentPressed : colors.accent,
              })}
            >
              <Text style={{ color: colors.onAccent, fontSize: 15.5, fontWeight: '700' }}>Approve</Text>
            </Pressable>
          </View>
          {!actionable ? (
            <Text style={{ color: colors.textFaint, fontSize: 12.5 }}>
              Waiting for the earlier approval above…
            </Text>
          ) : null}
        </>
      ) : (
        <ResolvedRow status={status} colors={colors} />
      )}
    </View>
  );
}
