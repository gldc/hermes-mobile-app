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
  /** Local uri of the staged photo, shown as a removable chip above the input. */
  stagedImageUri?: string | null;
  /** Open the Take Photo / Choose from Library sheet. */
  onAttachPress?: () => void;
  /** Remove the staged photo chip. */
  onRemoveImage?: () => void;
}

/** Pill input + circular send button, in the style of modern AI chat apps. */
export function Composer({
  value,
  onChangeText,
  onSend,
  disabled,
  streaming,
  stagedImageUri,
  onAttachPress,
  onRemoveImage,
}: ComposerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const canSend = !disabled && !streaming && (value.trim().length > 0 || Boolean(stagedImageUri));

  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 8),
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      {stagedImageUri ? (
        <View style={{ flexDirection: 'row', paddingBottom: 8, paddingLeft: 2 }}>
          <View style={{ width: 64, height: 64 }}>
            <Image
              source={{ uri: stagedImageUri }}
              accessibilityLabel="Staged photo"
              contentFit="cover"
              style={{
                width: 64,
                height: 64,
                borderRadius: 12,
                backgroundColor: colors.raised,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              onPress={onRemoveImage}
              hitSlop={12}
              style={({ pressed }) => ({
                position: 'absolute',
                top: -7,
                right: -7,
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? colors.raised : colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              })}
            >
              <Image source="sf:xmark" style={{ width: 10, height: 10 }} tintColor={colors.text} />
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add photo"
          onPress={onAttachPress}
          disabled={disabled}
          hitSlop={6}
          style={({ pressed }) => ({
            width: 38,
            height: 38,
            borderRadius: 19,
            marginBottom: 3,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? colors.surface : colors.raised,
          })}
        >
          <Image
            source="sf:plus"
            style={{ width: 17, height: 17 }}
            tintColor={disabled ? colors.textFaint : colors.text}
          />
        </Pressable>
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
    </View>
  );
}
