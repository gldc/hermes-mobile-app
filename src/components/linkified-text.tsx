// src/components/linkified-text.tsx
import { Text, type TextProps } from 'react-native';
import { linkSegments, openExternal } from '@/lib/links';
import { useTheme } from '@/theme';

/** Plain text whose URLs are links that open in the default browser. Takes a string child. */
export function LinkifiedText({ children, ...props }: Omit<TextProps, 'children'> & { children: string }) {
  const { colors } = useTheme();
  return (
    <Text {...props}>
      {linkSegments(children).map((seg, i) =>
        seg.url ? (
          <Text
            key={i}
            accessibilityRole="link"
            onPress={() => openExternal(seg.url!)}
            style={{ color: colors.accent, textDecorationLine: 'underline' }}
          >
            {seg.text}
          </Text>
        ) : (
          seg.text
        ),
      )}
    </Text>
  );
}
