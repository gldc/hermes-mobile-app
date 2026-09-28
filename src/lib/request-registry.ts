// src/lib/request-registry.ts — live ServerRequest objects by id (contract §4). The reducer
// holds data only; the respond/fail closures live here. Never stores a result value.
import type { ServerRequest } from '@/vendor/hermes-gateway';

export interface RequestRegistry {
  put(req: ServerRequest): void;
  respond(id: string, result: Record<string, unknown>): boolean;
  fail(id: string, code: number, message: string): boolean;
  drop(id: string): void;
}

export function createRequestRegistry(): RequestRegistry {
  const live = new Map<string, ServerRequest>();
  return {
    put(req) {
      live.set(req.id, req); // a replay re-delivers the same id: latest delivery wins
    },
    respond(id, result) {
      const req = live.get(id);
      if (!req) return false;
      live.delete(id);
      req.respond(result);
      return true;
    },
    fail(id, code, message) {
      const req = live.get(id);
      if (!req) return false;
      live.delete(id);
      req.fail(code, message);
      return true;
    },
    drop(id) {
      live.delete(id);
    },
  };
}
