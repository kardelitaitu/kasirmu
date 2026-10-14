# Following the guard's blind spot by hand found three dead citations (round 154)

## What round 153 left open

`featureCommentPaths.test.ts` matches **backticked** paths only, and its docblock says so:
round 151's comment had written its review citation bare, so a bare path is invisible to the
guard. Round 153 recorded that as a limit rather than closing it, because matching bare paths
reintroduces the false-positive rate that killed round 152's version.

This round followed the blind spot by hand instead.

## What a bare-path sweep found

Comment lines under `ui/src/features` naming a repo-relative path without backticks: **64**.
Most are file-header self-references (`// ── ui/src/features/kds/ExpoScreen.css ──`), which
are true by construction and not citations.

Of the cross-file references, **three were dead**:

| Citation | In | Status |
|---|---|---|
| `docs/plans/0.0.36-backlog.md` | `PaymentModal.tsx:106` | moved to `docs/plans/_backlog/` |
| `docs/plans/0.0.36-backlog.md` item 69 | `WorkspaceInventorySettings.tsx:25` | moved |
| `docs/2026-07-28-retail-pos-theming-audit.md` P0-1 | `RetailPosScreen.tsx:247` | **deleted** by `d0fe74814` |

Every other bare citation was checked and resolves — `crates/…refunds.rs`,
`scripts/verify-bundle-parity.py`, `docs/specs/_active/tauri-ux-design-language-plan.md`,
`shared-ui/locales/sales.ftl` and the rest.

## The judgement call in the retail fix

The backlog citations pointed at a real, moved file, so they were re-pointed at
`docs/plans/_backlog/0.0.36-backlog.md`, with item 69 confirmed present in it before the edit.

The theming audit was **deleted**, not moved — `git log --diff-filter=D` dates the deletion to
`d0fe74814` (*"chore: archive 40 legacy docs"*). A re-point is impossible, so the citation now
records the anchor and the archival commit instead of a path. That keeps the P0-1 finding
attached to its history without inventing an address.

## Why this is the right way round

Round 153's guard catches the backticked spelling; this round's sweep catches the bare one. The
two are complements, and the cheap part of the pair is the sweep — 64 matches, one read each,
three fixes. Doing it once per major doc move is enough; a guard for it would have to be
wider than its false-positive rate allows.

One caution taken during it: `PaymentModal.tsx` was already dirty with another lane's
uncommitted edits. The diff was checked before committing and is one comment line, so the
commit swept nothing in — the earlier `M` on that file was the line-ending artefact §7.3 warns
about.

## Verified

| Item | Result |
|---|---|
| bare paths swept | 64, all read |
| dead citations | 3 — all fixed |
| backlog target | exists, item 69 confirmed present |
| theming audit | confirmed deleted by `d0fe74814`, re-anchored |
| `featureCommentPaths` guard | 1 passed |
| Full UI suite | 12,671 passed, 0 failed |
| `tsc` | 0 |
| diff | 3 files, 3 insertions, 3 deletions — all comment lines |