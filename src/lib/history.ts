// src/lib/history.ts — map raw session-DB message rows to renderable ChatItems.
// Contract: docs/contracts/sessions-extra.md → raw /messages row schema.
import type { SessionMessage } from '@/api/types';
import type { ChatItem, ToolInfo } from '@/components/message-row';
import { messageText } from './message-text';

/** Same cap the live tool.complete path applies to result text. */
const MAX_TOOL_DETAIL = 4000;

/**
 * Convert history rows into chat items:
 * - user/assistant rows → text items (empty ones dropped — e.g. assistant
 *   rows that carry only tool_calls);
 * - role='tool' rows → completed ToolInfo cards (name from tool_name,
 *   detail from content); rows with neither name nor content are dropped;
 * - system rows are not rendered.
 */
export function historyToItems(messages: SessionMessage[], nextKey: () => string): ChatItem[] {
  const items: ChatItem[] = [];
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      const text = messageText(m);
      if (!text.trim()) continue; // drop empty rows
      items.push({ key: nextKey(), role: m.role, text, complete: true });
    } else if (m.role === 'tool') {
      const name = m.tool_name?.trim();
      const detail = messageText(m).trim().slice(0, MAX_TOOL_DETAIL);
      if (!name && !detail) continue; // drop empty rows
      const key = nextKey();
      const tool: ToolInfo = {
        id: m.tool_call_id || key,
        name: name || 'tool',
        running: false,
        ...(detail ? { detail } : {}),
      };
      items.push({ key, role: 'tool', text: tool.name, tool });
    }
  }
  return items;
}
