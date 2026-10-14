// ── The receipts screen's store-scoped keys, and the migration from flat ones ──
//
// Round 169 migrated all 42 `resto_rcpt_*` call sites from flat localStorage keys to
// store-scoped ones (`utils/scopedStorage.ts`). A migration is where a value that worked
// yesterday stops working, so the migration itself is what gets pinned here rather than the
// helper — `scopedStorage.test.ts` already covers the helper on its own.
//
// Two claims, in the order they matter to an operator:
//
//   1. A FLAT LEGACY VALUE IS ADOPTED. An operator who configured a receipt header before
//      the change must not find it empty after — the value is still on disk under the old
//      spelling and `readScoped` promotes it. This is the difference between a migration
//      and a reset.
//   2. THE SCOPED VALUE WINS. Once adopted (or newly set), a stale flat value must not
//      resurrect — otherwise the legacy key would shadow a newer scoped one forever.

import { describe, it, expect, beforeEach } from 'vitest';
import { readScoped, writeScoped } from '@/utils/scopedStorage';

const SCOPED_TITLE = 'resto_rcpt_header_title:default';
const FLAT_TITLE = 'resto_rcpt_header_title';

beforeEach(() => {
  localStorage.clear();
});

describe('the receipts keys are store-scoped, and the flat ones are still honoured', () => {
  it('adopts a flat value written before the scoping change', () => {
    // An operator's existing configuration, as it sits on disk today.
    localStorage.setItem(FLAT_TITLE, 'WARUNG SEBELUMNYA');

    expect(readScoped(FLAT_TITLE, 'default')).toBe('WARUNG SEBELUMNYA');
    // And it was PROMOTED, so the next mount finds it without re-reading the legacy key.
    expect(localStorage.getItem(SCOPED_TITLE)).toBe('WARUNG SEBELUMNYA');
  });

  it('does not let a stale flat value shadow a newer scoped one', () => {
    writeScoped(FLAT_TITLE, 'default', 'BARU');
    localStorage.setItem(FLAT_TITLE, 'LAMA');

    expect(readScoped(FLAT_TITLE, 'default')).toBe('BARU');
  });

  it('leaves another store unaffected by this store value', () => {
    writeScoped(FLAT_TITLE, 'default', 'TOKO DEFAULT');

    // A second store on the same device, with its own flat value from before.
    localStorage.setItem(FLAT_TITLE, 'TOKO KEDUA');
    expect(readScoped(FLAT_TITLE, 'store-2')).toBe('TOKO KEDUA');
    expect(readScoped(FLAT_TITLE, 'default')).toBe('TOKO DEFAULT');
  });
});