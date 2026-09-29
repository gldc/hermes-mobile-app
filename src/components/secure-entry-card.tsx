// src/components/secure-entry-card.tsx — sudo / secret prompt (spec §6.4).
//
// DATA RULE: the typed value exists only in SecureEntryForm's local state. The form is rendered only
// while the card is open, so every exit path (send, skip, request.cancel, interrupt, local timeout,
// unmount) unmounts it and the value is gone. It is never lifted, logged, or put in the turn controller.
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View, type HostInstance } from 'react-native';
import { CardButton } from '@/components/card-button';
import { Icon } from '@/components/icon';
import { confirmWithBiometrics, type BiometricOutcome } from '@/lib/biometric';
import {
  countdownA11y,
  formatCountdown,
  provenanceText,
  secondsRemaining,
  secureEntryCopy,
  type ProvenanceLabel,
  type SecureEntryCopy,
} from '@/lib/secure-entry';
import { cancelLabel, type RequestCardState } from '@/lib/turn-controller';
import { useTheme, type ThemeColors } from '@/theme';

export interface SecureEntryCardProps {
  card: RequestCardState;
  /** Secret cards: provenance of `metadata.skill_name`; null while the lookup runs. */
  provenance: ProvenanceLabel | null;
  onSend: (value: string) => void;
  onSkip: () => void;
  authenticate?: (reason: string) => Promise<BiometricOutcome>;
  now?: () => number;
  /** The field got focus: the screen measures that field (not the card) and scrolls it above the keyboard.
   *  Only a measure callback leaves the form — the field instance's props hold the value. */
  onInputFocus?: (measureField: HostInstance['measureInWindow']) => void;
}

const AUTH_NOTES = {
  cancelled: 'Cancelled. Nothing was sent.',
  unavailable: 'Set up Face ID or a device passcode to send this.',
  failed: "Face ID didn't match. Nothing was sent.",
} as const;

function SecureEntryForm({
  copy,
  authenticate,
  stillOpen,
  onSend,
  onSkip,
  onInputFocus,
}: {
  copy: SecureEntryCopy;
  authenticate: (reason: string) => Promise<BiometricOutcome>;
  /** Re-reads the clock after Face ID; false (the card then closes) if the local timeout passed. */
  stillOpen: () => boolean;
  onSend: (value: string) => void;
  onSkip: () => void;
  onInputFocus?: (measureField: HostInstance['measureInWindow']) => void;
}) {
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [value, setValue] = useState('');
  const [authing, setAuthing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function send() {
    if (!value || authing) return;
    setAuthing(true);
    setNote(null);
    const outcome = await authenticate(copy.authReason);
    if (!mounted.current) return; // cancelled, interrupted or unmounted during the prompt: send nothing
    if (!stillOpen()) return; // timed out during the prompt, before a countdown tick closed the card
    setAuthing(false);
    if (!outcome.ok) {
      setNote(AUTH_NOTES[outcome.reason]);
      return;
    }
    const toSend = value;
    setValue('');
    onSend(toSend);
  }

  function skip() {
    setValue('');
    onSkip();
  }

  return (
    <View style={{ gap: 10 }}>
      <TextInput
        value={value}
        onChangeText={setValue}
        ref={inputRef}
        onFocus={() => onInputFocus?.((cb) => inputRef.current?.measureInWindow(cb))}
        editable={!authing}
        secureTextEntry
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        textContentType={copy.textContentType}
        autoComplete={copy.textContentType === 'password' ? 'current-password' : 'off'}
        placeholder={copy.placeholder}
        placeholderTextColor={colors.placeholder}
        accessibilityLabel={copy.fieldLabel}
        style={{
          color: colors.text,
          backgroundColor: colors.surface,
          borderRadius: 10,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 12,
          height: 44,
          fontSize: 16,
        }}
      />
      {note ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontSize: 13 }}>
          {note}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <CardButton label="Skip" a11y="Skip, don't send a value" onPress={skip} disabled={authing} flex />
        <CardButton
          label={authing ? 'Checking…' : 'Send with Face ID'}
          a11y="Send with Face ID"
          onPress={() => void send()}
          disabled={!value || authing}
          primary
          flex
        />
      </View>
    </View>
  );
}

