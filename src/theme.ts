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
  success: string;
}

/** Warm, dark-first palette. Bronze accent — Hermes, messenger of the gods. */
export const palettes: Record<'dark' | 'light', ThemeColors> = {
  dark: {
    bg: '#141310',
    surface: '#1D1B17',
    raised: '#26231E',
    border: 'rgba(231, 222, 205, 0.08)',
    text: '#ECE7DC',
    textDim: '#A39C8F',
    textFaint: '#6F695E',
    accent: '#D9A24A',
    accentPressed: '#BD8A39',
    onAccent: '#1A1408',
    userBubble: '#2A2620',
    danger: '#E5685C',
    success: '#7FB069',
  },
  light: {
    bg: '#FAF8F4',
    surface: '#FFFFFF',
    raised: '#F1EDE4',
    border: 'rgba(60, 50, 30, 0.10)',
    text: '#211E18',
    textDim: '#6E675C',
    textFaint: '#9B948A',
    accent: '#B8812F',
    accentPressed: '#9C6C24',
    onAccent: '#FFF9EE',
    userBubble: '#EFEAE0',
    danger: '#C94F43',
    success: '#4E7A3A',
  },
};

export function useTheme(): { colors: ThemeColors; dark: boolean } {
  const scheme = useColorScheme();
  const dark = scheme !== 'light';
  return { colors: dark ? palettes.dark : palettes.light, dark };
}
