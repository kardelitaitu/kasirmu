# The dated-record citation defect, and the sweep that closed it — 2026-10-11

**Scope:** every `*.md` under `docs/records/audits/` (469 records, dated records by convention).
**Result:** 186 stale path citations repaired across 18 files; `check-dead-refs.py` exits 0
before and after; the audit-stamps gate exits 0 after and exits 1 before.

## The defect class

These records cite code coordinates — `crates/oz-core/src/crypto.rs`, `src/components/Footer.astro` —
while making a claim. `check-dead-refs.py` deliberately **skips the whole corpus** as dated records
(its `HIST_DIR_PREFIXES` exemption), because a plan naming files it intends to create is not a
broken link. That policy is correct for plans. Its side effect is that **nothing in the repository
verifies that a record's cited path ever existed, or still exists**.

So the coordinates rotted silently, and the rot has one signature: the *verdicts* stayed valid while
the *paths* stopped resolving. A reader following `crates/oz-lua/src/lib.rs:33` would land nowhere —
or, worse, land on the file that took the name and read its current line 33 as the finding.

`oz-*` -> `kasirmu-*` (the crate rebrand) and `src/` -> `website/src/` (the site hoist) carry most
of it, and both are mechanical: the basename is unchanged, only the prefix moved. That is why they
are repairable at all, and why a date-check is still required — a record's *claim* is about the tree
at its own commit, and the path it names is the only handle a reader has on that tree.

## What was repaired, and what was deliberately not

Repaired only where the target exists on disk and exactly one successor is possible. For each, the
record's claim stays true in substance — a coordinate was corrected, not a verdict.

| mapping | count |
|---|---|
| `crates/oz-*` -> `crates/kasirmu-*` | 131 |
| `src/*` -> `website/src/*` (seo, setup and documentation-audit records only) | 28 |
| `apps/desktop-client/*` -> `apps/desktop-tauri/*` | 10 |
| `apps/tablet-client/*` -> `apps/mobile-tauri/*` | 4 |
| `ui/src/locales/*` -> `shared-ui/locales/*` | 4 |
| six individual doc moves (`EXTENDING`, `ROADMAP`, `JOURNAL`, `audit-open-findings`, `UX_GUIDELINES`, `admin-guide`) | 8 |

Left alone, with reasons, because "repairing" them would falsify the record:

- **`src/X` in non-website records (60 hits).** There, a bare `src/` means `ui/src/`. Rewriting
  those to `website/src/` would point a UI finding at the marketing site.
- **A line whose claim IS its absence.** One record states that a directory **does not exist**;
  the path is the object of the sentence, not a link to follow.
- **DELETED paths with no successor.** `oz-foundation`, `oz-reporting/src/daily_summary.rs`,
  `oz-cli/src/commands.rs`, the SetupWizard family, scratch E2E probes — genuine history.
- **Brace globs and `dead-ref: ok`-exempted lines.** The corpus's own escape hatches still bind.

## How this was verified, and why one pass was not enough

Four independent checks, because the first attempt failed silently:

1. **Every replacement target verified on disk before substituting** — 0 unresolvable.
2. **A post-apply verifier re-derived from disk**, not from the substitution log.
3. **A character-level diff audit: 155 removed / 155 added lines, path tokens only.** No prose,
   punctuation, or whitespace was altered; every changed span is a path.
4. **Encoding: 18/18 still UTF-8, LF, no BOM, no replacement characters.**

The failure worth recording: **the first run dropped all 131 crate edits and still looked
plausible on a dry run.** The proposal path of the substitution engine returned an inconsistent
shape, so the edits vanished before being written. The *dry run* did not notice. The independent
post-apply verifier did, which is the whole argument for method 2 being a different code path
rather than the same one run twice — a dry run and an applier that share a bug agree with each
other. The final numbers come from a clean re-run.

Both gates re-run after: `check-dead-refs.py` exit 0, `check-audit-stamps.py` exit 0.

## What this does not cover

**Line numbers are unverified and unverifiable by this method.** The sweep checked that a cited
*file* resolves. It cannot check that `:429` still means what the record claims. A citation whose
target moved content — not location — is invisible here, and `PosScreen.tsx` and `CartPanel.css`
both resolve while their cited line numbers may be stale. That is the residual defect class.

**No audit stamp or footer was added to the 18 touched files.** They are dated records and this
was a coordinate repair, not a new audit; writing an audit note into each would assert a pass the
sweep did not perform. This record is the single place the sweep is documented.

> last audited 11-10-26 by docs-auditor
