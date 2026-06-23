// src/lib/model-pill.ts
//
// Which model the composer pill shows, and the raw id behind it. The running
// chat's own model (session.create/resume + the session.info event) wins once
// known; the gateway default (GET /api/model/info) is only a fallback for a
// brand-new lazy chat before its first prompt builds the agent. State stores
// RAW model ids; the display name is derived in pillLabel().
import { modelDisplayName } from '@/api/models';

export interface ModelPillState {
  /** Raw id of the running session's model, once known. */
  session: string | null;
  /** Raw id of the gateway default — fallback before the session model is known. */
  fallback: string | null;
}

export function emptyModelPill(): ModelPillState {
  return { session: null, fallback: null };
}

const clean = (modelId: string | null | undefined): string | null => modelId || null;

/** Set the session's model (session.create / session.resume / session.info). */
export function withSessionModel(s: ModelPillState, modelId: string | null | undefined): ModelPillState {
  return { ...s, session: clean(modelId) };
}

/** Set the gateway-default fallback (GET /api/model/info). */
export function withFallbackModel(s: ModelPillState, modelId: string | null | undefined): ModelPillState {
  return { ...s, fallback: clean(modelId) };
}

/** Adopt a session-model report from session.create / session.resume — but
 * ONLY when the gateway actually built the agent. A `lazy` resume/create
 * reports the gateway DEFAULT (not the chat's own model), and an info-less
 * resume omits the model entirely; in both cases keep the model we already
 * know rather than clobber the session slot back to the default. */
export function withResumedModel(
  s: ModelPillState,
  info: { model?: string; lazy?: boolean } | undefined,
): ModelPillState {
  if (!info?.model || info.lazy) return s; // lazy / absent → nothing real to adopt
  return withSessionModel(s, info.model);
}

/** Raw id the pill represents: the session's own model once known, else the default. */
export function pillModelId(s: ModelPillState): string | null {
  return s.session ?? s.fallback;
}

/** The pill label (display name), or null when nothing is known. */
export function pillLabel(s: ModelPillState): string | null {
  const id = pillModelId(s);
  return id ? modelDisplayName(id) : null;
}
