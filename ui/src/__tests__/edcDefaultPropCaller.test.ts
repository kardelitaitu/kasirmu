// ── Guard: a prop no production caller passes is dead code (F49) ───────────
//
// `useEdcTenderPhase` accepts `defaultTerminalId` and prefers it over the first
// active terminal (`:135`), and THREE tests exercise it. **No production caller
// passes it.** `PaymentModal.tsx:1019-1028` omits the prop entirely, so the branch
// can never fire and the hook always falls through to `activeRows[0]?.id` (`:138`).
//
// The consequence is an inert operator control one level up: the payments screen's
// "Default EDC" select writes `card.defaultTerminalId` into the rail parameters
// (`RestaurantPaymentsScreen.tsx:1320`) and nothing reads it, so a merchant who picks
// a preferred terminal still gets whichever one the backend lists first.
//
// ⚠️ This is the F19 shape with the sign flipped, and the check is the one round 112
// established: **find the layer that would ACT on the value.** A test that passes the
// prop proves the hook works; it does NOT prove anything calls the hook. Thirty tests
// could cover `:135` and the control would still be inert.
//
// It asserts the GAP, not a fix. Wiring it is a behaviour change — the POS would start
// opening a different terminal than it does today — so it stays a recorded decision
// rather than something this guard forces.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ⚠️ The walker must exclude CO-LOCATED `*.test.ts` too, not only a `__tests__`
// directory. My first version did not, and the only "caller" it found was the
// hook's own test file — i.e. the guard counted a TEST as production, which is the
// exact defect it exists to detect, committed inside the detector.
const SRC = path.resolve(process.cwd(), 'src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

/** Production UI sources under src, tests and dev mocks excluded. */
function uiSources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['__tests__', 'dev-mock'].includes(e.name)) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
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

describe('the EDC default-terminal prop has a real caller (F49)', () => {
  it('the hook still offers the branch, so the gap is worth recording', () => {
    const hook = read('features/sales/payment/useEdcTenderPhase.ts');
    expect(
      hook.includes('defaultTerminalId'),
      'the hook dropped defaultTerminalId — if F49 was resolved by DELETING the branch, ' +
        'delete this guard rather than leaving it green over nothing',
    ).toBe(true);
  });

  it('NO production caller passes defaultTerminalId, which is the defect', () => {
    // The failure mode is that someone reads the hook, sees the tests, and concludes
    // the feature works. This asserts the opposite so the gap cannot close silently.
    // ⚠️ Match a CALL SITE, not any mention. My first version searched for
    // `defaultTerminalId\s*[:=]` and got three false positives — a comparison in
    // EdcTerminalsCard and the rail write in the payments screen are reads and
    // writes of DIFFERENT things that share the name. The question is only whether
    // a caller of THIS HOOK supplies the prop, so the search is anchored to the
    // hook's own call shape.
    const callers = uiSources().filter((f) => {
      if (f.rel === 'features/sales/payment/useEdcTenderPhase.ts') return false;
      const callIdx = f.text.indexOf('useEdcTenderPhase({');
      if (callIdx === -1) return false;
      // Inspect only the argument object that follows the call.
      const args = f.text.slice(callIdx, f.text.indexOf('});', callIdx) + 1);
      return args.includes('defaultTerminalId');
    });
    expect(
      callers.map((f) => f.rel),
      'a production caller now passes defaultTerminalId — F49 is RESOLVED, the Default EDC ' +
        'select is live, and the plan row must be re-measured rather than left claimed inert. ' +
        'If it was wired, also check the two sources of truth do not now disagree: ' +
        'RestaurantPaymentsScreen.tsx:1319-1320 writes BOTH the hardware pref and the rail param',
    ).toEqual([]);
  });

  it('the screen still writes the rail param, which is what makes it inert', () => {
    const screen = read('features/restaurant/screens/RestaurantPaymentsScreen.tsx');
    expect(
      screen.includes("updateRailParams('card', { defaultTerminalId: v })"),
      'the screen stopped writing the rail param — F49 changed shape, re-measure it',
    ).toBe(true);
  });
});
