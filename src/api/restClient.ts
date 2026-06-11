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
