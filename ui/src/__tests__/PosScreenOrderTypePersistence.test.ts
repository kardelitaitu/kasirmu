// ── A restored cart must come back as the order type it was saved as ────────
//
// PosScreen persists the in-progress cart in three places — the active-draft
// effect, the memory-trim handler, and the terminal LOCK — and restores from
// whichever of them exists on mount. All three payloads carried the lines,
// discounts, tips, service charge, table, customer and pax, and ALL THREE
// omitted `orderType`; the restore never called `setOrderType` either.
//
// So the order type fell back to its `dine_in` default on every restore. The
// cashier's sequence that loses money or mislabels food:
//
//   1. Rings up a TAKEAWAY (no table, food in a bag).
//   2. The tablet reloads, the OS trims memory, or the cashier locks the till
//      for a break — all ordinary events on a counter device.
//   3. The cart comes back as DINE-IN.
//
// dine_in is not cosmetic here: it is what gates the table claim and release
// (rounds 40-45) and what the KITCHEN reads to decide whether the ticket is a
// table service or a bag. Coming back as the wrong type sends the wrong ticket
// to the pass and can free a table the takeaway never had.
//
// WHY THIS IS A SOURCE CHECK
// The three payloads are object literals inside effects and a callback; a
// behavioural test would need to drive a real sale, trigger a reload, and then
// read back the order type — scaffolding the production code does not expose.
// The omission is statically visible, so it is read directly, and the weaker
// evidence is stated rather than implied (same trade as the floor-sync guard).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../features/sales/PosScreen.tsx'), 'utf-8');

describe('PosScreen cart persistence carries the order type', () => {
  it('every persisted cart payload records orderType', () => {
    // Each payload is the object literal whose key list ends with `guestCount,`
    // and is handed to JSON.stringify. Assert the literal names orderType.
    // Anchor on the PERSIST CALL, not on a key that happens to sit last: the fix
    // adds a key above the closing brace, so a regex keyed to `guestCount,` followed
    // by `};` stops matching the moment the defect is repaired — which is how this
    // guard first reported a fix it had just seen applied.
    const payloads = [...SRC.matchAll(/localStorage\.setItem\((?:ACTIVE_DRAFT_KEY|LOCKED_CART_KEY)[^;]*;/g)];
    expect(
      payloads.length,
      'the persisted-cart payloads moved — re-point this guard (expected the' +
        ' active-draft, memory-trim and lock writes)',
    ).toBeGreaterThanOrEqual(3);

    // Walk back from each persist call to its object literal and read the keys.
    const missing: number[] = [];
    for (const m of payloads) {
      const at = m.index ?? 0;
      const before = SRC.slice(Math.max(0, at - 1200), at);
      const open = Math.max(
        before.lastIndexOf('const data = {'),
        before.lastIndexOf('const draft = {'),
      );
      // Fall back to the tail if the literal was renamed — better a loose read than
      // a guard that silently stops checking.
      const body = open >= 0 ? before.slice(open) : before.slice(-800);
      if (!/orderType/.test(body)) {
        missing.push(SRC.slice(0, at).split('\n').length);
      }
    }
    expect(
      missing,
      'These persisted-cart payloads omit orderType (payload tail at line: ' +
        missing.join(', ') +
        '). A restored takeaway comes back as dine_in, which gates the table' +
        ' claim/release and what the kitchen prints.',
    ).toEqual([]);
  });

  it('the restore path rehydrates orderType, not just the lines', () => {
    const restore = SRC.slice(
      SRC.indexOf('Restore locked cart or active draft on mount'),
      SRC.indexOf('Listen for Android OS memory trim'),
    );
    expect(restore.length, 'the restore effect moved — re-point this guard').toBeGreaterThan(0);
    expect(
      restore,
      'the restore reads the saved payload but never applies its orderType, so' +
        ' the state keeps the dine_in default.',
    ).toContain('setOrderType');
  });
});
