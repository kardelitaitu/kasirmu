# Manager Journal - fix AGENTS.md/README CI claims, stale counts, code-comment rot
Derived from the closed objective `plan-docs-review-update`. User said 'do it' on the out-of-scope list.

## Goal
Make the two root doc mirrors and README state CI truth (dev-ci.yml DOES have a push trigger; clippy runs in NO
live workflow) and carry measured counts; fix two stale code comments that misdirect readers; then make the claim
machine-policed so it cannot rot again.

## Fences (one owner per file, recorded before launch)
| owner | role | files | state |
|---|---|---|---|
| 6d5670ed | writer W1 | AGENTS.md + .agents/AGENTS.md (mirrors kept together on purpose) | in flight |
| d3c8a9a0 | writer W2 | README.md | in flight |
| 737bd54c | coder C1 | apps/desktop-client/src/lib.rs + crates/oz-core/src/terminal_override.rs (comments only) | in flight |
| 624e6edf | researcher R1 | read-only: verify-agents-mirrors.py data model + where a new rule goes | in flight |

Shared rules file (workers read it instead of getting a wall of prose): .agents/manager-wave4-rules.md
Timer: schedule-6 = wave-4 dead-man (900s).

## MANAGER VERIFICATION of C1's comment edits (independent of its report)
numstat: apps/desktop-client/src/lib.rs +5/-1, crates/oz-core/src/terminal_override.rs +3/-1 — comment-only; every
removed line is a `///`/`//!` doc line (my first filter used \s, unsupported in POSIX ERE, and falsely flagged one).
- lib.rs:21 now reads 'the `tauri::generate_handler` list - 453 command paths as measured 2026-09-14 by
  `python scripts/verify-ipc-parity.py` (458 UI strings / 453 registered / 27 unregistered, EXIT 0). Count it again
  rather than trusting the figure here: it moves with every commit that touches this list.' -> the anti-rot pattern
  we want: number + command + date + explicit instruction to re-measure.
- terminal_override.rs:17 now says the field holds the kebab-case form returned by `crate::features::feature_key`
  (e.g. "card-payment"), NOT the full `feature.<suffix>` settings key. I confirmed all three legs:
  (a) crates/oz-core/src/features.rs:420-422 - pub fn feature_key returns the bare suffix ("simple-retail"), with
      the doc itself stating the full settings key is `feature.<suffix>`;
  (b) every real caller stores the suffix: apps/tablet-client/src/commands/features.rs:70,:74,:172,:220,:224,:309,:313,
      setup.rs:61, crates/oz-bridge/src/features.rs:67 all do `feature_key(f).to_string()`;
  (c) the only producers of rows are tests using bare kebab values - terminal_override_tests.rs:7 "gift-cards", :21
      and :31 "kds" - and the store (db/terminal_overrides.rs:78 INSERT) passes `feature: &str` through unchanged,
      the migration column being plain TEXT (20260813_init.sql:909-915, PK (terminal_id, feature)).
  So the new comment is TRUE as written, and the old `crate::feature_key` pointer was indeed a dead path.

## Deliberately NOT in this wave
- PARKED, not mine: the other session's uncommitted .agents/archived/ move (43 tracked files deleted in the worktree).
  Committing or reverting it would be committing another agent's in-flight work. Left to its owner; user informed.
- The 75 orphan Fluent IDs are a real i18n debt but deleting keys is NOT a doc fix - record only.
- Vitest case totals: not measurable without running the suite, so docs must say 'not measured' rather than keep 8,056.

## COMMIT LANDINGS (this wave)
- 98e8e29a8 docs(desktop-client,core) | apps/desktop-client/src/lib.rs + crates/oz-core/src/terminal_override.rs |
  +6/-2, comment-only. Verified by me at HEAD (not from the report): the committed wording IS C1's final text - an
  earlier probe of mine had caught an intermediate edit, so no fix-forward was needed. C1's gates: cargo check
  -p oz-core EXIT 0, cargo check -p kasirmu-app EXIT 0; `cargo fmt --all` deliberately NOT run (shared checkout).
  lib.rs:21-23 now states 453-entry (measured 2026-09-14) + the verify-ipc-parity command + 're-measure it instead of
  trusting the number here'. terminal_override.rs:17-19 names crate::features::feature_key as a FUNCTION and states
  which of the two key forms the field holds.
