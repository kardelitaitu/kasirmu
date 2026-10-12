# The KDS had no crash isolation at all (2026-10-12)

## The finding

The restaurant POS wraps 33 scoped surfaces in `<LocalizedErrorBoundary>` and has
a guard keeping them wrapped. **The KDS had none — no wrapper and no guard.**

`grep LocalizedErrorBoundary ui/src/features/kds` returned **nothing**. Every fault
under the KDS reached the app-level boundary in `AppProviders.tsx:88`, whose
recovery is an automatic **FULL RELOAD** after `ERROR_AUTO_REFRESH_MS`.

## Why the asymmetry is wrong for this screen

The POS comment states the intent the KDS was missing: *"a scoped failure never
reloads the whole POS"*. That intent matters MORE on the KDS, not less:

- It is a **wall-mounted kitchen display** showing live tickets.
- A reload **blanks the board mid-service** and every cook loses the queue at once.
- The POS at least has a cashier who can re-open the cart; the KDS has no such
  recovery — the tickets are the working state.

## What was wrapped, and the order of priority

`KdsMainContent` first, because it is driven **entirely by live server data** —
`filteredOrders`, `slaThresholds`, per-order line items — which is where a
malformed payload throws. Then `KdsNoticeBanners` (connection state, dead-letter
queue) and `KdsZoneChips` (derived from the order set).

Each uses `resetKeys` on the value that would have caused the throw — the active
tab and order count for the board; the error text and dead-letter length for the
banners; the zone list for the chips — so a caught error clears when its input
changes rather than leaving a dead panel for the shift.

## How this was found, and why that generalises

Same method as round 51, and the reason both rounds exist: **compare what a screen
RENDERS against what is GUARDED.** Round 51 asked it of PosScreen against the POS
list; this round asked it of the whole KDS feature directory against the boundary
grep, and the answer was "zero".

The KDS guard added here (`kdsCrashIsolation.test.ts`) is modelled on the POS one,
including its kill-test property, and asserts the surface is still RENDERED as well
as wrapped — so a rename fails the guard instead of passing vacuously.

## Scope

3 guard cases; 862 KDS tests pass; lint exit 0; typecheck clean. Kill-tested on
COPIES only: removing the boundary drops `KdsMainContent` to nesting depth 0 and
fails the guard, with the live file verified byte-identical.

## A SECOND routed KDS screen had the same gap (efcd01a7a)

Round 52's pass started from `grep LocalizedErrorBoundary ui/src/features/kds` and
found nothing to look at, so it fixed `KdsScreen` and stopped. That grep could not
have found the second screen's problem, because the problem was the ABSENCE.

`ExpoScreen` — 594 lines, registered as route `kds-expo` with its own nav item
(features/kds/register.tsx:20-28) — also had no boundary. The shell wraps every
fullscreen page in `<LazyBoundary>`, and that is a **`<Suspense>`, not an error
boundary** (components/LazyBoundary.tsx:20-33), so a throw on the expo pass reached
AppProviders' app-level boundary and its full reload — blanking the pass mid-service
exactly as it would the kitchen board.

The method that found it is the round-51 one, applied properly this time: compare
what the ROUTES render against what is GUARDED, rather than grepping for the thing
whose absence is the bug. Walking the page registry found both KDS routes; the
boundary grep had only ever been able to find the one that already had some.

Guard: `StationSelectorModal` added to `kdsCrashIsolation.test.ts`. Kill-tested on
a copy — removing the wrapper drops it to nesting depth 0.

## Left as-is, deliberately

The KDS's remaining ~11 components (header, tabs, footer, the modals) are **not**
wrapped. They render local or props state rather than server data, so they are not
where a malformed payload throws, and wrapping everything is a larger change than
this finding warrants. The three worst are guarded; the guard file lists them, so
adding a fourth is a one-line change when a reason appears.
