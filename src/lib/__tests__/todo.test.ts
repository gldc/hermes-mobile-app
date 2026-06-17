// src/lib/__tests__/todo.test.ts
import { parseTodoList } from '../todo';

test('returns null when there is no todos array', () => {
  expect(parseTodoList({})).toBeNull();
  expect(parseTodoList({ todos: 'nope' as unknown })).toBeNull();
  expect(parseTodoList(undefined)).toBeNull();
});

test('parses items and preserves order', () => {
  const out = parseTodoList({
    todos: [
      { id: '1', content: 'first', status: 'completed' },
      { id: '2', content: 'second', status: 'in_progress' },
    ],
  });
  expect(out).toEqual([
    { id: '1', content: 'first', status: 'completed' },
    { id: '2', content: 'second', status: 'in_progress' },
  ]);
});

test('coerces unknown/missing status to pending', () => {
  const out = parseTodoList({ todos: [{ id: '1', content: 'x', status: 'bogus' }, { id: '2', content: 'y' }] });
  expect(out!.map((t) => t.status)).toEqual(['pending', 'pending']);
});

test('drops malformed entries (no string content)', () => {
  const out = parseTodoList({ todos: [{ id: '1' }, null, 5, { id: '2', content: 'ok', status: 'pending' }] });
  expect(out).toEqual([{ id: '2', content: 'ok', status: 'pending' }]);
});

test('empty array returns empty list, not null', () => {
  expect(parseTodoList({ todos: [] })).toEqual([]);
});

test('synthesizes an id for an entry missing one', () => {
  expect(parseTodoList({ todos: [{ content: 'no id here' }] })).toEqual([
    { id: '0', content: 'no id here', status: 'pending' },
  ]);
});
