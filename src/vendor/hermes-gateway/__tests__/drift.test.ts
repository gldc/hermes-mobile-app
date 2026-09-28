// Drift guard: the vendored files are byte-for-byte what scripts/sync-gateway-contract.sh wrote.
// Any hand edit fails here — re-vendor with the script instead.
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(dir, 'VENDORED.json'), 'utf8')) as {
  tag: string;
  commit: string;
  files: Record<string, { upstream_sha256: string; vendored_sha256: string }>;
};
const sha = (name: string) => createHash('sha256').update(readFileSync(join(dir, name))).digest('hex');

describe('vendored hermes-gateway drift guard', () => {
  it('pins v2026.9.24', () => {
    expect(manifest.tag).toBe('v2026.9.24');
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('covers exactly the four sources plus LICENSE', () => {
    expect(Object.keys(manifest.files).sort()).toEqual(
      ['LICENSE', 'gateway-contract.generated.ts', 'gateway-events.ts', 'json-rpc-channel.ts', 'json-rpc-gateway.ts'],
    );
  });

  it.each(Object.keys(manifest.files))('%s matches its recorded vendored_sha256', (name) => {
    expect(sha(name)).toBe(manifest.files[name].vendored_sha256);
  });

  it('no relative import keeps its .js suffix (the one mechanical edit)', () => {
    for (const name of Object.keys(manifest.files).filter((n) => n.endsWith('.ts'))) {
      expect(readFileSync(join(dir, name), 'utf8')).not.toMatch(/from '\.\/[^']+\.js'/);
    }
  });
});
