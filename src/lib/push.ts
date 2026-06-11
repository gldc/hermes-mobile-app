// src/lib/push.ts — pure push/mailbox logic (docs/contracts/push.md).
// No Expo imports so it is unit-testable; src/notifications.ts is the only
// consumer that touches expo-notifications / SecureStore.

/** Mount prefix is /api/plugins/<manifest name>/ and the manifest name is
 * "mobile" (NOT "hermes-mobile") — see docs/contracts/push.md. */
export const PUSH_TOKEN_ROUTE = '/api/plugins/mobile/push-token';
export const MAILBOX_ROUTE = '/api/plugins/mobile/mailbox';

/** Re-register the Expo push token when older than this (task spec: 7 days). */
export const REGISTRATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Persisted (SecureStore) record of the last successful registration. */
export interface PushRegistration {
  token: string;
  /** epoch ms of the successful POST /push-token */
  registeredAt: number;
  /** pairing the token was registered under — re-register after re-pairing */
  deviceId: string;
}

/** Parse a stored registration blob; null on anything malformed. */
export function parsePushRegistration(raw: string | null): PushRegistration | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  if (
    typeof obj.token !== 'string' || !obj.token ||
    typeof obj.registeredAt !== 'number' || !Number.isFinite(obj.registeredAt) ||
    typeof obj.deviceId !== 'string' || !obj.deviceId
  ) {
    return null;
  }
  return { token: obj.token, registeredAt: obj.registeredAt, deviceId: obj.deviceId };
}

/** True when a stored registration still covers (token, deviceId) at `now`.
 * Stale (>7 days), a different token/device, or a future timestamp (clock
 * went backwards — trust nothing) all mean "register again". */
export function isRegistrationFresh(
  reg: PushRegistration | null,
  token: string,
  deviceId: string,
  now: number,
): boolean {
  if (!reg) return false;
  if (reg.token !== token || reg.deviceId !== deviceId) return false;
  if (reg.registeredAt > now) return false;
  return now - reg.registeredAt < REGISTRATION_TTL_MS;
}

/** One drained mailbox record (mailbox.py append_message). */
export interface MailboxMessage {
  ts: number;
  chatId: string;
  content: string;
  messageId: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

/** Parse a GET /mailbox response body. Malformed entries are skipped (the
 * server already skips corrupt JSONL lines; we mirror that tolerance), a
 * malformed envelope yields []. Drain is destructive server-side, so callers
 * must persist/display the result — see docs/contracts/push.md. */
export function parseMailboxMessages(payload: unknown): MailboxMessage[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const messages = (payload as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return [];
  const out: MailboxMessage[] = [];
  for (const entry of messages) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    if (
      typeof obj.ts !== 'number' || !Number.isFinite(obj.ts) ||
      typeof obj.chat_id !== 'string' ||
      typeof obj.content !== 'string' ||
      typeof obj.message_id !== 'string' || !obj.message_id
    ) {
      continue;
    }
    const msg: MailboxMessage = {
      ts: obj.ts,
      chatId: obj.chat_id,
      content: obj.content,
      messageId: obj.message_id,
    };
    if (typeof obj.reply_to === 'string' && obj.reply_to) msg.replyTo = obj.reply_to;
    if (typeof obj.metadata === 'object' && obj.metadata !== null && !Array.isArray(obj.metadata)) {
      msg.metadata = obj.metadata as Record<string, unknown>;
    }
    out.push(msg);
  }
  return out;
}
