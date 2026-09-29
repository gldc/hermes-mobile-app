// src/lib/reconnect-orchestrator.ts — the single-flight reconnect sequence (spec §7, contract §5).
// Extracted from chat/[id].tsx (PR #22 hardening) and injected, so it is unit-testable.
//
// Sequence per attempt:
//   1. client.connect(fresh ticket URL) — the adapter invalidates the old generation first and
//      resolves only after gateway.ready (+1 tick), so capabilities precede resume.
//   2. session.resume (open_requests are routed into cards by the channel before it resolves;
//      running/status/inflight seed the turn state).
//   3. history replace (cards live outside items, so they survive). start({historyLoaded:true})
//      skips it on the initial run: the screen's first paint already loaded it (review I1).
//   4. in-flight replay via session.events.since, from the turn anchor (fallback: the highest
//      seq seen) so a running turn's whole unpersisted text returns after the history replace;
//      apply only events after the batch's last message.complete. A running turn probes the
//      anchor BEFORE step 3: when the ring no longer reaches it (truncated), only the gap after
//      the watermark is replayed, and step 3 is skipped unless a turn ended in the gap (A1;
//      see historyAndReplay).
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

export interface StartOptions {
  /** The screen already painted this session's history (first paint, before the socket): the
   * initial run skips its history replace so the transcript is not fetched and re-keyed twice
   * (review I1). Reconnect runs always load history. */
  historyLoaded?: boolean;
}

export interface ReconnectOrchestrator {
  reconnect(trigger: ReconnectTrigger): Promise<void>;
  /** Additive: the initial connect — one attempt, no backoff, same single-flight slot. Rejects on failure. */
  start(opts?: StartOptions): Promise<void>;
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
  // The channel re-delivered these as cards before the resume resolved: they stay open (I2).
  const openRequestIds = Array.isArray(res.open_requests) ? res.open_requests.map((r) => r.id) : undefined;
  sink.dispatch({ type: 'resume.seeded', running, openRequestIds });
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

  type SinceResult = RpcMethods['session.events.since']['result'];

  /** One `session.events.since`. null on failure (0.20.4 -32601 / transient: the live stream
   * carries on) or when the backend restarted (epoch changed: the old seqs mean nothing). */
  async function eventsSince(liveId: string, lastSeen: number): Promise<SinceResult | null> {
    let res: SinceResult | undefined;
    try {
      res = await deps.client.call('session.events.since', { session_id: liveId, last_seen: lastSeen });
    } catch {
      return null;
    }
    if (!res) return null;
    if (epoch !== null && res.epoch && res.epoch !== epoch) {
      resetWatermarks();
      epoch = res.epoch;
      return null;
    }
    return res;
  }

  function eventsOf(res: SinceResult): GatewayEvent[] {
    return (Array.isArray(res.events) ? res.events : []) as unknown as GatewayEvent[];
  }

  function hasComplete(res: SinceResult): boolean {
    return eventsOf(res).some((e) => e?.type === 'message.complete');
  }

