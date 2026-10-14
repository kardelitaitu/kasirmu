// ── SalesHistoryScreen: three invoice actions that dropped silently ──────
//
// `handleConfirmStamp`, `handleCreatePengganti` and `handleIssueTaxInvoice" each open
// with a combined guard:
//
//     if (!detail || !sessionToken) return;
//
// Both of this file's action families report on their OTHER paths — `handleConfirmStamp
// through `setStampError`, the other two through `addToast` — so the no-token branch was
// the one mute path on each. The operator enters a 13-digit NSFP, presses Stamp, and
// nothing happens; or presses Issue Tax Invoice and the modal stays.
//
// A statutory-invoice defect is not cosmetic. These are the e-Faktur Pajak paths
// (DJP Coretax PER-11/PJ/2025): a sale that reaches a customer without its stamp
// recorded is a compliance gap the store discovers later, not at the till.
//
// ── Why the guard splits ──
//
// `!detail` means there is no open sale, which for a detail screen that renders its
// own empty state is not worth a message. A missing TOKEN is a different fact: the
// action cannot be attempted and the operator has to be told, or they retry.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const SRC = readFileSync(
  resolve(REPO, 'ui/src/features/sales/SalesHistoryScreen.tsx'),
  'utf-8',
);

/** Invoice actions the operator performs. */
const ACTIONS = [
  'handleConfirmStamp',
  'handleCreatePengganti',
  'handleIssueTaxInvoice',
];

describe('an invoice action reports when the session token is missing', () => {
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
      name + ' returns SILENTLY. The !detail half of this condition is fine — the ' +
        'screen renders its own empty state — but a missing token is worth telling ' +
        'the operator about. This file already reports through setStampError and ' +
        'addToast. Split the guard and report.',
    ).toBe(true);

    const block = SRC.slice(brace, SRC.indexOf('}', brace) + 1);
    expect(
      block,
      name + ' guard is braced but says nothing. Report the way this file already ' +
        'does elsewhere.',
    ).toMatch(/addToast\(|setStampError\(/);
  });

  it('the guard is not vacuous', () => {
    expect(SRC.length).toBeGreaterThan(20_000);
    expect(SRC).toMatch(/addToast\(/);
  });
});
