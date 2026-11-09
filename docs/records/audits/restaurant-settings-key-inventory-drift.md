# The key-ownership inventory named a key nothing writes, and omitted four it does

**Round 31 · 2026-10-11 · restaurant POS · settings ownership**

## A false-positive class, recorded

Round 30's defect was a container-level handler firing for events its author did not
picture, so this round looked for the same shape elsewhere. Two enumerations came back
empty, and both are worth recording so the next reader does not re-run them:

- **Overlay `onKeyDown` with a key branch.** 25 sites. Most are Escape-only, which on a
  container is correct; the Enter ones sit on the `<input>` itself
  (`RetailModals.tsx:501`, `:805`, `RestaurantMenuEditorScreen.tsx:1783`), which is also
  correct. Only `ShiftModals` had the overlay-level binding, and round 30 fixed it.
- **`role="dialog"` with an `onClick` closer.** My first heuristic (a 400-char window)
  reported 16 sites, and **every one I opened already had the guard** — `RetailModals:238`
  guards inline, the two KDS modals delegate to a `handleBackdropClick` that checks
  `e.target === e.currentTarget`. The heuristic was spilling past the tag boundary and
  matching a *sibling* button's handler. A pattern-detector that reports 16 hits and 16
  false positives is not evidence of a class.

## The finding

`RestaurantSettingsScreen.tsx` opens with an explicit key-ownership inventory, and says why:

> This screen is one of THREE surfaces that write restaurant settings ... so which key each
> control owns is stated here rather than inferred

That list had drifted in **both** directions. Comparing it against the actual
`setSettingsScoped` map:

```
listed but NOT written (phantom):   hold_order
written but NOT listed (missing):   dispatch_on_tab_save, print_bill_action,
                                   split_bill_by_item, table_transfer
```

`restaurant.hold_order` was removed with its toggle in **round 42** — confirmed by its own
guard's record (`deadSettingsKey.test.ts:108`) and by the write map, which has 13 keys and
not that one. The inventory is the file's stated source of truth for ownership, so naming a
phantom key is worse than having no list: it is the header-lag mechanism the plan doc has
had to correct five times, in the file that documents the rule.

## The fix, and a guard for the class

The inventory now matches the write map, and a new
`restaurantSettingsScreenInventory.test.ts` reads **both sides out of the source** and fails
on either direction of drift. Both sides are parsed, so the next key added or removed breaks
the test instead of silently desynchronising the comment.

A count assertion runs first (`listedKeys().length > 5`, `writtenKeys().length > 5`): a case
over an empty population reads exactly like a clean tree, which is how a guard lands as a
comment with no data.

## Verification

| Check | Result |
|---|---|
| phantom key re-added (kill-test A) | -> **red**, `expected [ 'hold_order' ] to deeply equal []` |
| documented key removed (kill-test B) | -> **red**, `expected [ 'split_bill_by_item' ] ...` |
| `restaurantSettingsScreenInventory.test.ts` | **3 passed** |
| restaurant settings/plan sweep (9 files) | **87 passed** |
| ESLint / typecheck | **0 errors** / clean |

Both kill-tests were needed: the guard has two directions and a one-sided test would pass
while the other direction rotted.

## Method notes

- **A property-detector needs its hit list read, not counted.** 16 candidate dialogs, 16
  already-guarded; 25 keydown sites, none wrong. Reporting either as a finding would have
  been a plausible mechanism with no measurement behind it — the exact mistake this series
  keeps correcting.
- **Documentation that states ownership is code-adjacent and needs the same guard as code.**
  This inventory made a falsifiable claim (`hold_order` is owned here) that nothing checked,
  which is why it survived being wrong for a two-digit number of rounds.
- Comparing two lists extracted from the SAME file is a single-source check, so it cannot
  validate the file against reality — only against itself. That is enough here (the claim is
  "this comment describes this save map"), but it is worth naming: it would not catch both
  being wrong together, which is what `deadSettingsKey.test.ts` covers from the reader side.

> last audited 16-10-26 by docs-auditor
