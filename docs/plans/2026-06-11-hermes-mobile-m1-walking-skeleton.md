# Hermes Mobile — Milestone 1: Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Expo iOS app (new repo `hermes-mobile-app`) that logs into an unmodified hermes-agent dashboard over Tailscale, lists sessions, and holds a streaming chat.

**Architecture:** Pure client of the existing dashboard backend (port 9119, gated auth mode, `basic` password provider). Auth = password login → AT/RT cookies (manual cookie jar) → single-use WS ticket → JSON-RPC 2.0 over `/api/ws`. No server-side changes anywhere.

**Tech Stack:** Expo SDK (latest, TypeScript, expo-router), `expo-secure-store`, jest via `jest-expo`. No state library (YAGNI for skeleton).

**Spec:** `docs/superpowers/specs/2026-06-11-mobile-extension-design.md` (hermes-agent repo).

**Wire contract (verified against hermes-agent source, 2026-06-11):**

| Operation | Call |
| --- | --- |
| Login | `POST /auth/password-login` JSON `{provider:"basic", username, password}` → 200 `{ok:true}` + `Set-Cookie: hermes_session_at` (~15 min Max-Age) and `hermes_session_rt` (30 d, rotating). Bare cookie names over plain HTTP (tailnet); `__Host-`-prefixed over HTTPS. 401 invalid creds, 429 rate-limited. |
| Refresh | Automatic server-side: send RT cookie, middleware rotates and re-`Set-Cookie`s both. Client just keeps ingesting `Set-Cookie` on every response. |
| WS ticket | `POST /api/auth/ws-ticket` (empty JSON body, cookie auth) → `{ticket, ttl_seconds:30}`. Single-use. |
| WebSocket | `ws://<host>:9119/api/ws?ticket=<t>`. JSON-RPC 2.0. Server validates `Host` (and `Origin` when present — DNS-rebinding defense). |
| Create session | method `session.create` params `{title?, cwd?, profile?}` → `{session_id, info:{...}}` |
| Send message | method `prompt.submit` params `{session_id, text}` → `{status:"streaming"}` |
| Events | frames `{jsonrpc:"2.0", method:"event", params:{type, session_id, payload}}`. Types used here: `message.start`, `message.delta` (`payload.text`), `message.complete`, `tool.start`/`tool.complete` (`payload.tool_name`), `status.update`, `error` (`payload.message`), `gateway.ready`. |
| Sessions (REST) | `GET /api/sessions?limit=40&order=recent` → `{sessions:[{id,title,preview,last_active,message_count,...}], total}` |
| History (REST) | `GET /api/sessions/{id}/messages` → `{messages:[{role,text,timestamp,tool_name,...}]}` |

**Server prerequisites (manual, gateway host):**
```bash
export HERMES_DASHBOARD_BASIC_AUTH_USERNAME=gianluca
export HERMES_DASHBOARD_BASIC_AUTH_PASSWORD='<strong password>'
hermes web --host <tailscale-ip> --port 9119   # non-loopback bind ⇒ auth_required=True
```

