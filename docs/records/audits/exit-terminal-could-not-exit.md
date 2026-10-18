# Exit Terminal could not exit, and a round-294 test was asserting that as correct (round 297)

## How this was found

Round 294 added the close-shift guard for an outstanding tab. This round asked the obvious
follow-up: **what else calls that guard?**

`PosScreen.handleRequestExit` did:

```tsx
if (activeShift !== null) {
  handleCloseShiftClick();     // <- diverts Exit into Close Shift
} else {
  setShowExitConfirm(true);
}
```

So once the guard learned about tabs, **Exit Terminal inherited every refusal**. And because
`setShowExitConfirm` is only reachable when `activeShift === null`, there was no second route:
with a shift open, the till could not be left at all until the blocking condition was cleared.

## Measured in a browser, not reasoned about

A throwaway probe drove the real screen — park a tab, resume it, clear the cart, press Exit —
and printed what the operator actually got:

```
PROBE RESULT homescreen=false closeshift=false opentab=true
```

No exit. No close-shift dialog. An error about a tab. The operator pressed **"Exit Workspace"**,
was told about a tab, and stayed exactly where they were. (The probe file was deleted after
reading; it is a measurement, not a keeper.)

## The two actions were never the same thing

| Control | Its own copy | What it is |
|---|---|---|
| Exit Terminal | "Exit Workspace / are you sure you want to exit to the homescreen?" | **navigation** |
| Close Shift | shift reconciliation, counted drawer | **cash control** |

The diversion conflated them. Every other screen treats the workspace picker as plain
navigation — `SettingsTopbar.tsx:142`, `StaffManagementScreen.tsx:107`, `AnalyticsScreen.tsx:460`
all just call `goToWorkspacePicker()`. The restaurant sidebar was the only place that read a
navigation action as a cash event.

Note also that **the same trap already existed for a non-empty cart** — `lines.length > 0`
predates this session entirely (`git show 7255231e5^` confirms it). So the defect was
pre-existing; round 294 widened the set of conditions that spring it.

## The fix: separate them, and carry the warning instead of the block

`handleRequestExit` is now pure navigation. The safety the diversion was *trying* to provide is
delivered as **information**: while a shift is open the dialog says so and names the risk.

```tsx
message={
  activeShift !== null
    ? l10n.getString('restaurant-exit-confirm-open-shift-desc')
    : l10n.getString('restaurant-exit-confirm-desc')
}
```

New string, both bundles:

> A shift is still open. Exiting leaves it unreconciled — close it from the sidebar first if you
> need to count the drawer.

**Refusing to navigate is not a cash control; it is a lock-out.** The operator still gets told
what they are walking away from, and then decides — which is what a confirmation is for.
Close Shift keeps its guard untouched, because that IS the reconciliation surface.

## ⚠️ A test was asserting the defect as correct

`RestaurantPosSidebar.test.tsx` had a case named *"Exit Terminal prompts to close shift when an
active shift exists"*, and it asserted the dead end precisely:

```ts
expect(screen.queryByText('Exit Workspace')).toBeNull();
expect(screen.getByRole('dialog', { name: 'Close shift' })).toBeInTheDocument();
```

"The exit dialog must NOT appear" — the defect, written down as a requirement. It went red the
moment the fix landed, which is the honest signal that the test encoded the bug rather than
guarding against it.

It is **replaced, not deleted**, with the assertions inverted and the reason recorded at the call
site — including the probe output that settles which behaviour is correct. The Close Shift row
keeps independent coverage in `usePosShifts.openTabGuard.test.tsx` and
`restaurant-shift-close-open-tab.spec.ts`, so nothing lost its guard by this swap.

## Kill-tested

Restoring the divert:

```
2 failed   Exit Terminal offers the exit even while an open tab blocks the shift close
2 failed   Exit Terminal still warns, and still exits, with no tab outstanding
```

Both e2e cases fail — the dialog never appears, so the second one cannot confirm out either.
Restored, all green.

## Verified

| Item | Result |
|---|---|
| New e2e spec (both projects) | **6 passed, 2 skipped** (both files together) |
| Kill-test (divert restored) | **2 failed**, then restored |
| Replaced unit case | passes; the old assertion is inverted with its reason recorded |
| POS / shift / restaurant unit suites | **697 passed, 48 files, 0 failed** |
| Restaurant e2e fleet, desktop | **144 passed, 0 failed** (64 spec files) |
| `npm run typecheck` | exit 0 |
| eslint on both new/changed test files | 0 |
| `lint-i18n.sh` | no issues |
| pre-commit FTL checks | 1 key added (1 en / 1 id), 0 stranded, 0 one-sided |
| Commits | `5bbb91312` (fix) + `93f9ccabb` (unit) + `f149726bc` (e2e) |

## The transferable part

**A guard added to a shared handler propagates to every caller.** Round 294 hardened
`handleCloseShiftClick` and checked only its own two call sites for the collision — it did not ask
what else routed through it. The next round found that `handleRequestExit` treats a navigation
control as a cash event, and the two together produced a lock-out.

The general shape: when a refusal is added, list the callers and ask of each whether refusing is
the right answer THERE. A guard belongs to the invariant it protects, not to the function it was
convenient to put it in.

And the second lesson, from the test: **a test that fails when you fix a bug is evidence about
the test.** The instinct is to make it pass again; the correct move is to read what it asserts
and decide which of the two — the test or the code — is describing the intended behaviour. Here
the test was describing the bug, in an assertion that named its own inversion.

> last audited 15-10-26 by docs-auditor
