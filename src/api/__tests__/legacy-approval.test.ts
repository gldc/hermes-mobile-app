import { isLegacyApprovalEvent, readLegacyApprovalPayload } from '@/api/legacy-approval';

describe('legacy (0.20.4) approval.request event', () => {
  it('is recognised by type only', () => {
    expect(isLegacyApprovalEvent({ type: 'approval.request' })).toBe(true);
    expect(isLegacyApprovalEvent({ type: 'approval' })).toBe(false);
  });
  it('keeps displayable payloads (command or description) with all extra keys', () => {
    expect(readLegacyApprovalPayload({ command: 'rm -rf x', pattern_key: 'recursive delete' })).toEqual({
      command: 'rm -rf x',
      pattern_key: 'recursive delete',
    });
    expect(readLegacyApprovalPayload({ description: 'danger' })).toEqual({ description: 'danger', command: '' });
  });
  it('rejects empty or non-object payloads', () => {
    expect(readLegacyApprovalPayload({ command: ' ', description: '' })).toBeNull();
    expect(readLegacyApprovalPayload(null)).toBeNull();
    expect(readLegacyApprovalPayload('x')).toBeNull();
  });
});
