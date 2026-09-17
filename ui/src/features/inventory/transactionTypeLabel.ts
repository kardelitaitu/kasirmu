import type { ReactLocalization } from '@fluent/react';
import type { InventoryTransaction } from '@/api/inventory';
import { requiredLocalized } from '@/components';

/**
 * Fluent message ids for inventory transaction types.
 *
 * The transaction table cell and the shift summary used to build these ids
 * with a template literal — `l10n.getString(\`inv-log-type-${tx.type}\`)` —
 * which silently produced `inv-log-type-purchase-order-receive` for the
 * `purchase-order-receive` type. That key exists in neither bundle, so every
 * PO-Receive row fell back to the humanized slug "purchase order receive" in
 * English *and* Indonesian, while the filter dropdown on the very same screen
 * (which names `inv-log-type-po-receive` literally) correctly showed
 * "PO Diterima".
 *
 * Template-built ids are invisible to scripts/verify-bundle-parity.py, which
 * can only resolve string literals, so no gate could catch this. Listing the
 * mapping explicitly makes it total — TypeScript rejects a missing union
 * member — and lets transactionTypeLabel.test.ts assert that every id
 * resolves in both real bundles.
 */
export const INVENTORY_TRANSACTION_TYPE_KEYS: Record<InventoryTransaction['type'], string> = {
  sale: 'inv-log-type-sale',
  void: 'inv-log-type-void',
  refund: 'inv-log-type-refund',
  transfer: 'inv-log-type-transfer',
  'purchase-order-receive': 'inv-log-type-po-receive',
  'stock-count': 'inv-log-type-stock-count',
  'manual-adjustment': 'inv-log-type-manual-adjustment',
};

/**
 * Localized label for an inventory transaction type.
 *
 * `type` is typed as `string` rather than the union because the value arrives
 * from the backend: a newer server may emit a type this build has never seen.
 * Unknown values keep the previous humanized-slug behaviour instead of
 * rendering a raw message id.
 */
export function transactionTypeLabel(
  l10n: ReactLocalization,
  type: string,
): string {
  const key = INVENTORY_TRANSACTION_TYPE_KEYS[type as InventoryTransaction['type']];
  return key
    ? requiredLocalized(l10n, key)
    : type.replace(/-/g, ' ');
}
