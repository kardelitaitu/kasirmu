# Nine cross-file citations no pass could see — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 184 · status: 9 dangling cross-file
     citations found and repaired, and the THIRD checker pass added so the class cannot
     return · branch: 0.0.41 · commits: 9ecd2ddf7, a0ee6fb92 -->

<!-- Scope: round 183 carried forward "a cross-file line citation has no guard". -->

## The gap, stated exactly

A citation like `CartPanel.tsx:864` has two parts and the suite checked them in two
different places — neither of which examined the number:

| part | who checks it | verdict |
|---|---|---|
| the path `CartPanel.tsx` | the path pass | resolves — passes |
| the line `:864` | **nobody** | the same-file pass SKIPS any token with a `name.ext:` prefix |

That skip is correct on its own terms — a `name.ext:NN` token is a claim about ANOTHER file, not
this one, and the same-file pass must not judge it. The consequence is the gap: **the one
citation shape whose correctness depends on a file that can grow is the one shape with no
checker.**

## The population, measured

Scanned every comment line under `features/` for a resolvable `name.ext:NN` token:

```
330 tokens total
113 resolvable to a real file
217 unresolvable  -> prose, a vendored path, or a URL: skipped, not failed
  9 pointing at a line that is blank, punctuation-only, or past EOF
```

The nine, and each was verified individually rather than trusted from the scan:

| citing | cited | what it actually read |
|---|---|---|
| `CartActionBar.tsx:37` | `CartPanel.tsx:864` | `}}` |
| `SplitBillModal.tsx:18` | `CartPanel.tsx:864` | `}}` — the SAME drifted target |
| `PaymentModal.tsx:586` | `ReceiptPreview.tsx:183` | `` (blank) |
| `PaymentModal.tsx:1446` | `ReceiptPreview.tsx:183` | blank |
| `useLocalPaymentRails.ts:177` | `PaymentModal.tsx:2251` | `)}` |
| `KdsHamburgerPanel.tsx:529` | `KdsScreen.css:876` | `}` |
| `useBackupStatus.ts:71` | `data.rs:33` | blank |
| `useBackupStatus.ts:71` | `data.rs:133` | blank |
| `kdsThresholdMinutes.ts:4` | `KdsScreen.tsx:913-923` | past EOF (701 lines) — historical, correctly non-resolving |

Two things stand out. **`CartPanel.tsx:864` appears three times** — round 183 fixed one
instance and left two, because I had only looked at the file I was already editing. And
`useBackupStatus.ts` had **four** numbers in one comment, all stale: the symbols had
moved and nothing re-read them.

## The new pass, and its deliberate narrowness

Added as the suite's third pass. What it ENFORCES is only the no-false-positive subset, for
the reason the same-file pass already documents: a line that is BLANK or PAST EOF cannot be
what any comment means to cite. What it EXEMPTS, each because a real citation needed it:

  · **historical references** — "Moved verbatim out of KdsScreen.tsx:913-923" is a claim
    about the past and must NOT resolve. Detected by the same word list the same-file pass uses,
    widened to the comment block;
  · **unresolvable files** — prose and vendored paths are skipped, never failed;
  · **anything holding text** — accepted however near it lands, so a section anchor stays legal.

## The self-test caught my own bug, which is why it exists

Before trusting the population I pinned a case that must resolve: a synthetic comment citing
this very file at a line known to hold text. **It failed on the first run — the extractor found
nothing.** The synthetic used `:1` (one digit) against the extractor's `:NN` (2–4 digits)
rule. A checker that matches nothing reports zero offenders identically to a clean tree — the
same failure shape this session has hit three times, most recently in the citation-rewriter of
round 178. One case, first run, and it was the author it caught.

## Kill-tested

Reintroducing one repaired defect exactly — `KdsHamburgerPanel.tsx:529` back to
`KdsScreen.css:876` — turns the new pass red naming that file and line, and restoring it
leaves the suite unchanged. Verified by sha256: the restore is byte-identical
(`b7ae46785e404d2c`).

## Evidence

- 330 tokens scanned, 113 resolvable, 9 offenders — each row above read from the tree.
- After repair the new pass is **green** and the other three are unchanged.
- Self-test green; kill-test red-then-restored byte-identical.
- `npm run lint` 0 errors (116 pre-existing warnings, none mine); `npm run typecheck` clean.
- Bundle parity 0 missing keys on both commits.
- Committed in two: `9ecd2ddf7` (the 6 repair files, 8 insertions / 8 deletions) and
  `a0ee6fb92` (the checker, 160 insertions).

## Carried forward

1. The checker enforces blank/past-EOF only. The identifier heuristic for cross-file citations
   — "does the cited line mention a token the comment names?" — is **not** enforced, for the
   reason round 178 established: it samples badly and would rewrite correct citations.
2. The round-177 Escape defect remains the top open reliability item: `PosScreen.tsx` still
   dirty at hash `ff144486f`, re-verified this round.
3. No Android device attached, so the tablet lane and F40 device confirmation stay blocked on
   hardware.

> last audited 18-10-26 by docs-auditor
