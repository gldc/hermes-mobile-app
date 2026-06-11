import { parseApprovalRequest, resolvedCount } from '../src/lib/approval';

describe('parseApprovalRequest', () => {
  const wirePayload = {
    command: 'rm -rf build/',
    pattern_key: 'recursive delete',
    pattern_keys: ['recursive delete', 'rm targeting directory'],
    description: 'Recursive file deletion; removes a directory tree.',
  };

  it('parses the verified terminal-guard payload shape', () => {
    expect(parseApprovalRequest(wirePayload)).toEqual({
      command: 'rm -rf build/',
      description: 'Recursive file deletion; removes a directory tree.',
      patternKey: 'recursive delete',
      patternKeys: ['recursive delete', 'rm targeting directory'],
    });
  });

  it('keeps the full multi-line command verbatim (execute_code synthesized commands)', () => {
    const cmd = 'python - <<EOF\nimport shutil\nshutil.rmtree("build")\nEOF';
    expect(parseApprovalRequest({ ...wirePayload, command: cmd })?.command).toBe(cmd);
  });

  it('falls back to pattern_keys[0] when pattern_key is missing', () => {
    const { pattern_key: _omit, ...rest } = wirePayload;
    expect(parseApprovalRequest(rest)?.patternKey).toBe('recursive delete');
  });

  it('synthesizes pattern_keys from pattern_key when the list is missing', () => {
    const { pattern_keys: _omit, ...rest } = wirePayload;
    expect(parseApprovalRequest(rest)?.patternKeys).toEqual(['recursive delete']);
  });

  it('drops non-string entries from pattern_keys', () => {
    const parsed = parseApprovalRequest({ ...wirePayload, pattern_keys: ['ok', 7, null, '', 'also ok'] });
    expect(parsed?.patternKeys).toEqual(['ok', 'also ok']);
  });

  it('tolerates a missing description (command alone is displayable)', () => {
    const parsed = parseApprovalRequest({ command: 'sudo reboot' });
    expect(parsed).toEqual({ command: 'sudo reboot', description: '', patternKey: '', patternKeys: [] });
  });

  it('tolerates a missing command (description alone is displayable)', () => {
    expect(parseApprovalRequest({ description: 'Dangerous operation' })?.description).toBe('Dangerous operation');
  });

  it('ignores non-string command/description', () => {
    expect(parseApprovalRequest({ command: 42, description: ['x'] })).toBeNull();
  });

  it('returns null when there is nothing displayable', () => {
    expect(parseApprovalRequest({})).toBeNull();
    expect(parseApprovalRequest({ command: '   ', description: '' })).toBeNull();
    expect(parseApprovalRequest(null)).toBeNull();
    expect(parseApprovalRequest(undefined)).toBeNull();
    expect(parseApprovalRequest('rm -rf /')).toBeNull();
    expect(parseApprovalRequest(7)).toBeNull();
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
