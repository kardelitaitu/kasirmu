// ── Every settings screen that seeds a baseline must carry the FULL F4 triplet ──
//
// The F4 campaign ("a failed read leaves defaults looking like real values") was
// built in pieces across many rounds: a `loadFailed` flag at the source in
// `useTerminalHardware`, then Save-gates added per consumer. **Round 8 shipped four
// gates and no way to clear the flag**, latching Save off for the rest of the
// session — so round 9 added a Retry control to each one.
//
// `baselineLoadSignal.test.ts` already checks the FIRST half: a file that seeds an
// `originalsRef` baseline must consume a load-failure signal. It does not check the
// SECOND half, which is the one round 8 got wrong: **a flag that disables Save must
// ship with the path that re-enables it.** A screen can satisfy the signal check and
// still strand the operator.
//
// This file checks the triplet together on the surfaces this plan owns:
//   loadFailed declared  +  reloadNonce declared  +  a Retry control that calls it.
//
// Verified complete 2026-10-09 on all three restaurant settings screens. If a fourth
// is added, or one drops a piece, this fails rather than the operator discovering it.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['ui/src/features/restaurant/screens/RestaurantSettingsScreen.tsx'];
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (markers.every((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root from ' + process.cwd());
}

const ROOT = findRoot();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

/**
 * Screens this plan owns that seed a baseline from an async read.
 *
 * Each must carry the complete F4 triplet. `why` names the read whose failure the
 * flag reports, so an entry cannot be added without saying what it guards.
 */
const GUARDED: Array<{ file: string; why: string }> = [
  {
    file: 'ui/src/features/restaurant/screens/RestaurantSettingsScreen.tsx',
    why: 'settings + receipt keys loaded together; either read can fail',
  },
  {
    file: 'ui/src/features/restaurant/screens/RestaurantReceiptsScreen.tsx',
    why: 'grouped receipt settings AND the hardware profile; gates on both flags',
  },
  {
    file: 'ui/src/features/restaurant/screens/RestaurantPaymentsScreen.tsx',
    why: 'rail list plus the two gateway config reads (round 73)',
  },
];

describe('a Save-gating load failure ships with its re-enable path (F4)', () => {
  it('the guarded list is not empty (guards every case below)', () => {
    expect(GUARDED.length).toBeGreaterThanOrEqual(3);
  });

  it.each(GUARDED)('$file carries the full triplet', ({ file, why }) => {
    const src = read(file);
    const name = file.split('/').pop();

    // 1. The flag itself.
    expect(src, `${name} lost loadFailed — a failed read looks like real values (${why})`)
      .toMatch(/const \[loadFailed, setLoadFailed\]/);

    // 2. The re-run trigger. Without this the flag is a ONE-WAY LATCH: round 8
    //    shipped four Save-gates and no way back, disabling Save for the session.
    expect(
      src,
      `${name} has no reloadNonce — loadFailed is a one-way latch and Save ` +
        `can never return this session (${why})`,
    ).toMatch(/const \[reloadNonce, setReloadNonce\]/);

    // 3. The control that drives it. A declared-but-unwired nonce is the same
    //    latch with extra steps, which is why the wiring is asserted, not the name.
    expect(
      src,
      `${name} declares reloadNonce but nothing increments it — the retry ` +
        `control is missing or disconnected (${why})`,
    ).toMatch(/setReloadNonce\(\(n\) => n \+ 1\)/);

    // 4. And the flag must actually gate Save. A signal the save path ignores is
    //    decoration; this is the half that makes the failure visible.
    expect(
      src,
      `${name} has loadFailed but Save is not gated on it — the operator saves ` +
        `defaults over stored values (${why})`,
    ).toMatch(/disabled=\{[^}]*loadFailed[^}]*\}/);
  });
});