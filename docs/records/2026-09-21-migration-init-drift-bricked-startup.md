# Migration init-script drift bricked startup — 2026-09-21

Scope: an existing database could no longer boot the application. `20260813_init.sql`
was edited in place, so every database built before that edit disagreed with the
registry's checksum, the runner re-applied the whole init script, and its loyalty seed
named a column a later migration had already dropped — an error class the statement-level
fallback did not classify, so it was fatal. Fixed by widening the runner's drift fallback
and by a proof that the seed's rows are already present.

Repo state: branch `0.0.39`. The failure was reproduced at HEAD `199ea748e`; the drift test
landed in `a8b64719e` and the fix in `61d3abdbe` (§3). Every number below was re-verified
against the tree as committed at `33967835a` rather than carried over from an earlier draft.

This record exists because the raw evidence was six throwaway stderr captures at the
repository root (`.t-repro.err`, `.t2.err`, `.t3.err`, `.p1.err`, `.r1.err`, `.r2.err`,
plus their `.log` halves). Those files were deleted on 2026-09-21 as part of a scratch
cleanup; everything they established is below.

---

## 1. SUMMARY

The failure was in the **setup hook**, not in any store operation: the application
panicked while running migrations and could not start.

`20260813_init.sql` was edited in place — ADR #56 §2.6 removed the seeded store,
workspaces and subscription from it — so every database installed before that edit still
holds the *pre-edit* checksum for `20260813_init.sql`. The runner treats a checksum
mismatch as drift and re-applies the script. Re-applying it fails on its loyalty seed:

```
INSERT OR IGNORE INTO loyalty_tiers (id, name, min_points, points_per_unit,
                                     earn_multiplier, colour, sort_order) VALUES …
```

`20260831_loyalty_multiplier_fixedpoint.sql` converts that column to
`earn_multiplier_millionths` and **drops** it (LOYALTY-01, `803f6239`). On a database with
the whole registry applied, the statement can neither run nor be a no-op SQLite reports,
so it raised `table loyalty_tiers has no column named earn_multiplier`.

That message is not a *duplicate-object* error, and the runner's statement-level fallback
was gated on exactly that class — `is_duplicate_object_error`. The whole-script attempt
stopped at the first bad statement, the fallback was never entered, and the error was
reported verbatim and fatally. The observed symptom on a real device was `kasirmu-app` panicking in its setup hook with
`Failed to setup app: … running migrations: … has no column named earn_multiplier`, and
the code shows why it is a panic rather than a reported error: `AppState::new` maps the
runner's failure to `running migrations: {e}` (`apps/desktop-tauri/src/state.rs:230`), and
the Tauri setup hook propagates it with `?` (`apps/desktop-tauri/src/lib.rs:110`).

## 2. EVIDENCE

### 2.1 The captured failure

`.t-repro.err`, a filtered single-test run:

```
thread 'migrations::tests::init_script_re_applies_after_a_later_migration_replaces_its_seed_column' (35448) panicked
  at crates\kasirmu-core\src\migrations_tests.rs:371:9:
re-applying 20260813_init.sql against a fully migrated database failed: database error:
  table loyalty_tiers has no column named earn_multiplier. An existing database must survive
  drift in the init script, not panic in the setup hook.
```

`test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3140 filtered out`

### 2.2 The real-database replay: vacuous as captured, meaningful once forced

Two captures of a temporary probe (`crates/kasirmu-core/tests/tmp_real_db_replay.rs`, which
still sits untracked in the tree, self-labelled "TEMPORARY probe — deleted before commit")
that ran the **shipping** runner against a copy of a real dev database, selected by
`OZPOS_DB_COPY`. The copy was `.tmp-dbcheck/kasir.db` (2.2 MB, mtime 14:25:47, ignored by
`.gitignore:59 *.db`). Both runs printed:

