import { render, screen } from '@testing-library/react-native';
import { MessageRow } from '../src/components/message-row';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));
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

  test.each([
    [undefined, 'Tool terminal, finished'],
    ['ok', 'Tool terminal, finished'],
    ['failed', 'Tool terminal, failed'],
    ['denied', 'Tool terminal, denied'],
    ['interrupted', 'Tool terminal, interrupted'],
  ] as const)('outcome %s → "%s"', async (outcome, label) => {
    await render(<MessageRow item={tool(outcome)} />);
    expect(screen.getByLabelText(label)).toBeOnTheScreen();
  });

  test('a running tool still says running', async () => {
    await render(<MessageRow item={{ ...tool(), tool: { id: 't1', name: 'terminal', running: true } }} />);
    expect(screen.getByLabelText('Tool terminal, running')).toBeOnTheScreen();
  });
});
