// src/lib/links.ts
//
// Tappable URLs in the transcript. Agent output is untrusted, so only web and mail links open,
// and they open in the system's default browser (Linking), never an in-app view.
import { Linking } from 'react-native';
import { MarkdownIt } from 'react-native-markdown-display';

/** The markdown parser the transcript renders with: the library default plus linkify. Fuzzy
 * matching is off so file names with a TLD-like extension (README.md, setup.py) stay text, which
 * means a link needs its scheme: `www.foo.org` alone is not linked. */
export const markdownParser = MarkdownIt({ typographer: true, linkify: true });
markdownParser.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });

const OPENABLE = /^(https?:\/\/|mailto:)/i;

/** True for links the app hands to the system: http(s) and mailto. Everything else — this app's
 * own scheme, javascript:, tel:, file: — is refused. */
export function isOpenableUrl(url: string): boolean {
  return OPENABLE.test(url);
}

/** Opens an allowed URL in the default browser (mail app for mailto). Never throws. */
export function openExternal(url: string): void {
  if (!isOpenableUrl(url)) return;
  Linking.openURL(url).catch(() => {});
}

export type LinkSegment = { text: string; url?: string };

/** Splits plain text into runs of text and URLs, with the same rules as the markdown parser. */
export function linkSegments(text: string): LinkSegment[] {
  const matches = markdownParser.linkify.match(text) ?? [];
  const out: LinkSegment[] = [];
  let at = 0;
  for (const m of matches) {
    if (!isOpenableUrl(m.url)) continue;
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m.raw, url: m.url });
    at = m.lastIndex;
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at) });
  return out;
}
