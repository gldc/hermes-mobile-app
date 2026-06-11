// src/api/profiles.ts — profile listing, active/default lookup, and the
// param-threading helpers used to target a profile on REST + gateway calls.
// Contract: docs/contracts/profiles.md
//
// A mobile client talks to ONE remote backend that can serve every profile
// ("app-global remote mode"):
//   - list:    GET /api/profiles/sessions?profile=<name>  (cross-profile aggregate)
//   - REST:    ?profile= / body `profile` on per-session reads & mutations
//   - chat:    `profile` param on session.create / session.resume
// NOTE: GET /api/sessions/search has NO profile param (sessions-extra.md) —
// server FTS always answers for the backend's own launch profile.
import type { RestClient } from './restClient';
import type { SessionListResponse, SessionSummary } from './types';

export interface ProfileInfo {
  name: string;
  path?: string;
  is_default?: boolean;
  model?: string | null;
  provider?: string | null;
  description?: string | null;
  gateway_running?: boolean;
  /** Server adds fields over time (distribution_*, has_alias, …) — tolerate them. */
  [extra: string]: unknown;
}

export interface ProfilesResponse {
  profiles: ProfileInfo[];
}

/** All profiles known to the server. Fields are best-effort (the server may
 * fall back to a raw directory scan on listing failure). */
export function listProfiles(r: Pick<RestClient, 'get'>): Promise<ProfilesResponse> {
  return r.get<ProfilesResponse>('/api/profiles');
}

export interface ActiveProfileResponse {
  /** Sticky default written by `hermes profile use` (future CLI/gateways). */
  active: string;
  /** Profile the RUNNING backend is scoped to — what un-parameterised
   * /api/sessions & search answer for. */
  current: string;
}

export function getActiveProfile(r: Pick<RestClient, 'get'>): Promise<ActiveProfileResponse> {
  return r.get<ActiveProfileResponse>('/api/profiles/active');
}

/** Query-string fragment for an optional profile target. Empty string when
 * profile is null/undefined/'' (= backend's own profile, omit per contract). */
export function profileQuery(profile: string | null | undefined, sep: '?' | '&' = '&'): string {
  return profile ? `${sep}profile=${encodeURIComponent(profile)}` : '';
}

/** Merge an optional profile into JSON-RPC params (session.create/resume).
 * Omitted/empty profile = launch profile, unchanged — so we only add the key
 * when there is a real selection. */
export function withProfile<T extends object>(
  params: T,
  profile: string | null | undefined,
): T & { profile?: string } {
  return profile ? { ...params, profile } : params;
}

/** Rows from the cross-profile aggregate are session rows tagged with extras. */
export interface ProfileSessionRow extends SessionSummary {
  profile?: string;
  is_default_profile?: boolean;
  archived?: boolean;
}

export interface ProfileSessionsResponse extends SessionListResponse {
  sessions: ProfileSessionRow[];
  profile_totals?: Record<string, number>;
  errors?: { profile: string; error: string }[];
}

export const SESSIONS_PAGE_SIZE = 40;

/** List sessions for the current selection: no selection → the backend's own
 * profile via GET /api/sessions (richest enrichment); a named profile → the
 * cross-profile aggregate GET /api/profiles/sessions (reads that profile's
 * state.db on disk; no per-profile backend is spawned). */
export function listSessionsForProfile(
  r: Pick<RestClient, 'get' | 'listSessions'>,
  profile: string | null,
  offset = 0,
  archived: 'exclude' | 'only' = 'exclude',
): Promise<SessionListResponse> {
  if (!profile) return r.listSessions(offset, archived);
  const arch = archived === 'only' ? '&archived=only' : '';
  return r.get<ProfileSessionsResponse>(
    `/api/profiles/sessions?profile=${encodeURIComponent(profile)}` +
      `&limit=${SESSIONS_PAGE_SIZE}&offset=${offset}&order=recent${arch}`,
  );
}
