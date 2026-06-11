// src/lib/stored-connection.ts
/** Versioned shape of the SecureStore connection blob + v1→v2 migration.
 * Pure (no Expo imports) so it is unit-testable; src/connection.ts is the
 * only consumer that touches SecureStore.
 */

export type ConnectionMode = 'password' | 'device';

/** v1 (M1) — password only, no version field. */
interface StoredConnectionV1 {
  baseUrl: string;
  username: string;
  password: string;
  cookies: Record<string, string>;
}

export interface StoredConnectionV2 {
  version: 2;
  baseUrl: string;
  mode: ConnectionMode;
  /** password mode only */
  username?: string;
  /** password mode only */
  password?: string;
  /** device mode only — `device_id` from the pairing payload. */
  deviceId?: string;
  cookies: Record<string, string>;
}

export class StoredConnectionError extends Error {}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' && v !== null && !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string')
  );
}

/** Parse a raw SecureStore blob into v2, migrating v1 transparently.
 * Throws StoredConnectionError on garbage (caller treats as "not connected"). */
export function migrateStoredConnection(raw: string): StoredConnectionV2 {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new StoredConnectionError('stored connection is not JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new StoredConnectionError('stored connection is not an object');
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.baseUrl !== 'string' || !obj.baseUrl) {
    throw new StoredConnectionError('stored connection has no baseUrl');
  }
  const cookies = isStringRecord(obj.cookies) ? obj.cookies : {};

  if (obj.version === 2) {
    const mode = obj.mode === 'device' ? 'device' : 'password';
    return {
      version: 2,
      baseUrl: obj.baseUrl,
      mode,
      username: typeof obj.username === 'string' ? obj.username : undefined,
      password: typeof obj.password === 'string' ? obj.password : undefined,
      deviceId: typeof obj.deviceId === 'string' ? obj.deviceId : undefined,
      cookies,
    };
  }

  // v1: no version field — always password mode.
  const v1 = obj as unknown as StoredConnectionV1;
  if (typeof v1.username !== 'string' || typeof v1.password !== 'string') {
    throw new StoredConnectionError('stored v1 connection is missing credentials');
  }
  return {
    version: 2,
    baseUrl: v1.baseUrl,
    mode: 'password',
    username: v1.username,
    password: v1.password,
    cookies,
  };
}
