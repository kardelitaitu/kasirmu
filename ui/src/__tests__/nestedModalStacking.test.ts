import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A dialog opened FROM another dialog must paint ABOVE its parent.
 *
 * SalesHistoryScreen mounts three focus-trapped overlays and opens the e-Faktur
 * stamp dialog from a button INSIDE the sale-detail dialog. The detail overlay
 * stays mounted, and it is rendered AFTER the stamp overlay in the file
 * (:1724 vs :1628). Both used `z-index: var(--z-modal)`, so the cascade fell
 * back to DOM order and the PARENT painted over the CHILD — the stamp dialog
 * opened underneath the detail overlay and could not be clicked.
 *
 * jsdom computes no layout, so this cannot be asserted by rendering. It is a
 * stylesheet contract: the nested overlay names a strictly higher layer than
 * `--z-modal`, and the token that provides it is defined above `--z-toast` so a
 * nested dialog never floats over a toast or tooltip.
 */
const TOKENS = readFileSync(resolve(__dirname, '../theme/tokens.css'), 'utf-8');
const HISTORY_CSS = readFileSync(
  resolve(__dirname, '../features/sales/SalesHistoryScreen.css'),
  'utf-8',
);

function tokenValue(name: string): number {
  const m = TOKENS.match(new RegExp(`--${name}:\\s*(\\d+)`));
  expect(m, `token --${name} must be defined`).not.toBeNull();
  return Number(m![1]);
}

describe('nested modal stacking', () => {
  it('defines a nested-modal layer above --z-modal and below --z-toast', () => {
    const modal = tokenValue('z-modal');
    const nested = tokenValue('z-modal-nested');
    const toast = tokenValue('z-toast');
    expect(nested, 'nested dialogs must paint above their parent').toBeGreaterThan(modal);
    expect(nested, 'a nested dialog must not cover a toast').toBeLessThan(toast);
  });

  it('gives the e-Faktur stamp overlay the nested layer, not the shared one', () => {
    expect(HISTORY_CSS).toMatch(/\.sales-history-overlay:has\(\.sales-history-stamp-modal\)\s*\{[^}]*z-index:\s*var\(--z-modal-nested\)/);
  });

  it('gives the payment customer-search overlay a layer above the payment overlay', () => {
    // .payment-overlay is `calc(var(--z-modal) + 10)` = 410; the search dialog is
    // mounted inside it, so the plain --z-modal (400) put the child UNDER the
    // parent. Anything at or below 410 fails this.
    const payCss = readFileSync(
      resolve(__dirname, '../features/sales/PaymentModal.css'),
      'utf-8',
    );
    const body = payCss.match(
      /\.payment-customer-search-overlay\s*\{([^}]*)\}/,
    )?.[1];
    expect(body, 'the customer-search overlay rule must exist').toBeTruthy();
    expect(body!).toMatch(/z-index:\s*var\(--z-modal-nested\)/);
    // And the nested token must actually clear the parent's calc layer.
    expect(tokenValue('z-modal-nested')).toBeGreaterThan(tokenValue('z-modal') + 10);
  });
});
