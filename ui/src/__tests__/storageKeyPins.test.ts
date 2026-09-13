// ── localStorage key pins ──────────────────────────────────────────
//
// Every localStorage key the UI writes, pinned to its literal value, plus a
// completeness check that fails if production introduces a key not listed here.
//
// WHY THIS EXISTS
//
// A round-trip test cannot detect a key rename. It writes through the module's
// constant and reads back through the same constant, so both sides move together
// and the suite stays green -- which is how KdsPreferencesReadLocalPrefs and
// KdsCardColorsLoadColors both passed while a rename would have silently orphaned
// every user's saved data (3e0e156c, ecc5f65d). Auditing all 50 keys found that 20
// had no literal anywhere in a test file, and 12 of those sat in modules that DO
// have localStorage-touching suites -- coverage that looks real and is blind to the
// one change that matters.
//
// Pinning the literals is the only thing that turns a rename into a deliberate act.
// A key whose value changes here must be changed in production in the same commit,
// and the person doing it has to decide what happens to data already on disk.
//
// WHY ONE FILE
//
// The alternative was adding an assertion to each of ~20 owning suites. This way
// there is one place to look for "what is persisted on this machine", and the
// completeness check has a single source of truth to compare against.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(process.cwd(), 'src');

/** Every key literal, mapped to the module that owns it. */
const EXPECTED_KEYS: Record<string, string> = {
  // Shell / chrome
  'app-hw-accel': 'contexts/HardwareAccelContext.tsx',
  'app-sidebar-collapsed': 'frontend/shell/AppLayout.tsx',
  'app-sidebar-expanded': 'frontend/shell/AppLayout.tsx',
  'app-sidebar-sections': 'frontend/shell/AppLayout.tsx',
  'app-zoom-level': 'contexts/ZoomContext.tsx',
  'auto-lock-minutes': 'hooks/useIdleTimer.ts',
  'current-username': 'contexts/AuthContext.tsx',
  'oz-key-created-at': 'hooks/useKeyAge.ts',
  'oz-pos-locale': 'i18n/LocaleContext.tsx',
  'oz-pos-theme-v4': 'frontend/shell/ThemeProvider.tsx',

  // KDS
  'kds-cached-orders': 'hooks/useKdsOffline.ts',
  'kds-card-colors-v1': 'features/kds/KdsCardColorsContext.tsx',
  'kds-last-sync': 'hooks/useKdsOffline.ts',
  'kds-offline-dead-letter': 'hooks/useKdsOffline.ts',
  'kds-offline-queue': 'hooks/useKdsOffline.ts',
  // bbb4402c4 (0.0.37 KDS wave) gave the Expo screen its own per-user station
  // selector. Deliberately a separate key from kds_zone under oz-kds-prefs-:
  // the two screens answer different questions and would fight across tabs.
  'oz-kds-expo-station-': 'features/kds/kdsStationPrefs.ts',
  'oz-kds-prefs-': 'features/kds/hooks/useKdsPreferences.ts',

  // POS / retail
  'pos-cart-width': 'features/sales/PosScreen.tsx',
  'pos-locked-cart': 'features/sales/posScreenHooks.ts',
  'oz-retail-cols-': 'features/retail/hooks/useRetailColumnPrefs.ts',
  'retail-cart-width': 'features/retail/RetailPosScreen.tsx',
  'retail-sound-enabled': 'features/retail/RetailPosScreen.tsx',
  'retail-tender-presets': 'features/retail/RetailPosScreen.tsx',

  // Settings
  'settings-pinned-sections': 'features/settings/SettingsNavTree.tsx',
  'settings-sidebar-collapsed': 'features/settings/SettingsNavTree.tsx',
  'settings-sidebar-expanded': 'features/settings/SettingsNavTree.tsx',
  'settings-sidebar-width': 'features/settings/SettingsNavTree.tsx',
  'smtp_config': 'features/settings/EmailReportSettings.tsx',

  // Analytics
  'card': 'features/analytics/analytics-cache.ts',
  'oz-analytics-cache-v1': 'features/analytics/analytics-cache.ts',
  // R37 analytics-query moved the view + zoom state, and the two keys they
  // persist, out of AnalyticsScreen.tsx into the filter hook.
  'oz-analytics-workspace-view': 'features/analytics/hooks/useAnalyticsFilters.ts',
  'oz-analytics-zoom': 'features/analytics/hooks/useAnalyticsFilters.ts',

  // Topology editor
  'oz-topology-template:': 'features/locations/topologyExport.ts',
  'oz-topology-view-routing': 'features/locations/nodeTopologyEditorViewport.ts',
  'oz-topology-view-snap': 'features/locations/nodeTopologyEditorViewport.ts',
  'oz-topology-view-wire-labels': 'features/locations/nodeTopologyEditorViewport.ts',

  // Workspaces
  'workspace-last-used': 'features/workspaces/WorkspaceHome.tsx',
  'workspace-pins': 'features/workspaces/WorkspaceHome.tsx',

  // Auth
  'oz-last-login': 'features/auth/StaffLoginScreen.tsx',

  // Updater internals -- not user configuration, but persisted, so pinned: a stale
  // previous_version makes the update banner offer an upgrade that already happened.
  'updater.last_backup_path': 'frontend/shell/UpdateBanner.tsx',
  'updater.previous_version': 'frontend/shell/UpdateBanner.tsx',

  // Dev mock -- browser-only fixtures, never shipped data. Pinned anyway so the
  // completeness check has no exceptions to reason about. These moved from the
  // entry router to the persistence registry, which is now the single module
  // that names a slice key; the entry file no longer declares any of them.
  'oz-dev-mock:active-shift': 'dev-mock/core/mockDatabase.ts',
  'oz-dev-mock:cart': 'dev-mock/core/mockDatabase.ts',
  'oz-dev-mock:held-carts': 'dev-mock/core/mockDatabase.ts',
  'oz-dev-mock:kds': 'dev-mock/core/mockDatabase.ts',
  'oz-dev-mock:login-attempts': 'dev-mock/core/mockDatabase.ts',
  'oz-dev-mock:sales': 'dev-mock/core/mockDatabase.ts',
  'oz-dev-mock:shift-history': 'dev-mock/core/mockDatabase.ts',
  'oz-dev-mock:topology': 'dev-mock/core/mockDatabase.ts',
  'oz-dev-mock:topology-revisions': 'dev-mock/core/mockDatabase.ts',
  'oz-dev-mock:user-prefs': 'dev-mock/core/mockDatabase.ts',
  'oz-dev-mock:workspaces': 'dev-mock/core/mockDatabase.ts',
};

