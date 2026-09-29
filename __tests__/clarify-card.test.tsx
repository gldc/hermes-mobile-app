import { fireEvent, render, screen } from '@testing-library/react-native';
import { ClarifyCard } from '../src/components/clarify-card';
import type { RequestCardState } from '../src/lib/turn-controller';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));

const card = (params: Record<string, unknown>, over: Partial<RequestCardState> = {}): RequestCardState => ({
  id: 'srq-c', kind: 'clarify', method: 'clarify', status: 'pending', legacy: false, receivedAt: 0, anchorKey: null,
  params: { session_id: 's', ...params }, ...over,
});
const responder = () => ({
  clarifySingle: jest.fn((_c: RequestCardState, _a: string | string[]) => ({ ok: true as const })),
  clarifyLock: jest.fn(async (_c: RequestCardState, _q: string, _a: string | string[]) => 'ok' as const),
  clarifySubmitAll: jest.fn(async (_c: RequestCardState, _a: Array<{ qid: string; answer: string | string[] }>) => 'resolved' as const),
  clarifySkipAll: jest.fn((_c: RequestCardState) => ({ ok: true as const })),
});
const batch = {
  questions: [
    { qid: 'q0', question: 'Which env?', choices: ['staging (Recommended)', 'prod'], multi_select: false },
    { qid: 'q1', question: 'Anything else?', choices: null, multi_select: false },
  ],
};

