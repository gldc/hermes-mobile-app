import { useColorScheme } from 'react-native';

export interface ThemeColors {
  bg: string;
  surface: string;
  raised: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentPressed: string;
  onAccent: string;
  userBubble: string;
  danger: string;
  onDanger: string;
  success: string;
}

/** Display face for the wordmark and greetings — warm serif, built into iOS. */
export const serif = 'Georgia';

/** Warm paper-and-ink palette: oat cream in light, soft charcoal in dark,
 * terracotta accent. Follows the system color scheme. */
export const palettes: Record<'dark' | 'light', ThemeColors> = {
  dark: {
    bg: '#262624',
    surface: '#30302E',
    raised: '#3A3936',
    border: 'rgba(240, 238, 229, 0.09)',
    text: '#F0EEE5',
    textDim: '#A9A69B',
    textFaint: '#787467',
    accent: '#D97757',
    accentPressed: '#BD6244',
    onAccent: '#2A150C',
    userBubble: '#393734',
    danger: '#E5685C',
    onDanger: '#FFF6F4',
    success: '#7FB069',
  },
  light: {
    bg: '#F4F2EB',
    surface: '#FCFBF8',
    raised: '#E9E6DB',
    border: 'rgba(31, 30, 26, 0.09)',
    text: '#1F1E1A',
    textDim: '#6F6C62',
    textFaint: '#A3A093',
    accent: '#C8643F',
    accentPressed: '#AD5434',
    onAccent: '#FFF7F2',
    userBubble: '#E9E6DB',
    danger: '#C94F43',
    onDanger: '#FFF6F4',
    success: '#4E7A3A',
  },
};

export function useTheme(): { colors: ThemeColors; dark: boolean } {
  const scheme = useColorScheme();
  const dark = scheme !== 'light';
  return { colors: dark ? palettes.dark : palettes.light, dark };
}
