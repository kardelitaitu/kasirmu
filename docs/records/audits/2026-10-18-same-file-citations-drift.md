# Sixteen same-file line citations pointed at blank lines, and nothing checked them

Date: 2026-10-18 (round 131). Commits: `9b277e76e` — *docs(ui): re-point sixteen
same-file line citations that had drifted*; `c2e9832fe` — *test(ui): catch same-file
comment citations that point at blank lines*.

## How it started

`PosScreen.tsx:1812` claimed its shortcut handlers were 'self-guarding' and cited three
line ranges as the evidence. All three had drifted — by 68, 146 and 80 lines — and the
file had 22 same-file citations in total. That is the exact shape round 126 found a
FALSE CLAIM hiding behind: a pointer that reads as verified because the file it names
still opens.

## The gap in the existing guard

`featureCommentPaths.test.ts` already police comment citations, and it is thorough —
two passes, a measured false-positive rate, an exemption for deliberately-deleted
paths. But both passes answer ONE question, *does the file exist*, and both strip the
line suffix before asking it:

```ts
const cleaned = raw.replace(/:\d+(-\d+)?$/, '').replace(/[.,;]$/, '');
```

So `PosScreen.tsx:914-918` is checked as 'does PosScreen.tsx exist' — never whether
line 914 is what the comment says. A moved line, unlike a moved file, was invisible.

## What the new check found

Extending the file with a same-file extractor and an ENFORCED subset — a citation whose
range is blank or past EOF cannot be right, with no false positives — the guard reported
and then closed **16 genuinely broken citations**:

| File | Was | Now | What it cites |
|---|---|---|---|
| PosScreen.tsx ×3 | :845-850, :1042-1052, :884 | :914-918, :1189-1198, :964 | three handler guards |
| RetailPosScreen.tsx ×3 | :2080, :2084, :1462 | :2103, :2107, :1464 | my own round-123 comment |
| RestaurantReceiptsScreen.tsx ×6 | :533, :806, :972, :1012, :1121, :1143 | :195, :213, :808, :975, :1015, (one dropped) | five callbacks + two task sites |
| InventoryAdjustmentScreen.tsx ×3 | :152, :66, :52, :85 | :157, :67, :53, :84 | four refs in one note |
| StockCountHistory.tsx | :161 | :179 | the sc-badge span |
| StockCountDetail.tsx | :243 | :246 | the sc-badge span |
| KdsScreen.tsx | :321 | :306 | `ExpoScreen.advanceItemStatus` |
| WorkspaceInventorySettings.tsx ×3 | :57, :58, :61, :64 | :75, :76, :58, :65 | reads and a touched-set |
| WorkspaceRestaurantPosSettings.tsx | :73/:76 | :130/:138 | the latch writes |
| TableManagementScreen.tsx | :657 | :699 | `loadTables()` on the success path |

Every one was checked by reading the target before re-pointing it. `ExpoScreen:321` was
blank; `advanceItemStatus` is at `:306`. `StockCountHistory:161` was blank; the badge
is at `:179`. Nothing was re-pointed by arithmetic.

## The heuristic, and why it is only half-enforced

The guard computes a SIGNAL — does the cited range mention an identifier the comment
names — over all 194 same-file citations, and reports the 154 that do not. That number
is real, not noise: a hand-checked sample of four flagged citations were ALL genuinely
drifted (`setActiveWorkspace(null)` at :363 landing on `tableNumber,`; `printed args` at
:232 on `category: l.category,`; `setActiveOpenBillId(null)` at :993 on `});`; a
restaurant gate at :395 on a `useState`).

It is NOT enforced, because the heuristic cannot separate 'this drifted' from 'this
comment paraphrases and names no identifier the line carries' — and failing the suite on
154 pre-existing citations would teach the tree to ignore the guard. ENFORCED is the
subset with no false positives: blank lines and past-EOF. That half also grows
monotonically, since a file that shrinks turns correct citations into dangling ones.

Four false positives were found while calibrating and each narrowed the detector rather
than being exempted: a citation line naming other components in prose
(`ProductLookupScreen at :91, PosScreen at :143`), a comment block naming `receipt.rs`
then citing its fields, a `|`-delimited table row about a foreign type, and that table's
HEADER row. Each is documented in the function.

## Verification

* The new case is GREEN on the whole features tree: 194 citations extracted, 0 dangling.
* KILL: re-breaking `TableManagementScreen.tsx`'s citation to the old blank `:657` turned
  it RED with the exact line named; the file was restored and verified identical.
* `npm run typecheck` clean; `npm run lint` 0 errors (114 pre-existing warnings).
* Full suite: `810 passed | 3 failed (813)` files, `12906 passed | 4 failed` tests — the
  same four `TableManagementScreen`-CSS failures from commit `4347b36d2`, another lane.
* Ten production files changed, 27 insertions and 19 deletions, and EVERY changed line in
  them is a comment line — verified mechanically, not by eye.

## Finding 2 — the four files I did not touch already had real defects

Three of the sixteen were mine (round 123's RetailPosScreen comment). The rest were
someone else's, aged by file growth — including a six-line citation block in
RestaurantReceiptsScreen whose comment says 'in this file' and names six line numbers,
none of which was right. That comment is the whole argument for the guard: it was
written carefully, with explicit evidence, and every piece of its evidence had rotted.

> last audited 18-10-26 by docs-auditor
