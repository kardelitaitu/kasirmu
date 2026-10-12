/**
 * @vitest-environment node
 *
 * This file's entire import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── A takeaway order must not claim OR release a table ───────────────────
//
// WHY AN ORDER-TYPE GUARD EXISTS AT ALL
//
// The cart panel renders the Table number field for the restaurant POS on EVERY
// order type — deliberately, per its own comment (CartPanel.tsx:735-743: table
// capture "does not depend on a setting"). That is fine. What was not fine is
// that the table CLAIM and the table RELEASE both ignored the order type:
//
//   PaymentModal.tsx   assign_table_order_scoped   if (sessionToken && tableNumber)
//   PosScreen.tsx      releaseTableScoped          if (tableNumber && sessionToken)
//
// So a cashier ringing up a TAKEAWAY who left a number in that field would attach
// the sale to a real table (captured live: `assign_table_order_scoped { tableId:
// 'table-01', … }`) and then FREE that table on completion. A takeaway has no
// table; claiming or releasing one corrupts the floor plan's occupancy.
//
// THE CLAIM half is fixed and behaviourally tested in PaymentModalSaleFlow
// ("does NOT assign a table when the order is takeaway or delivery"). THIS file
// pins the RELEASE half, which the claim fix did NOT cover: blocking the claim
// alone still left a takeaway able to free a table it had never claimed.
//
// WHY SOURCE-LEVEL for the release: driving PosScreen's completion handler needs
// the whole checkout (shift, receipt settings, a completed PaymentModal
// round-trip), and that harness lives in PosScreen.integration.test.tsx. This
// guard asserts the thing that actually matters and that a revert would break:
// the release call sits behind a dine-in condition, and orderType is in the
// dependency list so the condition cannot go stale.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '../features/sales/PosScreen.tsx'),
  'utf-8',
);

describe('PosScreen table release is dine-in only', () => {
  it('guards the release on orderType', () => {
    // The release block: find the guard that precedes releaseTableScoped.
    const releaseIdx = SRC.indexOf('releaseTableScoped(sessionToken, match.id)');
    expect(releaseIdx, 'the release call must still exist').toBeGreaterThan(-1);

    // Walk back to the enclosing `if (` that gates this block.
    const before = SRC.slice(0, releaseIdx);
    const guardIdx = before.lastIndexOf('if (tableNumber');
    expect(guardIdx, 'a tableNumber guard must precede the release').toBeGreaterThan(-1);
    const guard = before.slice(guardIdx, guardIdx + 120);

    expect(
      /orderType === 'dine_in'/.test(guard),
      'the release guard must require a dine-in order — otherwise a takeaway with ' +
        'a stray table number frees a real table on completion. Guard found: ' +
        guard.split('\n')[0],
    ).toBe(true);
  });

  it('does not guard the CLAIM and RELEASE with different conditions', () => {
    // Both halves must agree. If one is tightened and the other is not, the
    // asymmetry itself is the bug (that is exactly how the release half survived
    // the claim fix).
    const claim = readFileSync(
      resolve(__dirname, '../features/sales/PaymentModal.tsx'),
      'utf-8',
    );
    const claimGuards = claim.match(/if \(sessionToken && tableNumber[^)]*\)/g) ?? [];
    expect(claimGuards.length, 'PaymentModal must carry both assignment guards').toBe(2);
    for (const g of claimGuards) {
      expect(g, 'every claim guard must be dine-in only: ' + g).toContain("orderType === 'dine_in'");
    }
  });

  it('lists orderType as a dependency of the completion callback', () => {
    // A read of orderType that is not declared is a stale closure: a cashier who
    // switches Dine-In -> Takeaway after mount would still take the dine-in
    // branch. react-hooks/exhaustive-deps flags it, and this pins it independently.
    const cbIdx = SRC.indexOf('const handlePaymentComplete = useCallback(() => {');
    expect(cbIdx, 'the completion callback must exist').toBeGreaterThan(-1);
    const tail = SRC.slice(cbIdx, cbIdx + 6000);
    const depsIdx = tail.indexOf('}, [resetCart');
    expect(depsIdx, 'the callback must declare a dependency array').toBeGreaterThan(-1);
    const deps = tail.slice(depsIdx, tail.indexOf(']);', depsIdx) + 3);
    expect(
      deps,
      'orderType is read by the release guard and must be a declared dependency, ' +
        'or the guard can evaluate a stale order type. Deps: ' + deps.slice(0, 200),
    ).toContain('orderType');
  });
});
