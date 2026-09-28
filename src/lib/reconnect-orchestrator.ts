// src/lib/reconnect-orchestrator.ts — the single-flight reconnect sequence (spec §7, contract §5).
// Extracted from chat/[id].tsx (PR #22 hardening) and injected, so it is unit-testable.
//
// Sequence per attempt:
//   1. client.connect(fresh ticket URL) — the adapter invalidates the old generation first and
//      resolves only after gateway.ready (+1 tick), so capabilities precede resume.
//   2. session.resume (open_requests are routed into cards by the channel before it resolves;
//      running/status/inflight seed the turn state).
//   3. history replace (cards live outside items, so they survive).
//   4. in-flight replay via session.events.since, from the turn anchor (fallback: the highest
//      seq seen) so a running turn's whole unpersisted text returns after the history replace;
//      apply only events after the batch's last message.complete; skip on truncated / no anchor.
//   5. live events that arrived during 2–4 were parked; flush them in seq order, deduped.
import type { GatewayClient } from '@/api/gatewayClient';
import type { GatewayEvent, RpcMethods } from '@/vendor/hermes-gateway';
import { backoffMs, MAX_RECONNECT_ATTEMPTS } from './reconnect';
import { resumeRunning, type TurnAction } from './turn-controller';

type ResumeResult = RpcMethods['session.resume']['result'];

export type ReconnectTrigger = 'close' | 'heartbeat' | 'foreground' | 'stop-timeout';

export type ReconnectPhase =
  | { kind: 'attempt'; attempt: number; max: number }
  | { kind: 'ready' }
  | { kind: 'failed' };

export interface OrchestratorDeps {
  client: Pick<GatewayClient, 'connect' | 'invalidate' | 'call' | 'isOpen'>;
  mintUrl: () => Promise<string>;
  storedSessionId: () => string | null;
  resumeParams: () => RpcMethods['session.resume']['params'];
  loadHistory: (storedId: string) => Promise<void>;
  dispatch: (a: TurnAction) => void;
  /** The ONE event sink (live and replayed). Replayed events arrive with `replayed: true`. */
  applyReplayedEvent: (e: GatewayEvent) => void;
  onLiveSessionId: (liveId: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** Additive (see plan "Contract deviations"): the full resume result (model pill, claim). */
  onResumed?: (res: ResumeResult) => void;
  /** Additive: progress for the reconnect note / error line / ready flag. */
  onPhase?: (p: ReconnectPhase) => void;
}

export interface ReconnectOrchestrator {
  reconnect(trigger: ReconnectTrigger): Promise<void>;
  /** Additive: the initial connect — one attempt, no backoff, same single-flight slot. Rejects on failure. */
  start(): Promise<void>;
  onLiveEvent(e: GatewayEvent): void;
  noteSeq(sessionId: string, seq: number): void;
  dispose(): void;
}

function seqOf(e: GatewayEvent): number | null {
  return typeof e.seq === 'number' && Number.isFinite(e.seq) ? e.seq : null;
}

/**
 * Applies one `session.resume` result: seeds the live session id, forwards the full result
 * (model pill, claim), and dispatches the turn-model seed. One implementation of this rule
 * (contract §8) — `runSequence` below and Task 6's transport both call it. Returns whether a
 * turn is running, per `resumeRunning`.
 */
export function seedFromResume(
  res: ResumeResult,
  sink: Pick<OrchestratorDeps, 'onLiveSessionId' | 'onResumed' | 'dispatch'>,
): boolean {
  sink.onLiveSessionId(res.session_id);
  sink.onResumed?.(res);
  const running = resumeRunning(res);
  sink.dispatch({ type: 'resume.seeded', running });
  return running;
}

export function createReconnectOrchestrator(deps: OrchestratorDeps): ReconnectOrchestrator {
  const watermarks = new Map<string, number>();
  // Decision 2026-09-28 (option b): per-session turn anchor = seq just before the current turn.
  // Replaying from it while a turn runs restores the pre-drop streamed text that the history
  // replace removed; the "apply only after the batch's last message.complete" rule dedupes.
  const turnAnchors = new Map<string, number>();
  let epoch: string | null = null;
  let inflight: Promise<void> | null = null;
  let parked: GatewayEvent[] | null = null;
  let disposed = false;

  function noteSeq(sessionId: string, seq: number): void {
    if ((watermarks.get(sessionId) ?? 0) < seq) watermarks.set(sessionId, seq);
  }

  function noteTurnAnchor(e: GatewayEvent, s: number | null): void {
    if (!e.session_id || s === null) return;
    if (e.type === 'message.complete') turnAnchors.set(e.session_id, s);
    else if (e.type === 'message.start') {
      const prev = turnAnchors.get(e.session_id);
      if (prev === undefined || prev < s - 1) turnAnchors.set(e.session_id, s - 1);
    }
  }

  function applyLive(e: GatewayEvent): void {
    const s = seqOf(e);
    if (e.session_id && s !== null) noteSeq(e.session_id, s);
    noteTurnAnchor(e, s);
    deps.applyReplayedEvent(e);
  }

  // Backend restart: seq counters reset, old watermarks/anchors describe a numbering that no
  // longer exists. One implementation (contract §8) — used by adoptEpoch and replay()'s epoch
  // mismatch branch below.
  function resetWatermarks(): void {
    watermarks.clear();
    turnAnchors.clear();
  }

  function adoptEpoch(e: GatewayEvent): void {
    const next = (e.payload as { replay_epoch?: unknown } | undefined)?.replay_epoch;
    if (typeof next !== 'string' || !next) return;
    if (epoch !== null && epoch !== next) resetWatermarks();
    epoch = next;
  }

  async function replay(liveId: string): Promise<void> {
    // Prefer the turn anchor so the whole unpersisted turn is re-applied after the history replace;
    // fall back to the highest seq seen (joined mid-turn: only the gap is recoverable).
    const last = turnAnchors.get(liveId) ?? watermarks.get(liveId);
    if (last === undefined) return; // cold start / fresh screen: nothing to anchor a replay on
    // P1: snapshot the watermark BEFORE this batch touches it, so we can tell which events in
    // the batch were already applied live (as opposed to events from a gap the reconnect missed).
    const seenBefore = watermarks.get(liveId) ?? 0;
    let res: RpcMethods['session.events.since']['result'];
    try {
      res = await deps.client.call('session.events.since', { session_id: liveId, last_seen: last });
    } catch {
      return; // 0.20.4 (-32601) or a transient failure: the live stream carries on
    }
    if (res.truncated) return;
    if (epoch !== null && res.epoch && res.epoch !== epoch) {
      resetWatermarks();
      epoch = res.epoch;
      return;
    }
    const events = (Array.isArray(res.events) ? res.events : []) as unknown as GatewayEvent[];
    let lastComplete = -1;
    events.forEach((e, i) => {
      if (e?.type === 'message.complete') lastComplete = i;
    });
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const s = seqOf(e);
      if (s !== null) noteSeq(liveId, s); // history covers everything up to the last complete
      if (e?.type) noteTurnAnchor({ ...e, session_id: e.session_id ?? liveId }, s);
      if (i > lastComplete && e?.type) {
        // P1: a message.start already applied live (seq <= seenBefore) must not be replayed —
        // the reducer maps message.start to `streaming` from any state, which would incorrectly
        // clear a `stopping` turn (spec §5.1: stopping lasts until message.complete). A
        // message.start for a NEW turn that started in the gap (seq > seenBefore) still applies.
        if (e.type === 'message.start' && s !== null && s <= seenBefore) continue;
        deps.applyReplayedEvent({ ...e, replayed: true });
      }
    }
  }

