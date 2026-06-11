// src/app/pair.tsx — QR device pairing (docs/contracts/pairing.md)
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { Stack, router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { connectWithDevice } from '@/connection';
import { PairingParseError, PairingPayload, pairingHost, parsePairingPayload } from '@/lib/pairing';
import { useTheme } from '@/theme';

export { RouteError as ErrorBoundary } from '@/components/route-error';

export default function PairScreen() {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [pending, setPending] = useState<PairingPayload | null>(null);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scanLocked = useRef(false); // QR fires repeatedly; latch the first hit

  function handlePayload(text: string) {
    try {
      setPending(parsePairingPayload(text));
      setError(null);
    } catch (e) {
      scanLocked.current = false;
      setError(e instanceof PairingParseError ? e.message : 'Could not read that pairing code.');
    }
  }

  function onScanned({ data }: { data: string }) {
    if (scanLocked.current || pending || busy) return;
    scanLocked.current = true;
    handlePayload(data);
  }

  function rescan() {
    scanLocked.current = false;
    setPending(null);
    setError(null);
  }

  async function onConfirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await connectWithDevice(pending.url, pending.rt, pending.deviceId);
      router.replace('/sessions');
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'Could not reach the gateway. Check the address and your network.',
      );
      // The scanned RT is single-use only on success — a failed refresh means
      // it is dead either way, so force a fresh scan rather than a retry.
      scanLocked.current = false;
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const canUseCamera = permission?.granted === true;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Pair Device' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 20 }}
        style={{ backgroundColor: colors.bg }}
      >
        <Text style={{ color: colors.textDim, fontSize: 15, lineHeight: 21 }}>
          Run <Text style={{ color: colors.text, fontWeight: '600' }}>hermes mobile pair</Text> on your
          gateway, then scan the QR code it prints.
        </Text>

        {/* Scanner / confirm card */}
        <View
          style={{
            borderRadius: 20,
            borderCurve: 'continuous',
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          {pending ? (
            <View style={{ padding: 20, gap: 16, alignItems: 'center' }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  borderCurve: 'continuous',
                  backgroundColor: colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Image source="sf:checkmark.seal.fill" style={{ width: 26, height: 26 }} tintColor={colors.onAccent} />
              </View>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>Pair with this gateway?</Text>
                <Text selectable style={{ color: colors.textDim, fontSize: 15, textAlign: 'center' }}>
                  {pairingHost(pending.url)}
                </Text>
                <Text style={{ color: colors.textFaint, fontSize: 13 }}>device {pending.deviceId}</Text>
              </View>
              <View style={{ alignSelf: 'stretch', gap: 10 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Connect to ${pairingHost(pending.url)}`}
                  onPress={onConfirm}
                  disabled={busy}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? colors.accentPressed : colors.accent,
                    opacity: busy ? 0.6 : 1,
                    borderRadius: 999,
                    minHeight: 50,
                    alignItems: 'center',
                    justifyContent: 'center',
                  })}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <Text style={{ color: colors.onAccent, fontSize: 16.5, fontWeight: '600' }}>Connect</Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel and scan again"
                  onPress={rescan}
                  disabled={busy}
                  style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.textDim, fontSize: 15.5 }}>Scan again</Text>
                </Pressable>
              </View>
            </View>
          ) : canUseCamera ? (
            <CameraView
              style={{ height: 320 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onScanned}
              accessibilityLabel="Camera viewfinder for scanning the pairing QR code"
            />
          ) : (
            <View style={{ padding: 24, gap: 14, alignItems: 'center' }}>
              <Image source="sf:qrcode.viewfinder" style={{ width: 44, height: 44 }} tintColor={colors.textFaint} />
              <Text style={{ color: colors.textDim, fontSize: 15, textAlign: 'center' }}>
                {permission?.canAskAgain === false
                  ? 'Camera access is off. Enable it in Settings, or paste the pairing code below.'
                  : 'Hermes needs camera access to scan the pairing QR code.'}
              </Text>
              {permission?.canAskAgain !== false ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Allow camera access"
                  onPress={() => requestPermission()}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? colors.accentPressed : colors.accent,
                    borderRadius: 999,
                    minHeight: 44,
                    paddingHorizontal: 24,
                    alignItems: 'center',
                    justifyContent: 'center',
                  })}
                >
                  <Text style={{ color: colors.onAccent, fontSize: 15.5, fontWeight: '600' }}>Allow camera</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        {error ? (
          <Text selectable style={{ color: colors.danger, fontSize: 14.5, textAlign: 'center' }}>
            {error}
          </Text>
        ) : null}

        {/* Manual-paste fallback (simulators, no-qrcode-package gateways) */}
        {!pending ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: colors.textFaint, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Or paste the pairing code
            </Text>
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
                style={{ color: colors.text, fontSize: 15, paddingHorizontal: 16, paddingVertical: 14, minHeight: 72 }}
                value={pasted}
                onChangeText={setPasted}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                placeholder='{"url":"http://…:9119","rt":"…","device_id":"…"}'
                placeholderTextColor={colors.textFaint}
                accessibilityLabel="Pairing code JSON"
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use pasted pairing code"
              onPress={() => handlePayload(pasted)}
              disabled={!pasted.trim() || busy}
              style={({ pressed }) => ({
                opacity: !pasted.trim() || busy ? 0.5 : pressed ? 0.7 : 1,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
              })}
            >
              <Text style={{ color: colors.accent, fontSize: 16, fontWeight: '600' }}>Use pasted code</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
