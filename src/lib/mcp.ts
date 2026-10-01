// src/lib/mcp.ts — pure logic for the Connectors screens (spec §5, §8). No I/O.
import { McpAlreadyAddedError, McpPreflightError, type McpCatalogEntry, type McpServer } from '@/api/mcp';
import type { McpRuntimeRow, McpTestOutcome } from '@/api/mcpSession';
import { AuthError, HttpError } from '@/api/restClient';

// --- catalog ---------------------------------------------------------------

/** Entries the app can add: remote, with no local install step. Sorted by name. */
export function remoteCatalogEntries(entries: McpCatalogEntry[]): McpCatalogEntry[] {
  return entries
    .filter((e) => e.transport === 'http' && !e.needs_install)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Case-insensitive substring match over name and description. */
export function filterCatalog(entries: McpCatalogEntry[], query: string): McpCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) => e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q),
  );
}

// --- custom server form ----------------------------------------------------

const SKIPPED_LABELS = new Set(['www', 'mcp', 'api']);

/** A name suggestion from the URL's host: `https://mcp.linear.app/mcp` → `linear`. '' when there is none. */
export function suggestServerName(url: string): string {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return '';
  const labels = host.split('.').filter(Boolean);
  const body = labels.length > 1 ? labels.slice(0, -1) : labels;
  const pick = body.find((l) => !SKIPPED_LABELS.has(l)) ?? body[0] ?? '';
  return pick.replace(/[^a-z0-9_-]/g, '-');
}

export interface CustomServerDraft {
  name: string;
  url: string;
  auth: 'none' | 'header' | 'oauth';
  /** Whether a token has been typed. The token itself never reaches this module. */
  hasToken: boolean;
}

export interface CustomServerIssues {
  name?: string;
  url?: string;
  token?: string;
  /** Not an error: shown under the URL field. */
  caution?: string;
}

/** Client-side checks before any request; the gateway does the real validation. */
export function validateCustomServer(draft: CustomServerDraft): CustomServerIssues {
  const issues: CustomServerIssues = {};
  const name = draft.name.trim();
  if (!name) issues.name = 'Enter a name.';
  else if (/[\s/]/.test(name)) issues.name = 'Use a name without spaces or slashes.';

  const url = draft.url.trim();
  if (!url) {
    issues.url = 'Enter the server URL.';
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    const protocol = parsed?.protocol ?? '';
    if (protocol !== 'http:' && protocol !== 'https:') {
      issues.url = 'Enter a URL that starts with https://';
    } else if (parsed) {
      const cautions: string[] = [];
      if (protocol === 'http:') cautions.push('Traffic between your gateway and this server will not be encrypted.');
      // The URL is not typed into the secret form: it is kept as written and shown on the connector.
      if (parsed.search || parsed.username || parsed.password) {
        cautions.push('This URL carries a key or credentials. It is stored on the gateway as written and shown in the app.');
      }
      if (cautions.length > 0) issues.caution = cautions.join(' ');
    }
  }

  if (draft.auth === 'header' && !draft.hasToken) issues.token = 'Enter the token.';
  return issues;
}

export function isCustomServerValid(issues: CustomServerIssues): boolean {
  return !issues.name && !issues.url && !issues.token;
}

// --- what a server allows (spec §5.3) --------------------------------------

export interface ServerCapabilities {
  /** False when the REST routes cannot address the name (it contains '/'). */
  manageable: boolean;
  canSwitch: boolean;
  canTest: boolean;
  /** Test runs when the detail screen opens (remote servers only). */
  autoTest: boolean;
  canSignIn: boolean;
  canRemove: boolean;
}

export function serverCapabilities(server: McpServer): ServerCapabilities {
  const manageable = !server.name.includes('/');
  const config = server.source !== 'plugin';
  const remote = server.transport === 'http';
  const known = server.transport === 'http' || server.transport === 'stdio';
  return {
    manageable,
    canSwitch: manageable && config,
    canTest: known,
    autoTest: remote,
    canSignIn: manageable && config && remote && server.auth === 'oauth',
    canRemove: manageable && config && remote,
  };
}

// --- labels ----------------------------------------------------------------

export function authLabel(server: McpServer): 'OAuth' | 'Token' | null {
  if (server.auth === 'oauth') return 'OAuth';
  if (server.auth === 'header') return 'Token';
  return null;
}

