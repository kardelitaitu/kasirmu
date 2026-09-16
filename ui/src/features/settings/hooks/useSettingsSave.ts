/**
 * Settings save orchestration - the fan-out that was handleSave in
 * SettingsPage.tsx (settings lane slice 1).
 *
 * SEAM: values and setters are RECEIVED, not reached for, and this hook owns no
 * state - it calls no React hook at all, so the page's hook order does not move
 * either. That is a deliberate choice, not an accident: the six things this
 * handler writes (saving, saved, isDirty, store, sync, syncApiKey) are all ALSO
 * read by Revert-to-saved, the dirty dot, the close-request guard and the
 * section screens, and the snapshot it commits IS the Revert target. Moving
 * them in here would have made the save path the owner of the page's form state
 * - a much larger claim than this slice. So the handler moved and the state
 * stayed behind, passed down.
 *
 * WHAT LIVES WHERE: the decision - read-back diff, merged payload, which tasks
 * fire, the three-way outcome - is in ./saveDiff, which is pure (no React, no
 * IPC, no await) and therefore table-testable without renderHook. This file
 * keeps everything with an ORDER or a SIDE EFFECT in it: the five read-backs
 * and their allSettled, the per-name mapping from a firing task to its IPC
 * call, the setter mirrors, the per-task snapshot refresh, the setTimeout that
 * clears the saved flash, and the toast / notify steps. The rule those two
 * files share - a task fires iff THE PAGE EDITED the field AND the merged
 * payload differs from the read-back - is stated in full at saveDiff's header;
 * read it before simplifying either half.
 *
 * The by-name result lookup below is a FIX, not a style preference: read the
 * comment at saveTasks before ever simplifying it back to results[i].
 */
import type { Dispatch, SetStateAction } from 'react';
import type { useToast } from '@/frontend/shared/Toast';
import {
  getReceiptSettingsScoped,
  getStoreSettingsScoped,
  getUserPreferencesScoped,
  setReceiptSettingsScoped,
  setStoreSettingsScoped,
  setUserPreferencesScoped,
  setSettingScoped,
  type ReceiptSettingsDto,
  type StoreSettingsDto,
} from '@/api/settings';
import {
  getSyncSettingsScoped,
  updateSyncSettingsScoped,
  type SyncSettingsDto,
  type UpdateSyncSettingsArgs,
} from '@/api/offline';
import {
  getBrandSettingsScoped,
  setBrandPrimaryColour,
  setBrandStoreName as setBrandStoreNameApi,
} from '@/api/branding';
import {
  classifyOutcome,
  normUrl,
  planSaveTasks,
  PREF_KEYS,
  readFailedTasks,
  type Flat,
  type SaveTaskName,
  type SettingsSaveOutcome,
  type SettingsSaveSnapshot,
} from './saveDiff';

/** Exact addToast signature, taken from the Toast provider's own hook. */
type AddToast = ReturnType<typeof useToast>['addToast'];
/** The bundle handle - only getString is used, for the two save toasts. */
type GetString = { getString: (id: string) => string };

// Per-task outcome and the Revert-target shape moved to ./saveDiff (they
// describe the decision, not the orchestration); re-exported so the page and
// the suites keep importing them from this module.
export type { SettingsSaveOutcome, SettingsSaveSnapshot } from './saveDiff';

export interface UseSettingsSaveParams {
  /** ADR #7 token (nullable, as useWorkspace reports it); several writes
   *  fall back to '' exactly as the original did, and the auth_token mirror
   *  still receives the null through unchanged. */
  sessionToken: string | null;
  receipt: ReceiptSettingsDto;
  store: StoreSettingsDto;
  defaultCurrency: string;
  sync: SyncSettingsDto;
  syncServerUrl: string;
  syncApiKey: string;
  displayCardSize: number;
  displayFontSize: number;
  displayFontSmoothing: string;
  brandColour: string;
  brandStoreName: string;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setSaved: Dispatch<SetStateAction<boolean>>;
  setIsDirty: Dispatch<SetStateAction<boolean>>;
  setStore: Dispatch<SetStateAction<StoreSettingsDto>>;
  setSync: Dispatch<SetStateAction<SyncSettingsDto>>;
  setSyncApiKey: Dispatch<SetStateAction<string>>;
  /** Currency context write - the same call the old third save task made. */
  setCtxCurrency: (currency: string) => Promise<unknown>;
  /** The context-notify step. Its argument shape is what SettingsContext.test
   *  pins, so it passes through unchanged rather than being re-derived here. */
  markSettingsUpdated: (keys: string[]) => void;
  refreshBrandSettings: () => void;
  addToast: AddToast;
  l10n: GetString;
  /** The page's initialSnapshotRef: Revert must land on the SAVED state. */
  savedSnapshotRef: { current: SettingsSaveSnapshot | null };
}

