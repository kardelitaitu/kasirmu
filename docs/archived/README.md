# `docs/archived/` — retired 2026-10-02
<!-- Audit stamp: 2026-10-11 · docs-auditor · status: PASS (0 findings) · First audit of the tombstone.
     Every claim verified against the tree, because a tombstone that misdirects is worse than a missing file.
     The folder really holds ONLY this README (`docs/archived/` = ["README.md"]), so no document is still
     hiding here. All three destinations exist: `docs/records/audits/` (44 items),
     `docs/records/superseded/` (23), `docs/records/campaigns/` (exactly the 2 campaign journals the page
     says moved, and it correctly records they moved in two separate un-batched commits). The filename-
     collision example resolves on BOTH sides: `docs/records/superseded/2026-08-17-ci-pipeline.md` and
     `docs/operations/ci-pipeline.md` are both real, which is exactly why the rename was needed. The plan and
     rationale it points at (`todo-docs-restructure.md` §4 A1, §5 B0/B1) exists and is outside this audit's
     scope. The 14/12/2 counts are described as what MOVED FROM this folder, not as current directory sizes,
     so 44/23/2 today does not contradict them — left as written. · NOT re-measured: whether the two
     campaign journals' own audit stamps still hold; they are dated records with their own footers. -->

**This folder no longer holds documents.** It is a tombstone, kept so that older references to
`docs/archived/` still resolve and land somewhere that explains where the files went.

| What was here | Where it is now |
|---|---|
| 14 audit reports | [`../records/audits/`](../records/audits/) |
| 12 retired docs, old plans, obsolete guides | [`../records/superseded/`](../records/superseded/) |
| 2 agent campaign journals | [`../records/campaigns/`](../records/campaigns/) |

The two campaign journals moved in **two separate commits, never batched together** — their own
audit stamps record that two agents both signed "Manager-2", split the work between them, and
wrote *"NEVER write the sibling's file"*. Batching them would have destroyed that boundary.

## Why the folder was retired

`archived/` was a **state, not a category** — the same state spelled four different ways across
the tree (`archived/`, `decisions/archived/`, `plans/_done/`, `specs/_done/`), holding
unrelated content side by side. Worse, it produced **filename collisions across the boundary**:
`docs/archived/ci-pipeline.md` and `docs/operations/ci-pipeline.md` both existed, and nothing in
either path said which was current. The two are now date-stamped
(`records/superseded/2026-08-17-ci-pipeline.md`) or superseded outright.

The organising principle now is **live vs. record**, which is the axis
`check-dead-refs.py` already used: anything under `docs/records/` was true on a date and is not a
claim a reader may act on today.

Plan and rationale: `todo-docs-restructure.md` §4 A1 and §5 B0/B1.

> last audited 11-10-26 by docs-auditor
