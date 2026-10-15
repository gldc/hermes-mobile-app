import { memo } from 'react';
import { Text } from 'react-native';
import Markdown, { type RenderRules } from 'react-native-markdown-display';
import { isOpenableUrl, markdownParserFor, openExternal } from '@/lib/links';
import type { ThemeColors } from '@/theme';
import { useTheme } from '@/theme';

function buildStyles(c: ThemeColors, muted: boolean) {
  // Muted (reasoning inside a Trace): headings and code step down with the body, never louder.
  const ink = muted ? c.textDim : c.text;
  const code = {
    backgroundColor: c.raised,
    color: ink,
    fontFamily: 'Menlo',
    fontSize: muted ? 12.5 : 14,
    borderWidth: 0,
  };
  return {
    body: muted ? { color: c.textDim, fontSize: 14, lineHeight: 22 } : { color: c.text, fontSize: 17, lineHeight: 27 },
    paragraph: { marginTop: 0, marginBottom: 10 },
    heading1: muted
      ? { color: ink, fontSize: 16, lineHeight: 22, fontWeight: '700', marginTop: 8, marginBottom: 4 }
      : { color: ink, fontSize: 24, lineHeight: 32, fontWeight: '700', marginTop: 14, marginBottom: 6 },
    heading2: muted
      ? { color: ink, fontSize: 15, lineHeight: 22, fontWeight: '700', marginTop: 8, marginBottom: 4 }
      : { color: ink, fontSize: 20, lineHeight: 28, fontWeight: '700', marginTop: 12, marginBottom: 6 },
    heading3: muted
      ? { color: ink, fontSize: 14, lineHeight: 22, fontWeight: '600', marginTop: 6, marginBottom: 2 }
      : { color: ink, fontSize: 17, lineHeight: 24, fontWeight: '600', marginTop: 10, marginBottom: 4 },
    strong: { fontWeight: '600' },
    link: { color: c.accent, textDecorationLine: 'none' },
    blockquote: {
      backgroundColor: 'transparent',
      borderLeftWidth: 3,
      borderLeftColor: c.accent,
      paddingLeft: 12,
      marginLeft: 0,
      opacity: 0.9,
    },
    code_inline: { ...code, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
    fence: { ...code, padding: 12, borderRadius: 12, marginBottom: 10 },
    code_block: { ...code, padding: 12, borderRadius: 12, marginBottom: 10 },
    bullet_list: { marginBottom: 10 },
    ordered_list: { marginBottom: 10 },
    list_item: { marginBottom: 4 },
    bullet_list_icon: { color: c.textDim },
    ordered_list_icon: { color: c.textDim },
    hr: { backgroundColor: c.border, height: 1, marginVertical: 12 },
    table: { borderColor: c.border, borderRadius: 8 },
    th: { padding: 8 },
    td: { padding: 8, borderColor: c.border },
  } as const;
}

/** Links (written or bare URLs) open in the default browser, and only for http(s)/mailto; a
 * link to anything else renders as plain text rather than a link that does nothing. */
const rules: RenderRules = {
  link: (node, children, _parent, styles) => {
    const href = String(node.attributes.href ?? '');
    if (!isOpenableUrl(href)) return <Text key={node.key}>{children}</Text>;
    return (
      <Text key={node.key} accessibilityRole="link" style={styles.link} onPress={() => openExternal(href)}>
        {children}
      </Text>
    );
  },
};

/** Image and block links go through the library's handler: open allowed URLs ourselves, never its default. */
function onLinkPress(url: string): boolean {
  openExternal(url);
  return false;
}

/** Themed markdown for completed assistant messages. Memoized — re-renders only when text changes.
 * `muted`: smaller, dimmer body text for detail inside a Trace (reasoning). */
export const MarkdownView = memo(function MarkdownView({ text, muted = false }: { text: string; muted?: boolean }) {
  const { colors } = useTheme();
  return (
    <Markdown style={buildStyles(colors, muted) as any} markdownit={markdownParserFor(text)} rules={rules} onLinkPress={onLinkPress}>
      {text}
    </Markdown>
  );
});
