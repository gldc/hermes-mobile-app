import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConnectorTestCard } from '../src/components/connector-test-card';
import { palettes } from '../src/theme';

const colors = palettes.light;
const noop = () => {};

test('idle and connected: an enabled Test button, no result', async () => {
  const onTest = jest.fn();
  await render(<ConnectorTestCard state={{ phase: 'idle' }} connected onTest={onTest} />);
  const button = screen.getByRole('button', { name: 'Test connection' });
  expect(button).not.toBeDisabled();
  fireEvent.press(button);
  expect(onTest).toHaveBeenCalledTimes(1);
});

test('not connected: the button is disabled and the reason is shown (review focus 1)', async () => {
  await render(<ConnectorTestCard state={{ phase: 'idle' }} connected={false} onTest={noop} />);
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  expect(screen.getByText('Testing needs a connected chat. Go back to the chat, wait for it to connect, then return.')).toBeTruthy();
});

test('running: the button is disabled and says Testing', async () => {
  await render(<ConnectorTestCard state={{ phase: 'running' }} connected onTest={noop} />);
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  expect(screen.getByText('Testing…')).toBeTruthy();
});

test('a passed test shows the summary and each tool', async () => {
  await render(
    <ConnectorTestCard
      connected
      onTest={noop}
      state={{
        phase: 'done',
        outcome: {
          kind: 'ok',
          tools: [
            { name: 'search_issues', description: 'Search issues' },
            { name: 'create_issue', description: '' },
          ],
          prompts: 1,
          resources: 0,
          tokensPresent: true,
        },
      }}
    />,
  );
  expect(screen.getByText('Working · 2 tools · 1 prompt')).toHaveStyle({ color: colors.success });
  expect(screen.getByText('search_issues')).toBeTruthy();
  expect(screen.getByText('Search issues')).toBeTruthy();
  expect(screen.getByText('create_issue')).toBeTruthy();
});

test('a failed test shows the gateway text, in danger, and not selectable', async () => {
  await render(
    <ConnectorTestCard
      connected
      onTest={noop}
      state={{ phase: 'done', outcome: { kind: 'failed', message: 'OAuth authentication required — no token found.', oauthNeeded: true, tokensPresent: false } }}
    />,
  );
  const text = screen.getByText('OAuth authentication required — no token found.');
  expect(text).toHaveStyle({ color: colors.danger });
  expect(text.props.selectable).toBe(false);
});

test('a call error is shown the same way', async () => {
  await render(
    <ConnectorTestCard connected onTest={noop} state={{ phase: 'done', outcome: { kind: 'error', message: 'socket closed' } }} />,
  );
  expect(screen.getByText('socket closed').props.selectable).toBe(false);
});
