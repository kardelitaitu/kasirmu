/**
 * Strip a redundant "Table" prefix from a stored table name.
 *
 * WHY THIS EXISTS
 *   The table names this product stores LITERALLY CONTAIN THE WORD. A fresh
 *   restaurant terminal is seeded with rows named 'Table 1', 'Table 2',
 *   'Table 12' (read from the tablet's store db, 2026-10-09), and
 *   `TableManagementScreen` hands `selected.name` straight to the cart
 *   (`TableManagementScreen.tsx:411`) — so `tableNumber` arrives already reading
 *   "Table 12".
 *
 *   Both places that render it ALSO add the word:
 *
 *     PaymentModal.tsx  <Localized id="payment-table-number" vars={{ number: tableNumber }}>
 *                       with `payment-table-number = Table { $number }` (sales.ftl:40)
 *     CartPanel.tsx:648 `Table ${tableNumber}`
 *
 *   which composed "Table Table 12" on a real restaurant order.
 *
 * THE RULE
 *   Remove a leading whole word "table" (case-insensitive, with any following
 *   separator) and return the remainder. 'Table 12' -> '12'; 'A5' -> 'A5'.
 *   A trailing `\b` guards an identifier like "Tabletop 3" from being mangled.
 *
 *   This runs BEFORE localisation: the visible prefix comes from the Fluent value
 *   ('Table ' in en, 'Meja ' in id), so only the English word is stripped here.
 *
 * SCOPE
 *   Display only. The raw `tableNumber` keeps its stored form for the payload,
 *   the receipt and the sale record — this never rewrites what is persisted.
 */
export function bareTableNumber(tableNumber: string): string {
  const trimmed = tableNumber.trim();
  if (trimmed.length === 0) return '';
  const stripped = trimmed.replace(/^table\b[\s:-]*/i, '').trim();
  // Fall back to the input when stripping would leave nothing (a table literally
  // named "Table"), so the badge never renders an empty label.
  return stripped.length > 0 ? stripped : trimmed;
}

/**
 * Compose the persisted label for a held cart / open bill tab.
 *
 * WHY THIS EXISTS
 *   Two sites built this string by hand, identically:
 *     PaymentModal.tsx:1113   (the hold on the payment path)
 *     hooks/usePosHeldCarts.ts:166 (the hold on the Save Tab path)
 *   Both interpolated the RAW table value as
 *     "Table " + trimmedTable, plus " (" + name + ")" when a customer was set.
 *   The stored table names ALREADY read "Table 12" (see bareTableNumber above),
 *   so the label persisted as "Table Table 12" — and unlike the badge, this one is
 *   SAVED: it is the name the operator sees in the open-bill list, so the defect
 *   outlives the screen.
 *
 *   Extracted here rather than fixed twice, because the duplication is the reason
 *   the first fix (commit c40ec0228, which covered the badge and the cart banner)
 *   missed it: I fixed the two render sites I could see and did not check whether
 *   the same phrase was composed anywhere else.
 *
 * @param tableNumber the stored table name (may already contain the word)
 * @param customerName optional customer attached to the tab
 * @returns the label to persist, or null when neither is present
 */
export function heldCartLabel(
  tableNumber: string | null | undefined,
  customerName: string | null | undefined,
): string | null {
  const table = tableNumber ? bareTableNumber(tableNumber) : '';
  const name = (customerName ?? '').trim();
  if (table && name) return 'Table ' + table + ' (' + name + ')';
  if (table) return 'Table ' + table;
  if (name) return name;
  return null;
}

