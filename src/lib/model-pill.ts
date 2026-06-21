// src/lib/model-pill.ts
//
// Which model the composer pill shows. The running chat's own model (from
// session.create/resume and the session.info event) wins once known; the
// gateway default (GET /api/model/info) is only a fallback for a brand-new
// lazy chat before its first prompt builds the agent.
import { modelDisplayName } from '@/api/models';

export interface ModelPillState {
  /** Display name of the running session's model, once known. */
  session: string | null;
  /** Display name of the gateway default — fallback before the session model is known. */
  fallback: string | null;
}

export function emptyModelPill(): ModelPillState {
  return { session: null, fallback: null };
}

const toName = (modelId: string | null | undefined): string | null =>
  modelId ? modelDisplayName(modelId) : null;

/** Set the session's model (session.create / session.resume / session.info). */
export function withSessionModel(s: ModelPillState, modelId: string | null | undefined): ModelPillState {
  return { ...s, session: toName(modelId) };
}

/** Set the gateway-default fallback (GET /api/model/info). */
export function withFallbackModel(s: ModelPillState, modelId: string | null | undefined): ModelPillState {
  return { ...s, fallback: toName(modelId) };
}

/** The pill label: the session's own model wins once known, else the default. */
export function pillLabel(s: ModelPillState): string | null {
  return s.session ?? s.fallback;
}
