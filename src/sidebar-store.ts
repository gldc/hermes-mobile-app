// Open/closed state for the slide-over sidebar, shared between the host
// overlay (root layout) and the screens that toggle it. Module-level store in
// the same style as profile-store: useSyncExternalStore on the consumer side.

type Listener = () => void;

let open = false;
const listeners = new Set<Listener>();

export function isSidebarOpen(): boolean {
  return open;
}

export function setSidebarOpen(value: boolean): void {
  if (open === value) return;
  open = value;
  listeners.forEach((l) => l());
}

export function openSidebar(): void {
  setSidebarOpen(true);
}

export function closeSidebar(): void {
  setSidebarOpen(false);
}

export function subscribeSidebar(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
