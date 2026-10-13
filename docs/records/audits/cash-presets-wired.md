# The cash presets are now read: rounds 120-121's inventory gets its first repair (round 122)

## What changed

**Before:** `RestaurantPaymentsScreen.tsx:1114` writes `updateRailParams('cash', { presets })`.
The till read `localStorage['restaurant-tender-presets']` — a key nothing writes — and fell
through to `defaultTenderPresets(activeCurrency)`. Round 121 established this was **14 of 15
rail parameters**.

**After:** the operator's choice reaches the till.

```ts
// ui/src/features/sales/useLocalPaymentRails.ts
export function cashTenderPresets(rails: LocalPaymentRail[] | null): number[] | null
```

```ts
// ui/src/features/sales/PosScreen.tsx
const tenderPresets = useMemo(() => {
  const fromRail = cashTenderPresets(paymentRails);   // 1. what the operator configured
  if (fromRail) return fromRail;
  ... localStorage['restaurant-tender-presets'] ...   // 2. dead key, kept as an override
  return defaultTenderPresets(activeCurrency);         // 3. the currency ladder
}, [activeCurrency, paymentRails]);
```

`PosScreen` now calls `useLocalPaymentRails(sessionToken)` — the same hook the payment modal
uses — so there is one source for rail state rather than a second copy.

## Precedence, and why it is this order

1. **the rail parameter** — a visible, saved operator decision in Settings -> Payments;
2. **the dead localStorage key** — nothing in the repo writes it (round 105), so an external
   provisioner can still override. Kept so no existing deployment's behaviour breaks;
3. **`defaultTenderPresets(currency)`** — the round-106 currency ladder.

Order 2 above 3 is deliberate: if someone IS provisioning that key, their values keep
winning. When round 105's conclusion ("nothing writes it") is eventually acted on by
deleting the read, that is a separate decision, not a side effect of this one.

## Contract decisions the tests pin

The chips row stores **strings** and includes the literal `'exact'`; the consumer wants
`number[]` of MAJOR units. Decisions, each covered:

| Case | Decision | Reason |
|---|---|---|
| `['exact','1000','2000']` | -> `[1000, 2000]` | `'exact'` is its own button already (`.payment-quick-btn--exact`) |
| missing / `[]` / non-array | -> **null**, not `[]` | an empty array renders an empty quick-tender row; null lets the caller keep its default — the same contract `railParam` keeps |
| unparseable bag, null rails | -> null | saved state being unreadable is not a preference |
| `['100','abc','0','-5']` | -> `[100]` | junk is DROPPED, not rendered as a button labelled "NaN" |
| `['abc','0']` | -> null | an entirely-junk list is no preference |
| non-integer | dropped | `CashTenderPanel` multiplies by `10^exp`; a fractional rung has no meaning there |

## A correction to round 121's method

Round 121's enumeration missed a reader. `readStaticQrPayload`/`writeStaticQrPayload`
(`api/local-payment.ts:81-110`) is a typed key-specific reader/writer pair for the QRIS
static payload, consumed at `useLocalPaymentRails.ts:225` and
`LocalPaymentSettingsCard.tsx:266`. Searching `railParam(` alone does not find it, so the
first version over-claimed by one.

**The conclusion survived** — re-running all 14 keys against every reader still finds none —
but the correction mattered, because that pair is the template this round followed:
preserve the other keys in the bag, return null rather than guess on a malformed one, and
treat an empty value as "no preference" rather than a value.

It also shows the QRIS rail IS wired through TWO editing surfaces — the payments screen and
Settings -> Business Defaults (`BusinessDefaultsScreen.tsx:12` imports the card). The unread
parameters are unread because nobody wrote the second half of that pair for them.

## Verified

| Gate | Result |
|---|---|
| New reader tests | 4 added, all RED before the implementation (21 existing stayed green) |
| `useLocalPaymentRails` suite | 25 passed |
| POS + payment suites | 212 passed, 1 skipped |
| Full suite | 12,661 passed, 0 failed (+4) |
| `tsc` / `eslint` | 0 / 0 |

## What remains of the round-121 inventory

13 parameters still have no reader: `mode`, `nmid`, `surcharge`, `defaultTerminalId`, `env`,
`merchantId`, `clientKey`, `serverKey`, `channels`, `publishableKey`, `secretKey`, `reader`,
`currency`. Several are CREDENTIALS that `local-payment.ts:17-18` says the backend
**rejects** in `parameters`, and `railParam` is boolean-only so a string/array parameter needs
its own typed reader — both reasons round 121 declined to wire them in bulk. This round
repaired the one where the operator decision is plainly live, the values are already in the
right units, and the consumer exists.