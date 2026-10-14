/**
 * @vitest-environment node
 *
 * This file's entire import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── Every core rail toggle must reach the charge modal (F23) ──────────
//
// `RestaurantPaymentsScreen` renders all five `CORE_RAIL_CODES` as enable/disable
// switches. `PaymentModal` honours only SOME of them, and the gaps are invisible from
// either screen: the operator toggles a rail off and the tender keeps being offered.
//
// The mapping as measured (this test is the record of it):
//
//   qris       -> railOffered(paymentRails, 'qris')        WIRED
//   open_bill  -> !coreRailWithheld(...)                   WIRED (round 52)
//   credit     -> !coreRailWithheld(...)                   WIRED (abb1c324b)
//   cash       -> !coreRailWithheld(...)                   WIRED (2026-10-14, owner ruling)
//   card       -> !coreRailWithheld(...)                   WIRED (2026-10-14, owner ruling)
//
// WHY THE LAST TWO WERE INERT, and the owner ruling that inverted them (2026-10-14):
// the modal's
// `TENDER_RAILS` documents the reasoning for each (useLocalPaymentRails.ts:127-137).
// `cash` and `card` are described as UNIVERSAL — a site with no EDC terminal still takes
// a card by hand, so the `card` rail models the TERMINAL, not the tender. Wiring either
// changes checkout behaviour and is a product decision, not a reliability repair.
//
// `credit` WAS the third member of this list and is no longer INERT. `abb1c324b` wired
// `coreRailWithheld(paymentRails, 'credit')` into `PaymentModal`, which applies it in
// three places — the tender-list filter (:2251), a method redirect that moves a withheld
// selection back to cash (:370), and the Complete guard (:1160) — so switching the rail
// off now genuinely withholds the tender. This comment kept saying "parked" for one
// commit after the code stopped agreeing; moving the entry to WIRED is what made the
// file and the tree say the same thing.
//
// INVERT, DO NOT DELETE. When a rail is wired, move its entry from INERT to WIRED and
// this file keeps telling the truth. Deleting a case hides the gap.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = [
    'ui/src/features/sales/PaymentModal.tsx',
    'ui/src/features/restaurant/screens/paymentRailsLogic.ts',
  ];
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

const MODAL = 'ui/src/features/sales/PaymentModal.tsx';
const RAILS_LOGIC = 'ui/src/features/restaurant/screens/paymentRailsLogic.ts';

/**
 * Rails whose toggle the modal honours, and the expression that proves it.
 * The expression is matched against the modal source, so a rewiring that drops the
 * gate fails here rather than silently reverting the rail to inert.
 */
const WIRED: Record<string, RegExp> = {
  qris: /railOffered\(\s*paymentRails\s*,\s*'qris'\s*\)/,
  open_bill: /coreRailWithheld\(\s*paymentRails\s*,\s*'open_bill'\s*\)/,
  credit: /coreRailWithheld\(\s*paymentRails\s*,\s*'credit'\s*\)/,
  // INVERTED 2026-10-14 on an owner ruling. `cash` and `card` were INERT, and the
  // ruling was to wire them, not to accept them as universal: the modal's own
  // `coreRailWithheld` helper already distinguishes the three states that matter
  // (no row -> offered, so a store whose list predates the rail still takes cards
  // by hand; enabled -> offered; DISABLED -> withheld). So wiring them honours the
  // operator's own saved switch without withdrawing anything from anyone who never
  // switched it off. PaymentModal.tsx consumes both.
  cash: /coreRailWithheld\(\s*paymentRails\s*,\s*'cash'\s*\)/,
  card: /coreRailWithheld\(\s*paymentRails\s*,\s*'card'\s*\)/,
};

/** Core rails whose toggle nothing in the modal reads. Recorded, with the reason. */
const INERT: Record<string, string> = {
  // EMPTIED 2026-10-14: every core rail is now honoured by the modal. The last two,
  // `cash` and `card`, were wired on an owner ruling that rejected the "universal"
  // framing -- they are universal in the NO-ROW sense, which `coreRailWithheld`
  // already encodes, and the operator's explicit `is_enabled: false` is their own
  // saved switch. An empty map means there is no gap to hide.
};

describe('core rail toggles reach the charge modal (F23)', () => {
  it('the core rail list is exactly the five this file accounts for', () => {
    // Guards the guard: a NEW core rail must be classified here, not pass by omission.
    const src = read(RAILS_LOGIC);
    const m = src.match(/CORE_RAIL_CODES\s*=\s*\[([^\]]+)\]/);
    expect(m, 'CORE_RAIL_CODES not found — the extraction regex has drifted').not.toBeNull();
    const codes = m![1]!.split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    expect(codes.length, 'every core rail needs a WIRED or INERT entry in this test').toBe(
      Object.keys(WIRED).length + Object.keys(INERT).length,
    );
    expect([...Object.keys(WIRED), ...Object.keys(INERT)].sort()).toEqual([...codes].sort());
  });

  it('each WIRED rail really is gated in the modal', () => {
    const modal = read(MODAL);
    for (const [rail, pattern] of Object.entries(WIRED)) {
      expect(
        pattern.test(modal),
        `rail "${rail}" is recorded as WIRED but its gate is gone from PaymentModal`,
      ).toBe(true);
    }
  });

  it('each INERT rail really is unread by the modal', () => {
    // The load-bearing half: if someone wires one WITHOUT moving its entry, this fails
    // and the list gets updated — which is the point of an INERT/WIRED split.
    const modal = read(MODAL);
    for (const rail of Object.keys(INERT)) {
      // ⚠️ `railParam` is deliberately EXCLUDED from this pattern, and that distinction
      // is the whole test. `railParam(paymentRails, 'cash', 'autoKick', …)` reads a
      // PARAMETER on the cash rail (F18's auto-kick), not the rail's own `is_enabled` —
      // so it does not make the cash TOGGLE honoured. Only `railOffered` /
      // `coreRailWithheld` answer "is this rail switched on", which is what the toggle
      // on the payments screen actually writes.
      const gate = new RegExp(
        `(railOffered|coreRailWithheld)\\(\\s*paymentRails\\s*,\\s*'${rail}'`,
      );
      expect(
        gate.test(modal),
        `rail "${rail}" is recorded INERT but the modal now reads its is_enabled flag — ` +
          'move it to WIRED',
      ).toBe(false);
    }
  });
});