// src/lib/tool-outcome.ts — how a finished tool ended, read from its `tool.complete` result. The wire
// carries no status field (upstream ui-tui turnController.ts:860): failure lives in `result`. Shapes
// at hermes-agent v2026.9.24 are cited in docs/superpowers/plans/2026-09-29-d1-card-anchor-tool-outcome.md.

export type ToolOutcome = 'ok' | 'failed' | 'denied' | 'interrupted';

type ResultObject = Record<string, unknown>;

function asObject(v: unknown): ResultObject | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as ResultObject) : null;
}

function parseObject(text: string | null): ResultObject | null {
  if (text === null) return null;
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The text up to the brace that closes the leading `{`, skipping braces inside JSON strings. */
function balancedPrefix(text: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(0, i + 1);
  }
  return null;
}

/** The only keys that can classify a result as anything but ok. A history reload classifies every
 *  tool message, so a JSON text naming none of them is not parsed at all (review: reload jank). */
const OUTCOME_KEYS = ['"status"', '"user_summary"', '"success"', '"ok"', '"error"', '"errors"', '"failure"', '"exception"', '"exit_code"'];

/**
 * The result as an object: an object as is; a string that is a JSON object; or, when the agent
 * appended text after the JSON (a tool-loop warning `\n\n[…]`, or the subdirectory hints that only
 * the stored copy gets — review finding 4), the JSON prefix. Anything else is null.
 */
function resultObject(result: unknown): ResultObject | null {
  if (typeof result !== 'string') return asObject(result);
  const text = result.trim();
  if (!text.startsWith('{') || !OUTCOME_KEYS.some((k) => text.includes(k))) return null;
  const cut = text.indexOf('\n\n[');
  return parseObject(text) ?? parseObject(cut > 0 ? text.slice(0, cut) : null) ?? parseObject(balancedPrefix(text));
}

const NOT_AN_ERROR = new Set(['', '0', 'false', 'none', 'null', 'nil', 'ok', 'success', 'n/a', 'na']);

/** Upstream desktop's rule (apps/desktop/src/lib/tool-result-summary.ts): does this value report an error? */
function meaningful(v: unknown): boolean {
  if (typeof v === 'string') return !NOT_AN_ERROR.has(v.trim().toLowerCase());
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (Array.isArray(v)) return v.some(meaningful);
  if (v !== null && typeof v === 'object') return Object.keys(v).length > 0;
  return v === true;
}

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Classify a `tool.complete` result (already JSON-parsed by the gateway, or a raw string). In order:
 * denied (`status: "blocked"`, or a `user_summary` — upstream sets it only when the user did not
 * consent, e.g. execute_code's gate answers `status: "error"`), interrupted (a "[Tool execution
 * cancelled" string, `status: "cancelled"`, or exit 130 with "[Command interrupted]" in the output),
 * failed ("Error executing tool" string, or the desktop rule), else ok. A non-zero exit with
 * `error: null` is a normal completion: the command failed, the tool worked. Never throws.
 */
export function toolOutcome(result: unknown): ToolOutcome {
  if (typeof result === 'string') {
    const text = result.trim();
    if (text.startsWith('[Tool execution cancelled')) return 'interrupted';
    if (text.startsWith('Error executing tool')) return 'failed';
  }
  const obj = resultObject(result);
  if (!obj) return 'ok';
  if (obj.status === 'blocked' || nonEmptyString(obj.user_summary)) return 'denied';
  if (obj.status === 'cancelled') return 'interrupted';
  if (obj.exit_code === 130 && typeof obj.output === 'string' && obj.output.includes('[Command interrupted]')) {
    return 'interrupted';
  }
  const status = typeof obj.status === 'string' ? obj.status : '';
  if (
    obj.success === false ||
    obj.ok === false ||
    /^(error|failed|failure|fatal|exception)$/i.test(status) ||
    ['error', 'errors', 'failure', 'exception'].some((k) => meaningful(obj[k]))
  ) {
    return 'failed';
  }
  return 'ok';
}

/** The `user_summary` of a denied result ("You denied this command — it did not run."), shown as the
 *  row's summary; undefined when there is none. */
export function deniedSummary(result: unknown): string | undefined {
  const summary = resultObject(result)?.user_summary;
  return nonEmptyString(summary) ? summary : undefined;
}