**Known platform risks (checked during Task 9, fallbacks named):**
- React Native `fetch` may merge multiple `Set-Cookie` headers into one comma-joined string → `CookieJar.ingest` handles both shapes (tested). If RN hides `Set-Cookie` entirely on device, fallback: `@react-native-cookies/cookies` to read the native store.
- RN's native stack may *also* store cookies. We send `credentials:'omit'` and our own `Cookie` header; if duplicates appear server-side, harmless (same values).
- If the WS upgrade is rejected on Origin, pass `{headers:{Origin: <http origin>}}` as the RN WebSocket options (verified hook in Task 4's socket factory).

---

## File structure (new repo `~/Developer/hermes-mobile-app`)

```
hermes-mobile-app/
├── app/                      # expo-router screens
│   ├── _layout.tsx           # stack navigator
│   ├── index.tsx             # Connect screen (URL + credentials)
│   ├── sessions.tsx          # Session list
│   └── chat/[id].tsx         # Chat screen ([id] = "new" or session id)
├── src/
│   ├── api/
│   │   ├── cookieJar.ts      # Set-Cookie parsing / Cookie header (pure, unit-tested)
│   │   ├── types.ts          # vendored wire types
│   │   ├── restClient.ts     # login, wsTicket, listSessions, getMessages (pure, unit-tested)
│   │   └── gatewayClient.ts  # JSON-RPC over WebSocket (pure, unit-tested)
│   └── connection.ts         # singleton: holds jar+clients, persists creds via SecureStore
├── __tests__/                # jest-expo unit tests
└── docs/
    ├── design.md             # copied spec
    └── plans/                # this plan
```

---

### Task 0: Scaffold the repo

**Files:** entire new repo at `~/hermes-mobile-app`

- [ ] **Step 1: Create the Expo app**

```bash
cd ~
npx create-expo-app@latest hermes-mobile-app --template default
cd hermes-mobile-app
```
Expected: TypeScript expo-router template scaffolded, `npx expo start` runs.

- [ ] **Step 2: Reset to a blank router skeleton and add deps**

```bash
cd ~/hermes-mobile-app
npm run reset-project -- --no-example 2>/dev/null || true   # template script; ok if absent
npx expo install expo-secure-store
npm install --save-dev jest jest-expo @types/jest
```

- [ ] **Step 3: Configure jest** — add to `package.json`:

```json
{
  "scripts": { "test": "jest" },
  "jest": { "preset": "jest-expo", "testMatch": ["**/__tests__/**/*.test.ts"] }
}
```

- [ ] **Step 4: Copy design docs into the repo**

```bash
mkdir -p docs/plans
cp ~/hermes-agent/docs/superpowers/specs/2026-06-11-mobile-extension-design.md docs/design.md
cp ~/hermes-agent/docs/superpowers/plans/2026-06-11-hermes-mobile-m1-walking-skeleton.md docs/plans/
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && npx jest --passWithNoTests`
Expected: both succeed.

```bash
git add -A && git commit -m "chore: scaffold Expo app with jest, vendor design docs"
```

---

### Task 1: CookieJar

**Files:**
- Create: `src/api/cookieJar.ts`
- Test: `__tests__/cookieJar.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/cookieJar.test.ts
import { CookieJar, splitSetCookie } from '../src/api/cookieJar';

describe('splitSetCookie', () => {
  it('splits RN comma-joined Set-Cookie without breaking Expires dates', () => {
    const joined =
      'hermes_session_at=abc123; HttpOnly; Max-Age=900; Path=/; SameSite=lax, ' +
      'hermes_session_rt=def456; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Path=/';
    expect(splitSetCookie(joined)).toEqual([
      'hermes_session_at=abc123; HttpOnly; Max-Age=900; Path=/; SameSite=lax',
      'hermes_session_rt=def456; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Path=/',
    ]);
  });
});

describe('CookieJar', () => {
  it('stores cookies and emits a Cookie header', () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_at=abc; HttpOnly; Max-Age=900; Path=/']);
    jar.ingest(['hermes_session_rt=def; HttpOnly; Max-Age=2592000; Path=/']);
    expect(jar.header()).toBe('hermes_session_at=abc; hermes_session_rt=def');
  });

  it('rotation: later Set-Cookie for the same name replaces the value', () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_rt=old; Path=/']);
    jar.ingest(['hermes_session_rt=new; Path=/']);
    expect(jar.header()).toBe('hermes_session_rt=new');
  });

  it('Max-Age=0 deletes the cookie', () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_pkce=x; Path=/']);
    jar.ingest(['hermes_session_pkce=; Max-Age=0; Path=/']);
    expect(jar.header()).toBeNull();
  });

  it('round-trips through JSON for persistence', () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_at=abc; Path=/']);
    const restored = CookieJar.fromJSON(jar.toJSON());
    expect(restored.header()).toBe('hermes_session_at=abc');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest cookieJar -v` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/api/cookieJar.ts
/** Split a comma-joined Set-Cookie string (React Native merges multiple
 * headers) into individual cookie strings. Splits only on a comma followed
 * by `name=` — an Expires date's "Wed, 21 Oct" has no `=` before the next
 * `;`, so it survives. */
export function splitSetCookie(joined: string): string[] {
  return joined.split(/,(?=\s*[A-Za-z0-9_\-!#$%&'*.^`|~]+=)/).map((s) => s.trim());
}

export class CookieJar {
  private cookies = new Map<string, string>();

  /** Accepts individual Set-Cookie strings or RN comma-joined ones. */
  ingest(setCookies: string[]): void {
    for (const raw of setCookies.flatMap(splitSetCookie)) {
      const [pair, ...attrs] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0+\s*$/i.test(a));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string | null {
    if (this.cookies.size === 0) return null;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  clear(): void {
    this.cookies.clear();
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.cookies);
  }

  static fromJSON(data: Record<string, string>): CookieJar {
    const jar = new CookieJar();
    for (const [k, v] of Object.entries(data)) jar.cookies.set(k, v);
    return jar;
  }
}
```

- [ ] **Step 4: Run tests** — `npx jest cookieJar -v` — Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/cookieJar.ts __tests__/cookieJar.test.ts
git commit -m "feat: cookie jar with RN comma-joined Set-Cookie handling"
```

---

### Task 2: Wire types

**Files:**
- Create: `src/api/types.ts`

- [ ] **Step 1: Write the types** (vendored subset of `apps/desktop/src/types/hermes.ts` + the JSON-RPC shapes; no test — declarations only)

```ts
// src/api/types.ts
export interface SessionSummary {
  id: string;
  title: string | null;
  preview: string | null;
  started_at: number;
  last_active: number;
  message_count: number;
  model?: string | null;
  source?: string;
  is_active?: boolean;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string | null;
  timestamp: number;
  tool_name?: string | null;
}

export interface MessagesResponse {
  session_id: string;
  messages: SessionMessage[];
}

export interface WsTicketResponse {
  ticket: string;
  ttl_seconds: number;
}

export interface SessionCreateResult {
  session_id: string;
  stored_session_id?: string;
  info: { model?: string; profile_name?: string; lazy?: boolean };
}

export type GatewayEventType =
  | 'gateway.ready'
  | 'message.start'
  | 'message.delta'
  | 'message.complete'
  | 'tool.start'
  | 'tool.complete'
  | 'status.update'
  | 'error'
  | (string & {}); // forward-compatible

export interface GatewayEvent {
  type: GatewayEventType;
  session_id?: string;
  payload?: any;
}
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit` — Expected: clean.

```bash
git add src/api/types.ts && git commit -m "feat: vendor dashboard wire types"
```

---

### Task 3: REST client

**Files:**
- Create: `src/api/restClient.ts`
- Test: `__tests__/restClient.test.ts`

- [ ] **Step 1: Write the failing tests** (fetch injected — no network in unit tests)

```ts
// __tests__/restClient.test.ts
import { RestClient, AuthError } from '../src/api/restClient';
import { CookieJar } from '../src/api/cookieJar';

function fakeFetch(status: number, body: unknown, setCookie?: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => (k.toLowerCase() === 'set-cookie' ? setCookie ?? null : null) },
      json: async () => body,
    } as unknown as Response;
  };
  return Object.assign(fn, { calls });
}

describe('RestClient', () => {
  it('login posts credentials and ingests cookies', async () => {
    const jar = new CookieJar();
    const f = fakeFetch(200, { ok: true }, 'hermes_session_at=tok; Max-Age=900; Path=/');
    const c = new RestClient('http://100.1.2.3:9119', jar, f as any);
    await c.login('gianluca', 'pw');
    expect(f.calls[0].url).toBe('http://100.1.2.3:9119/auth/password-login');
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({
      provider: 'basic', username: 'gianluca', password: 'pw',
    });
    expect(jar.header()).toBe('hermes_session_at=tok');
  });

  it('login throws AuthError on 401', async () => {
    const c = new RestClient('http://h', new CookieJar(), fakeFetch(401, { detail: 'Invalid credentials' }) as any);
    await expect(c.login('u', 'bad')).rejects.toThrow(AuthError);
  });

  it('authed requests send the Cookie header and ingest rotations', async () => {
    const jar = new CookieJar();
    jar.ingest(['hermes_session_rt=r1; Path=/']);
    const f = fakeFetch(200, { ticket: 't', ttl_seconds: 30 }, 'hermes_session_rt=r2; Path=/');
    const c = new RestClient('http://h', jar, f as any);
    const t = await c.wsTicket();
    expect(t.ticket).toBe('t');
    expect((f.calls[0].init.headers as Record<string, string>)['Cookie']).toBe('hermes_session_rt=r1');
    expect(jar.header()).toBe('hermes_session_rt=r2'); // rotation honored
  });

  it('authed requests throw AuthError on 401 (session dead → re-login)', async () => {
    const c = new RestClient('http://h', new CookieJar(), fakeFetch(401, {}) as any);
    await expect(c.listSessions()).rejects.toThrow(AuthError);
  });

  it('listSessions hits the right URL', async () => {
    const f = fakeFetch(200, { sessions: [], total: 0, limit: 40, offset: 0 });
    const c = new RestClient('http://h', new CookieJar(), f as any);
    await c.listSessions();
    expect(f.calls[0].url).toBe('http://h/api/sessions?limit=40&order=recent');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest restClient -v` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/api/restClient.ts
import { CookieJar } from './cookieJar';
import type { MessagesResponse, SessionListResponse, WsTicketResponse } from './types';

export class AuthError extends Error {}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type FetchFn = typeof fetch;

export class RestClient {
  constructor(
    public readonly baseUrl: string,           // e.g. http://100.1.2.3:9119 (no trailing slash)
    private readonly jar: CookieJar,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };
    const cookie = this.jar.header();
    if (cookie) headers['Cookie'] = cookie;
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'omit', // we manage cookies ourselves
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.jar.ingest([setCookie]);
    if (res.status === 401) throw new AuthError('session expired or invalid credentials');
    if (res.status === 429) throw new HttpError(429, 'rate limited — wait a minute');
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} on ${path}`);
    return (await res.json()) as T;
  }

  async login(username: string, password: string): Promise<void> {
    await this.request<{ ok: boolean }>('/auth/password-login', {
      method: 'POST',
      body: JSON.stringify({ provider: 'basic', username, password }),
    });
  }

  wsTicket(): Promise<WsTicketResponse> {
    return this.request<WsTicketResponse>('/api/auth/ws-ticket', { method: 'POST', body: '{}' });
  }

  listSessions(): Promise<SessionListResponse> {
    return this.request<SessionListResponse>('/api/sessions?limit=40&order=recent');
  }

  getMessages(sessionId: string): Promise<MessagesResponse> {
    return this.request<MessagesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
  }

  /** ws:// or wss:// URL for the gateway socket. */
  wsUrl(ticket: string): string {
    return `${this.baseUrl.replace(/^http/, 'ws')}/api/ws?ticket=${encodeURIComponent(ticket)}`;
  }
}
```

- [ ] **Step 4: Run tests** — `npx jest restClient -v` — Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/restClient.ts __tests__/restClient.test.ts
git commit -m "feat: REST client — login, ws-ticket, sessions, history"
```

---

### Task 4: Gateway (WebSocket JSON-RPC) client

**Files:**
- Create: `src/api/gatewayClient.ts`
- Test: `__tests__/gatewayClient.test.ts`

- [ ] **Step 1: Write the failing tests** (socket injected via factory)

```ts
// __tests__/gatewayClient.test.ts
import { GatewayClient } from '../src/api/gatewayClient';
import type { GatewayEvent } from '../src/api/types';

class FakeSocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.({ code: 1000, reason: '' }); }
  // test helpers
  open() { this.onopen?.(); }
  receive(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

function connected() {
  const sock = new FakeSocket();
  const client = new GatewayClient(() => sock as any);
  const ready = client.connect('ws://h/api/ws?ticket=t');
  sock.open();
  return { sock, client, ready };
}

describe('GatewayClient', () => {
  it('resolves connect() on open', async () => {
    const { ready } = connected();
    await expect(ready).resolves.toBeUndefined();
  });

  it('call() sends JSON-RPC and resolves with the matching result', async () => {
    const { sock, client, ready } = connected();
    await ready;
    const p = client.call('session.create', { title: 'hi' });
    const sentFrame = JSON.parse(sock.sent[0]);
    expect(sentFrame).toMatchObject({ jsonrpc: '2.0', method: 'session.create', params: { title: 'hi' } });
    sock.receive({ jsonrpc: '2.0', id: sentFrame.id, result: { session_id: 'abc' } });
    await expect(p).resolves.toEqual({ session_id: 'abc' });
  });

  it('call() rejects on JSON-RPC error response', async () => {
    const { sock, client, ready } = connected();
    await ready;
    const p = client.call('prompt.submit', { session_id: 'x', text: 'y' });
    const id = JSON.parse(sock.sent[0]).id;
    sock.receive({ jsonrpc: '2.0', id, error: { code: -32000, message: 'boom' } });
    await expect(p).rejects.toThrow('boom');
  });

  it('dispatches event frames to the handler', async () => {
    const { sock, client, ready } = connected();
    await ready;
    const events: GatewayEvent[] = [];
    client.onEvent((e) => events.push(e));
    sock.receive({ jsonrpc: '2.0', method: 'event',
      params: { type: 'message.delta', session_id: 's1', payload: { text: 'Hel' } } });
    sock.receive({ jsonrpc: '2.0', method: 'event',
      params: { type: 'message.complete', session_id: 's1' } });
    expect(events).toEqual([
      { type: 'message.delta', session_id: 's1', payload: { text: 'Hel' } },
      { type: 'message.complete', session_id: 's1' },
    ]);
  });

  it('rejects pending calls when the socket closes', async () => {
    const { sock, client, ready } = connected();
    await ready;
    const p = client.call('session.list', {});
    sock.close();
    await expect(p).rejects.toThrow(/closed/i);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest gatewayClient -v` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/api/gatewayClient.ts
import type { GatewayEvent } from './types';

/** Minimal structural type so tests can inject a fake and RN's WebSocket fits. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class GatewayClient {
  private socket: SocketLike | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private eventHandlers = new Set<(e: GatewayEvent) => void>();
  private closeHandlers = new Set<(reason: string) => void>();

  constructor(private readonly makeSocket: (url: string) => SocketLike) {}

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = this.makeSocket(url);
      this.socket = sock;
      sock.onopen = () => resolve();
      sock.onerror = () => reject(new Error('websocket connection failed'));
      sock.onclose = (ev) => this.handleClose(ev.reason || `code ${ev.code}`);
      sock.onmessage = (ev) => this.handleFrame(ev.data);
    });
  }

  call<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
    const sock = this.socket;
    if (!sock) return Promise.reject(new Error('not connected'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      sock.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  onEvent(handler: (e: GatewayEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onClose(handler: (reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    this.socket?.close();
  }

  private handleFrame(data: string): void {
    let frame: any;
    try { frame = JSON.parse(data); } catch { return; }
    if (frame.method === 'event' && frame.params) {
      const e: GatewayEvent = {
        type: frame.params.type,
        ...(frame.params.session_id !== undefined && { session_id: frame.params.session_id }),
        ...(frame.params.payload !== undefined && { payload: frame.params.payload }),
      };
      for (const h of this.eventHandlers) h(e);
      return;
    }
    if (frame.id !== undefined) {
      const p = this.pending.get(frame.id);
      if (!p) return;
      this.pending.delete(frame.id);
      if (frame.error) p.reject(new Error(frame.error.message ?? 'gateway error'));
      else p.resolve(frame.result);
    }
  }

  private handleClose(reason: string): void {
    const err = new Error(`websocket closed: ${reason}`);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.socket = null;
    for (const h of this.closeHandlers) h(reason);
  }
}

/** Production socket factory. extraHeaders is the React Native WebSocket
 * options escape hatch — used only if the server's Origin check rejects us
 * (then pass { Origin: httpOrigin }). */
export function makeNativeSocket(url: string, extraHeaders?: Record<string, string>): SocketLike {
  // RN's WebSocket accepts an options object with headers as the 3rd arg.
  return new (WebSocket as any)(url, null, extraHeaders ? { headers: extraHeaders } : undefined);
}
```

- [ ] **Step 4: Run tests** — `npx jest gatewayClient -v` — Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/gatewayClient.ts __tests__/gatewayClient.test.ts
git commit -m "feat: JSON-RPC gateway client over WebSocket"
```

---

### Task 5: Connection singleton + secure persistence

**Files:**
- Create: `src/connection.ts`

- [ ] **Step 1: Implement** (thin glue, no unit test — exercised by screens and Task 9)

```ts
// src/connection.ts
import * as SecureStore from 'expo-secure-store';
import { CookieJar } from './api/cookieJar';
import { GatewayClient, makeNativeSocket } from './api/gatewayClient';
import { RestClient } from './api/restClient';

const STORE_KEY = 'hermes-connection';

interface StoredConnection {
  baseUrl: string;
  username: string;
  password: string; // M1 only — M2 replaces credentials with device tokens
  cookies: Record<string, string>;
}

let jar = new CookieJar();
let rest: RestClient | null = null;

export function getRest(): RestClient {
  if (!rest) throw new Error('not connected — go to the Connect screen');
  return rest;
}

export async function connect(baseUrl: string, username: string, password: string): Promise<void> {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  jar = new CookieJar();
  rest = new RestClient(cleanUrl, jar);
  await rest.login(username, password);
  await SecureStore.setItemAsync(
    STORE_KEY,
    JSON.stringify({ baseUrl: cleanUrl, username, password, cookies: jar.toJSON() } satisfies StoredConnection),
  );
}

/** Restore a saved connection. Returns false if none saved. Re-logs-in if
 * the stored cookies are dead (AuthError surfaces to caller otherwise). */
export async function restore(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(STORE_KEY);
  if (!raw) return false;
  const saved: StoredConnection = JSON.parse(raw);
  jar = CookieJar.fromJSON(saved.cookies);
  rest = new RestClient(saved.baseUrl, jar);
  try {
    await rest.listSessions(); // probe; ingests any rotated cookies
  } catch {
    await rest.login(saved.username, saved.password); // cookies dead → fresh login
  }
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({ ...saved, cookies: jar.toJSON() }));
  return true;
}

export async function disconnect(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY);
  jar.clear();
  rest = null;
}

/** Mint a fresh single-use ticket and open a gateway socket (tickets live 30s — always mint immediately before connecting). */
export async function openGateway(): Promise<GatewayClient> {
  const r = getRest();
  const { ticket } = await r.wsTicket();
  const gw = new GatewayClient((url) => makeNativeSocket(url));
  await gw.connect(r.wsUrl(ticket));
  return gw;
}
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npx jest` — Expected: clean, all prior tests pass.

```bash
git add src/connection.ts && git commit -m "feat: connection singleton with SecureStore persistence"
```

---

### Task 6: Connect screen

**Files:**
- Create: `app/_layout.tsx`, `app/index.tsx`
- Delete: any template screens left under `app/`

- [ ] **Step 1: Layout**

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: '#111' }, headerTintColor: '#fff' }}>
      <Stack.Screen name="index" options={{ title: 'Hermes' }} />
      <Stack.Screen name="sessions" options={{ title: 'Sessions' }} />
      <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
    </Stack>
  );
}
```

- [ ] **Step 2: Connect screen**

```tsx
// app/index.tsx
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { AuthError } from '../src/api/restClient';
import { connect, restore } from '../src/connection';

export default function ConnectScreen() {
  const [url, setUrl] = useState('http://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    restore()
      .then((ok) => { if (ok) router.replace('/sessions'); })
      .catch(() => setError('Saved connection failed — gateway unreachable? Check your VPN.'))
      .finally(() => setBusy(false));
  }, []);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      await connect(url.trim(), username.trim(), password);
      router.replace('/sessions');
    } catch (e) {
      if (e instanceof AuthError) setError('Invalid username or password.');
      else setError('Could not reach the gateway. Is Tailscale connected?');
    } finally {
      setBusy(false);
    }
  }

  if (busy && !error) return <View style={styles.center}><ActivityIndicator /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Gateway URL (tailnet)</Text>
      <TextInput style={styles.input} value={url} onChangeText={setUrl}
        autoCapitalize="none" autoCorrect={false} placeholder="http://100.x.y.z:9119" />
      <Text style={styles.label}>Username</Text>
      <TextInput style={styles.input} value={username} onChangeText={setUsername}
        autoCapitalize="none" autoCorrect={false} />
      <Text style={styles.label}>Password</Text>
      <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={busy ? 'Connecting…' : 'Connect'} onPress={onConnect} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 8, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  error: { color: '#c00' },
});
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit` — Expected: clean. Then `npx expo start` and confirm the Connect screen renders in the simulator.

```bash
git add app/ && git commit -m "feat: connect screen with saved-connection restore"
```

---

### Task 7: Sessions screen

**Files:**
- Create: `app/sessions.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/sessions.tsx
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { SessionSummary } from '../src/api/types';
import { disconnect, getRest } from '../src/connection';

export default function SessionsScreen() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await getRest().listSessions();
      setSessions(res.sessions);
    } catch {
      setError('Could not load sessions. Check your VPN connection.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onDisconnect() {
    await disconnect();
    router.replace('/');
  }

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/chat/${item.id}`)}>
            <Text style={styles.title} numberOfLines={1}>{item.title || item.preview || item.id}</Text>
            <Text style={styles.meta}>{item.message_count} messages · {new Date(item.last_active * 1000).toLocaleString()}</Text>
          </Pressable>
        )}
        ListEmptyComponent={!refreshing ? <Text style={styles.meta}>No sessions yet.</Text> : null}
      />
      <Button title="New chat" onPress={() => router.push('/chat/new')} />
      <Button title="Disconnect" color="#c00" onPress={onDisconnect} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, gap: 8 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { color: '#666', fontSize: 12, marginTop: 2 },
  error: { color: '#c00' },
});
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit` — Expected: clean.

```bash
git add app/sessions.tsx && git commit -m "feat: sessions list with pull-to-refresh"
```

---

### Task 8: Chat screen with streaming

**Files:**
- Create: `app/chat/[id].tsx`

Route param `id`: `"new"` creates a fresh session via `session.create`; otherwise it loads REST history for that stored session id, then creates a live gateway session seeded for continuation. For the walking skeleton, continuing an old session opens it read-only with a "Continue in new chat" affordance kept out of scope — **`new` is the fully-featured path**; existing ids show history + live chat in the same screen by creating a gateway session with `title` set from the old one. (Seeding full history into `session.create messages` is M1-optional; the code below loads history for display and starts a fresh agent session — honest about that in the UI.)

- [ ] **Step 1: Implement**

```tsx
// app/chat/[id].tsx
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Button, FlatList, KeyboardAvoidingView,
  Platform, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { GatewayClient } from '../../src/api/gatewayClient';
import type { SessionCreateResult } from '../../src/api/types';
import { getRest, openGateway } from '../../src/connection';

interface ChatItem {
  key: string;
  role: 'user' | 'assistant' | 'tool' | 'status';
  text: string;
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const gwRef = useRef<GatewayClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<ChatItem>>(null);
  const keyCounter = useRef(0);

  const nextKey = () => `i${keyCounter.current++}`;

  function append(role: ChatItem['role'], text: string) {
    setItems((prev) => [...prev, { key: nextKey(), role, text }]);
  }

  /** Append streamed text to the trailing assistant bubble (create if absent). */
  function appendDelta(text: string) {
    setItems((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { key: nextKey(), role: 'assistant', text }];
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (id !== 'new') {
          const history = await getRest().getMessages(id);
          if (cancelled) return;
          setItems(
            history.messages
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => ({ key: nextKey(), role: m.role as 'user' | 'assistant', text: m.text ?? '' })),
          );
        }
        const gw = await openGateway();
        if (cancelled) { gw.close(); return; }
        gwRef.current = gw;
        gw.onEvent((e) => {
          switch (e.type) {
            case 'message.delta': appendDelta(e.payload?.text ?? ''); break;
            case 'message.complete': setStreaming(false); break;
            case 'tool.start': append('status', `⚙ ${e.payload?.tool_name ?? 'tool'}…`); break;
            case 'status.update': append('status', e.payload?.text ?? ''); break;
            case 'error': setStreaming(false); setError(e.payload?.message ?? 'agent error'); break;
          }
        });
        gw.onClose(() => { setReady(false); setError('Connection lost. Go back and reopen the chat.'); });
        const created = await gw.call<SessionCreateResult>('session.create', {
          title: id === 'new' ? '' : `Continued from ${id.slice(0, 8)}`,
        });
        if (cancelled) return;
        sessionIdRef.current = created.session_id;
        setReady(true);
      } catch {
        if (!cancelled) setError('Could not open a live session. Check your VPN connection.');
      }
    })();
    return () => { cancelled = true; gwRef.current?.close(); };
  }, [id]);

  async function send() {
    const text = input.trim();
    const gw = gwRef.current;
    const sid = sessionIdRef.current;
    if (!text || !gw || !sid || streaming) return;
    setInput('');
    setError(null);
    append('user', text);
    setStreaming(true);
    try {
      await gw.call('prompt.submit', { session_id: sid, text });
    } catch (e) {
      setStreaming(false);
      setError(e instanceof Error ? e.message : 'send failed');
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(i) => i.key}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={[styles.bubble, bubbleStyle[item.role]]}>
            <Text style={item.role === 'status' ? styles.statusText : styles.bubbleText}>{item.text}</Text>
          </View>
        )}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      {!ready && !error && <ActivityIndicator />}
      <View style={styles.inputRow}>
        <TextInput style={styles.input} value={input} onChangeText={setInput}
          placeholder={streaming ? 'Hermes is responding…' : 'Message'}
          editable={ready && !streaming} multiline />
        <Button title="Send" onPress={send} disabled={!ready || streaming || !input.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 8 },
  bubble: { marginVertical: 4, padding: 10, borderRadius: 12, maxWidth: '85%' },
  bubbleText: { fontSize: 15 },
  statusText: { fontSize: 12, color: '#666', fontStyle: 'italic' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, maxHeight: 120 },
  error: { color: '#c00', padding: 4 },
});

