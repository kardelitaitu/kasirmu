// ── A saved tab must not carry a party size for an order with no table ──────
//
// Round 45 established that PAX is dine-in-only, from the FTL rule the setting
// itself states:
//
//     restaurant-setting-guest-count-desc = Prompt for party size and number of
//                                           SEATED GUESTS PER TABLE
//
// and gated the FIELD on it (CartPanel.tsx:908 — `guestCountEnabled !== false &&
// orderType === 'dine_in'`). The three payloads that persist a tab were never
// brought along. In each, `trimmedGuest` is derived UNCONDITIONALLY while the
// `trimmedTable` line directly above it carries the guard:
//
//     const trimmedTable = orderType === 'dine_in' ? (tableNumber ?? '').trim() : '';
//     const trimmedGuest = (guestCount ?? '').trim();          <-- unguarded
//
// The reachable sequence is ordinary: a cashier seats a party of four, types 4,
// then the order becomes a takeaway (the customer changed their mind, or the
// cashier picked the wrong type first). The field HIDES at :908 but the value
// stays in state, so the saved tab records `guestCount: '4'` for an order with no
// table — and a recall restores it, showing a party size on a takeaway.
//
// Same class as the thirteen stray-table sites, on the sibling field. It was not
// caught by the tableNumber sweep because the sweep was keyed to the field, and
// not by the round-45 guard because that asserts the RENDER gate, not the payload.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const POS = readFileSync(resolve(__dirname, '../features/sales/PosScreen.tsx'), 'utf-8');
const HOOK = readFileSync(resolve(__dirname, '../features/sales/hooks/usePosHeldCarts.ts'), 'utf-8');

/** Every `const trimmedGuest = ...` derivation in a source, with its line. */
function guestDerivations(src: string): Array<{ line: number; text: string }> {
  return src
    .split(/\r?\n/)
    .map((text, i) => ({ line: i + 1, text }))
    .filter((l) => /const trimmedGuest\s*=/.test(l.text));
}

describe('pax is dine-in-only in the PERSISTED tab, not just the field', () => {
  it('every payload that derives a party size guards it on the order type', () => {
    const offenders: string[] = [];
    for (const [label, src] of [
      ['PosScreen.tsx', POS],
      ['usePosHeldCarts.ts', HOOK],
    ] as Array<[string, string]>) {
      for (const d of guestDerivations(src)) {
        if (!/orderType === 'dine_in'/.test(d.text)) {
          offenders.push(label + ':' + d.line + '  ' + d.text.trim());
        }
      }
    }
    expect(
      offenders,
      'These derive a party size unconditionally and write it into a saved tab. ' +
        'PAX is dine-in-only (the setting description says SEATED GUESTS PER ' +
        'TABLE), and CartPanel.tsx:908 already hides the field on a takeaway — so ' +
        'a cashier who types a pax and then switches to Takeaway persists a party ' +
        'size for an order with no table.',
    ).toEqual([]);
  });

  it('a RECALL will not resurrect a legacy party size onto a takeaway', () => {
    // The save-side fix does not repair tabs persisted before it: a legacy payload
    // carries guestCount even on a takeaway, because the field was hidden while the
    // value was still written. The recall applies guestCount BEFORE orderType, so
    // without its own gate a legacy tab resurrects a party size onto a takeaway.
    // It reads the PAYLOAD's orderType, not the current state, which is about to
    // change.
    expect(
      HOOK,
      'the recall must gate guestCount on the payload order type. Tabs saved before ' +
        'the save-side fix still carry a party size on a takeaway.',
    ).toMatch(/data\.guestCount === 'string' && data\.orderType !== 'takeaway'/);
  });

  it('still finds the derivations, so the check above cannot pass vacuously', () => {
    // A rename would leave the filter matching nothing and the case above green.
    const total = guestDerivations(POS).length + guestDerivations(HOOK).length;
    expect(total, 'no trimmedGuest derivation found — re-point this guard').toBeGreaterThanOrEqual(3);
  });
});
