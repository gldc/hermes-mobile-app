// src/api/search.ts — full-text session search (FTS5 on the dashboard).
// Contract: docs/contracts/sessions-extra.md → GET /api/sessions/search
import type { RestClient } from './restClient';

export interface SearchResult {
  /** Matched excerpt; matches are wrapped in <b>…</b> by the server. */
  snippet: string;
  /** null for direct session-id matches. */
  role: 'user' | 'assistant' | 'tool' | null;
  source?: string | null;
  model?: string | null;
  session_started?: number | null;
  /** Lineage TIP — open this id, not the raw hit. */
  session_id: string;
  lineage_root?: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
}

/**
 * Full-text search across sessions. Blank queries short-circuit client-side
 * (the server returns `{results: []}` for them anyway). `limit` is clamped
 * to the server's accepted 1..100 range.
 */
export async function searchSessions(
  client: Pick<RestClient, 'get'>,
  q: string,
  limit = 20,
): Promise<SearchResponse> {
  const query = q.trim();
  if (!query) return { results: [] };
  const lim = Math.min(100, Math.max(1, Math.floor(limit)));
  return client.get<SearchResponse>(
    `/api/sessions/search?q=${encodeURIComponent(query)}&limit=${lim}`,
  );
}

export interface SnippetSegment {
  text: string;
  /** True when this run was inside <b>…</b> (an FTS match). */
  match: boolean;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m] ?? m);
}

/** Split a server snippet into plain / matched runs for styled rendering. */
export function parseSnippet(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  const tokens = snippet.split(/(<\/?b>)/);
  let inMatch = false;
  for (const tok of tokens) {
    if (tok === '<b>') {
      inMatch = true;
      continue;
    }
    if (tok === '</b>') {
      inMatch = false;
      continue;
    }
    if (!tok) continue;
    const text = decodeEntities(tok);
    const last = segments[segments.length - 1];
    if (last && last.match === inMatch) last.text += text;
    else segments.push({ text, match: inMatch });
  }
  return segments;
}
