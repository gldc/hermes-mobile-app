import {
  __resetDraftChatStore,
  clearStartedDraft,
  getStartedDraft,
  setStartedDraft,
} from '../src/draft-chat-store';

beforeEach(() => __resetDraftChatStore());

describe('draft-chat-store', () => {
  it('starts empty', () => {
    expect(getStartedDraft()).toBeNull();
  });

  it('publishes the session a /chat/new screen minted', () => {
    setStartedDraft('s-1');
    expect(getStartedDraft()).toBe('s-1');
  });

  it('clears only its own session, so a stale unmount cannot clear a newer draft', () => {
    setStartedDraft('s-2');
    clearStartedDraft('s-1');
    expect(getStartedDraft()).toBe('s-2');
    clearStartedDraft('s-2');
    expect(getStartedDraft()).toBeNull();
  });

  it('clearing with null (a draft that never started) is a no-op', () => {
    setStartedDraft('s-3');
    clearStartedDraft(null);
    expect(getStartedDraft()).toBe('s-3');
  });
});
