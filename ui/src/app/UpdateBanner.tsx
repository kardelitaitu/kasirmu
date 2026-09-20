import { useState, useEffect, useCallback } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useVersionStatus } from '@/hooks/useVersionStatus';
import { createBackup } from '@/api/data';
import { openExternalUrl } from '@/api/browser';
import { getSetting, setSetting } from '@/api/settings';
import { plainErrorMessage } from '@/utils/app-error';
import './UpdateBanner.css';

// ── Constants ─────────────────────────────────────────────────────

/** Settings key for storing the previous app version before an update. */
const PREVIOUS_VERSION_KEY = 'updater.previous_version';

/** Settings key to check if a backup was created before the last update. */
const LAST_BACKUP_KEY = 'updater.last_backup_path';

/** Minimum supported version for compatibility checks. */
const DEFAULT_MIN_VERSION = '0.0.1';

// ── Helpers ────────────────────────────────────────────────────────

/** Compare two semver strings. Returns -1, 0, or 1. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/** Extract the `min_version` field from the update body if it's JSON. */
function parseMinVersionFromNotes(notes: string | undefined): string | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes);
    if (typeof parsed.min_version === 'string') return parsed.min_version;
  } catch {
    // Notes is plain text — no structured metadata.
  }
  return null;
}

// ── Update source ──────────────────────────────────────────────────
//
// Availability comes from `useVersionStatus` — the ONE shared updater probe
// for the app. This banner used to call `updater.check()` for itself, so
// with the status bar's version pill also mounted (and StrictMode doubling
// both in dev) a single answer cost several identical rounds of endpoint
// errors in the log. Consuming the hook also means the banner and the pill
// can never disagree about whether an update exists.

// ── Component ──────────────────────────────────────────────────────

/**
 * Update notification banner with safety protections:
 *
 * 1. **DB backup** — Automatically creates a SQLite backup before installing
 * 2. **Version compatibility** — Checks `min_version` from the update manifest
 * 3. **Rollback recovery** — Detects failed updates on next boot
 * 4. **Staged rollout** — Multiple endpoints (beta → stable) in tauri.conf.json
 * 5. **Key rotation ready** — Public key embedded, private key never in git
 */
