/**
 * Pairing-claim parity — every screen that watches a pairing poll must re-read
 * entitlements when the poll reports `claimed`.
 *
 * WHY THIS EXISTS (2026-10-15). A device reached the home screen showing
 * "This terminal has no active licence", the restaurant-pos workspace showing the
 * raw `invalid subscription signature`, and the workspace card showing "Could not
 * start the session for this workspace". One cause: pairing writes the earned
 * sync credential but NO `tenant_subscription` row, so a device that linked
 * rather than activated holds the fail-closed `unavailable` capability state —
 * and `ProvisioningFlow`'s pairing branch set `linkedAccount` and toasted success
 * WITHOUT calling `refreshSubscription()`. Its sibling
 * `LicenseActivationScreen` had done so all along (`:229`), which is exactly why
 * the omission survived review: the two screens looked symmetric and were not.
 *
 * This guard PARSES the two sources rather than restating the call, so it cannot
 * drift the way a copy does. It asserts the INVARIANT (a `claimed` branch
 * refreshes), not the presence of a particular line — a future refactor may move
 * the call as long as the branch still refreshes.
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

/** The screens that poll `pollDevicePairing` and act on a `claimed` result. */
const PAIRING_SCREENS = [
  'src/features/setup/ProvisioningFlow.tsx',
  'src/features/auth/LicenseActivationScreen.tsx',
] as const;

/**
 * Slice the source into the `claimed` handler: from the `status === 'claimed'`
 * test to the end of the enclosing block. Bounded by the next `pollDevicePairing`
 * call or the end of file, so a screen with several polls is handled.
 */
/**
 * Extract the `claimed` branch as a BRACE-BALANCED block.
 *
 * The first version of this helper sliced from `status === 'claimed'` to the next
 * `pollDevicePairing` or end of file, and that was a false-confidence guard: when no
 * later poll existed the slice ran to EOF and swallowed the whole component
 * (1040 lines), so `refreshSubscription()` from the UNRELATED `provision_device`
 * path satisfied the assertion. A kill-test proved it -- removing the pairing
 * refresh still passed. This version walks braces from the first `{` after the
 * condition and stops at its match, so only the branch itself is examined.
 */
function claimedBranch(source: string): string | null {
  const at = source.indexOf("status === 'claimed'");
  if (at < 0) return null;
  const open = source.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}
describe('pairing-claim parity', () => {
  it.each(PAIRING_SCREENS)('%s re-reads entitlements when a pairing is claimed', (rel) => {
    const source = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    const branch = claimedBranch(source);

    expect(branch, `${rel} has no \`status === 'claimed'\` branch to check`).not.toBeNull();
    expect(
      branch,
      `${rel} accepts a claimed pairing without calling refreshSubscription(): a paired` +
        ' terminal would keep its pre-link capability state, which is the fail-closed' +
        ' `unavailable` default because pairing writes no tenant_subscription row.',
    ).toContain('refreshSubscription()');
  });
});
