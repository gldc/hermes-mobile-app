import { Profiler } from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Composer } from '../src/components/composer';
import type { ComposerMode } from '../src/lib/turn-controller';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));

function setup(mode: ComposerMode, extra: { value?: string; stagedImageUri?: string | null; disabled?: boolean } = {}) {
  const handlers = { onSend: jest.fn(), onStop: jest.fn(), onSteer: jest.fn(), onChangeText: jest.fn() };
  return { handlers, el: <Composer value={extra.value ?? ''} mode={mode} stagedImageUri={extra.stagedImageUri ?? null} disabled={extra.disabled} {...handlers} /> };
}

test('idle with only a staged photo: Send is enabled (review m9)', async () => {
  const { el, handlers } = setup({ kind: 'send', enabled: true }, { stagedImageUri: 'file:///p.jpg' });
  await render(el);
  await fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
  expect(handlers.onSend).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Stop response' })).toBeNull();
});

test('idle, empty: Send disabled, placeholder "Chat with Hermes"', async () => {
  const { el } = setup({ kind: 'send', enabled: false });
  await render(el);
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  expect(screen.getByPlaceholderText('Chat with Hermes')).toBeOnTheScreen();
});

test('streaming, empty input: Stop only, placeholder "Steer Hermes…", input editable', async () => {
  const { el, handlers } = setup({ kind: 'stop+steer', stopEnabled: true, steerEnabled: false });
  await render(el);
  expect(screen.getByPlaceholderText('Steer Hermes…').props.editable).toBe(true);
  expect(screen.queryByRole('button', { name: 'Send steer message' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Stop response' }));
  expect(handlers.onStop).toHaveBeenCalledTimes(1);
});

test('streaming with text: Stop + steer-send; steer never calls onSend', async () => {
  const { el, handlers } = setup({ kind: 'stop+steer', stopEnabled: true, steerEnabled: true }, { value: 'use tabs' });
  await render(el);
  await fireEvent.press(screen.getByRole('button', { name: 'Send steer message' }));
  expect(handlers.onSteer).toHaveBeenCalledTimes(1);
  expect(handlers.onSend).not.toHaveBeenCalled();
});

test('stopping: "Stopping…", Stop and steer disabled', async () => {
  const { el, handlers } = setup({ kind: 'stop+steer', stopEnabled: false, steerEnabled: false }, { value: 'x' });
  await render(el);
  expect(screen.getByText('Stopping…')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Stopping response' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send steer message' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Stopping response' }));
  expect(handlers.onStop).not.toHaveBeenCalled();
});

test('a staged photo while streaming says it waits for the turn to finish', async () => {
  const { el } = setup({ kind: 'stop+steer', stopEnabled: true, steerEnabled: false }, { stagedImageUri: 'file:///p.jpg' });
  await render(el);
  expect(screen.getByText('Sends after Hermes finishes')).toBeOnTheScreen();
});

test('not ready: Stop disabled too', async () => {
  const { el } = setup({ kind: 'stop+steer', stopEnabled: true, steerEnabled: false }, { disabled: true });
  await render(el);
  expect(screen.getByRole('button', { name: 'Stop response' })).toBeDisabled();
});

// ── Re-measure trigger for JS-driven value sets (src/lib/composer-height.ts, Preflight F1) ──────

const running: ComposerMode = { kind: 'stop+steer', stopEnabled: true, steerEnabled: true };
const multiLine = 'Actually, use tabs.\nAnd keep the imports sorted.\nThen rerun the tests.';

/** Records the TextInput's minHeight as committed by each render pass (Profiler onRender runs in
 *  the commit, after the host tree is updated), so a test can tell the value commit from the
 *  follow-up one. */
function measured(onChangeText: (t: string) => void = () => {}) {
  const perCommit: unknown[] = [];
  let rendered = false; // `screen` exists only once the first render() returns
  const minHeight = () => StyleSheet.flatten(screen.getByPlaceholderText('Steer Hermes…').props.style).minHeight;
  const el = (value: string) => (
    <Profiler id="composer" onRender={() => void (rendered && perCommit.push(minHeight()))}>
      <Composer value={value} mode={running} onChangeText={onChangeText} onSend={() => {}} onStop={() => {}} onSteer={() => {}} />
    </Profiler>
  );
  /** minHeights committed since the last call (the first call also arms recording). */
  const commits = () => {
    rendered = true;
    return perCommit.splice(0);
  };
  return { el, commits };
}

test('a JS-driven non-empty set (failed steer restore) gets a follow-up commit that flips minHeight', async () => {
  const m = measured();
  const view = await render(m.el('')); // steer just cleared the input
  m.commits();
  await view.rerender(m.el(multiLine)); // setInput((cur) => restoreSteerText(cur, text))
  // The value commit is measured against the old (empty) text; the follow-up must change a host
  // prop so Fabric re-measures the restored text.
  const [valueCommit, followUp, ...rest] = m.commits();
  expect(rest).toEqual([]);
  expect(followUp).not.toBe(valueCommit);
});

test('restoring exactly the text the user had typed still counts as a JS set', async () => {
  let latest = '';
  const m = measured((t) => void (latest = t));
  const view = await render(m.el(''));
  await fireEvent.changeText(screen.getByPlaceholderText('Steer Hermes…'), 'use tabs');
  await view.rerender(m.el(latest)); // parent echoes the typed text
  await view.rerender(m.el('')); // steer clears
  m.commits();
  await view.rerender(m.el('use tabs')); // steer failed: restore the identical text
  const [valueCommit, followUp, ...rest] = m.commits();
  expect(rest).toEqual([]);
  expect(followUp).not.toBe(valueCommit);
});

test('a JS-driven clear still gets its follow-up commit (C behaviour kept)', async () => {
  let latest = '';
  const m = measured((t) => void (latest = t));
  const view = await render(m.el(''));
  await fireEvent.changeText(screen.getByPlaceholderText('Steer Hermes…'), multiLine);
  await view.rerender(m.el(latest));
  m.commits();
  await view.rerender(m.el('')); // send / steer clears
  const [valueCommit, followUp, ...rest] = m.commits();
  expect(rest).toEqual([]);
  expect(followUp).not.toBe(valueCommit);
});

test('typed text echoed back by the parent never triggers a follow-up commit', async () => {
  let latest = '';
  const m = measured((t) => void (latest = t));
  const view = await render(m.el(''));
  await fireEvent.changeText(screen.getByPlaceholderText('Steer Hermes…'), multiLine);
  m.commits();
  await view.rerender(m.el(latest));
  expect(m.commits()).toHaveLength(1);
});
