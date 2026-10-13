# Staleness-guard census, restaurant POS (round 85, 2026-10-13)

## Why this exists

Round 82 killed every staleness guard in `PosScreen` AT ONCE and the suite failed on one
case. That looked like three confirmations; it was one. `courseFiringSeq` and
`orderTypePromptSeq` were both still unpinned, and only showed up when each was killed
on its own (rounds 83 and 84).

So this is the census: every guard BELT in the two POS screens, each killed
INDIVIDUALLY, with the case that catches it. A blanket kill-test cannot say which guard
is load-bearing, and the failure it does report masks the ones it does not.

A "belt" is one effect's `seq` ref plus every `if (stale()) return;` derived from it —
the success path, the catch path and any `finally`. They share one ref and belong to one
effect, so they are killed together; killing them apart would prove nothing extra.

## The census

| Screen | Belt (ref) | Reads | Pinned by |
|---|---|---|---|
| `PosScreen` | `receiptSettingsSeq` | `getReceiptSettingsScoped` | `PosScreenCoreFlow.test.tsx` :: *ignores a slower receipt-settings read from the previous store* |
| `PosScreen` | `courseFiringSeq` | `restaurant.course_firing` | `PosScreenCoreFlow.test.tsx` :: *ignores a slower course-firing read from the previous store* (added round 83) |
| `PosScreen` | `orderTypePromptSeq` | `restaurant.order_type_prompt` | `PosScreenCoreFlow.test.tsx` :: *ignores a slower order-type-prompt read from the previous store* (added round 84) |
| `RetailPosScreen` | `storeSettingsSeq` | `getStoreSettingsScoped` | `RetailPosScreen.test.tsx` :: *ignores a slower earlier store-settings read after a token change* |
| `RetailPosScreen` | `shiftSeq` | `getActiveShiftScoped` | `RetailPosScreen.test.tsx` :: *ignores a slower earlier shift read after a token change* |

**All five are pinned.** Each was verified by removing that belt alone and watching exactly
one case fail — belt 1 in round 85, belts 2-3 in rounds 83-84, and both `RetailPosScreen`
belts in round 85.

## The observables, and why they are not interchangeable

Three of the five assert on a CONTAINER element rather than on text:

| Belt | Observable |
|---|---|
| receipt settings | `#pos-table-number` absent |
| course firing | `div.pos-cart-course-bar` present/absent |
| order type | `div.pos-cart-order-type-row` present/absent |

**Text is not a safe observable here.** Round 82's first course-firing attempt asserted on
"Fire All", which `CourseSelectorBar` renders only when a line carries
`coursingStatus === 'hold'` (:41). A barcode-scanned line has no course, so the text was
absent whether or not the guard held — an assertion that COULD NOT FAIL, and it passed
with the mutation applied. Containers that mount on the guard's own condition do not have
that failure mode.

## What this does NOT cover

Only the two POS SCREENS. The same `seq`-ref shape appears in 57 files under `ui/src`
(`Contexts`, `KdsScreen`, `ShiftBar`, `TableManagementScreen`, the connection hooks…). Each
needs its own kill-test; this census says nothing about them.

The guards are pinned against a TOKEN CHANGE (a store switch). Round 81 showed that a HOT
token swap is a different path with different ref-sharing behaviour, and that at least one
guard (`ExchangeRateScreen`) needed the hot-swap path specifically. Neither POS belt above
was checked against a hot swap.

## Re-verify with

  cd ui && npx vitest run PosScreenCoreFlow.test.tsx RetailPosScreen.test.tsx

  # then, for each belt: remove that belt's `if (stale()) return;` lines only, re-run,
  # confirm exactly the one case above fails, and restore.