- C1 REUSED (resident, no new spawn) for a file it surfaced itself: apps/desktop-client/README.md claims '426
  commands registered'. Fence: that one file only. Told to say WHICH question its number answers (453 registered
  paths vs 458 UI strings vs 453 list entries), leave dated stamps alone, and sweep its other figures/paths.

## GROUND TRUTH measured for the gate (so W1 cannot over-correct)
`grep -nE 'clippy|cargo fmt' .github/workflows/dev-ci.yml .github/workflows/release.yml` -> ONLY dev-ci.yml:195
`run: cargo fmt --all -- --check` plus :478 which is a COMMENT. So fmt --check IS CI-enforced; clippy = 0 in both live
workflows. Correct doc sentence = 'cargo-check runs fmt-check + cargo check, NOT clippy; clippy is local-only
(scripts/check.sh:44, scripts/release.sh)'. The existing AGENTS.md sentence about fmt running in CI is already TRUE and
must be left alone. Job anchors: ci-docs-drift :352, static-gates :451, release-readiness :628.
Forwarded to W1 verbatim to prevent replacing a wrong absolute with a new wrong one (the failure mode G6 hit in
the previous wave).

## R1 DOSSIER VERDICT + MANAGER EXECUTION (settles the sizing gate)
- Full bidirectional rule (triggers + which tools a job runs) = 110-135 lines, 2 workers => NOT small => the clippy/
  `run:` half is OUT OF SCOPE by the user's own condition.
- Trigger-only rule = ~40 lines, 1 file, already wired into check.sh:421-422 + dev-ci.yml:426-429 + gates.json:
  487-497 (which run the script AND --self-test blocking) => SMALL => dispatched to coder b9f79136.
- REFUTED by execution: R1's inference that triggers_of() cannot parse a block `on:`. Running its exact regex on
  dev-ci.yml matched and yielded [pull_request, branches, push, branches, workflow_dispatch] - `\s*# Manager Journal - fix AGENTS.md/README CI claims, stale counts, code-comment rot
Derived from the closed objective `plan-docs-review-update`. User said 'do it' on the out-of-scope list.

## Goal
Make the two root doc mirrors and README state CI truth (dev-ci.yml DOES have a push trigger; clippy runs in NO
live workflow) and carry measured counts; fix two stale code comments that misdirect readers; then make the claim
machine-policed so it cannot rot again.

## Fences (one owner per file, recorded before launch)
| owner | role | files | state |
|---|---|---|---|
| 6d5670ed | writer W1 | AGENTS.md + .agents/AGENTS.md (mirrors kept together on purpose) | in flight |
| d3c8a9a0 | writer W2 | README.md | in flight |
| 737bd54c | coder C1 | apps/desktop-client/src/lib.rs + crates/oz-core/src/terminal_override.rs (comments only) | in flight |
| 624e6edf | researcher R1 | read-only: verify-agents-mirrors.py data model + where a new rule goes | in flight |

Shared rules file (workers read it instead of getting a wall of prose): .agents/manager-wave4-rules.md
Timer: schedule-6 = wave-4 dead-man (900s).

## MANAGER VERIFICATION of C1's comment edits (independent of its report)
numstat: apps/desktop-client/src/lib.rs +5/-1, crates/oz-core/src/terminal_override.rs +3/-1 — comment-only; every
removed line is a `///`/`//!` doc line (my first filter used \s, unsupported in POSIX ERE, and falsely flagged one).
- lib.rs:21 now reads 'the `tauri::generate_handler` list - 453 command paths as measured 2026-09-14 by
  `python scripts/verify-ipc-parity.py` (458 UI strings / 453 registered / 27 unregistered, EXIT 0). Count it again
  rather than trusting the figure here: it moves with every commit that touches this list.' -> the anti-rot pattern
  we want: number + command + date + explicit instruction to re-measure.
