//! `useVersionStatus` — current app version + update availability.
//!
//! Reads the running app version via the Tauri core API and checks for
//! updates via `@tauri-apps/plugin-updater`. Returns a two-state result
//! (latest / update available) plus the version strings for display.
//!
//! **ONE probe per app session, shared by every consumer.** `updater.check()`
//! walks every endpoint in `tauri.conf.json` and logs an error per endpoint
//! that does not answer with a success status, so a per-component probe
//! multiplied that noise by the number of mounted consumers — and by
//! `React.StrictMode`'s double-invoke in dev. The check now runs once, its
//! settled result is reused, and the update handle is exposed so the update
//! banner can consume this hook instead of issuing a second probe of its own.

import { useSyncExternalStore } from 'react';
import { getVersion } from '@/api/tauri';
import type { Update } from '@tauri-apps/plugin-updater';

export type VersionState = 'checking' | 'latest' | 'update';

export interface VersionStatusInfo {
  state: VersionState;
  /** The currently running app version (e.g. "0.0.39"). */
  currentVersion: string;
  /** The available update version, if any. */
  availableVersion: string | null;
  /**
   * The update handle, for consumers that install it (the update banner).
   * Non-null exactly when `state === 'update'`.
   */
  instance: Update | null;
}

// ── The shared probe (module singleton) ───────────────────────────
//
// `useSyncExternalStore` requires `getSnapshot` to be referentially stable
// between changes, so `snapshot` is replaced as a whole rather than mutated.

const INITIAL: VersionStatusInfo = {
  state: 'checking',
  currentVersion: '0.0.0',
  availableVersion: null,
  instance: null,
};

let snapshot: VersionStatusInfo = INITIAL;
let inFlight: Promise<void> | null = null;
/**
 * Bumped by `resetVersionStatus`. A probe captures its generation and drops
 * its result if the store was reset while it was in flight, so a late
 * resolution can never overwrite a fresher probe's answer.
 */
let generation = 0;
const listeners = new Set<() => void>();

function emit(next: VersionStatusInfo): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function probe(gen: number): Promise<void> {
  // Version first, and a failed read is a fallback rather than a reason to
  // skip the update check — the two are independent facts, so one throwing
  // must not erase the other's answer.
  let currentVersion = '0.0.0';
  try {
    currentVersion = await getVersion();
  } catch {
    currentVersion = '0.0.0';
  }

  try {
    const updater = await import('@tauri-apps/plugin-updater');
    const update = await updater.check();
    if (gen !== generation) return;
    if (update) {
      emit({
        state: 'update',
        currentVersion,
        availableVersion: update.version,
        instance: update,
      });
      return;
    }
  } catch {
    // Updater plugin not available (browser / dev) — not an update.
  }

  if (gen !== generation) return;
  emit({
    state: 'latest',
    currentVersion,
    availableVersion: null,
    instance: null,
  });
}

/** Start the probe unless one is running or an answer is already settled. */
function ensureProbe(): void {
  if (inFlight || snapshot.state !== 'checking') return;
  const gen = generation;
  const run: Promise<void> = probe(gen).finally(() => {
    // Identity check, not a blind clear: a probe superseded by a reset must
    // not null out the marker belonging to the probe that replaced it.
    if (inFlight === run) inFlight = null;
  });
  inFlight = run;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureProbe();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): VersionStatusInfo {
  return snapshot;
}

/**
 * Drop the shared probe so the next consumer runs a fresh one.
 *
 * Test seam: a module is a singleton within a test file, so without this the
 * first case's probe would be shared by every later case (including a probe
 * that never settles). Also the entry point a deliberate "check again"
 * affordance would use.
 */
export function resetVersionStatus(): void {
  generation += 1;
  inFlight = null;
  snapshot = INITIAL;
}

/**
 * Check for update availability once per app session.
 *
 * - `checking` — initial state before the probe answers.
 * - `latest` — no updater plugin (browser/dev) or `check()` returned null.
 * - `update` — `check()` returned an Update with a valid version.
 */
export function useVersionStatus(): VersionStatusInfo {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
