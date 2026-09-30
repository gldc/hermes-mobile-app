import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ApprovalCard } from '../src/components/approval-card';
import type { RequestCardState } from '../src/lib/turn-controller';
import { palettes } from '../src/theme';

const colors = palettes.light; // jest's color scheme

jest.mock('../src/components/icon', () => ({ Icon: () => null }));
const mockSheet = jest.fn();
jest.mock('../src/lib/action-sheet', () => ({ showActionSheet: (...a: unknown[]) => mockSheet(...a) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Medium: 'medium' } }));

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
beforeEach(() => {
  mockSheet.mockReset();
  alertSpy.mockClear();
});
const all4 = { session_id: 's', request_id: 'r', command: 'rm -rf build', description: 'Recursive delete', pattern_key: 'recursive delete', choices: ['once', 'session', 'always', 'deny'] };
const MORE = { name: 'More approval options' };

const card = (over: Partial<RequestCardState> = {}): RequestCardState => ({
  id: 'srq-1', kind: 'approval', method: 'approval', status: 'pending', legacy: false, receivedAt: 0, anchorKey: null,
  params: { session_id: 's', request_id: 'r', command: 'rm -rf build', description: 'Recursive delete' },
  ...over,
});

test('pending + actionable: Approve sends once, Deny sends deny', async () => {
  const onRespond = jest.fn();
  await render(<ApprovalCard card={card()} actionable onRespond={onRespond} />);
  expect(screen.getByText('rm -rf build')).toBeOnTheScreen();
  expect(screen.getByText('Recursive delete')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Approve, run this command once' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Deny, block this command' }));
  expect(onRespond.mock.calls).toEqual([['once'], ['deny']]);
});

