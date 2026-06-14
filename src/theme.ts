import { useColorScheme } from 'react-native';

export interface ThemeColors {
  bg: string;
  /** Sidebar/drawer panel — a step darker than `bg`, like the Claude app. */
  sidebarBg: string;
  surface: string;
  raised: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  /** Input placeholders — lighter than textFaint. */
  placeholder: string;
  accent: string;
  accentPressed: string;
  onAccent: string;
  userBubble: string;
  /** High-contrast pill (New chat): dark in light mode, light in dark mode. */
  inverseSurface: string;
  onInverse: string;
  danger: string;
  onDanger: string;
  success: string;
}

/** Display face for the wordmark and greetings — warm serif. Georgia is built into
 * iOS; Android maps 'serif' to Noto Serif. */
export const serif = process.env.EXPO_OS === 'ios' ? 'Georgia' : 'serif';

/** Color-matched to the Claude iOS app (values sampled from screenshots):
 * near-neutral paper surfaces, #181818 ink, terracotta accent. The main chat
 * surface is a step lighter than the sidebar. Follows the system scheme. */
export const palettes: Record<'dark' | 'light', ThemeColors> = {
  dark: {
    bg: '#262624',
    sidebarBg: '#1F1E1D',
    surface: '#30302E',
    raised: '#393834',
    border: 'rgba(240, 239, 234, 0.09)',
    text: '#F0EFEA',
    textDim: '#B3B0A8',
    textFaint: '#84827A',
    placeholder: '#5C5A54',
    accent: '#D97757',
    accentPressed: '#BD6244',
    onAccent: '#2A150C',
    userBubble: '#34332F',
    inverseSurface: '#FAFAF8',
    onInverse: '#181818',
    danger: '#E5685C',
    onDanger: '#FFF6F4',
    success: '#7FB069',
  },
  light: {
    bg: '#FAFAF8',
    sidebarBg: '#F5F5F3',
    surface: '#FDFDFB',
    raised: '#F0F0EC',
    border: 'rgba(24, 24, 23, 0.07)',
    text: '#181818',
    textDim: '#55554F',
    textFaint: '#8C8B86',
    placeholder: '#D8D7D5',
    accent: '#D97757',
    accentPressed: '#C05F3F',
    onAccent: '#FFFFFF',
    userBubble: '#F1F0EA',
    inverseSurface: '#373633',
    onInverse: '#FEFEFE',
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
