import { approvalChoices, approvalView, resolvedCount } from '../src/lib/approval';

describe('approvalView', () => {
  it('reads the 0.21.5 server-request params', () => {
    expect(approvalView({ session_id: 's', request_id: 'r', command: 'rm -rf x', description: 'delete', tool_name: 'terminal', choices: ['once', 'deny'] }))
      .toEqual({ command: 'rm -rf x', description: 'delete', patternKey: '', toolName: 'terminal' });
  });
  it('reads the legacy 0.20.4 event payload', () => {
    expect(approvalView({ command: 'rm -rf x', description: 'd', pattern_keys: ['recursive delete'] }))
      .toEqual({ command: 'rm -rf x', description: 'd', patternKey: 'recursive delete', toolName: '' });
  });
  // Sim S1 §2 V8 / S2 §3: 0.21.5 sends description === pattern_key ("delete in root path"), which the
  // card then showed twice (header key + description line).
  it('drops a description that only repeats the pattern key', () => {
    expect(approvalView({ command: 'rm -rf /', description: 'delete in root path', pattern_key: 'delete in root path' }))
      .toEqual({ command: 'rm -rf /', description: '', patternKey: 'delete in root path', toolName: '' });
    expect(approvalView({ command: 'rm -rf /', description: 'Delete in root path ', pattern_keys: ['delete in root path'] }).description).toBe('');
  });
  it('tolerates garbage', () => {
    expect(approvalView(null)).toEqual({ command: '', description: '', patternKey: '', toolName: '' });
  });
});

describe('resolvedCount', () => {
  it('returns the server int count', () => {
    expect(resolvedCount({ resolved: 1 })).toBe(1);
    expect(resolvedCount({ resolved: 3 })).toBe(3);
    expect(resolvedCount({ resolved: 0 })).toBe(0);
  });

  it('tolerates the boolean shape the desktop client assumes', () => {
    expect(resolvedCount({ resolved: true })).toBe(1);
    expect(resolvedCount({ resolved: false })).toBe(0);
  });

  it('clamps junk to 0', () => {
    expect(resolvedCount({ resolved: -2 })).toBe(0);
    expect(resolvedCount({ resolved: NaN })).toBe(0);
    expect(resolvedCount({ resolved: 'yes' })).toBe(0);
    expect(resolvedCount({})).toBe(0);
    expect(resolvedCount(null)).toBe(0);
    expect(resolvedCount(undefined)).toBe(0);
  });

  it('truncates fractional counts', () => {
    expect(resolvedCount({ resolved: 1.9 })).toBe(1);
  });
});

describe('approvalChoices', () => {
  test.each([
    [{ choices: ['once', 'session', 'always', 'deny'] }, { session: true, always: true }],
    [{ choices: ['once', 'session', 'deny'] }, { session: true, always: false }],
    [{ choices: ['once', 'deny'] }, { session: false, always: false }],
    [{ choices: ['once', 'deny'], allow_session: true, allow_permanent: true }, { session: false, always: false }], // choices win
    [{ choices: ['once', 'bogus', 7, 'always', 'deny'] }, { session: false, always: true }],
    [{}, { session: true, always: true }], // no choices: session shown, always unless allow_permanent === false
    [{ allow_permanent: false }, { session: true, always: false }],
    [{ smart_denied: true }, { session: false, always: false }],
    [{ allow_session: false }, { session: false, always: false }],
    [null, { session: true, always: true }],
  ])('%j → %j', (params, expected) => {
    expect(approvalChoices(params)).toEqual(expected);
  });
});
