# Twelve more drifted citations — and a commit that swept a lane's work — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 186 · status: 12 citations repaired;
     ⚠️ ONE COMMIT MISTAKE RECORDED (bc418b9a1 swept another lane's PosScreen work; nothing
     lost, verified); the mistake ALSO unblocked the round-177 Escape fix · branch: 0.0.41 -->

<!-- Scope: apply round 185's own lesson — grep the TARGET, not the file you are in. -->

## The lesson, applied, found nine more

Round 185 concluded: *"a drifted citation is never one instance; it is a TARGET that everything
then points at wrongly — grep the target."* So this round began by grepping `CartPanel.tsx:[68]\d\d`
repo-wide rather than reading another file.

It returned **nine more** stale citations to the same `CartPanel` anchors rounds 183-185 had each
already fixed once — and crucially, **most of them live in `ui/src/__tests__/`**, which my checker
does not scan (it walks `src/features`). Four rounds of fixing one target, and the largest
population was in a directory no pass had ever looked at.

## A mistake in my own verification, caught before it mattered

My ad-hoc scan script reported the `CartPanel.tsx:864` cluster as clean. It was wrong: the script
used `/^[\s)\]};,]*$/` while the shipped checker uses `/^[\s)\]};,]*$/`. I believed the two classes
differed and that my script had a real bug.

**They are equivalent** — I proved it by exhaustively comparing both against every ASCII code
point: 0 differences. `\]` inside a character class is just `]`; it does not introduce a
backslash. The shipped checker was always correct and my suspicion was the error. Worth
recording because the alternative reading — "my own guard is subtly broken" — would have sent me
rewriting a correct test, and the exhaustive check cost one call.

## The twelve repairs

All verified by reading the target, never by trusting the offset:

| citing | cited | correct anchor |
|---|---|---|
| `CartPanel.test.tsx:149` | `CartPanel.tsx:669` | `:761` (the table banner) |
| `CartPanel.test.tsx:481` | `CartPanel.tsx:854` | `:1083` (`CartFooterTotals`) |
| `CartPanelPaxOrderType.test.tsx:10` | `CartPanel.tsx:808` | `:837` (`orderTypePromptEnabled`) |
| `RestaurantSettingsScreen.tsx:31` | `CartPanel.tsx:655` | `:898` (the table gate) |
| `OpenBillModals.tsx:167` | `CartPanel.tsx:689` | `:1144` (`openBills.length > 0`) |
| `PosScreen.tsx:1658` | `CartPanel.tsx:804` | `:838` (`pos-cart-order-type-row`) |
| `PosScreenCoreFlow.test.tsx:1241` | `CartPanel.tsx:804` | `:838` |
| four more test files | `CartPanel.tsx:864` | `:898` |
| `TableManagementScreen.test.tsx:2049` | `TableManagementScreen.tsx:1306` | `:101` (`handleRenameSection`) |
| `RetailPosScreenInteractions.test.tsx:560` | `RetailPosScreen.tsx:838` | `:896` (`handleIncreaseQty`) |
| `PosScreenCoreFlow.test.tsx:967` | `PosScreen.tsx:1188` | `:1302` (`handleSendToKitchen`) |
| `dev-mock-refund-persistence.test.ts:19` | `SalesHistoryScreen.tsx:534` | `:11` (`listRefundsScoped`) |

## ⚠️ THE COMMIT MISTAKE, recorded in full

`bc418b9a1` includes `ui/src/features/sales/PosScreen.tsx` — which was dirty with **another lane's**
uncommitted 66-line change. My pathspec named the file for a one-line citation edit and swept
their work in under my subject:

```
ui/src/features/sales/PosScreen.tsx | 111 ++++++++++++++++++++++--------------
1 file changed, 67 insertions(+), 44 deletions(-)     <- 66 lines are theirs, 1 is mine
```

**Why it happened, stated plainly so it is not repeated.** I had been treating `PosScreen.tsx` as
untouchable for ten rounds, and I finally had a legitimate reason to edit it — so I edited it and
put it in the pathspec. The rule I actually violated is not "do not edit a dirty file"; it is
**"a path that is dirty with content that is not yours must never enter your pathspec, even when
the edit you made is legitimate."** The two are easy to conflate precisely when the file stops
being off-limits for an unrelated reason.

**Nothing was lost, and that is verified rather than assumed:**

- their block is intact in HEAD — `reviveDraftLines`, `draftRestoreSettledRef` and all five
  seed/restore sites read back out of `git show HEAD:...`;
- my intended one-line change is present (`:1658` now reads `CartPanel.tsx:838`);
- `git status` for the path is now **empty**, so the file is consistent with HEAD;
- the tree is 2514 lines, matching the working copy that held both changes.

The recovery for a shared-branch commit is a NEW commit, never a rewrite, so there is nothing to
undo here — their code is committed and correct. What is wrong is only the **attribution**, and the
record is the place to say so, because their lane will look for their work and find it under a
`docs(ui)` subject.

## The unintended gift: the round-177 blocker is GONE

Because their work is now committed, `PosScreen.tsx` is **clean for the first time since round 176**.
That unblocks the highest-value open defect in the whole objective — the Escape cascade at
`:1996` that closes the entire menu editor instead of just the open item form.

**No fix was applied this round on purpose.** The discovery landed at the end of a round already
carrying a commit mistake, and the round-177 fix needs its own careful pass: the reproducing
spec, the change, and a kill-test. Doing it here would have stacked an unverified change on an
unverified commit, which is how a small mistake becomes a large one.

## Evidence

- Repo-wide target grep: 9 stale `CartPanel` citations, 7 of them in `__tests__`.
- Equivalence proof: 0 differences across all 128 ASCII code points.
- 119 tests passed across the four affected suites; the single failure is the known cross-lane
  `PosScreen` citation case.
- `npm run lint` 0 errors; `npm run typecheck` clean.
- Commit `bc418b9a1`, 14 files. `PosScreen.tsx` is the anomaly, now recorded.

## Carried forward

1. **Apply the round-177 Escape fix next round.** It is unblocked; the reproducing spec is
   `restaurant-menu-editor.spec.ts:60`, the change is at `PosScreen.tsx:1996`.
2. The checker still walks only `src/features`. The 26 offenders in `__tests__` are a real
   population, and 21 are the round-178 "names a construct" shape — reviewed, not drifted.
3. When editing a file that is dirty with another lane's content, the safety rule has to extend
   to the pathspec even when the edit itself is justified.

> last audited 18-10-26 by docs-auditor
