// __tests__/cron.test.ts
import {
  getRunMessages,
  lastAssistantText,
  listCronJobs,
  listCronRuns,
  pauseCronJob,
  resumeCronJob,
  scheduleDisplay,
  triggerCronJob,
} from '../src/api/cron';
import type { SessionMessage } from '../src/api/types';

/** Records the verb + path of every call; returns a canned body. */
function fakeRest(body: unknown = {}) {
  const calls: { verb: 'get' | 'post'; path: string }[] = [];
  return {
    calls,
    get: async <T>(path: string) => {
      calls.push({ verb: 'get', path });
      return body as T;
    },
    post: async <T>(path: string) => {
      calls.push({ verb: 'post', path });
      return body as T;
    },
  };
}

describe('cron API paths', () => {
  it('lists jobs across all profiles', async () => {
    const r = fakeRest([]);
    await listCronJobs(r);
    expect(r.calls).toEqual([{ verb: 'get', path: '/api/cron/jobs?profile=all' }]);
  });

  it('pause / resume / trigger hit the per-job profile-scoped endpoints', async () => {
    const r = fakeRest({ id: 'a1b2c3d4e5f6', enabled: false });
    await pauseCronJob(r, 'a1b2c3d4e5f6', 'default');
    await resumeCronJob(r, 'a1b2c3d4e5f6', 'default');
    await triggerCronJob(r, 'a1b2c3d4e5f6', 'work');
    expect(r.calls.map((c) => c.path)).toEqual([
      '/api/cron/jobs/a1b2c3d4e5f6/pause?profile=default',
      '/api/cron/jobs/a1b2c3d4e5f6/resume?profile=default',
      '/api/cron/jobs/a1b2c3d4e5f6/trigger?profile=work',
    ]);
    expect(r.calls.every((c) => c.verb === 'post')).toBe(true);
  });

  it('URL-encodes job ids and profiles (ids may be names with spaces)', async () => {
    const r = fakeRest({});
    await pauseCronJob(r, 'Morning digest', 'côté/dev');
    expect(r.calls[0].path).toBe('/api/cron/jobs/Morning%20digest/pause?profile=c%C3%B4t%C3%A9%2Fdev');
  });

  it('fetches runs with a limit and run transcripts profile-scoped', async () => {
    const r = fakeRest({ runs: [], limit: 1 });
    await listCronRuns(r, 'a1b2c3d4e5f6', 'default'); // default limit 1
    await listCronRuns(r, 'a1b2c3d4e5f6', 'default', 20);
    await getRunMessages(r, 'cron_a1b2c3d4e5f6_1760000000', 'default');
    expect(r.calls.map((c) => c.path)).toEqual([
      '/api/cron/jobs/a1b2c3d4e5f6/runs?profile=default&limit=1',
      '/api/cron/jobs/a1b2c3d4e5f6/runs?profile=default&limit=20',
      '/api/sessions/cron_a1b2c3d4e5f6_1760000000/messages?profile=default',
    ]);
  });
});

describe('lastAssistantText', () => {
  const msg = (role: SessionMessage['role'], content: unknown): SessionMessage => ({
    role,
    content,
    timestamp: 0,
  });

  it('returns the final assistant message, skipping trailing tool/system rows', () => {
    const text = lastAssistantText([
      msg('user', 'run the digest'),
      msg('assistant', 'Working on it…'),
      msg('tool', '{"ok":true}'),
      msg('assistant', 'Digest sent: 3 items.'),
      msg('tool', 'res'),
    ]);
    expect(text).toBe('Digest sent: 3 items.');
  });

  it('extracts text from parts-array content', () => {
    const text = lastAssistantText([
      msg('assistant', [{ type: 'text', text: 'part one ' }, { type: 'text', text: 'part two' }]),
    ]);
    expect(text).toBe('part one part two');
  });

  it('skips empty assistant rows (pure tool-call turns) to find real output', () => {
    const text = lastAssistantText([
      msg('assistant', 'Final answer'),
      msg('assistant', ''),
      msg('assistant', [{ type: 'tool_call', id: 'x' }]),
    ]);
    expect(text).toBe('Final answer');
  });

  it('returns empty string when there is no assistant output', () => {
    expect(lastAssistantText([msg('user', 'hi'), msg('tool', 'res')])).toBe('');
    expect(lastAssistantText([])).toBe('');
  });
});

describe('scheduleDisplay', () => {
  it('prefers the top-level mirror', () => {
    expect(
      scheduleDisplay({ schedule_display: 'every day at 9am', schedule: { kind: 'cron', display: 'old' } }),
    ).toBe('every day at 9am');
  });

  it('falls back to schedule.display, then a dash', () => {
    expect(scheduleDisplay({ schedule_display: null, schedule: { kind: 'interval', display: 'every 2h' } })).toBe(
      'every 2h',
    );
    expect(scheduleDisplay({ schedule_display: null, schedule: null })).toBe('—');
    expect(scheduleDisplay({ schedule_display: '', schedule: { kind: 'once' } })).toBe('—');
  });
});
