// ── A stale floor plan must not be silent ───────────────────────────────────
//
// Two PosScreen paths update table state fire-and-forget, which is correct: a
// floor-plan hiccup must never fail the sale that just completed. Both used an
// EMPTY catch, which is not:
//
//   releaseTableScoped on sale-complete — the table keeps reading 'Occupied'
//     with no sale behind it, so the cashier seats someone at a table the
//     system believes is taken.
//   updateTableStatusScoped('reserved') when a table is picked from
//     management — two terminals then disagree about whether it is taken.
//
// Neither may block, so the fix is a warning toast, not a thrown error. This
// guard reads the source because the difference IS the callback, and a render
// test would have to mock the whole sale-complete path to reach it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../features/sales/PosScreen.tsx'), 'utf-8');

const RELEASE = 'releaseTableScoped(sessionToken, match.id)';
const RESERVE = "updateTableStatusScoped(sessionToken, match.id, 'reserved')";

/**
 * The characters after a call covering its continuation and attached catch.
 *
 * 900, not 400: the catch sits past the explanatory comment the fix carries, and a
 * window sized to the code alone silently truncates before the toast — which is how
 * this guard first reported a fix that was already applied.
 */
function chainAfter(call: string): string {
  const at = SRC.indexOf(call);
  return at === -1 ? '' : SRC.slice(at, at + 900);
}

describe('PosScreen floor-plan sync failure reporting', () => {
  it('never swallows a table release or reservation failure', () => {
    const cases: Array<[string, string]> = [
      ['sale-complete release', chainAfter(RELEASE)],
      ['management-pick reserve', chainAfter(RESERVE)],
    ];
    for (const [label, chain] of cases) {
      expect(chain.length, label + ': the call moved — re-point this guard').toBeGreaterThan(0);
      expect(
        chain,
        label +
          ' catches with an empty handler, so a failed table write leaves the' +
          ' floor plan stale and says nothing. Keep it fire-and-forget (do not' +
          ' throw) but report it.',
      ).toContain('tables-action-error');
    }
  });
});
