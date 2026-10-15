// ── The dev-mock must not discard a product's `notes` ──────────────
//
// Round 210, found by driving the menu editor's Modifier Groups builder end to end:
//
//   create a group  ->  Save reports success  ->  reopen the item  ->  THE GROUP IS GONE
//   (`SAVE_DISABLED_AFTER=true`, `GROUP_BACK=0`, `NOTES=`)
//
// The cause was `updateMockProduct` (dev-mock/handlers/catalog.ts): it assigned `name`,
// `priceMinor`, `categoryId` and `isActive`, and SILENTLY DROPPED `notes`. That matters
// more than one field usually would, because modifier groups LIVE in `notes` as JSON —
// `serializeDraftModifierGroups` (menuEditorLogic.ts:257) writes them there and
// `getProductModifierGroups` (types/domain.ts:224) reads them back — so the mock made the
// editor's whole Modifier Groups builder a no-op.
//
// The core has always accepted the field: `UpdateProductScopedArgs.notes` is
// `Option<Option<String>>` (kasirmu-bridge/src/products.rs:695) with the documented PATCH
// semantics. So the real till saved what this mock discarded — the worst kind of
// divergence, because a mock that is MORE permissive hides a bug and one that is LESS
// permissive invents one. This was the second kind.

import { afterEach, describe, expect, it, vi } from 'vitest';

// The vite config aliases @tauri-apps/api/core to the dev-mock in browser dev mode, so
// this pins the mock through the same module the app actually calls.
vi.unmock('@tauri-apps/api/event');
import { invoke } from '@/dev-mock/tauri-api';

// A seeded product the mock definitely carries.
const SEEDED_SKU = 'LATTE';

interface ProductRow {
  sku: string;
  notes?: string | null;
}

async function readProduct(sku: string): Promise<ProductRow | undefined> {
  const rows = (await invoke('list_products_scoped', {
    sessionToken: 'mock-session-token',
  })) as unknown as ProductRow[];
  return rows.find((r) => r.sku === sku);
}

async function updateNotes(sku: string, notes: string | null): Promise<void> {
  await invoke('update_product_scoped', {
    sessionToken: 'mock-session-token',
    args: {
      sku,
      name: 'Caffè Latte',
      priceMinor: 45000,
      currency: 'IDR',
      productType: 'restaurant',
      taxRateIds: [],
      notes,
    },
  });
}

describe('dev-mock product notes persistence', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('stores the modifier-group JSON an editor save sends', async () => {
    // The shape `serializeDraftModifierGroups` produces, which is what the editor sends.
    const groups = JSON.stringify([
      {
        id: 'mg-1',
        name: 'Spice Level',
        minSelections: 0,
        maxSelections: 1,
        sortOrder: 0,
        modifiers: [{ id: 'opt-1', name: 'Extra Hot', priceMinor: 5000, sortOrder: 0 }],
      },
    ]);

    await updateNotes(SEEDED_SKU, groups);

    const row = await readProduct(SEEDED_SKU);
    expect(row, 'the seeded product must exist').toBeTruthy();
    expect(row?.notes, 'the mock must KEEP notes — it dropped them before round 210').toBe(
      groups,
    );
  });

  it('clears notes when the caller sends null', async () => {
    // `null` is the documented PATCH meaning for a clear, distinct from absent (= keep).
    await updateNotes(SEEDED_SKU, JSON.stringify([{ id: 'g', name: 'x', modifiers: [] }]));
    await updateNotes(SEEDED_SKU, null);

    const row = await readProduct(SEEDED_SKU);
    expect(row?.notes ?? null).toBeNull();
  });
});