const KEY_DECL =
  /^(?:export\s+)?const\s+(\w*(?:STORAGE_KEY|_KEY|_PREFIX|CACHE_KEY)\w*)\s*(?::[^=]+)?=\s*['"]([^'"]+)['"]/gm;
const DIRECT =
  /(?:localStorage|sessionStorage)\.(?:get|set|remove)Item\(\s*['"]([^'"$]+)['"]/g;

/** Walk src/ and collect every storage-key literal production declares, with EVERY module
 *  that declares it. Keeping only the last owner hid a real fact: 'current-username' and
 *  'pos-cart-width' are each declared by two modules, so a rename in one and not the other
 *  silently splits the value across two keys. */
function discoverKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (lit: string, rel: string): void => {
    found.set(lit, [...(found.get(lit) ?? []), rel]);
  };
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      const rel = path.relative(SRC_DIR, full).replace(/\\/g, '/');
      // The regexes require a capture group, so the index is always present; the project's
      // noUncheckedIndexedAccess still types matchAll groups as string | undefined.
      for (const m of text.matchAll(KEY_DECL)) if (m[2]) add(m[2], rel);
      for (const m of text.matchAll(DIRECT)) if (m[1]) add(m[1], rel);
    }
  };
  walk(SRC_DIR);
  return found;
}

describe('localStorage key registry', () => {
  const live = discoverKeys();

  it('discovers keys at all (a broken scanner would report a clean registry)', () => {
    expect(live.size).toBeGreaterThan(40);
  });

  it('pins every key production declares', () => {
    const missing = [...live.keys()]
      .filter((lit) => !(lit in EXPECTED_KEYS))
      .map((lit) => `${lit}  (${live.get(lit)!.join(', ')})`);
    expect(
      missing,
      `New storage key(s) with no pin. Add each to EXPECTED_KEYS with its literal so a ` +
        `rename has to be a deliberate edit:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('lists no key that production no longer declares', () => {
    const stale = Object.keys(EXPECTED_KEYS).filter((lit) => !live.has(lit));
    expect(
      stale,
      `EXPECTED_KEYS names key(s) not found in production -- renamed or deleted without ` +
        `updating this registry:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('attributes each key to a module that really declares it', () => {
    const wrong = Object.entries(EXPECTED_KEYS)
      .filter(([lit, owner]) => live.has(lit) && !live.get(lit)!.includes(owner))
      .map(([lit, owner]) => `${lit}: registry says ${owner}, production says `
        + `${live.get(lit)!.join(' | ')}`);
    expect(wrong, `Owner drift:\n  ${wrong.join('\n  ')}`).toEqual([]);
  });

  // Not a failure, a record: these keys are written by more than one module, so a rename
  // must touch every owner. Listed explicitly so the set is reviewed rather than discovered
  // by whoever hits a stale key in production.
  it('documents which keys have more than one declaring module', () => {
    const shared = [...live.entries()]
      .filter(([, owners]) => new Set(owners).size > 1)
      .map(([lit, owners]) => `${lit} -> ${[...new Set(owners)].sort().join(', ')}`)
      .sort();
    expect(shared).toEqual([
      'current-username -> contexts/AuthContext.tsx, features/auth/SessionLockScreen.tsx',
      'pos-cart-width -> features/sales/PosScreen.tsx, features/sales/posScreenHooks.ts',
    ]);
  });
});
