//! Cloud-sync draft: the page-owned state SyncSection has always been handed but
//! nothing has supplied since the flat-IA rebuild.
//!
//! WHY THIS EXISTS. `sections/SyncSection.tsx` is presentational — it takes
//! THIRTY-FOUR props and owns none of the page-level ones. The rebuild removed
//! the settings page's sync fields ("inputs left the page" — see the header of
//! SettingsPage.test.tsx), so `sync`, `syncServerUrl`, `syncApiKey` and
//! `markDirty` have had no supplier, and Settings → Data Sync has rendered
//! "This page is being rebuilt." ever since. Same shape as General, fixed the
//! same way: `useStoreDraft.ts` for that one, this hook for this one.
//!
//! SCOPE — only the PAGE-owned half. The rest of the section's props are its own
//! UI state (syncing / pulling / testing / requesting flags, the api-key
//! visibility toggle, the ping / pull / attempt results) plus the callbacks that
//! drive them. Those belong to the section, not to a page that hosts it, so they
//! stay out of this hook. What lives here is: the configuration values being
//! edited, the queue + plan reads the summary needs, the four actions, and
//! persistence.
//!
//! PERSISTENCE mirrors `useSettingsSave`'s sync task rather than inventing a
//! second one: `updateSyncSettingsScoped(token, { serverUrl, apiKey, enabled })`.
//! The api-key field is sent ONLY when the user actually typed one, because
//! `SyncSettingsDto` exposes `hasApiKey: boolean` and never the key itself, so
//! echoing an empty string back would clear a stored credential.
//!
//! Every read is coerced before it reaches state: a transport resolving
//! `undefined` must not reach the render (the class swept in Round 6 — see
//! utils/ipc-payload).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { useSettings } from '@/contexts/SettingsContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { isTabletShell } from '@/utils/shellKind';
import {
  getSyncPlanScoped,
  getOfflineQueueStatusSummaryScoped,
  requestSyncTokenScoped,
  syncPullScoped,
  syncRunScoped,
  testSyncConnectionScoped,
  updateSyncSettingsScoped,
  type OfflineQueueSummaryDto,
  type PingResult,
  type PullResult,
  type SyncAttemptResult,
  type SyncPlanResult,
  type SyncSettingsDto,
  type TokenResult,
} from '@/api/offline';

export interface DataSyncDraft {
  /** The draft settings being edited. */
  sync: SyncSettingsDto;
  setSync: (next: SyncSettingsDto | ((prev: SyncSettingsDto) => SyncSettingsDto)) => void;
  syncServerUrl: string;
  setSyncServerUrl: (v: string) => void;
  syncApiKey: string;
  setSyncApiKey: (v: string) => void;
  /** Latest queue summary, or null when the read has not answered. */
  queueSummary: OfflineQueueSummaryDto | null;
  /** Tenant sync plan from the server (ADR sync-plan-gating). */
  syncPlan: SyncPlanResult | null;
  /** True when the draft differs from the last server read. */
  isDirty: boolean;
  /** Persist the draft. Resolves true when the write succeeded. */
  save: () => Promise<boolean>;
  saving: boolean;
  /** Re-read the queue summary (the section calls this after a sync). */
  refreshQueueSummary: () => Promise<void>;
  testSyncConnection: () => Promise<PingResult>;
  syncRun: () => Promise<SyncAttemptResult>;
  syncPull: (args: { confirmDestructive: boolean }) => Promise<PullResult>;
  requestSyncToken: () => Promise<TokenResult>;
}

/** Empty draft used before the context's first read resolves. */
const EMPTY_SYNC: SyncSettingsDto = {
  serverUrl: null,
  hasApiKey: false,
  enabled: false,
  resolvedOrigin: '',
  resolvedOriginSource: 'fallback',
};

/** A failed call is not an answered one: these carry no data and no false claim. */
const FAILED_PING: PingResult = { ok: false, status: '', latencyMs: null };
const FAILED_ATTEMPT: SyncAttemptResult = { synced: 0, failed: 0, error: null };
const FAILED_PULL: PullResult = { productsPulled: 0, taxRatesPulled: 0, usersPulled: 0, error: null };
const FAILED_TOKEN: TokenResult = { ok: false, token: null, status: '', expiresAt: null };

/**
 * Own the cloud-sync draft, its supporting reads, its four actions, and its
 * persistence.
 */