- terminal_override.rs:17 now says the field holds the kebab-case form returned by `crate::features::feature_key`
  (e.g. "card-payment"), NOT the full `feature.<suffix>` settings key. I confirmed all three legs:
  (a) crates/oz-core/src/features.rs:420-422 - pub fn feature_key returns the bare suffix ("simple-retail"), with
      the doc itself stating the full settings key is `feature.<suffix>`;
  (b) every real caller stores the suffix: apps/tablet-client/src/commands/features.rs:70,:74,:172,:220,:224,:309,:313,
      setup.rs:61, crates/oz-bridge/src/features.rs:67 all do `feature_key(f).to_string()`;
  (c) the only producers of rows are tests using bare kebab values - terminal_override_tests.rs:7 "gift-cards", :21
      and :31 "kds" - and the store (db/terminal_overrides.rs:78 INSERT) passes `feature: &str` through unchanged,
      the migration column being plain TEXT (20260813_init.sql:909-915, PK (terminal_id, feature)).
  So the new comment is TRUE as written, and the old `crate::feature_key` pointer was indeed a dead path.

## Deliberately NOT in this wave
- PARKED, not mine: the other session's uncommitted .agents/archived/ move (43 tracked files deleted in the worktree).
  Committing or reverting it would be committing another agent's in-flight work. Left to its owner; user informed.
- The 75 orphan Fluent IDs are a real i18n debt but deleting keys is NOT a doc fix - record only.
- Vitest case totals: not measurable without running the suite, so docs must say 'not measured' rather than keep 8,056.

## COMMIT LANDINGS (this wave)
- 98e8e29a8 docs(desktop-client,core) | apps/desktop-client/src/lib.rs + crates/oz-core/src/terminal_override.rs |
  +6/-2, comment-only. Verified by me at HEAD (not from the report): the committed wording IS C1's final text - an
  earlier probe of mine had caught an intermediate edit, so no fix-forward was needed. C1's gates: cargo check
  -p oz-core EXIT 0, cargo check -p kasirmu-app EXIT 0; `cargo fmt --all` deliberately NOT run (shared checkout).
  lib.rs:21-23 now states 453-entry (measured 2026-09-14) + the verify-ipc-parity command + 're-measure it instead of
  trusting the number here'. terminal_override.rs:17-19 names crate::features::feature_key as a FUNCTION and states
  which of the two key forms the field holds.
- C1 REUSED (resident, no new spawn) for a file it surfaced itself: apps/desktop-client/README.md claims '426
  commands registered'. Fence: that one file only. Told to say WHICH question its number answers (453 registered
  paths vs 458 UI strings vs 453 list entries), leave dated stamps alone, and sweep its other figures/paths.

## GROUND TRUTH measured for the gate (so W1 cannot over-correct)
`grep -nE 'clippy|cargo fmt' .github/workflows/dev-ci.yml .github/workflows/release.yml` -> ONLY dev-ci.yml:195
`run: cargo fmt --all -- --check` plus :478 which is a COMMENT. So fmt --check IS CI-enforced; clippy = 0 in both live
workflows. Correct doc sentence = 'cargo-check runs fmt-check + cargo check, NOT clippy; clippy is local-only
(scripts/check.sh:44, scripts/release.sh)'. The existing AGENTS.md sentence about fmt running in CI is already TRUE and
must be left alone. Job anchors: ci-docs-drift :352, static-gates :451, release-readiness :628.
Forwarded to W1 verbatim to prevent replacing a wrong absolute with a new wrong one (the failure mode G6 hit in
the previous wave).

 backtracks, so
  any_push is True, not dead. THE REAL DEFECT (measured): PUSH_CLAIM_RE :224 only matches 'CI runs/triggers/deploys/
  publishes', so the corrected mirror prose ('a push to main therefore does run CI') never sets says_push - the gate
  is green for the wrong reason, and a mirror merely quoting 'CI runs on push' would trip it. Recorded in the brief.
- R1 item 5 (also measured by me, sent to W1 as corrections A and B): gates.json rust-clippy is status 'required' with
  runners={check.sh} and _note 'Local-only / manual. Skipped in CI' - NOT 'retired' as our new mirror text claimed;
  and ci-docs-drift is status 'required' + its step ends `[ "$status" = "PASS" ]` (~dev-ci.yml:407) = BLOCKING, so the
  mirrors' 'because it is advisory' clause is false today (the workflow's own comment at :662-664 repeats it - code
  comment, outside every fence, REPORTED not edited).

## Commits landed (wave 4)
- 98e8e29a8 docs(desktop-client,core) two stale doc comments | 2 files, +6/-2, cargo check -p oz-core & -p kasirmu-app
  both EXIT 0 (C1).