function settledRow(card: RequestCardState, colors: ThemeColors): { label: string; icon: string; tint: string } {
  switch (card.status) {
    case 'answered':
      return { label: 'Sent', icon: 'checkmark.circle.fill', tint: colors.success };
    case 'answering':
      return { label: 'Sending…', icon: 'hourglass', tint: colors.textFaint };
    case 'skipped':
      return { label: 'Skipped', icon: 'slash.circle', tint: colors.textFaint };
    case 'cancelled':
      return { label: card.cancelReason ? cancelLabel(card.cancelReason) : 'Closed', icon: 'slash.circle', tint: colors.textFaint };
    case 'pending': // still pending but past the local deadline
      return { label: 'Timed out', icon: 'slash.circle', tint: colors.textFaint };
  }
}

export function SecureEntryCard({
  card,
  provenance,
  onSend,
  onSkip,
  authenticate = confirmWithBiometrics,
  now = Date.now,
  onInputFocus,
}: SecureEntryCardProps) {
  const { colors } = useTheme();
  const copy = secureEntryCopy(card);
  const [nowMs, setNowMs] = useState(() => now());
  const pending = card.status === 'pending';
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNowMs(now()), 1000);
    return () => clearInterval(t);
  }, [pending, now]);
  const remaining = secondsRemaining(copy.method, card.receivedAt, nowMs);
  const open = pending && remaining > 0;
  const settled = settledRow(card, colors);

  function stillOpen(): boolean {
    const t = now();
    setNowMs(t);
    return secondsRemaining(copy.method, card.receivedAt, t) > 0;
  }

  return (
    <View
      accessibilityLabel={copy.method === 'sudo' ? 'Administrator password request' : `Secret request: ${copy.title}`}
      style={{
        backgroundColor: colors.raised,
        borderRadius: 16,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: open ? colors.accent : colors.border,
        padding: 14,
        gap: 10,
        marginVertical: 6,
        alignSelf: 'stretch',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon sf="lock.fill" size={14} color={open ? colors.accent : colors.textFaint} />
        {/* Never clamped: the env var name is the key fact on a secret card (sim S1 V2). */}
        <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: '700', flexShrink: 1 }}>
          {copy.title}
        </Text>
        <View style={{ flex: 1 }} />
        {open ? (
          <View accessible accessibilityLabel={countdownA11y(remaining)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon sf="hourglass" size={12} color={remaining <= 30 ? colors.danger : colors.textFaint} />
            <Text style={{ color: remaining <= 30 ? colors.danger : colors.textFaint, fontSize: 12.5, fontVariant: ['tabular-nums'] }}>
              {formatCountdown(remaining)}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.textFaint, fontSize: 12, fontWeight: '600' }}>Requested by the agent</Text>
        {copy.ask ? (
          <Text selectable style={{ color: colors.text, fontSize: 14.5, lineHeight: 20 }}>
            {copy.ask}
          </Text>
        ) : null}
        {copy.command ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: 10, borderCurve: 'continuous', padding: 10 }}>
            <Text selectable style={{ color: colors.text, fontFamily: 'Menlo', fontSize: 12.5, lineHeight: 18 }}>
              {copy.command}
            </Text>
          </View>
        ) : null}
      </View>

      {copy.method === 'secret' ? (
        <Text style={{ color: colors.textDim, fontSize: 13 }}>
          {`Skill: ${copy.skillName ?? 'unknown'} · source: ${provenance === null ? 'checking…' : provenanceText(provenance)}`}
        </Text>
      ) : null}

      {copy.warning ? (
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            padding: 10,
            borderRadius: 10,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: colors.danger,
            backgroundColor: colors.surface,
          }}
        >
          <Icon sf="exclamationmark.shield.fill" size={14} color={colors.danger} />
          <Text style={{ color: colors.text, fontSize: 13.5, lineHeight: 19, flexShrink: 1 }}>{copy.warning}</Text>
        </View>
      ) : null}
      {copy.destination ? <Text style={{ color: colors.textDim, fontSize: 12.5 }}>{copy.destination}</Text> : null}

      {open ? (
        <SecureEntryForm
          key={card.id}
          copy={copy}
          authenticate={authenticate}
          stillOpen={stillOpen}
          onSend={onSend}
          onSkip={onSkip}
          onInputFocus={onInputFocus}
        />
      ) : (
        <View accessibilityLabel={settled.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon sf={settled.icon} size={14} color={settled.tint} />
          <Text style={{ color: settled.tint, fontSize: 13.5, fontWeight: '600' }}>{settled.label}</Text>
        </View>
      )}
    </View>
  );
}
