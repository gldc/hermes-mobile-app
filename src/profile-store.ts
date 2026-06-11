// src/profile-store.ts — tiny module-state store for the active profile.
//
// `selected = null` means "follow the server's default" (no profile param is
// ever sent — the backend answers for its own launch profile, per
// docs/contracts/profiles.md). A name is stored only for an explicit
// non-default choice, persisted in SecureStore so it survives restarts.
//
// Pure state transitions are exported for unit tests; SecureStore I/O is
// injectable for the same reason.
import * as SecureStore from 'expo-secure-store';

export const ACTIVE_PROFILE_KEY = 'hermes-active-profile';

export interface ProfileStoreState {
  /** Explicit user choice; null = follow the server's default profile. */
  selected: string | null;
  /** Profile the running backend is scoped to (GET /api/profiles/active → current). */
  serverCurrent: string | null;
  /** Known profile names, in server order. Pill UI hides unless length > 1. */
  names: string[];
  /** True once the persisted selection has been read back. */
  hydrated: boolean;
}

export interface ProfilePersistence {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const securePersistence: ProfilePersistence = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  del: (k) => SecureStore.deleteItemAsync(k),
};

const initialState: ProfileStoreState = {
  selected: null,
  serverCurrent: null,
  names: [],
  hydrated: false,
};

let state: ProfileStoreState = initialState;
const listeners = new Set<() => void>();

function emit(next: ProfileStoreState): void {
  state = next;
  for (const l of [...listeners]) l();
}

export function getProfileState(): ProfileStoreState {
  return state;
}

export function subscribeProfiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Pure transitions (unit-tested)

/** Picking the backend's own profile normalises to null — "follow default" —
 * so the canonical un-parameterised endpoints stay in use for it. */
export function normalizeSelection(name: string | null, serverCurrent: string | null): string | null {
  if (!name) return null;
  return name === serverCurrent ? null : name;
}

/** Fold a fresh server profile list into the state. A stale selection (its
 * profile no longer exists) falls back to the server default. */
export function reduceServerProfiles(
  prev: ProfileStoreState,
  names: string[],
  serverCurrent: string | null,
): ProfileStoreState {
  const selected =
    prev.selected && names.length > 0 && !names.includes(prev.selected)
      ? null
      : normalizeSelection(prev.selected, serverCurrent);
  return { ...prev, names, serverCurrent, selected };
}

/** Name shown on the pill: explicit choice, else whatever the backend runs as. */
export function activeProfileLabel(s: ProfileStoreState = state): string {
  return s.selected ?? s.serverCurrent ?? 'default';
}

/** Server FTS (GET /api/sessions/search) has no profile param — it only
 * answers for the backend's own profile, so suppress it for other targets. */
export function canServerSearch(s: ProfileStoreState = state): boolean {
  return s.selected === null || s.selected === s.serverCurrent;
}

// ---------------------------------------------------------------------------
// Actions

let hydration: Promise<void> | null = null;

/** Read the persisted selection (idempotent; safe to call from any screen). */
export function hydrateProfileStore(p: ProfilePersistence = securePersistence): Promise<void> {
  if (!hydration) {
    hydration = (async () => {
      let stored: string | null = null;
      try {
        stored = await p.get(ACTIVE_PROFILE_KEY);
      } catch {
        // unreadable keychain entry — fall back to the server default
      }
      emit({ ...state, selected: stored || null, hydrated: true });
    })();
  }
  return hydration;
}

/** Choose a profile (null = follow server default). Persists the choice. */
export async function setSelectedProfile(
  name: string | null,
  p: ProfilePersistence = securePersistence,
): Promise<void> {
  const selected = normalizeSelection(name, state.serverCurrent);
  emit({ ...state, selected });
  try {
    if (selected) await p.set(ACTIVE_PROFILE_KEY, selected);
    else await p.del(ACTIVE_PROFILE_KEY);
  } catch {
    // persistence is best-effort; in-memory state already updated
  }
}

/** Record the server's profile list + the backend's own profile. */
export function setServerProfiles(names: string[], serverCurrent: string | null): void {
  emit(reduceServerProfiles(state, names, serverCurrent));
}

/** Profile to thread into REST/gateway calls; undefined = omit the param. */
export function selectedProfileParam(): string | undefined {
  return state.selected ?? undefined;
}

/** Test-only: reset module state between cases. */
export function __resetProfileStore(): void {
  state = initialState;
  listeners.clear();
  hydration = null;
}
