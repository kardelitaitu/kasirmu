# An attestation, and a false alarm almost reported as a defect — 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 151 - status: 1 real defect fixed
     (double audit review checkpoint), 1 near-miss on the shared-branch race - branch:
     0.0.41 - commits: aaf9078d6, 75ee0d280 -->

<!-- Scope: audit log UI, per the active goal. Opened from round 150 own carry-forward:
     grep the forward-only counters, because that is the shape the backend cannot defend. -->

## The forward-only sweep first: the counters are not the gap

Round 150 named the counter writes as the remaining candidate set. Swept 162 SQL increment
sites across the crates and narrowed to the production sequence writers:

  * `claim_statutory_number_for_sale`  -- atomic `UPDATE ... RETURNING` inside the
    transaction (fiscal.rs:438-455), fixed on the UI side in rounds 148-149.
  * `claim_receipt_sequence`            -- an `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`
    upsert, called inside the checkout transaction so a rolled-back sale consumes no
    number, refusing past `SEQUENCE_MAX` rather than wrapping (receipt_code.rs:300-344).

Both are defended in core, and the receipt path is additionally covered by the COR-7 replay
guard that returns the original receipt. So the forward-only counters turned out NOT to be
the gap - the UI double-tap in front of them was, which is the same conclusion as rounds 148
and 150 restated from the other direction. That is worth recording as a negative result: a
grep for increments is the right sweep and it comes back clean.

## The defect: a review checkpoint is an attestation

AuditLogScreen.handleMarkReviewed had the state-only shape. The backend does not refuse a
repeat and cannot:

    // crates/kasirmu-core/src/db/audit.rs:909-944
    INSERT INTO audit_review_checkpoints (id, store_id, reviewer_user_id, reviewed_at,
                                            reviewed_through_created_at, reviewed_through_id)
    ... then insert_audit(&tx, &event)   // the audit.review event, same transaction

A plain INSERT, no idempotency, no unique key - and the `audit.review` event lands in the
SAME append-only, hash-chained log the checkpoint is attesting about.

What a duplicate row does not capture, and why this is the worst arm of the class:

1. **It is an attestation, not a record.** `reviewed_through_created_at` asserts that a human
   saw every entry at or before that cursor. A second write asserts it twice for one review.
2. **The payload is a CLIENT-DERIVED high-water mark.** Page 1 is newest-first, so
   `entries[0]` is the globally newest row (AuditLogScreen.tsx:228-234). After the first
   submit the handler reloads the list, which puts the `audit.review` event itself at the
   head -- so the second write attests that the reviewer looked at the record of them
   looking.
3. Two `audit.review` rows for one review means the count of checkpoints no longer equals the
   number of times anyone reviewed anything. Not a hash break, but it defeats the purpose of
   the counter.

## A near-miss on the shared branch, caught by checking rather than reporting

After committing, `git show --stat HEAD` reported my commit as containing three files I had
never touched (SplitBillModal, PosScreen, SplitBillModal.money.test.tsx) - which would have
meant I had swept another lane in-flight work, the round-142 failure repeating itself.

It had not. `git show HEAD` was reading a commit that had landed ON TOP of mine in the same
second (`d32d65f0c`, another lane). `git log --oneline` showed my commit `aaf9078d6` intact
and `git show --name-only aaf9078d6` listed exactly my two files. **The branch state had
moved between two adjacent commands, and the second one was right.**

A separate observation from the same window: the full suite initially reported a 4th failure
in `SplitBillModal.money.test.tsx` that was simply not written yet on disk - it was green 60
seconds later once that lane finished committing. Both readings were a timing artifact of a
shared checkout, and neither was a defect. The lesson is that on this branch a single
`git show HEAD` is not a safe witness; a named ref (`git show <my-sha>`) is.

## Evidence

- Red then green: `expected 2 to be 1` before the guard; 43/43 in AuditLogScreen.test.tsx
  after.
- Kill-test: the guard check+set removed -> red; restored byte-identical from a backup.
- Counter sweep: 162 increment sites enumerated, narrowed to the two sequence writers, both
  found already defended in core with file and line.
- Commit hygiene: `git show --name-only aaf9078d6` lists exactly my two paths; no foreign file
  in my commit; HEAD was verified separately.
- Gates: `npm run lint` PASS (0 errors, 113 warnings), `npm run typecheck` PASS,
  `npm run lint:i18n` PASS. Both my file and the lane that raced me pass together (48/48).
- Full suite: 811 passed | 3 failed files of 814; **12935 passed** (up 2). The 3 failures are
  all cross-lane and none is mine: featureCommentPaths (the b3eadb555 citation drift
  documented in round 150), plus the two long-standing nativeDialogCompliance and
  noiseDitherCompliance.

## Carried forward

The forward-only sweep is closed and clean. Every arm of the re-entry class now has a named
verdict in check-reentry-guards.py, including this one, so the next sweep is a read rather
than a hunt.

What is genuinely left is not another instance of this class - it is the residual coverage
question the sweep kept surfacing: two whole paths (`createCashPayoutScoped`, the invoice
calls, these review statuses) were invisible because a per-file `vi.mock` factory omitted
them, and the shared-factory checker does not see inline factories. There are 891 of them.
That is still the most valuable thing left to build, and this round confirmed the sweep for
it is not a grep - it needs the module surface, which means an import, which is why the
inline cases are hard.

> last audited 18-10-26 by docs-auditor
