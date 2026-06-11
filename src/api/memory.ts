// src/api/memory.ts
//
// Memory admin surface, per docs/contracts/memory.md.
//
// The dashboard exposes exactly three memory operations: status, provider
// selection, and reset (file deletion). There is NO per-entry CRUD REST
// surface — built-in memory is two markdown files on disk (MEMORY.md and
// USER.md under <HERMES_HOME>/memories/), and provider-backed memory has no
// REST read/write surface at all.
import type { RestClient } from './restClient';

export interface MemoryProviderInfo {
  name: string;
  description: string;
  configured: boolean;
}

export interface MemoryStatus {
  /** "" = built-in markdown files; otherwise the active plugin provider name. */
  active: string;
  providers: MemoryProviderInfo[];
  /** Byte sizes of the built-in files; 0 = file absent. */
  builtin_files: { memory: number; user: number };
}

export type MemoryResetTarget = 'all' | 'memory' | 'user';

export interface MemoryResetResponse {
  ok: boolean;
  deleted: string[];
}

export interface MemoryProviderResponse {
  ok: boolean;
  active: string;
}

/** Sentinel sent to the server to select the built-in file backend. */
export const BUILT_IN_PROVIDER = '';

export function getMemoryStatus(r: RestClient): Promise<MemoryStatus> {
  return r.get<MemoryStatus>('/api/memory');
}

/** Switch the memory backend. `''` selects built-in files. 400 for unknown providers. */
export function setMemoryProvider(r: RestClient, provider: string): Promise<MemoryProviderResponse> {
  return r.put<MemoryProviderResponse>('/api/memory/provider', { provider });
}

/** Delete the built-in memory file(s). Irreversible — confirm with the user first. */
export function resetMemory(r: RestClient, target: MemoryResetTarget): Promise<MemoryResetResponse> {
  return r.post<MemoryResetResponse>('/api/memory/reset', { target });
}

/** Human label for a provider value as returned in `MemoryStatus.active`. */
export function providerLabel(provider: string): string {
  return provider === BUILT_IN_PROVIDER ? 'Built-in files' : provider;
}

/** "Empty" for absent files (size 0), else a compact human-readable size. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Empty';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${trimDecimal(bytes / 1024)} KB`;
  return `${trimDecimal(bytes / (1024 * 1024))} MB`;
}

function trimDecimal(n: number): string {
  const fixed = n.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}
