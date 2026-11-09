# A red order-type checker I had written off as noise — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 161 - status: 1 checker brought from
     RED to green, 2 derivations evaluated and exempted with checkable evidence, 1 earlier
     misclassification corrected - branch: 0.0.41 - commit: f11e685e6 -->

<!- - Scope: the restaurant order-type surface, named by round 160 as the next direction.
     It began as a search for a defect in the order-type path and ended by correcting a
     standing false negative in my own triage. -->

## A red suite I had been calling someone else's

Rounds 155-160 recorded `OrderTypeDependentValueRule.test.ts` as cross-lane noise. That was a
misclassification, and it cost five rounds. The file is a SOURCE-SCANNING guard for exactly the
class this goal has been working: a dine-in-only value reaching a consumer unconditionally. It
was red, it named three concrete derivations, and nobody had looked.

The lesson is narrow and worth stating plainly: **a red test is evidence, and "not mine" is a
conclusion that needs its own evidence.** I had been treating a red suite as someone else's
in-flight work because the files it named were not files I had touched. Both files are clean at
HEAD and one of them had been touched by a recent commit of another lane — which is a reason to
CHECK ownership, not a reason to skip the check.

## What the checker does, and why that mattered

It DISCOVERS its sources rather than listing them (`ROOTS` = features/sales,
features/restaurant, features/tables; the file's own header records that an earlier
hand-written list of four silently missed three files referencing `orderType`). It computes
enclosing blocks with a brace STACK rather than a depth counter, and it is itself guarded by
eight hand-built detector cases plus a non-vacuity case asserting it still finds derivations.

That is a well-built guard, and the two exemptions I had to make are the interesting part.

## The three findings, and the two different verdicts

**`completedSale.ts:301` — a value-handler.** `buildKitchenChitReceipt` derives
`bareTableNumber(tableNumber || '')` into the chit identifier. `tableNumber` is a
PARAMETER and the function makes no order-type decision. Both callers gate it: `PosScreen.tsx:1225`
computes `chitTable = orderType === 'dine_in' ? … : ''` and passes THAT to both call sites
(`:1230`, `:1253`). This is the same category as the file's existing `tableLabel.ts` exclusion,
and gating inside the formatter would gate nothing. Added to `VALUE_HANDLERS`.

**`TableManagementScreen.tsx:832/833` — a record-type decision, NOT a missing gate.**
`handleConfirmMergeTable` derives PAX from `getTableBill(name)` on both operands. I tried to
evaluate this as a defect, and the evidence says it is not one. `matchesTableBill`
(`tableLabel.ts:81`) requires the bill's LABEL or CUSTOMER NAME to name the table;
`usePosHeldCarts.ts:261` computes `trimmedTable` as `''` unless `orderType === 'dine_in'`;
`:291` omits `tableNumber` entirely when that is empty; `:298` builds the stored label from the
same `trimmedTable`. A takeaway or delivery tab is saved with no table and a label naming none,
so it is UNMATCHABLE and cannot be either side of a merge. The order-type question was settled
one layer down, when the record was created.

## Four wrong attempts, and what they were wrong about

Getting to that verdict took four attempts, and every one of them was the same mistake: bending
the PRODUCTION code to satisfy a REGEX. I wrote, in order, a negated-pair guard
(`orderType !== 'takeaway' && … !== 'delivery'`), a normalising ternary, a local named
`destOrderType`, and a destructured `const { orderType }` — each time because the scanner's
literal `orderType === 'dine_in'` did not appear on the line it inspects. None satisfied it, because
the rule genuinely does not apply here.

The correct response was the one I eventually took: revert all four (`git checkout --`),
establish the real invariant from the save path, and record the exemption WITH evidence. Editing
production code to match a scanner's pattern is how a guard turns into a formatting
convention, and the revert is named here because the temptation will recur.

## The exemption, and why it is not a bypass

`RECORD_TYPE_GATED` is a SECOND list, deliberately separate from `VALUE_HANDLERS`. They mean
different things: a value-handler makes no decision at all, while a record-type-gated source
operates on a record that is dine-in by construction. Collapsing them would lose that, and
spelling the second as the POS rule would tell a reader the order type is in doubt when it is not.

Each entry carries an `evidence` regex, and a new case FAILS if the file stops matching it — so
an entry whose premise expires breaks the build instead of silently excusing derivations.

## Evidence

- Red to green: 2 failed / 51 passed before; 6 files, 53 passed after.
- Exemption cannot hide a regression (kill-test 1): renaming `getTableBill` so the evidence
  regex stops matching turns the new case RED with the message naming the file and the reason.
- The scan is still live (kill-test 2): injecting an ungated
  `const injectedGuardProbe = (tableNumber ?? '').trim();` into `PosScreen.tsx` fails the scan and
  names `PosScreen.tsx` with the injected line — so exempting two files did not blind the tree.
- Production code is untouched: `TableManagementScreen.tsx` and `PosScreen.tsx` both verified
  clean against HEAD after the kill-tests, `PosScreen.tsx` by sha256 against its backup.
- Gates: `npm run lint` PASS (0 errors, 116 warnings), `npm run typecheck` PASS (0).
- Commit: `f11e685e6`, verified with `git show --name-only` -> exactly the one test file.

## Carried forward

The order-type CLASS is now green and guarded rather than merely un-red, which changes what this
lane should do next: running that suite is no longer informative, but its red state surviving
six rounds unnoticed is. The live question is **which other red suites are being read as noise**.
The suite count from this session is ~810 passed with 4-5 failing files, and at least one of
those failure files is now known to have been a real, fixable, in-scope guard. Each remaining
one deserves the same treatment this round gave this file: read the failure, trace the named
lines, and only then decide whose it is.

> last audited 18-10-26 by docs-auditor
