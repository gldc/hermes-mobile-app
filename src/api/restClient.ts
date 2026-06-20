// src/api/restClient.ts
import { SESSION_CLAIM_ROUTE } from '@/lib/push';
import { CookieJar } from './cookieJar';
import type { MessagesResponse, SessionListResponse, WsTicketResponse } from './types';

export class AuthError extends Error {}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type FetchFn = typeof fetch;

/** Serialize requests once the access token has less than this much life left
 * (or its expiry is unknown). That is the only window in which a request falls
 * back to the rotating refresh token, so it is the only window in which two
 * concurrent requests could replay the same RT. The margin absorbs clock skew
 * and in-flight time; the server-side reuse grace window backstops any residue. */
export const AT_FRESH_MARGIN_MS = 60_000;

/** Hard upper bound per request. The audited REST surface is all small JSON on
 * a private network — nothing legitimately approaches this — so it only ever
 * fires on a genuine hang, turning a silent freeze into an explicit failure and
 * freeing the serialization chain. */
export const REQUEST_TIMEOUT_MS = 20_000;

export class RestClient {
  constructor(
    public readonly baseUrl: string,           // e.g. http://100.1.2.3:9119 (no trailing slash)
    private readonly jar: CookieJar,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  // Serializes authed requests. Refresh tokens rotate single-use server-side:
  // two concurrent requests would both snapshot the same RT from the jar and
  // send it, and the gateway treats the second (rotated-out) RT as reuse —
  // revoking the device. Chaining each request after the previous one means a
  // request always sends the freshly-rotated cookie the prior response
  // ingested. The cost on a private network is one extra RTT per multi-call
  // screen; streaming rides the WebSocket, not this path.
  private chain: Promise<unknown> = Promise.resolve();

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    // Access token fresh → the server validates it without rotating, so
    // requests are safe to run concurrently and a hung request cannot wedge the
    // rest of the REST layer. Stale/unknown → fall back to the chain so only one
    // request at a time can trigger (and thus race) a refresh-token rotation.
    if (this.jar.accessTokenFresh(AT_FRESH_MARGIN_MS)) {
      return this.send<T>(path, init);
    }
    const run = this.chain.then(() => this.send<T>(path, init));
    // Keep the chain alive across failures — a rejected request must not wedge
    // later ones — while still propagating the real result to the caller.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async send<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };
    const cookie = this.jar.header();
    if (cookie) headers['Cookie'] = cookie;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        credentials: 'omit', // we manage cookies ourselves
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') {
        throw new HttpError(0, `request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.jar.ingest([setCookie]);
    if (res.status === 401) throw new AuthError('session expired or invalid credentials');
    if (res.status === 429) throw new HttpError(429, 'rate limited — wait a minute');
    if (!res.ok) {
      // FastAPI errors carry {"detail": "..."} — surface it (e.g. cron
      // schedule-parse 400s) instead of a bare status code.
      let message = `HTTP ${res.status} on ${path}`;
      try {
        const body = (await res.json()) as { detail?: unknown };
        if (typeof body?.detail === 'string' && body.detail) message = body.detail;
      } catch {
        // non-JSON error body — keep the generic message
      }
      throw new HttpError(res.status, message);
    }
    return (await res.json()) as T;
  }

  /** Generic authed verbs — feature modules (cron, memory, …) build on these
   * instead of growing this class. */
  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
  }

  del<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
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

  listSessions(offset = 0, archived: 'exclude' | 'only' = 'exclude'): Promise<SessionListResponse> {
    const arch = archived === 'only' ? '&archived=only' : '';
    return this.request<SessionListResponse>(`/api/sessions?limit=40&offset=${offset}&order=recent${arch}`);
  }

  /** Bind this device to a session so session-stop push hooks can target it.
   * Best-effort: callers fire-and-forget after session.create/resume. */
  async claimSession(sessionId: string, sessionKey: string): Promise<void> {
    await this.post(SESSION_CLAIM_ROUTE, {
      session_id: sessionId,
      session_key: sessionKey,
    });
  }

  getMessages(sessionId: string, profile?: string): Promise<MessagesResponse> {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : '';
    return this.request<MessagesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messages${q}`);
  }

  /** ws:// or wss:// URL for the gateway socket. */
  wsUrl(ticket: string): string {
    return `${this.baseUrl.replace(/^http/, 'ws')}/api/ws?ticket=${encodeURIComponent(ticket)}`;
  }
}
