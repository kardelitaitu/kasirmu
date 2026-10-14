// ── RestaurantMenuEditorScreen: three actions that dropped silently ──────
//
// `handleToggleItemAvailability`, `handleBulkSetAvailability` and
// `handleSaveCategory` each opened with a bare token guard:
//
//     if (!sessionToken) return;
//
// All three are actions the operator performs from the menu editor, and this file
// ALREADY reports through `addToast` — `handleSaveCategory` calls it a few lines below
// its own guard, for a duplicate category name. So the no-token branch was the one mute
// path: the toggle flips back, the bulk action does nothing, the category modal stays
// open, and none of it says why.
//
// The same class rounds 41-66 fixed in StockShortfallDialog, the restaurant settings
// and payments screens, the EDC cards and TableManagementScreen. This file IS restaurant
// POS, which is the surface this objective is about, so it is fixed by NAME here.
//
// The assertion is about the guard's SHAPE — braces with a report inside, rather than
// `if (...) return;` as one statement. Three earlier drafts of the sibling guard in
// TableManagementScreen proved that "the handler toasts somewhere" passes against broken
// handlers, because the catch block satisfies it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const SRC = readFileSync(
  resolve(REPO, 'ui/src/features/restaurant/screens/RestaurantMenuEditorScreen.tsx'),
  'utf-8',
);

/** Handlers the operator performs, each of which must report when the token is gone. */
const ACTIONS = [
  'handleToggleItemAvailability',
  'handleBulkSetAvailability',
  'handleSaveCategory',
];

describe('a menu-editor action reports when the session token is missing', () => {
  it.each(ACTIONS)('%s reports on the token branch', (name) => {
    const at = SRC.indexOf('const ' + name);
    expect(at, name + ' not found — rename this guard row with it').toBeGreaterThan(-1);

    const guardAt = SRC.indexOf('!sessionToken', at);
    expect(guardAt, name + ' no longer checks sessionToken').toBeGreaterThan(-1);

    const semi = SRC.indexOf(';', guardAt);
    const brace = SRC.indexOf('{', guardAt);
    const braced = brace !== -1 && brace < semi;

    expect(
      braced,
      name + ' returns SILENTLY (`if (...) return;`). The operator acts, nothing ' +
        'happens, and this file already reports through addToast — put the message in ' +
        'the guard: if (!sessionToken) { addToast(...); return; }',
    ).toBe(true);

    const block = SRC.slice(brace, SRC.indexOf('}', brace) + 1);
    expect(
      block,
      name + ' guard is braced but says nothing. It must report, the way this file ' +
        'already reports elsewhere.',
    ).toMatch(/addToast\(/);
  });

  it('the guard is not vacuous', () => {
    // A renamed handler, or a screen that stopped reporting entirely, would make every
    // case above pass for the wrong reason.
    expect(SRC.length).toBeGreaterThan(10_000);
    expect(SRC).toMatch(/addToast\(/);
  });
});
