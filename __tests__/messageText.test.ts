import { messageText } from '../src/lib/message-text';
import { reasoningText } from '../src/lib/message-text';

describe('messageText', () => {
  it('uses string content (the common DB shape)', () => {
    expect(messageText({ content: 'hello' })).toBe('hello');
  });

  it('joins text parts from structured content', () => {
    expect(
      messageText({
        content: [
          { type: 'text', text: 'part one ' },
          { type: 'image_url', image_url: { url: 'x' } },
          { type: 'text', text: 'part two' },
        ],
      }),
    ).toBe('part one part two');
  });

  it('prefers an explicit text field when present', () => {
    expect(messageText({ text: 'explicit', content: 'ignored' })).toBe('explicit');
  });

  it('returns empty string for null/missing content', () => {
    expect(messageText({})).toBe('');
    expect(messageText({ text: null, content: null })).toBe('');
  });
});

describe('reasoningText', () => {
  it('prefers reasoning_content, then reasoning', () => {
    expect(reasoningText({ reasoning_content: 'rc', reasoning: 'r' })).toBe('rc');
    expect(reasoningText({ reasoning: 'r' })).toBe('r');
  });
  it('returns empty string when none present', () => {
    expect(reasoningText({})).toBe('');
    expect(reasoningText({ reasoning: null, reasoning_content: null })).toBe('');
  });
});
