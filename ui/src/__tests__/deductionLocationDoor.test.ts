// ── The deduction-location door each shell actually registers ─────────────────
//
// scripts/verify-ipc-parity.py reads this file SHAPE-wise: it scans every UI file
// that branches on the shell and asks whether the shell named in each branch
// registers a command door for the name that branch invokes.
//
// A per-call-site test is not enough to keep that answer true. The test added
// beside `usePosCartActions` pins the two call sites that exist TODAY; a third
// call site added tomorrow, written with a bare truthiness test, would reproduce
// the defect and pass both suites. This case is the source-level guard for that:
// it fails when a shell-branching file selects the ambient (tablet-only) command
// under a condition that does not also exclude the desktop shell.
//
// The condition it accepts is the one the fix uses, `sessionToken ||
// !isTabletShell()` (PosScreen.tsx:902, usePosCartActions.ts:133): when a session
// token is present the SCOPED command is correct on both shells; when it is
// absent, desktop must never reach the ambient one, because desktop registers no
// door for it and the invoke is rejected as an unknown command at runtime.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Files known to invoke the ambient deduction-location command. */
const AMBIENT_INVOCATION_SITES = [
  'src/features/sales/PosScreen.tsx',
  'src/features/sales/hooks/usePosCartActions.ts',
];

/** The guard the desktop-safe branch has to carry. */
const SHELL_AWARE_GUARD = /sessionToken\s*\|\|\s*!isTabletShell\(\)/;

/**
 * Every branch that selects the SCOPED twin with a token-only truthiness test.
 *
 * The escapes matter, and the first draft of this file did not have them: written
 * inside a regex literal, an unescaped `s` is the letter s, so the pattern matched
 * ordinary prose ("cases", "received") and the case failed against both files for
 * a reason unrelated to the defect. The trailing `getCartDeductionLocation` clause is
 * what keeps it about THE DOOR: PosScreen uses `sessionToken ?` for an unrelated
 * prop spread at :2502, and a pattern that flagged that would fail every time the
 * file grew a ternary — a guard that cries wolf gets deleted.
 */
const TOKEN_ONLY_TRUTHINESS = /sessionToken\s*\?[^?]*getCartDeductionLocation\b/;

describe('deduction-location door — every shell-branching selection is shell-aware', () => {
  for (const rel of AMBIENT_INVOCATION_SITES) {
    it(`${rel} guards the ambient command behind a shell-aware condition`, () => {
      const source = readFileSync(resolve(process.cwd(), rel), 'utf8');

      // The file must still be one of the sites this case is about. If the call
      // moved, this fails loudly rather than silently grading nothing.
      expect(source).toMatch(/getCartDeductionLocation\b/);

      // A token-only truthiness test is the defect shape: with `rawToken || ''`
      // "no session" is the empty string, so it takes the ambient branch.
      expect(source).not.toMatch(TOKEN_ONLY_TRUTHINESS);

      // And the shell-aware guard must actually be present, not merely absent
      // from a defect pattern — an empty guard would also satisfy the line above.
      expect(source).toMatch(SHELL_AWARE_GUARD);
    });
  }
});
