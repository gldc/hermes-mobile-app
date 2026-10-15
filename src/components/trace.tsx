// src/components/trace.tsx
//
// Native port of shadcn/ui's Trace (MIT, https://ui.shadcn.com/docs/components/base/trace): one
// line shape for every step the agent takes — tool calls, reasoning, subagents, plans. A line is an
// icon, a title, an optional description and a status; it can expand into detail, and lines nest.
// Same parts and composition as upstream, rebuilt on View/Text/Pressable with the app's theme:
//
//   Trace
//   └── TraceCollapsible            (optional: open/onOpenChange or defaultOpen)
//       ├── TraceCollapsibleTrigger (button; TraceLine inside it gets the chevron)
//       │   ├── TraceLine           (TraceIcon, TraceTitle, TraceDescription)
//       │   └── TraceNote           (app addition: a muted line under the title)
//       └── TraceCollapsibleContent (left rule under the icon; strings render as muted text)
//
// Sizes follow upstream's default style: 16pt icon box, 8pt gaps, 14pt text.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutAnimation,
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Icon } from '@/components/icon';
import { useTheme } from '@/theme';

export type TraceStatus = 'running' | 'error' | 'pending';

const ICON_BOX = 16;
const GAP = 8;
const LINE_HEIGHT = 20;
/** Where a line's title starts: notes and nested detail align to it. */
const TITLE_INSET = ICON_BOX + GAP;

const LineContext = createContext<{ status?: TraceStatus }>({});
/** Set inside a TraceCollapsibleTrigger: the line draws the chevron and brightens while pressed. */
const TriggerContext = createContext<{ open: boolean; pressed: boolean } | null>(null);
const CollapsibleContext = createContext<{ open: boolean; toggle: () => void } | null>(null);

/** The color a line's text and icons take: red when it failed, brighter while its trigger is held. */
function useTone(): string {
  const { colors } = useTheme();
  const { status } = useContext(LineContext);
  const trigger = useContext(TriggerContext);
  if (status === 'error') return colors.danger;
  return trigger?.pressed ? colors.text : colors.textDim;
}

/** A list of lines. */
export function Trace({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap: GAP }, style]}>{children}</View>;
}

/**
 * One step. Plain text on its own; wrap it in a TraceCollapsibleTrigger to make it expand.
 * Status shows as color and motion only, so say it in the title or `accessibilityLabel` too.
 */
export function TraceLine({
  status,
  accessibilityLabel,
  children,
  style,
}: {
  status?: TraceStatus;
  /** Reads the line as one element with this label (otherwise its texts are read one by one). */
  accessibilityLabel?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const trigger = useContext(TriggerContext);
  return (
    <LineContext.Provider value={{ status }}>
      <View
        accessible={accessibilityLabel ? true : undefined}
        accessibilityLabel={accessibilityLabel}
        style={[
          { flexDirection: 'row', alignItems: 'flex-start', gap: GAP, flexShrink: 1, opacity: status === 'pending' ? 0.6 : 1 },
          style,
        ]}
      >
        {children}
        {trigger ? (
          // Upstream pulls the trailing icon 4pt toward the title.
          <TraceIcon
            testID="trace-chevron"
            sf="chevron.right"
            size={11}
            style={{ marginLeft: -4, transform: [{ rotate: trigger.open ? '90deg' : '0deg' }] }}
          />
        ) : null}
      </View>
    </LineContext.Provider>
  );
}

/** An SF Symbol (or a custom glyph as children) in the line's tone. Hidden from VoiceOver. */
export function TraceIcon({
  sf,
  color,
  size = 14,
  style,
  testID,
  children,
}: {
  sf?: string;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: ReactNode;
}) {
  const tone = useTone();
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: ICON_BOX, height: LINE_HEIGHT, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {sf ? <Icon sf={sf} size={size} color={color ?? tone} /> : children}
    </View>
  );
}

