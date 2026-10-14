# The Kitchen Display row never hid: a predicate that cannot read the gate (round 128)

## The defect

`PosScreen.tsx:1738` computed the restaurant sidebar's KDS row with:

```ts
showKitchenDisplay: isPageAccessible(getPage('kds'), session?.role_name ?? '', session?.permissions),
```

The comment above it (F7/D4) states the intent plainly — *"hide the row when KDS is
unreachable rather than let it no-op or bounce to Products"* — and defends the predicate
choice: the same one the shell's `handleNavigate` uses, so the two cannot disagree.

**The predicate cannot express that for this route.** `getPage('kds')` is
`{ route: 'kds', feature: 'kitchen-display' }` — **no `requiredRole`, no
`requiredPermission`** — and `isPageAccessible` -> `passesGate`
(`page-registry/index.ts:119-182`) reads only those two, falling through to `return true` at
`:181`. Measured with the real registration:

```
isPageAccessible(kds, 'Owner',    ['*'])   -> true
isPageAccessible(kds, 'Cashier',  [])      -> true
isPageAccessible(kds, '',         undefined)-> true
isPageAccessible(kds, 'NotARole', ['nope']) -> true
```

So `showKitchenDisplay` was a **constant `true`**. The row rendered for every role and the
click no-opped — the exact failure F7/D4 set out to remove, still present, with a comment
explaining why it would not be.

## The fix

`isEnabled` and `FEATURES.KITCHEN_DISPLAY` were already available in the file
(`:19`, `:153`), and `FEATURES.KITCHEN_DISPLAY === 'kitchen-display'` is the very string the
page carries:

```ts
showKitchenDisplay:
  isEnabled(FEATURES.KITCHEN_DISPLAY) &&
  isPageAccessible(getPage('kds'), session?.role_name ?? '', session?.permissions),
```

AND-ed rather than replaced: the role and permission axes still apply the moment this route
gains one, and the sibling row two lines up (`showTables: isEnabled(FEATURES.TABLE_MANAGEMENT)`,
`:1730`) has always been written this way.

## Why nothing caught it

`RestaurantSidebar.logic.test.tsx:330` asserts the row is hidden — but passes
`makeActions({ showKitchenDisplay: false })`. It tests the COMPONENT GIVEN the flag, never the
expression that produces it. The component is correct; the wiring was not.

`kdsRowFeatureGate.test.ts` closes that: one case proves the predicate is inert (the
non-vacuity precondition — it fails if `kds` ever gains a role or permission gate, which is
the signal to re-check the source assertion), and one pins the wiring. Kill-tested; substituting
`true` for the flag fails it.

## The fix broke an existing test, in the informative direction

`RestaurantPosSidebar.test.tsx:362` clicked `restaurant-sidebar-kds` and asserted it navigated.
With the flag off in that harness the row is now absent, so the case failed.

That file already documents the pattern twelve lines earlier (`:350-352`): *"Table Management
is feature-gated and this harness enables no features, so the row is absent rather than
rendered-and-disabled."* KDS was the row that had not been brought into line. The case now
asserts KDS absent alongside Tables and drives the popover-close through the History row.

## A process mistake worth recording

While restoring after a kill-test I ran `git checkout -- ui/src/features/sales/PosScreen.tsx`,
which **discarded the uncommitted fix** along with the mutation. The correct restore from a
single-line marker is the inverse edit, not `checkout`. Re-applied, re-verified, and the
kill-test re-run against the re-applied version before anything was committed.

## Verified

| Gate | Result |
|---|---|
| Predicate inertness | measured true for 4 roles, incl. empty and garbage |
| New guard | needs the flag; fails when the flag is replaced with `true` |
| `RestaurantPosSidebar` | 21 passed after the setup update |
| Full suite | 12,663 passed, 0 failed |
| `tsc` / `eslint` | 0 / 0 |