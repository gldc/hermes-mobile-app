// The navigation theme follows the app's palette and the system scheme. Without it React
// Navigation runs on its light DefaultTheme under a dark app, and on iOS 26 the header's liquid-glass
// items render against the wrong appearance (Expo's Stack Toolbar docs, "Common problems").
import { DarkTheme, DefaultTheme } from 'expo-router';
import { navigationTheme, palettes } from '../src/theme';

test('dark: a dark navigation theme in the dark palette', () => {
  const t = navigationTheme(palettes.dark, true);
  expect(t.dark).toBe(true);
  expect(t.fonts).toEqual(DarkTheme.fonts);
  expect(t.colors).toEqual({
    primary: palettes.dark.accent,
    background: palettes.dark.bg,
    card: palettes.dark.bg,
    text: palettes.dark.text,
    border: palettes.dark.border,
    notification: palettes.dark.accent,
  });
});

test('light: a light navigation theme in the light palette', () => {
  const t = navigationTheme(palettes.light, false);
  expect(t.dark).toBe(false);
  expect(t.fonts).toEqual(DefaultTheme.fonts);
  expect(t.colors.background).toBe(palettes.light.bg);
  expect(t.colors.text).toBe(palettes.light.text);
});
