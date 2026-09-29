import { render, screen } from '@testing-library/react-native';
import { CardButton } from '../src/components/card-button';
import { palettes } from '../src/theme';

const colors = palettes.light; // jest's color scheme — where the disabled primary was illegible

// Sim S1 §2 V6: at accessibility sizes the label touched the button's top and bottom edges.
test('V6: 44 pt minimum with vertical padding for large text', async () => {
  await render(<CardButton label="Skip" a11y="Skip" onPress={() => {}} />);
  expect(screen.getByRole('button', { name: 'Skip' })).toHaveStyle({ minHeight: 44, paddingVertical: 8 });
});

test('an enabled primary is the accent with onAccent text', async () => {
  await render(<CardButton label="Send" a11y="Send" onPress={() => {}} primary />);
  expect(screen.getByRole('button', { name: 'Send' })).toHaveStyle({ backgroundColor: colors.accent });
  expect(screen.getByText('Send')).toHaveStyle({ color: colors.onAccent });
});

// Sim S1 §2 V7: white onAccent on a 45%-opacity accent was low contrast in light.
test('V7: a disabled primary drops the accent for a legible surface + secondary text, not faded white', async () => {
  await render(<CardButton label="Send" a11y="Send" onPress={() => {}} primary disabled />);
  const button = screen.getByRole('button', { name: 'Send' });
  expect(button).toBeDisabled();
  expect(button).toHaveStyle({ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: 1 });
  expect(screen.getByText('Send')).toHaveStyle({ color: colors.textDim });
});