test('legacy, not the oldest: disabled with the FIFO hint', async () => {
  const onRespond = jest.fn();
  await render(<ApprovalCard card={card({ id: 'legacy:2', legacy: true })} actionable={false} onRespond={onRespond} />);
  expect(screen.getByText('Waiting for the earlier approval above…')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Approve, run this command once' }));
  expect(onRespond).not.toHaveBeenCalled();
});

test('answering shows Sending…', async () => {
  await render(<ApprovalCard card={card({ status: 'answering' })} actionable onRespond={jest.fn()} />);
  expect(screen.getByText('Sending…')).toBeOnTheScreen();
});

test.each([
  [{ status: 'answered', resolution: 'once' }, 'Approved'],
  [{ status: 'answered', resolution: 'deny' }, 'Denied'],
  [{ status: 'answered', resolution: 'session' }, 'Allowed for this session'],
  [{ status: 'answered', resolution: 'always' }, 'Always allowed'],
  [{ status: 'cancelled', cancelReason: 'interrupted' }, 'Stopped'],
  [{ status: 'cancelled', cancelReason: 'timeout' }, 'Timed out'],
  [{ status: 'cancelled', cancelReason: 'resolved' }, 'Answered elsewhere'],
  [{ status: 'cancelled', cancelReason: 'shutdown' }, 'Closed'],
] as [Partial<RequestCardState>, string][])('settled %o → %s, no buttons', async (over, label) => {
  await render(<ApprovalCard card={card(over)} actionable={false} onRespond={jest.fn()} />);
  expect(screen.getByText(label)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Approve, run this command once' })).toBeNull();
});

// Sim S1 §2 V6: labels touched the button edges at accessibility sizes.
test('V6: Approve and Deny keep 44 pt with vertical padding', async () => {
  await render(<ApprovalCard card={card()} actionable onRespond={jest.fn()} />);
  for (const name of ['Approve, run this command once', 'Deny, block this command']) {
    expect(screen.getByRole('button', { name })).toHaveStyle({ minHeight: 44, paddingVertical: 8 });
  }
});

// Sim S1 §2 V7: a waiting (legacy FIFO) Approve was white on a faded accent in light.
test('V7: a disabled Approve uses the legible disabled treatment, not a faded accent', async () => {
  await render(<ApprovalCard card={card({ id: 'legacy:2', legacy: true })} actionable={false} onRespond={jest.fn()} />);
  const approve = screen.getByRole('button', { name: 'Approve, run this command once' });
  expect(approve).toHaveStyle({ backgroundColor: colors.surface });
  expect(approve.parent).not.toHaveStyle({ opacity: 0.45 }); // the row is no longer faded as a whole
  expect(screen.getByText('Approve')).toHaveStyle({ color: colors.textDim });
});

// Sim S2 §3 (V11): a Tirith security-scan description ran ~10 lines and made the card very tall.
describe('V11: long description', () => {
  const long = 'Tirith could not finish its analysis of this command. '.repeat(8).trim();
  const layout = (lines: number) => ({ nativeEvent: { lines: Array.from({ length: lines }, () => ({})) } });
  const measurer = () => screen.getByTestId('approval-description-measure', { includeHiddenElements: true });

  test('clamps to 4 lines with a Show more / Show less toggle', async () => {
    await render(<ApprovalCard card={card({ params: { session_id: 's', command: 'python x.py', description: long } })} actionable onRespond={jest.fn()} />);
    await fireEvent(measurer(), 'textLayout', layout(10));
    expect(screen.getByText(long).props.numberOfLines).toBe(4);
    const more = screen.getByRole('button', { name: 'Show more of the description' });
    expect(more).toBeCollapsed();
    await fireEvent.press(more);
    expect(screen.getByText(long).props.numberOfLines).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Show less of the description' })).toBeExpanded();
  });

  // Review fix round 1: fail open — until the twin reports overflow (and if it never does on a device)
  // the description is never clamped, so a security note can't be cut off with no way to read it.
  test('before any text layout the description is unclamped and there is no toggle', async () => {
    await render(<ApprovalCard card={card({ params: { session_id: 's', command: 'python x.py', description: long } })} actionable onRespond={jest.fn()} />);
    expect(screen.getByText(long).props.numberOfLines).toBeUndefined();
    expect(screen.queryByRole('button', { name: /of the description/ })).toBeNull();
  });

  test('a description that fits in 4 lines has no toggle', async () => {
    await render(<ApprovalCard card={card()} actionable onRespond={jest.fn()} />);
    await fireEvent(measurer(), 'textLayout', layout(4));
    expect(screen.queryByRole('button', { name: /of the description/ })).toBeNull();
    expect(screen.getByText('Recursive delete').props.numberOfLines).toBeUndefined();
  });
});

describe('More options (session / always)', () => {
  test('offers both: the sheet lists them and session responds session', async () => {
    const onRespond = jest.fn();
    await render(<ApprovalCard card={card({ params: all4 })} actionable onRespond={onRespond} />);
    await fireEvent.press(screen.getByRole('button', MORE));
    expect(mockSheet).toHaveBeenCalledTimes(1);
    const [title, actions] = mockSheet.mock.calls[0];
    expect(title).toBe('recursive delete');
    expect(actions.map((a: { label: string }) => a.label)).toEqual(['Allow for this session', 'Always allow…']);
    actions[0].onPress();
    expect(onRespond.mock.calls).toEqual([['session']]);
  });

  test('always confirms before sending; Cancel sends nothing', async () => {
    const onRespond = jest.fn();
    await render(<ApprovalCard card={card({ params: all4 })} actionable onRespond={onRespond} />);
    await fireEvent.press(screen.getByRole('button', MORE));
    mockSheet.mock.calls[0][1][1].onPress();
    expect(onRespond).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Always allow this command?');
    expect(message).toContain('recursive delete');
    expect(message).toContain('config.yaml');
    expect(buttons).toEqual([
      { text: 'Cancel', style: 'cancel' },
      { text: 'Always allow', style: 'destructive', onPress: expect.any(Function) },
    ]);
    buttons![1].onPress!();
    expect(onRespond.mock.calls).toEqual([['always']]);
  });

  test('only session offered → one sheet action', async () => {
    await render(<ApprovalCard card={card({ params: { ...all4, choices: ['once', 'session', 'deny'] } })} actionable onRespond={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', MORE));
    expect(mockSheet.mock.calls[0][1].map((a: { label: string }) => a.label)).toEqual(['Allow for this session']);
  });

  test('none offered → no More options link', async () => {
    await render(<ApprovalCard card={card({ params: { ...all4, choices: ['once', 'deny'] } })} actionable onRespond={jest.fn()} />);
    expect(screen.queryByRole('button', MORE)).toBeNull();
  });

  test('legacy not-oldest: disabled, cannot open the sheet', async () => {
    await render(<ApprovalCard card={card({ id: 'legacy:2', legacy: true, params: all4 })} actionable={false} onRespond={jest.fn()} />);
    const more = screen.getByRole('button', MORE);
    expect(more).toBeDisabled();
    await fireEvent.press(more);
    expect(mockSheet).not.toHaveBeenCalled();
  });

  test('keeps 44 pt', async () => {
    await render(<ApprovalCard card={card({ params: all4 })} actionable onRespond={jest.fn()} />);
    expect(screen.getByRole('button', MORE)).toHaveStyle({ minHeight: 44 });
  });

  test('settled row label names the choice', async () => {
    await render(<ApprovalCard card={card({ status: 'answered', resolution: 'session', params: all4 })} actionable={false} onRespond={jest.fn()} />);
    expect(screen.getByLabelText('Approval Allowed for this session')).toBeOnTheScreen();
  });
});
