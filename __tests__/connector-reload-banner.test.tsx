import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConnectorReloadBanner } from '../src/components/connector-reload-banner';
import { palettes } from '../src/theme';

const colors = palettes.light;
const noop = () => {};

test('says the agent does not have the changes and offers Reload now', async () => {
  const onReload = jest.fn();
  await render(<ConnectorReloadBanner running={false} disabledReason={null} note={null} onReload={onReload} />);
  expect(screen.getByText('The agent doesn’t have your changes yet.')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Reload now' });
  expect(button).not.toBeDisabled();
  await fireEvent.press(button);
  expect(onReload).toHaveBeenCalledTimes(1);
});

test('when it cannot run, the button is disabled and the reason is shown', async () => {
  await render(
    <ConnectorReloadBanner running={false} disabledReason="Wait for the chat’s current turn to finish." note={null} onReload={noop} />,
  );
  expect(screen.getByRole('button', { name: 'Reload now' })).toBeDisabled();
  expect(screen.getByText('Wait for the chat’s current turn to finish.')).toBeTruthy();
});

test('while reloading the button is disabled and says so', async () => {
  await render(<ConnectorReloadBanner running disabledReason={null} note={null} onReload={noop} />);
  expect(screen.getByRole('button', { name: 'Reload now' })).toBeDisabled();
  expect(screen.getByText('Reloading…')).toBeTruthy();
});

test('an error note is shown in the danger colour', async () => {
  await render(
    <ConnectorReloadBanner running={false} disabledReason={null} note={{ tone: 'error', text: 'compute-host reload failed' }} onReload={noop} />,
  );
  expect(screen.getByText('compute-host reload failed')).toHaveStyle({ color: colors.danger });
});
