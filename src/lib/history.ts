// src/lib/history.ts — map raw session-DB message rows to renderable ChatItems.
// Contract: docs/contracts/sessions-extra.md → raw /messages row schema.
import type { SessionMessage } from '@/api/types';
import type { ChatItem, ToolInfo } from '@/components/message-row';
import { messageText, reasoningText } from './message-text';
import { toolContextFromArgs } from './tool-context';

/** Same cap the live tool.complete path applies to result text. */
const MAX_TOOL_DETAIL = 4000;

export function historyToItems(messages: SessionMessage[], nextKey: () => string): ChatItem[] {
  // Pass 1: index tool-call invocations from assistant rows by id ?? call_id.
  // The invocation lives on the assistant row; its result is a later tool row.
  const invocations = new Map<string, { name?: string; args: unknown }>();
  for (const m of messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    for (const tc of m.tool_calls) {
      const id = tc?.id ?? tc?.call_id;
      if (!id) continue;
      let args: unknown;
      const raw = tc?.function?.arguments;
      if (typeof raw === 'string') {
        try { args = JSON.parse(raw); } catch { args = undefined; }
      }
      invocations.set(id, { name: tc?.function?.name, args });
    }
  }

  // Pass 2: emit items at their natural (result-row) positions.
  const items: ChatItem[] = [];
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      const text = messageText(m);
      const reasoning = m.role === 'assistant' ? reasoningText(m).slice(0, MAX_TOOL_DETAIL) : '';
      if (!text.trim() && !reasoning.trim()) continue; // drop only if nothing to show
      items.push({
        key: nextKey(),
        role: m.role,
        text,
        complete: true,
        ...(reasoning.trim() ? { reasoning } : {}),
      });
    } else if (m.role === 'tool') {
      const name = m.tool_name?.trim();
      const detail = messageText(m).trim().slice(0, MAX_TOOL_DETAIL);
      if (!name && !detail) continue; // drop empty rows
      const key = nextKey();
      const inv = m.tool_call_id ? invocations.get(m.tool_call_id) : undefined;
      const context = inv ? toolContextFromArgs(inv.name ?? name ?? 'tool', inv.args) : undefined;
      const tool: ToolInfo = {
        id: m.tool_call_id || key,
        name: name || inv?.name || 'tool',
        running: false,
        ...(context ? { context } : {}),
        ...(detail ? { detail } : {}),
      };
      items.push({ key, role: 'tool', text: tool.name, tool });
    }
  }
  return items;
}
