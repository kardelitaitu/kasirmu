/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── Inventory transaction-type label coverage ─────────────────────────
//
// These ids were assembled at runtime from a template literal, so
// scripts/verify-bundle-parity.py could not see them and the mismatch
// shipped: `inv-log-type-${'purchase-order-receive'}` names a key that
// exists in neither bundle. The mapping now lives in
// INVENTORY_TRANSACTION_TYPE_KEYS, which makes it enumerable — and this
// test is what keeps it honest, by resolving every id against the real
// production bundles instead of a hand-written mock.

import type { ReactLocalization } from '@fluent/react';
import { describe, it, expect } from 'vitest';
import { getBundle } from '@/i18n';
import {
  INVENTORY_TRANSACTION_TYPE_KEYS,
  transactionTypeLabel,
} from '@/features/inventory/transactionTypeLabel';

const ENTRIES = Object.entries(INVENTORY_TRANSACTION_TYPE_KEYS);

describe('INVENTORY_TRANSACTION_TYPE_KEYS', () => {
  it('maps all seven InventoryTransaction types', () => {
    expect(ENTRIES.map(([type]) => type).sort()).toEqual([
      'manual-adjustment',
      'purchase-order-receive',
      'refund',
      'sale',
      'stock-count',
      'transfer',
      'void',
    ]);
  });

  it('maps purchase-order-receive to po-receive, not to the derived id', () => {
    // The regression this file exists for: `inv-log-type-${type}` yields
    // inv-log-type-purchase-order-receive, a key present in neither bundle,
    // so the table cell showed the slug "purchase order receive" while the
    // filter dropdown on the same screen correctly read "PO Diterima".
    expect(INVENTORY_TRANSACTION_TYPE_KEYS['purchase-order-receive'])
      .toBe('inv-log-type-po-receive');
  });

  for (const locale of ['en', 'id'] as const) {
    it(`resolves every mapped id in the ${locale} bundle`, () => {
      const bundle = getBundle(locale);
      for (const [type, key] of ENTRIES) {
        expect(bundle.hasMessage(key), `${key} (${type}) absent from ${locale}`).toBe(true);
        // formatPattern(getMessage(k)!.value!, null) is the repo's idiom —
        // see i18nBundle.test.tsx. FluentBundle has no public format().
        const formatted = bundle.formatPattern(bundle.getMessage(key)!.value!, null);
        expect(formatted, `${key} formats to empty in ${locale}`).not.toBe('');
        expect(formatted, `${key} unresolved in ${locale}`).not.toBe(key);
      }
    });
  }

  it('gives PO-Receive the same label the filter dropdown uses', () => {
    // The dropdown at TransactionLogScreen.tsx names inv-log-type-po-receive
    // literally; the table cell must agree with it in both locales.
    expect(
      getBundle('id').formatPattern(getBundle('id').getMessage('inv-log-type-po-receive')!.value!, null),
    ).toBe('PO Diterima');
    expect(
      getBundle('en').formatPattern(getBundle('en').getMessage('inv-log-type-po-receive')!.value!, null),
    ).toBe('PO Receive');
  });

  it('humanizes an unknown type instead of rendering a raw message id', () => {
    // A newer backend may emit a type this build has never seen. The
    // fallback must not consult the bundle at all.
    const unused = {
      getString: () => {
        throw new Error('unknown type must not hit the bundle');
      },
    } as unknown as ReactLocalization;
    expect(transactionTypeLabel(unused, 'future-type')).toBe('future type');
  });
});
