// src/components/subagent-monitor-card.tsx
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
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
} from '@/components/trace';
import type { SubagentBatch, SubagentState } from '@/lib/subagent-progress';
import { useTheme } from '@/theme';

function fmtElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const STATUS_WORD = {
  running: 'running',
  completed: 'done',
  failed: 'failed',
  timeout: 'timed out',
  stopped: 'stopped',
} as const;

function SubagentLine({ s, now }: { s: SubagentState; now: number }) {
  const { colors } = useTheme();
  const running = s.status === 'running';
  const errored = s.status === 'failed' || s.status === 'timeout';
  const elapsed = running ? (now - s.startedAtMs) / 1000 : s.durationSeconds;
  const tokens = running ? 0 : (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
  // Hoisted out of the `sf={…}` attribute so the icon-map usage scanner doesn't
  // mistake a status comparison for an icon name. Stopped is neutral, not a failure.
  const glyph = errored ? 'xmark.circle.fill' : s.status === 'stopped' ? 'stop.circle.fill' : 'cpu';
  // The note prefers the completion summary once finished, else the latest step.
  const headline = !running && s.summary ? s.summary : s.activity;
  const meta = [elapsed !== undefined ? fmtElapsed(elapsed) : '', tokens > 0 ? `${Math.round(tokens / 1000)}k` : '']
    .filter(Boolean)
    .join(' · ');
  const fileCount = (s.filesRead?.length ?? 0) + (s.filesWritten?.length ?? 0);
  const footer = [s.model, fileCount > 0 ? `${fileCount} file${fileCount === 1 ? '' : 's'}` : '']
    .filter(Boolean)
    .join(' · ');
  const goal = s.goal || 'subagent';
  const label = `Subagent ${goal}, ${STATUS_WORD[s.status]}${headline ? `, ${headline}` : ''}`;

  const finishedSummary = !running && s.summary ? s.summary : '';
  const expandable = s.log.length > 0 || Boolean(footer) || Boolean(finishedSummary);
  // Closed: the latest step or the summary on one line. Open: the step log, summary and footer.
  const [open, setOpen] = useState(false);

  const head = (
    <>
      <TraceLine status={running ? 'running' : errored ? 'error' : undefined}>
        <TraceIcon sf={glyph} />
        <TraceTitle>{goal}</TraceTitle>
        {meta ? <TraceDescription>{meta}</TraceDescription> : null}
      </TraceLine>
      {headline && !open ? (
        <TraceNote numberOfLines={1}>
          {headline}
          {s.toolCount ? ` · ${s.toolCount} tools` : ''}
        </TraceNote>
      ) : null}
    </>
  );

  if (!expandable) {
    return (
      <View accessible accessibilityLabel={label} style={{ gap: 2 }}>
        {head}
      </View>
    );
  }
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger accessibilityLabel={`${label}, tap to ${open ? 'collapse' : 'expand'}`}>{head}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        {s.log.map((line, i) => (
          <Text key={`${i}:${line.slice(0, 12)}`} numberOfLines={2} style={{ color: colors.textFaint, fontSize: 12.5, lineHeight: 18 }}>
            {line}
          </Text>
        ))}
        {finishedSummary ? <Text style={{ color: colors.textDim, fontSize: 13, lineHeight: 19 }}>{finishedSummary}</Text> : null}
        {footer ? <Text style={{ color: colors.textFaint, fontSize: 12 }}>{footer}</Text> : null}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** A delegation batch: one line that opens while its subagents run or when one failed (a tap wins),
 * and a line per subagent inside it that expands into its step log. A failure turns the batch red. */
export function SubagentMonitorCard({ batch }: { batch: SubagentBatch }) {
  const [open, setOpen] = useState<boolean>();
  const running = batch.subagents.some((s) => s.status === 'running');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const runningCount = batch.subagents.filter((s) => s.status === 'running').length;
  const failedCount = batch.subagents.filter((s) => s.status === 'failed' || s.status === 'timeout').length;
  const doneCount = batch.subagents.length - runningCount - failedCount;
  const counts = [running ? `${runningCount} running` : `${doneCount} done`, failedCount ? `${failedCount} failed` : ''].filter(Boolean);
  const header = counts.join(' · ');
  const totalCost = batch.subagents.reduce((acc, s) => acc + (s.costUsd ?? 0), 0);
  const cost = !running && totalCost > 0 ? ` · ~$${totalCost.toFixed(2)}` : '';

  return (
    <View style={{ paddingVertical: 4 }}>
      <Trace>
        <TraceCollapsible open={open ?? (running || failedCount > 0)} onOpenChange={setOpen}>
          <TraceCollapsibleTrigger accessibilityLabel={(isOpen) => `Subagents, ${counts.join(', ')}, tap to ${isOpen ? 'collapse' : 'expand'}`}>
            <TraceLine status={running ? 'running' : failedCount > 0 ? 'error' : undefined}>
              <TraceIcon sf="square.grid.2x2" />
              <TraceTitle>Subagents</TraceTitle>
              <TraceDescription>
                {header}
                {cost}
              </TraceDescription>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <Trace>
              {batch.subagents.map((s) => (
                <SubagentLine key={s.key} s={s} now={now} />
              ))}
            </Trace>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    </View>
  );
}
