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

    // Read each payload's OWN object literal, by BRAINCE-BALANCING back from the
    // persist call to its opening brace.
    //
    // The previous version walked back a fixed 1200 characters and took the nearest
    // `const draft = {` it found. Deleting a key shortens that span by far less than
    // 1200, so the window reached PAST the payload into an earlier literal that still
    // contained `orderType` — and excused it. Kill-tested: removing `orderType` from
    // the active-draft payload left this guard GREEN. A fixed-distance lookback is a
    // matcher keyed to proximity, which is how round 10's deps guard also went wrong.
    //
    // Brace balance cannot overshoot: it stops at the brace that closes the literal
    // the persist call is inside.
    const missing: number[] = [];
    for (const m of payloads) {
      const at = m.index ?? 0;
      // The payload is built as `const <name> = { … }` and passed BY NAME to
      // JSON.stringify, so the literal is not at the persist call. Read the name,
      // then read that declaration's own literal.
      const call = SRC.slice(at, at + 200);
      const ref = call.match(/JSON\.stringify\(\s*([A-Za-z_$][\w$]*)\s*\)/);
      if (!ref) {
        missing.push(SRC.slice(0, at).split('\n').length);
        continue;
      }
      const decl = SRC.lastIndexOf('const ' + ref[1] + ' = {', at);
      if (decl === -1) {
        missing.push(SRC.slice(0, at).split('\n').length);
        continue;
      }
      // Brace-balance from the declaration so the span is EXACTLY this literal. A
      // fixed-distance lookback reached into the neighbouring payload and excused a
      // removed key (kill-tested: the guard stayed green).
      const open = SRC.indexOf('{', decl);
      let depth = 0;
      let end = open;
      for (let k = open; k < at; k++) {
        const ch = SRC[k];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { end = k; break; }
        }
      }
      const body = SRC.slice(decl, end + 1);
      // Strip COMMENTS before looking for the key. The payload carries a comment that
      // explains why orderType rides with the cart, and it contains the word — so a
      // plain /orderType/ matched the PROSE and excused a payload whose key had been
      // deleted. Kill-tested: removing `orderType,` from the active-draft payload left
      // this guard green. A matcher keyed to text rather than to the property is the
      // same mistake the sibling guards record.
      const code = body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      // The property, in any of its written forms: shorthand `orderType,`, or
      // `orderType: value`.
      if (!/(^|[{,\s])orderType\s*[:,}]/m.test(code)) {
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
    // Assert the APPLY, not the identifier. `toContain('setOrderType')` passed with the
    // condition replaced by `if (false)` — the call was still there, just unreachable.
    // Kill-tested: that mutation left this case green, so the assertion proved only
    // that the name was typed somewhere.
    //
    // What must hold is that the payload's value is (a) VALIDATED against the union
    // and (b) APPLIED to the setter. Both, in that order.
    const validate = restore.match(
      /data\.orderType === 'dine_in'\s*\|\|\s*data\.orderType === 'takeaway'\s*\|\|\s*data\.orderType === 'delivery'/,
    );
    expect(
      validate,
      'the restore must validate the stored orderType against the union before' +
        ' applying it — an unchecked value reaches setOrderType.',
    ).not.toBeNull();
    const apply = restore.match(/setOrderType\(\s*data\.orderType\s*\)/);
    expect(
      apply,
      'the restore must APPLY the payload value (setOrderType(data.orderType)), not' +
        ' merely mention the setter.',
    ).not.toBeNull();
  });

  it('the restore assertions are not satisfied by commented-out code', () => {
    // A guard on a guard: the two patterns above must be matched on CODE. If a future
    // edit comments the apply out, `toContain`-style matching would still see it —
    // which is the defect this pair of cases exists to prevent.
    const restore = SRC.slice(
      SRC.indexOf('Restore locked cart or active draft on mount'),
      SRC.indexOf('Listen for Android OS memory trim'),
    );
    const code = restore
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(
      /setOrderType\(\s*data\.orderType\s*\)/.test(code),
      'the apply must be live code, not inside a comment',
    ).toBe(true);
  });
});
