// __tests__/cronForm.test.ts — pure cron create/edit form helpers.
import {
  SCHEDULE_PRESETS,
  buildCronUpdates,
  initialScheduleText,
  schedulePreview,
  validateCronForm,
} from '../src/lib/cron-form';

describe('validateCronForm', () => {
  it('passes when both required fields are present', () => {
    expect(validateCronForm({ schedule: 'every day at 9am', prompt: 'do the thing' })).toEqual({});
  });

  it('requires a non-blank schedule and prompt (whitespace is not enough)', () => {
    const errors = validateCronForm({ schedule: '   ', prompt: '' });
    expect(errors.schedule).toMatch(/schedule is required/i);
    expect(errors.prompt).toMatch(/prompt is required/i);
  });

  it('does not require a name (server defaults it)', () => {
    // name intentionally absent from the validated shape
    expect(Object.keys(validateCronForm({ schedule: 's', prompt: 'p' }))).toEqual([]);
  });
});

describe('initialScheduleText', () => {
  it('prefers the top-level display mirror', () => {
    expect(
      initialScheduleText({ schedule_display: 'every day at 9am', schedule: { kind: 'cron', display: 'old' } }),
    ).toBe('every day at 9am');
  });

  it('falls back to schedule.display and never returns the dash placeholder', () => {
    expect(initialScheduleText({ schedule_display: null, schedule: { kind: 'interval', display: 'every 2h' } })).toBe(
      'every 2h',
    );
    expect(initialScheduleText({ schedule_display: null, schedule: null })).toBe('');
  });
});

describe('schedulePreview', () => {
  it('shows examples while empty', () => {
    expect(schedulePreview('', '')).toMatch(/e\.g\./);
    expect(schedulePreview('   ', 'every day at 9am')).toMatch(/e\.g\./);
  });

  it('confirms a schedule that still matches the gateway-saved one', () => {
    expect(schedulePreview('every day at 9am', 'every day at 9am')).toBe('Runs every day at 9am');
    expect(schedulePreview('  every day at 9am  ', 'every day at 9am')).toBe('Runs every day at 9am');
  });

  it('marks edited / unsaved schedules as pending gateway parsing', () => {
    expect(schedulePreview('every 5 minutes', 'every day at 9am')).toContain('every 5 minutes');
    expect(schedulePreview('every 5 minutes', 'every day at 9am')).toMatch(/gateway/i);
    expect(schedulePreview('every 5 minutes', '')).toMatch(/gateway/i); // create mode
  });
});

describe('buildCronUpdates', () => {
  const job = { name: 'Digest', prompt: 'summarize my day', deliver: 'local' };

  it('returns an empty diff when nothing changed (untouched schedule is never re-sent)', () => {
    expect(
      buildCronUpdates(job, 'every day at 9am', {
        name: 'Digest',
        schedule: ' every day at 9am ',
        prompt: 'summarize my day',
        deliver: 'local',
      }),
    ).toEqual({});
  });

  it('includes only the fields that changed, trimmed', () => {
    expect(
      buildCronUpdates(job, 'every day at 9am', {
        name: '  Evening digest ',
        schedule: 'every day at 9pm',
        prompt: 'summarize my day',
        deliver: 'telegram',
      }),
    ).toEqual({ name: 'Evening digest', schedule: 'every day at 9pm', deliver: 'telegram' });
  });

  it('treats null job fields as empty / local defaults', () => {
    expect(
      buildCronUpdates({ name: '', prompt: null, deliver: null }, '', {
        name: '',
        schedule: 'every hour',
        prompt: 'new prompt',
        deliver: 'local',
      }),
    ).toEqual({ schedule: 'every hour', prompt: 'new prompt' });
  });

  it('never includes immutable or unrelated fields', () => {
    const updates = buildCronUpdates(job, 'x', {
      name: 'Digest',
      schedule: 'x',
      prompt: 'summarize my day',
      deliver: 'local',
    });
    expect(updates).not.toHaveProperty('id');
    expect(updates).not.toHaveProperty('enabled'); // pause/resume endpoints own this
  });
});

describe('SCHEDULE_PRESETS', () => {
  it('offers 3-4 distinct natural-language presets', () => {
    expect(SCHEDULE_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(SCHEDULE_PRESETS.length).toBeLessThanOrEqual(4);
    expect(new Set(SCHEDULE_PRESETS).size).toBe(SCHEDULE_PRESETS.length);
  });
});
