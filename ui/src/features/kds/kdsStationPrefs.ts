// ui/src/features/kds/kdsStationPrefs.ts
//
// Persistence for the Expo screen's station selection (todo-kds-agents-3,
// Phase 3 "dedicated Station view").
//
// Deliberately localStorage-only and deliberately NOT `kds_zone` from
// useKdsPreferences: that preference drives the KITCHEN board's zone chips,
// while the Expo selector answers a different question ("which station's
// pass am I watching?"). Sharing one key would make the two screens fight
// across tabs on the same terminal. An empty string means "all stations" —
// the same sentinel convention useKdsPreferences.kdsZone uses, so readers
// already know the shape.
//
// Scope key is the user id, mirroring useKdsPreferences'
// `oz-kds-prefs-<userId>` pattern (per-user, per-device). Server-side
// persistence would need a new preference key in the shared
// kds_* namespace — that write surface exists
// (`setUserPreferencesScoped`) but reserving namespace keys is the backend
// routing work (Agent 1), not this UI work order.

const STORAGE_KEY_PREFIX = 'oz-kds-expo-station-';

/** Exported for tests: the storage prefix is the contract (a copied key
 *  constant in a test stays green through a production rename). */
export const KDS_EXPO_STATION_KEY_PREFIX = STORAGE_KEY_PREFIX;

/**
 * Read the persisted Expo station selection for a user.
 * '' = all stations (also the fallback for missing/unreadable storage).
 */
export function readExpoStation(userId: string): string {
  if (!userId) return '';
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + userId);
    return typeof raw === 'string' ? raw : '';
  } catch {
    return '';
  }
}

/** Persist the Expo station selection for a user ('' clears to all stations). */
export function writeExpoStation(userId: string, zone: string): void {
  if (!userId) return;
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + userId, zone);
  } catch {
    // localStorage may be full or unavailable — selection stays session-only.
  }
}
