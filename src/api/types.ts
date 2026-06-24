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
  /** Set by the server when a session is a compression continuation.
   *  Points to the original root session id. Absent on non-compressed sessions. */
  _lineage_root_id?: string;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

/** One entry of an assistant row's `tool_calls[]` invocation array
 * (docs/contracts/sessions-extra.md:146-156). `function.arguments` is a JSON string. */
export interface ToolCall {
  id?: string;
  call_id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
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
  /** Set on role='tool' rows; joins to assistant tool_calls[i].id. */
  tool_call_id?: string | null;
  /** Set on role='assistant' rows; the tool invocations whose results arrive as
   * later role='tool' rows. Parsed server-side; defensively re-checked here. */
  tool_calls?: ToolCall[] | null;
  /** Reasoning/thinking trace persisted on assistant rows. Which column is
   * populated varies by model family (docs/contracts/sessions-extra.md:130). */
  reasoning?: string | null;
  reasoning_content?: string | null;
  reasoning_details?: string | null;
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
  /** Present on a built (non-lazy) resume; carries the session's own model. */
  info?: { model?: string; profile_name?: string; lazy?: boolean };
}

export type GatewayEventType =
  | 'gateway.ready'
  | 'message.start'
  | 'message.delta'
  | 'message.complete'
  | 'tool.start'
  | 'tool.complete'
  | 'status.update'
  | 'subagent.spawn_requested'
  | 'subagent.start'
  | 'subagent.thinking'
  | 'subagent.tool'
  | 'subagent.progress'
  | 'subagent.complete'
  | 'session.info'
  | 'error'
  | (string & {}); // forward-compatible

export interface GatewayEvent {
  type: GatewayEventType;
  session_id?: string;
  payload?: any;
}
