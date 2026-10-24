# Six shipped plans still sit in `docs/plans/_active/`, and nothing grades it

**Date:** 2026-10-24 · **Severity:** low (hygiene, not enforcement) · **Status:** open — needs the
plans' owning lanes to confirm each one's acceptance actually ran

## What was measured

`docs/plans/_active/` holds 12 files. Six declare themselves finished in their own text:

| plan | status it claims | acceptance command recorded |
|---|---|---|
| `android-notification-listener-qris.md` | "COMPLETED & SHIPPED" (4 phases, per its 2026-10-23 stamp) | **none** |
| `northflank-p1-p7-plan.md` | SHIPPED | **none** |
| `payment-methods-plan.md` | SHIPPED | **none** |
| `payment-resilience-design.md` | SHIPPED | **none** |
| `website-plan.md` | SHIPPED | 4 (`npm run build`, `check`, `deploy`, `dev`) |
| `receipt-hierarchy-code.md` | COMPLETE | 4 (`cargo test -p kasirmu-bridge`, `cargo test -p kasirmu-core receipt_code`, `npm run lint`, `typecheck`) |

## Why it matters, and why it is not fixed here

AGENTS.md §7.4 is explicit: *"`done-` is earned ONLY when that file's own acceptance command was
RUN and PASSED"*, and a bulk rename does not earn it. Renaming these six without a recorded
acceptance would repeat exactly the mistake §7.4 was written for — and four of the six record no
command at all, so there is nothing to run.

**And no gate covers this class.** `check-dead-refs.py` exempts the entire `docs/plans/` tree by
design:

```python
"docs/plans/"   # plans name files to CREATE
```

That exemption is correct for *open* plans — they name files that do not exist yet, so a
link checker would report every one as a dangling reference. The side effect is that a plan which
finishes and is never moved is invisible: the directory is a one-way door.

## What an owner should decide

1. **For the two with recorded commands** (`website-plan`, `receipt-hierarchy-code`): run them,
   and if they pass, move the file to `_done/` with the `done-` prefix in the same commit.
2. **For the four without**: each needs its acceptance named and run by the lane that shipped it,
   then the same move. `android-notification-listener-qris.md` is the easiest — its 2026-10-23
   stamp already names the test counts (22/22 QrisQrDisplay, 72/72 PaymentModalSaleFlow).
3. **Optionally**: a gate that flags a `docs/plans/_active/` file whose text claims SHIPPED or
   COMPLETE. It cannot verify the acceptance, but it can stop the directory being a one-way door —
   the same shape as the other "verification that reads as coverage" findings.

## Provenance

- Found 2026-10-24 while looking for actionable work after the checker-coverage axes closed.
- Gate that does NOT cover it: `.agents/skills/docs-auditor/scripts/check-dead-refs.py:157`
  (`HIST_DIR_PREFIXES`).
- Related: AGENTS.md §7.4 (plan-doc naming), and the 2026-10-07 amendment that added the
  "ARCHIVED, NOT EARNED" clause.
