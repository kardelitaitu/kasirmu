/**
 * saveDiff - the pure half of the settings save, tested as DATA.
 *
 * These cases exist because the split made the fire/skip decision callable
 * without renderHook, without vi.mock and without the Tauri bridge: no api
 * module is loaded here at all (saveDiff imports types only), so a failure
 * points at the rule rather than at a fake. The hook suite keeps its 17 cases
 * untouched - nothing here replaces them; this adds the table form of the same
 * contract, one row per clause of 'a task fires iff THE PAGE EDITED that field
 * AND the merged payload differs from the read-back'.
 */
import { describe, expect, it } from 'vitest';

import type { ReceiptSettingsDto, StoreSettingsDto } from '@/api/settings';
import type { SyncSettingsDto } from '@/api/offline';
import {
  changedKeys,
  classifyOutcome,
  firingTaskNames,
  mergeChanged,
  normUrl,
  planSaveTasks,
  readFailedTasks,
  type SavePlanDraft,
  type SavePlanServer,
  type SaveTaskName,
  type SettingsSaveSnapshot,
} from '../hooks/saveDiff';

const RECEIPT: ReceiptSettingsDto = {
  showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: 'thanks',
  paperWidth: 'standard', showTableNumber: false,
  marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
};
const STORE: StoreSettingsDto = {
  name: 'Org A', address: 'Jl. Lama 1', taxId: 'TAX-A', branch: 'A-1', currency: 'IDR', logo: 'a.png',
};
const SYNC: SyncSettingsDto = { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: true, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' };
const BRAND = { primary_colour: '#147EFB', store_name: 'Org A' };
const PREFS: Record<string, string> = { cardsize: '2', fontsize: '1', 'font-smoothing': 'antialiased' };

/** Draft and Revert target start identical: 'nothing edited yet'. */
function baseDraft(over: Partial<SavePlanDraft> = {}): SavePlanDraft {
  return {
    receipt: RECEIPT, store: STORE, defaultCurrency: 'IDR', sync: SYNC,
    syncServerUrl: 'https://sync.example.com', syncApiKey: '',
    displayCardSize: 2, displayFontSize: 1, displayFontSmoothing: 'antialiased',
    brandColour: '#147EFB', brandStoreName: 'Org A',
    ...over,
  };
}
function baseSaved(over: Partial<SettingsSaveSnapshot> = {}): SettingsSaveSnapshot {
  return {
    receipt: RECEIPT, store: STORE, defaultCurrency: 'IDR', sync: SYNC,
    syncServerUrl: 'https://sync.example.com',
    displayCardSize: 2, displayFontSize: 1, displayFontSmoothing: 'antialiased',
    brandColour: '#147EFB', brandStoreName: 'Org A',
    ...over,
  };
}
function baseServer(over: Partial<SavePlanServer> = {}): SavePlanServer {
  return { receipt: RECEIPT, store: STORE, prefs: PREFS, sync: SYNC, brand: BRAND, ...over };
}
const byName = (name: SaveTaskName) => {
  const plan = lastPlan.find((t) => t.name === name);
  if (!plan) throw new Error('no such task: ' + name);
  return plan;
};
let lastPlan: ReturnType<typeof planSaveTasks> = [];
function plan(draft: Partial<SavePlanDraft>, server: Partial<SavePlanServer> = {}, saved: Partial<SettingsSaveSnapshot> = {}) {
  lastPlan = planSaveTasks({ draft: baseDraft(draft), saved: baseSaved(saved), server: baseServer(server) });
  return lastPlan;
}

// ── the three helpers ────────────────────────────────────────────────
describe('changedKeys / mergeChanged / normUrl', () => {
  it('changedKeys sees only keys the DRAFT carries, and only real diffs', () => {
    expect(changedKeys({ a: 1, b: 2 }, { a: 1, b: 9, c: 3 })).toEqual(['b']);
    // A key present in base but absent from the draft is NOT a change: the
    // draft never claims it, so it cannot overwrite it.
    expect(changedKeys({ a: 1 }, { a: 1, logo: 'x.png' })).toEqual([]);
    expect(changedKeys({}, {})).toEqual([]);
  });

  it('mergeChanged starts from the SERVER row and lifts only listed keys', () => {
    const base = { name: 'Org B', address: 'Jl. Baru 9', currency: 'SGD' };
    const draft = { name: 'Org A renamed', address: 'Jl. Lama 1', currency: 'IDR' };
    expect(mergeChanged(base, draft, ['name'])).toEqual({
      name: 'Org A renamed', address: 'Jl. Baru 9', currency: 'SGD',
    });
    expect(mergeChanged(base, draft, [])).toEqual(base);
  });

  it('normUrl folds empty and whitespace to null so they cannot read as an edit', () => {
    expect(normUrl('')).toBeNull();
    expect(normUrl('   ')).toBeNull();
    expect(normUrl(null)).toBeNull();
    expect(normUrl(undefined)).toBeNull();
    expect(normUrl('https://x.test')).toBe('https://x.test');
  });
});

// ── plan shape ───────────────────────────────────────────────────────
describe('planSaveTasks plan shape', () => {
  it('plans the seven families in send order, payload null unless firing', () => {
    const p = plan({});
    expect(p.map((t) => t.name)).toEqual([
      'receipt', 'store', 'currency', 'prefs', 'sync', 'brandColour', 'brandName',
    ]);
    expect(p.every((t) => t.payload === null && !t.fires)).toBe(true);
    expect(firingTaskNames(p)).toEqual([]);
    expect(readFailedTasks(p)).toEqual([]);
  });

  it('a clean page is not-edited on every family, never a failure', () => {
    expect(plan({}).map((t) => t.reason)).toEqual([
      'not-edited', 'not-edited', 'not-edited', 'not-edited', 'not-edited',
      'not-edited', 'not-edited',
    ]);
  });

  it('every firing payload carries the server row, not the draft DTO', () => {
    const serverStore: StoreSettingsDto = {
      name: 'Org B', address: 'Jl. Baru 9', taxId: 'TAX-B', branch: 'B-2', currency: 'SGD',
    };
    plan({ store: { ...STORE, name: 'Org A renamed' } }, { store: serverStore });
    const sent = byName('store').payload as unknown as StoreSettingsDto;
    expect(byName('store').fires).toBe(true);
    expect(sent.name).toBe('Org A renamed');
    expect(sent.address).toBe('Jl. Baru 9');
    expect(sent.taxId).toBe('TAX-B');
    expect(sent.branch).toBe('B-2');
    // FUSED but still gated: the page did NOT edit defaultCurrency, so the
    // merged payload keeps the NEW tenant's SGD rather than the draft's IDR.
    // Editing it is what moves it - the next describe pins that half.
    expect(sent.currency).toBe('SGD');
    // A key the page does not carry (logo) is not in the draft, so it stays at
    // the server's value and cannot be stamped back.
    expect('logo' in sent).toBe(false);
  });
});

// ── THE RULE, clause by clause ───────────────────────────────────────
describe('planSaveTasks fires on edited AND differs, never on differs alone', () => {
  // THE deliberate deviation: an ORG SWITCH. Server = ORG B, draft + Revert
  // target = ORG A. Every previous-tenant value DIFFERS from the new row, and
  // NONE of them was edited - so a diff-only gate would write them all over
  // the new tenant. That gate is exactly what this table refuses to pass.
  const ORG_B_SERVER = {
    receipt: { ...RECEIPT, taxRoundingMode: 'truncate' },
    store: { name: 'Org B', address: 'Jl. Baru 9', taxId: 'TAX-B', branch: 'B-2', currency: 'SGD' },
    sync: { serverUrl: 'https://tenant-b.example.com', hasApiKey: false, enabled: false, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' },
    brand: { primary_colour: '#ff0000', store_name: 'Org B' },
  };

  it('writes NOTHING when the whole draft is a stale previous-org copy', () => {
    const p = plan({ defaultCurrency: 'SGD' }, ORG_B_SERVER);
    expect(firingTaskNames(p)).toEqual([]);
    // Only the currency column followed the org switch (the page's currency
    // effect does that on its own), so store/currency are an EDIT whose merge
    // lands back on the server value - no-diff. Everything else was untouched.
    expect(p.map((t) => t.reason)).toEqual([
      'not-edited', 'no-diff', 'no-diff', 'not-edited', 'not-edited',
      'not-edited', 'not-edited',
    ]);
  });

  it('writes NOTHING at all when not even the currency followed', () => {
    const p = plan({}, ORG_B_SERVER);
    expect(p.every((t) => t.reason === 'not-edited' && !t.fires)).toBe(true);
  });

  it('still leaves receipt.taxRoundingMode alone when no receipt field was edited', () => {
    // set_receipt re-stamps all ten flat keys, so an untouched write would
    // silently reset the new tenant's rounding mode back to the draft's.
    plan({}, ORG_B_SERVER);
    expect(byName('receipt').fires).toBe(false);
    expect(byName('receipt').payload).toBeNull();
  });

  it('does NOT write a currency that only DIFFERS from the row', () => {
    // THE diff-only-gate trap: the draft's IDR differs from the new tenant's
    // SGD and the page edited nothing. "Differs from the server" alone would
    // fire here and stamp IDR onto the new row; the edit clause is what stops
    // it. This is the deliberate deviation, as a table row.
    plan(
      { defaultCurrency: 'IDR' },
      { ...ORG_B_SERVER, store: { ...STORE, currency: 'SGD' } },
      { defaultCurrency: 'IDR' },
    );
    expect(byName('currency').fires).toBe(false);
    expect(byName('currency').reason).toBe('not-edited');
    expect(byName('currency').payload).toBeNull();
    // Same trap on the brand column, same answer: #147EFB is not the tenant's
    // #ff0000, and nothing fires because nothing was edited.
    expect(byName('brandColour').reason).toBe('not-edited');
  });

  it('does NOT write a drifted currency the page merely followed', () => {
    // Same switch, but the context effect moved the draft to SGD while the
    // Revert target still says IDR: that IS an edit, and the merge clause is
    // what saves it - the server already holds SGD, so nothing fires.
    plan({ defaultCurrency: 'SGD' }, ORG_B_SERVER, { defaultCurrency: 'IDR' });
    expect(byName('currency').fires).toBe(false);
    expect(byName('currency').reason).toBe('no-diff');
  });

  it('does NOT push a drifted brand name or colour into the tenant row', () => {
    plan({}, ORG_B_SERVER);
    expect(byName('brandColour').fires).toBe(false);
    expect(byName('brandName').fires).toBe(false);
  });

  it('edits AND matches the server value: no-diff, also skipped, also not a failure', () => {
    // The page edited the store name to exactly what the new tenant holds.
    plan(
      { store: { ...STORE, name: 'Org B' } },
      { store: { ...STORE, name: 'Org B' } },
    );
    expect(byName('store').fires).toBe(false);
    expect(byName('store').reason).toBe('no-diff');
  });

  it('one edited family fires while its untouched neighbours skip', () => {
    const p = plan({ brandColour: '#00ff00' });
    expect(firingTaskNames(p)).toEqual(['brandColour']);
    expect(byName('brandColour').payload).toEqual({ value: '#00ff00' });
    expect(byName('brandName').reason).toBe('not-edited');
    expect(byName('receipt').reason).toBe('not-edited');
  });
});

// ── per-family clauses ───────────────────────────────────────────────
describe('planSaveTasks per family', () => {
  it('treats a currency-only change as a STORE change too (fused diff)', () => {
    // store.currency and the currency task stamp the SAME column: if the store
    // diff were computed on the raw store DTO, one of the two writers would
    // re-stamp the old code.
    plan({ defaultCurrency: 'EUR' });
    expect(byName('currency').fires).toBe(true);
    expect(byName('currency').payload).toEqual({ currency: 'EUR' });
    expect(byName('store').fires).toBe(true);
    expect((byName('store').payload as unknown as StoreSettingsDto).currency).toBe('EUR');
  });

  it('merges an edited receipt key over the server DTO, keeping taxRoundingMode', () => {
    const p = plan(
      { receipt: { ...RECEIPT, footer: 'see you' } },
      { receipt: { ...RECEIPT, taxRoundingMode: 'truncate' } },
    );
    const sent = byName('receipt').payload as unknown as ReceiptSettingsDto;
    expect(p.some((t) => t.fires)).toBe(true);
    expect(sent.footer).toBe('see you');
    expect(sent.taxRoundingMode).toBe('truncate');
  });

  it('sends all three pref keys with the merged values, stringified', () => {
    plan({ displayCardSize: 3 });
    expect(byName('prefs').fires).toBe(true);
    expect(byName('prefs').payload).toEqual({
      cardsize: '3', fontsize: '1', 'font-smoothing': 'antialiased',
    });
  });

  it('does not clear a configured sync URL the page never edited', () => {
    // Partial load: draft URL empty, Revert target empty, server configured.
    const p = plan(
      { sync: { serverUrl: null, hasApiKey: false, enabled: false, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' }, syncServerUrl: '' },
      { sync: SYNC },
      { sync: { serverUrl: null, hasApiKey: false, enabled: false, resolvedOrigin: 'https://license.kasir.mu', resolvedOriginSource: 'main' }, syncServerUrl: '' },
    );
    expect(byName('sync').fires).toBe(false);
    expect(p.every((t) => !t.fires)).toBe(true);
  });

  it('keeps the server URL on a sync payload the user did edit', () => {
    plan({ syncApiKey: 'secret-key' });
    expect(byName('sync').fires).toBe(true);
    expect(byName('sync').payload).toEqual({
      serverUrl: 'https://sync.example.com', enabled: true, apiKey: 'secret-key',
    });
  });

  it('treats whitespace and empty as the same URL state, so clearing reads as no edit', () => {
    plan(
      { syncServerUrl: '' },
      { sync: { ...SYNC, serverUrl: null } },
      { syncServerUrl: '   ' },
    );
    expect(byName('sync').fires).toBe(false);
    expect(byName('sync').reason).toBe('not-edited');
  });
});

// ── the unanswered read-back ─────────────────────────────────────────
describe('planSaveTasks when the read-back never answered', () => {
  it('marks all seven read-failed, with null payloads and no firing task', () => {
    const p = plan(
      { store: { ...STORE, branch: 'A-9' }, defaultCurrency: 'EUR', brandColour: '#00ff00' },
      { receipt: null, store: null, prefs: null, sync: null, brand: null },
    );
    expect(p.every((t) => t.reason === 'read-failed' && !t.fires && t.payload === null)).toBe(true);
    expect(firingTaskNames(p)).toEqual([]);
    expect(readFailedTasks(p)).toHaveLength(7);
  });

  it('fails the currency task with its own read-back, the store row', () => {
    plan({ defaultCurrency: 'EUR' }, { store: null });
    expect(byName('currency').reason).toBe('read-failed');
    expect(byName('store').reason).toBe('read-failed');
    // Each family is gated on ITS OWN read-back: the store row is the currency
    // read, so those two fail together, while prefs - which did answer - stays
    // planable and reads as a plain skip, not as a failure.
    expect(byName('currency').fires).toBe(false);
    expect(byName('prefs').reason).toBe('not-edited');
  });

  it('keeps a live family planable while its neighbour read-failed', () => {
    const p = plan({ brandStoreName: 'New Name' }, { sync: null });
    expect(byName('sync').reason).toBe('read-failed');
    expect(byName('brandName').fires).toBe(true);
    expect(firingTaskNames(p)).toEqual(['brandName']);
  });
});

// ── classifyOutcome: skipped is never a failure ──────────────────────
describe('classifyOutcome', () => {
  // classifyOutcome reads only the NAME in each sent tuple and the settled
  // entry at that index - the promise itself is never touched - so a string
  // sentinel stands in for it and no floating rejection is created here.
  const ok = 'sent';
  const bad = 'sent';

  it('calls an omitted task skipped, not rejected', () => {
    const sent: Array<readonly [SaveTaskName, unknown]> = [['receipt', ok]];
    const settled: PromiseSettledResult<unknown>[] = [{ status: 'fulfilled', value: undefined }];
    expect(classifyOutcome('store', sent, settled)).toBe('skipped');
    expect(classifyOutcome('receipt', sent, settled)).toBe('fulfilled');
  });

  it('reads a sent-but-rejected task as rejected', () => {
    const sent: Array<readonly [SaveTaskName, unknown]> = [['receipt', ok], ['store', bad]];
    const settled: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: new Error('store') },
    ];
    expect(classifyOutcome('store', sent, settled)).toBe('rejected');
  });

  it('resolves BY NAME, so inserting a task cannot shift another result', () => {
    // The exact hazard the by-name lookup exists for: with positional reads,
    // prepending a family would make every later task report its predecessor's
    // outcome.
    const sent: Array<readonly [SaveTaskName, unknown]> = [
      ['brandName', ok], ['receipt', bad], ['sync', ok],
    ];
    const settled: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: new Error('receipt') },
      { status: 'fulfilled', value: undefined },
    ];
    expect(classifyOutcome('brandName', sent, settled)).toBe('fulfilled');
    expect(classifyOutcome('receipt', sent, settled)).toBe('rejected');
    expect(classifyOutcome('sync', sent, settled)).toBe('fulfilled');
    expect(classifyOutcome('prefs', sent, settled)).toBe('skipped');
  });

  it('treats a sent task with no settled slot as rejected, never as a skip', () => {
    const sent: Array<readonly [SaveTaskName, unknown]> = [['receipt', ok]];
    expect(classifyOutcome('receipt', sent, [])).toBe('rejected');
  });
});