/** Second line of a row: the URL's host, or the command for a local server. */
export function serverSubtitle(server: McpServer): string {
  if (server.url) {
    try {
      return new URL(server.url).host;
    } catch {
      return server.url;
    }
  }
  if (server.command) return [server.command, ...(server.args ?? [])].join(' ');
  return '';
}

const tools = (n: unknown): string => {
  const count = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return `${count} ${count === 1 ? 'tool' : 'tools'}`;
};

/** True when the switch and the running gateway disagree: the config says on but the server
 * is not loaded, or off but it still is. A reload (or a gateway restart) settles it. */
export function needsReload(server: McpServer, row?: McpRuntimeRow): boolean {
  if (!row) return false;
  const loaded = row.status === 'connected' || row.status === 'lazy';
  if (server.enabled) return row.status === 'disabled' || row.status === 'configured';
  return loaded;
}

/** The runtime status line (spec §5.8); null when there is nothing to show. */
export function statusLine(server: McpServer, row?: McpRuntimeRow): string | null {
  if (!row) return null;
  let line: string;
  switch (row.status) {
    case 'connected':
      line = `Connected · ${tools(row.tools)}`;
      break;
    case 'lazy':
      line = `Ready · ${tools(row.tools)}`;
      break;
    case 'connecting':
      return 'Connecting…';
    case 'failed':
      return 'Failed';
    case 'disabled':
      line = 'Off';
      break;
    case 'configured':
      line = 'Not loaded yet';
      break;
    default:
      return null;
  }
  return needsReload(server, row) ? `${line} · changes after reload` : line;
}

const RUNTIME_STATES = new Set(['connected', 'lazy', 'connecting', 'failed']);

/** Runtime rows by server name (spec §5.8). For an explicitly selected profile the gateway may
 * report no runtime state at all — every row then reads `configured` or `disabled` — and the map
 * is empty so the list shows no misleading "Not loaded yet". */
export function runtimeRowsByName(rows: McpRuntimeRow[], profileSelected: boolean): Map<string, McpRuntimeRow> {
  const list = rows ?? [];
  if (profileSelected && !list.some((r) => RUNTIME_STATES.has(r.status))) return new Map();
  return new Map(list.map((r) => [r.name, r]));
}

