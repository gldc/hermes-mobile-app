// src/components/connector-row.tsx — one configured MCP connector in the list (spec §5.2).
import { Pressable, Switch, Text, View } from 'react-native';
import type { McpServer } from '@/api/mcp';
import { connectorBadges, serverCapabilities, serverSubtitle } from '@/lib/mcp';
import { useTheme } from '@/theme';

function Badge({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.raised,
        borderRadius: 6,
        borderCurve: 'continuous',
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color: colors.textDim, fontSize: 11.5, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function ConnectorRow({
  server,
  status,
  onPress,
  onToggle,
}: {
  server: McpServer;
  /** The runtime status line, or null when it is not available. */
  status: string | null;
  onPress: (server: McpServer) => void;
  onToggle: (server: McpServer) => void;
}) {
  const { colors } = useTheme();
  const caps = serverCapabilities(server);
  const subtitle = serverSubtitle(server);
  const badges = connectorBadges(server);
  // The label replaces the children for VoiceOver, so the badges and the note go into it.
  const a11y = [
    `${server.name} connector`,
    subtitle,
    ...badges,
    status,
    server.enabled ? null : 'switched off',
    caps.manageable ? null : 'cannot be changed from the app',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Shows connector details"
      onPress={() => onPress(server)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: pressed ? colors.raised : colors.surface,
        borderRadius: 16,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
        minHeight: 44,
      })}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text
            numberOfLines={1}
            style={{
              color: server.enabled ? colors.text : colors.textDim,
              fontSize: 16,
              fontWeight: '600',
              flexShrink: 1,
            }}
          >
            {server.name}
          </Text>
          {badges.map((label) => (
            <Badge key={label} label={label} />
          ))}
        </View>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 13.5 }}>
            {subtitle}
          </Text>
        ) : null}
        {status ? (
          <Text numberOfLines={1} style={{ color: status === 'Failed' ? colors.danger : colors.textDim, fontSize: 13 }}>
            {status}
          </Text>
        ) : null}
        {!caps.manageable ? (
          <Text style={{ color: colors.textFaint, fontSize: 12.5 }}>
            Can’t be changed from the app: its name contains “/”.
          </Text>
        ) : null}
      </View>
      {caps.canSwitch ? (
        <Switch
          value={server.enabled}
          onValueChange={() => onToggle(server)}
          accessibilityLabel={`${server.name} ${server.enabled ? 'on, double tap to switch off' : 'off, double tap to switch on'}`}
          trackColor={{ true: colors.accent }}
          hitSlop={8}
        />
      ) : null}
    </Pressable>
  );
}
