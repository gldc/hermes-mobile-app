import { approvalView, resolvedCount } from '../src/lib/approval';

describe('approvalView', () => {
  it('reads the 0.21.5 server-request params', () => {
    expect(approvalView({ session_id: 's', request_id: 'r', command: 'rm -rf x', description: 'delete', tool_name: 'terminal', choices: ['once', 'deny'] }))
      .toEqual({ command: 'rm -rf x', description: 'delete', patternKey: '', toolName: 'terminal' });
  });
  it('reads the legacy 0.20.4 event payload', () => {
    expect(approvalView({ command: 'rm -rf x', description: 'd', pattern_keys: ['recursive delete'] }))
      .toEqual({ command: 'rm -rf x', description: 'd', patternKey: 'recursive delete', toolName: '' });
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
