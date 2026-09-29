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

function choicesOf(raw: string[] | null | undefined): ClarifyChoiceView[] | null {
  return Array.isArray(raw) && raw.length > 0 ? raw.map(parseChoice) : null;
}

export function clarifyView(params: ClarifyRequestParams): ClarifyView {
  if (Array.isArray(params.questions) && params.questions.length > 0) {
    return {
      batch: true,
      questions: params.questions.map((q) => {
        const choices = choicesOf(q.choices);
        return { qid: q.qid, question: q.question, choices, multiSelect: Boolean(q.multi_select) && choices !== null };
      }),
    };
  }
  const choices = choicesOf(params.choices);
  return {
    batch: false,
    questions: [{ qid: SINGLE_QID, question: params.question ?? '', choices, multiSelect: Boolean(params.multi_select) && choices !== null }],
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
