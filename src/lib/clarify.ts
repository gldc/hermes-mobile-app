// src/lib/clarify.ts — view model for the clarify card (spec §6.2).
import type { ClarifyAnswer } from '@/lib/request-answers';
import type { ClarifyRequestParams } from '@/vendor/hermes-gateway';

const RECOMMENDED = /\s*\(recommended\)\s*$/i;
/** Pseudo-qid for the single-question shape (it has no qids; never sent on the wire). */
export const SINGLE_QID = 'single';

export interface ClarifyChoiceView { label: string; recommended: boolean }
export interface ClarifyQuestionView {
  qid: string;
  question: string;
  choices: ClarifyChoiceView[] | null;
  multiSelect: boolean;
}
export interface ClarifyView { batch: boolean; questions: ClarifyQuestionView[] }
/** `selected` holds choice labels (suffix stripped — the gateway strips it anyway). */
export interface ClarifyDraft { selected: string[]; other: string }
export const EMPTY_DRAFT: ClarifyDraft = { selected: [], other: '' };

export function parseChoice(wire: string): ClarifyChoiceView {
  const recommended = RECOMMENDED.test(wire);
  return { label: recommended ? wire.replace(RECOMMENDED, '') : wire, recommended };
}

function choicesOf(raw: unknown): ClarifyChoiceView[] | null {
  const wire = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string') : [];
  return wire.length > 0 ? wire.map(parseChoice) : null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** One batch question, or null when it is malformed (no string qid or question). */
function questionOf(raw: unknown): ClarifyQuestionView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const q = raw as Partial<Record<keyof NonNullable<ClarifyRequestParams['questions']>[number], unknown>>;
  const qid = text(q.qid);
  const question = text(q.question);
  if (qid === null || question === null) return null;
  const choices = choicesOf(q.choices);
  return { qid, question, choices, multiSelect: q.multi_select === true && choices !== null };
}

/**
 * The card's view, or null when the params can't be shown (final review m3): not an object, a single
 * question with no text, or a batch with any malformed question — half a batch can't be answered.
 * The card then offers only Skip; nothing here ever throws on server data.
 */
export function clarifyView(params: unknown): ClarifyView | null {
  if (typeof params !== 'object' || params === null) return null;
  const p = params as Partial<Record<keyof ClarifyRequestParams, unknown>>;
  if (Array.isArray(p.questions) && p.questions.length > 0) {
    const questions = p.questions.map(questionOf);
    return questions.every((q): q is ClarifyQuestionView => q !== null) ? { batch: true, questions } : null;
  }
  const question = text(p.question);
  if (question === null) return null;
  const choices = choicesOf(p.choices);
  return {
    batch: false,
    questions: [{ qid: SINGLE_QID, question, choices, multiSelect: p.multi_select === true && choices !== null }],
  };
}

export function toggleChoice(q: ClarifyQuestionView, d: ClarifyDraft, label: string): ClarifyDraft {
  if (!q.multiSelect) return { selected: [label], other: '' };
  return d.selected.includes(label)
    ? { ...d, selected: d.selected.filter((s) => s !== label) }
    : { ...d, selected: [...d.selected, label] };
}

export function setOther(q: ClarifyQuestionView, d: ClarifyDraft, text: string): ClarifyDraft {
  if (q.multiSelect) return { ...d, other: text };
  return { selected: text.trim() ? [] : d.selected, other: text };
}

/** The answer to send, or null when nothing is chosen yet. */
export function draftAnswer(q: ClarifyQuestionView, d: ClarifyDraft): ClarifyAnswer | null {
  const other = d.other.trim();
  if (q.multiSelect) {
    const ordered = (q.choices ?? []).map((c) => c.label).filter((l) => d.selected.includes(l));
    const all = other ? [...ordered, other] : ordered;
    return all.length > 0 ? all : null;
  }
  if (other) return other;
  return d.selected[0] ?? null;
}

/** Display text for a locked answer ('' = skipped; replayed multi-select arrives as JSON text). */
export function lockedAnswerLabel(answer: unknown): string {
  if (Array.isArray(answer)) return answer.map(String).join(', ');
  if (typeof answer !== 'string') return '';
  if (answer.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(answer);
      if (Array.isArray(parsed)) return parsed.map(String).join(', ');
    } catch {
      // not JSON — show as typed
    }
  }
  return answer;
}