```
REPLAY-OK
test replay_real_db_copy ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

**That is weaker than it reads.** The drift branch is entered only when a stored checksum
differs from the file's current bytes, and read directly out of the archived copy:

```
registry, 20260813_init.sql        e6f3504ed6456dc1dda75eda1b1e18a8cfcf94cdea3b75ca7bca3f2a8e147d66
copy,     schema_migrations row   e6f3504ed6456dc1dda75eda1b1e18a8cfcf94cdea3b75ca7bca3f2a8e147d66
```

The two are **identical**, so the replay ran the no-drift path: `REPLAY-OK` establishes only
that the runner is a no-op against a fully-migrated real database, i.e. that the fix broke
nothing. It does **not** exercise the drift re-apply against real bytes, which was the thing
under repair. The copy also holds 60 `schema_migrations` rows, fewer than the registry, so it
predates at least `20261008_provisioning_legacy_backfill.sql`.

**It was then run twice — control and experiment — from two copies, so the archive itself was
never opened:**

| Run | Stored checksum at start | Migrations applied | `loyalty_tiers` | Stored checksum at end |
| --- | --- | --- | --- | --- |
| as captured | `e6f3504e…` — matches the file | 60 → 61 | 4 → 4 | `e6f3504e…` |
| drift forced | `f86bbbe0…` | 60 → 61 | 4 → 4 | `e6f3504e…` |

The control *is* what the archived `REPLAY-OK` was, and the code shows why that is worth
nothing: the drift branch is `if *stored != current`
(`platform/core/src/database/migrations.rs:91`), and `stored` already equalled `current`, so
`reapply_for_drift` was unreachable and the failing seed statement never executed.

The forced run is the one that reaches it, and it ends with the registry's checksum written
and the four rows intact — the same result the live-database copy gives in the next
paragraph, from an independent snapshot.

Consequently, as first archived, the drift path rested on **construction alone** — the unit
test in §4 rewrites the stored checksum to the pre-ADR-56 value to force it.

**The experiment it was missing has since been run.** A fresh copy of the live dev database
was taken (`%APPDATA%\mu.kasir.app\kasir.db` — the main file *and* its 675,712-byte
write-ahead log, folded in first, since a bare copy of the main file would have silently
dropped those committed transactions), its stored checksum forced back to `f86bbbe0…`, and
the shipping runner run against it — `kasirmu_core::migrations::run`, the same path the
app's setup hook calls:

```
forced drift: stored checksum = f86bbbe00608dbd6f6a3cb40a82ee01be69d730763a51349adad92cffc78c013
before: 60 migrations applied, 4 loyalty tiers
after:  61 migrations applied, 4 loyalty tiers
after:  stored checksum = e6f3504ed6456dc1dda75eda1b1e18a8cfcf94cdea3b75ca7bca3f2a8e147d66
tiers: [("tier-bronze", 1000000), ("tier-gold", 1500000), ("tier-platinum", 2000000), ("tier-silver", 1250000)]
REPLAY-OK (drift exercised)
```

Three things are established, and the third is the one that matters:

- The copy was on the drift path when the run started, asserted rather than assumed: a copy
  whose checksum already matches proves nothing, which is the mistake the earlier replay made.
- 60 → 61 applied migrations is `20261008_provisioning_legacy_backfill.sql`, which this copy
  legitimately lacked.
- The stored checksum came back as the registry's current hash. Only a *completed* drift
  re-apply writes that, so the branch fired — the run was not a silent no-op. This is the
  same property the unit test asserts with "the drift re-apply did not patch the stored
  checksum".

Independently, the failure is real on those bytes and not a fixture artefact: the init
script's seed statement, run verbatim against the same copy, raises
`OperationalError: table loyalty_tiers has no column named earn_multiplier` — the message in
§2.1 — and leaves all four tier rows untouched. The pre-fix counterfactual was later **run**
rather than argued — the runner at `61d3abdbe^` in a throwaway worktree, and this runner on the
same bytes with the seed's rows varied, both recorded in §5 — so no part of this account now
rests on a replay that a shared checkout made too risky to perform.

### 2.3 The control runs

`.p1.err` was `cargo test -p platform-core` (the crate that owns the runner): `384 passed;
0 failed`, plus 4 doctests, 1 ignored. `t2`/`t3` were filtered sweeps that matched **0
tests** in every integration binary, so they prove nothing either way and are recorded here
only to close the set.

### 2.4 Noise, not signal

Every capture except `.p1.err` — which carries nothing but compile progress and doctest
output — has its stderr dominated by `failed to garbage collect finalized incremental
compilation session directory … Access is denied. (os error 5)`: the target directory held
open during a concurrent build. One capture also shows `Blocking waiting for file lock on
build directory`. Neither bears on the failure.

### 2.5 Capture timeline

| Time (2026-09-21) | Artefact | Outcome |
| --- | --- | --- |
| 14:19 | `.t-repro` | **the failure** |
| 14:21, 14:23 | `.t2`, `.t3` | 0 tests matched |
| 14:24 | `.p1` | 384 passed (control) |
| 14:24, 14:25 | `.r1`, `.r2` | `REPLAY-OK` — real DB, but no drift exercised (§2.2) |
| 14:25:47 | `.tmp-dbcheck/kasir.db` | last write of the replay fixture |
| 22:42:42 | all six `.err` files | bulk-restored as one batch |

The `.err` halves were re-materialised at 22:42:42 — the same instant as
`platform/core/src/database/migrations.rs` and the probe — while the `.log` halves kept their
original 14:19–14:26 mtimes. The two halves of each capture are therefore a matched pair
with different times.

## 3. FIX

One file, `platform/core/src/database/migrations.rs`: `61d3abdbe`, +289/−13 (302 changed
lines), 7 new production functions and no tests.

- `is_duplicate_object_error` generalised to **`is_skip_candidate_error`**, which now also
  classifies `has no column named` / `no such column` / `no such table`. Only a classified
  error may enter the statement-by-statement retry; everything else stays fatal, exactly as
  before.
- **`seed_rows_already_present`** proves an `INSERT OR IGNORE … VALUES …` seed is already
  satisfied before its failure may be skipped. Both halves are required: the statement must
  be *unable* to run (some named column absent from `pragma_table_info`, at least one other
  named column present, and the error naming one of the absent columns) **and** its effect
  must be present (the statement names the table's whole primary key, and every `VALUES`
  row's key literals match a row already in the table). `OR IGNORE` is what makes "every row
  is already there" a proof of a no-op rather than a guess.

`already_satisfied` previously handled `ALTER TABLE … ADD COLUMN` and `CREATE
INDEX`/`TRIGGER`/`VIEW` — a table `CREATE` was refused then as now, because SQLite rewrites
a table's stored DDL — and `INSERT` is the new arm.

## 4. VERIFICATION

Against the tree as committed:

- `cargo test -p kasirmu-core --lib migrations::` → **37 passed; 0 failed** (3127 filtered out),
  including `init_script_re_applies_after_a_later_migration_replaces_its_seed_column`, which
  forces the drift by rewriting the stored checksum to the pre-ADR-56 value, and
  `cosmetic_edit_to_any_migration_re_applies_cleanly`, which drives the re-apply across all 61
  registered migrations.
- `cargo test -p platform-core --lib database::migrations` → **32 passed; 0 failed**; the crate
  as a whole, `cargo test -p platform-core --lib` → **397 passed; 0 failed**.
- Module-level only: the other 3127 tests in `kasirmu-core` were filtered out, and no unfiltered
  workspace run has been made.

The `earn_multiplier` failure is **not live**: that drift test passes.

Two checks beyond the suite:

- **Real bytes.** The forced-drift replay of §2.2 has been re-run against fresh copies of the
  same archived bytes after each structural change of §7: 60 → 61 applied, the stored
  checksum restored to the registry's `e6f3504e…`, four tier rows intact.
- **Mutations, to establish what the suite actually holds.** Each weakening below was reverted
  byte-identically afterwards:

  | Weakening | What goes red |
  | --- | --- |
  | the proof skips a seed whose rows are genuinely missing | `a_seed_with_a_missing_row_is_never_skipped` |
  | the classifier loses `has no column named` | `init_script_re_applies_after_a_later_migration_replaces_its_seed_column` |
  | the checksum stops normalising line endings | `checksum_hex_matches_independently_computed_digests`, `migration_checksums_are_stable_across_line_endings` |
  | a failed per-statement attempt commits what already ran | `the_statement_fallback_is_entered_only_for_a_classified_failure` (sole red) |
  | a migration deleted from the registry *and* the filesystem | `no_registered_migration_ever_disappears` |
  | the drift gatekeeper deleted outright | **nothing** — see §5 |

## 5. WHAT THE SUITE HOLDS, AND WHAT IT DOES NOT

The commit that added the drift test (`a8b64719e`) did not take the runner fix, so HEAD then
held a test whose subject it could not satisfy: a clean checkout failed it while this checkout
passed. Re-established at both revisions:

| Check | At `a8b64719e` | At HEAD |
| --- | --- | --- |
| `grep -c is_skip_candidate_error platform/core/src/database/migrations.rs` | `0` — fix absent | `4` |
| `grep -c "has no column named" platform/core/src/database/migrations.rs` | `0` | `2` |
| `grep -c init_script_re_applies crates/kasirmu-core/src/migrations_tests.rs` | `1` — test present | `1` |

The pre-fix classifier that let the failure through is on record at `61d3abdbe^`:
`is_duplicate_object_error` matched exactly `already exists` and `duplicate column name`.

What is held now:

- **The proof's refusal paths, directly.** `statements_tests.rs` carries 13 tests, 11 written
  for this campaign, every negative asserted beside the control showing the same statement
  *is* provable when the proof's conditions hold — including
  `a_seed_with_a_missing_row_is_never_skipped`, the property that most needed pinning. The
  proof's internals are exercised *through* `already_satisfied`; no test names them, which is
  the point of a proof whose contract is the answer alone.
- **The stored digest, against independent literals.** A NIST vector and a migration-shaped
  script pinned to digests computed outside the crate, with that script's CRLF spelling pinned
  to the same literal. Every other checksum assertion in the runner compares `checksum_hex`
  with a value `checksum_hex` itself wrote, so this is the only test that would notice a change
  to *how* it hashes — the property drift detection rests on entirely.
- **Registry membership, absolutely.** All 61 registered ids are pinned as a subset check, so
  adding a migration needs no edit while deleting one fails by name.
  `migration_registry_matches_filesystem` cannot serve this: it asserts file↔registry parity and
  equal counts, which a same-id removal from both sides satisfies.
- **The retry boundary, partly.** Which failures earn the statement-by-statement attempt is
  decided by the classifier, and nothing pins that ordering: **deleting the gatekeeper reddens
  nothing**. It is a redundant guard rather than a live defect, because every arm of
  `already_satisfied` requires an error text the classifier already recognises — `duplicate
  column name` for ADD COLUMN, `already exists` for CREATE, and for the seed arm a message
  naming an absent column — so the fallback cannot excuse an unrecognised failure even when
  entered. What the pin does hold is the observable part: an unrecognised failure is fatal,
  reported verbatim, records no new checksum and commits nothing; a recognised one reaches a
  later statement only by proving the earlier one satisfied, and rolls back entirely on failure.

**Remaining open limits**

- **Closed — the failed drift re-apply is now proven on real bytes, and with it the pre-fix
  counterfactual.** The runner at `61d3abdbe^` was built in a throwaway worktree (the shared
  checkout was never modified) and run against a copy of the archived capture whose stored init
  checksum had been forced back to the pre-ADR-56 value. It returned `platform error: database
  error: table loyalty_tiers has no column named earn_multiplier`; its own instrumentation names
  the statement the batch died on — the init script's seed `INSERT OR IGNORE INTO loyalty_tiers
  (… earn_multiplier …)`, a column a later migration drops — and shows the classifier matching
  neither `already exists` nor `duplicate column name`, so the statement-by-statement attempt was
  never entered. The copy kept its 60 applied rows and the drifted checksum, so every boot would
  have failed identically.
- **Closed — and this runner also fails the re-apply on real bytes, when the seed is genuinely
  gone.** Same copies, seed rows varied, checksum forced back to the pre-ADR-56 value: all four
  rows present → `Ok`, the 61st migration recorded, the registry's checksum restored. One row
  deleted (`tier-gold`) → **refused**, the same error surfaced, the checksum still drifted and the
  ledger still at 60. All four deleted → refused identically. So the fix does not paper over a
  database whose seed is genuinely absent: it still refuses to boot, and the refusal commits
  nothing. A *non-key* value changed on a row that is still present → `Ok` with the changed value
  left exactly as found, which is the `OR IGNORE` no-op the proof claims to have proven — the
  presence half matches the seed's primary key, so a differing column is not drift to repair. This
  bullet supersedes §2.2's "not a second end-to-end run" clause.
- **The second production caller is untested.** `apps/cloud-server/src/db.rs:134,143` calls the
  runner too and has never seen drifted bytes.
- **Closed — the app's own startup function ran, on both copies.** A throwaway example binary
  built the app from a mock context whose *identifier* was the probe's own, so `AppState::new`'s
  own `resolve_db_path` resolved into `…/mu.kasir.app.migration-drift-probe` and the installed
  app's data directory was never opened; the mapping under test was the app's, not a probe's
  composition. With the drift forced and the four tier rows intact, `AppState::new` returned
  `Ok`, leaving the ledger at 61, the registry's checksum, and `journal_mode=wal` persisted in
  the file header — the app's own `PRAGMA journal_mode=WAL`, three lines above the mapping,
  having run on that connection. With the tier rows gone it returned the app's own
  `AppError::Internal("running migrations: platform error: database error: table loyalty_tiers has
  no column named earn_multiplier")`, displayed as `internal error: running migrations: …`, and
  committed nothing: ledger still 60, checksum still drifted. Still unobserved, and unneeded for
  this question: window creation, plugin registration and the event loop — the setup closure's
  `?` turns the `Err` into Tauri's panic, which is Tauri's code, not the app's. `foreign_keys=ON`
  is per-connection and cannot be read off the file afterwards; it sits two lines above that same
  pragma, in the same function. Reproducing this needs `lib.rs`'s `.drectve` Common-Controls
  directive, which bin and `#[cfg(test)]` targets get but example targets do not — without it the
  probe exe dies with `STATUS_ENTRYPOINT_NOT_FOUND` before any of this runs.
- **The snapshot carries no data** — 0 sales rows — so this exercises schema drift, not
  data-bearing tables.
- **A classifier observation, not a finding.** `no such table` admits a class a
  dropped-and-replaced table shares with a genuinely absent one; the proof refuses to skip
  either, so the arm is worth a look for `CREATE`/`ALTER` statements rather than known-broken.

## 6. WHAT THIS RECORD DOES NOT COVER

- **Authorship.** This record was written by a session that did not author the runner fix. The
  fix was later committed from this side of the campaign, under one git identity, so the commit
  metadata cannot separate the two.
- The scratch artefacts beside the captures were not this lane's. `.tmp-re2.cjs`/`.tmp-re3.cjs`
  were deleted as trivially regenerable; `.tmp-android-audit/` and `.tmp-dbcheck/kasir.db` were
  **left in place** — the former's evidence is not in `docs/records/2026-09-20-audit-android-shell.md`,
  the latter is another lane's fixture, still byte-unchanged (2,207,744 bytes, mtime
  2026-09-21 14:25:47) and the row that makes §2.2 readable.
