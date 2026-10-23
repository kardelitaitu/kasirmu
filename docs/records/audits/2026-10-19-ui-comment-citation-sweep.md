# UI comment citations: 223 → 4, and the four that remain are correct — 2026-10-19

**Scope:** `ui/src/**/*.tsx` / `*.ts` / `*.css` comments that carry a same-file `:NNN` citation, policed by
`ui/src/__tests__/featureCommentPaths.test.ts`.
**Repaired across this session:** the guard's "to review" census fell **223 → 4**. The 4 left were each
read and judged **CORRECT**; the guard lists them because its heuristic grades *shape*, not meaning.

## What the guard does and does not decide

It enforces one thing: every `:NNN` resolves to a non-blank line inside the file. A citation that lands
on a real but wrong line passes. So the census is a **reading queue, not a defect count** — this session
opened every entry in it.

Four verdict words were needed to make the queue drainable, and they are worth keeping:

| verdict | meaning | action |
|---|---|---|
| **DRIFTED** | right file, wrong line; the claim is true somewhere else | re-anchor by symbol |
| **NOT_FOUND** | past EOF, or blank, or the file shrank | re-anchor or delete the number |
| **FALSE-CLAIM** | the claim itself is untrue, not merely misnumbered | rewrite the claim |
| **CORRECT** | cite supports the claim | leave it alone, record why |

Plus two adjectives for the reason a cite drifted: **ENCODES** (the cite lands on prose *describing* a
rule) vs **EXECUTES** (it lands on the statement *enforcing* it), and **BRANCH-MISMATCH** (the cited line
is the failure toast where the claim is about the success path — same function, opposite branch).

## The repair rule that actually held

**Anchor by symbol or expression, never by a re-measured number.** A number is correct only until the
next insertion above it, and every one of this session's self-inflicted errors came from measuring a line
*before* an edit that shifted it. The rule that survived:

- Target **above** the citing comment → anchor by name. Insertions rot upward cites.
- Target **below** the citing comment → a number survives longer, but a name is still cheaper to keep.

Two more rules earned their place:

1. **A quoted past line number is still a live citation.** A `:NNN` inside prose that says "the note
   said :2103" is read by the guard as a cite to line 2103. When quoting history write **`line NNN`**.
   This is now stated in the guard's own header.
2. **"Anchored by identifier" does not mean the numbers were removed.** Several comments had already
   been converted to symbol anchors but still printed the old numbers in their explanation, which kept
   them in the census. Dropping the digits is part of the repair.

## Real defects found by reading, not by tooling

Two genuine duplicate blocks surfaced while reading comments around the cites:

- `ui/src/features/offline/OfflineQueueScreen.tsx` rendered the P7-3 pull-to-refresh indicator **twice**.
- `ui/src/features/settings/workspace-cards/WorkspaceRestaurantPosSettings.tsx` had a duplicated
  `return () => { cancelled = true; };` cleanup.

A multi-line block-similarity scanner was written, run, and **rejected**: it produced hundreds of
false positives on skeleton placeholders and found **neither** of these. Human-shaped reading found both.
Similarly, four "CORRECT" verdicts in this census are only correct because they were read — a
`(weak)` row pointing one line above the statement it describes is not something a scanner can grade.

## The last four, and the queue closing

A later pass took the census from 4 to **0**. Three were live cites that were already CORRECT and were
still anchored by symbol anyway (`InventoryAdjustmentScreen.tsx`, `TransactionLogScreen.tsx`,
`RestaurantReceiptsScreen.tsx`) — a correct number is not a stable one. The fourth, `PaymentModal.tsx`,
was the interesting one and is worth recording as a mistake I made:

**I created a duplicate comment block by restoring a line I had reverted.** Earlier in the session I
reverted my own cite edit in `PaymentModal.tsx` so it would not sweep up another lane's unrelated hunk.
I then restored the original line, which left BOTH the original and the anchored twin in the file — a
comment reading "not a replacement for the workspace check at :303" immediately followed by the same
sentence saying "the workspace check above". The file still parsed, still typechecked, and the guard still
went green; only reading the block showed it. The repair was to drop the restored line and keep the
anchored one. **The lesson: a revert-and-restore on a shared file needs the same read-back as any other
edit.** `PaymentModal.tsx` is left out of that commit — its working tree also holds the receivables
lane's uncommitted `pay_later` work, so committing the file would have swept it in.

## What is still open

- **155 UI comments cite `.rs` line numbers**, which the UI guard cannot reach at all — recorded in
  `docs/records/audits/2026-10-19-cross-language-citation-gap.md`. The rule there is to anchor Rust by
  function name. A four-batch read-only audit of those was dispatched at the end of this pass; its
  findings are not yet applied.

## Verification

`node node_modules/vitest/vitest.mjs run src/__tests__/featureCommentPaths.test.ts` → 4/4 pass,
census **`21 total, 21 in range, 0 to review`**. Every round also ran `tsc --noEmit` (0 in this session's
files), `eslint` on each touched file (0 errors), and the affected screen suites.

> last audited 19-10-26 by docs-auditor
