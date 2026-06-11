// src/api/skills.ts — skills REST surface (docs/contracts/skills.md).
//
// Supported over REST: list (GET /api/skills, bare JSON array) and
// enable/disable toggle (PUT /api/skills/toggle). NOT supported and therefore
// deliberately absent here:
//   - pin/unpin — CLI-only (`hermes curator pin`), no HTTP endpoint;
//   - per-skill `source`/`pinned` fields — not in the list payload;
//   - reading an installed skill's SKILL.md — no content endpoint (the
//     /api/files/read workaround is locked down for remote clients).
import type { RestClient } from './restClient';

/** Row from GET /api/skills (SKILL.md frontmatter + the endpoint's `enabled` flag). */
export interface SkillInfo {
  name: string;
  description: string;
  /** Derived from the skill's path on the gateway; may be "". */
  category: string;
  /** False when the skill is in the profile's disabled set (still listed). */
  enabled: boolean;
}

export interface SkillToggleResponse {
  ok: boolean;
  name: string;
  enabled: boolean;
}

/** Only the generic verbs — keeps tests trivial and RestClient lean. */
type Rest = Pick<RestClient, 'get' | 'put'>;

/** All installed skills, disabled ones included (bare JSON array, not wrapped). */
export function listSkills(rest: Rest): Promise<SkillInfo[]> {
  return rest.get<SkillInfo[]>('/api/skills');
}

/** Enable/disable a skill for the agent. Persists to the profile's disabled-skills config. */
export function toggleSkill(rest: Rest, name: string, enabled: boolean): Promise<SkillToggleResponse> {
  return rest.put<SkillToggleResponse>('/api/skills/toggle', { name, enabled });
}

/** One-line summary: first non-empty line of the description, trimmed. */
export function summaryLine(description: string): string {
  for (const line of (description ?? '').split('\n')) {
    const t = line.trim();
    if (t) return t;
  }
  return '';
}

/** Case-insensitive substring match over name, description, and category. */
export function filterSkills(skills: SkillInfo[], query: string): SkillInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q) ||
      (s.category ?? '').toLowerCase().includes(q),
  );
}

/** Stable display order: category A→Z (uncategorized last), then name A→Z. */
export function sortSkills(skills: SkillInfo[]): SkillInfo[] {
  return [...skills].sort((a, b) => {
    const ca = a.category ?? '';
    const cb = b.category ?? '';
    if (ca !== cb) {
      if (!ca) return 1;
      if (!cb) return -1;
      return ca.localeCompare(cb);
    }
    return a.name.localeCompare(b.name);
  });
}
