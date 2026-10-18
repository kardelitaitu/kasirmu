# Three wrong mechanisms, then the real one: Escape on the table detail panel — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 189 · status: a real usability defect found
     and FIXED after three failed diagnoses; two spec comments that documented it wrongly were
     corrected · branch: 0.0.41 -->

<!-- Scope: the round-188 carry-forward — the table detail panel and Escape. -->

## The defect

With the table detail panel open on the floor plan, Escape closed the panel **and the entire
table view behind it**, dropping the operator onto the POS grid. Measured:

```
before:  panel 1, .tables-table 12, aria-modal 1
after:   panel 0, .tables-table  0, POS grid 1        <- 12 tiles to zero
```

An operator who taps a table, then thinks better of it, loses the floor plan and has to
navigate back. Real, reproducible, and user-visible.

## Three wrong diagnoses, each measured out

**1. "The panel has no Escape support at all."** Wrong: it is `role="dialog" aria-modal="true"`
(`TableManagementScreen.tsx:1972`) with `useFocusTrap`, which handles Escape by design.

**2. "The trap does not claim the key."** Plausible, and it matches the round-187 fix exactly, so I
implemented it — an opt-in `claimEscape` flag on the shared hook calling `consumeShortcut`.
Measured: **still 12 -> 0.** Instrumenting the trap showed why: `TRAP_ATTACHED` fired, so the
listener was registered — but on Escape its handler never ran at all.

**3. "PosScreen must defer via `defaultPrevented`."** Also wrong, and the reason is the
interesting one: **both listeners sit on `document` in the bubble phase, and PosScreen
registers FIRST**, so it runs before the trap can prevent anything. `defaultPrevented` was
still false when PosScreen checked it. And `stopPropagation()` could not have helped from
the trap side either — propagation control does not reach a **sibling listener on the same
node**, only listeners on other nodes.

That is why round 187 capture worked and this did not: there the editor is a CHILD NODE, so
propagation genuinely stopped. Here the two are peers on one node.

## The actual cause, and the fix

`PosScreen` Escape cascade carried this comment about the modal guard:

> `isAnyAriaModalOpen()` is NOT consulted … **a sub-screen is not a modal, so nothing else
> owns Escape while it is open.**

True of the sub-screen, and **false of a modal opened INSIDE it.** The detail panel is exactly
that: a modal belonging to a sub-screen. So the cascade acted on a key the panel had already
handled, and closed the screen the panel lived in.

The fix is the guard the comment had argued against, scoped narrowly:

```ts
if (isAnyAriaModalOpen()) return;   // a modal inside a sub-screen owns the key
```

A modal is only ever a sub-screen CHILD, never the sub-screen itself, so the sub-screen branches
below still own Escape when no modal is up — the property the original comment was protecting.

## Result

| check | before | after |
|---|---|---|
| Escape with the panel open | panel 0, **tiles 0** | panel 0, **tiles 12** |
| kill-test: remove the guard | — | **tiles 0 again** (load-bearing) |
| tables E2E sweep (8 specs) | — | **21 passed** |
| toolbar spec incl. the new case | — | **4 passed** |

A permanent regression test now pins it: *"Escape closes the detail panel WITHOUT taking the
floor plan with it"* — it asserts both halves, the panel leaving AND the tile count surviving.

## Two comments that documented the defect wrongly, corrected

Both `restaurant-tables-toolbar.spec.ts` and `restaurant-tables-print-bill.spec.ts` worked around
this by clicking Close, and both explained why. **Both explanations were false:**

> "Escape on this screen is owned by the SHELL, not by the detail panel."
> "The panel is NOT an ARIA modal (`isAnyAriaModalOpen()` is false for it), so it could never
> claim Escape."

The panel IS `role="dialog" aria-modal="true"`, and the shell handler at `AppShell.tsx:79`
already exempts `restaurant-pos` correctly. The workaround happened to be right and the
reasoning was wrong — which matters, because **a wrong reason in a spec comment is what stops
the next reader from fixing the defect.** Both now record the order bug and point at the test
that pins the fix. The Close clicks stay, because a Close button is the better affordance to
drive those particular cases with.

## Carried forward

1. `claimEscape` on `useFocusTrap` was added while chasing diagnosis 2 and is **NOT
   needed for this fix**. It is left in place because it is correct, opt-in, and defaulted off
   (preserving the stacked-trap contract the hook own test pins), but nothing currently sets
   it. If no caller ever needs it, it should be removed rather than kept as speculative API.
2. The rule worth keeping: **two listeners on the same node cannot be ordered by
   propagation.** Capture and stopPropagation only separate listeners on DIFFERENT nodes.
   When peers share a node, the only reliable arbitration is a shared predicate — here, "is a
   modal open" — not listener gymnastics.

## The wider sweep, and the 6 failures that are not mine

Ran 7 spec files (33 tests, 2.8m): **25 passed, 6 failed, 2 skipped**.

All 6 failures are in `adr22-workspace-settings.spec.ts` — the Locations / topology surface — and
they are **not from this change**, verified three ways rather than assumed:

1. My commit touches no `adr22`, `locations` or `workspaces` path (`git show --name-only`).
2. `ui/src/features/workspaces/tools.tsx` and `ui/src/features/locations/nodeTopologyEditorApplyPanel.ts` are
   **dirty in the working tree from another lane** — the exact area the spec drives.
3. The spec **fails in isolation**, on its own, reproducing the same
   `expect(locator).toBeVisible() failed / element(s) not found` — so it is not an interaction with
   my change or with the batch.

The 25 that passed include every spec this change touches: `restaurant-tables-toolbar` (4/4,
including the new case), `restaurant-tables-print-bill`, `restaurant-table-merge`,
`restaurant-table-move`, `restaurant-menu-editor` (2/2) and `narrow-shell`.

> last audited 18-10-26 by docs-auditor
