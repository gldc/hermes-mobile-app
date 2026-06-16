// src/api/restClient.ts
import { SESSION_CLAIM_ROUTE } from '@/lib/push';
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
