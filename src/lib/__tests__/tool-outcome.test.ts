import { deniedSummary, toolOutcome, type ToolOutcome } from '../tool-outcome';

// Result shapes at hermes-agent v2026.9.24 (plan Task 2, review findings 3, 4, 8).
const deniedTerminal = {
  output: '',
  exit_code: -1,
  error: 'BLOCKED: User denied this command.',
  status: 'blocked',
  user_summary: 'You denied this command — it did not run.',
};
const deniedCode = {
  status: 'error',
  error: 'BLOCKED: User denied this code.',
  user_summary: 'You denied this code — it did not run.',
};

describe('toolOutcome', () => {
  const table: [string, unknown, ToolOutcome][] = [
    ['terminal denial (object)', deniedTerminal, 'denied'],
    ['terminal denial (JSON string)', JSON.stringify(deniedTerminal), 'denied'],
    ['execute_code denial: status error + user_summary (R3)', deniedCode, 'denied'],
    ['denial + a tool-loop warning appended (R4)', `${JSON.stringify(deniedTerminal)}\n\n[Tool loop warning: x]`, 'denied'],
    ['skipped by a user interrupt', '[Tool execution cancelled — terminal was skipped due to user interrupt]', 'interrupted'],
    ['skipped by a keyboard interrupt', '[Tool execution cancelled — terminal was skipped due to keyboard interrupt]', 'interrupted'],
    ['abandoned', '[Tool execution cancelled — terminal was abandoned: session closed]', 'interrupted'],
    ['terminal killed by the interrupt', { output: 'partial\n[Command interrupted]', exit_code: 130, error: null }, 'interrupted'],
    ['interrupt marker not at the end (R8)', { output: 'x\n[Command interrupted]\n(sudo: note)', exit_code: 130, error: null }, 'interrupted'],
    ['exit 130 without the marker', { output: 'bye', exit_code: 130, error: null }, 'ok'],
    ['keyboard interrupt: status cancelled (R8)', { error: 'Tool execution cancelled by user interrupt', status: 'cancelled' }, 'interrupted'],
    ['timeout', "Error executing tool 'terminal': timed out after 180s", 'failed'],
    ['generic error', { error: 'boom' }, 'failed'],
    ['generic error (JSON string)', '{"error":"boom"}', 'failed'],
    ['error + a subdir hint appended (R4)', '{"error":"x"}\n\nSubdirectory context: web/AGENTS.md was loaded.', 'failed'],
    ['error + a bracketed notice appended (R4)', '{"error":"x"}\n\n[Tool loop hard stop: y]', 'failed'],
    ['brace inside a string before the appended text (R4)', '{"error":"a } b"}\n\ntrailing {', 'failed'],
    ['non-zero exit with error null is a normal completion', { error: null, exit_code: 2, output: 'x' }, 'ok'],
    ['empty error', { error: '' }, 'ok'],
    ['error "none"', { error: 'none' }, 'ok'],
    ['error "N/A"', { error: 'N/A' }, 'ok'],
    ['error false', { error: false }, 'ok'],
    ['error 0', { error: 0 }, 'ok'],
    ['error true', { error: true }, 'failed'],
    ['error 1', { error: 1 }, 'failed'],
    ['error object', { error: { code: 1 } }, 'failed'],
    ['error empty object', { error: {} }, 'ok'],
    ['success false', { success: false }, 'failed'],
    ['ok false', { ok: false }, 'failed'],
    ['status Error', { status: 'Error' }, 'failed'],
    ['status failed', { status: 'failed' }, 'failed'],
    ['failure', { failure: 'disk full' }, 'failed'],
    ['exception', { exception: 'Traceback …' }, 'failed'],
    ['errors []', { errors: [] }, 'ok'],
    ['errors ["x"]', { errors: ['x'] }, 'failed'],
    ['errors [""] (R8)', { errors: [''] }, 'ok'],
    ['plain text', 'plain text', 'ok'],
    ['undefined', undefined, 'ok'],
    ['null', null, 'ok'],
    ['a number', 42, 'ok'],
    ['an array', [], 'ok'],
    ['malformed JSON', '{not json', 'ok'],
    ['a success object', { bytes_written: 5763, dirs_created: true }, 'ok'],
  ];
  test.each(table)('%s', (_name, result, expected) => {
    expect(toolOutcome(result)).toBe(expected);
  });
});

describe('deniedSummary', () => {
  test('the user_summary of a denial, whatever the status', () => {
    expect(deniedSummary(deniedTerminal)).toBe('You denied this command — it did not run.');
    expect(deniedSummary(JSON.stringify(deniedCode))).toBe('You denied this code — it did not run.');
    expect(deniedSummary(`${JSON.stringify(deniedTerminal)}\n\n[Tool loop warning: x]`)).toBe(
      'You denied this command — it did not run.',
    );
  });

  test('undefined otherwise', () => {
    expect(deniedSummary({ error: 'boom' })).toBeUndefined();
    expect(deniedSummary({ user_summary: '' })).toBeUndefined();
    expect(deniedSummary({ user_summary: 3 })).toBeUndefined();
    expect(deniedSummary('plain text')).toBeUndefined();
    expect(deniedSummary(undefined)).toBeUndefined();
  });
});
