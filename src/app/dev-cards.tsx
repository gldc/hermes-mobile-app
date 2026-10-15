// src/app/dev-cards.tsx
//
// __DEV__-only gallery of the turn-control UI in every state, for simulator screenshots in both
// themes: `xcrun simctl openurl booted hermesmobileapp://dev-cards`. Release builds redirect away.
import { Redirect } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApprovalCard } from '@/components/approval-card';
import { ClarifyCard } from '@/components/clarify-card';
import { Composer } from '@/components/composer';
import { MessageRow, type ChatItem, type ToolInfo } from '@/components/message-row';
import { SecureEntryCard } from '@/components/secure-entry-card';
import { SubagentMonitorCard } from '@/components/subagent-monitor-card';
import { TodoCard } from '@/components/todo-card';
import { VaultDeclinedNote } from '@/components/vault-declined-note';
import type { SubagentBatch, SubagentState } from '@/lib/subagent-progress';
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
const devApproval = { session_id: 's', request_id: 'r', command: 'rm -rf build/ dist/', description: 'Recursive delete of two directories', pattern_key: 'recursive delete', choices: ['once', 'session', 'always', 'deny'] };
const devClarifyResponder = {
  clarifySingle: () => ({ ok: true as const }),
  clarifyLock: async () => 'ok' as const,
  clarifySubmitAll: async () => 'resolved' as const,
  clarifySkipAll: () => ({ ok: true as const }),
};
const devBatch = {
  session_id: 's',
  questions: [
    { qid: 'q0', question: 'Which environment should I deploy to?', choices: ['staging (Recommended)', 'production'], multi_select: false },
    { qid: 'q1', question: 'Which checks should run first?', choices: ['unit', 'lint', 'e2e'], multi_select: true },
    { qid: 'q2', question: 'Anything I should avoid?', choices: null, multi_select: false },
  ],
};

