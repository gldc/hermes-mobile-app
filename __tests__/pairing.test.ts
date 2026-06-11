// __tests__/pairing.test.ts
import { PairingParseError, pairingHost, parsePairingPayload } from '../src/lib/pairing';

describe('parsePairingPayload', () => {
  // Exactly what `hermes mobile pair` prints (compact separators, cli.py:112).
  const wire = '{"url":"http://100.64.0.7:9119","rt":"tok_abc-123","device_id":"a1b2c3d4e5f60718"}';

  it('parses the CLI wire format', () => {
    expect(parsePairingPayload(wire)).toEqual({
      url: 'http://100.64.0.7:9119',
      rt: 'tok_abc-123',
      deviceId: 'a1b2c3d4e5f60718',
    });
  });

  it('tolerates surrounding whitespace from manual paste', () => {
    expect(parsePairingPayload(`  ${wire}\n`).deviceId).toBe('a1b2c3d4e5f60718');
  });

  it('normalises trailing slashes off the gateway URL', () => {
    const p = parsePairingPayload('{"url":"https://gw.example.com:9119/","rt":"r","device_id":"d"}');
    expect(p.url).toBe('https://gw.example.com:9119');
  });

  it('accepts custom --url values (non-default port, https, hostname)', () => {
    const p = parsePairingPayload('{"url":"https://hermes.tailnet.ts.net","rt":"r","device_id":"d"}');
    expect(p.url).toBe('https://hermes.tailnet.ts.net');
  });

  it.each([
    ['empty input', ''],
    ['not JSON', 'hello'],
    ['JSON array', '[1,2]'],
    ['JSON scalar', '"rt"'],
    ['missing rt', '{"url":"http://x:9119","device_id":"d"}'],
    ['missing url', '{"rt":"r","device_id":"d"}'],
    ['missing device_id', '{"url":"http://x:9119","rt":"r"}'],
    ['empty rt', '{"url":"http://x:9119","rt":"  ","device_id":"d"}'],
    ['empty device_id', '{"url":"http://x:9119","rt":"r","device_id":""}'],
    ['non-string fields', '{"url":1,"rt":"r","device_id":"d"}'],
    ['non-http url', '{"url":"ftp://x","rt":"r","device_id":"d"}'],
    ['bare host url', '{"url":"100.64.0.7:9119","rt":"r","device_id":"d"}'],
  ])('rejects %s', (_name, input) => {
    expect(() => parsePairingPayload(input)).toThrow(PairingParseError);
  });

  it('camelCase deviceId is NOT the wire key — device_id is', () => {
    expect(() => parsePairingPayload('{"url":"http://x:9119","rt":"r","deviceId":"d"}')).toThrow(
      PairingParseError,
    );
  });
});

describe('pairingHost', () => {
  it('extracts host:port for the confirm step', () => {
    expect(pairingHost('http://100.64.0.7:9119')).toBe('100.64.0.7:9119');
    expect(pairingHost('https://hermes.tailnet.ts.net/prefix')).toBe('hermes.tailnet.ts.net');
  });
});
