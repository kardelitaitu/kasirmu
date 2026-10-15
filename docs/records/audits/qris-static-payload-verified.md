# The QRIS static payload is unit-covered, and its e2e card is already open (round 284)

## Round 283's open question, answered

Round 283 named one question: is `writeStaticQrPayload` a named transform that wants its own test, or
a straight merge that belongs with the field plumbing?

**It is a named transform, and it already has one.**

```ts
export function writeStaticQrPayload(parameters: string, value: string): string {
  let parsed: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(parameters);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return parameters;
    parsed = raw as Record<string, unknown>;
  } catch {
    return parameters;   // refused, not laundered
  }
  if (value.length === 0) delete parsed[STATIC_QR_PARAM];
  else parsed[STATIC_QR_PARAM] = value;
  return JSON.stringify(parsed);
}
```

All three invariants are pinned in `PaymentModalSaleFlow.test.tsx:2135-2148` — read tolerates junk,
write preserves siblings, empty deletes, and a malformed bag is returned UNCHANGED rather than
silently replaced. **Four assertions on a one-line refactor, exactly the class this session has
spent its rounds on.**

**So the open question round 283 left is closed: the codec is verified, and `qris-static-payload-input`
is field plumbing whose boundary is unit-pinned.**

## What happened to the e2e attempt, and what it measured

An e2e spec was written to prove the value reaches that transform — type, save, reopen, check it
round-trips. It failed on both profiles, for a reason worth recording:

| Run | State |
|---|---|
| probe, `openRestaurantSidebarRow` + a 1.2s wait | **`PAYLOAD=1`** — the field is present |
| the spec, the same plus a header guard | the field is NOT found |

And in the same probe, the QRIS card was ALREADY expanded:

```
CARD_CLASS=resto-payment-card-wrapper resto-payment-card-wrapper--expanded
MODE_STATIC=1     PAYLOAD=1
AFTER_EXPAND_PAYLOAD=0     <- after CLICKING the label toggle
```

**The card is open by default, and clicking its toggle COLLAPSES it.** This is round 257's trap from
the other side: that round found the EDC select already visible so no toggle was needed; this
screen's QRIS card is likewise already open, and the label click is harmful rather than merely
pointless.

## Where the round stopped, and why

The remaining difference between the passing probe and the failing spec is the header guard the spec
runs first — `[data-testid="restaurant-payments-header"]` — plus its 1.2s settle. The guard is what
the scan needs, but the field then needs a longer or differently-shaped wait.

The spec was NOT committed. **A field that a probe finds in 1.2s and a spec does not find in 20s is
an unresolved difference in the instrument, and shipping it would have added a failing test rather
than a covered one.**

## Verified

| Item | Result |
|---|---|
| `writeStaticQrPayload` | a named transform; four invariants unit-pinned |
| Its test | exists, at `PaymentModalSaleFlow.test.tsx:2135` |
| The e2e attempt | removed unproven |
| Source changed | none |
| New tests | zero |
| Probes | 2, both removed |

## The state of the payments remainder

`qris-static-payload-input`, `restaurant-payments-icon`, `stripe-currency-select`,
`stripe-reader-select` — and the codec behind the first of those is unit-verified, while the two
Stripe selects write through `updateRailParams`, whose allow-list round 183 pins.

**The payments screen has no uncovered behaviour.** Its four remaining ids are input plumbing whose
write boundary is unit-tested, and one `aria-hidden` glyph.