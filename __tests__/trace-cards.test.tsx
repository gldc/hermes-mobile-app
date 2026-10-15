import { fireEvent, render, screen } from '@testing-library/react-native';
import { SubagentMonitorCard } from '../src/components/subagent-monitor-card';
import { TodoCard } from '../src/components/todo-card';
import type { SubagentBatch, SubagentState } from '../src/lib/subagent-progress';
import type { TodoItem } from '../src/lib/todo';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));

function sub(over: Partial<SubagentState> & Pick<SubagentState, 'key' | 'goal' | 'status'>): SubagentState {
  return { taskIndex: 0, taskCount: 1, activity: '', log: [], toolCount: 0, startedAtMs: Date.now(), ...over };
}

describe('SubagentMonitorCard', () => {
  const running: SubagentBatch = {
    finalized: false,
    subagents: [
      sub({ key: 'a', goal: 'Audit auth', status: 'running', activity: 'read_file auth.ts', toolCount: 2, log: ['search_files', 'read_file auth.ts'] }),
      sub({ key: 'b', goal: 'Plan migration', status: 'completed', durationSeconds: 41, summary: 'Three steps.' }),
    ],
  };
  const done: SubagentBatch = {
    finalized: true,
    subagents: [
      sub({ key: 'a', goal: 'Run e2e', status: 'failed', durationSeconds: 95, costUsd: 0.04 }),
      sub({ key: 'b', goal: 'Refresh fixtures', status: 'stopped', durationSeconds: 12, costUsd: 0.01 }),
    ],
  };

  test('opens while subagents run, showing each with its current step', async () => {
    await render(<SubagentMonitorCard batch={running} />);
    expect(screen.getByRole('button', { name: 'Subagents, 1 running, tap to collapse' })).toBeExpanded();
    expect(screen.getByText('Audit auth')).toBeOnTheScreen();
    expect(screen.getByText('read_file auth.ts · 2 tools')).toBeOnTheScreen();
    expect(screen.getByText('Three steps.')).toBeOnTheScreen();
  });

  test("the reader's tap wins over the running default", async () => {
    await render(<SubagentMonitorCard batch={running} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Subagents, 1 running, tap to collapse' }));
    expect(screen.queryByText('Audit auth')).toBeNull();
  });

  test('a finished batch closes to its count and cost, and opens on tap', async () => {
    const { rerender } = await render(<SubagentMonitorCard batch={running} />);
    await rerender(<SubagentMonitorCard batch={done} />);
    const header = screen.getByRole('button', { name: 'Subagents, 2 done, tap to expand' });
    expect(header).toBeCollapsed();
    expect(screen.getByText('2 done · ~$0.05')).toBeOnTheScreen();
    await fireEvent.press(header);
    expect(screen.getByLabelText('Subagent Run e2e, failed')).toBeOnTheScreen();
    expect(screen.getByLabelText('Subagent Refresh fixtures, stopped')).toBeOnTheScreen();
  });

  test('a subagent line swaps its one-line step for the full log when opened', async () => {
    await render(<SubagentMonitorCard batch={running} />);
    const line = screen.getByRole('button', { name: 'Subagent Audit auth, running, read_file auth.ts, tap to expand' });
    expect(screen.queryByText('search_files')).toBeNull();
    await fireEvent.press(line);
    expect(screen.getByText('search_files')).toBeOnTheScreen();
    expect(screen.queryByText('read_file auth.ts · 2 tools')).toBeNull();
  });
});

describe('TodoCard', () => {
  const items: TodoItem[] = [
    { id: '1', content: 'Read the row', status: 'completed' },
    { id: '2', content: 'Port Trace', status: 'in_progress' },
    { id: '3', content: 'Migrate steps', status: 'pending' },
    { id: '4', content: 'Shimmer', status: 'cancelled' },
  ];

  test('starts open with a line per step that says its status', async () => {
    await render(<TodoCard items={items} />);
    expect(screen.getByRole('button', { name: 'Plan, 1 of 4 done, tap to collapse' })).toBeExpanded();
    expect(screen.getByText('1/4')).toBeOnTheScreen();
    expect(screen.getByLabelText('Read the row, done')).toBeOnTheScreen();
    expect(screen.getByLabelText('Port Trace, in progress')).toBeOnTheScreen();
    expect(screen.getByLabelText('Migrate steps, not started')).toHaveStyle({ opacity: 0.6 });
    expect(screen.getByText('Shimmer')).toHaveStyle({ textDecorationLine: 'line-through' });
  });

  test('collapses to the Plan line, and stays collapsed when the list updates', async () => {
    const { rerender } = await render(<TodoCard items={items} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(screen.queryByText('Port Trace')).toBeNull();
    await rerender(<TodoCard items={items.map((t) => (t.id === '2' ? { ...t, status: 'completed' } : t))} />);
    expect(screen.getByText('2/4')).toBeOnTheScreen();
    expect(screen.queryByText('Port Trace')).toBeNull();
  });
});
