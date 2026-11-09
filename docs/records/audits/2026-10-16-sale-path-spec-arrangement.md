# Two sale-path specs failed on their own arrangement, not on the till

**Date:** 2026-10-16
**Scope:** `ui/e2e/sale.spec.ts` (2 of 12 red), `ui/e2e/e2e-sale-to-history.spec.ts` (1 of 1 red).
**Verdict:** the product was correct in both; the specs mis-described it. Two spec-level
fixes, both kill-tested. No production code changed.

## Finding 1 — a guard swallowed the failure it was supposed to report

`sale.spec.ts` opens with a claim:

    E2E: Complete Sale Flow — Hard Assertions
    Tests the POS sale flow with deterministic assertions. All `if` guards
    removed — tests hard-fail on regressions.

**Eleven guards remained**, and the failing test reported the wrong thing because of it.
It clicked the settle button under a guard:

    const confirmCount = await confirmBtn.count();
    if (confirmCount > 0) { await confirmBtn.click(); }

so when the click did not happen, the NEXT assertion failed instead:

    Error: expect(locator).toBeVisible() failed
    Locator: locator('.retail-cart-empty')

That error names the cart. The actual fault was upstream at the settle step — and the
error-context snapshot showed the truth the assertion could not: the Payment dialog still
open, holding an untouched receipt with its `Skip` / `Issue Tax Invoice` /
`Print Receipt` buttons.

### Fix

Replace the guard with the assertion the file already promised, and await the receipt as a
consequence of a committed sale rather than probing for it:

    await expect(confirmBtn, 'the settle control must be present to complete the sale').toBeVisible({ timeout: 8_000 });
    await confirmBtn.click();
    await expect(page.locator('.receipt-preview-paper')).toBeVisible({ timeout: 10_000 });
    await page.locator('button:has-text("Skip")').first().click();
    await expect(page.locator('.receipt-preview-paper')).toHaveCount(0, { timeout: 8_000 });

`'Complete'` was added to the button locator because that is the label the modal actually
renders (measured: `confirmText: "Complete"`, enabled).

## Finding 2 — the receipt renders INSIDE the payment modal

`e2e-sale-to-history.spec.ts` waited for the modal to disappear **before** dismissing the
receipt:

    await completeBtn.click();
    await expect(page.locator('[data-testid="payment-modal"]')).toBeHidden({ timeout: 10_000 });  // :96
    const receiptPaper = page.locator('.receipt-preview-paper');                                   // :101

Measured containment, straight from the DOM after a completed sale:

| Reading | Value |
|---|---|
| `modalPresent` / `modalVisible` | true / true |
| `paperPresent` / `paperVisible` | true / true |
| `paperInsideModal` | **true** |
| `paperParent` | `receipt-preview` |

The receipt is a child of the modal, so the modal cannot be hidden while the receipt is up.
The `toBeHidden` call polled 24 times against a dialog whose only content was the receipt
the test had not yet closed — an unwinnable wait written in the wrong order.

### The QRIS failure, same run

`QRIS payment generates QR code overlay` failed with:

    Error: locator.check: Element is outside of the viewport
    locator resolved to <input type="radio" value="qris" name="payment-method"/>

`check({ force: true })` bypasses actionability but NOT the zero-box check. The radio is
styled-radio markup (`PaymentModal.css:341-348`): `position: absolute; opacity: 0;
width: 0; height: 0; pointer-events: none` — deliberately a 0x0 box, with the `<label>` as
the real target. **Verified this is correct, not a defect:**

| Check | Result |
|---|---|
| radio box | `0 x 0` (by design) |
| label box (real target) | `191.5 x 36.75` |
| click the LABEL -> radio checked | true, `.payment-qris-section` renders |
| keyboard focus | reaches `INPUT/qris` |
| `Space` -> checked | true |

Pointer-reachable and keyboard-reachable. The spec now clicks the label, which is what a
user does.

## Kill tests

Each fix was reverted and the suite re-run; both reverts went red, then were restored:

| Reverted to | Result |
|---|---|
| `qrisRadio.check({ force: true })` | QRIS test **fails** again |
| `toBeHidden` before the receipt dismissal | sale-to-history test **fails** again |

Kill-testing the settle-assertion change ALONE did **not** go red — the original failure
needed the combination of the guard and the receipt timing. Recorded rather than rounded up:
the hard assertion is a legibility fix (it names the settle button instead of the cart), and
finding 2 is the functional one.

## Result

`sale.spec.ts`: **12/12** (was 10/12). `e2e-sale-to-history.spec.ts`: **1/1** (was 0/1).
Together with `pos-workflows` and `e2e-pos-to-kds`: **18 passed / 0 failed**.
`tsc --noEmit` clean, `lint` 0 errors. Committed `36dc98c1e`.

> last audited 16-10-26 by docs-auditor