const bubbleStyle = StyleSheet.create({
  user: { alignSelf: 'flex-end', backgroundColor: '#d0e8ff' },
  assistant: { alignSelf: 'flex-start', backgroundColor: '#f0f0f0' },
  tool: { alignSelf: 'flex-start', backgroundColor: '#fff7d6' },
  status: { alignSelf: 'center', backgroundColor: 'transparent' },
});
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npx jest` — Expected: clean, all tests pass.

```bash
git add app/chat/ && git commit -m "feat: chat screen with streaming deltas and tool status"
```

---

### Task 9: End-to-end verification over Tailscale

**Files:** none (manual verification; fixes get their own commits)

- [ ] **Step 1: Start the gateway in gated mode** (on the hermes host)

```bash
export HERMES_DASHBOARD_BASIC_AUTH_USERNAME=gianluca
export HERMES_DASHBOARD_BASIC_AUTH_PASSWORD='<strong password>'
hermes web --host $(tailscale ip -4) --port 9119
```
Expected: startup log shows auth required; visiting `http://<tailscale-ip>:9119` from a browser on the tailnet shows the login page.

- [ ] **Step 2: Sanity-check the wire contract with curl** (from the Mac, before involving the app)

```bash
TS_IP=$(tailscale ip -4)
curl -si -X POST "http://$TS_IP:9119/auth/password-login" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"basic","username":"gianluca","password":"<password>"}' | grep -i '^set-cookie\|^HTTP'
```
Expected: `HTTP/1.1 200`, `Set-Cookie: hermes_session_at=...` (bare name — plain HTTP). Note the exact cookie names; if they differ from `hermes_session_*`, stop and reconcile `CookieJar` expectations.