test('single: Recommended badge, radio choice, Send sends the label', async () => {
  const r = responder();
  const c = card({ question: 'Color?', choices: ['Blue (Recommended)', 'Red'] });
  await render(<ClarifyCard card={c} responder={r} />);
  expect(screen.getByText('Recommended')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('radio', { name: 'Blue, recommended' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
  expect(r.clarifySingle).toHaveBeenCalledWith(c, 'Blue');
  expect(r.clarifyLock).not.toHaveBeenCalled();
});

test('single: Other text replaces the radio choice', async () => {
  const r = responder();
  await render(<ClarifyCard card={card({ question: 'Color?', choices: ['Red'] })} responder={r} />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Red' }));
  await fireEvent.changeText(screen.getByLabelText('Other answer'), 'Teal');
  await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
  expect(r.clarifySingle.mock.calls[0][1]).toBe('Teal');
});

test('single: choices null → text field only; Skip sends ""', async () => {
  const r = responder();
  await render(<ClarifyCard card={card({ question: 'Why?', choices: null })} responder={r} />);
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(screen.getByLabelText('Answer')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Skip question' }));
  expect(r.clarifySingle.mock.calls[0][1]).toBe('');
});

test('single multi-select: checkboxes, sends an array', async () => {
  const r = responder();
  await render(<ClarifyCard card={card({ question: 'Pick', choices: ['A', 'B', 'C'], multi_select: true })} responder={r} />);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'C' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'A' }));
  expect(screen.getByRole('checkbox', { name: 'A' })).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
  expect(r.clarifySingle.mock.calls[0][1]).toEqual(['A', 'C']);
});

test('batch: Confirm on a multi-select question locks a real array, not a joined string', async () => {
  const r = responder();
  const c = card({
    questions: [{ qid: 'q0', question: 'Pick', choices: ['A', 'B', 'C'], multi_select: true }],
  });
  await render(<ClarifyCard card={c} responder={r} />);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'A' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'C' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm answer to question 1' }));
  expect(r.clarifyLock).toHaveBeenCalledWith(c, 'q0', ['A', 'C']);
  const sentAnswer = r.clarifyLock.mock.calls[0][2];
  expect(Array.isArray(sentAnswer)).toBe(true);
  expect(typeof sentAnswer).not.toBe('string');
});

test('batch: Confirm locks one question, per-question Skip locks ""', async () => {
  const r = responder();
  const c = card(batch);
  await render(<ClarifyCard card={c} responder={r} />);
  expect(screen.getByText('Hermes has 2 questions')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('radio', { name: 'prod' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm answer to question 1' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Skip question 2' }));
  expect(r.clarifyLock.mock.calls).toEqual([[c, 'q0', 'prod'], [c, 'q1', '']]);
});

test('batch: Submit all only sends unlocked questions (Review Focus 4)', async () => {
  const r = responder();
  const c = card({ ...batch, answers: { q0: 'staging' } }, { lockedAnswers: { q0: 'staging' } });
  await render(<ClarifyCard card={c} responder={r} />);
  expect(screen.getByText('staging')).toBeOnTheScreen(); // replayed lock renders as answered
  expect(screen.queryByRole('radio', { name: 'prod' })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Answer for question 2'), 'no');
  await fireEvent.press(screen.getByRole('button', { name: 'Submit all answers' }));
  expect(r.clarifySubmitAll).toHaveBeenCalledWith(c, [{ qid: 'q1', answer: 'no' }]);
});

test('batch: replayed multi-select lock renders as a list; Skip all cancels', async () => {
  const r = responder();
  const c = card(batch, { lockedAnswers: { q0: '["a","b"]' } });
  await render(<ClarifyCard card={c} responder={r} />);
  expect(screen.getByText('a, b')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Skip all questions' }));
  expect(r.clarifySkipAll).toHaveBeenCalledWith(c);
});

test('a failed lock shows a retry note', async () => {
  const r = responder();
  r.clarifyLock.mockResolvedValueOnce('failed' as never);
  await render(<ClarifyCard card={card(batch)} responder={r} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Skip question 2' }));
  expect(await screen.findByText("Couldn't send that answer. Try again.")).toBeOnTheScreen();
});

test('single: a failed Send is retried and the note clears on success', async () => {
  const r = responder();
  r.clarifySingle
    .mockReturnValueOnce({ ok: false, message: "Couldn't send that answer. Try again." } as never)
    .mockReturnValueOnce({ ok: true });
  const c = card({ question: 'Color?', choices: ['Blue'] });
  await render(<ClarifyCard card={c} responder={r} />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Blue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
  expect(await screen.findByText("Couldn't send that answer. Try again.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
  expect(screen.queryByText("Couldn't send that answer. Try again.")).toBeNull();
});

test('batch: a failed Skip all shows a note and the card stays pending', async () => {
  const r = responder();
  r.clarifySkipAll.mockReturnValueOnce({ ok: false, message: "Couldn't skip. Try again." } as never);
  const c = card(batch);
  await render(<ClarifyCard card={c} responder={r} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Skip all questions' }));
  expect(await screen.findByText("Couldn't skip. Try again.")).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Submit all answers' })).not.toBeDisabled();
});

test.each([
  [{ status: 'cancelled', cancelReason: 'timeout' }, 'Timed out'],
  [{ status: 'cancelled', cancelReason: 'interrupted' }, 'Stopped'],
  [{ status: 'skipped' }, 'Skipped'],
  [{ status: 'answered', resolution: 'Blue' }, 'Answered: Blue'],
] as Array<[Partial<RequestCardState>, string]>)('settled %o → %s, no controls', async (over, label) => {
  await render(<ClarifyCard card={card({ question: 'Color?', choices: ['Blue'] }, over)} responder={responder()} />);
  expect(screen.getByText(label)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Send answer' })).toBeNull();
});

test('focusing a free-text field hands the screen that field to scroll into view (Review Focus 5)', async () => {
  const onInputFocus = jest.fn();
  await render(<ClarifyCard card={card({ question: 'Why?', choices: null })} responder={responder()} onInputFocus={onInputFocus} />);
  await fireEvent(screen.getByLabelText('Answer'), 'focus');
  expect(onInputFocus).toHaveBeenCalledTimes(1);
  expect(typeof onInputFocus.mock.calls[0][0].measureInWindow).toBe('function');
});

// Sim S2 §1 (B2): in a tall batch the screen must reveal the FOCUSED field, not the card, so each
// question's field reports itself.
test('batch: focusing question 2 hands over question 2\'s field, not the first one', async () => {
  const onInputFocus = jest.fn();
  await render(<ClarifyCard card={card(batch)} responder={responder()} onInputFocus={onInputFocus} />);
  await fireEvent(screen.getByLabelText('Answer for question 2'), 'focus');
  expect(onInputFocus.mock.calls[0][0].props.accessibilityLabel).toBe('Answer for question 2');
});
