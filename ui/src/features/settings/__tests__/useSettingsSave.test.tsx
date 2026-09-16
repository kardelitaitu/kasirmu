/**
 * useSettingsSave - the read-back / diff / merge contract.
 *
 * This hook had NO dedicated suite before the org-switch data-loss dispatch: its
 * entire coverage was SettingsPage.test.tsx, which drives it through the page
 * and can only assert WHICH commands ran, never what a task carried. The hazard
 * was exactly a payload problem (a whole DTO sent with fields the page never
 * edited), so every case here asserts payload values.
 *
 * It also carries the coverage the PAGE suite had to give up: after the flat-IA
 * rebuild SettingsPage owns no draft inputs, so an edit-then-write, an
 * in-flight save and a partial save are no longer constructible at page level.
 * They are constructible here, where a draft change is just an argument.
 *
 * The API layer is mocked at module scope, so each expectation is a statement
 * about what Save tried to persist - no invoke names, no positional tuples.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import type { ReceiptSettingsDto, StoreSettingsDto } from '@/api/settings';
import type { SyncSettingsDto } from '@/api/offline';
import type { BrandSettings } from '@/api/branding';
import { useSettingsSave, type SettingsSaveSnapshot } from '../hooks/useSettingsSave';

// ── fakes ──────────────────────────────────────────────────────────────
const api = vi.hoisted(() => ({
  getReceipt: vi.fn(),
  getStore: vi.fn(),
  getPrefs: vi.fn(),
  getSync: vi.fn(),
  getBrand: vi.fn(),
  setReceipt: vi.fn(),
  setStore: vi.fn(),
  setPrefs: vi.fn(),
  setSync: vi.fn(),
  setBrandColour: vi.fn(),
  setBrandName: vi.fn(),
  setSetting: vi.fn(),
}));

vi.mock('@/api/settings', () => ({
  getReceiptSettingsScoped: (...a: unknown[]) => api.getReceipt(...a),
  getStoreSettingsScoped: (...a: unknown[]) => api.getStore(...a),
  getUserPreferencesScoped: (...a: unknown[]) => api.getPrefs(...a),
  setReceiptSettingsScoped: (...a: unknown[]) => api.setReceipt(...a),
  setStoreSettingsScoped: (...a: unknown[]) => api.setStore(...a),
  setUserPreferencesScoped: (...a: unknown[]) => api.setPrefs(...a),
  setSettingScoped: (...a: unknown[]) => api.setSetting(...a),
}));

vi.mock('@/api/offline', () => ({
  getSyncSettingsScoped: (...a: unknown[]) => api.getSync(...a),
  updateSyncSettingsScoped: (...a: unknown[]) => api.setSync(...a),
}));

vi.mock('@/api/branding', () => ({
  getBrandSettingsScoped: (...a: unknown[]) => api.getBrand(...a),
  setBrandPrimaryColour: (...a: unknown[]) => api.setBrandColour(...a),
  setBrandStoreName: (...a: unknown[]) => api.setBrandName(...a),
}));

// ── ORG A: what the page hydrated from ─────────────────────────────────
const RECEIPT_A: ReceiptSettingsDto = {
  showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: 'thanks',
  paperWidth: 'standard', showTableNumber: false,
  marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
};
const STORE_A: StoreSettingsDto = {
  name: 'Org A', address: 'Jl. Lama 1', taxId: 'TAX-A', branch: 'A-1', currency: 'IDR', logo: 'a.png',
};
const SYNC_A: SyncSettingsDto = { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true };
const BRAND_A: BrandSettings = { primary_colour: '#147EFB', logo_path: null, store_name: 'Org A' };

// ── ORG B: what the server holds after switchOrganization ──────────────
const STORE_B: StoreSettingsDto = {
  name: 'Org B', address: 'Jl. Baru 9', taxId: 'TAX-B', branch: 'B-2', currency: 'SGD',
};
const RECEIPT_B: ReceiptSettingsDto = { ...RECEIPT_A, taxRoundingMode: 'truncate' };
const SYNC_B: SyncSettingsDto = { serverUrl: 'https://tenant-b.example.com', hasApiKey: false, enabled: false };
const BRAND_B: BrandSettings = { primary_colour: '#ff0000', logo_path: null, store_name: 'Org B' };

function snapshotOf(over: Partial<SettingsSaveSnapshot> = {}): SettingsSaveSnapshot {
  return {
    receipt: RECEIPT_A,
    store: STORE_A,
    defaultCurrency: 'IDR',
    sync: SYNC_A,
    syncServerUrl: 'https://sync.example.com',
    displayCardSize: 2,
    displayFontSize: 1,
    displayFontSmoothing: 'antialiased',
    brandColour: '#147EFB',
    brandStoreName: 'Org A',
    ...over,
  };
}

interface Draft {
  receipt: ReceiptSettingsDto;
  store: StoreSettingsDto;
  defaultCurrency: string;
  sync: SyncSettingsDto;
  syncServerUrl: string;
  syncApiKey: string;
  cardSize: number;
  fontSize: number;
  fontSmoothing: string;
  colour: string;
  brandName: string;
}
const DRAFT_A: Draft = {
  receipt: RECEIPT_A, store: STORE_A, defaultCurrency: 'IDR', sync: SYNC_A,
  syncServerUrl: 'https://sync.example.com', syncApiKey: '',
  cardSize: 2, fontSize: 1, fontSmoothing: 'antialiased',
  colour: '#147EFB', brandName: 'Org A',
};

/** Server state the read-backs return. Defaults: exactly ORG A, i.e. clean. */
interface Server {
  receipt: ReceiptSettingsDto; store: StoreSettingsDto; prefs: Record<string, string>;
  sync: SyncSettingsDto; brand: BrandSettings;
}
const SERVER_A: Server = {
  receipt: RECEIPT_A, store: STORE_A,
  prefs: { cardsize: '2', fontsize: '1', 'font-smoothing': 'antialiased' },
  sync: SYNC_A, brand: BRAND_A,
};

