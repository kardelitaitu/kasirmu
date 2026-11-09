// ── Guard: a held cart is CREATED before the old record is DELETED ──────────
//
// `deleteHeldCartScoped` destroys an open bill with no undo, so in every sequence
// that replaces a tab the DELETE must come AFTER the `holdCartScoped` that creates
// its replacement. Four sites did it the other way round:
//
//   TableManagementScreen.handleMoveTable   moved a table's bill
//   TableManagementScreen.handleMergeTable  merged two tables' bills
//   PosScreen handleConfirmSplitBill        re-saved the remaining lines
//   PosScreen handleSendToKitchen           re-saved the tab after dispatch
//
// In each, a rejected hold (locked DB, dropped IPC, lapsed session) left the table
// with NO bill at all while the catch toasted a generic failure — so the damage was
// silent. handleMergeTable was the worst: it deleted two bills before creating one.
//
// WHY A STATIC SCAN. The two PosScreen sites sit inside handlers that need the whole
// POS screen, a shift, a populated cart and a satisfied button gate to reach — the
// same reason `posDispatchRecord.test.ts` pins its invariant at the source layer
// rather than through the component. The TableManagementScreen sites ARE reachable
// and have behavioural cases too; this file is what covers all four uniformly and
// stops a fifth being added wrong.
//
// THE ASSERTION IS ON RELATIVE ORDER, not on presence: both calls must still happen
// on the success path, so a guard that merely looked for the delete would be
// satisfied by the buggy order. It compares character offsets within one handler.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.cwd(), 'src');
const read = (rel: string) => fs.readFileSync(path.resolve(SRC, rel), 'utf-8');

const TABLE_SCREEN = read('features/tables/TableManagementScreen.tsx');
const POS_SCREEN = read('features/sales/PosScreen.tsx');

/**
 * Every handler that replaces a held cart: the function name, its file, and the
 * marker where the next region begins so the body can be sliced out.
 *
 * Sliced by handler NAME rather than by file so two sites in one file are graded
 * separately — `PosScreen` holds two, and a file-wide check would let the second
 * inherit the first's correctness.
 */
const REPLACERS: Array<{
  name: string;
  file: string;
  src: string;
  fn: string;
  end: string;
}> = [
  {
    name: 'TableManagementScreen handleConfirmMoveTable',
    file: 'features/tables/TableManagementScreen.tsx',
    src: TABLE_SCREEN,
    fn: 'handleConfirmMoveTable',
    end: 'handleOpenMergeTable',
  },


  {
    name: 'TableManagementScreen handleConfirmMergeTable',
    file: 'features/tables/TableManagementScreen.tsx',
    src: TABLE_SCREEN,
    fn: 'handleConfirmMergeTable',
    end: 'handleConfirmReservation',
  },
  {
    name: 'PosScreen handleConfirmSplitBill',
    file: 'features/sales/PosScreen.tsx',
    src: POS_SCREEN,
    fn: 'handleConfirmSplitBill',
    end: 'handleSendToKitchen',
  },
  {
    name: 'PosScreen handleSendToKitchen',
    file: 'features/sales/PosScreen.tsx',
    src: POS_SCREEN,
    fn: 'handleSendToKitchen',
    end: 'handleDispatchKitchenDelta',
  },
];


/** The body of one handler, from its `useCallback(` declaration to the next marker. */
function handlerBody(src: string, name: string, nextMarker: string): string {
  const start = src.indexOf('const ' + name + ' = useCallback(');
  if (start < 0) return '';
  const after = src.indexOf('const ' + nextMarker + ' = useCallback(', start);
  return after < 0 ? src.slice(start) : src.slice(start, after);
}

describe('a held cart is created before the old record is deleted', () => {
  it.each(REPLACERS)('$name orders hold before delete', (row) => {
    const body = handlerBody(row.src, row.fn, row.end);

    expect(
      body,
      `${row.name}: handler not found in ${row.file} — it was renamed, so re-point ` +
        'this guard rather than deleting the entry',
    ).not.toBe('');

    const holdAt = body.indexOf('holdCartScoped(');
    const deleteAt = body.indexOf('deleteHeldCartScoped(');

    expect(
      holdAt,
      `${row.name}: no holdCartScoped call — nothing creates the replacement tab`,
    ).toBeGreaterThanOrEqual(0);
    expect(deleteAt, `${row.name}: no deleteHeldCartScoped call`).toBeGreaterThanOrEqual(0);

    // THE ASSERTION. A rejected hold leaves the previous tab intact only when the
    // create has already succeeded by the time the delete runs.
    expect(
      holdAt,
      `${row.name} DELETES the held cart before creating its replacement. If the ` +
        'hold then fails the tab is gone with no undo, and the operator is told only ' +
        'that the operation failed. Create first.',
    ).toBeLessThan(deleteAt);
  });

  it('grades every call site in these files, so a new one cannot be added ungraded', () => {
    // THE DENOMINATOR, and it took a kill-test to get right.
    //
    // The first version compared REPLACERS.length against a count of call sites. That
    // passes when an ENTRY is deleted from REPLACERS while its call site remains — the
    // exact "satisfiable by not listing it" failure the comment claimed to prevent.
    // Verified: removing the merge entry made the suite green at 4 tests.
    //
    // This version compares the call sites against the number of entries that actually
    // PRODUCED a non-empty body, so deleting an entry fails here immediately, and a
    // fifth call site added without an entry fails too. Both directions, one number.
    const graded = REPLACERS.filter(
      (r) => handlerBody(r.src, r.fn, r.end) !== '',
    ).length;
    expect(
      graded,
      'a REPLACERS entry no longer matches a handler — it was renamed or deleted. ' +
        'Re-point it rather than removing it, or the site it covered stops being graded.',
    ).toBe(REPLACERS.length);

    const tableSites = (TABLE_SCREEN.match(/await deleteHeldCartScoped\(/g) ?? []).length;
    const posSites = (POS_SCREEN.match(/await deleteHeldCartScoped\(/g) ?? []).length;
    expect(
      REPLACERS.length,
      'this many replacing handlers are listed but the two files hold ' +
        (tableSites + posSites) + ' delete call sites. If a site was added, add an entry ' +
        'so it is graded; if one was removed, drop its entry.',
    ).toBe(tableSites + posSites);
  });
});
