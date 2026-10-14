# The custom payment rail form, on the screen with the lowest coverage (round 190)

## Why this, out of 30 uncovered testids

Round 189's re-derivation put `RestaurantPaymentsScreen` at **2 of 32** and named it the
clearest signal. But 27 of those testids are gateway credential inputs (Midtrans, Stripe,
QRIS), which are the least operator-facing and the most sensitive.

The one control that is neither a credential nor a toggle is **Add Custom Payment Method** — the
only way an operator puts a bespoke method on the till: a local wallet, a QRIS variant, a house
account. That is what this round covers.

## Why the flow is worth pinning

`handleAddCustomRail` (`:684-712`) does five things, each a place a one-line refactor could
silently lose an operator's intent:

| Behaviour |
|---|
| the code is SANITISED, so a typed abbreviation becomes the stored wire code |
| a code that sanitises to nothing is refused with a warning |
| a duplicate code is refused with its own message |
| an empty display name falls back to the sanitised code uppercased |
| both fields clear on success, so the form is ready for the next one |

## The spec — 4 passed

| Case | Asserts |
|---|---|
| add a rail | Add disabled without a code; a code alone suffices; both fields clear; the new rail appears with its own toggle |
| duplicate refused | `cash` re-added is refused with feedback AND the field is not cleared, so the operator corrects rather than retypes |

**Kill-tested**: disabling the duplicate check fails the second case. Restored, byte-identical to
HEAD.

## Coverage after this round

| Screen | Before | After |
|---|---|---|
| payments | 2 / 32 | **7 / 32** |

Still the lowest of the restaurant screens, and the remainder is dominated by credential forms.
Recorded rather than glossed: those are a deliberate deferral, not a gap this round missed.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed |
| Kill-test | 1 failed |
| Payments screen source | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,703 passed |

> last audited 14-10-26 by docs-auditor
