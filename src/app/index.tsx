import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AuthError } from '@/api/restClient';
import { connect, restore } from '@/connection';
import { useTheme } from '@/theme';

export { RouteError as ErrorBoundary } from '@/components/route-error';

export default function ConnectScreen() {
  const { colors } = useTheme();
  const [url, setUrl] = useState('http://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    restore()
      .then((ok) => {
        if (ok) router.replace('/sessions');
      })
      .catch(() => setError('Saved connection failed — is your VPN or Wi-Fi up?'))
      .finally(() => {
        setBusy(false);
        setRestoring(false);
      });
  }, []);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      await connect(url.trim(), username.trim(), password);
      router.replace('/sessions');
    } catch (e) {
      if (e instanceof AuthError) setError('Invalid username or password.');
      else setError('Could not reach the gateway. Check the address and your network.');
    } finally {
      setBusy(false);
    }
  }

  if (restoring && !error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const inputStyle = {
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  } as const;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 28 }}
        style={{ backgroundColor: colors.bg }}
      >
        <View style={{ alignItems: 'center', gap: 14 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 22,
              borderCurve: 'continuous',
              backgroundColor: colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 28px rgba(217, 162, 74, 0.35)',
            }}
          >
            <Image source="sf:paperplane.fill" style={{ width: 32, height: 32 }} tintColor={colors.onAccent} />
          </View>
          <Text style={{ color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 }}>Hermes</Text>
          <Text style={{ color: colors.textDim, fontSize: 15, textAlign: 'center' }}>
            Your agent, in your pocket.{'\n'}Connects over your private network.
          </Text>
        </View>

        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
          }}
        >
          <TextInput
            style={inputStyle}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="Gateway URL — http://100.x.y.z:9119"
            placeholderTextColor={colors.textFaint}
          />
          <View style={{ height: 1, backgroundColor: colors.border }} />
          <TextInput
            style={inputStyle}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            placeholder="Username"
            placeholderTextColor={colors.textFaint}
          />
          <View style={{ height: 1, backgroundColor: colors.border }} />
          <TextInput
            style={inputStyle}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            placeholder="Password"
            placeholderTextColor={colors.textFaint}
            onSubmitEditing={onConnect}
          />
        </View>

        {error ? (
          <Text selectable style={{ color: colors.danger, fontSize: 14.5, textAlign: 'center' }}>
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={onConnect}
          disabled={busy}
          style={({ pressed }) => ({
            backgroundColor: pressed ? colors.accentPressed : colors.accent,
            opacity: busy ? 0.6 : 1,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
          })}
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={{ color: colors.onAccent, fontSize: 16.5, fontWeight: '600' }}>Connect</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
