import { Localized, useLocalization } from '@fluent/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  asSeverity,
  listSyncConflictsScoped,
  resolveSyncConflictScoped,
  type ConflictSeverity,
  type ListSyncConflictsArgs,
  type SyncConflictDto,
} from '@/api/syncConflicts';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { l10nErrorMessage } from '@/utils/app-error';

import { ConflictDiffViewer } from './components/ConflictDiffViewer';

// Shared hub scaffold styling — the screen mounts inside the settings
// placeholder section like every other page in the flat IA.
import '@/features/settings/screens/screens-placeholder.css';

// ── Sync conflict review ──────────────────────────────────────────
//
// Manager-facing review of mutations that diverged concurrently and could not
// be merged automatically. Severity is the same vocabulary as the
// `sync_conflicts.severity` CHECK constraint; a row that arrives with an
// unrecognised label is promoted to `high` so a conflict can never be hidden
// by a typo in a newer server's payload.

const SEVERITY_TABS: ReadonlyArray<{
  id: ConflictSeverity | 'all';
  key: string;
  label: string;
}> = [
  { id: 'high', key: 'sync-conflicts-severity-high', label: 'High' },
  { id: 'medium', key: 'sync-conflicts-severity-medium', label: 'Medium' },
  { id: 'low', key: 'sync-conflicts-severity-low', label: 'Low' },
  { id: 'all', key: 'sync-conflicts-severity-all', label: 'All' },
];

export function SyncConflictReviewScreen() {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';

  const [conflicts, setConflicts] = useState<SyncConflictDto[]>([]);
  const [severity, setSeverity] = useState<ConflictSeverity | 'all'>('high');
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionToken) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const args: ListSyncConflictsArgs = {
        status: showResolved ? undefined : 'open',
        severity: severity === 'all' ? undefined : severity,
      };
      const rows = await listSyncConflictsScoped(sessionToken, args);
      setConflicts(rows ?? []);
    } catch (e) {
      setError(l10nErrorMessage(e, l10n, 'sync-conflicts-error-load'));
      setConflicts([]);
    } finally {
      setLoading(false);
    }
  }, [l10n, sessionToken, severity, showResolved]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = useCallback(
    async (conflict: SyncConflictDto, resolution: string) => {
      if (!sessionToken) {
        return;
      }
      setBusyId(conflict.id);
      setError(null);
      try {
        const ok = await resolveSyncConflictScoped(sessionToken, {
          id: conflict.id,
          resolution,
        });
        // Refresh first, then surface the notice: `load()` clears the banner
        // at its start, so setting it before the await batched both updates
        // in one tick and the message never reached the screen.
        await load();
        if (!ok) {
          // Not an error to retry blindly: another terminal may have resolved
          // the same row first.
          setError(
            l10n.getString(
              'sync-conflicts-resolved-elsewhere',
              null,
              'This conflict was already resolved elsewhere. Refreshing.',
            ),
          );
        }
      } catch (e) {
        setError(l10nErrorMessage(e, l10n, 'sync-conflicts-error-resolve'));
      } finally {
        setBusyId(null);
      }
    },
    [l10n, load, sessionToken],
  );

  const rows = useMemo(
    () => conflicts.filter((c) => (showResolved ? true : c.status === 'open')),
    [conflicts, showResolved],
  );

  return (
    // The Settings hub's IA sweep (SettingsPage.test.tsx) requires every
    // section body to mount inside the shared placeholder scaffold with an
    // h1 titled by its `settings-nav-*` label — the same shape a migrated
    // screen like BusinessDefaultsScreen uses. Review content sits inside it.
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-sync-conflicts">Sync Conflicts</Localized>
      </h1>
      <div className="sync-conflict-review" data-testid="sync-conflict-review">
        <header className="sync-conflict-review__head">
          {/* Localized must wrap the text node, not the <label>: with a plain
              string translation @fluent/react replaces ALL of the wrapped
              element's children, which silently unmounted the checkbox and
              made the audit-trail view unreachable. */}
          <label
            className="sync-conflict-review__toggle"
            htmlFor="sync-conflicts-show-resolved-toggle"
          >
            <input
              id="sync-conflicts-show-resolved-toggle"
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              aria-label={l10n.getString('sync-conflicts-show-resolved')}
            />
            <Localized id="sync-conflicts-show-resolved">
              <span>Show resolved history</span>
            </Localized>
          </label>
        </header>

      {/* `div`, not `nav`: jsx-a11y rejects an interactive role on a
          landmark element, and the tablist needs an accessible name. */}
      <div className="sync-conflict-review__tabs" role="tablist" aria-label={l10n.getString('sync-conflicts-title')}>
        {SEVERITY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={severity === tab.id}
            className={
              severity === tab.id
                ? 'sync-conflict-review__tab sync-conflict-review__tab--active'
                : 'sync-conflict-review__tab'
            }
            onClick={() => setSeverity(tab.id)}
          >
            <Localized id={tab.key}>{tab.label}</Localized>
          </button>
        ))}
      </div>

      {error ? <p className="sync-conflict-review__error">{error}</p> : null}
      {loading ? (
        <Localized id="sync-conflicts-loading">
          <p className="sync-conflict-review__loading">Loading…</p>
        </Localized>
      ) : null}

      {!loading && rows.length === 0 ? (
        <Localized id="sync-conflicts-empty">
          <p className="sync-conflict-review__empty">No conflicts to review.</p>
        </Localized>
      ) : null}

      <ul className="sync-conflict-review__list">
        {rows.map((conflict) => (
          <li key={conflict.id} className="sync-conflict-review__item">
            <ConflictDiffViewer
              conflict={{ ...conflict, severity: asSeverity(conflict.severity) }}
              busy={busyId === conflict.id}
              onAcceptLocal={(resolution) => void resolve(conflict, resolution)}
              onAcceptRemote={(resolution) => void resolve(conflict, resolution)}
              onCustomMerge={(resolution) => void resolve(conflict, resolution)}
            />
          </li>
        ))}
      </ul>
      </div>
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>
    </section>
  );
}

export default SyncConflictReviewScreen;
