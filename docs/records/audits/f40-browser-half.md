# F40's device-blocked verification is half closeable in the browser (round 155)

## What the plan carried

F40 (round 89, `267e23e9e`) found the restaurant Payments screen's rail toggles could not be
saved at all: the store's `local_payment_methods` table held zero rows, every card sat on the
defaulted branch, and **Save stayed disabled while the header read "All changes saved"**.

The fix landed in round 90. Round 111 tried to confirm it on the tablet and found a **fixture**
blocker, not a defect:

| Check | Result |
|---|---|
| device | reachable then (`192.168.0.185:46021`) |
| workspace cards | exactly **1** — "Retail POS" |
| restaurant Payments screen | **unreachable** — the restaurant workspace is gone |
| `adb devices` this round | **empty** |

So the plan has read *"the device confirmation is outstanding"* for forty rounds, which looks
like nobody tried. Somebody tried; the instrument is gone.

## What this round closed, and what it did not

`ui/e2e/restaurant-payment-rails-persist.spec.ts` drives the **screen's own write path** in the
browser, which is where the defect was — the screen never reached a write at all:

| Claim | Assertion |
|---|---|
| the rail read is not the defaulted branch | more than three `role=switch` elements render |
| an edit flips the rail | `aria-checked` changes through the label click |
| **Save arms** | `toBeEnabled` — F40 left it permanently disabled |
| the write is acknowledged | Save returns to disabled |
| the draft is not re-seeded stale | the toggle still reads what was clicked |

**Kill-tested**: forcing `disabled={true}` on the Save button at
`RestaurantPaymentsScreen.tsx:997` — F40's exact signature — fails the spec. Restored, file
verified identical to HEAD.

## The half that cannot move, and why that is a fact about the mock

The first draft asserted the toggle survived a **page reload**. It failed, and the reason is
documented in the mock itself:

```ts
// whether the site offers them. Session-local maps — the mock has no
// multi-row table, so the rails live in a Map keyed by scope.
const mockLocalPaymentRails = new Map<...>();
```
— `ui/src/dev-mock/handlers/payment.ts:24-30`

No `readSlice`/`writeSlice`, unlike the settings mock. A reload wipes it, so a reload assertion
tests the mock's stated design rather than the screen. **The DB half stays owed to the device**,
and the spec's docblock says so rather than leaving the gap implicit.

## One correction on the way

The first run failed on `click`: the rail `input` is styled out and the visible control is its
label — **the same pattern round 148 hit** on the settings toggles, and the same fix
(`aria-checked` for state, the label for the click). Two screens, one convention, recorded twice.

## Verified

| Item | Result |
|---|---|
| New spec | **2 passed** (desktop 3.3s, tablet 5.8s) |
| Kill-test (`disabled={true}`) | **fails** |
| `RestaurantPaymentsScreen.tsx` | identical to HEAD after the restore |
| `eslint` | 0 |
| Full UI suite | 12,670 passed, 0 failed |