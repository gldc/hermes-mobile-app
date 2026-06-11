// src/api/cron.ts — cron-jobs REST surface (docs/contracts/cron.md).
// Feature module built on RestClient's generic verbs; pure functions so the
// transport stays injectable and unit-testable.
import { messageText } from '../lib/message-text';
import type { RestClient } from './restClient';
import type { MessagesResponse, SessionMessage } from './types';

export interface CronSchedule {
  kind: 'cron' | 'interval' | 'once' | (string & {});
  /** Server-rendered human description, e.g. "every day at 9am". */
  display?: string | null;
  [key: string]: unknown;
}

/** Job record from GET /api/cron/jobs (cron/jobs.py:672-706 + profile annotations). */
export interface CronJob {
  id: string;
  name: string;
  prompt: string | null;
  schedule: CronSchedule | null;
  schedule_display: string | null;
  repeat?: { times: number | null; completed: number } | null;
  enabled: boolean;
  state: 'scheduled' | 'paused' | (string & {});
  paused_at?: string | null;
  paused_reason?: string | null;
  created_at: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: 'success' | 'error' | null;
  last_error: string | null;
  last_delivery_error?: string | null;
  deliver?: string | null;
  /** Profile annotations — every response row carries these. */
  profile: string;
  profile_name?: string;
  hermes_home?: string;
  is_default_profile?: boolean;
}

/** Cron runs are ordinary session rows (id `cron_{job_id}_{ts}`, source='cron'). */
export interface CronRunRow {
  id: string;
  preview?: string | null;
  last_active?: number;
  is_active?: boolean;
  profile?: string;
  [key: string]: unknown;
}

export interface CronRunsResponse {
  runs: CronRunRow[];
  limit: number;
}

/** Delivery target row from GET /api/cron/delivery-targets (web_server.py:6282-6307). */
export interface DeliveryTarget {
  id: string;
  name: string;
  home_target_set?: boolean;
  home_env_var?: string | null;
}

/** The only fields the REST create endpoint accepts (CronJobCreate,
 * web_server.py:6100-6104). Richer fields are set post-create via PUT. */
export interface CronJobCreateBody {
  prompt: string;
  schedule: string;
  name?: string;
  deliver?: string;
}

/** Only the generic verbs — keeps tests trivial and RestClient lean. */
type Rest = Pick<RestClient, 'get' | 'post'>;

const enc = encodeURIComponent;

/** `?profile=<name>` — empty string when omitted (server then scans profiles). */
function profileQuery(profile: string | undefined, sep: '?' | '&' = '?'): string {
  return profile ? `${sep}profile=${enc(profile)}` : '';
}

/** All jobs across every profile, paused ones included (bare JSON array). */
export function listCronJobs(rest: Rest): Promise<CronJob[]> {
  return rest.get<CronJob[]>('/api/cron/jobs?profile=all');
}

/** One job by id (or unambiguous name); 404 if unknown. */
export function getCronJob(rest: Rest, id: string, profile?: string): Promise<CronJob> {
  return rest.get<CronJob>(`/api/cron/jobs/${enc(id)}${profileQuery(profile)}`);
}

/** Delivery targets for the create/edit form picker. */
export function listDeliveryTargets(rest: Rest): Promise<{ targets: DeliveryTarget[] }> {
  return rest.get<{ targets: DeliveryTarget[] }>('/api/cron/delivery-targets');
}

/** Create a job. 400 (with `detail`) on schedule-parse errors. */
export function createCronJob(rest: Rest, body: CronJobCreateBody, profile?: string): Promise<CronJob> {
  return rest.post<CronJob>(`/api/cron/jobs${profileQuery(profile)}`, body);
}

/** Partial update — body is `{updates: {...}}`; `schedule` may be a raw string
 * (re-parsed server-side). Immutable fields (id) are rejected with 400. */
export function updateCronJob(
  rest: Pick<RestClient, 'put'>,
  id: string,
  profile: string | undefined,
  updates: Record<string, unknown>,
): Promise<CronJob> {
  return rest.put<CronJob>(`/api/cron/jobs/${enc(id)}${profileQuery(profile)}`, { updates });
}

/** Delete a job → {ok: true}; 404 unknown. */
export function deleteCronJob(
  rest: Pick<RestClient, 'del'>,
  id: string,
  profile?: string,
): Promise<{ ok: boolean }> {
  return rest.del<{ ok: boolean }>(`/api/cron/jobs/${enc(id)}${profileQuery(profile)}`);
}

/** Pause: sets enabled=false, state="paused". Returns the updated job. */
export function pauseCronJob(rest: Rest, id: string, profile: string): Promise<CronJob> {
  return rest.post<CronJob>(`/api/cron/jobs/${enc(id)}/pause?profile=${enc(profile)}`);
}

/** Resume: sets enabled=true and recomputes next_run_at from now. */
export function resumeCronJob(rest: Rest, id: string, profile: string): Promise<CronJob> {
  return rest.post<CronJob>(`/api/cron/jobs/${enc(id)}/resume?profile=${enc(profile)}`);
}

/** Manual run: sets next_run_at=now for the scheduler's next tick — the run is
 * NOT synchronous; the new run session appears in the runs list shortly after. */
export function triggerCronJob(rest: Rest, id: string, profile: string): Promise<CronJob> {
  return rest.post<CronJob>(`/api/cron/jobs/${enc(id)}/trigger?profile=${enc(profile)}`);
}

/** Most-recent-first run sessions for a job (limit clamped 1..100 server-side). */
export function listCronRuns(rest: Rest, id: string, profile: string, limit = 1): Promise<CronRunsResponse> {
  return rest.get<CronRunsResponse>(`/api/cron/jobs/${enc(id)}/runs?profile=${enc(profile)}&limit=${limit}`);
}

/** Transcript of one run session (profile-scoped; runs live per Hermes profile). */
export function getRunMessages(rest: Rest, runSessionId: string, profile: string): Promise<MessagesResponse> {
  return rest.get<MessagesResponse>(`/api/sessions/${enc(runSessionId)}/messages?profile=${enc(profile)}`);
}

/** A job's "last output" = the final assistant message of its most recent run
 * (no dedicated output-file endpoint exists; this mirrors the desktop view). */
export function lastAssistantText(messages: SessionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const text = messageText(m).trim();
    if (text) return text;
  }
  return '';
}

/** Human schedule line, tolerant of records missing the top-level mirror. */
export function scheduleDisplay(job: Pick<CronJob, 'schedule' | 'schedule_display'>): string {
  return job.schedule_display || job.schedule?.display || '—';
}
