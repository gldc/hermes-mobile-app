import { AccessibilityInfo, Animated, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceNote,
  TraceTitle,
  type TraceStatus,
} from '../src/components/trace';
import { useTheme, type ThemeColors } from '../src/theme';

const mockIcon = jest.fn((_props: { sf: string; color?: string }) => null);
jest.mock('../src/components/icon', () => ({ Icon: (props: { sf: string; color?: string }) => mockIcon(props) }));

/** The theme the parts render with (the test scheme), read through the same hook. */
let colors: ThemeColors;
beforeAll(async () => {
  function Probe() {
    colors = useTheme().colors;
    return null;
  }
  await render(<Probe />);
});

beforeEach(() => mockIcon.mockClear());

function Line({ status }: { status?: TraceStatus }) {
  return (
    <Trace>
      <TraceLine status={status}>
        <TraceIcon sf="hammer.fill" />
        <TraceTitle>Ran pnpm build</TraceTitle>
        <TraceDescription>1.2s</TraceDescription>
      </TraceLine>
    </Trace>
  );
}

describe('TraceLine', () => {
  test('a finished line is muted: title and icon in textDim, description in textFaint', async () => {
    await render(<Line />);
    expect(screen.getByText('Ran pnpm build')).toHaveStyle({ color: colors.textDim });
    expect(screen.getByText('1.2s')).toHaveStyle({ color: colors.textFaint });
    expect(mockIcon).toHaveBeenCalledWith(expect.objectContaining({ sf: 'hammer.fill', color: colors.textDim }));
  });

  test('an error line turns its title and icon red', async () => {
    await render(<Line status="error" />);
    expect(screen.getByText('Ran pnpm build')).toHaveStyle({ color: colors.danger });
    expect(mockIcon).toHaveBeenCalledWith(expect.objectContaining({ sf: 'hammer.fill', color: colors.danger }));
  });

  test('a pending line is faded', async () => {
    await render(
      <TraceLine status="pending" accessibilityLabel="Run pnpm test, not started">
        <TraceTitle>Run pnpm test</TraceTitle>
      </TraceLine>,
    );
    expect(screen.getByLabelText('Run pnpm test, not started')).toHaveStyle({ opacity: 0.6 });
  });

  test('an explicit icon color wins over the tone', async () => {
    await render(
      <TraceLine status="error">
        <TraceIcon sf="checkmark.circle.fill" color={colors.success} />
        <TraceTitle>t</TraceTitle>
      </TraceLine>,
    );
    expect(mockIcon).toHaveBeenCalledWith(expect.objectContaining({ color: colors.success }));
  });

  test('a line outside a trigger draws no chevron', async () => {
    await render(<Line />);
    expect(mockIcon.mock.calls.map(([p]) => p.sf)).toEqual(['hammer.fill']);
  });

  test('a note on a line that cannot expand shows in full', async () => {
    await render(
      <TraceLine>
        <TraceTitle>t</TraceTitle>
      </TraceLine>,
    );
    await render(<TraceNote>long</TraceNote>);
    expect(screen.getByText('long').props.numberOfLines ?? 0).toBe(0);
  });

  test('a note inside a trigger clamps to two lines while closed and shows in full when open', async () => {
    await render(
      <TraceCollapsible>
        <TraceCollapsibleTrigger accessibilityLabel="x">
          <TraceLine>
            <TraceTitle>t</TraceTitle>
          </TraceLine>
          <TraceNote>long</TraceNote>
        </TraceCollapsibleTrigger>
      </TraceCollapsible>,
    );
    expect(screen.getByText('long').props.numberOfLines).toBe(2);
    await fireEvent.press(screen.getByRole('button'));
    expect(screen.getByText('long').props.numberOfLines ?? 0).toBe(0);
  });

  test('a note renders under the line', async () => {
    await render(
      <Trace>
        <TraceLine>
          <TraceTitle>Ran terminal</TraceTitle>
        </TraceLine>
        <TraceNote>Exit code 0</TraceNote>
      </Trace>,
    );
    expect(screen.getByText('Exit code 0')).toHaveStyle({ color: colors.textFaint });
  });
});