- [ ] **Step 3: Run the app on a real device** (Expo Go or dev client; device on the same tailnet via Tailscale iOS app)

```bash
cd ~/hermes-mobile-app && npx expo start
```
Walk through: Connect screen → enter `http://<tailscale-ip>:9119` + credentials → Sessions list loads → New chat → send "What is 2+2?" → watch tokens stream in → `message.complete` re-enables input.

- [ ] **Step 4: Verify the failure modes**
  - Toggle Tailscale off on the phone → pull-to-refresh shows the VPN error, no crash.
  - Toggle it back on → refresh recovers.
  - Force-quit and reopen the app → auto-restores via SecureStore, lands on Sessions.
  - Enter a wrong password from a fresh install → "Invalid username or password."

- [ ] **Step 5: Record findings and commit fixes**

Document in `docs/plans/m1-verification-notes.md`: actual cookie names observed, whether RN exposed `set-cookie` (or the `@react-native-cookies` fallback was needed), whether the WS Origin check needed the `extraHeaders` escape hatch. Commit any fixes individually:

```bash
git add -A && git commit -m "fix: <specific finding from device verification>"
```

---

## Out of scope for M1 (deliberately)

- QR pairing, device tokens, push, mailbox (M2/M3 — plugin repo).
- Seeding full history into continued sessions; voice; profile switching; markdown rendering.
- HTTPS inside the tailnet (WireGuard already encrypts; revisit in M2 with Tailscale certs).

## Done criteria

All unit tests green, `tsc` clean, and the Task 9 walkthrough completed on a physical iPhone over Tailscale against an unmodified hermes-agent.
