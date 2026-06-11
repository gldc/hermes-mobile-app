import { Pressable, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

interface ComposerProps {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  /** Input disabled entirely (e.g. session not ready). */
  disabled?: boolean;
  /** Agent is responding; send is held but typing stays available. */
  streaming?: boolean;
}

/** Pill input + circular send button, in the style of modern AI chat apps. */
export function Composer({ value, onChangeText, onSend, disabled, streaming }: ComposerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const canSend = !disabled && !streaming && value.trim().length > 0;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 8),
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: colors.raised,
          borderRadius: 22,
          borderCurve: 'continuous',
          paddingHorizontal: 16,
          paddingVertical: 2,
          minHeight: 44,
          justifyContent: 'center',
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          multiline
          placeholder={streaming ? 'Hermes is responding…' : 'Message Hermes'}
          placeholderTextColor={colors.textFaint}
          style={{ color: colors.text, fontSize: 16, lineHeight: 21, maxHeight: 120, paddingVertical: 10 }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send message"
        onPress={onSend}
        disabled={!canSend}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 38,
          height: 38,
          borderRadius: 19,
          marginBottom: 3,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: canSend ? (pressed ? colors.accentPressed : colors.accent) : colors.raised,
        })}
      >
        <Image
          source="sf:arrow.up"
          style={{ width: 17, height: 17 }}
          tintColor={canSend ? colors.onAccent : colors.textFaint}
        />
      </Pressable>
    </View>
  );
}
