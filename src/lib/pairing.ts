// src/lib/pairing.ts
/** Parsing for `hermes mobile pair` QR payloads (docs/contracts/pairing.md).
 *
 * The QR (and the CLI's manual-paste fallback) encodes compact JSON:
 *   {"url":"http://100.x.y.z:9119","rt":"<refresh token>","device_id":"<hex>"}
 * `url` is arbitrary http(s) — `--url` overrides the detected default, so we
 * must not assume host shape or port. `rt` is the live device credential.
 */

export interface PairingPayload {
  /** Gateway base URL, normalised: no trailing slash. */
  url: string;
  /** Live refresh token — the whole device credential. Handle like a password. */
  rt: string;
  deviceId: string;
}

export class PairingParseError extends Error {}

/** Parse + validate a scanned/pasted pairing payload.
 * Throws PairingParseError with a user-facing message on anything invalid. */
export function parsePairingPayload(text: string): PairingPayload {
  const trimmed = (text ?? '').trim();
  if (!trimmed) throw new PairingParseError('Empty pairing code.');

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new PairingParseError('Not a Hermes pairing code — expected JSON from `hermes mobile pair`.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new PairingParseError('Not a Hermes pairing code — expected JSON from `hermes mobile pair`.');
  }

  const obj = data as Record<string, unknown>;
  const url = obj.url;
  const rt = obj.rt;
  const deviceId = obj.device_id;
  if (typeof url !== 'string' || typeof rt !== 'string' || typeof deviceId !== 'string') {
    throw new PairingParseError('Pairing code is missing url, rt, or device_id.');
  }
  if (!rt.trim()) throw new PairingParseError('Pairing code has an empty refresh token.');
  if (!deviceId.trim()) throw new PairingParseError('Pairing code has an empty device id.');
  if (!/^https?:\/\/.+/i.test(url.trim())) {
    throw new PairingParseError('Pairing code gateway URL must be http(s).');
  }

  return {
    url: url.trim().replace(/\/+$/, ''),
    rt: rt.trim(),
    deviceId: deviceId.trim(),
  };
}

/** Display host (host:port) of a pairing URL, for the confirm step. */
export function pairingHost(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1] : url;
}