const devStarted = Date.now() - 83_000;
function devSubagent(over: Partial<SubagentState> & Pick<SubagentState, 'key' | 'goal' | 'status'>): SubagentState {
  return { taskIndex: 0, taskCount: 2, activity: '', log: [], toolCount: 0, startedAtMs: devStarted, ...over };
}
const devRunningBatch: SubagentBatch = {
  finalized: false,
  subagents: [
    devSubagent({ key: 'r1', goal: 'Audit the auth middleware', status: 'running', activity: 'read_file src/auth.ts', toolCount: 4, log: ['search_files "session"', 'read_file src/auth.ts'] }),
    devSubagent({ key: 'r2', goal: 'Draft the migration plan', status: 'completed', durationSeconds: 41, inputTokens: 9000, outputTokens: 3200, summary: 'Three steps, no downtime.', model: 'hermes-4' }),
  ],
};
const devDoneBatch: SubagentBatch = {
  finalized: true,
  subagents: [
    devSubagent({ key: 'd1', goal: 'Run the e2e suite', status: 'failed', durationSeconds: 95, summary: '2 specs failed: login, checkout.', costUsd: 0.04 }),
    devSubagent({ key: 'd2', goal: 'Refresh the fixtures', status: 'stopped', durationSeconds: 12, costUsd: 0.01 }),
  ],
};
const devTodos = [
  { id: '1', content: 'Read the existing tool row', status: 'completed' as const },
  { id: '2', content: 'Port Trace to React Native with the app theme, notes and nested detail', status: 'in_progress' as const },
  { id: '3', content: 'Move every step onto it', status: 'pending' as const },
  { id: '4', content: 'Ship a shimmer', status: 'cancelled' as const },
];
function devTool(key: string, tool: Omit<ToolInfo, 'id'>): ChatItem {
  return { key, role: 'tool', text: tool.name, tool: { id: key, ...tool } };
}

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
      <Section title="Trace">
        <MessageRow item={devTool('t1', { name: 'terminal', context: 'pnpm build', running: true })} />
        <MessageRow item={devTool('t2', { name: 'read_file', context: 'src/components/trace.tsx', running: false, durationS: 0.4, detail: 'export function Trace(…)' })} />
        <MessageRow item={devTool('t3', { name: 'terminal', context: 'pnpm lint', running: false, durationS: 12.6, outcome: 'failed', detail: 'error  Unexpected any  @typescript-eslint/no-explicit-any' })} />
        <MessageRow item={devTool('t4', { name: 'terminal', context: 'rm -rf dist/', running: false, outcome: 'denied', summary: 'You denied this command — it did not run.' })} />
        <MessageRow item={devTool('t5', { name: 'web_search', context: 'expo sdk 57 changelog', running: false, durationS: 3.2, outcome: 'interrupted' })} />
        <MessageRow item={{ key: 'r1', role: 'assistant', text: 'Done — the steps now render as lines.', complete: true, reasoning: 'The tool row is a card today. **Trace** wants a line: icon, title, description, status.' }} />
        <SubagentMonitorCard batch={devRunningBatch} />
        <SubagentMonitorCard batch={devDoneBatch} />
        <TodoCard items={devTodos} />
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
        <ApprovalCard card={devCard({ id: 'a5', kind: 'approval', method: 'approval', params: devApproval, status: 'answered', resolution: 'session' })} actionable={false} onRespond={() => {}} />
        <ApprovalCard card={devCard({ id: 'a6', kind: 'approval', method: 'approval', params: devApproval, status: 'answered', resolution: 'always' })} actionable={false} onRespond={() => {}} />
        <ApprovalCard card={devCard({ id: 'a7', kind: 'approval', method: 'approval', params: { ...devApproval, choices: ['once', 'deny'] } })} actionable onRespond={() => {}} />
        <ApprovalCard card={devCard({ id: 'a4', kind: 'approval', method: 'approval', params: devApproval, status: 'cancelled', cancelReason: 'interrupted' })} actionable={false} onRespond={() => {}} />
      </Section>
      <Section title="Clarify">
        <ClarifyCard
          card={devCard({ id: 'c1', kind: 'clarify', method: 'clarify', params: { session_id: 's', question: 'Tabs or spaces?', choices: ['Tabs (Recommended)', 'Spaces'] } })}
          responder={devClarifyResponder}
        />
        <ClarifyCard
          card={devCard({ id: 'c2', kind: 'clarify', method: 'clarify', params: devBatch, lockedAnswers: { q0: 'staging' } })}
          responder={devClarifyResponder}
        />
        <ClarifyCard
          card={devCard({ id: 'c3', kind: 'clarify', method: 'clarify', params: { session_id: 's', question: 'Why?', choices: null }, status: 'cancelled', cancelReason: 'timeout' })}
          responder={devClarifyResponder}
        />
      </Section>
      <Section title="Secure entry">
        <SecureEntryCard
          card={devCard({
            id: 's1',
            kind: 'secure-entry',
            method: 'secret',
            params: { session_id: 's', env_var: 'OPENWEATHER_API_KEY', prompt: 'Your OpenWeather API key (free tier is fine)', metadata: { skill_name: 'weather' } },
          })}
          provenance="agent"
          onSend={() => {}}
          onSkip={() => {}}
        />
        <SecureEntryCard
          card={devCard({ id: 's2', kind: 'secure-entry', method: 'sudo', params: { session_id: 's', command: 'apt-get install -y jq' } })}
          provenance={null}
          onSend={() => {}}
          onSkip={() => {}}
        />
        <SecureEntryCard
          card={devCard({ id: 's3', kind: 'secure-entry', method: 'secret', params: { session_id: 's', env_var: 'K', prompt: 'p' }, status: 'answered' })}
          provenance="unknown"
          onSend={() => {}}
          onSkip={() => {}}
        />
      </Section>
      <Section title="Vault">
        <VaultDeclinedNote />
      </Section>
      {/* dev-cards:end */}
    </ScrollView>
  );
}
