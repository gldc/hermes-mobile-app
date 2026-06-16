import { sessionPinId } from '../src/lib/session-utils';

describe('sessionPinId', () => {
  it('returns _lineage_root_id when present', () => {
    expect(sessionPinId({ id: 'tip', _lineage_root_id: 'root' })).toBe('root');
  });

  it('returns id when no lineage root', () => {
    expect(sessionPinId({ id: 'abc' })).toBe('abc');
  });

  it('returns id when lineage root is empty string', () => {
    expect(sessionPinId({ id: 'abc', _lineage_root_id: '' })).toBe('abc');
  });
});
