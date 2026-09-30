// src/lib/sidebar-search.ts
//
// The sidebar's server full-text search state, derived at render time from the
// live query and the last answer the server gave (tagged with the query it
// answers), so no setter has to run synchronously when the query changes.
import type { SearchResult } from '@/api/search';

/** The last server answer. `results: null` = the request for `q` failed. */
export interface SearchHits {
  q: string;
  results: SearchResult[] | null;
}

/**
 * `pending`: a server answer for the live query is still outstanding (the list
 * shows the client-side filter meanwhile). `results`: server hits to render, or
 * null to fall back to the client-side filter.
 */
export function searchView(
  query: string,
  hits: SearchHits | null,
  serverSearchOk: boolean,
): { pending: boolean; results: SearchResult[] | null } {
  const q = query.trim();
  if (!q || !serverSearchOk) return { pending: false, results: null };
  if (!hits || hits.q !== q) return { pending: true, results: null };
  return { pending: false, results: hits.results };
}