  function flushParked(): void {
    const batch = parked ?? [];
    parked = null;
    const ordered = batch
      .map((e, i) => ({ e, i }))
      .sort((a, b) => {
        const sa = seqOf(a.e);
        const sb = seqOf(b.e);
        return sa !== null && sb !== null && a.e.session_id === b.e.session_id ? sa - sb : a.i - b.i;
      });
    for (const { e } of ordered) {
      const s = seqOf(e);
      if (e.session_id && s !== null && s <= (watermarks.get(e.session_id) ?? 0)) continue; // replayed already
      applyLive(e);
    }
  }

  async function runSequence(): Promise<void> {
    parked = [];
    try {
      deps.client.invalidate(); // drop the old generation FIRST: its late frames/close are inert
      const url = await deps.mintUrl();
      if (disposed) return;
      await deps.client.connect(url);
      if (disposed) return;
      const storedId = deps.storedSessionId();
      if (storedId) {
        const res = await deps.client.call('session.resume', deps.resumeParams());
        if (disposed) return;
        const running = seedFromResume(res, deps);
        await deps.loadHistory(storedId);
        if (disposed) return;
        if (running) await replay(res.session_id);
        if (disposed) return;
      }
      // Fix round 1: a trigger that JOINS this run (singleFlight) after session.resume must not
      // resolve `ready` on a socket that died in the meantime. loadHistory is a REST call and a
      // replay RPC failure is deliberately swallowed (0.20.4 -32601 compat), so neither one
      // notices a closed socket — nothing else touches the socket again before flushParked().
      // Fail the attempt here so the retry loop redials (spec §7: one single-flight sequence per
      // reconnect trigger; a joined trigger must not be silently dropped on a dead connection).
      if (!deps.client.isOpen) throw new Error('socket lost during reconnect');
      flushParked();
    } catch (e) {
      parked = null; // this generation's parked frames die with it; the next attempt re-resumes
      throw e;
    }
  }

  function singleFlight(body: () => Promise<void>): Promise<void> {
    if (disposed) return Promise.resolve();
    if (inflight) return inflight;
    const run = body().finally(() => {
      if (inflight === run) inflight = null;
    });
    inflight = run;
    return run;
  }

  return {
    reconnect(_trigger) {
      return singleFlight(async () => {
        deps.dispatch({ type: 'socket.lost' });
        for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
          if (disposed) return;
          deps.onPhase?.({ kind: 'attempt', attempt, max: MAX_RECONNECT_ATTEMPTS });
          await deps.sleep(backoffMs(attempt));
          if (disposed) return;
          try {
            await runSequence();
            if (!disposed) deps.onPhase?.({ kind: 'ready' });
            return;
          } catch {
            // next attempt, longer backoff
          }
        }
        if (!disposed) deps.onPhase?.({ kind: 'failed' });
      });
    },
    start() {
      return singleFlight(async () => {
        await runSequence();
        if (!disposed) deps.onPhase?.({ kind: 'ready' });
      });
    },
    onLiveEvent(e) {
      if (e.type === 'gateway.ready') adoptEpoch(e);
      if (parked) {
        parked.push(e);
        return;
      }
      applyLive(e);
    },
    noteSeq,
    dispose() {
      disposed = true;
      parked = null;
    },
  };
}