/** Task name -> the api mock that call is counted on. */
const WRITE_FNS: Record<string, { mock: { calls: unknown[] } }> = {
  receipt: api.setReceipt, store: api.setStore, prefs: api.setPrefs, sync: api.setSync,
  brandColour: api.setBrandColour, brandName: api.setBrandName,
};
const ALL_WRITES = Object.keys(WRITE_FNS);

function setup(opts: {
  draft?: Partial<Draft>;
  server?: Partial<Server>;
  snapshot?: SettingsSaveSnapshot | null;
  failWrites?: string[];
  /** Write names whose promise never settles (an in-flight save). */
  hangWrites?: string[];
  sessionToken?: string | null;
}) {
  const draft: Draft = { ...DRAFT_A, ...opts.draft };
  const server: Server = { ...SERVER_A, ...opts.server };
  const fail = new Set(opts.failWrites ?? []);
  const hang = new Set(opts.hangWrites ?? []);
  const maybe = (name: string) => (): Promise<unknown> => {
    if (hang.has(name)) return new Promise<never>(() => {});
    return fail.has(name) ? Promise.reject(new Error(name)) : Promise.resolve();
  };

  api.getReceipt.mockImplementation(() => Promise.resolve(server.receipt));
  api.getStore.mockImplementation(() => Promise.resolve(server.store));
  api.getPrefs.mockImplementation(() => Promise.resolve(server.prefs));
  api.getSync.mockImplementation(() => Promise.resolve(server.sync));
  api.getBrand.mockImplementation(() => Promise.resolve(server.brand));
  api.setReceipt.mockImplementation(maybe('receipt'));
  api.setStore.mockImplementation(maybe('store'));
  api.setPrefs.mockImplementation(maybe('prefs'));
  api.setSync.mockImplementation(maybe('sync'));
  api.setBrandColour.mockImplementation(maybe('brandColour'));
  api.setBrandName.mockImplementation(maybe('brandName'));
  api.setSetting.mockImplementation(() => Promise.resolve());

  const snapshotRef = { current: opts.snapshot === undefined ? snapshotOf() : opts.snapshot };
  const setCtxCurrency = vi.fn(() => (hang.has('currency')
    ? new Promise<never>(() => {})
    : (fail.has('currency') ? Promise.reject(new Error('currency')) : Promise.resolve())));
  const markSettingsUpdated = vi.fn();
  const addToast = vi.fn();
  const setSaving = vi.fn();
  const setSaved = vi.fn();
  const setIsDirty = vi.fn();
  const setStoreState = vi.fn();
  const setSyncState = vi.fn();
  const setSyncApiKey = vi.fn();
  const l10n = { getString: (id: string) => id };

  const { result } = renderHook(() => useSettingsSave({
    sessionToken: opts.sessionToken === undefined ? 'tok' : opts.sessionToken,
    receipt: draft.receipt,
    store: draft.store,
    defaultCurrency: draft.defaultCurrency,
    sync: draft.sync,
    syncServerUrl: draft.syncServerUrl,
    syncApiKey: draft.syncApiKey,
    displayCardSize: draft.cardSize,
    displayFontSize: draft.fontSize,
    displayFontSmoothing: draft.fontSmoothing,
    brandColour: draft.colour,
    brandStoreName: draft.brandName,
    setSaving, setSaved, setIsDirty,
    setStore: setStoreState, setSync: setSyncState, setSyncApiKey,
    setCtxCurrency, markSettingsUpdated,
    refreshBrandSettings: vi.fn(),
    addToast: addToast as never,
    l10n,
    savedSnapshotRef: snapshotRef,
  }));

  const calledWrites = () => ALL_WRITES.filter((n) => (WRITE_FNS[n]!.mock.calls.length > 0))
    .concat(setCtxCurrency.mock.calls.length > 0 ? ['currency'] : []);

  return {
    run: () => act(async () => { await result.current(); }),
    raw: () => result.current(),
    snapshotRef, setCtxCurrency, markSettingsUpdated, addToast, setSaving, setSaved,
    setIsDirty, setStoreState, setSyncState, calledWrites,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. THE ORG SWITCH: a stale draft must not follow the token ─────────
describe('useSettingsSave across an organization switch', () => {
  it('does not write the previous org identity into the new tenant row', async () => {
    // switchOrganization replaced the token in place; SettingsContext refetched
    // and republished ORG B and the page's currency effect followed - while the
    // DRAFT still held ORG A name/address/taxId/branch. No unmount happened.
    const s = setup({
      draft: { defaultCurrency: 'SGD' },
      server: { store: STORE_B, receipt: RECEIPT_B, sync: SYNC_B, brand: BRAND_B },
    });
    await s.run();
    expect(s.calledWrites()).toEqual([]);
    expect(s.addToast).not.toHaveBeenCalled();
  });

  it('leaves receipt.tax_rounding_mode alone when no receipt field was edited', async () => {
    // set_receipt re-stamps all ten flat keys, taxRoundingMode included, so an
    // untouched write would silently reset the new tenant's rounding mode.
    const s = setup({
      draft: { defaultCurrency: 'SGD' },
      server: { store: STORE_B, receipt: RECEIPT_B, sync: SYNC_B, brand: BRAND_B },
    });
    await s.run();
    expect(api.setReceipt).not.toHaveBeenCalled();
    expect(s.markSettingsUpdated).not.toHaveBeenCalled();
  });

  it('merges a real edit onto the NEW tenant row instead of the draft DTO', async () => {
    // Same switch, but now the operator genuinely renames the store: only the
    // name may move, and it moves onto the ORG B row.
    const s = setup({
      draft: { store: { ...STORE_A, name: 'Org A renamed' } },
      server: { store: STORE_B, receipt: RECEIPT_B, sync: SYNC_B, brand: BRAND_B },
    });
    await s.run();
    expect(api.setStore).toHaveBeenCalledTimes(1);
    const sent = api.setStore.mock.calls[0]![1] as StoreSettingsDto;
    expect(sent.name).toBe('Org A renamed');
    expect(sent.address).toBe('Jl. Baru 9');
    expect(sent.taxId).toBe('TAX-B');
    expect(sent.branch).toBe('B-2');
    expect(sent.currency).toBe('SGD');
    expect(api.setReceipt).not.toHaveBeenCalled();
    expect(api.setBrandColour).not.toHaveBeenCalled();
    expect(s.markSettingsUpdated).toHaveBeenCalledTimes(1);
    expect(s.markSettingsUpdated.mock.calls[0]![0]).toContain('store.name');
    expect(s.markSettingsUpdated.mock.calls[0]![0]).not.toContain('receipt.footer');
  });
});

// ── 2. CLEAN SAVE (moved here from SettingsPage.test.tsx) ──────────────
describe('useSettingsSave on an untouched page', () => {
  it('writes nothing and says nothing', async () => {
    const s = setup({});
    await s.run();
    expect(s.calledWrites()).toEqual([]);
    expect(s.setSaving).not.toHaveBeenCalled();
    expect(s.setSaved).not.toHaveBeenCalled();
    expect(s.addToast).not.toHaveBeenCalled();
    // Nothing left to save is still the truth, so the dot goes away.
    expect(s.setIsDirty).toHaveBeenCalledWith(false);
  });

  it('fires neither writer when the fused currency already matches the row', async () => {
    // store and currency stamp the SAME column: a clean page must not write it.
    const s = setup({ server: { store: { ...STORE_A, currency: 'IDR' } } });
    await s.run();
    expect(api.setStore).not.toHaveBeenCalled();
    expect(s.setCtxCurrency).not.toHaveBeenCalled();
  });

  it('writes nothing when there is no session token to read back with', async () => {
    const s = setup({ draft: { store: { ...STORE_A, branch: 'A-9' } }, sessionToken: null });
    await s.run();
    expect(api.getStore).not.toHaveBeenCalled();
    expect(api.setStore).not.toHaveBeenCalled();
    // An unanswered read-back is a failure, never a silent skip.
    expect(s.addToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'settings-save-error' }));
  });
});

