// src/components/card-button.tsx — the action button used inside request cards.
import { Pressable, Text } from 'react-native';
import { useTheme } from '@/theme';

export function CardButton({
  label,
  a11y,
  onPress,
  disabled = false,
  primary = false,
  flex = false,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  flex?: boolean;
}) {
  const { colors } = useTheme();
  // A disabled primary is not a faded accent — white on 45% accent is illegible in light (sim S1 V7).
  const accent = primary && !disabled;
  const disabledPrimary = primary && disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: flex ? 1 : undefined,
        minHeight: 44,
        paddingHorizontal: 14,
        paddingVertical: 8, // large text never touches the edges (V6)
        borderRadius: 12,
        borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: accent
          ? pressed
            ? colors.accentPressed
            : colors.accent
          : disabledPrimary || pressed
            ? colors.surface
            : 'transparent',
        borderWidth: accent ? 0 : 1,
        borderColor: colors.border,
        opacity: disabled && !primary ? 0.45 : 1,
      })}
    >
      <Text
        style={{
          color: accent ? colors.onAccent : disabledPrimary ? colors.textDim : colors.text,
          fontSize: 15,
          fontWeight: primary ? '700' : '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
