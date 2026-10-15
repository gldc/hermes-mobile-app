// src/components/todo-card.tsx
import { View } from 'react-native';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/trace';
import type { TodoItem } from '@/lib/todo';
import { useTheme } from '@/theme';

type Colors = ReturnType<typeof useTheme>['colors'];

const STATUS_WORD: Record<TodoItem['status'], string> = {
  pending: 'not started',
  in_progress: 'in progress',
  completed: 'done',
  cancelled: 'cancelled',
};

function TodoGlyph({ status, colors }: { status: TodoItem['status']; colors: Colors }) {
  if (status === 'completed') return <TraceIcon sf="checkmark.circle.fill" color={colors.success} />;
  const ring = { width: 13, height: 13, borderRadius: 7, borderCurve: 'continuous' as const };
  return (
    <TraceIcon>
      {status === 'in_progress' ? (
        <View style={[ring, { borderWidth: 3.5, borderColor: colors.accent }]} />
      ) : (
        <View style={[ring, { borderWidth: 1.5, borderColor: status === 'cancelled' ? colors.textFaint : colors.textDim }]} />
      )}
    </TraceIcon>
  );
}

/** The agent's plan: one line with the done count that opens into a line per step. Starts open. */
export function TodoCard({ items }: { items: TodoItem[] }) {
  const { colors } = useTheme();
  const done = items.filter((t) => t.status === 'completed').length;
  return (
    <View style={{ paddingVertical: 4 }}>
      <Trace>
        <TraceCollapsible defaultOpen>
          <TraceCollapsibleTrigger accessibilityLabel={(open) => `Plan, ${done} of ${items.length} done, tap to ${open ? 'collapse' : 'expand'}`}>
            <TraceLine>
              <TraceIcon sf="checklist" />
              <TraceTitle>Plan</TraceTitle>
              <TraceDescription>
                {done}/{items.length}
              </TraceDescription>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <Trace>
              {items.map((t) => (
                <TraceLine
                  key={t.id}
                  status={t.status === 'pending' ? 'pending' : undefined}
                  accessibilityLabel={`${t.content}, ${STATUS_WORD[t.status]}`}
                >
                  <TodoGlyph status={t.status} colors={colors} />
                  <TraceTitle
                    numberOfLines={3}
                    style={
                      t.status === 'in_progress'
                        ? { color: colors.text }
                        : t.status === 'cancelled'
                          ? { color: colors.textFaint, textDecorationLine: 'line-through' }
                          : undefined
                    }
                  >
                    {t.content}
                  </TraceTitle>
                </TraceLine>
              ))}
            </Trace>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    </View>
  );
}
