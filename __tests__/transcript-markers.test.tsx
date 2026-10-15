import { fireEvent, render, screen } from '@testing-library/react-native';
import { MessageRow } from '../src/components/message-row';
import { useTheme, type ThemeColors } from '../src/theme';

const mockIcon = jest.fn((_props: { sf: string; color?: string }) => null);
jest.mock('../src/components/icon', () => ({ Icon: (props: { sf: string; color?: string }) => mockIcon(props) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: 'light' } }));

test('a steered user message shows a "Steered" caption and says so to VoiceOver', async () => {
  await render(<MessageRow item={{ key: 'i1', role: 'user', text: 'use tabs', complete: true, steered: true }} />);
  expect(screen.getByText('Steered')).toBeOnTheScreen();
  expect(screen.getByLabelText('You steered: use tabs')).toBeOnTheScreen();
});

test('a plain user message has no Steered caption', async () => {
  await render(<MessageRow item={{ key: 'i1', role: 'user', text: 'hi', complete: true }} />);
  expect(screen.queryByText('Steered')).toBeNull();
});

test('the stopped marker renders as "Stopped" with an accessible label', async () => {
  await render(<MessageRow item={{ key: 'i2', role: 'status', text: 'Stopped', marker: 'stopped' }} />);
  expect(screen.getByLabelText('Response stopped')).toBeOnTheScreen();
  expect(screen.getByText('Stopped')).toBeOnTheScreen();
});

describe('tool row outcome', () => {
  const tool = (outcome?: 'ok' | 'failed' | 'denied' | 'interrupted') => ({
    key: 't1', role: 'tool' as const, text: 'terminal',
    tool: { id: 't1', name: 'terminal', running: false, ...(outcome ? { outcome } : {}) },
  });

  /** The theme the row renders with (the test scheme), read through the same hook. */
  async function themeColors(): Promise<ThemeColors> {
    let colors: ThemeColors | null = null;
    function Probe() {
      colors = useTheme().colors;
      return null;
    }
    await render(<Probe />);
    return colors!;
  }

  // A Trace line keeps the tool glyph when the tool ended fine and swaps in a mark only for what went
  // wrong; a failure turns the whole line red.
  test.each([
    [undefined, 'Tool terminal, finished', 'hammer.fill', 'textDim'],
    ['ok', 'Tool terminal, finished', 'hammer.fill', 'textDim'],
    ['failed', 'Tool terminal, failed', 'xmark.circle.fill', 'danger'],
    ['denied', 'Tool terminal, denied', 'hand.raised.fill', 'textDim'],
    ['interrupted', 'Tool terminal, interrupted', 'stop.circle.fill', 'textDim'],
  ] as const)('outcome %s → "%s", %s in %s', async (outcome, label, sf, token) => {
    const colors = await themeColors();
    mockIcon.mockClear();
    await render(<MessageRow item={tool(outcome)} />);
    expect(screen.getByLabelText(label)).toBeOnTheScreen();
    const marks = mockIcon.mock.calls.map(([p]) => p);
    expect(marks).toEqual([expect.objectContaining({ sf, color: colors[token] })]);
  });

  test('a finished row with a summary reads it out after the outcome', async () => {
    const item = tool('denied');
    const summary = 'No answer within 60s — the command did not run.';
    await render(<MessageRow item={{ ...item, tool: { ...item.tool, summary } }} />);
    expect(screen.getByLabelText(`Tool terminal, denied, ${summary}`)).toBeOnTheScreen();
  });

  test("a summary's closing period does not run into the details hint", async () => {
    const item = tool('denied');
    const summary = 'You denied this command — it did not run.';
    await render(<MessageRow item={{ ...item, tool: { ...item.tool, summary, detail: 'BLOCKED' } }} />);
    expect(
      screen.getByLabelText('Tool terminal, denied, You denied this command — it did not run, tap for details'),
    ).toBeOnTheScreen();
  });

  test('a running tool still says running', async () => {
    await render(<MessageRow item={{ ...tool(), tool: { id: 't1', name: 'terminal', running: true } }} />);
    expect(screen.getByLabelText('Tool terminal, running')).toBeOnTheScreen();
  });

  test('the summary shows under the line, and the duration after the title', async () => {
    const item = tool('denied');
    const summary = 'You denied this command — it did not run.';
    await render(<MessageRow item={{ ...item, tool: { ...item.tool, summary, durationS: 1.24 } }} />);
    expect(screen.getByText(summary)).toBeOnTheScreen();
    expect(screen.getByText('1.2s')).toBeOnTheScreen();
  });

  test('a running tool shows no summary or duration yet', async () => {
    await render(
      <MessageRow item={{ ...tool(), tool: { id: 't1', name: 'terminal', running: true, summary: 'early', durationS: 3 } }} />,
    );
    expect(screen.queryByText('early')).toBeNull();
    expect(screen.queryByText('3.0s')).toBeNull();
  });

  test('a tool with detail is a button that expands into it', async () => {
    const item = tool();
    await render(<MessageRow item={{ ...item, tool: { ...item.tool, detail: 'total 0' } }} />);
    const trigger = screen.getByRole('button', { name: 'Tool terminal, finished, tap for details' });
    expect(trigger).toBeCollapsed();
    expect(screen.queryByText('total 0')).toBeNull();
    await fireEvent.press(trigger);
    expect(trigger).toBeExpanded();
    expect(screen.getByText('total 0')).toBeOnTheScreen();
  });

  test('a diff wins over the result text', async () => {
    const item = tool();
    await render(<MessageRow item={{ ...item, tool: { ...item.tool, detail: 'ok', diff: '+ added' } }} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(screen.getByText('+ added')).toBeOnTheScreen();
    expect(screen.queryByText('ok')).toBeNull();
  });
});

describe('reasoning', () => {
  test('starts closed and expands into the reasoning text', async () => {
    await render(<MessageRow item={{ key: 'a1', role: 'assistant', text: 'Answer', complete: true, reasoning: 'Because tabs.' }} />);
    expect(screen.queryByText('Because tabs.')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Reasoning, tap to expand'));
    expect(screen.getByText('Because tabs.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Reasoning, tap to collapse')).toBeExpanded();
  });
});
