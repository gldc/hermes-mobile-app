// Discard guard (memory-file editor). A bare `beforeRemove` listener is not honoured by
// native-stack: UIKit has already popped the screen when the header back fires, so "Keep editing"
// could not keep you there. The guard must register the route with the navigator
// (usePreventRemove), which blocks the native dismiss and the back-button menu before anything pops.
import { Stack, router } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { Alert, Text, type AlertButton } from 'react-native';
import { useDiscardGuard } from '../src/components/discard-guard';

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
beforeEach(() => alertSpy.mockClear());

let dirty = false;
function Editor() {
  useDiscardGuard(dirty, 'You have unsaved edits to this file.');
  return <Text>editor</Text>;
}

// RNTL 14 renders asynchronously: renderRouter's path helpers ride on the promise it returns.
let pathname: () => string;

async function openEditor(isDirty: boolean) {
  dirty = isDirty;
  const rendered = renderRouter(
    { _layout: () => <Stack />, index: () => <Text>home</Text>, 'memory-file': Editor },
    { initialUrl: '/' },
  );
  pathname = () => rendered.getPathname();
  await rendered;
  await act(async () => router.push('/memory-file'));
  expect(pathname()).toBe('/memory-file');
}

/** preventNativeDismiss of the native screen hosting /memory-file (the last one pushed). */
function editorPreventsNativeDismiss(): boolean | undefined {
  const screens = screen.container.queryAll((n) => n.type === 'RNSScreen');
  expect(screens).toHaveLength(2); // index + memory-file
  return screens[1].props.preventNativeDismiss as boolean | undefined;
}

async function pressAlertButton(text: string) {
  const buttons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const button = buttons?.find((b) => b.text === text);
  if (!button) throw new Error(`no "${text}" alert button`);
  await act(async () => button.onPress?.());
}

test('dirty: the native dismiss is blocked, so the header back cannot pop the screen first', async () => {
  await openEditor(true);
  expect(editorPreventsNativeDismiss()).toBe(true);
});

test('clean: the native dismiss is not blocked and back leaves without asking', async () => {
  await openEditor(false);
  expect(editorPreventsNativeDismiss()).toBeFalsy();
  await act(async () => router.back());
  expect(alertSpy).not.toHaveBeenCalled();
  expect(pathname()).toBe('/');
});

test('dirty: back asks first; Keep editing stays, Discard leaves', async () => {
  await openEditor(true);
  await act(async () => router.back());
  expect(alertSpy).toHaveBeenCalledWith(
    'Discard changes?',
    'You have unsaved edits to this file.',
    expect.any(Array),
  );
  expect(pathname()).toBe('/memory-file');

  await pressAlertButton('Keep editing');
  expect(pathname()).toBe('/memory-file');

  await act(async () => router.back());
  await pressAlertButton('Discard');
  expect(pathname()).toBe('/');
});