// ── 3. PARTIAL LOAD ────────────────────────────────────────────────────
describe('useSettingsSave after a partial load', () => {
  it('does not clear a configured sync server URL', async () => {
    // hasPartialError left the sync draft empty while the server holds a URL.
    const s = setup({
      draft: { sync: { serverUrl: null, hasApiKey: false, enabled: false }, syncServerUrl: '' },
      snapshot: snapshotOf({ syncServerUrl: '', sync: { serverUrl: null, hasApiKey: false, enabled: false } }),
      server: { sync: SYNC_A },
    });
    await s.run();
    expect(api.setSync).not.toHaveBeenCalled();
    expect(s.snapshotRef.current!.syncServerUrl).toBe('');
  });

  it('keeps the server URL on a sync payload the user did edit', async () => {
    const s = setup({ draft: { syncApiKey: 'secret-key' }, server: { sync: SYNC_A } });
    await s.run();
    expect(api.setSync).toHaveBeenCalledTimes(1);
    expect(api.setSync.mock.calls[0]![1]).toEqual({
      serverUrl: 'https://sync.example.com', enabled: true, apiKey: 'secret-key',
    });
  });
});

// ── 4. PRE-HYDRATE ─────────────────────────────────────────────────────
describe('useSettingsSave before hydrate', () => {
  it('writes nothing when there is no saved snapshot', async () => {
    const s = setup({ snapshot: null });
    await s.run();
    expect(api.getStore).not.toHaveBeenCalled();
    expect(s.calledWrites()).toEqual([]);
    expect(s.setSaving).not.toHaveBeenCalled();
  });
});