  /**
   * Steps 3–4 for a RUNNING turn. The anchor replay is only safe to pair with the history
   * replace when the ring buffer still reaches back to the anchor; a long turn outgrows it
   * (A1: 512 events, reasoning-heavy turns run ~1750), and the replace would then remove the
   * unpersisted row with nothing to restore it. So probe the anchor first:
   * - not truncated → history replace, then the anchor replay, re-fetched AFTER history so a
   *   turn that finishes in between is not duplicated. If the ring moved past the anchor while
   *   history loaded, the probe still holds the turn: apply it, then only what followed it.
   * - truncated → replay only the gap after the watermark. With no turn boundary in the gap the
   *   screen is kept as is (it is exact up to the watermark). A message.complete in the gap means
   *   that turn is persisted, so the history replace loses nothing: replace, then apply what
   *   follows the last complete (a turn started from another device keeps its prompt row).
   * - the gap is truncated too, or fails → the history replace alone (the old behaviour).
   */
  async function historyAndReplay(storedId: string, liveId: string, skipHistory: boolean): Promise<void> {
    // Prefer the turn anchor so the whole unpersisted turn is re-applied after the history replace;
    // fall back to the highest seq seen (joined mid-turn: only the gap is recoverable).
    const anchor = turnAnchors.get(liveId) ?? watermarks.get(liveId);
    // P1: snapshot the watermark BEFORE any batch touches it, so we can tell which events in
    // the batch were already applied live (as opposed to events from a gap the reconnect missed).
    const seenBefore = watermarks.get(liveId) ?? 0;
    const loadHistory = async () => {
      if (!skipHistory) await deps.loadHistory(storedId);
    };
    if (anchor === undefined) return loadHistory(); // cold start / fresh screen: nothing to anchor on

    const probe = await eventsSince(liveId, anchor);
    if (disposed) return;
    if (probe?.truncated && seenBefore > anchor) {
      const gap = await eventsSince(liveId, seenBefore);
      if (disposed) return;
      if (gap && !gap.truncated) {
        if (!hasComplete(gap)) return applyGap(liveId, gap, seenBefore);
        await loadHistory();
        if (disposed) return;
        // Re-fetched AFTER history, like the anchor replay: a turn that finished during the
        // history read is then covered by its own complete instead of drawn twice.
        const fresh = await eventsSince(liveId, seenBefore);
        if (disposed) return;
        return applyAfterLastComplete(liveId, fresh && !fresh.truncated ? fresh : gap, seenBefore);
      }
    }
    await loadHistory();
    if (disposed || !probe || probe.truncated) return;
    const res = await eventsSince(liveId, anchor);
    if (disposed || res === null) return;
    if (!res.truncated) return applyAfterLastComplete(liveId, res, seenBefore);
    // The ring moved past the anchor while history loaded. What followed the probe decides:
    const after = Math.max(seenBefore, maxSeq(probe));
    const tail = await eventsSince(liveId, after);
    if (disposed) return;
    if (tail && !tail.truncated && hasComplete(tail)) {
      // the turn finished meanwhile, so history may already hold it: reload, apply what follows
      await loadHistory();
      if (disposed) return;
      return applyAfterLastComplete(liveId, tail, seenBefore);
    }
    applyAfterLastComplete(liveId, probe, seenBefore); // still running: the probe holds the turn
    if (tail && !tail.truncated) applyGap(liveId, tail, after);
  }

  function maxSeq(res: SinceResult): number {
    return eventsOf(res).reduce((m, e) => Math.max(m, seqOf(e) ?? 0), 0);
  }

  /** Truncated path: the screen was not replaced, so every event after the watermark is new. */
  function applyGap(liveId: string, res: SinceResult, seenBefore: number): void {
    for (const e of eventsOf(res)) {
      const s = seqOf(e);
      if (!e?.type || s === null || s <= seenBefore) continue;
      noteSeq(liveId, s);
      noteTurnAnchor({ ...e, session_id: e.session_id ?? liveId }, s);
      deps.applyReplayedEvent({ ...e, replayed: true });
    }
  }

  function applyAfterLastComplete(liveId: string, res: SinceResult, seenBefore: number): void {
    const events = eventsOf(res);
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

  async function runSequence(skipHistory = false): Promise<void> {
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
        if (running) await historyAndReplay(storedId, res.session_id, skipHistory);
        else if (!skipHistory) await deps.loadHistory(storedId);
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
    // Claim the slot BEFORE the body runs (review M2): start()'s synchronous client.invalidate()
    // can fire onState('closed') → reconnect('close') re-entrantly, which must join this run.
    const run = Promise.resolve()
      .then(body)
      .finally(() => {
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
    start(opts) {
      return singleFlight(async () => {
        await runSequence(opts?.historyLoaded === true);
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
