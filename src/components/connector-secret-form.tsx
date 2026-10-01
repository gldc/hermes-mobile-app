// src/components/connector-secret-form.tsx — the submit step of the "add connector" forms, and
// the ONLY owner of any secret typed into them (spec §5.9, AGENTS.md "Secure entry").
//
// A value typed here lives in this component's state and goes straight into `onSubmit`'s
// argument: never into the screen's state, route params, a store, an error or a log. When the
// request carries any value, Face ID (device-passcode fallback) runs immediately before it; a
// failed or cancelled check sends nothing. With no fields it is just the submit button.
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View, useWindowDimensions } from 'react-native';
import { CardButton } from '@/components/card-button';
import { confirmWithBiometrics, type BiometricOutcome } from '@/lib/biometric';
import { collectSecretValues, type SecretField } from '@/lib/mcp';
import { useTheme } from '@/theme';

/** `message` may be '' when the screen already handled the failure (e.g. it left for sign-in). */
export type SubmitResult = { ok: true } | { ok: false; message: string };

const AUTH_NOTES = {
  cancelled: 'Cancelled. Nothing was sent.',
  unavailable: 'Set up Face ID or a device passcode to send this.',
  failed: "Face ID didn't match. Nothing was sent.",
} as const;

export function ConnectorSecretForm({
  fields,
  submitLabel,
  busyLabel = 'Adding…',
  beforeSubmit,
  onSubmit,
  authenticate = confirmWithBiometrics,
}: {
  /** The secret fields; may be empty, and then no Face ID is asked. */
  fields: SecretField[];
  submitLabel: string;
  busyLabel?: string;
  /** The screen's own checks (name, URL). Returning false stops before Face ID. */
  beforeSubmit?: () => boolean;
  /** Receives the non-blank values. Must not throw, and must not keep the argument. */
  onSubmit: (values: Record<string, string>) => Promise<SubmitResult>;
  authenticate?: (reason: string) => Promise<BiometricOutcome>;
}) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(false);
  // A latch, not the `busy` state: two presses in one tick must not both get through.
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit() {
    if (inFlight.current) return;
    setNote(null);
    if (beforeSubmit && !beforeSubmit()) return;
    const { env, missing } = collectSecretValues(fields, values);
    if (missing) {
      setNote(`${missing.label} is required.`);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    if (Object.keys(env).length > 0) {
      const outcome = await authenticate('Send this to your gateway');
      if (!mounted.current) return; // left during the prompt: send nothing
      if (!outcome.ok) {
        inFlight.current = false;
        setBusy(false);
        setNote(AUTH_NOTES[outcome.reason]);
        return;
      }
    }
    let result: SubmitResult;
    try {
      result = await onSubmit(env);
    } catch {
      // Never show (or keep) what was thrown: it could carry a value.
      result = { ok: false, message: 'Something went wrong. Check the list before trying again.' };
    }
    if (!mounted.current) return;
    if (result.ok) {
      setValues({}); // and stay busy: the screen is navigating away
      return;
    }
    inFlight.current = false;
    setBusy(false);
    if (result.message) setNote(result.message);
  }

  return (
    <View style={{ gap: 12 }}>
      {fields.map((field) => (
        <View key={field.key} style={{ gap: 6 }}>
          <Text style={{ color: colors.textDim, fontSize: 13, fontWeight: '600' }}>
            {field.label}
            {field.required ? '' : ' (optional)'}
          </Text>
          <TextInput
            value={values[field.key] ?? ''}
            onChangeText={(text) => setValues((prev) => ({ ...prev, [field.key]: text }))}
            editable={!busy}
            secureTextEntry={field.masked}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            // Never offer to save a connector credential to Passwords, and never suggest one.
            textContentType="none"
            autoComplete="off"
            accessibilityLabel={field.label}
            placeholder={field.masked ? 'Paste the value' : 'Enter the value'}
            placeholderTextColor={colors.placeholder}
            style={{
              color: colors.text,
              backgroundColor: colors.surface,
              borderRadius: 10,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 12,
              minHeight: 44,
              paddingVertical: Math.round(10 * Math.min(fontScale, 2)),
              fontSize: 16,
            }}
          />
        </View>
      ))}
      {fields.length > 0 ? (
        <Text style={{ color: colors.textFaint, fontSize: 12.5 }}>
          Sent to your gateway and stored there. The app does not keep it.
        </Text>
      ) : null}
      {note ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontSize: 13.5 }}>
          {note}
        </Text>
      ) : null}
      <CardButton
        label={busy ? busyLabel : fields.length > 0 ? `${submitLabel} with Face ID` : submitLabel}
        a11y={submitLabel}
        onPress={() => void submit()}
        disabled={busy}
        primary
      />
    </View>
  );
}
