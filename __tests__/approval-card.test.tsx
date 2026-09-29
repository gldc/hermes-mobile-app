import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApprovalCard } from '../src/components/approval-card';
import type { RequestCardState } from '../src/lib/turn-controller';
import { palettes } from '../src/theme';

const colors = palettes.light; // jest's color scheme

jest.mock('../src/components/icon', () => ({ Icon: () => null }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Medium: 'medium' } }));

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
  [{ status: 'cancelled', cancelReason: 'interrupted' }, 'Stopped'],
  [{ status: 'cancelled', cancelReason: 'timeout' }, 'Timed out'],
  [{ status: 'cancelled', cancelReason: 'resolved' }, 'Answered elsewhere'],
  [{ status: 'cancelled', cancelReason: 'shutdown' }, 'Closed'],
] as Array<[Partial<RequestCardState>, string]>)('settled %o → %s, no buttons', async (over, label) => {
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
