// ── Guard: a rail parameter is consumed by EITHER layer (F19/F48) ──────────
//
// Round 108 inventoried all 19 rail parameters the payments screen writes and
// reported `autoKick` and `defaultTerminalId` as having "0 Rust consumers". **That was
// the wrong test.** A rail parameter is an OPERATOR toggle, and the layer that honours
// it is whichever one acts:
//
//   autoKick          READ BY THE UI   PaymentModal.tsx:1263 gates the drawer kick on it
//   defaultTerminalId READ BY THE UI   the card panel preselects the terminal
//   verifyDrawer      read by NOBODY   F19's real inert control
//
// So "0 Rust hits" is not evidence of an inert control — it is evidence of an inert
// control only when the UI does not read it either. Round 108's table would have had a
// reader delete `autoKick`, which **already works** (F18 wired it): the toggle defaults
// true and switching it off stops the drawer popping on every cash tender.
//
// ⚠️ This is the FOURTH spelling of one failure in this session — a getter (93), a
// wrapper (94), a homonym (106), and now a layer-blind search. The instrument that keeps
// catching it is the same: measure the claim against the thing that would act on it.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

/** Production UI sources, tests and dev mocks excluded. */
function uiSources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['__tests__', 'dev-mock'].includes(e.name)) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        out.push({
          rel: path.relative(SRC, full).split(path.sep).join('/'),
          text: fs.readFileSync(full, 'utf-8'),
        });
      }
    }
  };
  walk(SRC);
  return out;
}

describe('a rail parameter is honoured by the layer that acts (F19)', () => {
  const sources = uiSources();

  it('autoKick is read by the payment path, not merely written by the settings screen', () => {
    // The load-bearing fact behind F18's fix. If this stops holding, the toggle is
    // inert again and the drawer pops on every cash tender regardless of the switch.
    const modal = read('features/sales/PaymentModal.tsx');
    expect(
      /railParam\(paymentRails, 'cash', 'autoKick'/.test(modal),
      'PaymentModal no longer reads autoKick — the Automatic Cash Drawer switch is inert ' +
        'again (F18 regression), and the drawer will pop on every cash tender regardless',
    ).toBe(true);

    // And the gate must actually wrap the drawer call, not merely exist nearby.
    const gateIdx = modal.indexOf("'autoKick'");
    const drawerIdx = modal.indexOf('openCashDrawerScoped(sessionToken)');
    expect(gateIdx, 'the autoKick read vanished from PaymentModal').toBeGreaterThan(-1);
    expect(drawerIdx, 'the drawer kick vanished from PaymentModal').toBeGreaterThan(-1);
    expect(
      drawerIdx > gateIdx,
      'the drawer kick now precedes the autoKick read — the gate is no longer what guards it',
    ).toBe(true);
  });

  it('the settings screen still WRITES autoKick, or the read above reads nothing', () => {
    const screen = read('features/restaurant/screens/RestaurantPaymentsScreen.tsx');
    expect(
      screen.includes("updateRailParams('cash', { autoKick: val })"),
      'the screen stopped writing autoKick — PaymentModal reads a value nothing sets',
    ).toBe(true);
  });

  it('verifyDrawer really is read by nobody, which is what makes it F19', () => {
    // The CONTRAST that makes the two cases different. If verifyDrawer gains a reader,
    // F19 shrinks and the plan row needs re-measuring rather than staying at five.
    const readers = sources.filter((f) => f.text.includes('verifyDrawer'));
    expect(
      readers.map((f) => f.rel),
      'verifyDrawer gained a consumer — F19 is resolved for this control, so re-measure the ' +
        'plan row instead of leaving it claimed as inert',
    ).toEqual(['features/restaurant/screens/RestaurantPaymentsScreen.tsx']);
  });
});