/** A read that could not even be attempted (no session) - same shape as a
 *  rejected allSettled entry, so every family falls into read-failed. */
function noSession<T>(): PromiseSettledResult<T> {
  return { status: 'rejected', reason: new Error('no session token') };
}

/**
 * Builds and runs the whole save: the five read-backs, then ./saveDiff's plan
 * (one named task per setting family, each gated on "the page edited it AND the
 * merge differs from the read-back"), then the sends settled together so a
 * single failure cannot silently block the rest, then the confirmation /
 * snapshot / notify / toast steps that follow from the results.
 * Returns the handler - a plain async function, as it was in the page (no
 * useCallback, so a fresh identity per render exactly like before; the keyboard
 * shortcut keeps reading it through its own ref).
 */
export function useSettingsSave({
  sessionToken,
  receipt,
  store,
  defaultCurrency,
  sync,
  syncServerUrl,
  syncApiKey,
  displayCardSize,
  displayFontSize,
  displayFontSmoothing,
  brandColour,
  brandStoreName,
  setSaving,
  setSaved,
  setIsDirty,
  setStore,
  setSync,
  setSyncApiKey,
  setCtxCurrency,
  markSettingsUpdated,
  refreshBrandSettings,
  addToast,
  l10n,
  savedSnapshotRef,
}: UseSettingsSaveParams) {
  const handleSave = async () => {
    // Pre-hydrate means "we have never seen the server", which is NOT the same
    // as "the draft is what the server holds". Send nothing at all.
    const snapshot = savedSnapshotRef.current;
    if (!snapshot) return;

    const token = sessionToken ?? '';

    // --- 1. READ BACK ---------------------------------------------------------
    // One pass over the five sources the seven tasks write. A family whose
    // read-back fails cannot be diffed, so it cannot be written either: it is
    // reported as rejected (loudly - the user asked for a save), never silently
    // skipped, and never sent blind.
    const reads: [
      PromiseSettledResult<ReceiptSettingsDto>,
      PromiseSettledResult<StoreSettingsDto>,
      PromiseSettledResult<Record<string, string>>,
      PromiseSettledResult<SyncSettingsDto>,
      PromiseSettledResult<{ primary_colour: string; store_name: string }>,
    ] = sessionToken
      ? await Promise.allSettled([
          getReceiptSettingsScoped(token),
          getStoreSettingsScoped(token),
          getUserPreferencesScoped(token),
          getSyncSettingsScoped(token),
          getBrandSettingsScoped(token),
        ])
      : [noSession(), noSession(), noSession(), noSession(), noSession()];

    const unwrap = <T>(r: PromiseSettledResult<T>): T | null =>
      r.status === 'fulfilled' && r.value ? r.value : null;
    const serverReceipt = unwrap(reads[0]);
    const serverStore = unwrap(reads[1]);
    const serverPrefs = unwrap(reads[2]);
    const serverSync = unwrap(reads[3]);
    const serverBrand = unwrap(reads[4]);

    // --- 2. PLAN --------------------------------------------------------------
    // The whole diff / merge / fire decision, in data, with no IPC: see
    // ./saveDiff, whose header states the two-clause rule and why "differs from
    // the server" alone is the WRONG gate. The store task fuses
    // store.currency with defaultCurrency inside it, because a currency-only
    // change IS a store change.
    const planned = planSaveTasks({
      draft: {
        receipt,
        store,
        defaultCurrency,
        sync,
        syncServerUrl,
        syncApiKey,
        displayCardSize,
        displayFontSize,
        displayFontSmoothing,
        brandColour,
        brandStoreName,
      },
      saved: snapshot,
      server: {
        receipt: serverReceipt,
        store: serverStore,
        prefs: serverPrefs,
        sync: serverSync,
        brand: serverBrand,
      },
    });

    // A firing task's call, by name. Kept here (not in saveDiff) because these
    // ARE the IPC writes, and their order is the read-back order above.
    const runners: Record<SaveTaskName, (payload: Flat) => Promise<unknown>> = {
      receipt: (p) => setReceiptSettingsScoped(token, p as unknown as ReceiptSettingsDto),
      store: (p) => setStoreSettingsScoped(token, p as unknown as StoreSettingsDto),
      currency: () => setCtxCurrency(defaultCurrency),
      prefs: (p) =>
        setUserPreferencesScoped(
          token,
          PREF_KEYS.map((k) => ({ key: k, value: String(p[k]) })),
        ),
      sync: (p) => updateSyncSettingsScoped(token, p as unknown as UpdateSyncSettingsArgs),
      brandColour: () => setBrandPrimaryColour(token, brandColour),
      brandName: () => setBrandStoreNameApi(token, brandStoreName),
    };

    // --- 3. ZERO-TASK SHORT-CIRCUIT -------------------------------------------
    // Everything this page could send already matches the server. The old gate
    // (failed < saveTasks.length) read 0 < 0 as false and ended as a silent
    // do-nothing; and it must not be confused with a 1-of-1 failure, which is
    // why read-back failures are NOT folded into this branch.
    const toSend = planned.filter((t) => t.fires);
    const readFailures = readFailedTasks(planned);
    if (toSend.length === 0 && readFailures.length === 0) {
      // Nothing is dirty any more - the draft and the server agree on every
      // field Save could write - but report nothing: no saved flash, no toast.
      setIsDirty(false);
      return;
    }

    setSaving(true);
    setSaved(false);

    // Every save is named, and each later decision looks its result up BY NAME.
    //
    // This block previously read results[0] through results[6] -- seven positional
    // indices into the array literal. Adding a setting is the natural edit to make here,
    // and it shifts every index after it with nothing to notice: the changed-key list
    // would then tell SettingsContext that the WRONG keys were updated (so other
    // components refetch the wrong data and the real change stays stale), and the sync
    // DTO block below would gate on an unrelated call's success. Named lookup makes an
    // insertion harmless.
    const saveTasks: Array<readonly [SaveTaskName, Promise<unknown>]> = toSend.map(
      (t) => [t.name, runners[t.name](t.payload as Flat)] as const,
    );

    const settled = await Promise.allSettled(saveTasks.map(([, task]) => task));
    /** Three-way, by name: an omitted task is 'skipped', not false. */
    const saveOutcome = (name: SaveTaskName): SettingsSaveOutcome =>
      classifyOutcome(name, saveTasks, settled);
    const saveResult = (name: SaveTaskName): boolean => saveOutcome(name) === 'fulfilled';
    const plannedPayload = (name: SaveTaskName): Flat | null =>
      planned.find((t) => t.name === name)?.payload ?? null;

    const failed = settled.filter((r) => r.status === 'rejected').length + readFailures.length;
    const succeeded = settled.filter((r) => r.status === 'fulfilled').length;
    // A read-back failure is a failed task that never wrote: it counts towards
    // "everything failed" but never towards "at least one saved".
    const attempted = saveTasks.length + readFailures.length;

    if (succeeded > 0) {
      setIsDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Keep the page's store state on the row that actually persisted, so a
      // skipped store task cannot leave a stale draft looking saved.
      if (saveResult('store')) setStore(plannedPayload('store') as unknown as StoreSettingsDto);
      if (saveResult('sync')) {
        if (syncApiKey) {
          // Mirror the token to the shared IPC channel so the
          // Retail Options screen (useCloudSync) can load it.
          setSettingScoped(sessionToken, 'sync.auth_token', syncApiKey)
            .catch(() => { /* best-effort */ });
          setSyncApiKey('');
        }
        const sent = plannedPayload('sync') as unknown as UpdateSyncSettingsArgs | null;
        setSync((prev) => ({
          ...prev,
          serverUrl: sent && 'serverUrl' in sent ? sent.serverUrl ?? null : prev.serverUrl,
          hasApiKey: syncApiKey ? true : prev.hasApiKey,
          enabled: sent && 'enabled' in sent ? sent.enabled : prev.enabled,
        }));
      }
      refreshBrandSettings();
    }

    // --- 4. SNAPSHOT, PER TASK ------------------------------------------------
    // This used to sit inside the success branch and rewrite the WHOLE
    // snapshot, so one rejected task still committed its draft fields as saved
    // and Revert could no longer get back to the server's real values. Each
    // family now refreshes only from what is provably on the server: the merged
    // payload it persisted, or the read-back for a family that was skipped.
    if (saveOutcome('receipt') !== 'rejected' && serverReceipt) {
      snapshot.receipt = (saveResult('receipt')
        ? plannedPayload('receipt')
        : serverReceipt) as unknown as ReceiptSettingsDto;
    }
    if (saveOutcome('store') !== 'rejected' && serverStore) {
      snapshot.store = (saveResult('store')
        ? plannedPayload('store')
        : serverStore) as unknown as StoreSettingsDto;
    }
    if (saveOutcome('currency') !== 'rejected' && saveResult('currency')) {
      snapshot.defaultCurrency = defaultCurrency;
    }
    if (saveOutcome('prefs') !== 'rejected' && saveResult('prefs')) {
      const p = plannedPayload('prefs');
      if (p) {
        snapshot.displayCardSize = Number(p['cardsize']);
        snapshot.displayFontSize = Number(p['fontsize']);
        snapshot.displayFontSmoothing = String(p['font-smoothing']);
      }
    }
    if (saveOutcome('sync') !== 'rejected') {
      const sent = plannedPayload('sync') as unknown as UpdateSyncSettingsArgs | null;
      if (saveResult('sync') && sent) {
        snapshot.syncServerUrl = sent.serverUrl ?? '';
        snapshot.sync = {
          ...snapshot.sync,
          serverUrl: sent.serverUrl ?? null,
          enabled: sent.enabled,
          hasApiKey: syncApiKey ? true : snapshot.sync.hasApiKey,
        };
      } else if (serverSync) {
        // Skipped: the server still holds what it held; a draft placeholder URL
        // must not become the Revert target.
        snapshot.syncServerUrl = normUrl(serverSync.serverUrl) ?? '';
        snapshot.sync = { ...snapshot.sync, serverUrl: serverSync.serverUrl, enabled: serverSync.enabled };
      }
    }
    if (saveOutcome('brandColour') !== 'rejected') {
      snapshot.brandColour = saveResult('brandColour')
        ? brandColour
        : (serverBrand ? serverBrand.primary_colour : snapshot.brandColour);
    }
    if (saveOutcome('brandName') !== 'rejected') {
      snapshot.brandStoreName = saveResult('brandName')
        ? brandStoreName
        : (serverBrand ? serverBrand.store_name : snapshot.brandStoreName);
    }
    savedSnapshotRef.current = snapshot;

    if (failed === attempted) {
      addToast({ message: l10n.getString('settings-save-error'), type: 'error' });
    } else if (failed > 0) {
      addToast({ message: l10n.getString('settings-save-partial'), type: 'error' });
    }

    // Notify SettingsContext so other components reflect the changes. Keyed by name for
    // the reason given at saveTasks: a positional list here would silently attribute the
    // wrong keys to the wrong save the moment one is inserted.
    const updatedKeys: string[] = [];
    if (saveResult('receipt')) updatedKeys.push('receipt.footer', 'receipt.showCurrency', 'receipt.showTax', 'receipt.paperWidth', 'receipt.showTableNumber', 'receipt.decimalSeparator');
    if (saveResult('store')) updatedKeys.push('store.name', 'store.address', 'store.taxId', 'store.branch', 'store.currency');
    if (saveResult('currency')) updatedKeys.push('currency.default');
    if (saveResult('prefs')) updatedKeys.push('prefs.cardsize', 'prefs.fontsize', 'prefs.font-smoothing');
    if (saveResult('sync')) updatedKeys.push('sync.serverUrl', 'sync.apiKey', 'sync.enabled');
    if (saveResult('brandColour')) updatedKeys.push('brand.primary_colour');
    if (saveResult('brandName')) updatedKeys.push('brand.store_name');
    if (updatedKeys.length > 0) {
      markSettingsUpdated(updatedKeys);
    }

    setSaving(false);
  };

  return handleSave;
}
