# The plan's last claim verified at HEAD, and its one open item (round 113)

## What was checked

`todo-restaurant-pos-reliability.md` is 5,870 lines and its final section claims a complete
end-to-end feature. Round 79 and round 96 both found such claims stale, so the last one was
re-measured rather than read.

### The claim (line 5839 onward)

> *F23 / F24 — Credit facility & ceiling enforcement wired end-to-end*

| Claimed | Verified at HEAD |
|---|---|
| `has_credit_split` in `sales_checkout.rs` | `:245` |
| `Settings::is_credit_enabled(&tx)` consulted | `:254` |
| `Settings::get_credit_max_limit(&tx)` consulted | `:261` |
| populated by `sales_checkout_tests.rs` | `:365` |
| `creditOffered` / `coreRailWithheld` gate the rail | present in `PaymentModal.tsx` |
| `getCreditSettingsScoped` fetched | present |
| `payment-credit-disabled` / `-limit-exceeded` keys | present |

**The claim holds.** It also closes a loop worth noting: the backend line at `:263`
(`if !payment_splits.is_empty()`) is the one round 74 inverted for clippy's `if_not_else`.
That edit was verified by `kasirmu-core`'s suite at the time; this is the first time its
**feature** context has been read, and the inversion was behaviour-preserving as claimed.

The ceiling is also settable end-to-end: `CreditFacilityCard.tsx` writes through
`setCreditSettingsScoped` -> `kasirmu-bridge/src/settings.rs:632` ->
`Settings::set_credit_max_limit`. Read and write agree.

## The plan's one genuinely open item

`F40 device verification — BLOCKED` (line 5698), and the section is explicit that the blocker
is a **missing fixture**, not an untried instrument:

* the device was previously driven successfully for F40's reproduction;
* it now carries **one** workspace card, "Retail POS";
* the restaurant Payments screen therefore cannot be reached at all;
* `local_payment_methods` is still 0 rows.

**Checked this round: no device is attached** (`adb devices` lists none). So the blocker
stands and cannot be worked around from here — reaching that screen needs a restaurant
workspace seeded on the tablet, which needs the tablet.

The distinction the plan draws is the right one and worth keeping: *"A verification that
cannot run is not the same as a verification that has not run."* F40 is fixed in code with
kill-test evidence; the device confirmation is blocked on a fixture, and that is a different
statement from "unverified".

## Negative results (recorded so they are not re-derived)

**The restaurant feature tree is fully reachable.** All 19 production files under
`features/restaurant/` have at least one production reference; all four `*Screen.tsx` among
them are named 3-8 times. Nothing here resembles round 112's unreachable `LocalApiSection`.

**The whole-repo screen for unreachable modules is not worth repeating.** Round 112 ran it
and got **69 candidates, of which 67 were false** — screens register lazily via
`registerPage`, exactly as `AGENTS.md` warns. The check that works is reading the specific
registration lists a file would have to appear in.