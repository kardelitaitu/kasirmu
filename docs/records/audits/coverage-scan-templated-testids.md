# The coverage scan could not see templated testids (round 224)

## What this round set out to do

Take the payments screen, which the previous scan reported at 5 of 32 — the weakest restaurant
surface — and cover a reachable group in it.

## What it found instead

Checking the QRIS pair before writing anything, because round 191 had already covered it:

```ts
function qrisMode(page: Page, mode: 'static' | 'dynamic') {
  return page.locator(`[data-testid="qris-mode-${mode}"]`);   // TEMPLATED
}
```

**The spec exists and the scan could not see it.** Every coverage number this session has quoted
came from matching `data-testid="<id>"` literally, and a template literal never matches. The
instrument was wrong, not the coverage.

## The correction, and its exact size

The scan now also reads `data-testid="<prefix>${…}"` and `[data-testid^="<prefix>"]`. Re-derived
across the restaurant surfaces, it moves **six testids on two screens**:

| Screen | Old | Corrected | Moved by the fix |
|---|---|---|---|
| payments | 27 uncovered | 25 | `qris-mode-static`, `qris-mode-dynamic` |
| settings | 8 uncovered | 4 | `settings-card-workflow`, `-dining-ops`, `-kitchen`, `-interaction` |
| receipts | 6 uncovered | 6 | — |
| editor | 4 uncovered | 4 | — |

Nothing else moved, which is what makes the correction trustworthy: a fix that shifted everything
would have been a different bug.

## The conclusions that survive

Two of round 222's and 223's claims rested on the faulty numbers, and both were checked rather
than reasserted:

| Round | Claim | Status |
|---|---|---|
| 222 | *"the receipts screen at 5 of 15, now the weakest"* | **the count was wrong** (9 of 15) and *weakest* was wrong too — payments is lower |
| 222 | *"the diagnostics were uncovered"* | **correct** — that spec was new work, and the corrected scan still shows those testids uncovered |
| 223 | *"the load-error pair was the last reachable one"* | **unaffected** — the receipts count did not move |

So one claim is retracted and two stand. The retraction is the honest output of the round.

## The reachable group that did not work

The EDC block looked promising — `edc-default-select` and `edc-test-connection-btn` are the same
shape as the QRIS control round 191 covered. Probed:

```
SELECT=1   OPTIONS=[]   TEST_BTN=0   CARD_ENABLED=true
```

The select renders with **no options**, even after a 3-second settle, and the test button needs a
selected terminal so it never appears. The mock DOES seed two active terminals
(`handlers/payment.ts:155-175`, `isActive: true`) and the DTO matches the fixture field-for-field
(`api/edc.ts:41`), so the filter at `:383` should pass them. Where the read is lost was not
established inside this round's budget — the `.catch(() => [])` at `:377` masks a rejection, and
that is the first thing to check next.

## Verified

| Item | Result |
|---|---|
| Scan correction | 6 testids on 2 screens, nothing else moved |
| Claims retracted | 1 of 3 |
| New tests | zero |
| Source changed | none |

## The shape

**A coverage count is a measurement, and a measurement with a broken instrument is a story.**
This is the third time this session a scan produced a finding that was not there — rounds 175's
regex splitting `.tsx` into `.ts`, 218's transform-minus mistaken for a reach-out, and now a
template literal read as an absence. The tell is the same each time: **a number that contradicts
what a sibling round already recorded.**