export default function UpdateBanner() {
  const { l10n } = useLocalization();
  const {
    state: versionState,
    currentVersion,
    availableVersion,
    instance: updateInstance,
  } = useVersionStatus();

  // The manifest's `body` doubles as the release notes; `min_version` may be
  // embedded there as JSON metadata (the Update type exposes no raw fields).
  const notes = updateInstance?.body ?? undefined;
  const minVersion = parseMinVersionFromNotes(notes) ?? undefined;
  const updateAvailable = versionState === 'update';

  // ── State ─────────────────────────────────────────────────────
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [versionBlocked, setVersionBlocked] = useState(false);

  // ── Rollback recovery state ───────────────────────────────────
  const [previousVersion, setPreviousVersion] = useState<string | null>(null);
  const [showRollback, setShowRollback] = useState(false);

  // ── Detect a failed update (rollback recovery) ────────────────
  useEffect(() => {
    // Wait for the shared probe to settle: `currentVersion` is the '0.0.0'
    // fallback until then, and comparing a stored version against that would
    // either miss a real update or invent a rollback that never happened.
    if (versionState === 'checking') return;
    if (currentVersion === '0.0.0') return;

    let cancelled = false;

    (async () => {
      try {
        // A stored previous version that differs from the running one means
        // an update landed — offer the old release in case it went wrong.
        const prev = await getSetting(PREVIOUS_VERSION_KEY);
        if (!cancelled && prev && prev !== currentVersion) {
          setPreviousVersion(prev);
          setShowRollback(true);
        }
      } catch {
        // Settings API not available (browser mode).
      }
    })();

    return () => { cancelled = true; };
  }, [versionState, currentVersion]);

  // ── Version compatibility check ───────────────────────────────
  useEffect(() => {
    if (updateAvailable && minVersion && currentVersion) {
      const cmp = compareVersions(currentVersion, minVersion);
      if (cmp < 0) {
        // Current version is BELOW the minimum required for this update.
        setVersionBlocked(true);
      }
    }
  }, [updateAvailable, minVersion, currentVersion]);

  // ── Install handler ───────────────────────────────────────────
  const handleInstall = useCallback(async () => {
    if (!updateInstance) return;

    // 1. Version compatibility gate
    if (versionBlocked) return;

    setInstalling(true);
    setBackingUp(true);
    setBackupError(null);

    try {
      // 2. Auto-backup the database before updating
      const backupResult = await createBackup();
      const currentVer = currentVersion || 'unknown';

      // 3. Store current version for rollback recovery
      await persistUpdaterSetting(PREVIOUS_VERSION_KEY, currentVer);
      await persistUpdaterSetting(LAST_BACKUP_KEY, backupResult.path);

      setBackingUp(false);

      // 4. Install the update (Tauri handles download + install + restart)
      await updateInstance.downloadAndInstall();
    } catch (err) {
      // Installation failed — banner stays visible.
      setInstalling(false);
      setBackingUp(false);
      setBackupError(plainErrorMessage(err, 'Update failed'));
    }
  }, [updateInstance, versionBlocked, currentVersion]);// ── Helpers (module-level, no component state dependency) ─────────

/**
 * Persist an updater setting through the settings API layer (F-007).
 * The unscoped command is used deliberately: the scoped variant requires
 * a session token which isn't available in this context (the banner
 * renders before login in some routes).
 */
async function persistUpdaterSetting(key: string, value: string): Promise<void> {
  try {
    await setSetting(key, value, 'system_updater');
  } catch {
    // Non-critical — backup already done; settings persistence is best-effort.
  }
}

  // ── Rollback handler ──────────────────────────────────────────
  const handleRollback = useCallback(() => {
    // Open the GitHub releases page so the user can download the previous version.
    // Routed through `openExternalUrl` rather than `window.open` — see the note
    // there. `openUrl` hands the URL to the OS browser, which also focuses it,
    // so the old `win.focus()` dance has nothing left to do.
    if (previousVersion) {
      void openExternalUrl(
        `https://github.com/kardelitaitu/oz-pos/releases/tag/v${previousVersion}`,
      );
    }
  }, [previousVersion]);

  // ── Handle dismiss ────────────────────────────────────────────
  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setShowRollback(false);
  }, []);

  // ── Render logic ──────────────────────────────────────────────

  // Priority 1: Rollback recovery banner (if a previous update may have failed)
  if (showRollback && previousVersion) {
    return (
      <div className="update-banner update-banner--error" role="alert" aria-live="polite">
        <div className="update-banner-content">
          <svg className="update-banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="update-banner-text">
            <Localized id="update-banner-rollback-title"><strong>Update may have failed:</strong></Localized>{' '}
            <Localized id="update-banner-rollback-desc" vars={{ version: previousVersion }}>
              <span>Previous version {previousVersion} available for download.</span>
            </Localized>
          </span>
        </div>
        <div className="update-banner-actions">
          <button
            type="button"
            className="update-banner-btn update-banner-btn--rollback"
            onClick={handleRollback}
            aria-label={l10n.getString('update-banner-rollback-aria')}
          >
            {l10n.getString('update-banner-rollback')}
          </button>
          <button
            type="button"
            className="update-banner-btn update-banner-btn--dismiss"
            onClick={handleDismiss}
            aria-label={l10n.getString('update-banner-dismiss-aria')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Priority 2: Version blocked banner
  if (versionBlocked) {
    return (
      <div className="update-banner update-banner--warning" role="alert" aria-live="polite">
        <div className="update-banner-content">
          <svg className="update-banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="update-banner-text">
            <Localized id="update-banner-version-blocked-title"><strong>Update not available:</strong></Localized>{' '}
            <Localized
              id="update-banner-version-blocked-desc"
              vars={{ current: currentVersion || '?', minimum: minVersion || DEFAULT_MIN_VERSION }}
            >
              <span>Your version {currentVersion} is below minimum {minVersion}. Please reinstall from the website.</span>
            </Localized>
          </span>
        </div>
        <div className="update-banner-actions">
          <button
            type="button"
            className="update-banner-btn update-banner-btn--dismiss"
            onClick={handleDismiss}
            aria-label={l10n.getString('update-banner-dismiss-aria')}
          >
            {l10n.getString('update-banner-dismiss')}
          </button>
        </div>
      </div>
    );
  }

  // Priority 3: Update available banner (existing + backup improvements)
  if (!updateAvailable || dismissed) {
    return null;
  }

  return (
    <div
      className="update-banner"
      role="alert"
      aria-live="polite"
    >
      <div className="update-banner-content">
        <svg
          className="update-banner-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
        <span className="update-banner-text">
          <Localized id="update-banner-title"><strong>Update available:</strong></Localized>{' '}
          {availableVersion ? `v${availableVersion}` : l10n.getString('update-banner-new-version')}
          {notes && <span className="update-banner-notes"> — {notes}</span>}
        </span>
      </div>
      <div className="update-banner-actions">
        {backupError && (
          <span className="update-banner-error-text" role="alert">
            {l10n.getString('update-banner-backup-error')}
          </span>
        )}
        <button
          type="button"
          className="update-banner-btn update-banner-btn--primary"
          onClick={handleInstall}
          disabled={installing || backingUp || versionBlocked}
          aria-label={l10n.getString(
            backingUp
              ? 'update-banner-backing-up-aria'
              : installing
                ? 'update-banner-installing-aria'
                : 'update-banner-install-aria',
          )}
        >
          {l10n.getString(
            backingUp
              ? 'update-banner-backing-up'
              : installing
                ? 'update-banner-installing'
                : 'update-banner-install',
          )}
        </button>
        <button
          type="button"
          className="update-banner-btn update-banner-btn--dismiss"
          onClick={() => setDismissed(true)}
          aria-label={l10n.getString('update-banner-dismiss-aria')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
