import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SidebarHost } from '@/components/sidebar-host';
import { setupNotificationHandling } from '@/notifications';
import { useTheme } from '@/theme';

export default function Layout() {
  const { colors, dark } = useTheme();

  // Foreground banners + tap → the chat home (sidebar lists everything from
  // there). Pushes carry no data payload (docs/contracts/push.md), so there is
  // no specific session to open; the chat screen's AuthError path already
  // bounces to the connect screen when needed.
  useEffect(() => setupNotificationHandling(() => router.navigate('/chat/new')), []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <SidebarHost>
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
          {/* Chat is the root surface: no native header (floating buttons
              instead) and no back-swipe — the left edge opens the sidebar.
              Crossfade between chats instead of a hard cut. */}
          <Stack.Screen
            name="chat/[id]"
            options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }}
          />
          <Stack.Screen
            name="attach"
            options={{
              presentation: 'formSheet',
              sheetGrabberVisible: true,
              sheetAllowedDetents: [0.6, 0.95],
              headerShown: false,
            }}
          />
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
      </SidebarHost>
    </GestureHandlerRootView>
  );
}
