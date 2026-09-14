/**
 * Settings save orchestration — the fan-out that was `handleSave` in
 * SettingsPage.tsx (settings lane slice 1). Moved verbatim: same order, same
 * names, same comments, same sequencing. Only two identifiers differ, both
 * because those values became parameters — `settingsCtx.markSettingsUpdated`
 * is now the received `markSettingsUpdated`, and the page's `initialSnapshotRef`
 * arrives as `savedSnapshotRef`. Nothing else in the body was touched.
 *
 * SEAM: values and setters are RECEIVED, not reached for, and this hook owns no
 * state — it calls no React hook at all, so the page's hook order does not move
 * either. That is a deliberate choice, not an accident: the six things this
 * handler writes (`saving`, `saved`, `isDirty`, `store`, `sync`, `syncApiKey`)
 * are all ALSO read by Revert-to-saved, the dirty dot, the close-request guard
 * and the section screens, and the snapshot it commits IS the Revert target.
 * Moving them in here would have made the save path the owner of the page's
 * form state — a much larger claim than this slice. So the handler moved and
 * the state stayed behind, passed down.
 *
 * The by-name result lookup below is a FIX, not a style preference: read the
 * comment at saveTasks before ever simplifying it back to `results[i]`.
 */
import type { Dispatch, SetStateAction } from 'react';
import type { useToast } from '@/frontend/shared/Toast';
import {
  setReceiptSettingsScoped,
  setStoreSettingsScoped,
  setUserPreferencesScoped,
  setSettingScoped,
  type ReceiptSettingsDto,
  type StoreSettingsDto,
} from '@/api/settings';
import { updateSyncSettingsScoped, type SyncSettingsDto } from '@/api/offline';
import { setBrandPrimaryColour, setBrandStoreName as setBrandStoreNameApi } from '@/api/branding';

/** Exact addToast signature, taken from the Toast provider's own hook. */
type AddToast = ReturnType<typeof useToast>['addToast'];
/** The bundle handle — only getString is used, for the two save toasts. */
type GetString = { getString: (id: string) => string };
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
  /** Currency context write — the same call the old third save task made. */
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

