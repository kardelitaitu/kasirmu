# Three POS dialogs declared aria-modal and trapped nothing

**Round 29 · 2026-10-11 · restaurant + sales POS · focus management**

## Where this started

The objective is restaurant POS usability and reliability. The tree already tracks that
work in `todo-restaurant-pos-reliability.md`, and this round verified its headline claims
before adding to it:

- the header's "NO open code defects" claim is consistent — every finding marked OPEN in
  the body (F40 at :1974, D6 at :5134) has a later closure recorded (`267e23e9e` round 90,
  `ac8d82fd0` round 94);
- `deadSettingsKey.test.ts`'s `DECLARED_DEAD` list is genuinely EMPTY — all three keys
  gained real readers across rounds 50/57/58;
- the two enforcement guards pass, and `planStatusAccuracy` is honest about its scope
  ("does not attempt to re-derive progress in general"), so it is not the circular shape
  rounds 24–28 kept finding.

With no existing open defect, the useful move was a **class check** on a surface the plan
does not cover: focus management in the POS modal dialogs.

## The class, enumerated

Every `aria-modal="true"` element under `ui/src/features`, matched against whether its
file uses `useFocusTrap`:

```
aria-modal WITHOUT useFocusTrap:
  restaurant/components/RestaurantCartSheet.tsx      <- restaurant POS cart surface
  sales/components/OpenBillModals.tsx                <- 2 dialogs
  sales/components/ShiftModals.tsx                   <- 3 dialogs
  locations/TopologyApplyConfirm.tsx, topologyMigrationDialog.tsx,
  TopologyRevisionBrowser.tsx, inventory/ThresholdConfigScreen.tsx,
  settings/components/RestoreSection.tsx
```

All eight have **no** focus mechanism of any kind — checked for `useFocusTrap`,
`FocusTrap`, `<Modal`, `autoFocus` and `inert`. The sales siblings that do install it are
`ItemModifierModal:253`, `SplitBillModal:37`, `PromotionsModal:66`, `RefundModal:176`,
`PriceOverrideModal:176`, `StockShortfallDialog:115` — so this is a genuine gap, not a
different convention.

This round fixed the two that the POS cashier actually touches: `OpenBillModals` (the
open-bill name input and the held-bills list) and `RestaurantCartSheet` (the restaurant
tablet's whole cart surface). The other six are recorded below, not silently left.

## The defects, measured

Four failing cases on `OpenBillInput`, all red for the right reason:

```
activeElement was <body>            — no autofocus into the dialog
Tab reached an outside <button>     — no trap; the page behind is still focusable
Escape did nothing                  — requestClose never called
OpenBillsPanel: focus stayed outside
```

Two more on `RestaurantCartSheet`, which already handled Escape by hand:

```
focus must land inside the sheet on open  -> expected false to be true
Tab escaped the sheet and reached the menu it is covering
```

For a keyboarded tablet the cart sheet is the primary interaction surface, so tabs
walking into the menu underneath it is a practical failure, not a theoretical one.

## The fixes

All three dialogs now install the shared `useFocusTrap`, matching their siblings, which
supplies autofocus, Tab cycling, Escape and the body-scroll lock in one place. In
`RestaurantCartSheet` this **replaced** the hand-rolled `window` Escape listener rather
than sitting beside it — two Escape handlers would double-fire `requestClose`.

The trap is gated on `open && !exiting`, not `shouldRender`: during the exit fade the panel
is still mounted but must no longer own the keyboard.

## A test that asserted the old implementation

Wiring the trap broke the pre-existing `closes on Escape key press` case. That was worth
diagnosing rather than "fixing" by moving the listener back:

```
userEvent.keyboard('{Escape}')  -> 1 call   (behaviour intact)
fireEvent.keyDown(window, ...)  -> 0 calls  (dispatch target wrong)
```

The old listener was on `window`; `useFocusTrap` listens on `document`, like every other
dialog. A window-targeted synthetic event never reaches a document listener, so the test
was pinning the OLD implementation's listener target rather than the behaviour. Rewritten
to a real key press, with the measurement recorded in its comment.

## Verification

| Check | Result |
|---|---|
| trap disabled in OpenBillModals | all **4** cases -> **red** |
| trap disabled in RestaurantCartSheet | all **3** cases -> **red** |
| `openBillModalFocus.test.tsx` | **4 passed** |
| `RestaurantCartSheet.test.tsx` | **8 passed** |
| POS/a11y sweep (9 files) | **108 passed** |
| ESLint / typecheck | **0 errors** / clean |

## Still open, recorded rather than silently skipped

Six more `aria-modal` dialogs with no trap, none on the POS cashier path:
`ShiftModals.tsx` (3), `TopologyApplyConfirm.tsx`, `topologyMigrationDialog.tsx`,
`TopologyRevisionBrowser.tsx`, `ThresholdConfigScreen.tsx`, `RestoreSection.tsx`.
`ShiftModals` is the nearest to the till and the most likely next candidate.

## Method notes

- **Enumerate by property, not by file.** "Every `aria-modal` without `useFocusTrap`" found
  the class in one command; reading the two POS surfaces I already had open would have
  found at most those two.
- A guard can be green because it asserts **how** the code works, not **what** it does.
  The Escape case passed for the old listener target; only re-running it against the new
  implementation revealed that it was pinned to an implementation detail.
- Verifying a plan's claims is not busywork: three separate headline assertions were
  checked against the tree and all three held, which is what made it safe to look for
  work the plan does not already cover.

> last audited 16-10-26 by docs-auditor
