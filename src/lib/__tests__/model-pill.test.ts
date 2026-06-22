import {
  emptyModelPill,
  withSessionModel,
  withFallbackModel,
  withResumedModel,
  pillLabel,
  pillModelId,
} from '../model-pill';

test('empty pill has no label', () => {
  expect(pillLabel(emptyModelPill())).toBeNull();
});

test('fallback (gateway default) shows when no session model is known', () => {
  const s = withFallbackModel(emptyModelPill(), 'anthropic/claude-opus-4.8');
  expect(pillLabel(s)).toBe('claude-opus-4.8'); // display name (trailing path segment)
});

test('session model wins over the fallback default', () => {
  let s = withFallbackModel(emptyModelPill(), 'openrouter/glm-5.2');
  s = withSessionModel(s, 'openai/qwen3.7-max');
  expect(pillLabel(s)).toBe('qwen3.7-max');
});

test('clearing the session model falls back to the default', () => {
  let s = withFallbackModel(emptyModelPill(), 'openrouter/glm-5.2');
  s = withSessionModel(s, 'openai/qwen3.7-max');
  s = withSessionModel(s, null);
  expect(pillLabel(s)).toBe('glm-5.2');
});

test('undefined / empty model ids are treated as unknown (no crash, no label)', () => {
  let s = withSessionModel(emptyModelPill(), undefined);
  expect(pillLabel(s)).toBeNull();
  s = withFallbackModel(s, '');
  expect(pillLabel(s)).toBeNull();
});

test('a bare (non-namespaced) model id is shown as-is', () => {
  const s = withSessionModel(emptyModelPill(), 'qwen3.7-max');
  expect(pillLabel(s)).toBe('qwen3.7-max');
});

test('a late fallback never overrides an already-known session model', () => {
  // The screen's real ordering: the session model lands first (create/resume),
  // then the best-effort getModelInfo fallback resolves later. Session must win.
  let s = withSessionModel(emptyModelPill(), 'openai/qwen3.7-max');
  s = withFallbackModel(s, 'openrouter/glm-5.2');
  expect(pillLabel(s)).toBe('qwen3.7-max');
});

test('clearing the session model leaves the fallback intact', () => {
  let s = withFallbackModel(emptyModelPill(), 'openrouter/glm-5.2');
  s = withSessionModel(s, 'openai/qwen3.7-max');
  s = withSessionModel(s, null);
  expect(s.session).toBeNull();
  expect(s.fallback).toBe('openrouter/glm-5.2'); // raw id retained (display applied in pillLabel)
});

test('withResumedModel adopts a built (non-lazy) session model', () => {
  const s = withResumedModel(emptyModelPill(), { model: 'openai/qwen3.7-max', lazy: false });
  expect(pillLabel(s)).toBe('qwen3.7-max');
});

test('withResumedModel ignores a lazy resume (reports the gateway default, not the chat model)', () => {
  // A lazy reattach carries info.model = gateway default; adopting it would
  // downgrade a known session model to the wrong value after a reconnect.
  let s = withSessionModel(emptyModelPill(), 'openai/qwen3.7-max'); // real model known
  s = withResumedModel(s, { model: 'openrouter/glm-5.2', lazy: true }); // lazy default
  expect(pillLabel(s)).toBe('qwen3.7-max'); // preserved, not clobbered
});

test('withResumedModel ignores info-less / model-less resume (keeps the known model)', () => {
  let s = withSessionModel(emptyModelPill(), 'openai/qwen3.7-max');
  expect(pillLabel(withResumedModel(s, undefined))).toBe('qwen3.7-max');
  expect(pillLabel(withResumedModel(s, { lazy: false }))).toBe('qwen3.7-max');
});

test('reducers are immutable (return new objects)', () => {
  const a = emptyModelPill();
  expect(withSessionModel(a, 'x/y')).not.toBe(a);
  expect(a.session).toBeNull();
  const c = withFallbackModel(a, 'p/q');
  expect(c).not.toBe(a);
  expect(a.fallback).toBeNull();
});

test('emptyModelPill returns a fresh object each call', () => {
  expect(emptyModelPill()).not.toBe(emptyModelPill());
  expect(emptyModelPill()).toEqual({ session: null, fallback: null });
});

test('pillModelId is null for an empty pill', () => {
  expect(pillModelId(emptyModelPill())).toBeNull();
});

test('pillModelId returns the raw (namespaced) id, session winning over fallback', () => {
  let s = withFallbackModel(emptyModelPill(), 'openrouter/glm-5.2');
  expect(pillModelId(s)).toBe('openrouter/glm-5.2'); // fallback when no session
  s = withSessionModel(s, 'openai/qwen3.7-max');
  expect(pillModelId(s)).toBe('openai/qwen3.7-max'); // session wins, raw not display
  expect(pillLabel(s)).toBe('qwen3.7-max'); // label still the display name
});
