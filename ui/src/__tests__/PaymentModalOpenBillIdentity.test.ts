// ── An open bill must be identifiable by the cashier who saved it ────────
//
// A CONSEQUENCE OF THE ROUND-44 FIX (795fc18d4), which is why it belongs here.
//
// That fix stopped a non-dine-in open bill PERSISTING a table number. But
// `canComplete` for the open_bill tender still read:
//
//   return customerName.trim().length > 0
//       || (tableNumber != null && tableNumber.trim().length > 0);
//
// so on a TAKEAWAY with a stray table number and no name, Complete stayed
// ENABLED — while the payload dropped the table. The tab that resulted had
// neither a name nor a table, so the only thing identifying it was
// `heldCartLabel`'s fallback, "Open Bill #<timestamp>". The cashier returned to
// /open bills and could not tell whose it was.
//
// The pre-fix behaviour at least named the table, wrongly. The fix made the
// record HONEST and, in this path, ANONYMOUS — a real cost that has to be paid
// by tightening the gate, not by putting the wrong table back.
//
// The rule: the table arm of the predicate applies only when the table is one
// this order may claim (dine-in).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../features/sales/PaymentModal.tsx'), 'utf-8');

describe('PaymentModal open-bill gate', () => {
  it('does not accept a table number as the tab identity for a non-dine-in order', () => {
    // Find the open_bill arm of canComplete.
    const idx = SRC.indexOf("if (method === 'open_bill') {");
    expect(idx, 'the open_bill arm must exist').toBeGreaterThan(-1);
    const arm = SRC.slice(idx, idx + 800);

    expect(
      /orderType === 'dine_in'/.test(arm),
      'the table arm of the open-bill predicate must be gated on dine-in: a ' +
        'takeaway cannot use a table as its identity, and without the gate a ' +
        'stray number enables a tab that ends up with no name AND no table. ' +
        'Arm found: ' + arm.split('\n')[0],
    ).toBe(true);
  });

  it('still accepts a customer name on any order type', () => {
    // The name arm is order-type independent — a takeaway still has a customer —
    // so the tightening must not remove it. Asserted so a future edit cannot
    // "fix" this by requiring dine-in outright.
    const idx = SRC.indexOf("if (method === 'open_bill') {");
    const arm = SRC.slice(idx, idx + 800);
    expect(
      /customerName\.trim\(\)\.length > 0/.test(arm),
      'the customer-name arm must survive — a takeaway tab is identified by name',
    ).toBe(true);
  });
});
