// __tests__/secure-entry.test.ts
import {
  countdownA11y, formatCountdown, provenanceFor, provenanceText, secondsRemaining, secureEntryCopy, skillNameOf,
} from '../src/lib/secure-entry';
import type { RequestCardState } from '../src/lib/turn-controller';

const card = (method: 'secret' | 'sudo', params: Record<string, unknown>): RequestCardState => ({
  id: 'srq-s', kind: 'secure-entry', method, params: { session_id: 's', ...params }, status: 'pending',
  legacy: false, receivedAt: 0, anchorKey: null,
});

test('timeouts: secret 300 s, sudo 120 s, never negative', () => {
  expect(secondsRemaining('secret', 1_000, 1_000)).toBe(300);
  expect(secondsRemaining('sudo', 1_000, 1_000)).toBe(120);
  expect(secondsRemaining('secret', 0, 60_500)).toBe(240);
  expect(secondsRemaining('sudo', 0, 999_999)).toBe(0);
});
test('countdown text and VoiceOver label', () => {
  expect(formatCountdown(300)).toBe('5:00');
  expect(formatCountdown(61)).toBe('1:01');
  expect(countdownA11y(61)).toBe('1 minute 1 second remaining');
  expect(countdownA11y(120)).toBe('2 minutes remaining');
});
test('skill name and provenance, "unknown" whenever the lookup cannot answer', () => {
  const skills = [{ name: 'weather', description: '', category: '', enabled: true, provenance: 'bundled' as const }];
  expect(skillNameOf({ session_id: 's', env_var: 'K', prompt: 'p', metadata: { skill_name: 'weather' } })).toBe('weather');
  expect(skillNameOf({ session_id: 's', env_var: 'K', prompt: 'p' })).toBeNull();
  expect(provenanceFor(skills, 'weather')).toBe('bundled');
  expect(provenanceFor(skills, 'other')).toBe('unknown');
  expect(provenanceFor(null, 'weather')).toBe('unknown');
  expect(provenanceFor([{ ...skills[0], provenance: undefined }], 'weather')).toBe('unknown');
  expect(provenanceText('hub')).toBe('Skills Hub');
  expect(provenanceText('unknown')).toBe('unknown');
});
test('secret copy: title, ask, warning, destination, no keychain autofill', () => {
  const c = secureEntryCopy(card('secret', { env_var: 'OPENWEATHER_API_KEY', prompt: 'Your API key', metadata: { skill_name: 'weather' } }));
  expect(c).toMatchObject({
    method: 'secret',
    title: 'Value for OPENWEATHER_API_KEY',
    ask: 'Your API key',
    command: null,
    textContentType: 'none',
    warning: "Only continue if you asked for this — the agent can write or edit the skill that's asking.",
    destination: "Saved to the gateway's .env — the agent can read it.",
    skillName: 'weather',
    fieldLabel: 'Value for OPENWEATHER_API_KEY',
  });
});
test('sudo copy: password autofill, command shown, no warning', () => {
  const c = secureEntryCopy(card('sudo', { command: 'apt-get install jq' }));
  expect(c).toMatchObject({ method: 'sudo', title: 'Administrator password', ask: null, command: 'apt-get install jq', textContentType: 'password', warning: null, destination: null, fieldLabel: 'Administrator password' });
});
