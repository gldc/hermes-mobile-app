// src/lib/secure-entry.ts — copy, countdown and provenance for sudo/secret cards (spec §6.4).
// Nothing here ever sees the typed value.
import type { SkillInfo } from '@/api/skills';
import type { RequestCardState } from '@/lib/turn-controller';
import type { SecretRequestParams, SudoRequestParams } from '@/vendor/hermes-gateway';

export const SECURE_ENTRY_TIMEOUT_S = { secret: 300, sudo: 120 } as const;
export type SecureMethod = keyof typeof SECURE_ENTRY_TIMEOUT_S;
export type ProvenanceLabel = NonNullable<SkillInfo['provenance']> | 'unknown';

export function secondsRemaining(method: SecureMethod, receivedAt: number, nowMs: number): number {
  return Math.max(0, Math.ceil(SECURE_ENTRY_TIMEOUT_S[method] - (nowMs - receivedAt) / 1000));
}

export function formatCountdown(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function countdownA11y(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  const parts = [m ? `${m} minute${m === 1 ? '' : 's'}` : '', r ? `${r} second${r === 1 ? '' : 's'}` : ''].filter(Boolean);
  return `${parts.join(' ') || '0 seconds'} remaining`;
}

export function skillNameOf(params: SecretRequestParams): string | null {
  const n = params.metadata?.skill_name;
  return typeof n === 'string' && n.trim() ? n.trim() : null;
}

export function provenanceFor(skills: SkillInfo[] | null, skillName: string | null): ProvenanceLabel {
  if (!skills || !skillName) return 'unknown';
  return skills.find((s) => s.name === skillName)?.provenance ?? 'unknown';
}

/** The latest skills lookup: the pending secret-card ids it was made for, and its result (null = failed). */
export interface SkillsLookup {
  ids: string[];
  list: SkillInfo[] | null;
}

/**
 * Provenance for one secret card, or null while its lookup is in flight ("checking…"). A lookup
 * covers the cards it was made for, so a newer card arriving never resets an older one. A settled
 * card has no lookup of its own coming: it uses the last result, or "unknown" if there never was one.
 */
export function provenanceForCard(card: RequestCardState, lookup: SkillsLookup | null): ProvenanceLabel | null {
  const covered = lookup !== null && lookup.ids.includes(card.id);
  if (!covered && card.status === 'pending') return null;
  return provenanceFor(lookup?.list ?? null, skillNameOf(card.params as SecretRequestParams));
}

export function provenanceText(p: ProvenanceLabel): string {
  return { hub: 'Skills Hub', bundled: 'bundled with Hermes', agent: 'written by the agent', unknown: 'unknown' }[p];
}

export interface SecureEntryCopy {
  method: SecureMethod;
  title: string;
  ask: string | null;
  command: string | null;
  textContentType: 'password' | 'none';
  warning: string | null;
  destination: string | null;
  skillName: string | null;
  fieldLabel: string;
  placeholder: string;
  authReason: string;
}

export function secureEntryCopy(card: RequestCardState): SecureEntryCopy {
  if (card.method === 'sudo') {
    const p = card.params as SudoRequestParams;
    return {
      method: 'sudo', title: 'Administrator password', ask: null, command: p.command || null,
      textContentType: 'password', warning: null, destination: null, skillName: null,
      fieldLabel: 'Administrator password', placeholder: 'Password',
      authReason: 'Send the administrator password to Hermes',
    };
  }
  const p = card.params as SecretRequestParams;
  return {
    method: 'secret',
    title: `Value for ${p.env_var}`,
    ask: p.prompt || null,
    command: null,
    textContentType: 'none', // never offer to save an API key to Passwords (review m14)
    warning: "Only continue if you asked for this — the agent can write or edit the skill that's asking.",
    destination: "Saved to the gateway's .env — the agent can read it.",
    skillName: skillNameOf(p),
    fieldLabel: `Value for ${p.env_var}`,
    placeholder: 'Paste or type the value',
    authReason: `Send ${p.env_var} to Hermes`,
  };
}
