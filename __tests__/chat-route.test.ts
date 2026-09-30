import { chatOnScreen } from '../src/lib/chat-route';

describe('chatOnScreen', () => {
  it('an unstarted new chat is "new"', () => {
    expect(chatOnScreen('/chat/new', null)).toBe('new');
  });

  it('a new chat that lazily minted its session is that session (the URL stays /chat/new)', () => {
    expect(chatOnScreen('/chat/new', 's-123')).toBe('s-123');
  });

  it('an opened chat is its route id, whatever a draft published', () => {
    expect(chatOnScreen('/chat/s-9', null)).toBe('s-9');
    expect(chatOnScreen('/chat/s-9', 's-123')).toBe('s-9');
  });

  it('is null off the chat surface', () => {
    expect(chatOnScreen('/memory', null)).toBeNull();
    expect(chatOnScreen('/memory', 's-123')).toBeNull();
    expect(chatOnScreen('/', null)).toBeNull();
  });
});
