# The dev mock's rail store lost every save — and the justification for that was stale (round 156)

## The defect

Round 155 could not assert that a restaurant rail toggle survived a **reload**, and recorded the
reason as the mock's design. Reading the code showed the design description was stale:

```ts
// whether the site offers them. Session-local maps — the mock has no
// multi-row table, so the rails live in a Map keyed by scope.
const mockLocalPaymentRails = new Map<...>();
```

**The core had shipped the table that sentence denies.**
`crates/kasirmu-core/migrations/20260924_local_payment_methods.sql` is a multi-row scoped
table, whose own header records *"No seed rows: an entity/location with no rows means 'no market
data recorded'"* — an honest empty state, not an absent store.

So the browser preview behaved in a way production does not: **a save succeeded, the toggle
flipped, and a reload returned the seeded defaults.** Any operator configuring the Payments
screen in the preview could not have believed a change they made.

## The fix

`handlers/payment.ts` now persists the rail map through the same two helpers `topology.ts` and
`staff.ts` already use — `readSlice` on load, `writeSlice` on every mutation — with a new
`oz-dev-mock:local-payment-methods` key in `mockDatabase.ts`'s registry. Measured before and
after:

| Run | `cash` after reload | Slice |
|---|---|---|
| before | `true` (reverted) | `null` |
| after | `false` (kept) | the full rail list |

## Covered by a spec, and kill-tested

`ui/e2e/mock-payment-rails-persist.spec.ts` toggles a rail, saves, reloads, and reads the same
rail back — **2 passed** on both projects. Removing the write on the `set_` handler's path
reverts `cash` and yields `null`, so the assertion binds to the fix specifically.

## What the diagnosis cost, and got wrong first

Three wrong turns, each of which produced a passing scratch probe and a failing spec:

1. **A stale `error-context.md`.** The trace named the flip line; the real failure was the
   post-reload assertion. Deleting `ui/test-results` before each run is what surfaced it.
2. **An unscoped `[role="switch"]`.** The page also renders switches for *Automatic Cash Drawer*
   and *Cash Suggestion Presets*, so `.first()` could resolve to one of those. Scoped to
   `[data-testid^="payment-card-toggle-"]`.
3. **A `locationId` race — this one is a finding, not a test bug.** `handleSave` guards on
   `!locationId` and **returns silently** (`RestaurantPaymentsScreen.tsx:740`); the location is
   fetched by an async effect, so a save issued before it resolves does nothing while the UI
   still looks saved. The spec now polls for the slice, which makes that race observable
   instead of letting it pass quietly — the same shape as F40's silent save.

## A guard that caught the change in the right way

`storageKeyPins.test.ts` failed on the new key and said exactly what to do: *"Add each to
EXPECTED_KEYS with its literal so a rename has to be a deliberate edit."* Done, 5 pass. A new
persisted key cannot now land silently.

## Verified

| Item | Result |
|---|---|
| before the fix | reload reverts `cash`; slice `null` |
| after the fix | reload keeps it; slice has the rails |
| kill-test (drop the write) | back to `true` and `null` — the assertion binds |
| New spec | **2 passed** (desktop 6.5s, tablet 10.8s) |
| `storageKeyPins` | 5 passed after pinning the key |
| Full UI suite | 12,671 passed, 0 failed |
| `tsc` / `eslint` | 0 / 0 |