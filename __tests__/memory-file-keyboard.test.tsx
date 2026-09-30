// Memory-file editor under the keyboard. KeyboardAvoidingView compares its onLayout frame, which
// is relative to its parent (the content below the native header), with the keyboard's screen Y,
// so without keyboardVerticalOffset it under-compensates by the header height: the last lines, the
// caret and the size counter sat behind the keyboard.
import { Stack, router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Keyboard, StyleSheet, Text, type KeyboardEvent } from 'react-native';
import MemoryFileScreen from '../src/app/memory-file';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));
jest.mock('../src/components/markdown-view', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return { MarkdownView: ({ text }: { text: string }) => <RNText>{text}</RNText> };
});
jest.mock('../src/connection', () => ({
  withAuthRetry: async () => ({ name: 'USER.md', content: 'old' }),
}));
jest.mock('expo-router/react-navigation', () => ({
  ...jest.requireActual('expo-router/react-navigation'),
  useHeaderHeight: () => 116,
}));

// KeyboardAvoidingView subscribes to keyboardWillShow on iOS; keep the handler to drive it.
const keyboardHandlers: ((e: KeyboardEvent) => void)[] = [];
let addListener: jest.SpyInstance;
beforeEach(() => {
  keyboardHandlers.length = 0;
  addListener = jest.spyOn(Keyboard, 'addListener').mockImplementation((event, handler) => {
    if (event === 'keyboardWillShow') keyboardHandlers.push(handler as (e: KeyboardEvent) => void);
    return { remove: () => {} } as ReturnType<typeof Keyboard.addListener>;
  });
});
afterEach(() => addListener.mockRestore());

test('the editor pads its bottom by the keyboard overlap, header included', async () => {
  await renderRouter(
    { _layout: () => <Stack />, index: () => <Text>home</Text>, 'memory-file': MemoryFileScreen },
    { initialUrl: '/' },
  );
  await act(async () => router.push('/memory-file?name=USER.md'));
  await screen.findByText('old');

  // Content view: 700 pt tall, starting below a 116 pt header; keyboard top at screen Y 500.
  const avoider = screen.getByTestId('memory-file-keyboard-avoider');
  await act(async () =>
    fireEvent(avoider, 'layout', {
      persist: () => {},
      nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 700 } },
    }),
  );
  await act(async () => {
    for (const h of keyboardHandlers)
      h({
        duration: 0,
        easing: 'keyboard',
        endCoordinates: { screenX: 0, screenY: 500, width: 402, height: 374 },
      } as KeyboardEvent);
  });

  // 116 + 700 - 500: the whole overlap. Without the header offset it would be 200.
  expect(StyleSheet.flatten(screen.getByTestId('memory-file-keyboard-avoider').props.style).paddingBottom).toBe(316);
});
