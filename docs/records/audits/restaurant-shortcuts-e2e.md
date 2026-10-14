# The shortcuts are proven in a browser, and the guard is one of the three cases (round 160)

## What was left open

Round 158 parity-tested the manifest's COHERENCE — no duplicate keys, no retail collision, no
unimplemented action. Round 159 bound it in `PosScreen`. Neither proves a keypress reaches a
handler while the app runs; the parity test renders no component at all.

## The spec

`ui/e2e/restaurant-shortcuts-e2e.spec.ts`, three cases, **6 passed** (3 × desktop/tablet):

| Case | Asserts |
|---|---|
| `Shift+L` opens Table Management | `tables-back-btn` mounts — a surface that only exists inside that sub-surface |
| `Shift+B` opens the split-bill modal | `pos-split-bill-modal` mounts, and Escape closes it |
| a `Shift+` letter in a field is not a shortcut | typing `KL` in the table field lands in the field, and Table Management does NOT open |

Two of the five actions are deliberately not covered, and the spec says why: `Shift+K`
(kitchen dispatch) and `Shift+P` (print) are one-way IPC writes whose only observable is a
toast, and a missing handler would also produce no toast. The two routes that change what is
VISIBLE are the two worth an E2E case.

The editable-guard case is the load-bearing one. It is the part of the design a refactor
breaks silently — if `useRestaurantShortcuts` lost its `isEditableTarget` check, the two forward
cases would still pass and every capital letter a waiter typed would become a dispatch.

## Kill-tested

Disabling the binding entirely (`if (true) return {}`) fails **4 of the 6** — both
`Shift+L` and both `Shift+B` cases. The two editable-guard cases still pass, correctly: no
keys bound means nothing intercepts a typed letter either. So the two halves of the guard are
separately visible, which is the reason the guard got its own case rather than being assumed.

## The two-shell trap, a fourth time

The first run failed both tablet cases: `.pos-cart-table-input` and the split control are not
in the DOM on portrait, because the cart lives in a bottom sheet behind
`.restaurant-floating-cart-trigger`. The fix was the `openCart()` helper the payment-modal and
cart-capability specs already carry — the same round-143 pattern, now mirrored a fourth time.

At this point the lesson is the standing one: **any restaurant spec that reaches the cart must
open the sheet on portrait.** It has now bitten four specs, and each new one re-imports the
helper rather than rediscovering the trap.

## Verified

| Item | Result |
|---|---|
| New spec | **6 passed** (desktop 3.3s/1.8s/1.8s, tablet 5.8s/4.6s/5.4s) |
| Kill-test (binding disabled) | **4 failed**, 2 passed as designed |
| `PosScreen.tsx` | byte-identical to HEAD after the restore |
| Full UI suite | 12,678 passed |