// ── 5. SKIPPED IS NOT A FAILURE ────────────────────────────────────────
describe('useSettingsSave result reporting', () => {
  it('reports a 1-of-1 failure as an error, not as a no-op', async () => {
    const s = setup({ draft: { colour: '#00ff00' }, failWrites: ['brandColour'] });
    await s.run();
    expect(s.addToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'settings-save-error' }));
    // STATE, not calls: setSaved(false) legitimately opens every real save.
    expect(s.setSaved).not.toHaveBeenCalledWith(true);
    expect(s.markSettingsUpdated).not.toHaveBeenCalled();
  });

  it('reports every task failing as an error even when all seven fire', async () => {
    const s = setup({
      draft: {
        receipt: { ...RECEIPT_A, footer: 'edited' },
        store: { ...STORE_A, branch: 'A-9' },
        defaultCurrency: 'EUR',
        cardSize: 3,
        syncApiKey: 'k',
        colour: '#00ff00',
        brandName: 'New Name',
      },
      failWrites: [...ALL_WRITES, 'currency'],
    });
    await s.run();
    expect(s.calledWrites().length).toBe(7);
    expect(s.addToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'settings-save-error' }));
    expect(s.setSaved).not.toHaveBeenCalledWith(true);
    // Nothing persisted, so nothing may look saved to Revert.
    expect(s.snapshotRef.current!.store.branch).toBe('A-1');
  });

  it('does not call a skipped task a failure', async () => {
    const s = setup({ draft: { store: { ...STORE_A, branch: 'A-9' } } });
    await s.run();
    expect(s.addToast).not.toHaveBeenCalled();
    expect(s.setSaved).toHaveBeenCalledWith(true);
    expect(s.markSettingsUpdated).toHaveBeenCalledTimes(1);
    expect(s.markSettingsUpdated.mock.calls[0]![0]).toEqual([
      'store.name', 'store.address', 'store.taxId', 'store.branch', 'store.currency',
    ]);
  });

  it('refreshes the snapshot per task, not wholesale', async () => {
    const s = setup({
      draft: { store: { ...STORE_A, branch: 'A-9' }, colour: '#00ff00' },
      failWrites: ['brandColour'],
    });
    await s.run();
    expect(s.snapshotRef.current!.store.branch).toBe('A-9');
    // A failed brand write must not be committed as saved: Revert still has to
    // be able to get back to the server colour.
    expect(s.snapshotRef.current!.brandColour).toBe('#147EFB');
    expect(s.addToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'settings-save-partial' }));
  });

  it('brackets only real writes with the saving state', async () => {
    // The page's aria-busy save-button contract (SettingsTopbar loading=saving)
    // now depends on this, because an untouched page never enters saving.
    const s = setup({ draft: { store: { ...STORE_A, branch: 'A-9' } }, hangWrites: ['store'] });
    let started: Promise<unknown> | undefined;
    await act(async () => {
      started = s.raw();
      // Let the read-backs and the task creation drain; the write stays parked.
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(s.setSaving).toHaveBeenCalledWith(true);
    expect(s.setSaving).not.toHaveBeenCalledWith(false);
    // STATE, not calls: opening a real save clears any previous saved flash.
    expect(s.setSaved).toHaveBeenCalledWith(false);
    expect(s.setSaved).not.toHaveBeenCalledWith(true);
    expect(started).toBeDefined();
  });
});

