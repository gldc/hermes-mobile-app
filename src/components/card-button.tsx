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
        borderRadius: 12,
        borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? (pressed ? colors.accentPressed : colors.accent) : pressed ? colors.surface : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: colors.border,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Text
        style={{
          color: primary ? colors.onAccent : colors.text,
          fontSize: 15,
          fontWeight: primary ? '700' : '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
