/** Extract display text from a history message. The dashboard returns raw
 * session-DB rows whose `content` is a plain string or a decoded structure
 * (e.g. OpenAI-style parts: [{type:'text', text:'…'}, …]); there is no
 * `text` column, but tolerate one in case other endpoints provide it. */
export function messageText(m: { text?: string | null; content?: unknown }): string {
  if (typeof m.text === 'string' && m.text) return m.text;
  const c = m.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as any).text === 'string') {
          return (part as any).text;
        }
        return '';
      })
      .join('');
  }
  return '';
}
