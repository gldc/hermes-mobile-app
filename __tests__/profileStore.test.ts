// __tests__/profileStore.test.ts — module-state store for the active profile.
// All persistence is injected; expo-secure-store is never touched here.
import {
  ACTIVE_PROFILE_KEY,
  __resetProfileStore,
  activeProfileLabel,
  canServerSearch,
  getProfileState,
  hydrateProfileStore,
  normalizeSelection,
  reduceServerProfiles,
  selectedProfileParam,
  setSelectedProfile,
  setServerProfiles,
  subscribeProfiles,
  type ProfilePersistence,
} from '../src/profile-store';

function fakePersistence(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => void data.set(k, v),
    del: async (k: string) => void data.delete(k),
  } satisfies ProfilePersistence & { data: Map<string, string> };
}

beforeEach(() => __resetProfileStore());

describe('hydrateProfileStore', () => {
  it('starts un-hydrated following the server default', () => {
    const s = getProfileState();
    expect(s).toEqual({ selected: null, serverCurrent: null, names: [], hydrated: false });
  });

  it('reads the persisted selection from the injected store', async () => {
    const p = fakePersistence({ [ACTIVE_PROFILE_KEY]: 'work' });
    await hydrateProfileStore(p);
    expect(getProfileState()).toMatchObject({ selected: 'work', hydrated: true });
  });

  it('is idempotent — a second call does not re-read storage', async () => {
    const p = fakePersistence({ [ACTIVE_PROFILE_KEY]: 'work' });
    await hydrateProfileStore(p);
    p.data.set(ACTIVE_PROFILE_KEY, 'other');
    await hydrateProfileStore(p);
    expect(getProfileState().selected).toBe('work');
  });

  it('falls back to the default when storage read fails', async () => {
    const p: ProfilePersistence = {
      get: async () => {
        throw new Error('keychain unavailable');
      },
      set: async () => {},
      del: async () => {},
    };
    await hydrateProfileStore(p);
    expect(getProfileState()).toMatchObject({ selected: null, hydrated: true });
  });
});

describe('setSelectedProfile', () => {
  it('persists an explicit non-default choice', async () => {
    const p = fakePersistence();
    await setSelectedProfile('work', p);
    expect(getProfileState().selected).toBe('work');
    expect(p.data.get(ACTIVE_PROFILE_KEY)).toBe('work');
  });

  it('clears persistence when reset to null', async () => {
    const p = fakePersistence({ [ACTIVE_PROFILE_KEY]: 'work' });
    await setSelectedProfile(null, p);
    expect(getProfileState().selected).toBeNull();
    expect(p.data.has(ACTIVE_PROFILE_KEY)).toBe(false);
  });

  it("normalises the backend's own profile to null (follow default)", async () => {
    const p = fakePersistence();
    setServerProfiles(['default', 'work'], 'default');
    await setSelectedProfile('default', p);
    expect(getProfileState().selected).toBeNull();
    expect(p.data.has(ACTIVE_PROFILE_KEY)).toBe(false);
  });

  it('notifies subscribers and supports unsubscribe', async () => {
    const p = fakePersistence();
    let fired = 0;
    const off = subscribeProfiles(() => fired++);
    await setSelectedProfile('work', p);
    expect(fired).toBe(1);
    off();
    await setSelectedProfile(null, p);
    expect(fired).toBe(1);
  });

  it('keeps in-memory state when persistence write fails', async () => {
    const p: ProfilePersistence = {
      get: async () => null,
      set: async () => {
        throw new Error('disk full');
      },
      del: async () => {},
    };
    await setSelectedProfile('work', p);
    expect(getProfileState().selected).toBe('work');
  });
});

describe('normalizeSelection / reduceServerProfiles', () => {
  it('normalizeSelection maps empty and server-current to null', () => {
    expect(normalizeSelection(null, 'default')).toBeNull();
    expect(normalizeSelection('default', 'default')).toBeNull();
    expect(normalizeSelection('work', 'default')).toBe('work');
    expect(normalizeSelection('work', null)).toBe('work');
  });

  it('drops a stale selection whose profile vanished server-side', () => {
    const prev = { selected: 'gone', serverCurrent: null, names: [], hydrated: true };
    const next = reduceServerProfiles(prev, ['default', 'work'], 'default');
    expect(next.selected).toBeNull();
    expect(next.names).toEqual(['default', 'work']);
    expect(next.serverCurrent).toBe('default');
  });

  it('keeps a valid selection and normalises one equal to serverCurrent', () => {
    const prev = { selected: 'work', serverCurrent: null, names: [], hydrated: true };
    expect(reduceServerProfiles(prev, ['default', 'work'], 'default').selected).toBe('work');
    expect(reduceServerProfiles(prev, ['default', 'work'], 'work').selected).toBeNull();
  });

  it('keeps the selection when the server list is empty (fetch fallback)', () => {
    const prev = { selected: 'work', serverCurrent: null, names: [], hydrated: true };
    expect(reduceServerProfiles(prev, [], null).selected).toBe('work');
  });
});

describe('derived helpers', () => {
  it('activeProfileLabel prefers selection, then serverCurrent, then "default"', () => {
    expect(activeProfileLabel()).toBe('default');
    setServerProfiles(['default', 'work'], 'default');
    expect(activeProfileLabel()).toBe('default');
    void setSelectedProfile('work', fakePersistence());
    expect(activeProfileLabel()).toBe('work');
  });

  it('canServerSearch only when targeting the backend profile', () => {
    expect(canServerSearch({ selected: null, serverCurrent: null, names: [], hydrated: true })).toBe(true);
    expect(canServerSearch({ selected: 'work', serverCurrent: 'work', names: [], hydrated: true })).toBe(true);
    expect(canServerSearch({ selected: 'work', serverCurrent: 'default', names: [], hydrated: true })).toBe(false);
    expect(canServerSearch({ selected: 'work', serverCurrent: null, names: [], hydrated: true })).toBe(false);
  });

  it('selectedProfileParam returns undefined when following the default', async () => {
    expect(selectedProfileParam()).toBeUndefined();
    await setSelectedProfile('work', fakePersistence());
    expect(selectedProfileParam()).toBe('work');
  });
});
