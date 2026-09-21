# Migration init-script drift bricked startup — 2026-09-21

Scope: an existing database could no longer boot the application. `20260813_init.sql`
was edited in place, so every database built before that edit disagreed with the
registry's checksum, the runner re-applied the whole init script, and its loyalty seed
named a column a later migration had already dropped — an error class the statement-level
fallback did not classify, so it was fatal. Fixed by widening the runner's drift fallback
and by a proof that the seed's rows are already present.

Repo state at write time: branch `0.0.39`, HEAD `199ea748e` (the drift test itself landed
in `a8b64719e`). The runner fix is **still uncommitted** — see §5.

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
reported verbatim and fatally. Per the fix's own test doc comment, the observed symptom on
a real device was `kasirmu-app` panicking in its setup hook with
`Failed to setup app: … running migrations: … has no column named earn_multiplier`.

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

### 2.2 The real-database replay — measured, and it does not prove what it looks like

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

**That is weaker than it reads, and the claim was checked rather than assumed.** The drift
branch is entered only when a database's stored checksum for an applied migration differs
from the file's current bytes. Read directly out of the archived copy:

```
registry, 20260813_init.sql        e6f3504ed6456dc1dda75eda1b1e18a8cfcf94cdea3b75ca7bca3f2a8e147d66
copy,     schema_migrations row   e6f3504ed6456dc1dda75eda1b1e18a8cfcf94cdea3b75ca7bca3f2a8e147d66
```

The two are **identical**, so the replay ran the no-drift path: `REPLAY-OK` establishes only
that the runner is a no-op against a fully-migrated real database, i.e. that the fix broke
nothing. It does **not** exercise the drift re-apply against real bytes, which was the thing
under repair. The copy also holds 60 `schema_migrations` rows, fewer than the registry, so it
predates at least `20261008_provisioning_legacy_backfill.sql`.

Consequently, as first archived, the drift path rested on **construction alone** — the unit
test in §4 rewrites the stored checksum to the pre-ADR-56 value to force it.

**The experiment it was missing has since been run.** Immediately after the fix landed as
`61d3abdbe`, a fresh copy was taken of the live dev database
(`%APPDATA%\mu.kasir.app\kasir.db` — the main file *and* its 675,712-byte write-ahead log,
folding the WAL in first: a bare copy of the main file alone would have silently dropped
those committed transactions), the copy's stored checksum forced back to `f86bbbe0…`, and
the shipping runner (`kasirmu_core::migrations::run`, the same path the app's setup hook
calls) run against it:

```
forced drift: stored checksum = f86bbbe00608dbd6f6a3cb40a82ee01be69d730763a51349adad92cffc78c013
before: 60 migrations applied, 4 loyalty tiers
after:  61 migrations applied, 4 loyalty tiers
after:  stored checksum = e6f3504ed6456dc1dda75eda1b1e18a8cfcf94cdea3b75ca7bca3f2a8e147d66
tiers: [("tier-bronze", 1000000), ("tier-gold", 1500000), ("tier-platinum", 2000000), ("tier-silver", 1250000)]
REPLAY-OK (drift exercised)
```

Three things are established, and the third is the one that matters:

- The copy was on the drift path when the run started — asserted, not assumed, because a
  copy whose checksum already matches proves nothing. That is exactly the mistake behind the
  earlier replay being read as validation.
- 60 → 61 applied migrations is `20261008_provisioning_legacy_backfill.sql`, which this copy
  legitimately lacked.
- The stored checksum came back as the registry's current hash. Only a *completed* drift
  re-apply writes that, so the branch fired — the run was not a silent no-op. This is the
  same property the unit test asserts with "the drift re-apply did not patch the stored
  checksum".

Independently, the failure is real on those bytes and not a fixture artefact: running the
init script's seed statement verbatim against the same copy raises
`OperationalError: table loyalty_tiers has no column named earn_multiplier` — the exact
message in §2.1 — while leaving all four tier rows untouched. The counterfactual for the
pre-fix *runner* is the one recorded in §5 (the classifier as it stood at `61d3abdbe^`
matched only `already exists` / `duplicate column name`), not a second end-to-end run: doing
that would have meant reverting a committed file in a shared checkout.

### 2.3 The control runs

`.p1.err` was `cargo test -p platform-core` (the crate that owns the runner): `384 passed;
0 failed`, plus 4 doctests, 1 ignored. `t2`/`t3` were filtered sweeps that matched **0
tests** in every integration binary, so they prove nothing either way and are recorded here
only to close the set.

### 2.4 Noise, not signal

Every capture except `.p1.err` — which carries nothing but compile progress and doctest
output — has its stderr dominated by:

```
warning: failed to garbage collect finalized incremental compilation session directory
  `\\?\C:\dev\ozpos\target\debug\incremental\…`: Access is denied. (os error 5)
```

That is the target directory being held open during a concurrent build, and one capture also
shows `Blocking waiting for file lock on build directory`. Neither has any bearing on the
failure.

### 2.5 Capture timeline

| Time (2026-09-21) | Artefact | Outcome |
| --- | --- | --- |
| 14:19 | `.t-repro` | **the failure** |
| 14:21, 14:23 | `.t2`, `.t3` | 0 tests matched |
| 14:24 | `.p1` | 384 passed (control) |
| 14:24, 14:25 | `.r1`, `.r2` | `REPLAY-OK` — real DB, but no drift exercised (§2.2) |
| 14:25:47 | `.tmp-dbcheck/kasir.db` | last write of the replay fixture |
| 22:42:42 | all six `.err` files | bulk-restored as one batch |

