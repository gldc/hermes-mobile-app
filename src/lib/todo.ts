// src/lib/todo.ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

const VALID = new Set<TodoStatus>(['pending', 'in_progress', 'completed', 'cancelled']);

/** Read the full todo list from a `todo` tool.complete payload (gateway already
 * applied replace/merge). Returns null when there is no todos array. */
export function parseTodoList(payload: { todos?: unknown } | null | undefined): TodoItem[] | null {
  const todos = payload?.todos;
  if (!Array.isArray(todos)) return null;
  const out: TodoItem[] = [];
  for (const raw of todos) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.content !== 'string') continue;
    const status =
      typeof r.status === 'string' && VALID.has(r.status as TodoStatus)
        ? (r.status as TodoStatus)
        : 'pending';
    out.push({ id: typeof r.id === 'string' ? r.id : String(out.length), content: r.content, status });
  }
  return out;
}
