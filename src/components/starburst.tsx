import { View } from 'react-native';
import { useTheme } from '@/theme';

/** Eight-ray starburst mark — four full-diameter capsules rotated 45° apart.
 * Pure views, so it scales to any size with no image assets. */
export function Starburst({ size = 44, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  const ray = color ?? colors.accent;
  const thickness = Math.max(3, size * 0.13);

  return (
    <View
      accessibilityElementsHidden
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      {[0, 45, 90, 135].map((deg) => (
        <View
          key={deg}
          style={{
            position: 'absolute',
            width: thickness,
            height: size,
            borderRadius: thickness / 2,
            backgroundColor: ray,
            transform: [{ rotate: `${deg}deg` }],
          }}
        />
      ))}
    </View>
  );
}
