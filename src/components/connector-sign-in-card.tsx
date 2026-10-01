// src/components/connector-sign-in-card.tsx — the Sign in button of an OAuth connector, the
// running state with Cancel, and the outcome line (spec §5.3, §5.6).
//
// The note can be gateway text (a provider's refusal), so it is never selectable. The redirect
// address under it is built by the app, and is selectable so it can be copied into the
// provider's settings.
import { ActivityIndicator, Text, View } from 'react-native';
import { CardButton } from '@/components/card-button';
import { oauthPhaseLine, type OauthPhase } from '@/lib/mcp-oauth';
import { useTheme } from '@/theme';

export interface ConnectorSignInNote {
  tone: 'error' | 'info';
  text: string;
  /** The redirect address a provider has to allow, when it refused it. */
  address?: string | null;
}

export function ConnectorSignInCard({
  label,
  phase,
  cancelling,
  note,
  disabled = false,
  onSignIn,
  onCancel,
}: {
  label: 'Sign in' | 'Sign in again';
  /** Set while a sign-in runs. */
  phase: OauthPhase | null;
  cancelling: boolean;
  note: ConnectorSignInNote | null;
  /** The screen is busy with something that must not overlap a sign-in. */
  disabled?: boolean;
  onSignIn: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
        gap: 12,
      }}
    >
      {phase ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator color={colors.textDim} />
            <Text accessibilityLiveRegion="polite" style={{ color: colors.textDim, fontSize: 14, flexShrink: 1 }}>
              {cancelling ? 'Cancelling…' : oauthPhaseLine(phase)}
            </Text>
          </View>
          <CardButton label="Cancel" a11y="Cancel sign-in" onPress={onCancel} disabled={cancelling} />
        </>
      ) : (
        <CardButton label={label} a11y={label} onPress={onSignIn} disabled={disabled} primary />
      )}
      {note ? (
        <Text
          accessibilityLiveRegion="polite"
          selectable={false}
          style={{ color: note.tone === 'error' ? colors.danger : colors.textDim, fontSize: 14 }}
        >
          {note.text}
        </Text>
      ) : null}
      {note?.address ? (
        <View accessible accessibilityLabel={`Redirect address: ${note.address}`} style={{ gap: 4 }}>
          <Text style={{ color: colors.textFaint, fontSize: 12.5, fontWeight: '600' }}>Redirect address</Text>
          <Text selectable style={{ color: colors.text, fontSize: 14 }}>
            {note.address}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