/**
 * Builds and runs the whole save: one named task per setting family, settled
 * together so a single failure cannot silently block the rest, then the
 * confirmation / snapshot / notify / toast steps that follow from the results.
 * Returns the handler — a plain async function, as it was in the page (no
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
    setSaving(true);
    setSaved(false);
    // Use allSettled so a single failing save doesn't silently block
    // the others — the user gets a warning about partial failures.
    // Sync store.currency with defaultCurrency so both parallel writes
    // below target the same value (prevents a race where setStoreSettings
    // overwrites the user's currency selection with the initial value).
    const syncedStore = { ...store, currency: defaultCurrency };

    // Every save is named, and each later decision looks its result up BY NAME.
    //
    // This block previously read `results[0]` through `results[6]` -- seven positional
    // indices into the array literal. Adding a setting is the natural edit to make here,
    // and it shifts every index after it with nothing to notice: `changedKeys` would then
    // tell SettingsContext that the WRONG keys were updated (so other components refetch
    // the wrong data and the real change stays stale), and the sync DTO block below would
    // gate on an unrelated call's success. Named lookup makes an insertion harmless.
    //
    // Promises are created in the same order as before, so concurrency and side-effect
    // sequencing are unchanged.
    const saveTasks: Array<readonly [string, Promise<unknown>]> = [
      ['receipt', setReceiptSettingsScoped(sessionToken ?? '', receipt)],
      ['store', setStoreSettingsScoped(sessionToken ?? '', syncedStore)],
      ['currency', setCtxCurrency(defaultCurrency)],
      // Scoped write matches the scoped read in SettingsContext: the
      // unscoped variant writes the global DB while every consumer reads
      // the store-scoped user_preferences table, so unscoped writes would
      // silently vanish on the next reload.
      [
        'prefs',
        sessionToken
          ? setUserPreferencesScoped(sessionToken, [
              { key: 'cardsize', value: String(displayCardSize) },
              { key: 'fontsize', value: String(displayFontSize) },
              { key: 'font-smoothing', value: displayFontSmoothing },
            ])
          : Promise.resolve(),
      ],
      [
        'sync',
        updateSyncSettingsScoped(sessionToken ?? '', {
          serverUrl: syncServerUrl || null,
          ...(syncApiKey ? { apiKey: syncApiKey } : {}),
          enabled: sync.enabled,
        }),
      ],
      ['brandColour', setBrandPrimaryColour(sessionToken ?? '', brandColour)],
      ['brandName', setBrandStoreNameApi(sessionToken ?? '', brandStoreName)],
    ];

    const settled = await Promise.allSettled(saveTasks.map(([, task]) => task));
    const saveResult = (name: string): boolean =>
      settled[saveTasks.findIndex(([k]) => k === name)]?.status === 'fulfilled';

    const failed = settled.filter((r) => r.status === 'rejected').length;

    // At least one save succeeded — show confirmation and refresh.
    if (failed < saveTasks.length) {
      setIsDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Sync the React store state to match what was persisted (currency).
      setStore(syncedStore);
      // Persist the sync DTO in React state so the UI immediately
      // reflects the just-saved values (server URL, API key presence,
      // enabled flag). Without this the loaded snapshot stays stale
      // until the next page reload, causing placeholder regressions
      // like "Enter API key" after saving a new key or a blank server
      // URL field after saving a URL.
      if (saveResult('sync')) {
        if (syncApiKey) {
          // Mirror the token to the shared IPC channel so the
          // Retail Options screen (useCloudSync) can load it.
          setSettingScoped(sessionToken, 'sync.auth_token', syncApiKey)
            .catch(() => { /* best-effort */ });
          setSyncApiKey('');
        }
        setSync((prev) => ({
          ...prev,
          serverUrl: syncServerUrl || null,
          hasApiKey: syncApiKey ? true : prev.hasApiKey,
          enabled: sync.enabled,
        }));
      }
      refreshBrandSettings();

      // Update the snapshot so Revert goes to the *saved* state.
      // Use syncedStore so store.currency matches what was actually persisted.
      savedSnapshotRef.current = {
        receipt,
        store: syncedStore,
        defaultCurrency,
        sync,
        syncServerUrl,
        displayCardSize,
        displayFontSize,
        displayFontSmoothing,
        brandColour,
        brandStoreName,
      };
    }

    if (failed === saveTasks.length) {
      addToast({ message: l10n.getString('settings-save-error'), type: 'error' });
    } else if (failed > 0) {
      addToast({ message: l10n.getString('settings-save-partial'), type: 'error' });
    }

    // Notify SettingsContext so other components reflect the changes. Keyed by name for
    // the reason given at saveTasks: a positional list here would silently attribute the
    // wrong keys to the wrong save the moment one is inserted.
    const changedKeys: string[] = [];
    if (saveResult('receipt')) changedKeys.push('receipt.footer', 'receipt.showCurrency', 'receipt.showTax', 'receipt.paperWidth', 'receipt.showTableNumber', 'receipt.decimalSeparator');
    if (saveResult('store')) changedKeys.push('store.name', 'store.address', 'store.taxId', 'store.branch', 'store.currency');
    if (saveResult('currency')) changedKeys.push('currency.default');
    if (saveResult('prefs')) changedKeys.push('prefs.cardsize', 'prefs.fontsize', 'prefs.font-smoothing');
    if (saveResult('sync')) changedKeys.push('sync.serverUrl', 'sync.apiKey', 'sync.enabled');
    if (saveResult('brandColour')) changedKeys.push('brand.primary_colour');
    if (saveResult('brandName')) changedKeys.push('brand.store_name');
    if (changedKeys.length > 0) {
      markSettingsUpdated(changedKeys);
    }

    setSaving(false);
  };

  return handleSave;
}
