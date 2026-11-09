# A false "new file" that clobbered 13 tests, and the two defects found around it — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 142 · status: 2 real defects
     fixed AND 1 self-inflicted error found and repaired in-round · branch: 0.0.41 ·
     commits: `0b090702a` (defects + the error), `4a72e14c2` (the repair) -->

<!- - Scope: restaurant POS / inventory & memos, per the active goal. Opened from round
     141's closing lead: MemosScreen and StockTransfersScreen "carry no saving state at
     all". -->

## Round 141's closing claim was wrong

It said those two screens "carry no `saving` state at all". They do — `MemosScreen` uses
`creating`, `StockTransfersScreen` uses `createSaving`. The grep that produced the claim
matched the literal word `saving`, and a differently-named flag is invisible to it. The
**shape** was right and the **names** were not, which is the same lesson as round 138: a line
shape is not a fact.

## Defect 1 — StockTransfersScreen: two transfers that move stock twice

Worst instance of the class this session has found. core `create_transfer`:

```rust
// crates/kasirmu-core/src/db/stock_transfers.rs:37-45
let id = uuid::Uuid::now_v7().to_string();
let ts = chrono::Utc::now().timestamp_millis();
// Use the random tail ... two transfers created in the same millisecond would collide
// and trip the UNIQUE constraint on `transfer_number`. The tail is random.
let short = &id[24..];
let transfer_number = format!("TRF-{ts}-{short}");
```

The random tail exists **on purpose**, so two calls cannot collide. They create two wholly
independent transfers carrying the same goods — and unlike every previous instance:

- `suppliers` / purchase orders (round 141): unique index **refuses** the replay;
- `customers` (140) / `cash_payouts` (139): duplicate row stored, but not a stock movement;
- **stock transfers: the duplicate is stored AND consequential** — sending a transfer moves
  physical stock, so the double tap moves twice what the operator entered.

Fixed with `createPendingRef` released on all three exit paths (two early returns inside
the try, plus the finally).

## Defect 2 — MemosScreen: two identical drafts

`canSubmit` includes `!creating`, which looks like a guard, but `creating` is state —
React commits it on its next render, after the second submit of a real double tap. core
`create_memo_draft` mints a fresh UUID and INSERTs unconditionally with no dedupe. Lower
stakes (a draft must still be published), same defect, same one-line fix.

## The self-inflicted error, which is the reason this record exists

`MemosScreen.test.tsx` **already existed** — 372 lines, 15 cases, including a
`describe('MemosScreen §B administrative gate')` block. I did not know that. A glob for
`**/*memo*.ftl` and a readdir of the wrong locales directory both returned nothing, and I
read that silence as "this path is untested" and wrote a **fresh file with
`fs.writeFile`**, overwriting all 372 lines.

Caught it on the commit stat: `409 ++++------...` on a file I believed was new. 345
deletions on a new file is arithmetically impossible unless the file already existed.

**What I did about it, in order:**

1. Restored the original **byte-identical** from `HEAD~1` and proved it
   (`now === orig`, 13 `it(` cases back).
2. Re-applied **only** my case onto the restored file, adapted to that file's real harness
   (`FluentWrapper`, `mocks.*`, `getByLabelText('Title')`, the "Create draft" button).
3. Kill-tested the re-applied case — red without the guard, so it is load-bearing against the
   genuine harness, not just against my own invented one.
4. Verified **0 of the 13 original cases lost**, and that the net effect across both commits
   is **44 insertions, 2 deletions** vs the pre-round original.
5. Committed the repair as its own `test(memos):` commit with a subject that says what
   happened, so the history is legible rather than silently amended. **No amend, no reset,
   no force-push** — a new commit, per the shared-branch rule.

**The lesson is about the tool, not the care.** I did not intend to overwrite anything. The
failure was that `write` on a path I had not confirmed was new, on the strength of two
searches that each returned an empty result for a reason unrelated to my question: the glob
pattern looked for `.ftl`, and I looked in `ui/src/locales` when the locales actually live
in `shared-ui/locales` behind an alias. **The correct check was `git cat-file -e
HEAD:<path>`**, which answers the only question that matters and cannot return a false
negative from a pattern mismatch. It is one command and it was available the whole time.

Also worth recording: my first attempt at the memo test used
`import memosFtl from '@/locales/memos.ftl?raw'`, which does not exist. The screen
renders English from Fluent fallbacks, so a DOM probe showed it working fine — the file
simply failed to resolve. Dumping the real DOM instead of guessing selectors is what turned
both that error and the harness into something correct.

## Evidence

- **StockTransfers:** red `expected 2 to be 1` -> 22/22; kill-tested red; restored
  byte-identical.
- **Memos:** 14/14 pass (13 original + mine); kill-tested red; restored byte-identical.
- **Restoration proof:** original file restored `=== orig`; net diff vs pre-round original
  is +44/-2; all 13 original case names still present in the file.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings — baseline), `npm run typecheck`
  PASS, `npm run lint:i18n` PASS.
- **Full suite:** 811 passed | 2 failed files; **12,923 passed**. The 2 failures are the
  unchanged pre-existing cross-lane ones (`nativeDialogCompliance`, `noiseDitherCompliance`).

## Carried forward

Two things. The `git cat-file -e HEAD:<path>` check before any `write` to a path I believe
is new — non-negotiable, and this round is the reason it is now written down.

And the completion status of the double-tap sweep: the same-task filter now covers
`ShiftBar` (open+close), `ShiftManagement` (payout), `Promotions`, `Customers`,
`Suppliers`, `PurchaseOrderForm`, `StockTransfersScreen` and `MemosScreen`. `products`
is protected by its UNIQUE sku. What is NOT yet covered is the group that had no test file at
all — `MemosScreen` was the only one I found, and finding it took a clobber to notice.

> last audited 18-10-26 by docs-auditor
