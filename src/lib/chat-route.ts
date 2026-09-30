// src/lib/chat-route.ts — which chat the root surface is showing, for the sidebar's
// "already there?" checks.
//
// A new chat mints its session lazily on the first message and keeps the /chat/new URL (its
// transport is keyed on the route id, so rewriting the URL would tear the live socket down
// mid-turn). The URL alone therefore can't tell an empty draft from a started chat; the screen
// publishes the session it minted (draft-chat-store) and this resolves the two together.

/** The session on screen: the route id, the minted session of a started /chat/new, 'new' for an
 *  unstarted draft, or null off the chat surface. */
export function chatOnScreen(pathname: string, startedDraft: string | null): string | null {
  const m = /^\/chat\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  return m[1] === 'new' ? (startedDraft ?? 'new') : m[1];
}
