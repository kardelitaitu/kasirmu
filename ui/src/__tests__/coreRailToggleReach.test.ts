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
//   cash       -> (nothing)                                INERT
//   card       -> (nothing)                                INERT
//   credit     -> (nothing)                                INERT, parked
//
// WHY THE THREE ARE STILL INERT, and why this is a pin and not a fix: the modal's
// `TENDER_RAILS` documents the reasoning for each (useLocalPaymentRails.ts:127-137).
// `cash` and `card` are described as UNIVERSAL — a site with no EDC terminal still takes
// a card by hand, so the `card` rail models the TERMINAL, not the tender. `credit` is
// explicitly a parked owner question. Wiring any of them changes checkout behaviour and
// is a product decision, not a reliability repair.
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
};

/** Core rails whose toggle nothing in the modal reads. Recorded, with the reason. */
const INERT: Record<string, string> = {
  cash: 'TENDER_RAILS treats cash as universal (no rail models it)',
  card: 'TENDER_RAILS treats card as universal; the edc rail gates the terminal button, not the tab',
  credit: 'parked owner question (todo-payment.md :887) — tender vs facility',
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