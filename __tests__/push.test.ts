// Pure push logic — staleness window and mailbox payload parsing
// (src/lib/push.ts; wire shapes in docs/contracts/push.md).
import {
  REGISTRATION_TTL_MS,
  canJoinInFlight,
  isRegistrationFresh,
  parseMailboxMessages,
  parsePushRegistration,
  shouldSuppressForeground,
} from '../src/lib/push';

const NOW = 1_760_000_000_000;
const TOKEN = 'ExponentPushToken[abc123]';
const DEVICE = 'a1b2c3d4e5f60718';

function reg(overrides: Partial<{ token: string; registeredAt: number; deviceId: string }> = {}) {
  return { token: TOKEN, registeredAt: NOW - 1000, deviceId: DEVICE, ...overrides };
}

describe('parsePushRegistration', () => {
  it('round-trips a valid blob', () => {
    expect(parsePushRegistration(JSON.stringify(reg()))).toEqual(reg());
  });

  it.each([
    ['null input', null],
    ['empty string', ''],
    ['not JSON', '{nope'],
    ['array', '[1,2]'],
    ['missing token', JSON.stringify({ registeredAt: NOW, deviceId: DEVICE })],
    ['empty token', JSON.stringify(reg({ token: '' }))],
    ['string timestamp', JSON.stringify({ ...reg(), registeredAt: 'soon' })],
    ['NaN timestamp', '{"token":"t","registeredAt":null,"deviceId":"d"}'],
    ['missing deviceId', JSON.stringify({ token: TOKEN, registeredAt: NOW })],
  ])('rejects %s', (_name, raw) => {
    expect(parsePushRegistration(raw as string | null)).toBeNull();
  });
});

describe('isRegistrationFresh (7-day staleness)', () => {
  it('fresh registration for same token+device', () => {
    expect(isRegistrationFresh(reg(), TOKEN, DEVICE, NOW)).toBe(true);
  });

  it('null registration is never fresh', () => {
    expect(isRegistrationFresh(null, TOKEN, DEVICE, NOW)).toBe(false);
  });

  it('just under 7 days is fresh; exactly 7 days is stale', () => {
    expect(
      isRegistrationFresh(reg({ registeredAt: NOW - REGISTRATION_TTL_MS + 1 }), TOKEN, DEVICE, NOW),
    ).toBe(true);
    expect(
      isRegistrationFresh(reg({ registeredAt: NOW - REGISTRATION_TTL_MS }), TOKEN, DEVICE, NOW),
    ).toBe(false);
  });

  it('token rotation forces re-registration', () => {
    expect(isRegistrationFresh(reg(), 'ExponentPushToken[other]', DEVICE, NOW)).toBe(false);
  });

  it('re-pairing (new device id) forces re-registration', () => {
    expect(isRegistrationFresh(reg(), TOKEN, 'ffffffffffffffff', NOW)).toBe(false);
  });

  it('future timestamp (clock rollback) is treated as stale', () => {
    expect(isRegistrationFresh(reg({ registeredAt: NOW + 60_000 }), TOKEN, DEVICE, NOW)).toBe(false);
  });
});

describe('canJoinInFlight (soft-ask-aware coalescing)', () => {
  // The bug this guards: an explicit user tap (softAsk:true) must never join an
  // in-flight app-start run (softAsk:false), which never prompts — that would
  // silently swallow the OS permission dialog.
  it('soft-ask tap must NOT join an in-flight app-start run', () => {
    expect(canJoinInFlight(/* inFlightSoftAsk */ false, /* requestSoftAsk */ true)).toBe(false);
  });

  it('soft-ask tap joins another in-flight soft-ask run', () => {
    expect(canJoinInFlight(true, true)).toBe(true);
  });

  it('app-start request joins anything already running', () => {
    expect(canJoinInFlight(false, false)).toBe(true);
    expect(canJoinInFlight(true, false)).toBe(true);
  });
});

describe('shouldSuppressForeground', () => {
  it('suppresses session-stop pings while active', () => {
    expect(shouldSuppressForeground({ type: 'session_end' }, 'active')).toBe(true);
    expect(shouldSuppressForeground({ type: 'approval_request' }, 'active')).toBe(true);
  });
  it('shows when not active', () => {
    expect(shouldSuppressForeground({ type: 'session_end' }, 'background')).toBe(false);
    expect(shouldSuppressForeground({ type: 'approval_request' }, 'inactive')).toBe(false);
  });
  it('shows unknown/absent types even when active', () => {
    expect(shouldSuppressForeground({ type: 'other' }, 'active')).toBe(false);
    expect(shouldSuppressForeground(undefined, 'active')).toBe(false);
    expect(shouldSuppressForeground({}, 'active')).toBe(false);
  });
});

describe('parseMailboxMessages', () => {
  const wire = {
    ts: 1760000000.5,
    chat_id: DEVICE,
    content: 'Build finished ✅',
    message_id: 'aabbccdd'.repeat(4),
  };

  it('parses a full record incl. optional fields', () => {
    const parsed = parseMailboxMessages({
      messages: [{ ...wire, reply_to: 'msg-1', metadata: { kind: 'ci' } }],
    });
    expect(parsed).toEqual([
      {
        ts: wire.ts,
        chatId: DEVICE,
        content: 'Build finished ✅',
        messageId: wire.message_id,
        replyTo: 'msg-1',
        metadata: { kind: 'ci' },
      },
    ]);
  });

  it('omits absent optional fields', () => {
    const [msg] = parseMailboxMessages({ messages: [wire] });
    expect(msg.replyTo).toBeUndefined();
    expect(msg.metadata).toBeUndefined();
  });

  it('empty mailbox and malformed envelopes yield []', () => {
    expect(parseMailboxMessages({ messages: [] })).toEqual([]);
    expect(parseMailboxMessages({})).toEqual([]);
    expect(parseMailboxMessages(null)).toEqual([]);
    expect(parseMailboxMessages('messages')).toEqual([]);
    expect(parseMailboxMessages({ messages: 'nope' })).toEqual([]);
  });

  it('skips malformed entries but keeps valid ones (server skips corrupt lines too)', () => {
    const parsed = parseMailboxMessages({
      messages: [
        null,
        42,
        ['ts'],
        { ...wire, ts: 'yesterday' }, // bad ts
        { ...wire, message_id: '' }, // empty id
        { ...wire, content: 7 }, // bad content
        wire, // valid
        { ...wire, reply_to: 99, metadata: [1] }, // bad optionals → dropped, entry kept
      ],
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[0].messageId).toBe(wire.message_id);
    expect(parsed[1].replyTo).toBeUndefined();
    expect(parsed[1].metadata).toBeUndefined();
  });
});
