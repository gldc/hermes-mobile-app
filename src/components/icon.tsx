import { Image } from 'expo-image';
import type { ImageStyle, StyleProp, TextStyle } from 'react-native';
import { SF_TO_MATERIAL } from '@/lib/icon-map';

const isIOS = process.env.EXPO_OS === 'ios';
// Build-time branch: Metro strips this require (and the MCI font) from iOS bundles.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MaterialCommunityIcons = isIOS ? null : require('@expo/vector-icons/MaterialCommunityIcons').default;

/** Cross-platform icon. iOS: native SF Symbol via expo-image (identical to the
 * previous inline usage). Android: MaterialCommunityIcons equivalent. */
export function Icon({
  sf,
  size = 20,
  width,
  height,
  color,
  style,
}: {
  sf: string;
  size?: number;
  /** Override for non-square SF symbols; Android uses max(width, height). */
  width?: number;
  height?: number;
  color?: string;
  /** Compatible with both render paths: expo-image (ImageStyle) and MCI text glyph (TextStyle). */
  style?: StyleProp<ImageStyle & TextStyle>;
}) {
  const w = width ?? size;
  const h = height ?? size;
  if (isIOS) {
    return <Image source={`sf:${sf}`} style={[{ width: w, height: h }, style]} tintColor={color} />;
  }
  return (
    <MaterialCommunityIcons
      name={SF_TO_MATERIAL[sf] ?? 'help-circle-outline'}
      size={Math.max(w, h)}
      color={color}
      style={style}
    />
  );
}
