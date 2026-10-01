// A provider that refuses to register the gateway for sign-in: the gateway passes its raw
// answer through. These turn it into words, and into the address to allow.
import { explainOauthRefusal, oauthRedirectAddress, signInProblem, testFailureLine } from '../src/lib/mcp';

// Seen on the device, 2026-10-01 (Cloudflare Access managed OAuth).
const CLOUDFLARE =
  'Registration failed: 400 {"error":"invalid_client_metadata","error_description":"redirect_uri is not allowed by the account configuration"}';
const base = 'https://hermes.kite-opah.ts.net';

describe('oauthRedirectAddress', () => {
  it('is the gateway callback for the connector', () => {
    expect(oauthRedirectAddress(base, 'Gmail')).toBe('https://hermes.kite-opah.ts.net/api/mcp/oauth/callback/Gmail');
  });
  it('keeps a path prefix and drops a trailing slash and any credentials', () => {
    expect(oauthRedirectAddress('https://user:pw@h.example/hermes/', 'linear')).toBe(
      'https://h.example/hermes/api/mcp/oauth/callback/linear',
    );
  });
  it('encodes the name the way the gateway does (nothing but letters, digits and _.-~ is left as is)', () => {
    expect(oauthRedirectAddress(base, "my server!(1)*'")).toBe(
      'https://hermes.kite-opah.ts.net/api/mcp/oauth/callback/my%20server%21%281%29%2A%27',
    );
    expect(oauthRedirectAddress(base, 'a_b.c-d~e')).toBe('https://hermes.kite-opah.ts.net/api/mcp/oauth/callback/a_b.c-d~e');
  });
  it('is null when the gateway address is not a URL', () => {
    expect(oauthRedirectAddress('nope', 'linear')).toBeNull();
  });
});

describe('explainOauthRefusal', () => {
  it('a refused redirect address: says what to do, with no provider JSON', () => {
    const refusal = explainOauthRefusal(CLOUDFLARE);
    expect(refusal).toEqual({
      redirect: true,
      message:
        'The server’s sign-in does not allow this gateway’s redirect address. Add it to the server’s allowed redirect addresses, then sign in again.',
      summary: 'Sign-in is not set up: the server does not allow this gateway’s redirect address.',
    });
  });
  it('knows the other ways providers say it', () => {
    expect(explainOauthRefusal('Registration failed: 400 {"error":"invalid_redirect_uri"}')?.redirect).toBe(true);
    expect(explainOauthRefusal('Registration failed: 400 Redirect URI not allowed')?.redirect).toBe(true);
    expect(explainOauthRefusal('OAuth error: invalid_redirect_uri')?.redirect).toBe(true);
  });
  it('another registration refusal: the status and what the provider said', () => {
    expect(
      explainOauthRefusal('Registration failed: 403 {"error":"access_denied","error_description":"Dynamic registration is disabled"}'),
    ).toEqual({
      redirect: false,
      message: 'The server refused to register this gateway for sign-in (HTTP 403). It said: “Dynamic registration is disabled”',
      summary: 'Sign-in is not set up: the server refused to register this gateway (HTTP 403).',
    });
  });
  it('falls back to the error code, and to nothing when the body is not JSON', () => {
    expect(explainOauthRefusal('Registration failed: 400 {"error":"invalid_client_metadata"}')?.message).toBe(
      'The server refused to register this gateway for sign-in (HTTP 400). It said: “invalid_client_metadata”',
    );
    expect(explainOauthRefusal('Registration failed: 500 <html>oops</html>')?.message).toBe(
      'The server refused to register this gateway for sign-in (HTTP 500).',
    );
    expect(explainOauthRefusal('Registration failed: 400 {"error_description":42}')?.message).toBe(
      'The server refused to register this gateway for sign-in (HTTP 400).',
    );
  });
  it('cuts a long provider description', () => {
    const long = 'x'.repeat(500);
    const message = explainOauthRefusal(`Registration failed: 400 {"error_description":"${long}"}`)?.message ?? '';
    expect(message.length).toBeLessThan(300);
    expect(message.endsWith('…”')).toBe(true);
  });
  it('is null for anything else', () => {
    expect(explainOauthRefusal('OAuth authentication required — no token found.')).toBeNull();
    expect(explainOauthRefusal('This provider only accepts pre-registered clients.')).toBeNull();
    expect(explainOauthRefusal('')).toBeNull();
  });
});

describe('signInProblem', () => {
  it('a refused redirect: the explanation and the address to allow', () => {
    expect(signInProblem(CLOUDFLARE, base, 'Gmail')).toEqual({
      text: 'The server’s sign-in does not allow this gateway’s redirect address. Add it to the server’s allowed redirect addresses, then sign in again.',
      address: 'https://hermes.kite-opah.ts.net/api/mcp/oauth/callback/Gmail',
    });
  });
  it('no address when the app is not connected, or for another refusal', () => {
    expect(signInProblem(CLOUDFLARE, null, 'Gmail').address).toBeNull();
    expect(signInProblem('Registration failed: 403 {"error":"access_denied"}', base, 'Gmail').address).toBeNull();
  });
  it('passes any other message through', () => {
    expect(signInProblem('This provider only accepts pre-registered clients.', base, 'Gmail')).toEqual({
      text: 'This provider only accepts pre-registered clients.',
      address: null,
    });
  });
});

describe('testFailureLine', () => {
  it('a refusal becomes its one-line summary', () => {
    expect(testFailureLine(CLOUDFLARE)).toBe('Sign-in is not set up: the server does not allow this gateway’s redirect address.');
  });
  it('anything else is shown as the gateway said it', () => {
    expect(testFailureLine('OAuth authentication required — no token found.')).toBe('OAuth authentication required — no token found.');
  });
});
