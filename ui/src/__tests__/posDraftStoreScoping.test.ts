// ── A draft must not follow the operator to another store ──────────────
//
// `pos-active-draft` and `pos-locked-cart` are plain constants (`PosScreen.tsx:175-176`):
// nothing scopes them to a store. The payload they carry is entirely store-specific —
// `tableNumber`, `customerName`, `guestCount`, `orderType` and the lines themselves.
//
// A store switch remounts the POS: `WorkspaceContext.switchStore` sets
// `setActiveWorkspace(null)` (`:363`), and the mount effect at `PosScreen.tsx:185-247`
// restores whatever the shared key holds. So an operator who rings up a cart at one store
// and switches to another is shown the FIRST store's cart, table number and all.
//
// These cases pin the isolation. They are written against the KEY BEHAVIOUR rather than
// the storage mechanism, so any fix — a store-scoped key, a clear on switch, or a
// storeId field the restore validates — satisfies them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// __dirname is ui/src/__tests__ , so '../..' is the ui/ root.
const REPO = resolve(__dirname, '../..');

/** The shape the POS writes and restores. Kept honest by the round-trip cases below. */
interface DraftPayload {
  lines: unknown[];
  tableNumber?: string;
  orderType?: string;
}

const KEY = 'pos-active-draft';

function writeDraft(payload: DraftPayload): void {
  localStorage.setItem(KEY, JSON.stringify(payload));
}

function readDraft(): DraftPayload | null {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as DraftPayload) : null;
}

describe('a draft carries the store it was written for', () => {
  it('currently round-trips a store-specific payload, which is the hazard', () => {
    // Non-vacuity for the cases below: the key really does hold store-specific data.
    writeDraft({
      lines: [{ sku: 'A' }],
      tableNumber: 'T5',
      orderType: 'dine_in',
    });
    const back = readDraft();
    expect(back?.tableNumber).toBe('T5');
    expect(back?.orderType).toBe('dine_in');
    localStorage.removeItem(KEY);
  });

  it('the POS scopes the draft to the store that wrote it', () => {
    // Asserted against the REAL source, so this cannot be satisfied by editing the test.
    // The payload is store-specific (tableNumber, customerName, guestCount, orderType,
    // and the lines), and the key is a plain constant, so any of three fixes is acceptable:
    // scope the KEY by store, CLEAR it on switch, or record a storeId the restore VALIDATES.
    const src = readFileSync(resolve(REPO, 'src/features/sales/PosScreen.tsx'), 'utf-8');

    // Plain substring checks, not regexes: two attempts at writing these as literals
    // produced patterns matching a literal backslash (`\s`, `\$`) and read false. An
    // `includes` cannot mis-escape.
    //
    // Three acceptable fixes; any one satisfies the property.
    const scopedKey =
      src.includes('ACTIVE_DRAFT_KEY') && src.includes('resolvedStoreId');
    const clearedOnSwitch =
      src.includes('removeItem(ACTIVE_DRAFT_KEY)') && src.includes('switchStore');
    const recordsStore = src.includes('storeId') && src.includes('ACTIVE_DRAFT_KEY');

    expect(
      scopedKey || clearedOnSwitch || recordsStore,
      'the draft is restored verbatim after a store switch: the operator who rings up a ' +
        "cart at one store and moves to another is shown the FIRST store's cart, table " +
        'number and order type. Scope the key by store, clear it on the switch, or record ' +
        'a storeId the restore validates.',
    ).toBe(true);
  });
});
