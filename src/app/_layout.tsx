import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { setupNotificationHandling } from '@/notifications';
import { useTheme } from '@/theme';

export default function Layout() {
  const { colors, dark } = useTheme();

  // Foreground banners + tap → sessions list. Pushes carry no data payload
  // (docs/contracts/push.md), so the sessions list is the only sane target;
  // its AuthError path already bounces to the connect screen when needed.
  useEffect(() => setupNotificationHandling(() => router.navigate('/sessions')), []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.text },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sessions" options={{ title: 'Hermes', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: '' }} />
        <Stack.Screen
          name="settings"
          options={{
            title: 'Settings',
            presentation: 'formSheet',
            sheetGrabberVisible: true,
            sheetAllowedDetents: [0.5, 1.0],
            headerShown: false,
          }}
        />
      </Stack>
    </GestureHandlerRootView>
  );
}
