import { Pressable, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn } from 'react-native-reanimated';
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
  /** Current model short name — renders the tappable pill when present. */
  modelName?: string | null;
  /** Open the model picker. */
  onModelPress?: () => void;
}

/** Floating card composer in the style of the Claude app: input on top,
 * attach + model pill + send on a row beneath. */
export function Composer({
  value,
  onChangeText,
  onSend,
  disabled,
  streaming,
  stagedImageUri,
  onAttachPress,
  onRemoveImage,
  modelName,
  onModelPress,
}: ComposerProps) {
  const { colors, dark } = useTheme();
  const canSend = !disabled && !streaming && (value.trim().length > 0 || Boolean(stagedImageUri));

  return (
    // Bottom spacing is owned by the chat screen, which tracks the keyboard
    // per-frame (useAnimatedKeyboard) so the card rides it smoothly.
    <View style={{ paddingHorizontal: 10, paddingTop: 6 }}>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 26,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 14,
          paddingTop: 6,
          paddingBottom: 10,
          gap: 8,
          boxShadow: dark ? '0 4px 18px rgba(0, 0, 0, 0.35)' : '0 4px 18px rgba(31, 30, 26, 0.08)',
        }}
      >
        {stagedImageUri ? (
          <Animated.View entering={FadeIn.duration(200)} style={{ flexDirection: 'row', paddingTop: 8 }}>
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
          </Animated.View>
        ) : null}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          multiline
          placeholder={streaming ? 'Hermes is responding…' : 'Chat with Hermes'}
          placeholderTextColor={colors.textFaint}
          style={{ color: colors.text, fontSize: 16.5, lineHeight: 22, maxHeight: 120, paddingTop: 10, paddingBottom: 2 }}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photo"
            onPress={onAttachPress}
            disabled={disabled}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.raised : 'transparent',
            })}
          >
            <Image
              source="sf:plus"
              style={{ width: 15, height: 15 }}
              tintColor={disabled ? colors.textFaint : colors.text}
            />
          </Pressable>

          {modelName ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Model: ${modelName}. Change model`}
              onPress={onModelPress}
              hitSlop={6}
              style={({ pressed }) => ({
                paddingHorizontal: 13,
                height: 32,
                borderRadius: 16,
                justifyContent: 'center',
                backgroundColor: pressed ? colors.userBubble : colors.raised,
                maxWidth: 180,
              })}
            >
              <Text numberOfLines={1} style={{ color: colors.textDim, fontSize: 13.5, fontWeight: '600' }}>
                {modelName}
              </Text>
            </Pressable>
          ) : null}

          <View style={{ flex: 1 }} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            onPress={onSend}
            disabled={!canSend}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: canSend ? (pressed ? colors.accentPressed : colors.accent) : colors.raised,
            })}
          >
            <Image
              source="sf:arrow.up"
              style={{ width: 16, height: 16 }}
              tintColor={canSend ? colors.onAccent : colors.textFaint}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
