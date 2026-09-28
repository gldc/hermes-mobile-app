// src/lib/turn-store.ts — the turn model held OUTSIDE React (spec §4.2: the request handler
// enqueues here even before any chat UI state exists). Screens subscribe via `store.subscribe`
// and read `store.getState()`.
import { initialTurnModel, reduceTurn, type TurnAction, type TurnModel } from './turn-controller';

export interface TurnStore {
  getState(): TurnModel;
  dispatch(action: TurnAction): void;
  subscribe(listener: () => void): () => void;
}

export function createTurnStore(initial: TurnModel = initialTurnModel()): TurnStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reduceTurn(state, action);
      if (next === state) return;
      state = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