// ── 6. A REAL EDIT STILL SAVES ─────────────────────────────────────────
describe('useSettingsSave with genuine edits', () => {
  it('sends only the edited receipt fields over the server copy', async () => {
    const s = setup({ draft: { receipt: { ...RECEIPT_A, footer: 'see you' } }, server: { receipt: RECEIPT_B } });
    await s.run();
    expect(api.setReceipt).toHaveBeenCalledTimes(1);
    const sent = api.setReceipt.mock.calls[0]![1] as ReceiptSettingsDto;
    expect(sent.footer).toBe('see you');
    expect(sent.taxRoundingMode).toBe('truncate');
  });

  it('treats a currency-only change as a store change too', async () => {
    const s = setup({ draft: { defaultCurrency: 'EUR' } });
    await s.run();
    expect(s.setCtxCurrency).toHaveBeenCalledWith('EUR');
    expect(api.setStore).toHaveBeenCalledTimes(1);
    expect((api.setStore.mock.calls[0]![1] as StoreSettingsDto).currency).toBe('EUR');
  });

  it('writes prefs from the merged value and mirrors them into the snapshot', async () => {
    const s = setup({ draft: { cardSize: 3 } });
    await s.run();
    expect(api.setPrefs).toHaveBeenCalledTimes(1);
    expect(api.setPrefs.mock.calls[0]![1]).toEqual([
      { key: 'cardsize', value: '3' },
      { key: 'fontsize', value: '1' },
      { key: 'font-smoothing', value: 'antialiased' },
    ]);
    expect(s.snapshotRef.current!.displayCardSize).toBe(3);
  });
});
