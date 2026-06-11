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
  /** Some endpoints provide plain text… */
  text?: string | null;
  /** …but session-DB rows store `content`: a string or decoded structure
   * (e.g. parts array). Use messageText() to extract display text. */
  content?: unknown;
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

/** session.resume reuses a live session or rebuilds it from stored state. */
export interface SessionResumeResult {
  session_id: string;
  resumed?: string;
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
