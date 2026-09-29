import {
  EMPTY_DRAFT, SINGLE_QID, clarifyView, draftAnswer, lockedAnswerLabel, parseChoice, setOther, toggleChoice,
} from '../src/lib/clarify';

test('parseChoice turns the wire "(Recommended)" suffix into a badge flag', () => {
  expect(parseChoice('Blue (Recommended)')).toEqual({ label: 'Blue', recommended: true });
  expect(parseChoice('Red')).toEqual({ label: 'Red', recommended: false });
});

test('single question view', () => {
  expect(clarifyView({ session_id: 's', question: 'Color?', choices: ['Blue (Recommended)', 'Red'], multi_select: true })).toEqual({
    batch: false,
    questions: [{ qid: SINGLE_QID, question: 'Color?', multiSelect: true, choices: [{ label: 'Blue', recommended: true }, { label: 'Red', recommended: false }] }],
  });
});

test('choices null means a text field only, and multi_select is ignored without choices', () => {
  const v = clarifyView({ session_id: 's', question: 'Why?', choices: null, multi_select: true });
  expect(v?.questions[0]).toMatchObject({ choices: null, multiSelect: false });
});

test('batch view keeps qids and per-question multi_select', () => {
  const v = clarifyView({
    session_id: 's',
    questions: [
      { qid: 'q0', question: 'A?', choices: ['x', 'y'], multi_select: true },
      { qid: 'q1', question: 'B?', choices: null, multi_select: false },
    ],
  });
  expect(v?.batch).toBe(true);
  expect(v?.questions.map((q) => [q.qid, q.multiSelect])).toEqual([['q0', true], ['q1', false]]);
});

describe('drafts', () => {
  const radio = { qid: 'q0', question: '?', multiSelect: false, choices: [{ label: 'A', recommended: false }, { label: 'B', recommended: false }] };
  const multi = { ...radio, multiSelect: true };
  const open = { qid: 'q1', question: '?', multiSelect: false, choices: null };
  it('radio: selecting replaces; Other text replaces the choice', () => {
    let d = toggleChoice(radio, EMPTY_DRAFT, 'A');
    d = toggleChoice(radio, d, 'B');
    expect(draftAnswer(radio, d)).toBe('B');
    d = setOther(radio, d, 'Teal');
    expect(d.selected).toEqual([]);
    expect(draftAnswer(radio, d)).toBe('Teal');
  });
  it('multi: toggles, keeps choice order, appends Other', () => {
    let d = toggleChoice(multi, EMPTY_DRAFT, 'B');
    d = toggleChoice(multi, d, 'A');
    expect(draftAnswer(multi, d)).toEqual(['A', 'B']);
    d = toggleChoice(multi, d, 'A');
    d = setOther(multi, d, ' C ');
    expect(draftAnswer(multi, d)).toEqual(['B', 'C']);
  });
  it('nothing chosen → null; open question uses the text', () => {
    expect(draftAnswer(radio, EMPTY_DRAFT)).toBeNull();
    expect(draftAnswer(multi, EMPTY_DRAFT)).toBeNull();
    expect(draftAnswer(open, setOther(open, EMPTY_DRAFT, '  because  '))).toBe('because');
  });
});

test('lockedAnswerLabel renders replayed JSON-array strings, arrays and skips', () => {
  expect(lockedAnswerLabel('["a","b"]')).toBe('a, b');
  expect(lockedAnswerLabel(['a', 'b'])).toBe('a, b');
  expect(lockedAnswerLabel('plain')).toBe('plain');
  expect(lockedAnswerLabel('[not json')).toBe('[not json');
  expect(lockedAnswerLabel('')).toBe('');
  expect(lockedAnswerLabel(undefined)).toBe('');
});

// Final review m3: a malformed clarify used to throw in render and RouteError replaced the whole chat.
// null = "can't be shown"; the card then offers a Skip (cancel-all) instead.
describe('clarifyView with malformed params (m3)', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'Color?'],
    ['no question at all', { session_id: 's' }],
    ['a non-string question', { session_id: 's', question: 42 }],
    ['a blank question', { session_id: 's', question: '   ' }],
    ['a batch entry that is not an object', { session_id: 's', questions: [null] }],
    ['a batch entry without a qid', { session_id: 's', questions: [{ question: 'Env?' }] }],
    ['a batch entry without a question', { session_id: 's', questions: [{ qid: 'q0', question: '' }] }],
    ['a batch with one bad entry among good ones', { session_id: 's', questions: [{ qid: 'q0', question: 'Env?' }, { qid: 7, question: 'x' }] }],
  ])('%s → null', (_name, params) => {
    expect(clarifyView(params)).toBeNull();
  });

  test('non-string choices are dropped; a non-array choices is a text-only question', () => {
    expect(clarifyView({ session_id: 's', question: 'Pick', choices: ['A', 3, null, 'B'] })?.questions[0].choices).toEqual([
      { label: 'A', recommended: false },
      { label: 'B', recommended: false },
    ]);
    expect(clarifyView({ session_id: 's', question: 'Why?', choices: 'A,B' })?.questions[0].choices).toBeNull();
    expect(
      clarifyView({ session_id: 's', questions: [{ qid: 'q0', question: 'Env?', choices: { a: 1 } }] })?.questions[0],
    ).toEqual({ qid: 'q0', question: 'Env?', choices: null, multiSelect: false });
  });
});
