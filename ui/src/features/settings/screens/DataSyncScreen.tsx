//! DataSyncScreen — Settings → Data Sync.
//!
//! The PARENT of the sync family in the sidebar: `data-management`,
//! `sync-status`, `sync-conflicts` and `offline-queue` are all registered
//! `subpage: true` beneath it (SettingsNavTree.tsx). This screen is therefore the
//! cloud-sync CONFIGURATION — the server URL, API key, enabled toggle, plan
//! badge and queue summary that `sections/SyncSection.tsx` renders.
//!
//! The scaffold's stale provenance proposed a "tabbed container" holding
//! Data Management / Sync Status / Offline Queue as tabs. That plan predates the
//! flat sidebar: those three now exist as their own PAGES (two of them already
//! migrated — OfflineQueueScreen and DataManagementScreen), so building tabs
//! here would duplicate three routes. The parent hosts the sync settings and its
//! children keep their own pages.
//!
//! Migrated the same way as General: the section is presentational and takes
//! thirty-four props, so `hooks/useDataSyncDraft.ts` supplies the PAGE-owned
//! ones (the draft, the queue + plan reads, the four actions, persistence) while
//! this screen owns the section's UI-only state (the in-flight flags, the
//! api-key visibility toggle, and the ping / pull / attempt results) — state
//! that belongs to the section's own interaction, not to the hosting page.

import { Localized, useLocalization } from '@fluent/react';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import type { PingResult, PullResult, SyncAttemptResult } from '@/api/offline';
import { useDataSyncDraft } from '../hooks/useDataSyncDraft';
import SyncSection from '../sections/SyncSection';
import './screens-placeholder.css';
import './DataSyncScreen.css';

/** Settings → Data Sync: heading + the real cloud-sync configuration form. */
export function DataSyncScreen() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const draft = useDataSyncDraft();

  // The section's own UI state. Kept here rather than in the hook because it is
  // interaction-local: it resets with the screen and no other page reads it.
  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [syncApiKeyVisible, setSyncApiKeyVisible] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncAttemptResult | null>(null);
  const [pullResult, setPullResult] = useState<PullResult | null>(null);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null);

  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-data-sync">Data Sync</Localized>
      </h1>
      {/* The migration note stays (SettingsPage.test.tsx asserts it on every
          screen, migrated ones included). */}
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>

      <SyncSection
        sync={draft.sync}
        setSync={draft.setSync}
        syncServerUrl={draft.syncServerUrl}
        setSyncServerUrl={draft.setSyncServerUrl}
        syncApiKey={draft.syncApiKey}
        setSyncApiKey={draft.setSyncApiKey}
        syncApiKeyVisible={syncApiKeyVisible}
        setSyncApiKeyVisible={setSyncApiKeyVisible}
        syncing={syncing}
        setSyncing={setSyncing}
        pulling={pulling}
        setPulling={setPulling}
        syncResult={syncResult}
        setSyncResult={setSyncResult}
        pullResult={pullResult}
        setPullResult={setPullResult}
        queueSummary={draft.queueSummary}
        syncPlan={draft.syncPlan}
        testing={testing}
        setTesting={setTesting}
        pingResult={pingResult}
        setPingResult={setPingResult}
        requesting={requesting}
        setRequesting={setRequesting}
        tokenExpiresAt={tokenExpiresAt}
        setTokenExpiresAt={setTokenExpiresAt}
        // The section declares `cmInput: React.HTMLAttributes<HTMLInputElement>`,
        // which does NOT include `autoComplete`/`autoCorrect`/`spellCheck` —
        // those live on InputHTMLAttributes. Spread the bag and let the cast
        // carry the three real attributes the inputs need.
        cmInput={{ spellCheck: false, ...({ autoComplete: 'off', autoCorrect: 'off' } as React.HTMLAttributes<HTMLInputElement>) }}
        // Dirtiness is derived by the hook (draft vs the context read), so the
        // section's per-keystroke call has nothing to flip.
        markDirty={() => {}}
        refreshQueueSummary={draft.refreshQueueSummary}
        testSyncConnection={draft.testSyncConnection}
        syncRun={draft.syncRun}
        syncPull={draft.syncPull}
        requestSyncToken={draft.requestSyncToken}
        l10n={l10n}
        // The real toast sink: the section reports every sync outcome through
        // it (pull result, token request, connection test, run result). A no-op
        // here would silently swallow all of them.
        addToast={addToast}
      />

      <div className="settings-form">
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="settings-data-sync-save-btn"
          onClick={() => { void draft.save(); }}
          disabled={draft.saving || !draft.isDirty}
        >
          <Localized id="settings-btn-save">Save</Localized>
        </Button>
      </div>
    </section>
  );
}
