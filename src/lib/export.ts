// src/lib/export.ts — pure formatters for sharing the current conversation.
// Operates on the chat screen's in-memory ChatItem list (live + history items
// look identical there), so no extra wire contract is involved.
import type { ChatItem } from '@/components/message-row';

/** One transcript line per item; null = item is not part of a readable export. */
function textLine(item: ChatItem): string | null {
  switch (item.role) {
    case 'user':
      return item.text.trim() ? `You: ${item.text}` : null;
    case 'assistant':
      return item.text.trim() ? `Hermes: ${item.text}` : null;
    case 'tool': {
      const name = item.tool?.name ?? item.text ?? 'tool';
      const summary = item.tool?.summary ?? item.tool?.context;
      return `[tool] ${name}${summary ? ` — ${summary}` : ''}`;
    }
    case 'status':
      return item.text.trim() ? `[status] ${item.text}` : null;
    case 'approval': {
      const status = item.approval?.status;
      const suffix = status && status !== 'pending' && status !== 'answering' ? ` (${status})` : '';
      return `[approval${suffix}] ${item.text}`;
    }
    default:
      return null;
  }
}

/** Readable plain-text transcript: "You:" / "Hermes:" turns plus tool/status lines. */
export function exportAsText(items: ChatItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    const line = textLine(item);
    if (line !== null) lines.push(line);
  }
  return lines.join('\n\n');
}

/** JSONL record for one item: stable data fields only, no local render keys. */
function toRecord(item: ChatItem): Record<string, unknown> {
  const record: Record<string, unknown> = { role: item.role, text: item.text };
  if (item.reasoning) record.reasoning = item.reasoning;
  if (item.tool) {
    const { name, context, summary, detail, diff, durationS } = item.tool;
    record.tool = {
      name,
      ...(context !== undefined ? { context } : {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...(diff !== undefined ? { diff } : {}),
      ...(durationS !== undefined ? { duration_s: durationS } : {}),
    };
  }
  if (item.approval) {
    record.approval = {
      command: item.approval.request.command,
      description: item.approval.request.description,
      status: item.approval.status,
    };
  }
  return record;
}

/** Machine-readable export: one JSON object per chat item, newline-delimited. */
export function exportAsJsonl(items: ChatItem[]): string {
  return items.map((item) => JSON.stringify(toRecord(item))).join('\n');
}