/** What happened, as a sentence. Truncates; pulses while the line is running. */
export function TraceTitle({
  children,
  numberOfLines = 1,
  style,
}: {
  children: ReactNode;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const tone = useTone();
  const { status } = useContext(LineContext);
  const textStyle: StyleProp<TextStyle> = [{ flexShrink: 1, color: tone, fontSize: 14, lineHeight: LINE_HEIGHT }, style];
  if (status === 'running') {
    return (
      <RunningTitle numberOfLines={numberOfLines} style={textStyle}>
        {children}
      </RunningTitle>
    );
  }
  return (
    <Text numberOfLines={numberOfLines} style={textStyle}>
      {children}
    </Text>
  );
}

/** Upstream's shimmer, as an opacity pulse (a text-clipped gradient needs a native module). Off
 * under Reduce Motion. Its own component so only running titles subscribe to the setting. */
function RunningTitle({ children, numberOfLines, style }: { children: ReactNode; numberOfLines: number; style: StyleProp<TextStyle> }) {
  const [pulse] = useState(() => new Animated.Value(1));
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (reduceMotion) return;
    const timing = (toValue: number) =>
      Animated.timing(pulse, { toValue, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([timing(0.4), timing(1)]));
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [pulse, reduceMotion]);
  return (
    <Animated.Text numberOfLines={numberOfLines} style={[style, { opacity: pulse }]}>
      {children}
    </Animated.Text>
  );
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (v) => {
        if (live) setReduce(v);
      },
      () => {},
    );
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Secondary text after the title — a duration, a count. Never truncates. */
export function TraceDescription({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={{ flexShrink: 0, color: colors.textFaint, fontSize: 13, lineHeight: LINE_HEIGHT, fontVariant: ['tabular-nums'] }}>
      {children}
    </Text>
  );
}

/** App addition: a muted line under a TraceLine, aligned with its title (an outcome, the current step). */
export function TraceNote({ children, numberOfLines = 2 }: { children: ReactNode; numberOfLines?: number }) {
  const { colors } = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={{ marginLeft: TITLE_INSET, color: colors.textFaint, fontSize: 13, lineHeight: 18 }}>
      {children}
    </Text>
  );
}

type CollapsibleProps = { children: ReactNode; defaultOpen?: boolean } & (
  | { open?: undefined; onOpenChange?: (open: boolean) => void }
  | { open: boolean; onOpenChange: (open: boolean) => void }
);

/**
 * A line that expands. Starts closed; `defaultOpen` starts it open, `open` + `onOpenChange` control
 * it. To open while a step runs and let the reader's tap win: `open={open ?? running}`.
 */
export function TraceCollapsible({ children, defaultOpen = false, open, onOpenChange }: CollapsibleProps) {
  const [own, setOwn] = useState(defaultOpen);
  const isOpen = open ?? own;
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'opacity'));
    if (open === undefined) setOwn(!isOpen);
    onOpenChange?.(!isOpen);
  };
  return (
    <CollapsibleContext.Provider value={{ open: isOpen, toggle }}>
      <View>{children}</View>
    </CollapsibleContext.Provider>
  );
}

/** The button that opens a TraceCollapsible. Full width, so the whole row is the tap target. */
export function TraceCollapsibleTrigger({
  accessibilityLabel,
  children,
}: {
  /** A string, or a function of the open state for a label that changes with it. */
  accessibilityLabel: string | ((open: boolean) => string);
  children: ReactNode;
}) {
  const collapsible = useContext(CollapsibleContext);
  if (!collapsible) throw new Error('TraceCollapsibleTrigger must be inside a TraceCollapsible');
  const { open, toggle } = collapsible;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={typeof accessibilityLabel === 'function' ? accessibilityLabel(open) : accessibilityLabel}
      accessibilityState={{ expanded: open }}
      onPress={toggle}
      hitSlop={{ left: 8, right: 8 }}
      // Taller touch target without moving the layout.
      style={{ alignSelf: 'stretch', paddingVertical: 4, marginVertical: -4, gap: 2 }}
    >
      {({ pressed }) => <TriggerContext.Provider value={{ open, pressed }}>{children}</TriggerContext.Provider>}
    </Pressable>
  );
}

/** What a TraceCollapsible shows when open, under a rule aligned with the line's icon. */
export function TraceCollapsibleContent({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const collapsible = useContext(CollapsibleContext);
  if (!collapsible?.open) return null;
  return (
    <View
      style={[
        {
          marginTop: GAP,
          marginBottom: 4,
          marginLeft: ICON_BOX / 2 - 1,
          borderLeftWidth: 1,
          borderLeftColor: colors.border,
          paddingLeft: ICON_BOX,
          paddingRight: 4,
          gap: 6,
        },
        style,
      ]}
    >
      {typeof children === 'string' ? (
        <Text style={{ color: colors.textDim, fontSize: 13.5, lineHeight: 21 }}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}