describe('running title', () => {
  function mockLoop() {
    const loop = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
    jest.spyOn(Animated, 'loop').mockReturnValue(loop);
    return loop;
  }
  // The preset's mock keeps a resolved value across tests: pin the setting off for each one.
  beforeEach(() => jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false));
  afterEach(() => jest.restoreAllMocks());

  test('pulses while running and stops when it finishes', async () => {
    const loop = mockLoop();
    const { rerender } = await render(<Line status="running" />);
    expect(loop.start).toHaveBeenCalledTimes(1);
    await rerender(<Line />);
    expect(loop.stop).toHaveBeenCalled();
  });

  test('never starts the pulse under Reduce Motion, and swaps in a static running mark', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const loop = mockLoop();
    await render(<Line status="running" />);
    await act(async () => {});
    expect(loop.start).not.toHaveBeenCalled();
    // Without the pulse, a running line would look finished: its icon says it instead.
    expect(mockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ sf: 'hourglass' }));
  });

  test('keeps its own icon while it pulses', async () => {
    mockLoop();
    await render(<Line status="running" />);
    await act(async () => {});
    expect(mockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ sf: 'hammer.fill' }));
  });

  test('follows Reduce Motion turned on mid-run, and unsubscribes on unmount', async () => {
    const listeners: ((v: boolean) => void)[] = [];
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_: string, fn: (v: boolean) => void) => {
      listeners.push(fn);
      return { remove };
    }) as never);
    const onChange = (v: boolean) => listeners.forEach((fn) => fn(v));
    const loop = mockLoop();
    const { unmount } = await render(<Line status="running" />);
    await act(async () => {});
    expect(loop.start).toHaveBeenCalledTimes(1);
    await act(async () => onChange(true));
    expect(loop.stop).toHaveBeenCalled();
    expect(mockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ sf: 'hourglass' }));
    await unmount();
    expect(remove).toHaveBeenCalledTimes(listeners.length);
  });

  test('the chevron of a running line stays a chevron under Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    mockLoop();
    await render(
      <TraceCollapsible>
        <TraceCollapsibleTrigger accessibilityLabel="x">
          <TraceLine status="running">
            <TraceIcon sf="cpu" />
            <TraceTitle>x</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
      </TraceCollapsible>,
    );
    await act(async () => {});
    const drawn = mockIcon.mock.calls.map(([p]) => p as { sf: string; size?: number });
    // The status icon turns into the hourglass; the 11pt chevron never does.
    expect(drawn.some((p) => p.sf === 'hourglass' && p.size === 14)).toBe(true);
    expect(drawn.filter((p) => p.size === 11).map((p) => p.sf)).toEqual(expect.arrayContaining(['chevron.right']));
    expect(drawn.filter((p) => p.size === 11).every((p) => p.sf === 'chevron.right')).toBe(true);
  });

  test('a finished line never starts the pulse', async () => {
    const loop = mockLoop();
    await render(<Line />);
    expect(loop.start).not.toHaveBeenCalled();
  });
});

describe('TraceCollapsible', () => {
  function Expandable(props: { defaultOpen?: boolean; open?: boolean; onOpenChange?: (o: boolean) => void }) {
    const { open, onOpenChange, defaultOpen } = props;
    const body = (
      <>
        <TraceCollapsibleTrigger accessibilityLabel={(isOpen) => `Ran node --version, ${isOpen ? 'open' : 'closed'}`}>
          <TraceLine>
            <TraceIcon sf="hammer.fill" />
            <TraceTitle>Ran node --version</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>v24.18.0</TraceCollapsibleContent>
      </>
    );
    return (
      <Trace>
        {open === undefined ? (
          <TraceCollapsible defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
            {body}
          </TraceCollapsible>
        ) : (
          <TraceCollapsible open={open} onOpenChange={onOpenChange!}>
            {body}
          </TraceCollapsible>
        )}
      </Trace>
    );
  }

  test('starts closed and toggles on tap, with the expanded state and label following', async () => {
    const onOpenChange = jest.fn();
    await render(<Expandable onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole('button', { name: 'Ran node --version, closed' });
    expect(trigger).toBeCollapsed();
    expect(screen.queryByText('v24.18.0')).toBeNull();

    await fireEvent.press(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: 'Ran node --version, open' })).toBeExpanded();
    // String content renders as muted text.
    expect(screen.getByText('v24.18.0')).toHaveStyle({ color: colors.textDim });

    await fireEvent.press(screen.getByRole('button'));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('v24.18.0')).toBeNull();
  });

  test('defaultOpen starts it open', async () => {
    await render(<Expandable defaultOpen />);
    expect(screen.getByText('v24.18.0')).toBeOnTheScreen();
  });

  test('a controlled one follows `open`, not its own taps', async () => {
    const onOpenChange = jest.fn();
    const { rerender } = await render(<Expandable open={false} onOpenChange={onOpenChange} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText('v24.18.0')).toBeNull();
    await rerender(<Expandable open onOpenChange={onOpenChange} />);
    expect(screen.getByText('v24.18.0')).toBeOnTheScreen();
  });

  test('the line inside the trigger gets a chevron, turned when open', async () => {
    await render(<Expandable />);
    expect(mockIcon.mock.calls.map(([p]) => p.sf)).toEqual(['hammer.fill', 'chevron.right']);
    const chevron = () => screen.getByTestId('trace-chevron', { includeHiddenElements: true });
    expect(chevron()).toHaveStyle({ transform: [{ rotate: '0deg' }] });
    await fireEvent.press(screen.getByRole('button'));
    expect(chevron()).toHaveStyle({ transform: [{ rotate: '90deg' }] });
  });

  test('content children that are elements render as given', async () => {
    await render(
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleContent>
          <Text>custom</Text>
        </TraceCollapsibleContent>
      </TraceCollapsible>,
    );
    expect(screen.getByText('custom')).toBeOnTheScreen();
  });

  test('a trigger outside a collapsible is a programming error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      render(
        <TraceCollapsibleTrigger accessibilityLabel="x">
          <TraceLine>
            <TraceTitle>x</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>,
      ),
    ).rejects.toThrow('TraceCollapsibleTrigger must be inside a TraceCollapsible');
    jest.restoreAllMocks();
  });
});