export function useDataSyncDraft(): DataSyncDraft {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { settings, markSettingsUpdated } = useSettings();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken ?? '';

  const [sync, setSyncState] = useState<SyncSettingsDto>(EMPTY_SYNC);
  const [syncServerUrl, setSyncServerUrl] = useState('');
  const [syncApiKey, setSyncApiKey] = useState('');
  const [queueSummary, setQueueSummary] = useState<OfflineQueueSummaryDto | null>(null);
  const [syncPlan, setSyncPlan] = useState<SyncPlanResult | null>(null);
  const [saving, setSaving] = useState(false);

  // What the draft was seeded from, for the dirty comparison. A ref, not state:
  // it must not participate in rendering, and writing it in the seed effect must
  // not schedule a second render.
  const savedRef = useRef<{ sync: SyncSettingsDto; serverUrl: string }>({ sync: EMPTY_SYNC, serverUrl: '' });

  // Seed from the context read. Guarded on the VALUE, not object identity: the
  // context builds a fresh object per read, so an identity check would re-seed
  // on every render and wipe what the user is typing.
  const contextSync = settings?.sync;
  const seedKey = contextSync
    ? [contextSync.serverUrl ?? '', contextSync.enabled, contextSync.hasApiKey].join('\u0000')
    : null;
  useEffect(() => {
    if (!contextSync || seedKey === null) return;
    const seeded: SyncSettingsDto = { ...EMPTY_SYNC, ...contextSync };
    setSyncState(seeded);
    setSyncServerUrl(contextSync.serverUrl ?? '');
    // The key itself is never returned by the server — only `hasApiKey`. The
    // field starts empty and is sent only if the user types a new one.
    setSyncApiKey('');
    savedRef.current = { sync: seeded, serverUrl: contextSync.serverUrl ?? '' };
    // seedKey IS the value-level identity of contextSync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const setSync = useCallback((next: SyncSettingsDto | ((prev: SyncSettingsDto) => SyncSettingsDto)) => {
    setSyncState((prev) => (typeof next === 'function' ? next(prev) : next));
  }, []);

  const isDirty = useMemo(
    () =>
      sync.enabled !== savedRef.current.sync.enabled ||
      syncServerUrl !== savedRef.current.serverUrl ||
      syncApiKey.trim() !== '',
    [sync.enabled, syncServerUrl, syncApiKey],
  );

  const refreshQueueSummary = useCallback(async () => {
    if (!sessionToken) return;
    // The tablet shell registers no `offline_queue_status_summary_scoped` door,
    // and ADR #49 forbids opening one here: the bridge fn is UNGATED
    // (`crates/kasirmu-bridge/src/offline.rs:285`, "ungated-ok" — it resolves a
    // session and enforces nothing), so delegating it would be case-2 debt
    // erasure, which the mobile module header records as an owner ruling rather
    // than part of an extraction. Skip the read instead: `queueSummary` stays
    // null, which the UI already treats as "not answered" — not as zero.
    if (isTabletShell()) return;
    try {
      const summary = await getOfflineQueueStatusSummaryScoped(sessionToken);
      setQueueSummary(summary ?? null);
    } catch {
      // A failed summary read is not an answered-empty one; keep the previous
      // value rather than claiming zero pending.
    }
  }, [sessionToken]);

  const refreshPlan = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const plan = await getSyncPlanScoped(sessionToken);
      setSyncPlan(plan ?? null);
    } catch {
      setSyncPlan(null);
    }
  }, [sessionToken]);

  // Both supporting reads run once per token, not per render.
  useEffect(() => {
    if (!sessionToken) return;
    void refreshQueueSummary();
    void refreshPlan();
  }, [sessionToken, refreshQueueSummary, refreshPlan]);

  const save = useCallback(async () => {
    if (!sessionToken) return false;
    setSaving(true);
    try {
      await updateSyncSettingsScoped(sessionToken, {
        serverUrl: syncServerUrl,
        // Send the key ONLY when one was typed: the DTO never echoes it back, so
        // an unconditional send would clear a stored credential.
        ...(syncApiKey.trim() !== '' ? { apiKey: syncApiKey } : {}),
        enabled: sync.enabled,
      });
      markSettingsUpdated(['sync.serverUrl', 'sync.enabled']);
      savedRef.current = { sync: { ...sync, serverUrl: syncServerUrl }, serverUrl: syncServerUrl };
      setSyncApiKey('');
      addToast({ message: l10n.getString('settings-saved'), type: 'success' });
      return true;
    } catch {
      addToast({ message: l10n.getString('settings-save-error'), type: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [sessionToken, sync, syncServerUrl, syncApiKey, markSettingsUpdated, addToast, l10n]);

  const testSyncConnection = useCallback(async (): Promise<PingResult> => {
    if (!sessionToken) return FAILED_PING;
    const result = await testSyncConnectionScoped(sessionToken);
    return result ?? FAILED_PING;
  }, [sessionToken]);

  const syncRun = useCallback(async (): Promise<SyncAttemptResult> => {
    if (!sessionToken) return FAILED_ATTEMPT;
    const result = await syncRunScoped(sessionToken);
    return result ?? FAILED_ATTEMPT;
  }, [sessionToken]);

  const syncPull = useCallback(async (args: { confirmDestructive: boolean }): Promise<PullResult> => {
    if (!sessionToken) return FAILED_PULL;
    const result = await syncPullScoped(sessionToken, args);
    return result ?? FAILED_PULL;
  }, [sessionToken]);

  const requestSyncToken = useCallback(async (): Promise<TokenResult> => {
    if (!sessionToken) return FAILED_TOKEN;
    const result = await requestSyncTokenScoped(sessionToken);
    return result ?? FAILED_TOKEN;
  }, [sessionToken]);

  return {
    sync,
    setSync,
    syncServerUrl,
    setSyncServerUrl,
    syncApiKey,
    setSyncApiKey,
    queueSummary,
    syncPlan,
    isDirty,
    save,
    saving,
    refreshQueueSummary,
    testSyncConnection,
    syncRun,
    syncPull,
    requestSyncToken,
  };
}
