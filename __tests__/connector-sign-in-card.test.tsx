import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConnectorSignInCard } from '../src/components/connector-sign-in-card';
import { palettes } from '../src/theme';

const colors = palettes.light;
const noop = () => {};

test('idle: the button carries the label and reports a press', async () => {
  const onSignIn = jest.fn();
  await render(<ConnectorSignInCard label="Sign in again" phase={null} cancelling={false} note={null} onSignIn={onSignIn} onCancel={noop} />);
  const button = screen.getByRole('button', { name: 'Sign in again' });
  expect(button).not.toBeDisabled();
  await fireEvent.press(button);
  expect(onSignIn).toHaveBeenCalledTimes(1);
});

test('disabled when the screen is busy with something else', async () => {
  await render(<ConnectorSignInCard label="Sign in" phase={null} cancelling={false} note={null} disabled onSignIn={noop} onCancel={noop} />);
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
});

test('running: the phase line and a Cancel button replace the Sign in button', async () => {
  const onCancel = jest.fn();
  await render(<ConnectorSignInCard label="Sign in" phase="browser" cancelling={false} note={null} onSignIn={noop} onCancel={onCancel} />);
  expect(screen.getByText('Waiting for you to finish in the browser…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel sign-in' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('cancelling: says so and disables Cancel', async () => {
  await render(<ConnectorSignInCard label="Sign in" phase="starting" cancelling note={null} onSignIn={noop} onCancel={noop} />);
  expect(screen.getByText('Cancelling…')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeDisabled();
});

test('an error note is in the danger colour and not selectable (it can be gateway text)', async () => {
  await render(
    <ConnectorSignInCard label="Sign in" phase={null} cancelling={false} note={{ tone: 'error', text: 'Registration refused' }} onSignIn={noop} onCancel={noop} />,
  );
  const note = screen.getByText('Registration refused');
  expect(note).toHaveStyle({ color: colors.danger });
  expect(note.props.selectable).toBe(false);
});

test('a note with an address shows it under a label, selectable so it can be copied (the app built it)', async () => {
  const address = 'https://hermes.kite-opah.ts.net/api/mcp/oauth/callback/Gmail';
  await render(
    <ConnectorSignInCard
      label="Sign in"
      phase={null}
      cancelling={false}
      note={{ tone: 'error', text: 'The server does not allow it.', address }}
      onSignIn={noop}
      onCancel={noop}
    />,
  );
  expect(screen.getByText('The server does not allow it.').props.selectable).toBe(false);
  expect(screen.getByText('Redirect address')).toBeTruthy();
  const value = screen.getByText(address);
  expect(value.props.selectable).toBe(true);
  expect(value).toHaveStyle({ color: colors.text });
  expect(screen.getByLabelText(`Redirect address: ${address}`)).toBeTruthy();
  // The app derives it; a gateway configured with another address uses that one.
  expect(screen.getByText('The gateway’s default. If its config sets another redirect address, allow that one.')).toBeTruthy();
});

test('a note without an address shows no address label', async () => {
  await render(
    <ConnectorSignInCard label="Sign in" phase={null} cancelling={false} note={{ tone: 'error', text: 'No.', address: null }} onSignIn={noop} onCancel={noop} />,
  );
  expect(screen.queryByText('Redirect address')).toBeNull();
});

test('an info note is in the quiet colour', async () => {
  await render(
    <ConnectorSignInCard label="Sign in again" phase={null} cancelling={false} note={{ tone: 'info', text: 'Signed in.' }} onSignIn={noop} onCancel={noop} />,
  );
  expect(screen.getByText('Signed in.')).toHaveStyle({ color: colors.textDim });
});