/** Small labels on a row: how it authenticates, whether it runs on the gateway, who provides it. */
export function connectorBadges(server: McpServer): string[] {
  const badges: string[] = [];
  const auth = authLabel(server);
  if (auth) badges.push(auth);
  if (server.transport === 'stdio') badges.push('Local');
  if (server.source === 'plugin') badges.push('Plugin');
  return badges;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** First line of a passed test: "Working · 3 tools · 2 prompts". */
export function testSummary(outcome: { tools: unknown[]; prompts: number; resources: number }): string {
  const parts = [`Working · ${plural(outcome.tools.length, 'tool')}`];
  if (outcome.prompts > 0) parts.push(plural(outcome.prompts, 'prompt'));
  if (outcome.resources > 0) parts.push(plural(outcome.resources, 'resource'));
  return parts.join(' · ');
}

/** Catalog credential fields are masked unless the name says the value is not a secret (spec §5.9). */
export function isPlainEnvField(name: string): boolean {
  return /_(URL|HOST|ID)$/i.test(name);
}

// --- errors (spec §8) ------------------------------------------------------

export type ConnectorAction = 'list' | 'catalog' | 'add' | 'install' | 'switch' | 'remove' | 'signin';

export type ConnectorError =
  | { kind: 'auth' }
  | { kind: 'unsupported'; message: string }
  | { kind: 'gone'; message: string }
  | { kind: 'message'; message: string };

const UNSUPPORTED = "This gateway doesn't support connectors (needs Hermes 0.21.5 or later).";
const GONE = 'This connector no longer exists.';
const UNREACHABLE = 'Gateway unreachable — check your VPN or Wi-Fi.';

const isRead = (a: ConnectorAction): boolean => a === 'list' || a === 'catalog';
const isServerAction = (a: ConnectorAction): boolean => a === 'switch' || a === 'remove' || a === 'signin';

/** Map a failed connector request to what the screen does and says. */
export function connectorError(error: unknown, action: ConnectorAction): ConnectorError {
  if (error instanceof AuthError) return { kind: 'auth' };
  // The fast request before a slow one failed: nothing was sent, so this is about reaching
  // the gateway, not about the action.
  if (error instanceof McpPreflightError) return connectorError(error.reason, 'list');
  if (error instanceof McpAlreadyAddedError) return { kind: 'message', message: error.message };
  if (error instanceof HttpError) {
    if (error.status === 404) {
      const bare = /^not found$/i.test(error.message) || error.message.startsWith('HTTP 404 on ');
      if (isRead(action) && bare) return { kind: 'unsupported', message: UNSUPPORTED };
      if (isServerAction(action)) return { kind: 'gone', message: GONE };
    }
    if (error.status === 0) {
      const write = action === 'add' || action === 'install';
      return {
        kind: 'message',
        message: `The gateway did not answer in time.${write ? ' Check the list before trying again.' : ''}`,
      };
    }
    // RestClient surfaces only a string `detail`; without one (a FastAPI 422 carries a list)
    // its message is "HTTP <status> on <path>", which is not something to show.
    if (/^HTTP \d+ on /.test(error.message)) {
      return {
        kind: 'message',
        message:
          error.status === 422
            ? 'The gateway could not read this request.'
            : `The gateway returned an error (HTTP ${error.status}).`,
      };
    }
    return { kind: 'message', message: error.message };
  }
  // An old gateway answers unknown /api paths with its HTML shell: res.json() throws SyntaxError.
  if (error instanceof SyntaxError && isRead(action)) return { kind: 'unsupported', message: UNSUPPORTED };
  return { kind: 'message', message: UNREACHABLE };
}

// --- OAuth (spec §5.6) -----------------------------------------------------

/** OAuth needs the gateway on HTTPS: providers do not accept a plain-HTTP redirect. */
export function gatewaySupportsOauth(baseUrl: string): boolean {
  return /^https:\/\//i.test(baseUrl.trim());
}

/** Rule B: null when the authorization URL is safe to open, otherwise the message to show. */
export function checkAuthorizationUrl(url: string, baseUrl: string): string | null {
  let auth: URL;
  try {
    auth = new URL(url);
  } catch {
    return 'The gateway returned a sign-in address that is not a valid URL.';
  }
  if (auth.protocol !== 'https:') return 'The sign-in address is not HTTPS, so it was not opened.';

  // Every value is checked: a provider could read a different one than the first.
  const redirects = auth.searchParams.getAll('redirect_uri');
  if (redirects.length === 0) return null; // pushed authorization request: nothing to check

  let want: URL;
  try {
    want = new URL(baseUrl.trim());
  } catch {
    return 'The gateway address in this app is not a valid URL.';
  }
  const basePath = want.pathname.replace(/\/+$/, '');
  const prefix = `${basePath}/api/mcp/oauth/callback/`;
  const reachable = redirects.every((redirect) => {
    try {
      const got = new URL(redirect);
      return got.origin === want.origin && got.pathname.startsWith(prefix);
    } catch {
      return false;
    }
  });
  // `origin` drops any credentials in the stored gateway URL.
  return reachable
    ? null
    : `The gateway would send the sign-in back to an address this phone cannot reach. Set HERMES_DASHBOARD_PUBLIC_URL on the gateway to ${want.origin}${basePath}.`;
}

/** The address the gateway asks a provider to send a sign-in back to, unless the gateway is
 * configured with another one. Null when the gateway address is not a URL. */
export function oauthRedirectAddress(baseUrl: string, name: string): string | null {
  let base: URL;
  try {
    base = new URL(baseUrl.trim());
  } catch {
    return null;
  }
  // The gateway uses Python's quote(name, safe=''), which also encodes these five.
  const quoted = encodeURIComponent(name).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  // `origin` drops any credentials in the stored gateway URL.
  return `${base.origin}${base.pathname.replace(/\/+$/, '')}/api/mcp/oauth/callback/${quoted}`;
}

/** A provider's refusal to register the gateway for sign-in, in words. */
export interface OauthRefusal {
  /** It refused the redirect address, which the provider's settings can allow. */
  redirect: boolean;
  /** For the sign-in card. */
  message: string;
  /** One line for the test card. */
  summary: string;
}

const REGISTRATION_FAILED = /Registration failed: (\d{3})\b\s*([\s\S]*)$/;
// Inside a registration refusal any mention of the redirect address counts; elsewhere only
// the standard error code does (a token-exchange error can mention `redirect_uri` too).
const REDIRECT_REFUSED = /invalid_redirect_uri|redirect[_ ]ur[il]/i;
const REDIRECT_CODE = /invalid_redirect_uri/i;
const MAX_PROVIDER_TEXT = 160;

/** What the provider said, from its JSON answer: the description, else the error code. */
function providerSaid(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { error, error_description: description } = parsed as { error?: unknown; error_description?: unknown };
  const said = typeof description === 'string' && description.trim() ? description : typeof error === 'string' ? error : '';
  const text = said.trim();
  if (!text) return null;
  return text.length > MAX_PROVIDER_TEXT ? `${text.slice(0, MAX_PROVIDER_TEXT)}…` : text;
}

/** The gateway passes a provider's registration refusal through as
 * `Registration failed: <status> <body>`. Null for any other text. */
export function explainOauthRefusal(text: string): OauthRefusal | null {
  const failed = REGISTRATION_FAILED.exec(text);
  if (failed ? REDIRECT_REFUSED.test(failed[2]) : REDIRECT_CODE.test(text)) {
    return {
      redirect: true,
      message:
        'The server’s sign-in does not allow this gateway’s redirect address. Add it to the server’s allowed redirect addresses, then sign in again.',
      summary: 'Sign-in is not set up: the server does not allow this gateway’s redirect address.',
    };
  }
  if (!failed) return null;
  const status = failed[1];
  const said = providerSaid(failed[2]);
  return {
    redirect: false,
    message: `The server refused to register this gateway for sign-in (HTTP ${status}).${said ? ` It said: “${said}”` : ''}`,
    summary: `Sign-in is not set up: the server refused to register this gateway (HTTP ${status}).`,
  };
}

/** What the sign-in card shows for a failed sign-in: the words, and the address to allow when
 * the provider refused it. */
export function signInProblem(text: string, baseUrl: string | null, name: string): { text: string; address: string | null } {
  const refusal = explainOauthRefusal(text);
  if (!refusal) return { text, address: null };
  return { text: refusal.message, address: refusal.redirect && baseUrl ? oauthRedirectAddress(baseUrl, name) : null };
}

/** The test card's line for a failed test. */
export function testFailureLine(text: string): string {
  return explainOauthRefusal(text)?.summary ?? text;
}

// --- the add forms (spec §5.4, §5.5, §5.9) ----------------------------------

/** One value the add forms collect and hand to ConnectorSecretForm. */
export interface SecretField {
  key: string;
  label: string;
  /** A secure input. Plain only for names that say the value is not a secret. */
  masked: boolean;
  required: boolean;
}

/** One field per variable a catalog entry declares: labelled by the gateway's prompt (or
 * the variable's name), masked unless `isPlainEnvField`. */
export function secretFieldsForEntry(entry: McpCatalogEntry): SecretField[] {
  return (entry.required_env ?? []).map((e) => ({
    key: e.name,
    label: e.prompt?.trim() || e.name,
    masked: !isPlainEnvField(e.name),
    required: Boolean(e.required),
  }));
}

/** The trimmed, non-blank values to send, and the first required field left blank (or null). */
export function collectSecretValues(
  fields: SecretField[],
  values: Record<string, string>,
): { env: Record<string, string>; missing: SecretField | null } {
  const env: Record<string, string> = {};
  let missing: SecretField | null = null;
  for (const field of fields) {
    const value = (values[field.key] ?? '').trim();
    if (value) env[field.key] = value;
    else if (field.required && !missing) missing = field;
  }
  return { env, missing };
}

/** How a catalog entry authenticates, in words. */
export function catalogAuthLabel(entry: McpCatalogEntry): string {
  if (entry.auth_type === 'oauth') return 'OAuth sign-in';
  if (!entry.auth_type || entry.auth_type === 'none') return 'No sign-in needed';
  return entry.auth_type;
}

/** "Sign in again" only when the last test saw a token on the gateway; otherwise "Sign in". */
export function signInLabel(outcome: McpTestOutcome | null): 'Sign in' | 'Sign in again' {
  return outcome && outcome.kind !== 'error' && outcome.tokensPresent === true ? 'Sign in again' : 'Sign in';
}

/** The Remove alert. Removing deletes only the config entry: tokens stay on the gateway. */
export function removeConfirmation(name: string): { title: string; message: string } {
  return {
    title: `Remove ${name}?`,
    message:
      'The agent stops using it after a reload or a gateway restart. Its sign-in and any stored token stay on the gateway until they are removed there.',
  };
}

/** After an add whose answer never arrived: is the server the gateway has the one just submitted? */
export function sameServerAddress(server: McpServer, submittedUrl: string): boolean {
  return server.url !== null && server.url === submittedUrl.trim();
}
