// ── PaymentModal / PosScreen: three more actions that dropped silently ───
//
// Each opens with a combined guard whose TOKEN half returns without a word, while the
// same handler reports on its other paths:
//
//   PaymentModal.handleIssueTaxInvoice  if (!completedSaleId || !sessionToken || !receiptArgs) return;
//   PosScreen.handleChangePhoto         if (!sessionToken || !session?.user_id || avatarBusy) return;
//   PosScreen.handleSendToKitchen       if (lines.length === 0 || !sessionToken) return;
//
// `handleChangePhoto` proves the channel in the same handler: three lines below its guard
// it calls `addToast` for the browser-preview case, with a comment explaining why that
// refusal is worth a message. The token case is the same kind of fact and was the one
// left mute.
//
// ── The one with a physical consequence ──
//
// `handleSendToKitchen` delegates to `handleDispatchKitchenDelta`, which is ALSO silent on
// a missing token. So with no session the operator presses Send to Kitchen and the kitchen
// is never told, with nothing on screen to distinguish "not sent" from "sent and ignored".
// Round 62 pinned the fail-SAFE direction for an unreadable auto_print_kitchen; this is the
// same concern one layer down — a setting that cannot be read must not silently stop food.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf-8');

const PAYMENT = read('ui/src/features/sales/PaymentModal.tsx');
const POS = read('ui/src/features/sales/PosScreen.tsx');

/** [source, handler], each of which must report on its token branch. */
const ACTIONS: Array<[string, string]> = [
  [PAYMENT, 'handleIssueTaxInvoice'],
  [POS, 'handleChangePhoto'],
  [POS, 'handleSendToKitchen'],
  [POS, 'handleDispatchKitchenDelta'],
];

describe('these actions report when the session token is missing', () => {
  it.each(ACTIONS)('%s: %s reports on the token branch', (_label, name) => {
    const src = ACTIONS.find(([, n]) => n === name)![0];
    const at = src.indexOf('const ' + name);
    expect(at, name + ' not found — rename this guard row with it').toBeGreaterThan(-1);

    const guardAt = src.indexOf('!sessionToken', at);
    expect(guardAt, name + ' no longer checks sessionToken').toBeGreaterThan(-1);

    const semi = src.indexOf(';', guardAt);
    const brace = src.indexOf('{', guardAt);
    expect(
      brace !== -1 && brace < semi,
      name + ' returns SILENTLY on a missing sessionToken. The other half of its ' +
        'condition may stay quiet — an empty cart or a browser preview is its own ' +
        'explanation — but a missing token is not. Report it: ' +
        "if (!sessionToken) { addToast({ message: requiredLocalized(l10n, " +
        "'pos-toast-auth-required'), type: 'warning' }); return; }",
    ).toBe(true);

    const block = src.slice(brace, src.indexOf('}', brace) + 1);
    expect(
      block,
      name + ' guard is braced but says nothing.',
    ).toMatch(/addToast\(|setError\(/);
  });

  it('the guard is not vacuous', () => {
    expect(PAYMENT.length).toBeGreaterThan(100_000);
    expect(POS.length).toBeGreaterThan(60_000);
    expect(PAYMENT).toMatch(/addToast\(/);
    expect(POS).toMatch(/addToast\(/);
  });
});
