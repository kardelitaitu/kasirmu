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
 * The by-name result lookup below is a FIX, not a style preference: read the
 * comment at saveTasks before ever simplifying it back to results[i].
 *
 * --- SAFETY: read-back / diff / merge, i.e. why Save cannot lose data --------
 *
 * Every task used to send the WHOLE draft DTO. The backend writes those DTOs
 * field-by-field unconditionally: run_set_receipt_settings re-stamps ten flat
 * keys (crates/oz-bridge/src/settings.rs:997-1007, tax_rounding_mode included),
 * run_set_store_settings stamps all six in one transaction (:1021-1026), and
 * update_sync_settings_data (crates/oz-bridge/src/sync.rs:64-82) does
 * server_url.as_deref().unwrap_or("") and writes it UNCONDITIONALLY, so a null
 * there CLEARS a configured URL. Only api_key is guarded with if let Some(..),
 * which is why an absent key preserves the stored one while an absent URL does
 * not. So any field the draft happened not to carry was written anyway, with
 * the draft's (possibly stale) value.
 *
 * That was reachable, not theoretical. switchOrganization
 * (contexts/WorkspaceContext.tsx:353-364) swaps sessionToken IN PLACE after a
 * PIN re-auth - no login screen, no unmount. SettingsContext refetches and
 * republishes store/currency, the page's currency effect follows, but the DRAFT
 * keeps the previous org's name/address/taxId/branch, because hydrate is
 * one-shot (SettingsPage.tsx, gated on !loading && !initialized, on purpose: a
 * later refetch must not eat the user's edits). One Ctrl+S then stamped the NEW
 * tenant's store row with the OLD tenant's identity. A partial load was the
 * second path: a failed sync read left syncServerUrl === '', and an untouched
 * Save cleared a configured URL.
 *
 * The fix, entirely inside this file: before composing a task, READ BACK what
 * the server holds for that family and send only the read-back merged with the
 * fields THE PAGE ACTUALLY CHANGED (draft vs savedSnapshotRef, the Revert
 * target - the page's own record of what the user edited). A task fires only
 * when that merged payload differs from the read-back, so:
 *   * an unchanged field is written back as the server's own value, or not
 *     written at all (the task is skipped) - never as a stale draft;
 *   * a stale whole-DTO draft cannot overwrite a new tenant's row, because the
 *     page changed none of its fields, so the merged payload equals the
 *     read-back and nothing fires;
 *   * savedSnapshotRef.current === null (pre-hydrate) means WRITE NOTHING:
 *     there is one reachable render where the save bar exists before hydrate.
 *
 * Consequences callers of this file must know:
 *   * Skipped is a third outcome, not a failure - see SettingsSaveOutcome. The
 *     task list may therefore be empty, and the handler short-circuits quietly
 *     instead of reporting a save that did nothing.
 *   * The snapshot is refreshed PER TASK, from what is provably on the server
 *     now - never wholesale from the draft, which is how a partial failure used
 *     to commit every draft value as saved.
 *
 * The durable fix is a partial-write command server-side (send only the keys
 * you changed). Until then the read-back costs ~5 extra IPC reads per Save;
 * that is the price of not losing a tenant's identity, and it stays bounded by
 * this file.
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

/** Exact addToast signature, taken from the Toast provider's own hook. */
type AddToast = ReturnType<typeof useToast>['addToast'];
/** The bundle handle - only getString is used, for the two save toasts. */
type GetString = { getString: (id: string) => string };

/**
 * Per-task outcome. skipped is deliberately NOT a failure: it means the payload
 * this page could produce equals what the server already holds (or the page
 * changed nothing in that family), so there was nothing to write. It is a
 * distinct state because the by-name lookup used to read an omitted task as
 * false = failed, and because "Save wrote nothing" must not be encoded as
 * "Save failed".
 */
export type SettingsSaveOutcome = 'fulfilled' | 'rejected' | 'skipped';

/**
 * The Revert target. Field-for-field the page's own SettingsSnapshot, restated
 * here because that interface is local to SettingsPage.tsx and this slice
 * neither widens it nor exports it.
 */
export interface SettingsSaveSnapshot {
  receipt: ReceiptSettingsDto;
  store: StoreSettingsDto;
  defaultCurrency: string;
  sync: SyncSettingsDto;
  syncServerUrl: string;
  displayCardSize: number;
  displayFontSize: number;
  displayFontSmoothing: string;
  brandColour: string;
  brandStoreName: string;
}

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

/** Loose view of a DTO, for generic key-wise diffing / merging. */
type Flat = Record<string, unknown>;

/** Keys whose draft value differs from base. Only keys the draft carries. */
function changedKeys(draft: Flat, base: Flat): string[] {
  return Object.keys(draft).filter((k) => draft[k] !== base[k]);
}

/** base plus only the listed draft keys - the merged payload. */
function mergeChanged(base: Flat, draft: Flat, keys: string[]): Flat {
  const out: Flat = { ...base };
  for (const k of keys) out[k] = draft[k];
  return out;
}

/** A read that could not even be attempted (no session) - same shape as a
 *  rejected allSettled entry, so every family falls into readFailed. */
function noSession<T>(): PromiseSettledResult<T> {
  return { status: 'rejected', reason: new Error('no session token') };
}

/** '' and whitespace are the same server state as null; keep them from reading
 *  as an edit (the sync URL is written unconditionally server-side). */
function normUrl(v: string | null | undefined): string | null {
  return v && v.trim() ? v : null;
}

/**
 * Builds and runs the whole save: one named task per setting family, each gated
 * on a read-back diff (see the file header), settled together so a single
 * failure cannot silently block the rest, then the confirmation / snapshot /
 * notify / toast steps that follow from the results.
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

    // Sync store.currency with defaultCurrency so the store diff and the
    // currency diff are computed on ONE fused value: the store write stamps the
    // currency column (settings.rs:1024) and the currency task writes that same
    // column, so a currency-only edit must count as a store change too -
    // otherwise the two writers split and one re-stamps the old code.
    const syncedStore: StoreSettingsDto = { ...store, currency: defaultCurrency };

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

    /** One planned task. payload null + run null = skipped. */
    type Planned = {
      name: string;
      payload: Flat | null;
      readFailed: boolean;
      run: ((payload: Flat) => Promise<unknown>) | null;
    };
    const planned: Planned[] = [];

    // --- 2. PLAN: diff against the server, merge only the page's edits --------
    const addDtoTask = <T extends object>(opts: {
      name: string;
      server: T | null;
      draft: Flat;
      saved: Flat;
      run: (payload: T) => Promise<unknown>;
    }) => {
      if (!opts.server) {
        planned.push({ name: opts.name, payload: null, readFailed: true, run: null });
        return;
      }
      const pageEdits = changedKeys(opts.draft, opts.saved);
      const payload = mergeChanged(opts.server as Flat, opts.draft, pageEdits);
      const fires = changedKeys(payload, opts.server as Flat).length > 0;
      planned.push({
        name: opts.name,
        payload: fires ? payload : null,
        readFailed: false,
        run: fires ? (p) => opts.run(p as unknown as T) : null,
      });
    };

    addDtoTask({
      name: 'receipt',
      server: serverReceipt,
      draft: { ...receipt } as Flat,
      saved: { ...snapshot.receipt } as Flat,
      run: (p) => setReceiptSettingsScoped(token, p),
    });

    addDtoTask({
      name: 'store',
      server: serverStore,
      // FUSED value, never store alone (see the sync above): a currency-only
      // change IS a store change. A key the page does not carry (logo) is not
      // in the draft, so it stays at the server's value.
      draft: { ...syncedStore } as Flat,
      saved: { ...snapshot.store, currency: snapshot.defaultCurrency } as Flat,
      run: (p) => setStoreSettingsScoped(token, p),
    });

    // Currency: the same column as store.currency, written through the context.
    // Single-value write, so "merged payload" is the server's code unless the
    // page edited it - which is why a currency that merely drifted (an org
    // switch, a partial load) can never be pushed into the tenant's row.
    if (!serverStore) {
      planned.push({ name: 'currency', payload: null, readFailed: true, run: null });
    } else {
      const currencyEdited = defaultCurrency !== snapshot.defaultCurrency;
      const currencyDiffers = defaultCurrency !== (serverStore.currency ?? null);
      const fires = currencyEdited && currencyDiffers;
      planned.push({
        name: 'currency',
        payload: fires ? { currency: defaultCurrency } : null,
        readFailed: false,
        run: fires ? () => setCtxCurrency(defaultCurrency) : null,
      });
    }

    // Preferences: three string keys on the server, numbers in the draft.
    const prefKeys = ['cardsize', 'fontsize', 'font-smoothing'] as const;
    if (!serverPrefs) {
      planned.push({ name: 'prefs', payload: null, readFailed: true, run: null });
    } else {
      const draftPrefs: Flat = {
        cardsize: String(displayCardSize),
        fontsize: String(displayFontSize),
        'font-smoothing': displayFontSmoothing,
      };
      const savedPrefs: Flat = {
        cardsize: String(snapshot.displayCardSize),
        fontsize: String(snapshot.displayFontSize),
        'font-smoothing': snapshot.displayFontSmoothing,
      };
      const mergedPrefs: Flat = {};
      for (const k of prefKeys) {
        const serverVal = serverPrefs[k];
        mergedPrefs[k] = draftPrefs[k] !== savedPrefs[k]
          ? draftPrefs[k]
          : (serverVal ?? draftPrefs[k]);
      }
      const fires = prefKeys.some((k) => mergedPrefs[k] !== serverPrefs[k]);
      planned.push({
        name: 'prefs',
        payload: fires ? mergedPrefs : null,
        readFailed: false,
        run: fires
          ? (p) => setUserPreferencesScoped(token, prefKeys.map((k) => ({ key: k, value: String(p[k]) })))
          : null,
      });
    }

    // Sync: serverUrl is written UNCONDITIONALLY server-side, so the merged
    // payload has to carry the server's own URL unless the page edited the
    // field - that is what stops a partial load (empty draft URL) from clearing
    // a configured one. apiKey is still only sent when the user typed one.
    if (!serverSync) {
      planned.push({ name: 'sync', payload: null, readFailed: true, run: null });
    } else {
      const draftUrl = normUrl(syncServerUrl);
      const savedUrl = normUrl(snapshot.syncServerUrl);
      const serverUrl = normUrl(serverSync.serverUrl);
      const typedKey = syncApiKey !== '';
      const payload: UpdateSyncSettingsArgs = {
        serverUrl: draftUrl !== savedUrl ? draftUrl : serverUrl,
        enabled: sync.enabled !== snapshot.sync.enabled ? sync.enabled : serverSync.enabled,
      };
      if (typedKey) payload.apiKey = syncApiKey;
      const fires =
        typedKey || payload.serverUrl !== serverUrl || payload.enabled !== serverSync.enabled;
      planned.push({
        name: 'sync',
        payload: fires ? ({ ...payload } as Flat) : null,
        readFailed: false,
        run: fires ? (p) => updateSyncSettingsScoped(token, p as unknown as UpdateSyncSettingsArgs) : null,
      });
    }

    // Brand: two independent single-column writes; each one merges to the
    // server's value unless the page edited it.
    if (!serverBrand) {
      planned.push({ name: 'brandColour', payload: null, readFailed: true, run: null });
      planned.push({ name: 'brandName', payload: null, readFailed: true, run: null });
    } else {
      const colourFires =
        brandColour !== snapshot.brandColour && brandColour !== serverBrand.primary_colour;
      const nameFires =
        brandStoreName !== snapshot.brandStoreName && brandStoreName !== serverBrand.store_name;
      planned.push({
        name: 'brandColour',
        payload: colourFires ? { value: brandColour } : null,
        readFailed: false,
        run: colourFires ? () => setBrandPrimaryColour(token, brandColour) : null,
      });
      planned.push({
        name: 'brandName',
        payload: nameFires ? { value: brandStoreName } : null,
        readFailed: false,
        run: nameFires ? () => setBrandStoreNameApi(token, brandStoreName) : null,
      });
    }

    // --- 3. ZERO-TASK SHORT-CIRCUIT -------------------------------------------
    // Everything this page could send already matches the server. The old gate
    // (failed < saveTasks.length) read 0 < 0 as false and ended as a silent
    // do-nothing; and it must not be confused with a 1-of-1 failure, which is
    // why read-back failures are NOT folded into this branch.
    const toSend = planned.filter((t) => t.run !== null);
    const readFailures = planned.filter((t) => t.readFailed);
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
    const saveTasks: Array<readonly [string, Promise<unknown>]> = toSend.map(
      (t) => [t.name, t.run!(t.payload as Flat)] as const,
    );

    const settled = await Promise.allSettled(saveTasks.map(([, task]) => task));
    /** Three-way, by name: an omitted task is 'skipped', not false. */
    const saveOutcome = (name: string): SettingsSaveOutcome => {
      const idx = saveTasks.findIndex(([k]) => k === name);
      if (idx < 0) return 'skipped';
      return settled[idx] && settled[idx].status === 'fulfilled' ? 'fulfilled' : 'rejected';
    };
    const saveResult = (name: string): boolean => saveOutcome(name) === 'fulfilled';
    const plannedPayload = (name: string): Flat | null =>
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
