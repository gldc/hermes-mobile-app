import {
  emptyModelPill,
  withSessionModel,
  withFallbackModel,
  pillLabel,
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

test('reducers are immutable (return new objects)', () => {
  const a = emptyModelPill();
  const b = withSessionModel(a, 'x/y');
  expect(b).not.toBe(a);
  expect(a.session).toBeNull();
});
