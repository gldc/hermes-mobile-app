// src/app/dev-cards.tsx
//
// __DEV__-only gallery of the turn-control UI in every state, for simulator screenshots in both
// themes: `xcrun simctl openurl booted hermesmobileapp://dev-cards`. Release builds redirect away.
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageRow } from '@/components/message-row';
import { useTheme } from '@/theme';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.textFaint, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{title}</Text>
      {children}
    </View>
  );
}

export default function DevCards() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40, gap: 24 }}
    >
      <Section title="Transcript markers">
        <MessageRow item={{ key: 'd1', role: 'user', text: 'Actually, use tabs.', complete: true, steered: true }} />
        <MessageRow item={{ key: 'd2', role: 'status', text: 'Stopped', marker: 'stopped' }} />
      </Section>
      {/* dev-cards:end */}
    </ScrollView>
  );
}
