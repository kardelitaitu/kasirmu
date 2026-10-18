# A switch onto an occupied store deleted the cart on screen — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 159 - status: 1 defect fixed in the
     PREVIOUS round's own fix, 1 external hypothesis refuted, 1 case added - branch:
     0.0.41 - commit: ac3c944ef -->

<!- - Scope: restaurant POS reliability and usability, per the active goal. Opened by
     auditing the fix round 158 landed rather than moving on from it. -->

## Round 158 closed a leak and left a worse one behind it

Round 158 made a store-scope change carry the POS cart across and delete the key being left.
The adoption was guarded so that a NEWER draft is never overwritten by an older one:
`if (localStorage.getItem(destination) === null)`. That rule is exactly right for the case it
was written for, which is the BOOT-time scope change — the scope moved after the cart was
written, so the incoming value is the same cart under its now-correct name.

It is wrong for a different case that reaches the same line. On a deliberate `switchStore` the
destination scope may already hold a draft the operator left there in an earlier session. Then
the guard skips the write and execution falls through to an UNCONDITIONAL `removeItem(staleKey)`
— deleting the cart the operator was working on.

This is the part that makes it a real defect rather than a tidy-up, and it had to be measured:
`switchStore` sets `activeWorkspace` to null (`WorkspaceContext.tsx:363`) and the POS renders
only under its own workspace (`AppShell.tsx:722/:755`). The switch UNMOUNTS the POS, so the
in-memory cart is gone and the key just deleted held its ONLY copy. The operator switches store
mid-order and their ticket is unrecoverable.

Losing the cart the operator is LOOKING AT is worse than losing the abandoned one behind it:
the visible cart is work in progress, the destination draft is something already walked away
from. Round 158's guard ranked them the other way round because it was written against the
boot case alone.

## The fix keeps both values

The branch now distinguishes the two situations instead of collapsing them. Empty destination:
adopt outright, unchanged. Occupied destination: PARK the outgoing draft under a dedicated key
(`<base>-parked:<store>`) and leave the destination untouched, so neither cart is destroyed.

Parking rather than auto-restoring is deliberate. Silently resurrecting a stale cart into a
live till would be its own hazard — the round-158 reasoning about a draft following an operator
between stores applies here in reverse — so the parked value survives for recovery without
changing what the operator sees.

## A named hypothesis, tested and refuted

Round 158's record named the next target: `readScoped`'s legacy-adoption path, on the
theory that it adopts a flat value into whichever scope reads first — the seeded `"default"` —
and files the operator's configuration under a store that never owned it.

A probe was written and it PASSED, so the hypothesis is refuted. The mechanism is that
`readScoped` never deletes the legacy key: it promotes the value into the scoped key AND
returns it, so every later store id re-adopts from the same intact source. The docstring's
"adopts once" means once per SCOPED KEY, not once ever — which `scopedStorage.test.ts` and
`receiptKeysStoreScoped.test.ts` between them already pin from both directions. Nothing was
changed, and the probe was deleted rather than kept as a passing test of a non-defect.

Recording the refutation matters as much as recording the fix: the next round should not spend
itself re-deriving that this path is sound.

## Evidence

- Red/green on the real source: the new case fails on the pre-fix tree and passes after.
  Kill-tested by reverting ONLY the parking branch (leaving the boot-time adoption intact) —
  the case went red, so it pins the new branch and not the old one — then restored by sha256
  to the byte.
- Reachability measured, not assumed: the unmount was confirmed at `AppShell.tsx:722`/`:755`
  and the clearing of `activeWorkspace` at `WorkspaceContext.tsx:363`, which is what makes the
  deleted key the only copy.
- A test-pattern bug caught by the first red: my assertion matched the literal
  `pos-active-draft-parked`, but the implementation builds it as `base + '-parked'`, so the
  literal never appears in the source and a correct fix read as missing. The pattern now
  matches the suffix construction. A source-scanner that looks for a literal a refactor would
  legitimately remove is the round-157 lesson recurring.
- Gates: `npm run lint` PASS (0 errors, 116 warnings), `npm run typecheck` PASS (0),
  `npm run lint:i18n` PASS (0).
- Regression sweep: 8 suites, 158 passed | 1 skipped (159), including the storage-helper and
  receipts-migration suites the refutation leans on.
- Commit: `ac3c944ef`, verified with `git show --name-only` -> exactly `PosScreen.tsx` and
  `posDraftScopeTransition.test.ts`.

## Carried forward

Two rounds of the same surface have now produced a defect each, and the second was created by
the first. The pattern worth carrying: **a guard written for one case silently mis-handles the
next case that reaches it.** Round 158's null-check was correct in the situation that
motivated it and wrong in a situation that arrived at the same line by a different route, and
the wrong branch was the one that deleted data. When a condition is introduced to protect a
value, the branch that FALLS THROUGH it deserves the same scrutiny as the branch it guards.

The POS cart now has: scope isolation, boot-time migration, and park-on-collision, each pinned.
The nearby unscoped-but-store-independent retail keys (`retail-cart-width`,
`retail-tender-presets`, `retail-sound-enabled`) were checked and are correctly NOT scoped — they
carry no store-specific data, so scoping them would be churn.

> last audited 18-10-26 by docs-auditor