- `crates/kasirmu-core/tests/tmp_real_db_replay.rs` is still untracked in the tree, its own
  header claiming it is deleted before commit.

## 7. STRUCTURE AFTER THE ARCHITECTURE PASS

The proof had been written into a 2,257-line runner that also held the ledger, the checksums,
the drift policy *and* its own 894-line test module, with no boundary inside it. It now stands
in four files:

| File | Owns | Lines |
| --- | --- | --- |
| `platform/core/src/database/statements.rs` | Reading SQL: splitting a script into statements, tokens and canonical forms, the parsers, the significance predicate, the already-satisfied proof | 955 |
| `platform/core/src/database/statements_tests.rs` | That layer's tests, including the refusal paths | 263 |
| `platform/core/src/database/migrations.rs` | The ledger and the policy: registry, checksums, the drift decision, orchestration | 554 (550 code, 3-line test wiring) |
| `platform/core/src/database/migrations_tests.rs` | The runner's 32 tests, moved out of the production file | 905 |

Dependencies run one way — `migrations` → `statements`, `mod statements` private. Three calls
cross the boundary and all three are semantic: `split_statements`, `is_significant` (does this
fragment have any effect?) and `already_satisfied`. `canonical_ddl` appears zero times in the
runner, which used to call it for exactly that decision. Nothing there inspects a token, and
nothing in the statement layer knows a `Migration`, a `schema_migrations` row or a checksum.

One interface change came with the extraction: the proof takes SQLite's error **message**
(`&str`) rather than a `rusqlite::Error`. That it narrowed nothing was verified rather than
assumed — the old body's only use of the error was `error.to_string()`, every decision reading
that string — and the text is load-bearing: handing the proof a *different* string at the call
site reddens two end-to-end tests.

Behaviour was checked, not assumed: `platform-core` lib **397 passed** and `kasirmu-core --lib
migrations::` **37 passed**, with the forced-drift replay of §2.2 unchanged after the move.