The `.err` halves were re-written at 22:42:42 — the same instant as
`platform/core/src/database/migrations.rs` and the probe — so the archived stderr is a copy
re-materialised hours after the run that produced it, while the `.log` halves retain their
original 14:19–14:26 mtimes. The run logs and the stderr they describe are therefore a
matched pair with different mtimes.

## 3. FIX

Uncommitted working-tree change in `platform/core/src/database/migrations.rs` (+302 lines,
still ` M` at time of writing):

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

`already_satisfied` previously knew only about `CREATE TABLE`/`CREATE INDEX`; `INSERT` is
the new arm.

## 4. VERIFICATION

- `cargo test -p kasirmu-core --lib migrations::` → **36 passed; 0 failed**, including
  `init_script_re_applies_after_a_later_migration_replaces_its_seed_column`.
- `cargo test -p platform-core --lib database::migrations` → **32 passed; 0 failed**.
- Module-level only: the remaining ~3123 tests in `kasirmu-core` were filtered out, and no
  unfiltered workspace run was made.
- The drift path **now has** real-database evidence — see §2.2. The forced-drift replay
  against a copy of the live dev database returned `REPLAY-OK`, patched the stored checksum
  to the registry's hash and left the four seed rows intact.

The `earn_multiplier` failure is **not live** in this working tree. It was reproduced above
only from an archived capture.

## 5. THE OPEN RISK, AND HOW IT CLOSED

The commit that added the drift test (`a8b64719e`) did **not** take the runner fix, which
stayed uncommitted. HEAD therefore contained a test whose subject it could not satisfy:

| Check | Result |
| --- | --- |
| `git show HEAD:platform/core/src/database/migrations.rs \| grep -c is_skip_candidate_error` | `0` — fix absent |
| `git show HEAD:…/migrations.rs \| grep -c "has no column named"` | `0` — only `is_duplicate_object_error` at `:470` |
| `git show HEAD:…/migrations_tests.rs \| grep -c init_script_re_applies…` | `1` — test present |

A clean checkout of HEAD failed that test; it passed only in a checkout carrying the
uncommitted runner change.

**Resolved the same evening.** The fix landed on its own as `61d3abdbe`
(`platform/core/src/database/migrations.rs`, +289/−13, its own pathspec commit, no other
file). The same three greps now read **4 / 2 / 1** where the table above shows 0 / 0 / 1 —
they count occurrences, so the first two are the ones that moved, from absent to present.
Verified at that commit:
`cargo test -p kasirmu-core --lib migrations::` → 36 passed, and
`cargo test -p platform-core --lib database::migrations` → 32 passed —
`init_script_re_applies_after_a_later_migration_replaces_its_seed_column` among them, which
it could not have passed before.

Two things about that commit are worth keeping in view:

- **It is fix-only and adds no tests.** Its seven new functions are all production code; the
  drift tests were already on HEAD, which is exactly why HEAD was red.
- **The proof code has no direct unit coverage.** The inline `mod tests` at
  `platform/core/src/database/migrations.rs:1425` (predating the sibling-file rule, as
  `manager.rs:429` acknowledges) never names `seed_rows_already_present`, `split_top_level`,
  `paren_group`, `primary_key_columns` or `seed_literal`. Its only exercise is the single
  `kasirmu-core` integration test, from one direction, on one seed shape. The property that
  most needs pinning — that the proof must **refuse** to skip a seed whose rows are missing —
  has no test at all.

An observation, not a verified finding: widening the classifier to `no such table` admits a
class that a dropped-and-replaced table shares with a genuinely absent one. The
`seed_rows_already_present` proof is what keeps that safe for seeds, but the arm is worth a
look for `CREATE`/`ALTER` statements.

## 6. WHAT THIS RECORD DOES NOT COVER

- The full working tree is not clean: `apps/mobile-tauri/src/commands/staff.rs` and the
  runner itself are still modified, and the drift fix is uncommitted (§5).
- The four unrelated root scratch artefacts found beside these captures were handled as
  follows, none of them being this lane's work. `.tmp-re2.cjs` and `.tmp-re3.cjs` (regex
  probes against `ui/src/features/auth/StaffLoginScreen.tsx`, another lane) were **deleted**
  as trivially regenerable. `.tmp-android-audit/` (PNG pixel statistics and a `dumpsys`
  wakefulness log for the android-shell audit) and `.tmp-dbcheck/kasir.db` (the replay
  fixture in §2.2) were **left in place**, because the android evidence is not captured in
  `docs/records/2026-09-20-audit-android-shell.md` and the database copy is the other lane's
  fixture. A read-only query against that copy left a zero-byte `kasir.db-wal` and a
  `kasir.db-shm` behind; both were removed and the copy is byte-unchanged.
- `crates/kasirmu-core/tests/tmp_real_db_replay.rs` is still in the tree, despite its own
  header claiming it is deleted before commit. It was left in place for the lane that still
  needs it while the runner fix is uncommitted.
- This record was written by a session that neither authored nor committed the runner fix.
  The raw stderr captures it replaces are gone; the measurements above were taken from the
  working tree and from the archived database copy before deletion.
