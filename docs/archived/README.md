# `docs/archived/` — retired 2026-10-02

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
