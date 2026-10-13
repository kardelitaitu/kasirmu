// ── Every restaurant toggle fails SAFE when its setting cannot be read ───
//
// PosScreen loads eight `restaurant.*` settings asynchronously and keeps each as
// `boolean | null`, where null means "not loaded, or the read failed". The consumer
// then decides. For the four that gate something a KITCHEN loses if it is off, the
// decision must be \`?? true\` / \`!== false\` — i.e. a failed read behaves as though
// the feature were ON.
//
// The direction matters because the two failure modes are not symmetric:
//
//   · fail-ON wrongly  -> an extra chit prints, an order is dispatched twice
//   · fail-OFF wrongly -> the kitchen never learns the order exists
//
// The second is invisible from the till and is discovered when food does not arrive.
// Round 61 pinned this for auto_print_kitchen after finding that only the explicit-true
// route had a test; the same sweep found `dispatchOnTabSave` and `soundChime` had NO
// coverage at all. This file pins the property for all of them at once, so the next
// setting added has to state its direction.
//
// It reads the SOURCE rather than rendering, deliberately: the property is about which
// default expression each consumer wrote, and rendering four components to observe a
// fallback would test the fallback rather than the pattern.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf-8');

const POS = read('ui/src/features/sales/PosScreen.tsx');
const HELD = read('ui/src/features/sales/hooks/usePosHeldCarts.ts');
const ACTION_BAR = read('ui/src/features/sales/components/CartActionBar.tsx');

/**
 * Toggles whose OFF state costs the kitchen something it cannot recover from.
 *
 * `declare` is where the state is created (must be nullable, so "unknown" is
 * representable), `consume` is the file whose expression decides the direction, and
 * `pattern` is the fail-safe form that must appear there.
 */
const FAIL_SAFE: Array<{
  key: string;
  file: string;
  declare: string;
  consume: string;
  pattern: RegExp;
  why: string;
}> = [
  {
    key: 'auto_print_kitchen',
    file: POS,
    declare: 'autoPrintKitchen',
    consume: POS,
    pattern: /autoPrintKitchen !== false/,
    why: 'a chit that does not print means the kitchen never sees the order',
  },
  {
    key: 'dispatch_on_tab_save',
    file: POS,
    declare: 'dispatchOnTabSave',
    consume: HELD,
    pattern: /dispatchOnTabSave !== false/,
    why: 'an undispatched delta means the line is saved but never cooked',
  },
  {
    key: 'sound_chime',
    file: POS,
    declare: 'soundChime',
    consume: POS,
    pattern: /soundChime !== false/,
    why: 'a missed chime is recoverable, but the OUTCOME must still be stated rather ' +
      'than left to `if (x)`, which silently inverts the meaning of unknown',
  },
  {
    // The two remaining restaurant settings. Both gate a VISIBLE control on the
    // action bar, so the failure mode is the operator losing a button rather than the
    // kitchen losing an order. Failing ON keeps the control reachable; failing OFF
    // hides it for a reason that exists only in a lost IPC reply, which reads to the
    // cashier as a broken till.
    key: 'print_bill_action',
    file: POS,
    declare: 'printBillEnabled',
    consume: POS,
    pattern: /printBillEnabled \?\? true/,
    why: 'a hidden Print Bill button during a settings outage looks like a defect in ' +
      'the till, not a lost reply',
  },
  {
    key: 'split_bill_by_item',
    file: POS,
    declare: 'splitBillEnabled',
    consume: POS,
    pattern: /splitBillEnabled \?\? true/,
    why: 'a missing Split Bill cannot be told apart from a feature that was never ' +
      'implemented',
  },
];

describe('restaurant toggles fail safe when their setting cannot be read', () => {
  it.each(FAIL_SAFE)('$key is declared nullable, so "unknown" is representable', (row) => {
    // A boolean default (`useState(false)`) would make a failed read indistinguishable
    // from a real "off", which is the bug this whole file is about.
    const decl = row.file.match(new RegExp('const \\[' + row.declare + ', set\\w+\\] = useState<([^>]+)>'));
    expect(decl, row.declare + ' not found in its file — repoint this guard').not.toBeNull();
    expect(
      decl![1],
      row.declare + ' must be `boolean | null`: a plain boolean cannot record that the ' +
        'setting was never read.',
    ).toMatch(/boolean \\| null/);
  });

  it.each(FAIL_SAFE)('$key treats an unread setting as ON — $why', (row) => {
    expect(
      row.consume,
      row.declare + ' does not use the fail-safe form in the file that consumes it. ' +
        'A failed read must behave as though the feature were on: ' + row.why,
    ).toMatch(row.pattern);
  });

  it('no consumer of these flags uses a bare truthiness test', () => {
    // `if (autoPrintKitchen)` is the defect: it reads null as OFF. The three fail-safe
    // forms are all explicit comparisons, so a bare test is always wrong here.
    for (const row of FAIL_SAFE) {
      for (const src of [POS, HELD]) {
        const bare = new RegExp('if \\(' + row.declare + '\\s*\\)');
        expect(
          src,
          'a bare `if (' + row.declare + ')` treats "not loaded" as OFF. Use the ' +
            'explicit form so the unknown case is a decision, not an accident.',
        ).not.toMatch(bare);
      }
    }
  });

  it('the action-bar gates use `!== false`, so null keeps the button visible', () => {
    // The other half of the same property. PosScreen's `?? true` decides what the
    // CHILD receives; the child's `!== false` decides what it renders. Both must be
    // fail-open, and a child written as `if (printBillEnabled)` would undo the parent's
    // default by inventing a third state.
    for (const flag of ['printBillEnabled', 'splitBillEnabled']) {
      expect(
        ACTION_BAR,
        flag + ' is not rendered with the fail-open form: a bare truthiness test would ' +
          'hide the button when the setting is merely unknown.',
      ).toMatch(new RegExp(flag + ' !== false'));
    }
  });

  it('the guard is not vacuous', () => {
    // A renamed form must fail loudly rather than match nothing.
    expect(FAIL_SAFE.length).toBe(5);
    expect(POS.length).toBeGreaterThan(10_000);
  });
});
