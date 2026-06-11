import { Image } from 'expo-image';
import { router } from 'expo-router';
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
import { Starburst } from '@/components/starburst';
import { connect, restore } from '@/connection';
import { maybeRegisterPush } from '@/notifications';
import { serif, useTheme } from '@/theme';

export { RouteError as ErrorBoundary } from '@/components/route-error';

export default function ConnectScreen() {
  const { colors } = useTheme();
  const [url, setUrl] = useState('http://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [restoring, setRestoring] = useState(true);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    restore()
      .then((ok) => {
        if (ok) {
          router.replace('/chat/new');
          // Refresh a stale (>7 days) push registration; never prompts here.
          void maybeRegisterPush({ softAsk: false });
        }
      })
      .catch((e) => {
        // Device-mode restore throws AuthError(REPAIR_MESSAGE) when the
        // pairing is revoked — surface that verbatim so the fix is obvious.
        if (e instanceof AuthError) setError(e.message);
        else setError('Saved connection failed — is your VPN or Wi-Fi up?');
      })
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
      router.replace('/chat/new');
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
        <View style={{ alignItems: 'center', gap: 16 }}>
          <Starburst size={56} />
          <Text style={{ fontFamily: serif, color: colors.text, fontSize: 34 }}>Hermes</Text>
          <Text style={{ color: colors.textDim, fontSize: 15, textAlign: 'center' }}>
            Your agent, in your pocket.{'\n'}Connects over your private network.
          </Text>
        </View>

        {error ? (
          <Text selectable style={{ color: colors.danger, fontSize: 14.5, textAlign: 'center' }}>
            {error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pair with QR code"
          onPress={() => router.push('/pair')}
          disabled={busy}
          style={({ pressed }) => ({
            backgroundColor: pressed ? colors.accentPressed : colors.accent,
            opacity: busy ? 0.6 : 1,
            borderRadius: 999,
            minHeight: 52,
            flexDirection: 'row',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'center',
          })}
        >
          <Image source="sf:qrcode.viewfinder" style={{ width: 20, height: 20 }} tintColor={colors.onAccent} />
          <Text style={{ color: colors.onAccent, fontSize: 16.5, fontWeight: '600' }}>Pair with QR code</Text>
        </Pressable>

        {showPasswordForm ? (
          <View style={{ gap: 16 }}>
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

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Connect with username and password"
              onPress={onConnect}
              disabled={busy}
              style={({ pressed }) => ({
                borderRadius: 999,
                borderWidth: 1,
                borderColor: pressed ? colors.accentPressed : colors.accent,
                opacity: busy ? 0.6 : 1,
                minHeight: 50,
                alignItems: 'center',
                justifyContent: 'center',
              })}
            >
              {busy ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={{ color: colors.accent, fontSize: 16, fontWeight: '600' }}>Connect</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use password instead"
            onPress={() => setShowPasswordForm(true)}
            style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: colors.textDim, fontSize: 15.5 }}>Use password instead</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
