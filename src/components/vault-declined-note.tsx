// src/components/vault-declined-note.tsx — vault.* requests are answered -32601 by A's routing (spec §6.3).
import { Text, View } from 'react-native';
import { Icon } from '@/components/icon';
import { useTheme } from '@/theme';

export const VAULT_DECLINED_TEXT = 'Hermes asked for a password-manager action — declined on the phone.';

export function VaultDeclinedNote() {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={VAULT_DECLINED_TEXT} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
      <Icon sf="key" size={12} color={colors.textFaint} />
      <Text style={{ color: colors.textFaint, fontSize: 12.5, flexShrink: 1 }}>{VAULT_DECLINED_TEXT}</Text>
    </View>
  );
}
