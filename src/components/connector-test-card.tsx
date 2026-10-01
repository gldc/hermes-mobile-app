// src/components/connector-test-card.tsx — the Test button and its result (spec §5.3).
//
// A failed test shows the gateway's error text. That text is NOT redacted by the
// gateway (docs/contracts/mcp.md), so it is never logged and not selectable.
import { ActivityIndicator, Text, View } from 'react-native';
import type { McpTestOutcome } from '@/api/mcpSession';
import { CardButton } from '@/components/card-button';
import { testSummary } from '@/lib/mcp';
import { useTheme } from '@/theme';

export type ConnectorTestState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; outcome: McpTestOutcome };

function Result({ outcome }: { outcome: McpTestOutcome }) {
  const { colors } = useTheme();
  if (outcome.kind !== 'ok') {
    return (
      <Text selectable={false} style={{ color: colors.danger, fontSize: 14 }}>
        {outcome.message}
      </Text>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.success, fontSize: 14.5, fontWeight: '600' }}>{testSummary(outcome)}</Text>
      {outcome.tools.map((tool) => (
        <View key={tool.name} style={{ gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: '600' }}>{tool.name}</Text>
          {tool.description ? (
            <Text numberOfLines={3} style={{ color: colors.textDim, fontSize: 13.5 }}>
              {tool.description}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function ConnectorTestCard({
  state,
  connected,
  onTest,
}: {
  state: ConnectorTestState;
  /** False while no chat socket is available: Test cannot run. */
  connected: boolean;
  onTest: () => void;
}) {
  const { colors } = useTheme();
  const running = state.phase === 'running';
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
        gap: 12,
      }}
    >
      <CardButton label="Test connection" a11y="Test connection" onPress={onTest} disabled={running || !connected} />
      {!connected ? (
        <Text style={{ color: colors.textFaint, fontSize: 13 }}>
          Testing needs a connected chat. Go back to the chat, wait for it to connect, then return.
        </Text>
      ) : null}
      {running ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator color={colors.textDim} />
          <Text style={{ color: colors.textDim, fontSize: 14 }}>Testing…</Text>
        </View>
      ) : null}
      {state.phase === 'done' ? <Result outcome={state.outcome} /> : null}
    </View>
  );
}
