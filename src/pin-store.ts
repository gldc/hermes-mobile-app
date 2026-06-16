import * as SecureStore from 'expo-secure-store';

export const PINNED_SESSIONS_KEY = 'hermes-pinned-sessions';
export const PINNED_COLLAPSED_KEY = 'hermes-pinned-collapsed';

export interface PinStoreState {
  ids: string[];
  collapsed: boolean;
  hydrated: boolean;
}

export interface PinPersistence {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const securePersistence: PinPersistence = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  del: (k) => SecureStore.deleteItemAsync(k),
};

const initialState: PinStoreState = { ids: [], collapsed: false, hydrated: false };
let state: PinStoreState = initialState;
const listeners = new Set<() => void>();

function emit(next: PinStoreState): void {
  state = next;
  for (const l of [...listeners]) l();
}

export function getPinState(): PinStoreState { return state; }
export function subscribePins(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isPinned(pinId: string): boolean {
  return state.ids.includes(pinId);
}

export function pinSession(pinId: string): void {
  if (state.ids.includes(pinId)) return;
  const next = { ...state, ids: [...state.ids, pinId] };
  emit(next);
  persistIds(next.ids);
}

export function unpinSession(pinId: string): void {
  const ids = state.ids.filter((id) => id !== pinId);
  if (ids.length === state.ids.length) return;
  const next = { ...state, ids };
  emit(next);
  persistIds(ids);
}

export function setPinsCollapsed(collapsed: boolean): void {
  if (state.collapsed === collapsed) return;
  emit({ ...state, collapsed });
  persistCollapsed(collapsed);
}

function persistIds(ids: string[]): void {
  securePersistence.set(PINNED_SESSIONS_KEY, JSON.stringify(ids)).catch(() => {});
}

function persistCollapsed(collapsed: boolean): void {
  securePersistence.set(PINNED_COLLAPSED_KEY, JSON.stringify(collapsed)).catch(() => {});
}

let hydration: Promise<void> | null = null;

export function hydratePinStore(p: PinPersistence = securePersistence): Promise<void> {
  if (!hydration) {
    hydration = (async () => {
      let ids: string[] = [];
      let collapsed = false;
      try {
        const raw = await p.get(PINNED_SESSIONS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) ids = parsed.filter((x: unknown) => typeof x === 'string');
        }
      } catch { /* corrupt */ }
      try {
        const raw = await p.get(PINNED_COLLAPSED_KEY);
        if (raw) collapsed = JSON.parse(raw) === true;
      } catch { /* corrupt */ }
      emit({ ids, collapsed, hydrated: true });
    })();
  }
  return hydration;
}

export function __resetPinStore(): void {
  state = initialState;
  listeners.clear();
  hydration = null;
}
