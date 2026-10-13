// ── Three POS actions that dropped silently, and one that only looked like one ──
//
// Fixed here:
//
//   usePosCartActions.handleDeductionPinVerified  if (!sessionToken) return;
//   useAutoQr.handleAutoReissue                   if (!autoQr || !sessionToken) return;
//   useAutoQr.handleAutoCancel                    if (!autoQr || !sessionToken) return;
//
// Each toasts on its other paths — `pos-toast-override-recorded` / `-failed` in the
// first, the auto-QR lifecycle messages in the others — so the token branch was the one
// silent outcome. A manager enters an override PIN, nothing is recorded, and nothing says
// why; or the cashier cancels an auto-QR and the cancellation is never reported.
//
// ── The false positive, recorded because it will recur ──
//
// The census that produced this list also flagged `RetailPosScreen`, naming
// `handleDeleteHeldCart`. Reading it showed the guard is inside a `useEffect` — a LOAD
// whose failure renders an empty list — and the name came from a backward search that
// stopped at a nearby declaration rather than the enclosing one.
//
// That is the same extraction weakness documented in userActionTokenGuardReports.test.ts,
// and it is why this file names its three actions explicitly instead of detecting them.
// A rule that guesses which function owns a guard will sometimes guess wrong, and a guard
// built on a wrong guess reports the wrong file.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf-8');

const CART_ACTIONS = read('ui/src/features/sales/hooks/usePosCartActions.ts');
const AUTO_QR = read('ui/src/features/sales/payment/useAutoQr.ts');

const ACTIONS: Array<[string, string]> = [
  [CART_ACTIONS, 'handleDeductionPinVerified'],
  [AUTO_QR, 'handleAutoReissue'],
  [AUTO_QR, 'handleAutoCancel'],
];

describe('these POS actions report when the session token is missing', () => {
  it.each(ACTIONS)('%s reports on the token branch', (_src, name) => {
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
        'condition may stay quiet, but a missing token is an outcome the operator ' +
        'cannot discover on their own. Report it, the way this file already reports ' +
        'on its other paths.',
    ).toBe(true);

    const block = src.slice(brace, src.indexOf('}', brace) + 1);
    expect(block, name + ' guard is braced but says nothing.').toMatch(/addToast\(/);
  });

  it('RetailPosScreen is NOT one of these: its bare guard is in a load', () => {
    // Pinned so a future census does not re-flag it. The census named
    // `handleDeleteHeldCart` because its backward search stopped at a nearby declaration;
    // the guard actually belongs to the mount effect two statements below it.
    //
    // Read to confirm BOTH halves, because "the guard is elsewhere" is not the same fact
    // as "the handler reports": `handleDeleteHeldCart` has NO token guard at all — it
    // passes `sessionToken` straight into the scoped call inside a try, and toasts on
    // failure. That is a third correct shape, and it is why this case asserts the
    // handler's shape rather than only the file's.
    const retail = read('ui/src/features/retail/RetailPosScreen.tsx');

    const handlerAt = retail.indexOf('const handleDeleteHeldCart');
    expect(handlerAt, 'handleDeleteHeldCart moved — re-read it').toBeGreaterThan(-1);
    const handlerEnd = retail.indexOf('}, [sessionToken', handlerAt);
    const handler = retail.slice(handlerAt, handlerEnd);
    expect(
      /!sessionToken/.test(handler),
      'handleDeleteHeldCart gained a token guard — if it returns silently, add it to ' +
        'ACTIONS above; if it reports, this case should say so instead.',
    ).toBe(false);
    // And it must still report its own failures.
    expect(handler, 'the handler lost its failure toast').toMatch(/addToast\(/);

    // The bare guard that made the census flag the file is the mount effect's.
    const effectAt = retail.indexOf('useEffect(() => {', handlerEnd);
    expect(effectAt, 'the held-cart mount effect moved').toBeGreaterThan(-1);
    const effect = retail.slice(effectAt, effectAt + 300);
    expect(effect).toMatch(/if \(!sessionToken\) return;/);
    expect(effect, 'the effect no longer loads').toMatch(/listHeldCartsScoped/);
  });

  it('the guard is not vacuous', () => {
    expect(ACTIONS.length).toBe(3);
    expect(CART_ACTIONS.length).toBeGreaterThan(3_000);
    expect(AUTO_QR.length).toBeGreaterThan(3_000);
  });
});