- HEAD docs(readme): re-measure 8 live claims and separate CI policy from enforcement | README.md only, +19/-13.
  Verified before committing: `git diff --cached --name-only` = 0 lines; after: `git show --name-only` = README.md only.
- Still uncommitted while their owners run: AGENTS.md + .agents/AGENTS.md (W1), apps/desktop-client/README.md (C1),
  docs/guides/api-reference.md + docs/guides/EXTENDING.md (C1's second task), scripts/verify-agents-mirrors.py (new).

## Baseline gate evidence (taken BEFORE edits, so 'green' is meaningful)
- `python scripts/verify-agents-mirrors.py` EXIT 0 at 03:07Z and again at 03:1xZ after the mirrors were rewritten -
  green before AND after, which is exactly why its green proves nothing about the two CI claims (now stated in the file).
- `python scripts/verify-ci-docs-drift.py` EXIT 0, '0 drift item(s)', 13 jobs / 2 workflow files, gates.json 70 gates
  (53 required, 1 advisory, 16 retired), 10 .bak-only workflows, 5 runner labels uncovered.
- CI ground truth: `grep -nE 'clippy|cargo fmt' .github/workflows/dev-ci.yml .github/workflows/release.yml` -> only
  dev-ci.yml:195 `run: cargo fmt --all -- --check` + :478 a comment. `grep -c clippy` on both live files -> 0, 0, EXIT 1.
  `grep -rln clippy .github/workflows/` -> ci.yml.bak only (lines 5, 230, 251).
- Fluent truth: per-file 4,875 en + 4,950 id = 9,825 defs; `cat`-based = 9,824 / 4,949 because sales.ftl has no final
  newline (checked `tail -c1` over all 54 files: exactly one fails); dotted `key.attr =` definitions = 0 tree-wide.
## Gate plan (before any commit)
1. `python scripts/verify-agents-mirrors.py` (must pass; if it fails because my prose broke a compared surface, fix
   the prose, never the script).
2. Re-grep the corrected claims: sed dev-ci.yml:1-10, grep -c clippy over live workflows, counts re-run.
3. `git --no-optional-locks diff --cached --name-only` must be 0, then one-line pathspec commits per fence:
   docs(agents) for the mirrors, docs(website)/docs for README, docs(desktop-client)+docs(core) for comments.
4. Only THEN decide on extending the checker (R1 sizes it).

## Manager error this wave (self-recorded)
At 02:55Z I read 'dirty=none after ~20+ min' and issued close-out orders to all four workers. schedule-6 was still
`scheduled`, not overdue - so their boxes were NOT expired and I had inferred elapsed time from gap-to-previous-
round rather than from the timer's own state. Retracted within the same round: only the incrementally-write-to-disk
instruction stands, work continues to the real deadline. Cost: one round-trip each; the failure mode to remember is
that a close-out order is destructive when issued early, because workers cut verification to comply.

## Metrics (this wave)
rework 0 · breaker trips 0 · fence renegotiations 0 · premature-order retractions 1 · manager measurement errors in wave 1-3: 5 (all worker-caught)

## NEW adjacent rot found by measurement (NOT in scope - reported, unfixed, no owner assigned)
crates/oz-core/README.md:7 header says '## Public modules (57)' while `grep -cE 'pub mod ' crates/oz-core/src/lib.rs`
= 66 and the file's own table has 68 rows; its dated stamp even claims '67 rows, 0 dead'. So the header, the stamp and
the table disagree with each other AND with the code. Fix is ~2 minutes (set the header to a measured count +
command, leave the stamp text as history). Deferred because the user's instruction enumerated the items and this was
not among them; it is outside every live fence, so it can be added without a collision if they say so.

## Assumptions
- B1: 'do it' covers items 1,2,3,5 of the report; item 4 (the archive move) belongs to another session and is
  PARKED, not deferred work of mine. (checkpoint at gate)
- B2: comment-only code edits are in scope because they change no behaviour; the version lock and no-push rules hold.
- B3: extending verify-agents-mirrors.py is only done if R1 shows it is a single <=15-minute worker; otherwise it is
  reported as scoped follow-up, not half-built## Pre-computed: exact targets of the final mirror edit (so the post-N1 brief is surgical)
- Scope paragraph sits on ONE long line each: AGENTS.md:45, .agents/AGENTS.md:44. Both carry, on that line: