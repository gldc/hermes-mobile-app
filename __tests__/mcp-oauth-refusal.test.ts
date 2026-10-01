// A provider that refuses to register the gateway for sign-in: the gateway passes its raw
// answer through. These turn it into words, and into the address to allow.
import {
  OAUTH_NEEDS_HTTPS,
  explainOauthRefusal,
  oauthRedirectAddress,
  signInProblem,
  testFailureLine,
} from '../src/lib/mcp';

// Seen on the device, 2026-10-01 (Cloudflare Access managed OAuth).
const CLOUDFLARE =
  'Registration failed: 400 {"error":"invalid_client_metadata","error_description":"redirect_uri is not allowed by the account configuration"}';
const base = 'https://hermes.kite-opah.ts.net';
const ALLOW =
  'The server’s sign-in does not allow this gateway’s redirect address. Add it to the server’s allowed redirect addresses, then sign in again.';
const ALLOW_SUMMARY = 'Sign-in is not set up: the server does not allow this gateway’s redirect address.';

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

describe('explainOauthRefusal — a refused redirect address', () => {
  it('says what to do and quotes the provider, with none of its JSON', () => {
    expect(explainOauthRefusal(CLOUDFLARE)).toEqual({
      redirect: true,
      message: `${ALLOW} It said: “redirect_uri is not allowed by the account configuration”`,
      summary: ALLOW_SUMMARY,
      said: 'redirect_uri is not allowed by the account configuration',
    });
  });
  it.each([
    ['the standard error code', 'Registration failed: 400 {"error":"invalid_redirect_uri"}', `${ALLOW} It said: “invalid_redirect_uri”`],
    ['a plain-text body', 'Registration failed: 400 Redirect URI not allowed', `${ALLOW} It said: “Redirect URI not allowed”`],
    [
      'the RFC wording',
      'Registration failed: 400 {"error":"invalid_client_metadata","error_description":"One of the redirection URIs is not permitted"}',
      `${ALLOW} It said: “One of the redirection URIs is not permitted”`,
    ],
    ['camel case', 'Registration failed: 400 {"message":"redirectUri is not registered"}', `${ALLOW} It said: “redirectUri is not registered”`],
    ['a hyphen', 'Registration failed: 400 redirect-uri is invalid', `${ALLOW} It said: “redirect-uri is invalid”`],
    ['the code outside a registration failure', 'OAuth error: invalid_redirect_uri', ALLOW],
  ])('%s', (_, raw, message) => {
    expect(explainOauthRefusal(raw)).toMatchObject({ redirect: true, message, summary: ALLOW_SUMMARY });
  });
});

describe('explainOauthRefusal — a refusal that only mentions the redirect address is not "add it to the list"', () => {
  it.each([
    [
      'a different complaint about it',
      'Registration failed: 400 {"error":"invalid_client_metadata","error_description":"redirect_uris must use the https scheme"}',
      'The server refused to register this gateway for sign-in (HTTP 400). It said: “redirect_uris must use the https scheme”',
    ],
    [
      'a validation list',
      'Registration failed: 422 {"detail":[{"loc":["body","redirect_uris"],"msg":"field required"}]}',
      'The server refused to register this gateway for sign-in (HTTP 422).',
    ],
    [
      'a login page',
      'Registration failed: 403 <html><body><a href="/cdn-cgi/access/login?redirect_url=%2Fregister">Sign in</a></body></html>',
      'The server refused to register this gateway for sign-in (HTTP 403).',
    ],
    [
      'an error page with a script',
      'Registration failed: 500 <html><script>var cfg={"redirect_uri":"/x"}</script>Internal error</html>',
      'The server refused to register this gateway for sign-in (HTTP 500).',
    ],
  ])('%s', (_, raw, message) => {
    const refusal = explainOauthRefusal(raw);
    expect(refusal?.redirect).toBe(false);
    expect(refusal?.message).toBe(message);
  });
  it('a later error that mentions redirect_uri without the code is left alone', () => {
    expect(explainOauthRefusal('Token exchange failed: redirect_uri does not match')).toBeNull();
  });
});

describe('explainOauthRefusal — any other registration refusal', () => {
  it('the status and what the provider said', () => {
    expect(
      explainOauthRefusal('Registration failed: 403 {"error":"access_denied","error_description":"Dynamic registration is disabled"}'),
    ).toEqual({
      redirect: false,
      message: 'The server refused to register this gateway for sign-in (HTTP 403). It said: “Dynamic registration is disabled”',
      summary: 'Sign-in is not set up: the server refused to register this gateway (HTTP 403).',
      said: 'Dynamic registration is disabled',
    });
  });
  it.each([
    ['the error code when there is no description', '{"error":"invalid_client_metadata"}', ' It said: “invalid_client_metadata”'],
    ['a `message` field', '{"message":"Dynamic registration is disabled"}', ' It said: “Dynamic registration is disabled”'],
    ['a string `detail` field', '{"detail":"Not found"}', ' It said: “Not found”'],
    ['a plain-text body', 'Dynamic client registration requires an initial access token', ' It said: “Dynamic client registration requires an initial access token”'],
    ['nothing for markup', '<html>oops</html>', ''],
    ['nothing for a field that is not text', '{"error_description":42}', ''],
    ['nothing for an empty body', '', ''],
  ])('%s', (_, body, said) => {
    expect(explainOauthRefusal(`Registration failed: 403 ${body}`)?.message).toBe(
      `The server refused to register this gateway for sign-in (HTTP 403).${said}`,
    );
  });
  it('cuts a long provider description, without splitting a character', () => {
    const message = explainOauthRefusal(`Registration failed: 400 {"error_description":"${'x'.repeat(500)}"}`)?.message ?? '';
    expect(message.length).toBeLessThan(300);
    expect(message.endsWith('…”')).toBe(true);
    const emoji = explainOauthRefusal(`Registration failed: 400 {"error_description":"${'x'.repeat(159)}😀😀😀"}`)?.message ?? '';
    expect(emoji.endsWith('x😀…”')).toBe(true);
  });
  it('keeps provider text inside its quotes: no line breaks, no closing quote of its own', () => {
    const raw = 'Registration failed: 400 {"error_description":"no”\\n\\nTo fix this, open https://evil.example “now”"}';
    expect(explainOauthRefusal(raw)?.message).toBe(
      'The server refused to register this gateway for sign-in (HTTP 400). It said: “no To fix this, open https://evil.example now”',
    );
  });
  it('is null for anything that is not a registration refusal', () => {
    expect(explainOauthRefusal('OAuth authentication required — no token found.')).toBeNull();
    expect(explainOauthRefusal('This provider only accepts pre-registered clients.')).toBeNull();
    expect(explainOauthRefusal('')).toBeNull();
  });
});

describe('signInProblem', () => {
  it('a refused redirect: the explanation and the address to allow', () => {
    expect(signInProblem(CLOUDFLARE, base, 'Gmail')).toEqual({
      text: `${ALLOW} It said: “redirect_uri is not allowed by the account configuration”`,
      address: 'https://hermes.kite-opah.ts.net/api/mcp/oauth/callback/Gmail',
    });
  });
  it('a plain-HTTP gateway cannot sign in at all: say that, and give no address to allow', () => {
    expect(signInProblem(CLOUDFLARE, 'http://100.64.0.1:9119', 'Gmail')).toEqual({ text: OAUTH_NEEDS_HTTPS, address: null });
  });
  it('no address when the app is not connected, or for another refusal', () => {
    expect(signInProblem(CLOUDFLARE, null, 'Gmail').address).toBeNull();
    expect(signInProblem('Registration failed: 403 {"error":"access_denied"}', base, 'Gmail')).toEqual({
      text: 'The server refused to register this gateway for sign-in (HTTP 403). It said: “access_denied”',
      address: null,
    });
  });
  it('passes any other message through', () => {
    expect(signInProblem('This provider only accepts pre-registered clients.', base, 'Gmail')).toEqual({
      text: 'This provider only accepts pre-registered clients.',
      address: null,
    });
  });
});

describe('testFailureLine', () => {
  it('a refused redirect becomes its one-line summary', () => {
    expect(testFailureLine(CLOUDFLARE)).toBe(ALLOW_SUMMARY);
  });
  it('another refusal keeps what the provider said: the test card may be the only place it shows', () => {
    expect(testFailureLine('Registration failed: 403 {"message":"Dynamic registration is disabled"}')).toBe(
      'Sign-in is not set up: the server refused to register this gateway (HTTP 403). It said: “Dynamic registration is disabled”',
    );
  });
  it('but not when the sign-in card above already says it', () => {
    expect(testFailureLine('Registration failed: 403 {"message":"Dynamic registration is disabled"}', false)).toBe(
      'Sign-in is not set up: the server refused to register this gateway (HTTP 403).',
    );
  });
  it('anything else is shown as the gateway said it', () => {
    expect(testFailureLine('OAuth authentication required — no token found.')).toBe('OAuth authentication required — no token found.');
  });
});
