// src/app/dev-cards.tsx
//
// __DEV__-only gallery of the turn-control UI in every state, for simulator screenshots in both
// themes: `xcrun simctl openurl booted hermesmobileapp://dev-cards`. Release builds redirect away.
import { Redirect } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApprovalCard } from '@/components/approval-card';
import { Composer } from '@/components/composer';
import { MessageRow } from '@/components/message-row';
import type { ComposerMode, RequestCardState } from '@/lib/turn-controller';
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

function devCard(over: Partial<RequestCardState> & Pick<RequestCardState, 'id' | 'kind' | 'method' | 'params'>): RequestCardState {
  return { status: 'pending', legacy: false, receivedAt: Date.now(), anchorKey: null, ...over };
}
const devApproval = { session_id: 's', request_id: 'r', command: 'rm -rf build/ dist/', description: 'Recursive delete of two directories' };

function DevComposer({ mode, initial = '', image = false }: { mode: ComposerMode; initial?: string; image?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <Composer
      value={value}
      onChangeText={setValue}
      mode={mode}
      onSend={() => {}}
      onStop={() => {}}
      onSteer={() => {}}
      stagedImageUri={image ? 'https://picsum.photos/seed/hermes/128' : null}
    />
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
      <Section title="Composer">
        <DevComposer mode={{ kind: 'send', enabled: false }} />
        <DevComposer mode={{ kind: 'stop+steer', stopEnabled: true, steerEnabled: false }} />
        <DevComposer mode={{ kind: 'stop+steer', stopEnabled: true, steerEnabled: true }} initial="Actually, use tabs." />
        <DevComposer mode={{ kind: 'stop+steer', stopEnabled: false, steerEnabled: false }} initial="Actually, use tabs." />
        <DevComposer mode={{ kind: 'stop+steer', stopEnabled: true, steerEnabled: false }} image />
      </Section>
      <Section title="Approval">
        <ApprovalCard card={devCard({ id: 'a1', kind: 'approval', method: 'approval', params: devApproval })} actionable onRespond={() => {}} />
        <ApprovalCard card={devCard({ id: 'a2', kind: 'approval', method: 'approval', params: devApproval, legacy: true })} actionable={false} onRespond={() => {}} />
        <ApprovalCard card={devCard({ id: 'a3', kind: 'approval', method: 'approval', params: devApproval, status: 'answered', resolution: 'deny' })} actionable={false} onRespond={() => {}} />
        <ApprovalCard card={devCard({ id: 'a4', kind: 'approval', method: 'approval', params: devApproval, status: 'cancelled', cancelReason: 'interrupted' })} actionable={false} onRespond={() => {}} />
      </Section>
      {/* dev-cards:end */}
    </ScrollView>
  );
}
