# Engineering Journal - part 7 of 8

**Pre-split lines 10169-12153** of JOURNAL.md (13,433 lines, 1,338 KB). Split 2026-10-02 so each part is readable whole under AGENTS.md E4 (2,000-line cap). Content is byte-identical and in original order; the single exception is the first heading of this part, promoted from ### to ## where a cut landed mid-section.

The parent index, carrying the full line-to-part map, is [JOURNAL.md](JOURNAL.md).

---

## 2026-08-31 — round T: repairing the four discoveries, one by one

The previous round's "notable discoveries" became this round's work order:
repair carefully, one by one. Outcome: two needed code (the REST surface,
the .env hardening), one was a sweep that came back clean, and one had
already been fixed upstream by the foreign owner mid-round — verified, not
blindly trusted.

**1. Rate REST gap (the big one).** The exchange-rate commands were IPC +
dev-mock only — `crates/oz-api` had no rate endpoints at all, so web
deployments could not read or manage rates. Built the full surface mirroring
the five scoped IPC commands 1:1 (`5b0f1662`), dual-path like tax_rates: PG
helpers in `pg.rs` or SQLite fallback via `CurrencyRepository`. Two parity
lessons: (a) the repo surfaces UNIQUE violations as a raw Db error, so the
fallback needs an explicit duplicate pre-check to match the PG path's 409 —
check+insert share the store lock, so it is race-free; (b) my hand-rolled
strict YYYY-MM-DD byte check REJECTED `2026-8-1` while the command layer's
chrono `%Y-%m-%d` accepts it — the validator must be the same parser, not an
equivalent one, or the slice reintroduces exactly the drift it exists to
close (`9cd8c6bb`). The e2e suite then taught a third thing: Playwright runs
`api.spec.ts` under BOTH browser projects in parallel against ONE server,
and rates are global reference data — the second worker's identical create
409ed. Workers now isolate by effective date and the latest-per-pair
assertions test the contract (one row per pair, never older than mine)
instead of assuming exclusivity. 20/20 green, live-PG roundtrip included.

**2. UUID-vs-rowid sweep — clean.** Every other `ORDER BY … id` recency
pattern checked: `audit_log` and `offline_queue` ids are UUID v7
(time-ordered), so their `id` tails are sound; `prune.rs` and the
line-item listings order by id for STABILITY, not recency. `exchange_rates`
was the only genuine trap (mixed id lineage possible in real stores) and it
already pins `rowid`. No change.

**3. .env poison — hardened.** The six note-lines that killed compose are
commented; the root .env now parses (two full e2e runs prove it). Added
`scripts/validate-env.mjs` — a quote-state-aware dotenv validator (the real
file carries a multi-line PEM value; a naive line checker false-positives on
it) wired as a pre-flight in `run-e2e.mjs`, so the next poisoned line fails
fast with every offender numbered instead of dying inside compose with one
terse message.

**4. Foreign breakage — resolved upstream, verified here.** The unused
`total` in tablet `pos.rs` (from 192c5bc6) and the nine PaymentModal suite
failures were both fixed by the PROMO-3 owner's own follow-up commit
`100dcdef` while this round was in flight. Verification, not assumption:
fresh `cargo check` on the touched file → zero warnings; `cargo clippy -p
oz-pos-tablet -p oz-api --all-targets` → clean (the pre-push gate this
discovery threatened); payment family (PaymentModal, EdgeCases, SaleFlow,
StockShortfallDialog, GiftCardPayment) → 99/99 green, including the nine
that were red at baseline. The lesson the discovery taught stands anyway —
foreign half-finished commits can carry the tree red for hours — but the
right repair for someone else's in-flight work is verification at the gate,
not a competing fix.

**Incident worth recording: uncommitted work evaporates in this tree.**
Mid-repair, `pg.rs` reverted to its pre-edit size under a foreign git
operation — my ~250-line section was gone because it was uncommitted while
other agents committed around it (HEAD moved twice in minutes). The fix is
procedural: commit verified slices immediately, pathspec-style, instead of
batching. Also confirmed: the shared tree has a live rustfmt watcher that
touches files between read and edit (stale-stamp errors) — batch read+edit
tight, or let pwsh do the replacement.

Correction to the check-watch note above, learned the hard way two rounds later.

The cargo invocation MUST be capped generously - 1200 seconds - and not at a
value that looks reasonable. A first cap of 240s killed two consecutive
legitimate builds, which measured 290s and 445s, and each kill produced a log
round reading "errors=0 warnings=0 / FAILING CRATES: none" for a check that
never finished. That is a monitor reporting clean because it gave up.

Full-workspace cold builds in this repo land between roughly 240 and 450
seconds depending on what other agents have invalidated, so any cap inside that
band is a coin flip. Warm-cache checks are 1-3 seconds; the range is enormous.

The rule that actually fixes it is not the number: a skipped round must print
NO verdict line at all. The status probe treats a missing FAILING CRATES line
as UNKNOWN, so a skip can never be misread as a pass, whatever the cap is.


## 2026-08-31 — round U: /tdd on the money area — five real bugs, one honest stop

The foundation `money.rs` came back exemplary (deep-audit stamp, 966 lines
of tests + proptests) — the weaknesses were at the EDGES of the money area:
the UI conversion path, the UI input parsers, one daemon cast, and two
hardcoded scales. All found the TDD way: counterexample first, then fix.

**MONEY-01 (`79247c92`)** — the PaymentModal converted tender amounts
through binary floats. A brute-force search (float path vs exact BigInt
path over a rate/amount grid) produced instant counterexamples: 0.03 USD
@ 149.5 → 448 where exact decimal half-up is 449. Every product landing
on the .5 minor boundary mis-rounds, because the decimal .5 is
representable but the binary approximation of the operands sits below it.
Fix: `convertMinorUnits` — whole computation in BigInt, half-up toward
+Infinity, `inverse` flag for reciprocal pairs. The tender snapshot's
`tenderRateMillionths` also stopped round-tripping through a float.

**MONEY-02 (`89589dae`)** — same class at the INPUT boundary: six sites
across four screens parsed free-text money with
`Math.round(parseFloat(s) * 10**exp)`. "1.005" → 100 cents (should be
101); "1e3" → 1000; "1,500" → 1. `parseMinorUnits` (strict decimal regex,
BigInt scaling, null on garbage) replaced every site. The staff-pay field
previously stored NaN when the field held junk — now garbage means absent.

**MONEY-03 (`6736fb02`)** — the rate-sync daemon trusted a comment
("legitimate FX rates are bounded") over its input: `(rate * 1e6).round()
as i64` on untrusted network JSON, and Rust's `as` cast SATURATES — a
1e300 response becomes i64::MAX, which passes the repo's `> 0` validation
and persists. `rate_to_millionths` now bounds the domain before the cast.

**MONEY-04/05 (`46fd1ab0`)** — the nastiest pair, found by reading the
scale the parser used against the currency it served: the Rp discount tab
and the shift-balance handlers hardcoded ×100 while the default store
currency is IDR (exponent 0). For IDR the discount ratio inflated 100× and
`setDiscount` clamps to 100 — entering Rp 2,000 on a Rp 100,000 cart made
the sale FREE. The shift balances stored drawer counts 100× inflated,
poisoning `expected_cash` reconciliation. The existing shift test had
PINNED the bug (`100000 → 10000000`) — a reminder that green tests can
certify wrong behavior when they were written against the implementation
instead of the contract.

**Stopping point.** One residual recorded rather than fixed: LOYALTY-01 —
points computed through an f64 multiplier stored as REAL. The original
counterexample here (base 250 × 1.4 → 3) was WRONG — an exhaustive
double-vs-decimal scan showed that product snaps back to exactly 3.5
(ties-to-even saves it); the real flips start at base 2250: a $22.50 sale
at points_per_unit=1 with a 1.4× tier gives 31 points where exact decimal
gives 32 — 585 flip bases ≤ 2M, always downward for 1.4, while
1.1/1.2/1.3/1.5/1.75/2.0 never flip in that range. The corruption happens
at WRITE time (UI sends a JS number, the column is REAL), so no
compute-site patch can recover the owner's intent; the honest fix is
fixed-point millionths (the repo's own `rate_millionths` precedent) — a
schema decision, deferred. Foundation money: exemplary. UI money paths:
now exact at every boundary I could produce a counterexample for. That's
the "no more problems" bar — with one documented exception that needs a
product call. (And one lesson: the scan corrected MY registry entry too —
evidence over assertion applies to findings I wrote myself.)

**Process notes.** (1) The ExchangeRateScreen suite was 9-red at HEAD
before this round — CUR-06/8c21abeb moved the screen to always-scoped and
the legacy tests kept stubbing removed wrappers (`5474aac7` rewired them).
(2) I popped a FOREIGN stash by accident when a `git stash push` aborted on
an untracked pathspec and the paired `pop` consumed the pre-existing top of
stack — the shared tree's stash stack is everyone's. Recovery was clean
(restore the conflicted file to HEAD; the foreign entry was never dropped),
but the rule is now: in this repo, never `git stash pop` blind; check
`git stash list` first, or avoid stash entirely (file-copy swaps work
fine). (3) `index.lock` collisions from foreign git processes are routine;
a failed `git checkout` mid-swap silently left the "baseline" run on my
version — verify the swap actually happened before trusting a baseline.

**Addendum (same round): the stale-test sweep widened.** A full-suite run
after the money commits found 7 red files. A clean pre-batch worktree
(`git worktree add` + node_modules junction — no stash, no risk) attributed
them: 6 were red at HEAD BEFORE this round (the scoped-IPC audit `5e0d4caa`
and REP-06 shipped with test updates left behind), 2 topology files were a
foreign agent's uncommitted WIP (green at clean HEAD — left alone), and 2
were MY drift: the ERR-10 compliance whitelist pinned PaymentModal line
numbers, which MONEY-01/02 shifted. Fixed all six stale assertions
(`0ffdd2c3`) — RefundModal's wire object also dropped `userId` (the session
token now resolves the user server-side), VoidOrders' scoped call is
positional, StatusBar's offline mock missed the scoped export, and the
Analytics category fixture omitted the REP-06 row currency — which crashed
`Intl.NumberFormat` in `fmtIn`, a real money-display class worth knowing.
The compliance whitelist is now content-anchored (anchor + discriminating
context line) with a per-entry sanity check, so line drift can never again
silently widen an error-handling hole. Worktree cleanup note: `git worktree
remove` failed on the junction'd dir ("Invalid argument") — remove the
junction with `cmd /c rmdir` FIRST, then the dir, then `git worktree prune`.

## check-watch round 30: oz-hal test code is red and NOT a mid-edit transient

Round 30 (00:43:20) - FAILING CRATES: oz-hal, exit=101:

    crates/oz-hal/src/drivers/bt_printer_tests.rs:34:27: error[E0599]:
      no method named `type_name` found for struct `TypeId` in the current scope
    (same at :35)

Only the lib TEST fails; the library itself compiles. The test reads

    assert_eq!(
        ser.device_info().type_name(),
        bt.device_info().type_name(),
        "the two helpers must not produce different device classes"
    );

so device_info() returns a TypeId, and TypeId has no type_name() - that method
belongs to `dyn Any`, not to TypeId, and on stable a TypeId cannot produce a
name at runtime at all.

Fix is to compare the ids directly, since TypeId is PartialEq + Debug:

    assert_eq!(
        ser.device_info(),
        bt.device_info(),
        "the two helpers must not produce different device classes"
    );

If the readable name is actually wanted for the assertion message, that needs
the concrete type at the call site - std::any::type_name::<DeviceInfo>() - not
something derived from the TypeId.

Checked twice (00:43 and 00:47): identical errors, file unchanged. Unlike the
three transients today (the dropped format!, the mod edc deletion, the
CoreError::Validation shape) nobody is actively fixing this one, so it will
still be red on the next round.

## 2026-08-31 — round V: LOYALTY-01 — the multiplier migration ($22.50 → 32 points)

The money TDD round ended with one honest residual: the loyalty tier
multiplier lived as `REAL`/`DOUBLE PRECISION` and the points formula ran
through f64. The user picked the real fix — fixed-point millionths,
end to end. Two commits: `803f6239` (core + SQL), `02b264cd` (UI).

**What the scan taught.** My own recorded counterexample was wrong: base
250 × 1.4 does NOT flip — the product lands exactly on the tie and
round-half-to-even snaps it back to 3.5. The real flips start at base
2250 ($22.50 at 1 point/dollar, 1.4× tier → 31.5 → float 31.499999999999996
→ 31 points, exact decimal 32). 585 flip bases ≤ 2M, all downward for
1.4. And the reason it stayed hidden for so long: the four seeded tiers
(1.0/1.25/1.5/2.0) are all binary-exact — only custom multipliers like
1.4 or 1.35 can corrupt. Writing the explanation forced the verification
that corrected the record — evidence over assertion applies to findings
you wrote yourself.

**The migration.** `20260831_loyalty_multiplier_fixedpoint.sql`: drop the
validation triggers → ADD COLUMN `earn_multiplier_millionths` INTEGER →
backfill `CAST(ROUND(old × 1e6) AS INTEGER)` (recovers the intended
decimal for every ≤6-digit multiplier — the f64 error is far below half a
millionth) → DROP COLUMN → recreate triggers. Deliberately NOT a table
rebuild: the `loyalty_accounts.tier_id` FK stays undisturbed, and the
runner applies each file once inside a transaction. Postgres intentionally
untouched — the cloud server has no loyalty code path (verified: zero
references outside the dormant generated table), and `init.pg.sql` is a
generated artifact; hand-editing it would be undone by the next
regeneration, exactly like the drift every incremental migration has left
since 20260813.

**The compute.** `compute_points(base, millionths)`: i128 numerator,
floor-divide, half-up toward +∞ — the house convention shared with
refunds.rs (CRM-06). Saturates at i64::MAX instead of wrapping; negative
inputs (unreachable in practice) follow the same uniform rule. The old
comment claimed f64 was needed "to preserve fractional cents" — the
millionths form preserves them exactly.

**The UI.** Wire field `earn_multiplier_millionths`; the tier editor
parses with `parseMinorUnits(x, 6)` (built for MONEY-02 — it slotted
straight in) and displays with the new `millionthsToDecimalString`
(integer-only: 1_400_000 → "1.4", never String(f64) artifacts). Red-first
tests: prefill shows exactly "1.25" (raw `.value` — `toHaveValue` coerces
number inputs to JS numbers and would hide artifacts), typing "1.4" sends
1_400_000, zero is rejected without a request. One test had to be
rewritten after jsdom taught me that "1e3" is VALID text in a
type=number field (it arrives sanitized) — the parser-level rejection
stays pinned at the unit level instead.

**Verification.** 53 loyalty + 21 migrations lib tests, 20 integration,
40 module tests, 26 screen + 57 loyalty-family UI tests — all green;
targeted cargo check clean on all four crates; typecheck + lint clean.
Full `cargo test -p oz-core` then surfaced 7 red `db::profile` tests —
NOT mine (proven by temporarily removing my migration from the registry
and reproducing identically). Root cause: rbac F-1 (`ea826188`) gave
`create_user` its own `unchecked_transaction`, but `create_user_with_profile`
already wraps it in a profile tx → nested BEGIN → every staff creation
with a profile was broken on both clients. Fixed as `3cb756db` with the
`finalize_sale_in_tx` precedent (thin wrapper + `create_user_in_tx` body);
profile 25/25, staff 65/65 + 25/25, whole crate green.

**Process notes.** (1) Foreign commits interleaved mid-round (a topology
test fix, two loyalty README docs commits, a docs publish) — pathspec
commits absorbed it all without a single conflict; my slice-1 hash moved
two slots down the log and I re-read it instead of assuming HEAD~1.
(2) pwsh mangles `\"` inside git -m strings — use single-quoted messages
with no embedded double quotes.
(3) Attribution experiment beats blame-guessing: 90 seconds of
temporarily disabling my migration settled "did I break profile?" that
reading code alone could not.

---

## Round W — 2026-08-31 · DSH — PG drift guard, and the bug it caught on day one

Follow-up to the money/loyalty rounds: the user asked for good-practice
hardening, we agreed items 2 (PG drift guard) + 3 (migration column-type
lint) + a half-page roles doc. Item 3 landed first (lint script +
pre-commit gate + CI job). Item 2 exploded on contact with reality:

**The committed `init.pg.sql` was a hand-port.** The old generator text-
ported only the frozen `init.sql`; the committed PG file carried
hand-ported incrementals, PG-only columns, and — the kicker — silent
fixes to SQLite bugs. Neither direction reproduced the other. So the
"guard" became a generator rewrite: apply the full registry chain to
in-memory SQLite, dump FINAL state from `sqlite_master` (ADD/DROP COLUMN,
renames, rebuilds all reflected by construction), emit seeds from row
data with a now-freshness rule for timestamp determinism, topo-sort
tables for PG's forward-FK rejection, strict trigger-port parity, curated
RLS list with staleness validation. `--check` renders twice (determinism
self-proof) and diffs against the committed file; wired as pre-commit
gate 6 + CI `pg-schema-drift`.

**The faithful schema immediately failed a PG test**
(`pg_integration_tenant_sku_isolation`) — exposing SCHEMA-01: the
revert-era init.sql carries inline global `UNIQUE` on `products.sku` /
`users.username` that dominates the composite per-tenant uniqueness
`20260815` documents; cross-tenant SKU collisions and sync-upsert
failures were live bugs. The old PG file had been hand-fixing it. Fixed
with a rebuild migration (`6f47c964`): products/users rebuilt without
the inline UNIQUE, four child FKs retargeted to composite
`(tenant_id, sku)`, `product_activity.tenant_id` made real. The trick
that made it possible: `PRAGMA defer_foreign_keys` — unlike
`foreign_keys`, it IS settable inside the runner's transaction, so each
parent DROP+RENAME sails through its 10 inbound FKs and the deferred
check passes at COMMIT.

Also caught: the auto-derived RLS list would have broken `sale_lines`
writes (has `tenant_id`, but the REST insert never populates it) —
reverted to a curated list the generator validates both ways; and
`product_activity`'s RLS entry had been riding a PG-only column that
never existed in SQLite.

Verification: clean + idempotent apply on real PG 15, oz-api pg 9/9,
cloud-server pg 35/35 (serial — the parallel flake is pre-existing
shared-container deadlock), oz-core 2380/2380, lint green with the stale
loyalty exemption auto-flagged (stale discipline working as designed).
Commits: `6f47c964` (fix(core) rebuild), `16aa2dc8` (ci(pg) generator +
guards), docs round (roles doc + AGENTS.md 6-gate update + registry
SCHEMA-01/PG-DRIFT-01 CLOSED).

Process notes:
(1) A "1-hour CI job" estimate was wrong by 10× because the premise
    (generator reproduces the file) was false — verify reproducibility
    before scoping a guard.
(2) Real PostgreSQL is the only honest validator: python sqlite3 probes
    passed everything the generator emitted until psql ran it (FK
    ordering, unique-index timing, RLS write paths). reset-dev-pg + the
    pg suites caught what three probe scripts could not.
(3) Guards earn their keep by finding bugs, not just pinning state —
    this one found one within its first diff, and the bug's story
    (silent hand-fix hiding a live multi-tenant defect) justified the
    whole rework.
## 2026-09-04 — round W: a scoped command nothing called, and a shell that hangs instead of failing

Problem: a 2026 security-audit row (F-017, `62e30fd7`) recorded
`get_backup_status_scoped` + `create_backup_scoped` as DONE. They are
registered in `lib.rs:564/:566` and documented in `api-reference.md`.
`ui/src` referenced them zero times. Every UI path still called the
unscoped command — and unscoped `create_backup` takes no session token at
all, so it checks no permission whatsoever while writing a full copy of the
database to disk. Every layer between "the command exists" and "the command
is reached" looked green.

Solution: `5f0692e1` wired both through the ADR #7 conditional. The tell
that this was an oversight, not a decision: the same file already routes
`exportData`, `importPreview` and `importData` through `sessionToken` and
lists it in their dep arrays. Backup was simply the two calls nobody
migrated.

Then measured the extent rather than guessing: 318 `*_scoped` commands are
registered, 20 have their unscoped twin called from production UI while the
scoped one is never used, 8 of those scoped twins enforce a permission the
unscoped path does not. After reachability: **five live gaps, one dead, one
where unscoped is the only correct choice.** `74ed1933` closed the first —
`pick_logo_file`, where the handler already passed `sessionToken` to
`setBrandLogoPath` on the very next line.

Process notes:
(1) `get_key_rotation_info` was the most tempting finding in the set — the
    Rust comment reads "key age/state is crypto-compliance data, explicit
    permission" and requires SECURITY_MANAGE. It is unreachable: its only
    caller chain ends at `useKeyRotationReminder()`, which nothing outside
    its own test imports. **One hop to a caller is not reachability; the
    caller has to be reachable too.**
(2) `get_license_status` is NOT a gap at `AppShell:150`, which runs it in
    the boot effect to decide whether to show the license screen — before
    any session exists. There is no token to pass there. A permission
    "hole" can be the only correct design at its call site.
(3) Two measurement errors, both mine, both pointing opposite ways. I
    counted `ui/src/dev-mock/tauri-api.ts` as UI usage — it is a mock
    registry that lists command names by design — inflating candidates to
    23. And my wrapper regex matched only `export const NAME = ...`, so it
    missed five `function NAME()` declarations in `api/license.ts` and
    reported them dead; they are live. Neither error was a bug in the code.
(4) The backup test's first version made the scoped mock delegate to the
    unscoped spy. That registers a call on the unscoped spy, so
    `expect(unscoped).not.toHaveBeenCalled()` was unprovable and the test
    passed for the wrong reason. Configuring them in parallel turned the
    OLD assertion red, proving it had been vacuous all along.
(5) `bash <script>` on Windows resolves to `System32\bash.exe` — WSL, not
    Git Bash — and it does not fail, it HANGS. `echo wsl-ok` never returned
    in 12s. Two 10-minute timeouts went into suspecting `wtree-guard.sh`
    and `verify-scoped-coverage.sh` before suspecting the shell. Documented
    in AGENTS.md; a hang with no output is a resolution problem first.
(6) Red failed twice for the wrong reason before failing for the right one:
    first a missing `HARNESS_SESSION_TOKEN` import, then the wrong constant
    — `AppearanceSettings.test.tsx` overrides `useWorkspace` at L31 with
    `'tok-appearance'`, which its sibling assertions already use. Matching
    the block's own convention is what makes an assertion meaningful.

---

## 2026-09-05 — rounds 55-57: a block that would not clear, and three self-corrections

**Problem:** every commit in the repository was blocked for six rounds. Pre-commit
step 3 runs `lint-i18n.sh`, which calls `verify-bundle-parity.py --full-census` —
whole-tree, unconditional, no skip path — and it reported 2 missing keys. Those keys
belonged to a Cloud Sync card another agent had added to `WorkspaceHome.tsx` and
never finished, so the file sat dirty and the gate stayed red for work nobody was
doing. `OZPOS_SKIP_TYPECHECK` is the only skip variable the hook honours, so the
alternative was `--no-verify`, which skips all nine gates.

**The premise I had been acting on was five rounds old and untested.** I had
declined to intervene because "they are mid-edit and will finish." Checked directly:
the blocking file had been idle 168 minutes, the other dirty files were 6-22 hours
old, and the same agent had committed eight test suites in fifteen minutes *while this
gate was failing* — meaning they bypassed it eight times. The block was not
self-clearing. Recording the assumption as fact for five rounds was the actual error.

**Escalated rather than choosing unilaterally.** Adding another agent's missing copy
is a product decision; touching their dirty file is worse; bypassing nine gates is
worst. Asked, and the user chose to add the keys.

**Solution:** added `workspace-home-cloud-sync-title`/`-desc` to `shared.ftl` and
`shared.id.ftl` (`3dca96c2`). **The wording is not mine** — the app already ships
approved copy for this exact capability in the same file: `setup-feature-cloud-sync`
= "Cloud Sync" and its `-desc`, with Indonesian counterparts. Reusing established
terminology for an already-named feature is plumbing; writing new copy would have
been the product decision I was trying to avoid. Inserted positionally beside the
other `workspace-home` tool-card pairs, not sorted, to keep the file's grouping by
feature. Then landed the rest of the pending work as five focused commits rather than
one, so each is reviewable and bisectable.

**Built the gate the risk needed (`a410ea9f`).** The user's chosen option included
building an orphan-key check so the residual risk stays visible. `verify-ftl-orphans.py`
now gates the direction nothing checked, and found real debt immediately:
`topology-shortcuts-*` (18 keys whose feature was removed, per a comment in
`popoverSurfaceCompliance.test.tsx:54`) and ~23 `warehouse-*` keys with zero
references anywhere. Wired as pre-commit step 10 plus `gates.json`, `check.sh`, and
`dev-ci.yml#i18n`, and **proven to fire through the real hook** — staging a key in
both locale files produced `i18n lint: no issues detected` then `FAIL: 1 orphan
problem(s)` and exit 1. Running the script standalone is not evidence the wiring works.

**Three times I was wrong, and what caught each:**

1. **My parity gate was hollow.** Disabling the TypeScript aliasing rule left it green
   with zero violations, because the Python re-implemented the rule instead of
   observing it. A check that re-derives the thing it verifies agrees by construction.
2. **A self-test that passed while the mechanism did nothing.** The prefix rescue was
   dead — the capture class includes `-`, so `` `analytics-month-${m}` `` yielded
   `'analytics-month-'` and `startswith(p + "-")` searched for `'analytics-month--'`.
   The self-test asserted detection *found* a prefix, not that it *rescued* a key.
   A looser earlier prototype had got it right by accident; tightening made it wrong.
3. **I nearly published six fake defects.** Measuring Indonesian-only keys, I matched
   any quoted string equal to a key name and "found" `done`, `export`, `download`,
   `pos-cart-title` referenced from production — a live English-locale bug, since
   Fluent has no cross-locale fallback. All six were a status prop, a CSS class, and
   a state-machine enum. Restricting to real resolution sites returned zero. **The
   standing lesson in `fluent-page-audit.md` describes this exactly: a tool that saw
   too much, fixed by going and reading the source it pointed at.**

4. **And then I published a real one.** The same measurement suggested a gap: 75 keys
   exist only in Indonesian, `i18nBundle.test.tsx:450` checks only EN→ID, and
   `--full-census` is *described* as failing on references resolving in **neither**
   locale. So a reference resolving in Indonesian but not English must be invisible to
   every gate — I wrote that into three docs in `98e5e1a5`. **It was false, and I only
   found out by building the gate to close it.** Staging a `getString()` on an
   Indonesian-only key makes `verify-bundle-parity.py` print `missing in en .ftl only`
   and exit 1, at `getString`, `<Localized id>` and `i18nKey` sites alike. The tool
   checks each locale separately; its summary wording is what I reasoned from instead
   of its behaviour. Retracted in item 61, demoted the half-built check from blocker to
   informational, and kept the wrong claim on record rather than deleting it — the
   inference is easy to make. **The lesson is not "verify before claiming", which is
   rule 4 already; it is that a claim about what a tool MISSES needs the same control as
   a claim about what it catches: `totally-absent-key-zzz` had to exit 1 before an exit
   0 on the subject would have meant anything.** Two earlier probes were invalid in the
   opposite direction — the tool said `received 0 path(s)` and `Returning 0
   informational` and I nearly read that as a verdict. It was reporting its own emptiness
   honestly; the reading was the error.

**Root-caused a flake that had resisted nine rounds (`db94998f`)** — and my first
diagnosis was wrong. `KdsEnrollmentModalPure` failing in-suite but passing alone reads
as test ordering, so I blamed the mock-leak debt. Real cause: `Date.now()` read twice
plus `Math.floor`, so the assertion held only while both reads landed in the same
millisecond — near-certain isolated, merely likely under load. **Item 59 was rewritten
rather than appended to: a stale wrong root cause in the docs costs the next agent
their whole budget confirming it.**

**Deliberately did NOT:**
- Delete the 93 orphan candidates or 75 dead Indonesian translations. Dead copy is
  cheap, someone may revive a feature, and both are product decisions. Recorded with
  counts and file attribution instead.
- Build the static check I proposed for double-`Date.now()` reads. Measured first:
  12 such blocks, 9 provably safe (`<=` monotonic, clamped, hour-scale offsets) —
  75% false positives. Recorded as *rejected*, not deferred.
- Extend `--full-census` to fail on Indonesian-only keys; that would conflate a
  latent gap with 75 legitimate cleanup items and ship a red gate.
- Amend, `--no-verify`, `git stash`, or `git push`.

**Remaining risks, each a future slice:** the orphan gate's blocking form runs only in
the hook, since CI has no index to diff; CI still never runs on this branch at all,
because `dev-ci.yml` has no push trigger; and the ~50 keys of real orphan debt plus the
75 dead Indonesian translations need an owner's decision. **The reverse-parity gap that
this entry originally listed as remaining does not exist** — see correction 4 above.

## 2026-09-13 — analytics trilogy close-out: adopting a dead lane's draft, and what byte-for-byte really means

The three `todo-refactor-analytics-agents-{1,2,3}.md` orders were repaired against
`ce8666604` (all 20 boxes unchecked) but half-EXECUTED by a lane that stalled at 06:42:
agents-1 fully landed (`1cade9e55e`, `8d03585f3c`, `00a18777f9`), agents-2 landed only its
CSV half (`a9c0fdf3b7`), and agents-3 left an orphan — `charts/chartTheme.ts` created 06:35,
never modified, imported by nothing. The stall also left two seams visible on inspection:
`constants.ts` held `largestRemainderPcts`' doc comment while the function itself stayed in
the content file, and a stale "Column labels for the staff-performance CSV" comment sat above
`DeltaChip`. Half-movements announce themselves exactly like this.

Executing the rest, in the docs' own order (3.1 first — the only hard edge):

- `89b739728d` — nine frozen chart modules + the theme. The orphan was **adopted as-is**
  after byte-comparing every export against the still-inline infrastructure (it passed);
  provenance stated in the commit message, not laundered. Purely additive per its own rule:
  the inline builders and the modules coexist at this commit, which is what "structure, not
  appearance" buys.
- `8703694583` — the Phase-2.1 remainder: all shared primitives into `cards/shared/**`.
- `90399c28cb` — the seven chart-free cards, prop exceptions verbatim; `ExportCsvButton`
  moved to shared with its constraint-2 re-export kept (cards importing it back up from the
  content file would have cycled through the dispatcher).
- `d3f551ff44` — the nine shells swap onto the frozen modules; content file ends at **91
  lines** against the ≤300 target.
- `c05133d757` — agents-1's deferred tail: last three shim consumers repointed, the
  self-expiring re-export block deleted per its own comment.

**"Byte-for-byte apart from the prop plumbing" met reality twice.** Fluent's `getString` is
overloaded, not `(id, args?)`-shaped, so the injected-lookup prop needed an adapter hook
(`cards/shared/useGetString`); typing it forced `Record<string, unknown>` down to
`Record<string, string>` (every real call site already passed strings only), and an interim
`splitLoaded` guard-prop died on the discovery that the original guard was dead code at the
one render site. Amendments announced in the published signature table in the agents-3 doc —
a freeze you cannot amend while honest is a freeze that selects for quiet lies.

**The honest-miss record:** agents-1's restated ≤1,200-line target measured **1,409** — a
~200-line gap that is precisely the JSX-shell bulk the order itself declared out of scope.
Reported in the doc rather than retargeted; the JSX-split order (`AnalyticsToolbar`/
`AnalyticsCardGrid`/`AnalyticsPopovers`) remains genuinely open.

Gates: typecheck clean beyond the devmock lane's live file; 16/16 + 106/106 analytics suites
at every commit; whole-ui 9,568/9,597 with the 5 failures pre-existing and attributed
(restaurant tooltip baseline ×2, kds expo selectors + storage key, devmock session-lock).

## 2026-09-13 — the KDS five-agent chain: what "tested" still owed after being tested

The routing/LAN/display KDS campaign shipped in five ordered slices (agents 1–5),
each closed with gates — and the chain still produced the day's most instructive
gap: agent-2's feature compiled, passed 62 crate tests, passed 12 registration +
13 state pins, and the desktop wiring landed as three reviewed commits... and NO
BODY had ever published an event over a live socket. The honest close for that
slice was "wired, not lived" — which is why agent-4 existed at all.

What the live validation found, none of it visible from any unit layer:

- **Phase-0 over-read** (found `0302039258`, fixed `355d651a5f`): `handle_peer`'s
  legacy-hello branch read through a transient `BufReader`; a tablet that wrote
  `hello\n{"op":"discover"}` in one TCP segment had its discover line silently
  discarded when the reader dropped. Sixty-two tests missed it because every one
  of them paced its writes. A red-by-construction demo became the permanent
  unpaced regression: `kds_lan_live_bugdemo_discovery_lost_when_sent_with_hello`.
- **Ephemeral-port replay was dead code in production**: the offline buffer keyed
  by peer ip:port, so a reconnecting tablet — which always gets a new port — never
  found its queue. Agent-4's own replay test could only prove it by rebinding the
  exact local port, a thing real tablets cannot do. Agent-5 (`212078e554`) keyed by
  `device_id` (already on the wire, finally consumed), kept addr-keying as the
  legacy path with a disjoint-namespace test, and made replay-on-reconnect true
  for the first time.

The rules lane (agent-1) landed `kds_routing_rules` through a migration window that
went phantom → real → cleared mid-session, kept `resolve_kds_targets` byte-equivalent
under `rules=[]` at both the pure and bridge layers, and raised the desktop
registration floor **449 → 451** (the pin's own comment carries the naming this
entry owes it). Two honest non-changes it stamped instead of faking: `tag` stays in
the CHECK constraint but NEVER matches (no catalog tags model), and the UI editor +
dev-mock handlers were deferred to live-session fences rather than raced.

The compliance tail was its own lesson: agent-3's suites ran 942/942 green under
two separate hands, and the WHOLE-ui run still found two unpinned new surfaces —
`storageKeyPins` (unregistered `oz-kds-expo-station-`, `1ae8494160`) and
`noiseDitherCompliance` (four shadow surfaces that needed real `::after` wiring,
not just registration, `a34172f8e7`). Scoped filters green is not a gate; the
ratchet files only move when the full sweep sees them. A third — nativeTooltip's
9 new sites — was proven foreign (7 in the analytics lane's in-flight components,
2 carried by the morning's MenuItemTile extraction) and correctly left to its owners.

Also closed as campaign tail-debt: `stock_transfer_integration`'s five stale-seed
reds (fixtures seeded the legacy global `inventory` while the canonical per-location
reader looked at `stock_summary` — repaired through the real writer, never around
it, `86ca2e73f6`; one of those tests had been green for the WRONG REASON, rejecting
a phantom `have 0` instead of a real shortfall — now it proves `have 5, need 20`).


## 2026-09-13 — payment epic closed; analytics size-miss retired the honest way

`todo-payment-agents-3.md` is COMPLETE: 3.2 landed as `00f5c3fda6` (re-audit —
the wire had moved under the plan four commits mid-session; every checklist
premise re-measured, both deferred decisions made explicitly) + `26ffd89c1c`
(the card flow: scoped pre-flight, deliberately uncancellable tap/insert/swipe
overlay, capture-first ordering as the mirror of QRIS-Auto's pending-first,
txn fields riding the payment split) + `47ade21484`. The two QRIS/EDC money
paths now share one build/settle tail (buildGatewaySale/settleGatewaySale).

Analytics agents-1's measured miss (1,409 ln vs ≤1,200) was retired NOT by
editing the target but by opening the JSX-shell order its own stamp named:
`411e6dccfb` moved four verbatim renderings to `components/` (1,170 ln —
under goal, 106/106 screen tests untouched), `todo-refactor-analytics-agents-4.md`
(`c8ee3fb3da`) records the remaining slices with their traps measured —
command palette next, the coupled grid core last and only after a state-
ownership decision. One fabrication caught mid-work and corrected before it
shipped: a drafted SHORTCUTS list that did not match the file; the verbatim
pass replaced it. The native-tooltip ratchet moved with its code (15 -> 8+4+3,
sum pinned 82); its two remaining reds are restaurant-lane drift, named.


### Same day, later — agents-4 finished itself: five more shells out, screen at 864

`todo-refactor-analytics-agents-4.md` closed COMPLETE across the rounds after
its opening: `d5e3aba339` (CommandPalette - the hook already owned every
key, so the seam is pure presentation), `86e4dc5670` (AnalyticsCardFrame -
the grid's state-ownership question decided AGAINST a context/reducer
migration and FOR a children slot: chrome reports intent, card data renders
through, the feared eighteen-prop drill never exists), `a070d2ab72`
(AnalyticsToolbar - composed side effects stay screen-composed behind one
callback each; the zoom cluster crosses as a slot). Screen: 1,409 -> 864
ln from agents-1's closure, through six verbatim slices; the 106-test
suite was never edited once. Three behaviour changes died in pre-commit
verbatim audits (descKey-vs-titleKey, onDragLeave-vs-onDragEnd, the
menu-expand compact-mode asymmetry) - and one of my own doc commits
claimed an edit the read-policy had refused, corrected one commit late
and disclosed in the correction's own message.

Whole tree at final close: 9,577/9,604, three reds all named and all
other lanes' (restaurant's tooltip drift x2; devmock's version test
grepping a line its own split relocated). Nothing was pushed - standing
rule.


## 2026-09-14 - payment agents-5: the checkout finally reads its own config (R1+R2+R3)

Five commits closed the ranked remainder of the payment epic's
absorption inventory: `09eec83868` (manual QRIS confirms only when a
cashier asserts it - the 8-second setTimeout that minted real sales
behind fake confirmation is gone), `eadffb4e0c` (the 43-box master
backlog decomposed against HEAD, R1-R6 ranked), `bffcbda97a` (R1:
`useLocalPaymentRails` gates the QRIS tab and EDC button on the
slice-6 rail store, fail-open by contract), `903b30a718` (R2: the
441-cell pseudo-QR deleted, merchant static EMVCo payload lives in the
qris rail's parameters, editable in settings, rendered by the real
encoder; unconfigured says so plainly), `3d50b3ac5a` + `95ed37afae`
(R3: the private substring scan replaced by delegation to the shared
boundary classifier).

Three premise corrections, each recorded where the wrong claim stands
rather than edited away: the master doc's `payment:qris-manual/:midtrans/:edc`
feature keys never existed in code (the rail store is the real surface);
"online-capable" from the visibleMethods formula is unimplementable
today because no online signal exists in the UI (measured - left open,
named); R3's own inventory text *understated* the plumbing - both
clients already reject typed `{kind, subKind, message}`, the tested
shared classifier simply had zero screen consumers while the checkout
kept a worse private answer to the same question.

Two tests died on their own premises before shipping and both are worth
remembering: the rails hook trusted IPC to return arrays (a test default
answered `{}`, `rails.find` exploded - response validation made
fail-open real), and a real-QR assertion was written inside the file
that MOCKS the component (rewritten to what that harness can actually
observe - the payload reaching props). And one deletion note: 'try again'
was deliberately NOT migrated into the shared retry vocabulary - it
appears in this module's own non-retryable user copy, so the old scanner
once offered Retry on the strength of its own fallback text.

Gates at close: payment battery 100/100, app-error 19/19, compliance
quartet 202/202 (storage pins green again - the lane that broke them
fixed them), typecheck clean beyond the devmock lane's live files,
eslint 0, bundle parity 0 missing (2 new keys both-sided). Remaining
ranked boxes are all blocked on external facts, not on code: R4 wants a
second real terminal, R5 wants a design doc first, R6 wants sandbox
credentials. Branch 0.0.37 is 15+ commits ahead of origin. Nothing was
pushed - standing rule.

## 2026-09-14 — licensing plan doc + this journal: the BOOTSTRAP_FREE sentinel is a production seed, and the reachability claim about it was wrong

Two docs corrected, no code touched: `todo-refactor-oz-pos-app-agents-3.md`
(three dated appends at the release-test findings, `:146` / `:155` / the new
`inventory.rs` classification) and this file, append-only, below. Nothing was
renamed or moved — a `todo-` token is load-bearing for the dead-reference
checker's exemption (`.agents/skills/docs-auditor/scripts/check-dead-refs.py`
`is_historical_doc()`), and AGENTS.md §4 requires the plan's own acceptance
command to have been RUN before a `done-` prefix is earned.

**What this journal asserted at `:796-800` is half true.** It read: *"in release
builds the call site must not reach the fallback in production (a real
subscription row is written by license activation)"*. True POST-activation —
activation rewrites the row (`oz-bridge/src/license.rs:175` →
`oz-core/src/license_verification.rs:625` `INSERT OR REPLACE`). False as a
statement about the fallback's Free behaviour: `bootstrap_free()`
(`oz-core/src/subscription.rs:628-641`) carries `signature: String::new()`,
which release also rejects, and the fallback is not even the main arm — the
sentinel is the row the MIGRATION seeds (`20260813_init.sql:1512-1514`, PG
twin `:2100-2101`, that PG file generated and never hand-edited). So on a
never-activated release install both arms land on an ERROR, not a Free verdict.

**The reachability framing that made this sound like a login outage is
retracted, and the correct scope is tablet-only.** Login is `staff_login`
(`oz-bridge/src/auth.rs:319`) and it calls no `verify_signature`; the check is
in `create_session` (`auth.rs:611-621`) on workspace entry. Desktop gates ahead
of that (`ui/src/frontend/shell/AppShell.tsx:401` before `:434`), so the outage
reading is falsified. It is live on the TABLET shell only:
`ui/src/frontend/shell/tablet/TabletAppShell.tsx:64-84` reads just
`getSetupStatus()` with no licence gate at all, `apps/tablet-client/src/lib.rs`
registers zero license commands, four tablet commands take no token
(`history.rs:63`, `products.rs:295`, `pos.rs:784`, `offline.rs:162`), and the
tablet `createSession` rejection is swallowed into a `console.warn` at
`ui/src/contexts/WorkspaceContext.tsx:520-531`. Reachable today only via a
hand-built release APK — `android.yml`/`ios.yml` are `.bak`.

**Two fail-opens are what keep the desktop path merely theoretical rather than
impossible:** `AppShell.tsx:167-176` treats `status.completed` as "existing
install → `setHasActiveLicense(true)`", but `completed` is the SETUP-WIZARD
dismissal (`oz-bridge/src/setup.rs:144`, key `SHOW_SETUP_WIZARD`), not
activation; and `:188-197` fail-opens the same way on any startup error. Both
are stated here as reachable-by-accident, not as bugs.

**And the count that seeded all of this was a stale comment.** The "other 13
subscription-trusting call sites" at `oz-bridge/src/workspaces.rs:228-231` —
the sentence a 27-site enumeration was cloned from — is out of date with the
tree: re-counted this pass there are **27 `verify_signature()?` sites (16 in
`crates/oz-bridge/src`, 11 in `apps/tablet-client/src`)**, of which **21 take
and resolve a session token** and are therefore unreachable BY CONSTRUCTION
while the sentinel stands, since minting the token is the very `create_session`
that rejects first. Consequence, and the point of the entry: **76 release-test
failures are not 76 customer-visible bugs.** The one claim that survives
untouched is that this release path has never been EXECUTED — and it still has
not been. Docs-only pass; no test, build, or gate was run against code, so
every number above is a read of a file, not a run.

## 2026-09-14 — oz-bridge release profile: 76 reds, zero genuine differences, and a crate that cannot test its own verifier

The release-profile numbers behind Phase 1 of the debt program, recorded here rather than only in
a plan doc because the durable output of that pass is a PROHIBITION: the tempting fix for the 76 is
worse than the 76.

**The measurement.** `cargo test -p oz-bridge` in debug → **1308 passed / 0 failed**, exit 0,
229.7s. The same command with `--release` → **1231 passed / 76 FAILED**, exit 101, 257.9s wall, of
which **198.47s is execution**. The totals close exactly: 1231 + 76 = 1307 = 1308 − 1, and the
missing one is a test that does not exist in the release binary at all —
`sync_probe_falls_back_to_cloud_url_when_unconfigured`, gated `#[cfg(debug_assertions)]` at
`crates/oz-bridge/src/sync_tests.rs:35-37`. No second discrepancy is hiding. Classification of the
76: **76 profile-dishonest fixtures, 0 genuine profile differences, 0 environmental.**

**Why that classification is a proof and not a guess: no test in this crate can mint a verifying
signature.** `verify_license_signature` takes `(payload, signature_base64)` and nothing else
(`crates/oz-core/src/license_verification.rs:387`); the key comes from the compile-time
`include_str!` constant at `:44`, read at `:396` through `load_public_key()` at `:424-430`. There
is no key parameter, no trait, no thread-local, no injected verifier anywhere on that path, and the
callers the failing tests reach go straight to it: `TenantSubscription::verify_signature`
(`crates/oz-core/src/subscription.rs:475-477`) and `crates/oz-bridge/src/license.rs:594`. The only
tracked key material is `crates/oz-core/oz-license.key.pub`; the private PEM is git-ignored
(`.gitignore:70`, `*.pem`) and absent from disk. Therefore a seeded `tenant_subscription` row is
exactly one of two kinds: the **sentinel** `BOOTSTRAP_FREE`, which `:392-394` waves through in
debug and which nothing else passes in release — or an **invalid** signature, which fails in both.
**NO THIRD KIND EXISTS without a production seam, and adding that seam is an owner ruling, not a
worker's fix.** Consequence, stated plainly: "release-side failures = 0 genuine" is ATTRIBUTION,
NOT COVERAGE. A real profile difference could hide behind the sentinel, and this crate structurally
cannot rule it out.

**The tautology found while classifying.** `crates/oz-core/src/license_verification_tests.rs:27-64`
— `verify_valid_signature` and `verify_tampered_payload_fails` — generate their own keypair
(`:7`) and re-implement verification INLINE against that test key (`:18` onward, `VerifyingKey`
used directly). Neither calls `verify_license_signature`. They are green in both profiles and cover
nothing shipped: green there is not evidence about the shipped verifier.

**The product fact the reds establish, and that a green suite would stop reporting.**
`crates/oz-core/migrations/20260813_init.sql:1514` — and its GENERATED twin
`20260813_init.pg.sql:2101` — seed `BOOTSTRAP_FREE` into every fresh install. So a release build
of a fresh, UNACTIVATED, single-store install projects state unavailable, tier Free, every gate
locked, until activation rewrites the row (`crates/oz-bridge/src/license.rs:175` →
`crates/oz-core/src/license_verification.rs:625` `INSERT OR REPLACE`). Right now the 76 reds are
the only place that fact is asserted by anything a machine runs.

**The fixes that are prohibited, named so nobody rediscovers them.** (a) making release accept the
sentinel; (b) `[profile.release] debug-assertions = true` — that puts the licence bypass in the
shipped binary; (c) signing fixtures with `OZPOS_OZ_LICENSE_PRIVATE_KEY` from the registry —
machine-dependent, non-CI, and it puts signing capability inside the test suite; (d) blanking or
deleting a signature to silence a red, which converts a loud forged-row error into a silent Free
run. Counter-example that must stay exactly as it is: the forged-signature expectation at
`crates/oz-bridge/src/auth_tests.rs:391-409` stays `Err` in BOTH profiles.

**The acceptance restatement for the release work.**

> `cargo test -p oz-bridge` → 1308 passed / 0 failed; `cargo test -p oz-bridge --release` → 0 failed
> / N ignored, with N listed by name and each ignored reason naming the parked seam. The release
> suite is green because the fixtures stopped lying, not because release got weaker.

Known residual, and it has to travel with any later scope work: after that work, release-side SCOPE
coverage is zero either way — the six scope tests will assert fail-closed or be ignored — so any
later scope work inherits an invisible hole and must be told about it. Recording pass: this entry
is written from a docs check-out of the cited files, so the two test runs above are the release
profile's measurements and every other number here is a read of a file, not a run.

## 2026-09-15 — the licensing seam decides the test strategy, and two guards turn out to grade less than their green says

Phase 2 of the release debt closed tonight in `crates/oz-bridge`, and two UI lanes came back with measurements about their
own test surfaces. Six facts, in the order they were learned, append-only, because all of them currently live only in commit
messages and a session journal — and the last three change how a green run should be read.

**The licensing fact that drove everything else.** A release-built fresh UNACTIVATED install projects `state:
"unavailable"`, tier `free`, every gate locked — the fail-closed projection the shared consts now name
(`crates/oz-bridge/src/testing.rs:226`, `:235`, `:242`) — because the signature on the seeded `tenant_subscription` row is the
`BOOTSTRAP_FREE` DEVELOPMENT sentinel (`crates/oz-core/migrations/20260813_init.sql:1514`) and `verify_license_signature`
has NO seam: the embedded public half is the ONLY key material on that path
(`crates/oz-core/src/license_verification.rs:44`, an `include_str!` of `crates/oz-core/oz-license.key.pub`), while the
private PEM is git-ignored (`.gitignore:70`, `*.pem`) and absent from disk. So NO test can mint a signature that verifies,
and the remedy taken was per-site BOTH-PROFILE forks speaking one shared harness vocabulary —
`crates/oz-bridge/src/testing.rs`, added by `8229bd2b9` (+133/−0, one file, purely additive) — and not one of the rejected
alternatives: never `[profile.release] debug-assertions = true` (the manifest does not set it — `Cargo.toml:199-204`),
never sign fixtures with `OZPOS_OZ_LICENSE_PRIVATE_KEY`, never blank a signature, never make release accept the sentinel.
The forged-signature cases stay `Err` in BOTH profiles: `crates/oz-bridge/src/auth_tests.rs:391-430` — that range, not the
`:391-409` previously cited, because `f742736f0` established that the `UPDATE` alone is not the proof; the `expect_err` at
`:428` and the match after it are what make the case load-bearing.

**Two defects the pilot found in its own brief, kept because they generalise.** (1) A `#[cfg(not(debug_assertions))]` arm
does not COMPILE when the release leg is reached by a runtime `if seeded_row_loads()`: both arms are built and type-checked in
both profiles, so attribute-gating one side of a runtime fork is not a smaller change, it is a broken one. The shipped fix
branches at runtime ONLY (re-measure: `grep -c 'cfg(' crates/oz-bridge/src/audit_tests.rs` → 0, same for
`audit_security_events_tests.rs`), and that same choice dodges an `unused_imports` red which
`RUSTFLAGS: -D warnings` (`dev-ci.yml:12`) would otherwise turn into a hard failure in `dev-ci.yml#cargo-check`. (2) THE
DANGEROUS FIXTURES ARE THE GREEN ONES: gate order is TIER-then-PERMISSION, so a permission leg can pass with `audit:view`
never consulted at all — a red-chasing brief structurally cannot surface it, because the case reports success the whole time.
The two lanes: `1760a080d` forked FOUR fixtures (SIX runtime sites — count the diff, not the briefing:
`git show 1760a080d | grep -cE '^\+\s+if seeded_row_loads\(\) \{'` → 6, four test bodies plus the shared
`assert_gate_projection` helper), +163/−6, release 4 → 0, zero `#[ignore]`, and no assertion dropped: two assert lines
disappear from the raw diff and BOTH reappear inside the new arms (`audit_tests.rs:257` still pins `page.total == 0`), while
the file's assert count rises 22 → 38. `b891f2db7` forked the security-events tier fixtures, +470/−59, release 29/0, THREE
vacuous permission legs closed (a fourth "VACUOUS LEG" marker names a case that needed no fork — `resolve_scope` is honest in
both profiles), and all 33 original assert lines verified surviving by a whitespace-insensitive diff:
`git diff -w b891f2db7^ b891f2db7 --numstat` → 435/24 with zero `^-\s*assert` lines, file count 33 → 95.

**The contract's own corrections, and the blind spot nobody had written down.** `f742736f0` (+95/−12 to `testing.rs`)
fixed four false claims in the shared contract and named the release hole in the same file: `FAIL_CLOSED_*` and
`seeded_row_loads()` describe the `tenant_subscription` / caps read ONLY and must NEVER fork a `get_license_status`
fixture — that command forks three ways on its own (`license.rs:594-601` a stored pair that will not verify;
`:698-708` no stored pair in release; `:685-697` no stored pair in debug; `:659-668` an expired payload), and not ONE of
them projects the Unavailable + Free pair the consts pin, so forking it there is wrong-green in debug and wrong-red in
release. In release a `false` from `seeded_row_loads()` collapses FIVE distinct causes into one bool (no default row; a load
`Err`; `load_public_key()` failing; the base64 reject on the sentinel's own text; a genuine RSA mismatch — `testing.rs`,
"What `false` does NOT mean"), so a release arm must ALSO assert the seeded row EXISTS before it asserts the projection;
both lanes already obey (`audit_tests.rs:145`, `audit_security_events_tests.rs:62`). And the tripwire
(`testing.rs:564`) flips SILENTLY IN BOTH PROFILES under `[profile.release] debug-assertions = true` — `true == true` stays
green while the licence bypass ships — which no CI can see, because there is NO `--release` test invocation anywhere:
`grep -c -- '--release'` returns 0 for `.github/workflows/dev-ci.yml`, `scripts/check.sh`, `scripts/release.sh` and
`scripts/run-pre-push.py` (re-run this pass; the only Rust test runs are `dev-ci.yml:244`, `check.sh:106`/`:110`,
`release.sh:65`).

**The coverage honesty note, which is the part most likely to be lost.** Release-side SCOPE coverage behind
`verify_signature` is ZERO either way: the six scope tests named in `todo-open-debt-program.md:90` will assert fail-closed
or be ignored, and the parked arm at `crates/oz-bridge/src/locations.rs:231-236` (same doc, `:109`) stays unreachable.
UNREACHABLE, not untested — and that distinction is ATTRIBUTION, not a pass. It is handed to Phase 3b explicitly, so that
phase inherits a named hole rather than a counted fix.

**`screenExtraction.test.ts` is a REGISTRATION guard, not a sweep — and `17a5032a0` (+145/−8) put that in its header.**
Three cases per entry (`it(` at `:927`, `:941`, `:958` inside `describe.each(SCREENS)` at `:894`) plus four extractor
self-tests (`:999`, `:1003`, `:1014`, `:1021`), so 61 entries read **187** — `grep -cE "^    name: '"` → 61, and
61 × 3 + 4 = 187. The count is a function of the LIST, never of the tree's CSS health: a registration adds three green cases
whether or not anything got better. An UNREGISTERED screen is invisible to all three checks, so it cannot fail and cannot be
counted as clean. Tonight's correction to the briefing on this point: PaymentModal was NOT brought inside the guard —
`17a5032a0` is the commit that records why it CANNOT be registered yet. Its four extracted tender children
(`payment/CashTenderPanel`, `CardTenderPanel`, `QrisTenderPanel`, `SplitTenderRows`) are named in the note, and so are the
two blockers: three static classNames with no rule anywhere in the repo (HARD, so `dynamicClassPrefixes` cannot reach it) and
twelve `payment-loyalty-*` rules that `LoyaltyTenderPanel.tsx` has rendered since `6ddf49f1e` but that no `additionalTsx`
list names (SOFT-but-still-failing). The header's own sizes — `sales/PaymentModal.tsx` 1,912 lines over
`sales/PaymentModal.css` 1,165 — are pre-`6ddf49f1e`: `wc -l` reads 1,858 today. Those are stale-by-history, not
wrong-by-method, and re-measuring is the one command a reader should trust. The placeholders make the other half of the
point: `screens/screens-placeholder.css` is the companion css of FOURTEEN entries and defines three classes used by every one
of the thirteen placeholder files, so deleting twelve of them still passes their twelve no-dead-class cases — a check
satisfiable only by guaranteed-present markup certifies nothing.

**Settings reachability, stated as measured.** Of the fourteen screens the hub can mount
(`ui/src/features/settings/screens/registry.ts`, fourteen `lazy()` arms), FOURTEEN render the placeholder shell
(`grep -c settings-screen-placeholder` over each mounted target: thirteen files under `screens/` plus
`ui/src/features/sync/SyncConflictReviewScreen.tsx`, which is mounted by key and is not under `screens/`) — so
`SettingsPage.tsx` has ZERO form controls
(`grep -cE '<(input|select|textarea)' ui/src/features/settings/SettingsPage.tsx` → 0; the only `<button` is the hidden
`type="submit"` at `:415`) while still loading and saving settings whose controls no user reaches, and SIX guard entries
grade markup nobody can reach (the five `settings/sections/*.tsx` files in `additionalTsx`,
`screenExtraction.test.ts:370-374`, plus `AppearanceSettings` at `:782`) — 39 cases grading the thirteen placeholders, six
grading unreachable sections. Against that, the ~1,486 lines of the only real shipped settings UI — the four cards
`BusinessDefaultsScreen` mounts, 488 + 401 + 315 + 282 by `wc -l` — sat outside the guard until tonight, and re-measured
this pass they are STILL outside it: `grep -c` over each card name in the test file returns 0, 0, 0, 0. The finding is
recorded (the audit is `80ebb278e` against `f0ad9b170e`, its Q1/Q2 answered by `4a34206be` at `f7872bd9a`, and `13348f9ae`
labelled three of the unreachable sections dead in their own module headers); the registration is NOT done, and no sentence
here should be read as saying it is.

**Honest sourcing, which is why the numbers above sit in three classes.** The release tallies — 4 → 0 for `1760a080d`,
29/0 for `b891f2db7`, and the 76 → 0 trajectory behind them — are LANE-REPORTED runs, not re-executed in this docs pass:
nothing here ran `cargo test -p oz-bridge --release`. One of those greens was flagged in review as REASONED rather than
observed, and it stays that way in the record: the no-panic pin holds because a `blocking_lock()` on a tokio Mutex aborts in
both profiles (`audit_tests.rs:248-252`) — a type-and-lock-order argument, sound as argument, unproven as measurement, and
only made observational by mutating the gate and watching the release arm go red. Everything else came from a command run
this pass against the tree: `wc -l`, `grep -c`, `git show --numstat`, `git diff -w --numstat`. Docs-only; no code, test,
build or gate was run, and nothing was pushed — standing rule.

## 2026-09-15 — Contrast: the gate that said 69/69 never opened a feature sheet (ui/theming)

**Context:**
Three shipped rules painted text in the SAME hex as its own background — ratio 1.00:1, literally invisible — and
`ui/src/__tests__/colorContrastCompliance.test.ts` reported 69/69 immediately before and immediately after that
defect was fixed. The finding is about the GATE, and no plan file owns gates: the gate plans live in `todo-*.md`,
none of them covers contrast, so this goes into the live region of the journal. The repair and its follow-up landed the
same night — `268af4a6e` (CSS) and `34085577d` (a new guard); this entry authors no code.

**Fact 1 — what the gate reads, and why its green is structure and not measurement.**
1. It opens exactly ONE path: `../frontend/themes/tokens.css`, resolved at `:353` and read at `:367`.
   Across its 398 lines (`wc -l`) the string `features/` appears ZERO times. No feature stylesheet is in
   its universe at all.
2. `buildPairs()` hands back 22 hardcoded rows — `return [` at `:210`, `];` at `:309` — and
   the runner is 3 themes (`THEMES` at `:360-364`) × (22 pairs + 1 smoke case at `:374`) = 69. The 69 is
   arithmetic over a literal, so "69 passed" reports the SHAPE OF THE FILE, never the health of a stylesheet. Which is
   exactly why it read 69/69 on both sides of a real defect.
3. Three rules sat outside it, each resolving text and background to one hex:
   `.void-orders-action-btn--void:hover` at `ui/src/features/sales/VoidOrdersScreen.css:238` — its
   `color: var(--color-danger)` comes from the base rule at `:234` while the hover supplies
   `--color-danger-dim`: #FF6B68 at `ui/src/frontend/themes/tokens.css:129` and `:133`, #FC3D39 at
   `:438` and `:442`. Then `.offline-queue-plan-badge--pro` at
   `ui/src/features/offline/OfflineQueueScreen.css:121`, and its copy-paste twin
   `.settings-sync-plan-badge--pro` at `ui/src/features/settings/SettingsPage.css:929` — both
   `--color-success` on `--color-success-dim`: #6FE884 at `tokens.css:113` and `:115`,
   #2E9E3E at `:422` and `:424`.
4. ONE OF THE THREE IS A HOVER ON THE CONTROL THAT VOIDS A SALE. The two badges read as empty pills; that one
   disappears only when a cashier reaches for it.
5. Repaired at `268af4a6e` (+17/−3 across the three sheets; no token added, no selector renamed) with tokens
   that ALREADY EXISTED — `--color-success-fg` (`tokens.css:116` dark / `:425` light) and
   `--color-danger-fg` (`:134` / `:443`) — following the precedent the lane found at
   `ui/src/features/tables/TableManagementScreen.css:229` and `:248`, both annotated
   `TBL-11: dedicated status foreground pair`.

**Fact 2 — the population, which is why this belongs in a journal and not only in a commit note.**
A census parsed every same-block color+background pair in `ui/src/features/**/*.css`: **766 composed pairs across
105 sheets**; **362** of them resolve to an opaque hex in all three themes and are therefore computable WITHOUT a
browser; **125** of those sit below WCAG AA-normal 4.5:1 in at least one theme; **three** were at 1.00:1 — the three in
Fact 1. This is one file's exception, not a repo convention: `focusVisibleCompliance.test.ts`,
`touchTargetSizing.test.tsx` and `forcedColorsCompliance.test.ts` all DO name feature sheets (58, 57
and 5 `features/` references respectively), and the shape of a fix is precedented by TBL-11 above.
NOT statically checkable, from the same census: the **404** pairs whose text or fill is an `rgba()`, a gradient,
`currentColor` or an ancestor-dependent background; and the ONE-SIDED rules — **784** blocks set only a background,
**1,316** set only a color. That asymmetry is precisely how the QRIS hover composed its defect across two rules instead
of one (`.payment-qris-btn:hover:not(:disabled)` at `ui/src/features/sales/PaymentModal.css:663`
supplies a background and no colour). jsdom computes NO used value for a `var()`-driven background, so that half
needs a real browser — and Docker's daemon was unreachable on this machine tonight, so it did not run, and nothing here
claims that it did.

**Fact 3 — the residual. OPEN DECISION, no answer proposed and none invented.**
After the repair the LIGHT theme sits at **3.46:1** (`--color-success-fg` #ffffff on #2E9E3E) and **3.96:1**
(`--color-danger-fg` #1C2B45 on #FC3D39) — both under AA-normal 4.5:1, both far better than the 1.00:1 they
replaced, and neither of them compliant. The same arithmetic on the dark/:root theme passes: 11.88:1 and 5.10:1. Every
existing alternative was computed first and none closes it: `--color-accent-fg` on the same success fill is
3.46 — the SAME number, not a better one, because light `--color-accent-fg` (`tokens.css:408`) is
also #ffffff, so it is not a candidate either; saturated text on `--color-danger-subtle` /
`--color-success-subtle` composited over a white card gives 3.21 and 3.16; `--color-danger-700`
(#b91c1c) in dark is 2.84 against the theme background. So closing the light-theme residual is a `tokens.css`
decision — a new light-theme pair, not a selector edit — and no lane may quietly pick one. **Left OPEN.** The work that
owns it is the dossier measuring whether the TBL-11 dedicated-status-foreground decision can be ROLLED OUT instead of
re-decided; whichever way that lands, these two numbers move with it.

**What it means — the tone this entry exists to set.**
The 69-green was a TRUE report about a narrow question: "are these 22 token pairings, in these 3 theme blocks, above
their stated threshold?" It asked that, and it answered it correctly, before and after. **The gate is not broken — it is
narrow.** In six months a reader will otherwise find an invisible-text defect that Vitest did not catch and conclude
`colorContrastCompliance.test.ts` is faulty, then "repair" something that works exactly as designed. It was never
faulty, and widening it is not the fix either. The escalation that is right is the one already in flight: a SECOND file
that reads the sheets, `ui/src/__tests__/composedRuleIdenticalPair.test.ts` (`34085577d`, +312/−0),
whose third case puts its own denominator in its own name — today `395 pairs graded of 951 composed across 0
violation`. A gate that reports the population it graded is the lesson here; a broader threshold on the old file is
not.

**Verification:**
- `npx vitest run src/__tests__/colorContrastCompliance.test.ts` → 69 passed, re-run this pass on the repaired tree.
- `npx vitest run src/__tests__/composedRuleIdenticalPair.test.ts --reporter=verbose` → 3 passed, the third named
  "395 pairs graded of 951 composed across 0 violation".
- `git show --stat 268af4a6e` → 3 files, +17/−3. `git show --stat 34085577d` → 1 file, +312/−0.
- The ratios are this entry's own arithmetic — WCAG relative luminance over the hexes in `tokens.css` — not a
  browser measurement: 3.46, 3.96, 11.88, 5.10, 3.21, 3.16, 2.84. The two alpha cases are composited over #ffffff.
- The census totals (766 / 362 / 125 / 404 / 784 / 1,316 across 105 sheets) are the lane's parse, restated. A second
  parse written during this pass over the same 105 sheets reads 957 composed / 358 opaque-in-all-three / 126 below
  4.5:1 / 810 background-only / 1,125 color-only, and finds 0 identical pairs. The gap is block-splitting rule and the
  fallback-idiom double count that the new guard warns about in its own comment at
  `composedRuleIdenticalPair.test.ts:116-124` — two parsers over one tree, neither correcting the other. The
  1.00:1 count is the one figure that moved for a real reason: it is empty post-repair.
- `wc -l ui/src/__tests__/colorContrastCompliance.test.ts` → 398, against a briefing that said 399. Recorded as
  found, and the gap is a method difference, not a moved file: the file ends in a newline, so splitting on `\n` yields
  399 elements for 398 newline-terminated lines. Nothing in this entry depends on which of the two is quoted.
- `python3 scripts/verify-agents-mirrors.py` → exit 0 before and after this append. Docs-only; nothing pushed.

**Commit:** single pathspec commit `docs(records): the contrast gate grades token pairs and never reads the rules that compose them`.

## 2026-09-15 — Absence: NO test runner in this repo executes the release profile, and it held 65 failing tests

**Context:**
The previous entry recorded a gate that was narrow. This one records a gate that is ABSENT, which is a different disease:
`cargo test -p oz-bridge --release --no-fail-fast` ran for the FIRST TIME EVER tonight on this crate, in this repo — and
came back **65 red / 1,244 passed of 1,309**. The same crate in debug is **1,310 passed / 0 failed**. Sixty-five real
failures existed in the profile that ships and nothing in the tree could see them, because nothing in the tree RUNS that
profile. The finding is about the ABSENCE, and no plan file owns a test leg — so it goes into the live region here.

**Fact 1 — the absence, measured in four places, and the arithmetic of the two totals is itself a finding.**
The ONLY files under `scripts/` and `.github/workflows/` containing `--release` are
`scripts/build-exe-release.ps1`, `scripts/check-updater-compat.mjs` and the inert
`.github/workflows/ios.yml.bak`, and every hit is a BUILD (`cargo build --release` at
`scripts/build-exe-release.ps1:81-82`, `scripts/check-updater-compat.mjs:134` and `:142`). The four places that
would carry a release TEST leg carry none: `.github/workflows/dev-ci.yml` has no `--release` anywhere and its Rust
test step is `cargo nextest run --workspace --all-features` at `:244`; `scripts/check.sh` has none (nextest at
`:106`, doctests at `:107`, the fallback at `:110` — all debug); `scripts/release.sh` has none (its single test
step, `cargo nextest run --workspace --all-features ... --profile ci` at `:65`); `scripts/run-pre-push.py` has none.
So the profile that ships is the profile nothing tests, and `cargo-check` is no substitute: it runs
`cargo fmt --all -- --check` (`dev-ci.yml:195`) then `cargo check --workspace --all-targets --all-features`
(`:197`), which TYPES the release cfg-arms and EXECUTES none of them — and no live workflow runs clippy at all
(`grep -c clippy` → 0 in `dev-ci.yml` and in `release.yml`).
The 1,309-vs-1,310 gap is not noise: exactly ONE test is compiled OUT of the release binary —
`#[cfg(debug_assertions)]` on `sync_probe_falls_back_to_cloud_url_when_unconfigured` at
`crates/oz-bridge/src/sync_tests.rs:35`. A release build silently shrinking its own test population is precisely the
shape this campaign forbids in fixtures, sitting in a test file nobody was running.

**Fact 2 — 40 of the 65 were one literal string, and that string is the sentinel arriving where no sentinel arm exists.**
It read `InvalidSubscriptionSignature / failed to decode base64 signature: Invalid symbol 95, offset 9`. Checked rather
than trusted: 95 IS the character code of `_` and 9 IS that character's offset inside `BOOTSTRAP_FREE`, so the
decoder is choking on the dev sentinel byte for byte. The arm that would have accepted it is gated
`#[cfg(debug_assertions)]` at `crates/oz-core/src/license_verification.rs:391` with the compare at `:392` — which is
why the same fixtures are green in debug, red in release, and why the count stayed INVISIBLE rather than merely unloved:
in debug this crate reports 1,310 / 0 and looks spotless.

**Fact 3 — the mechanism that fixed them, and the proof it is the right one.**
The shared helper is the discriminator. `grep -c seeded_row_loads` → **12** in
`crates/oz-bridge/src/audit_tests.rs` and **16** in `crates/oz-bridge/src/audit_security_events_tests.rs` — the two
files contributing **ZERO** release reds — against **0 at HEAD** in every one of the nine files that DID go red
(the tenth, `subscription_tests.rs`, reads 30 there because its conversion is committed). The converted fixtures
are green in release; the 65 are a population that never adopted the helper. So the repair is not
new logic, it is adoption, and the campaign holds two rules about how:
1. The fork is a RUNTIME `if seeded_row_loads()`, never a `#[cfg]` arm — both arms compile in both profiles, so
   attribute-gating one side of a runtime fork is not a smaller change, it is a broken one.
2. Every release arm asserts the seeded row EXISTS before it asserts anything about the projection, because
   `seeded_row_loads()` (`crates/oz-bridge/src/testing.rs:210-216`) collapses FIVE distinct causes into one bool — no
   default row, a load `Err`, `load_public_key()` failing, the intended base64 reject on the sentinel's own text, a
   genuine RSA mismatch — and a fail-closed fact asserted about an ABSENT row proves nothing. Accordingly
   `FAIL_CLOSED_*` (`testing.rs:226`, `:235`) appear only as the right-hand side of an `assert_eq!` and NEVER as a
   condition; the rule is written into the converted files themselves at `audit_tests.rs:185` and
   `audit_security_events_tests.rs:102` ("Assert form ONLY, never `if FAIL_CLOSED_GATES_LOCKED { .. }`").
And no fixture may simply mint a signature: `verify_license_signature` (definition at
`crates/oz-core/src/license_verification.rs:387`) has FOUR call sites — `crates/oz-core/src/subscription.rs:476`,
`crates/oz-bridge/src/license.rs:594`, `crates/oz-core/src/license_verification.rs:484` and `:527` — and NOT ONE of
them belongs to a test. There is no seam, so the only honest fork is on which row the seed produced.

**The scoreboard as this entry is filed.**
65 → **44** after `f456f1298` forked `crates/oz-bridge/src/subscription_tests.rs` (+500/−120; the file went 881 → 1,261
lines). Its own filtered release run went 13 passed / 21 failed → 34 / 0, and the crate's DEBUG total is unchanged at
1,310 / 0, so nothing was traded away to buy the release greens. Remaining population: pos 7, auth 14, workspaces 5,
inventory 4, staff 4, locations 2, staff_security_events 2, terminals 2, security_scoped_integration 4 — which sums to the
44. TWO OF THEM MUST NOT receive the template, and that is the part a checklist would flatten:
`crates/oz-bridge/src/staff_security_events_tests.rs` is ruled OUT because release WRITES its audit row, so the skip-arm
a conversion would install can never fire (noted as found: the lane's shorthand for this was a `loaded:false` marker, and
`grep -n loaded` over that file and over `crates/oz-bridge/src/testing.rs` returns no hits — the argument is the
WRITE-side one, not a marker in either file). And `crates/oz-bridge/src/auth_tests.rs:816-839` needs its fork DELETED and
its name corrected rather than converted: `staff_login_on_free_records_only_because_a_debug_build_promotes_it` at
`:817` already asserts against `usize::from(cfg!(debug_assertions))` at `:836`, which is a runtime-attribute hybrid,
not a fork on the seeded row.

**The honest limit, written because a journal that records only wins is marketing.**
This campaign SHRINKS the red count; it does NOT add a release leg. So 65 → 44 repairs a POPULATION and changes nothing
about what CI can see: the NEXT `--release`-sensitive test lands unfixed and uncounted, exactly as these 65 did, and the
only reason they were found at all is that somebody typed a flag by hand. The missing piece has a name — one
release-profile test step, somewhere in `.github/workflows/dev-ci.yml` or `scripts/check.sh`. This entry deliberately does
NOT propose, write or enable one: adding or changing a CI step is an owner decision and a workflow edit, both out of this
fence, and `scripts/gates.json` plus `scripts/verify-agents-mirrors.py` police what the mirrors may CLAIM about CI —
which is exactly why an absence is recorded here, in the first person, before it becomes a mirror sentence.

**Verification:**
- LANE-RUN, not re-executed by this docs pass (no `cargo`, `npx`, `npm` or `docker` was invoked here): the release
  65 / 1,244 of 1,309, the debug 1,310 / 0, the 13/21 → 34/0 filter result and the per-file 7/14/5/4/4/2/2/2/4. Their
  arithmetic is consistent and was checked: 65 + 1,244 = 1,309, and 1,309 + 1 = 1,310 — the +1 being the one debug-only
  test at `sync_tests.rs:35`.
- Re-measured against the tree this pass: the `--release` file set under `scripts/` and `.github/workflows/` (builds
  only, and the one workflow hit is a `.bak`); the four no-release-leg places at `dev-ci.yml:244`, `check.sh:106`,
  `:107`, `:110`, `release.sh:65` and `run-pre-push.py`; `dev-ci.yml:195`/`:197`;
  `grep -c seeded_row_loads` = 12 and 16 in the two green files, 30 in the converted `subscription_tests.rs`, and 0 in
  each of the nine red files AS COMMITTED (one of them, `pos_tests.rs`, is mid-conversion on disk — see the next bullet);
  `testing.rs:210-216`; the sentinel arm at `license_verification.rs:391-392`; the four
  `verify_license_signature` sites; `git show --numstat f456f1298` = 500/120 on one file; and `_` = char code 95
  at offset 9 of `BOOTSTRAP_FREE`.
- Two briefed figures did NOT reproduce, recorded as found. (a) Asserts in `subscription_tests.rs` read **158 → 203**
  (`git show <blob> | grep -oE "assert(_eq|_ne|_matches)?!" | wc -l`), not 158 → 257. The ZERO-deleted half of that claim
  DOES hold: `git diff -w f456f1298~1 f456f1298` removes 11 lines, 7 of them containing "assert", and all 7 of those
  exact strings still appear in the post-commit blob with the same counts — the only two genuinely vanished lines are one
  call expression and one comment. (b) The file declares 30 test functions before AND after the fork
  (`grep -cE "^#\\[(test|tokio::test)"`), so the filter's 34 counted 4 tests living outside this file; the ratio
  13/21 → 34/0 is the run's, and this entry does not rename it.
- Live as of filing: `git status --porcelain -- crates/oz-bridge` lists ` M crates/oz-bridge/src/pos_tests.rs`, whose
  on-disk copy already carries 11 `seeded_row_loads` uses against 0 at HEAD — the pos 7 is being converted right now by
  its own lane. No figure in this entry is offered as a standing property of the tree.
- `python3 scripts/verify-agents-mirrors.py` → exit 0 before and after this append ("all 2 mirrors agree with the repo").
  Docs-only; nothing pushed.

**Commit:** single pathspec commit `docs(records): the release profile has no test leg and it held 65 failures`.

## 2026-09-15 — Trade: the release-profile fixture campaign cleared every mechanical red and spent five security claims to do it

**Context:** Four days of sessions and roughly twenty boxes tonight, against `crates/oz-bridge`. The campaign
started where the previous entry left it — **65 red / 1,244 passed of 1,309** in `--release`, **1,310 / 0** in
debug — and forty-one of those sixty-five shared a single cause: a debug-only subscription promotion of the seeded
tenant row, so a release build propagates an `InvalidSubscriptionSignature` refusal (offset 9, invalid symbol 95,
the `_` in `BOOTSTRAP_FREE`) where the test expected a domain gate to decide. Converting a fixture meant forking it
on the runtime seed-row predicate. Every mechanical red is now gone.

- **Where it stands, and what is quoted versus measured.** The crate is reported at **1,307 passed / 2 failed / 0
  ignored** in release against a debug leg of **1,310 / 0 / 0 held across six consecutive runs**. Those four figures
  are **as printed by the lanes**: no test runner was executed in this pass — none is permitted — and no tracked log in
  the repo carries them. The start-of-campaign 65/1,244/1,309 and the debug 1,310 ARE a recorded run, at this page's
  own `## 2026-09-15 — Absence` entry above. One collision to avoid reading as a confirmation: this page already
  prints "1307" at the 2026-09-14 licensing entry, where it is a different arithmetic coincidence
  (`1231 + 76 = 1307 = 1308 − 1`), not tonight's release total. What this pass DID measure statically: the two named
  reds exist at `crates/oz-bridge/src/auth_tests.rs:898`
  (`staff_login_on_free_records_only_because_a_debug_build_promotes_it`) and
  `crates/oz-bridge/src/staff_security_events_tests.rs:245`
  (MARKED, not silently repointed, 2026-09-15: `:245` was the true line when this entry was committed as `db43bcfb5` at 05:46:01 +0700, and `f2d147dd7 refactor(bridge): give the seeded-row refusal helper one home instead of eight copies` landed **fifty-nine seconds later** at 05:47:00, rewriting 53 lines of that file — the same test is at **`:194`** at HEAD `7e893bc2c`, located by NAME and not by the number on this page: `findstr /N /C:"a_rejected_create_records_no_security_event" crates\oz-bridge\src\staff_security_events_tests.rs` → `194:`. That is a citation aging inside the minute of its own landing, which is the defect this whole session has been hunting, and it is why the survivable form of a line number here is the pair — number plus the SHA it was read at. Re-checked in the same breath: `auth_tests.rs:898` has **not** moved, and the only other figure in this entry that aged the same way is `146 uses` of `seeded_row_loads`, now **144** at `7e893bc2c` after the same deduplication — left as written above, because it was true at its SHA, and named here rather than rewritten.)
  (`a_rejected_create_records_no_security_event`) — `git grep -n <name> -- crates/oz-bridge`, both single hits; and the
  fork predicate itself, `git grep -o "seeded_row_loads" -- crates/oz-bridge | wc -l` = **146 uses across 13 files**
  (top: `subscription_tests.rs` 30, `auth_tests.rs` 17, `audit_security_events_tests.rs` 16, `audit_tests.rs` 12,
  `pos_tests.rs` 11, `testing.rs` 9). Note the unit: a use of the predicate is not a fixture, so 146 does not confirm
  the briefed "53 fixtures across 10 legs" and is not offered as doing so. `crates/oz-bridge/src/testing.rs` is
  confirmed present. Three files in that crate — `testing.rs`, `staff_tests.rs`, `staff_security_events_tests.rs` —
  are ` M` right now while a lane extracts a shared helper, so no per-file count here is a standing property of the tree.
- **The trade, per test rather than per vibe.** Forking on the seed-row predicate makes the REFUSAL arm explicit and
  leaves the PERMITTED arm debug-only, so the shipping profile no longer exercises five specific properties:
  ticket rotation end to end; the ADR-47 grant-containment claim that staff identity is global while business data is
  per-store — in the test named for it; the ADR-48 impersonation and restore-revocation claims; the licence TTL
  claims; and now the staff write-side audit trail, which is all eight assertions of the create-event fixture including
  that the actor id is not the subject id and that a PIN never reaches the table. What survives is narrower and should
  be stated with the loss: the update-path event and the PIN-change behaviour are still exercised in release, because
  that command does not cross the create gate.
- **The two reds that remain are deliberate, not residue.**

  `staff_login_on_free_records_only_because_a_debug_build_promotes_it` asserts a debug-profile admission — its own
  name is the finding — and `a_rejected_create_records_no_security_event` would go green if it were forked while its
  subject stopped being exercised, leaving the final comparison to hold for the wrong reason. The sentence a lane wrote
  into that file is the thesis of this whole campaign, and it is quoted here rather than cited because it is not in the
  tree at filing: "a green that asserts nothing is worse than a red with a reason". Its closest tracked cousin is
  `.agents/naked-read-sync-conflicts.md:41`, "A pin that cannot fail is worse than a red", which is the same argument
  about a registration floor.
- **The one fix that would bring the five properties back**, and it is not a docs edit: a test-support seam that
  produces a genuinely valid signature instead of a promoted forgery — real key material in the fixture, so neither arm
  has to be profile-conditional. **This is an owner decision, and as of this entry it is NOT on the owner page:**
  `docs/plans/notes.md` runs items 1–11 today and item 8 is "The selector-class conflict: three names that only a test
  can see", not this. `git grep -rln "promoted forgery" -- docs .agents *.md` returns nothing. Recording it here is the
  substitute for recording it there until the page's owner accepts a twelfth item.
  **Dated 2026-09-15, that decision now has a triage surface, and this line is the pointer, not the record:** `docs/plans/notes.md` item `## 12. Does the release profile keep exercising the permitted arm — and what comes back if the seam is built?` (at `:1370`, landed with item 13 in `14b40a839`), which carries the five claims, the surviving half and the recommendation to build the seam; item **13** beside it now holds the tier-refusal ruling that `auth_tests.rs:898` was carrying alone. One more line while the profile question is open, because it is the same disease seen from the CSS side and a reviewer measured it tonight: `composedRuleIdenticalPair.test.ts` prints a pass count and NO denominator in a normal run — its graded-of-composed figures live in its header prose and in a failure message, not in green output — so a green from a walker is not a coverage statement, exactly as a release green is not security coverage. The percentages themselves belong to `AGENTS.md` and its mirror, where a lane is writing them now, and are not restated here.
- **Method notes, because these cost real hours and are portable.** (1) Assert counts must come from a char-exact
  statement walk; a bare `grep -c assert` has misled four lanes this week, and it under-reads on `assert!(` split
  across lines as much as it over-reads on comments. (2) A helper that counts WRITTEN rows must never be handed a
  predicate that skips only LOADED rows — the two sets differ exactly where a fixture is inert. (3) `FAIL_CLOSED`
  codes belong on the right-hand side of an assert, never in a `let`, or the compiler is glad to help a test pass
  vacuously. (4) A module named for a file path is not the module path once a `#[path = …]` attribute is involved —
  resolve the attribute before blaming the wrong file. (5) A pathspec commit assembled from `git status` will sweep
  another session's files into your message; it happened once tonight and was reported rather than hidden — name paths
  you inspected, per root `AGENTS.md` §3.

**Commit:** single pathspec commit `docs(journal): close the release-profile fixture campaign and record what it traded away`.


## 2026-09-15 — Retraction: `refs/remotes/**` was described as unwritable for a day, and it is not (git/operational)

**Context:**
`todo-operational-integrity.md` Phase 3 was authored 2026-09-14 on a reproduction it printed in full: `git update-ref refs/remotes/origin/__probe <sha>` returning **exit 0 with no error** while `git rev-parse --verify` then failed `fatal: Needed a single revision`. `[carried]` It was reported 5/5 reproducible that day via three explicit-refspec fetches, one plain fetch and one `update-ref`, with `refs/probe-tmp` succeeding where `refs/remotes/origin/probe-tmp` did not, and filesystem, hooks and config each ruled out by direct test. The plan drew the natural conclusion — the remote-tracking namespace specifically was broken — warned that no new remote branch could be tracked by the normal mechanism, and asked for the cause. A read-only review at HEAD `5ca3cd5c0` on 2026-09-15 re-ran that exact reproduction instead of inheriting it, and it did not reproduce.

**Changes:**
1. Nothing was "fixed" in the repository, because there was no repository defect to fix — which is the finding, not a missing action. The Phase 3 claim was retracted in `todo-operational-integrity.md` by its own append-only convention (the dated correction landed as `docs(plans): re-derive operational-integrity claims and correct its own census`), so the failing symptom is recorded as a dated measurement that no longer holds rather than deleted.
2. The review's single write into shared `.git/` state was the probe itself — `git update-ref refs/remotes/origin/__review_probe <HEAD>` — and it was reverted with `git update-ref -d` on both probe names. Verified by ref count rather than assumed: `git show-ref` back to **77**, `refs/remotes` **74**, zero `__probe|__review_probe` matches, `refs/heads/**` untouched at exactly `heads/0.0.39` and `heads/main`, no tracked file modified.
3. `.git/refs/remotes/` exists, is empty, is a plain directory (not a reparse point), and its ACL is byte-identical to `refs/heads` and to `refs` itself — Administrators/SYSTEM FullControl, Users ReadAndExecute, Authenticated Users Modify, all inherited. Nothing in the directory's own metadata distinguishes it from the namespace that was already known to work.

**What it means:**
The write now **lands**: `update-ref` exits 0, `rev-parse --verify` returns the sha as a single revision, `for-each-ref` resolves it, and the loose ref file appears on disk under `refs/remotes/origin/`. A scratch repository (`git init` in `$env:TEMP`) created under `git version 2.50.0.windows.2` also creates `refs/remotes/origin/<name>` normally, so the git binary is healthy in general and this was never a git bug — which means the earlier 5/5 reading measured a state, not a mechanism, and the mechanism was never isolated.

**What survives, and it is not a defect:** `origin/main` is still `ec2edf258` — by `git ls-remote --heads origin refs/heads/main` and by `git rev-parse origin/main`, which agree — while `git rev-list --left-right --count origin/main...HEAD` reads `0 544`. The remote-tracking ref is stale because **nobody has fetched or pushed**, not because the namespace rejects writes. Two consequences a future session should carry: (a) the plan fused a falsifiable claim with a true one, and only the stale-snapshot half is still owed; and (b) the parked instruction to "get it agreed first" before any ref write is defensible caution, but it froze a claim that a *reverted* probe settles in seconds — a probe with cleanup is the missing third option, and naming it would have cost less than a day of the plan asserting a defect that had gone away. The plan's remaining honest state is a **HEAD-sync gap**, not a ref-store failure, and **544 commits now exist on one machine**.

**Verification:**
- Reproduction, run in this checkout at HEAD `5ca3cd5c0`: `git update-ref refs/remotes/origin/__review_probe $(git rev-parse HEAD)` → exit 0; `git rev-parse --verify refs/remotes/origin/__review_probe` → the sha, exit 0; `git for-each-ref refs/remotes/origin/__review_probe` → `<sha> commit`. The plan's own triple, inverted.
- Control: the same `update-ref` against a fresh `git init` repo in `$env:TEMP` also exits 0 and creates the ref, so the success is not specific to this checkout's history or config.
- Cleanup verified, not assumed: `git show-ref | Measure-Object -Line` → 77 (pre-probe count restored); `git for-each-ref` namespace tally → `refs/heads` 2, `refs/remotes` 74, `refs/tags` 1; `git show-ref | Select-String '__probe|__review_probe'` → empty; `cmd /c dir /a /b .git\refs\remotes` → empty.
- Stale-snapshot half re-measured the same pass: `origin/main` = `ec2edf258` from both `ls-remote` and `rev-parse`; `origin/main...HEAD` = `0 544`.
- Environment facts the retraction depends on: `git version 2.50.0.windows.2`; no `GIT_DIR`/`GIT_WORK_TREE`/`GIT_COMMON_DIR`/`GIT_INDEX_FILE`/`GIT_OBJECT_DIRECTORY` set; `remote.origin.fetch` = `+refs/heads/*:refs/remotes/origin/*`; `.git/packed-refs` holds 74 `refs/remotes/origin` entries including `refs/remotes/origin/main`.

**Commit:** the retraction is recorded inside `todo-operational-integrity.md` by the dated correction committed as `docs(plans): re-derive operational-integrity claims and correct its own census`; this entry is the separate journal record Phase 3's row asked for, so a future session finds the outcome where it looks for defects rather than re-deriving it from scratch — never push without a direct user order.



## 2026-09-15 — KDS refactor lane: closed by owner rulings, one clamp ruling fixed, and the plan's own check:all run (kds/docs)

**Context:**
`todo-refactor-kds-agents-1/2.md`, superseded 2026-09-14, were reviewed at the user's request; their successor `todo-refactor-kds-agents-merged.md` still carried seven open boxes, all dispositions, plus one filed-but-unfixed finding: the SLA clamp disagreement — the settings UI offered 30/60-minute yellow/red ceilings while `hooks/useTicketSla.ts` silently capped 14/15 (840/900 s), so a saved red of 60 min honored at 15 with no feedback.

**Changes:**
1. Owner rulings (one sitting, all four questions, recommendations accepted): `KdsTicketLineItem` and `KdsTimerBadge` relocations REJECTED permanently (the markup and the SLA view stay in `KdsTicketCard.tsx`; the rule stays single-sited in `useTicketSla.ts`); `KdsHeaderToolbar` REFUSED as a pass-through (the header is already decomposed into KdsHeaderLeft/Tabs/Right + ZoneChips); reduce-to-composition-root ruled ACHIEVED at 634 ln; both commit milestones CANCELLED / closed as the `refactor(kds)` series; the `todo-kds.md` global-saas precondition retired as UNBLOCKED.
2. The clamp ruling landed TDD-first as `3df117977`: minute ceilings now DERIVE from the engine ceiling — `useTicketSla.ts` exports `SLA_YELLOW_MAX_SEC`/`SLA_RED_MAX_SEC`, `kdsThresholdMinutes.ts` gains `YELLOW_MAX_MIN` (14) / `RED_MAX_MIN` (15), the hamburger sliders no longer offer 30/60, and `WorkspaceKdsSettings` clamps legacy persisted values at hydration so a pre-ruling `45` cannot display or re-save as if honored. Board behavior: unchanged, zero. Three new cross-surface cases pin UI-minutes x 60 == engine-seconds for every raw minute 1..120, written Red first — they failed against the pre-fix code at exactly the filed numbers (3600 s vs 900 s).
3. Plan docs synced and the merged checklist closed to 0 open / 23 ticked at `6806d9ab0`, every flip carrying a dated `OWNER RULING` comment.

**Verification:**
KDS scoped surface 74 files / 956 tests green, re-run twice during the session; clamp/SLA/hamburger neighbors 121/121; workspace-card suites 62/62; `npm run check:all` RUN for this plan the first time at HEAD `b623227cc`: 6 passed, E2E `SKIP (Docker not available)` by the script's design, vitest FAIL with 3 tests — ALL foreign (committed `RestaurantMenu.css` popover state from `1fb8cc643` + the sales lane's uncommitted `--shadow-md` tail in a dirty `CartPanelLineItem.css`; `git show --stat` of both lane commits: zero `.css` paths). §4 waiver applied on that record — same shape as the enterprise-mocks `d316a0b5b` earlier tonight — and the plan renamed IN PLACE to `done-todo-refactor-kds-agents-merged.md` at `273b0a455`.

**What it means:**
The KDS decomposition lane is closed — code, docs and acceptance record. The superseded sources stay `todo-` by rule (superseded is not done); their final-sync blocks tell the story from the old names. The only open item is the push, which awaits an explicit user order.

**Commit:** this entry rides its own single pathspec commit `docs(journal): record the KDS lane closure, fix and §4 waiver`, following the lane's `3df117977`, `6806d9ab0` and `273b0a455` -- never push without a direct user order. <!-- 2026-09-15 correction, same pass: the landed subject lost the `§` in the shell — the real commit is 03fb20622 `docs(journal): record the KDS lane closure, fix and 4-waiver`. Quoted as it actually reads; no amend per the repo's own recovery rule. -->

## 2026-09-16 — the popover red two plans each blamed on the other gets repaired from outside (css/restaurant)

**Context:**
The KDS cleanup pass ran `check:all` and found 3 foreign failing tests: 2 belonged to `popoverSurfaceCompliance` flagging `.restaurant-hamburger-dropdown` in `features/restaurant/RestaurantMenu.css` at `var(--color-bg-surface)` (committed by `1fb8cc643`). The pos-screen and KDS plans each recorded it as the OTHER lane's item, so nobody owned it; the continue-the-implementation order put the repair-then-commit row of the cleanup table in reach.

**Changes:**
`f8c017428 fix(restaurant): move the floating dropdown onto the popover bg token (THM-08)`: the background leaves the shared geometry rule — sidebar keeps `--color-bg-surface` (docked panel), the dropdown takes `--color-bg-popover` (the token ContextMenu, StoreSwitcher and LocationPicker already use). First attempt — a later override rule — FAILED the guard and is the lesson worth keeping: `popoverSurfaceCompliance.test.ts` walks EVERY rule block naming a floating selector (`ruleBodiesFor`, the `for (const body of bodies)` check), so a cascade override cannot pass while any naming rule carries a non-popover background. The guard cannot be out-ordered, only obeyed.

**Verification:**
`popoverSurfaceCompliance` 3/3 green. Whole-tree `npx vitest run`: was 2 failed files / 3 failed tests → now **1 failed file / 9,985 passed**, the sole red the sales lane's UNCOMMITTED `--shadow-md` tail in dirty `CartPanelLineItem.css` — a live-lane working-tree property, not a committed defect; it dies when that lane commits its own coursing queue item.

**What it means:**
Every committed red `check:all` carried is gone bar one that only the owning lane can clear. And the `__probe_remote_import.css` that sat untracked during the review self-deleted within ten minutes exactly as its own header promised ("deleted in the same pass") — the probe-with-cleanup is the third option between committing and deleting, and leaving live lanes alone was what let it clean itself.

**Commit:** single pathspec commit `f8c017428`; this entry rides its own docs(journal) commit -- never push without a direct user order.

## 2026-09-16 — the router consolidation gets its state-move, and the lane hands off mid-checklist to a faster sibling (dev-mock)

**Context:**
After the push, the "continue" order found the git-cleaning loop fully converged: every dirty path belonged to a lane active within minutes (the tablet lane committed `purchasing.rs` as `095e744d0` WHILE classifying; the qris/cloud "00:06 cluster" failed the whitespace-invariance test — only 4 of 22 files were fmt-only, the rest substantive WIP; the sole tree red was proven to be the literally uncommitted `+ box-shadow: var(--shadow-md, ...)` line in the sales lane's dirty CSS — HEAD itself green, 581/582 files). The one zero-work plan left was the lane this session's earlier round had opened: `todo-refactor-devmock-router-consolidation.md`.

**Changes:**
Phase 5.1's state-move half, `99a68348f`: `handlers/locationState.ts` created, owning `mockStores`, the ticket-prefix pair and `unwrapArgs` verbatim — the shared-state knot `-4:190` had called the real blocker; the router's four surviving regional/receipt readers go through `getMockStores()`; the dangling Legal-Entity comment from an earlier move deleted; router 851 → 767 lines. The plan had grown a "DO NOT TOUCH tauri-api.ts — IN FLIGHT under another session" hold naming the exact same file; the hold described an attempt that had evaporated (untracked file gone, pre-move porcelain empty), so the phase was RE-DERIVED FROM ZERO against a freshly measured snapshot, and `4c81455b4` resolves the hold on the plan so it cannot mislead the next reader.

**Verification:**
Before-snapshot re-derived at THIS HEAD, not quoted from memory: 681 keys / sha `105d29730df2`; after-move identical (throwaway dump test, run both sides, deleted — the plan's no-artifact pattern); `npx tsc --noEmit` 0; dev-mock suites 7 files / 96/96.

**What it means:**
Two findings generalise. First: the measurement discipline paid off immediately — the digest is a timestamp, and the plan's own net-rule (re-derive, never trust 681) is what made the vanished-lane overlap safe instead of destructive. Second: minutes after the state-move landed, another session began executing Phases 5.2 and 5.3 ON TOP of it (`48c3f8027` bundles, `f0b2dc312` sync) and was editing the router for 5.4 (`kds-devices.ts` at 05:25, router mtime 05:26:15) — the guard claims were released rather than racing a live editor. In a shared checkout the right move when someone is writing your next file is to hand them the foundation you verified and keep the measurement history — the reduction lands either way; only its proof needs an owner, and right now that owner is this lane.

**Commit:** `99a68348f` + `4c81455b4`, this entry rides its own docs(journal) commit -- never push without a direct user order.

## 2026-09-16 — the conversion half landed; the two devmock lanes stood down from each other and the invariant held (dev-mock)

**Context:**
The journal entry above recorded the state-move and said the factory-conversion half "has not run". It has now run — superseded here, that entry kept as the dated record it is. What happened around the landing is the notable part: the sibling lane that had executed Phases 5.2/5.3/5.4 WHILE this lane worked, watched this lane's conversion sitting uncommitted in the shared tree, correctly identified it as another session's in-flight work (it found even this lane's throwaway probe by name), measured it, and STOOD DOWN — and this lane, seeing their commits land mid-round, released its own router claims rather than racing them. Neither lane ever edited the router while the other's edits were uncommitted; the plan file became the message queue.

**Changes:**
`55a71106d` opens `handlers/regional.ts` (the regional pair + receipt-format trio — the regional keys joined because no later phase owned them and they would have stranded past 5.5); `ca08178ae` opens `handlers/terminals.ts` (the six device-binding stubs whose "properly-named home" `handlers/workspaces.ts:17-19` had declined them into asking for); `93ed08fc5` wires the router: 22 keys out of `entryHandlers`, the four maps registered, router **710 → 447 lines**, literal keys **54 → 4** across the five Phase 5.x moves. The brand twins landing in `settings.ts` broke `dev-mock-scoped-aliases` "settings twins were NOT overwritten" (9 vs a frozen 8) — the guard's own "Re-measured, not copied" doctrine was the update path: re-measured with dated attribution inside the wiring commit, non-clobbering re-verified.

**Verification:**
The Sibling's stated condition — land it, then re-dump at HEAD — executed: committed-state dump prints **681 / sha256 `105d29730df2`…, byte-identical to the Phase 5.0 before-snapshot and to every checkpoint of all five phases** (throwaway, run, deleted); tsc exit 0; dev-mock/regional/receipt filters 13 files / 146 green; whole-tree 1 failed | 582 passed, the one red the unchanged foreign CSS tail.

**What it means:**
Two lanes can now be cited as the protocol model for this checkout: claims released mid-flight when the other side is writing, frozen-guard populations updated only by re-measurement inside the commit that legitimately moved them, and a registration-invariant digest held across 54 keys' relocation by five different moves. What remains on the router is the lane's own inventory: two deferred singletons (`get_local_ip` → system, `get_low_stock_alerts` → inventory), the ~20 cross-domain patches, the two spreads, `pushKdsOrderFromCart`, and the <200-line 5.5 target.

**Commit:** `55a71106d` + `ca08178ae` + `93ed08fc5` + the docs(plans) tick commit; this entry rides its own docs(journal) commit -- never push without a direct user order.

## 2026-09-16 — Phase 3/R2 lands red-then-green: the probe and the pin now answer through the scoped gate (topology)

**Context:**
The owner ratified all four section-5 rulings ("we go with your recommendation"); the armed goal works them smallest-blast-radius first. R3/M5 had closed the same morning (`a718dd1e4`, three-becomes-four sites). This entry covers R2: the F2 probe/enforcement disagreement and the M3 scope-free pin.

**Changes:**
`4efcb0971`: `can_save_topology` takes the branch it probes (bridge + desktop shim + `ui/src/api/topology.ts` all threaded), and both the probe and `pin_topology_revision` now gate through `require_user_permission_scoped(…, branch_id, None)`; the two "global admin tool" comments that asserted the opposite policy were rewritten citing the ruling. Two-stage TDD: stage 1 wired the parameter while BOTH bodies stayed scope-free — the new `probe_and_enforcement_agree_for_a_branch_scoped_writer` failed exactly at the R2 assertion (`57 passed; 1 failed`), with the four older role-based probe assertions holding green so the delta is provably scope, not role. Stage 2 swapped the bodies: `58 passed; 0 failed; 0 ignored`.

**Verification:**
The acceptance printed at the wired state: `cargo test -p oz-pos-app --lib topology` 58/0; `cargo test -p oz-bridge topology` 314/0 (baseline exact); `verify-ipc-parity.py` OK exit 0 (names-only gate — the signature change needed no allowlist entry); `api-topology-contract` + `api-ipc-contract` + `dev-mock-stores` 63/63 (the added `branchId: undefined` key passes frozen payload pins by undefined-equality — recorded so a future wrapper change re-verifies rather than assumes it). Ticked with a REACH note: the modern screen gates client-side and never consulted the probe, so what was fixed is the registered command's ANSWER for any current or future caller — the disagreement was real, its user-visible blast radius was smaller than F2's prose implied.

**What it means:**
The plan's Phase 3 went from 5 NEEDS-RULING boxes to 5 ticked with prints in one round, and the two-store-plus-assignment fixture pattern now demonstrably lives in the DESKTOP test file — which retires the earlier "the harness cannot be built in 15 minutes" note's reach for Phase 1: the `:183` box had studied the BRIDGE file only. Next up in the goal: Phase 2/R1 (session-thread `load_topology`), then Phase 1/R4, which the fresh fixture makes materially less hypothetical.

**Commit:** `4efcb0971` + plan ticks `43090bf46`; this entry rides its own docs(journal) commit -- never push without a direct user order.

## 2026-09-16 — Phase 2/R1: the diagram read got its session, red first at the right assertion (topology)

**Context:**
The owner-ratified rulings run smallest-first under the armed goal; Phase 3/R2 closed this morning. R1 was the plan's M1: `load_topology` answers with no session at all while `load_topology_template` justifies its session check by saying a template reveals a branch's configuration — and a live diagram reveals strictly more. The ruling chose the three-layer fix and cancelled the comment branch.

**Changes:**
`8286f43ae` (13 files, +184/−47): `session_token` first in the bridge signature, resolved BEFORE any settings lookup; desktop shim forwards; the UI wrapper always sends a payload object now (the old no-branch quirk of a whole-`undefined` payload died with the change, and both contract tests pin the new wire); the load-lifecycle hook gained a sessionToken dep fed from the editor's own `useWorkspace`; TopologyScreen's three sites took the house no-session guard, the history button degrading like a failed fetch; nine older command tests seed a documented constant-token session; the new `load_topology_requires_a_session` proves both arms (unknown token refused, live session reads the same row).

**Verification:**
Stage 1 (wired, unenforced) printed the honest red: `58 passed; 1 failed` with the failure AT the refusal assertion — behavior, not compile (the path from `&State<AppState>` to `&AppState` through a generic method receiver needs `state::<AppState>().inner()`, discovered the expensive way in two extra builds). Stage 2: `59 passed; 0 failed; 0 ignored`; bridge `314/0/0` baseline held; `verify-ipc-parity.py` exit 0 (names-only, no allowlist entry); `npm run typecheck` clean — it caught three zero-arg test callers and the `string | null` screen tokens that esbuild-transpiled vitest happily ran around; UI contract + consumer suites 145/145.

**What it means:**
Two of four rulings now land with prints; Phase 1/R4 remains — the only one whose facts (which database holds a fresh branch profile's row) still need establishing empirically, and the fixture worry that blocked it ("needs a two-store harness") is now doubly retired: this round added a second reusable session-seeding pattern to the same file.

**Commit:** `8286f43ae` + plan ticks `docs(topology)` -- never push without a direct user order.

## 2026-09-16 — Phase 1/R4: the ownership gate finally reads the store it writes — and the fact clause outranked the literal recommendation (topology)

**Context:**
The last of the four ratified rulings, and the one whose recommendation contained an unresolved tension: R4 said "[global, effective], never [global, session] alone", while the gate block's own comment claimed fresh profiles live in the session registry — swapping literally would resurrect the forever-reject. The goal's fact clause pre-authorized choosing by established fact; this entry records the choice and how the facts were forced to speak.

**Changes:**
`32abb9cbb` (3 files, +538/−53). Facts first, by execution: the bridge's own green test (`locations_tests.rs:148-154`) pins that scoped creates write the profile row into the SESSION store db, and `create_store_db` runs migrations only — every new store db holds exactly one 'default' seed, never a self-named row. So the alignment ADDS the effective store's registry rather than swapping: gate and save now validate `[global, session, effective]`. Three new tests: the referee (`self_describing_store_passes_the_ownership_gate`) — a store whose OWN registry names it could not be written into before this commit, its red print (`unknown store_profile_id: char-gate-self`) is F1 made executable; the false-reject guard (session-row fresh-create flow, green before and after — its purpose is to make a wrong fix fail); and the accepted residual, pinned as documented behavior with an upgrade note (ANY-registry semantics survive; closing it fully needs the write-side self-seed, outside this fence). The red-first discipline caught an unplanned second site: after the gate was aligned, the referee STILL failed — at the SAVE boundary, whose `Some(&branch_db)` passes its own [global, session] ownership re-check. A theorized fix stopping at the gate would have shipped a one-armed alignment; the passing-through test found where the request actually died. The save function gained a registries-form twin with the 9-arg Option signature kept as a thin delegating adapter — zero edits across its 40-odd test callers.

**Verification:**
Referee red `61 passed; 1 failed`; after the save-site fix `62 passed; 0 failed; 0 ignored` (57.94s desktop) + `314 passed; 0 failed; 0 ignored` (6.94s bridge) + `verify-ipc-parity.py` exit 0 (tripwire, unchanged surface) + `rustfmt --edition 2024` clean scoped to the three files (the edition matters — these files carry let-chains; and workspace-wide fmt remains off-limits while other lanes are mid-edit). R4(a) needed no change: the existing char harness already proves out-of-scope named stores are refused — that half of the ruling was code-true before it was owner-true.

**What it means:**
All three ruled phases now carry EXECUTED records with prints; the topology program's open boxes are the two reviewer-judgement rows (:469/:471) that no ruling covers. Residuals named, not missed: the ANY-registry gap (T3 pin, upgrade note) and the create-and-migrate file side effect on rejected diagrams (recorded at the site). If a future lane adds the write-side self-seed, T3 fails on purpose and says so.

**Commit:** `32abb9cbb` + plan ticks; this entry rides its own docs(journal) commit -- never push without a direct user order.

## 2026-09-16 — Phase 7 closes, and with it the whole topology program: review found nothing to fix, and fixed nothing anyway

**Context:**
The last two NO-REFEREE rows (the F5 tautology sweep, the F1-shape handler pass) plus the standing no-fix fence. Executed as the ordered reviewer pass: read-only, findings into the existing review document, per the plan's own prescription that the deliverable is "a table, not an exit code".

**Findings (all recorded, none fixed):**
F5 across the 53-file canvas sub-surface: zero live hits — the one cited population member is the comment documenting an already-deleted tautology, and all seven restate-shape candidates read as genuine cross-consumer equivalence properties (one suite actively asserts the two-consumers-agree property F1 violates). F1 over pointer/keyboard/drag/touch/bend (2,349 lines total): zero tenant-scope reads in any handler file — the family is geometry-only; the tabulated scope layer (load/compare/history/apply/revision) keys every consumer on the same gated `selectedBranchId`. One second-order finding worth the wait: the revision-browser TEST helper snapshots baseRevision without a branch while deploying with one and passes only because the dev-mock's envelope is global — the T-1 divergence teaching a scaffold to rely on the wrong shape; filed as part of T-1's blast radius, not fixed.

**Verification:**
`d94bd313e` + `733d744e0` are the pass's only commits — both `docs(...)`, zero code paths, which is itself the fence's compliance record. The plan's open-box count is now 0 (`rg -c '^\- \[ \]' todo-topology-editor.md` → none). And the pass caught its own measurement lying: the first F5 sweep's clean 0 was PowerShell passing a glob literally into rg with stderr silenced — corrected to an explicit file list before any number was written down; the lesson went into the review document on purpose.

**What it means:**
The topology-editor program is closed: every one of its boxes has a dated record — executed, ruled-and-executed, reviewed-and-clean, or honored-as-fence. Open threads in the world: the push debt (~215), the T-1 mock ruling (still just recommended, now with a second dependent finding), and the sibling lanes' dirty clusters, which grew rather than died.

**Commit:** `d94bd313e` + `733d744e0`; this entry rides its own docs(journal) commit -- never push without a direct user order.

## 2026-09-16 — Absorb: the coursing pair lands on the desktop registration floor (desktop-client/records)

**Context:**
`b07e8c3ac` (10:03, with its feature `a8a5eeb79` at 09:51) registered `pos::set_line_course_scoped`
and `pos::publish_course_fired_scoped` in `apps/desktop-client/src/lib.rs`. Two names, both
arriving already gated: each shell body is one line delegating to `oz_bridge::pos::*`, and both
bridge fns resolve the session and call `ctx.require_session_permission(..., SALES_PROCESS)`
(`crates/oz-bridge/src/pos.rs:505` and `:591`). `gated_bridge_stems()` reads the bridge directory
and `names_permission` sees those calls, so neither command entered the debt ledger and no ceiling
moved — the only leg in the file able to see a command that arrives gated is
`drift_pin_registration_floor_is_met`, whose equality is against the tree. That leg has been red
on a clean checkout since the commit landed: `lib.rs registers 455 commands and this floor says
453`, proven by an isolated `HEAD` checkout rather than by reading a working tree a neighbour was
editing (`bash .agents/verify-lane.sh --head`, which exists because this lane committed once while
its own checks were red).

**Changes:**
1. `apps/desktop-client/src/commands/registration_gate_tests.rs:82` — `REGISTERED_FLOOR` 453 → 455,
   the number the harness prints rather than a chosen one.
2. Same file, `:6` and `:79-80` — the two prose measurements moved with the const, and the causal
   clause now names `b07e8c3ac` and the two `pos::` commands. The superseded 453 stays in both
   places as the dated predecessor, per this file's convention.
3. Deliberately untouched: both ceilings, `REGISTERED_SLACK` (24), and
   `registration_gate_debt.generated.rs` (still 447 total, 8 behind the tree and inside slack).
   A gated pair adds no debt, and widening an allowance in the same pass that raises a pin would be
   the wrong kind of green.

**What it means:**
This entry does not make the desktop gate green, and says so with numbers.
`drift_pin_debt_ceilings_only_shrink` still fails: **27** names in the
`resolves_session_names_no_permission` class against a ceiling of **26**, with
`no_session_resolution` at 42 under its 43. The second class is authenticate-then-assume, the
largest here, and its leg's own wording is "it moved without a decision" — so the honest options
belong to the owner: gate the one offending command, or raise that ceiling deliberately. This pass
did not take either. It also did not identify the offender, and that is a limit of the instrument,
not of the effort: the leg prints two counts and no names, and this lane declined to re-derive the
sweep's predicate in another language to find it, because a second implementation of
`resolves_session` is exactly the kind of fork this file has been keeping a single copy of. The
name is reachable by whoever regenerates the ledger: `registration_gate_debt.generated.rs` was last
written 14-09-26 and lists the class members, so a regenerated diff shows the addition as one line.
Attribution note, because the timing looked suspicious: the same two commands were the subject of
a parity-gate red earlier in the day that accused `set_line_course_scoped` of enforcing no
permission. That accusation was wrong and was a defect in `scripts/verify-ipc-parity.py`, fixed at
`c99abc832` by following the one-line delegation into the bridge. The red this entry absorbs is the
consequence of those commands being real and gated, not of that mistake.

**Verification:**
- Before: `cargo test -p oz-pos-app --lib drift_pin` → `5 passed; 2 failed`
  (`drift_pin_registration_floor_is_met`, `drift_pin_debt_ceilings_only_shrink`), exit 101.
- After: the same command → `6 passed; 1 failed`, exit 101 — the floor leg green, the ceiling leg
  still red by one name, and left that way on purpose.
- `grep -i 'set_line_course_scoped\|publish_course_fired_scoped' docs/records/JOURNAL.md` now
  names both commands in this entry; it named neither before.

**Commit:** single pathspec commit touching the gate file and this file together — the assertion
asks for one deliberate pass, so splitting the const from its record would reproduce the exact
failure mode the message describes. Never push without a direct user order.


## 2026-09-16 — T-1 executed: the dev-mock's topology envelope is branch-keyed like the backend it previews

**Context:**
The one open ruling from the topology program's Phase-6 review (`.agents/topology-canvas-review.md` §T-1): the mock's diagram envelope + revision counter were one global object while its history was already branch-keyed — so an apply at branch A answered branch B's load, and the reviewer pass had already caught a TEST relying on the wrong shape. Owner order today: "for T-1 lets fix it."

**Change:**
`ui/src/dev-mock/handlers/topology.ts`: one write-through slice per branch (`topologySliceKey`, mirroring `topology_setting_key`), the seeded first-run canvas now lives ONLY in the legacy unscoped slot, and `load_topology` answers a never-saved named branch with `null` — the real command's `Ok(None)` — which routes the preview through the editor's documented preset fallback. The dependent scaffold from the reviewer record is fixed in the same commit: the revision-browser deploy helper now snapshots the branch it deploys to. Three new parity cases in `dev-mock-stores.test.ts` pin what the global envelope made unobservable: never-saved answers null; an apply at one branch is invisible to another and to legacy; counters are per branch (B's fresh base-0 apply succeeds while A's stale base-0 rejects).

**Verification:**
`npx vitest run` over dev-mock-stores + TopologyRevisionBrowser + NodeTopologyEditorDevMock -> **21/21**; api topology+ipc contracts -> **55/55**; TopologyApplyConfirm characterization -> **22/22**. Registered-handler digest re-derived before and after via the throwaway dump test: **682 / `0afa39b2126b` byte-identical** — no command name entered or left the mock, exactly what a state-shape fix must not do (and the count moved 681->682 from a sibling's commit since morning, which is why the house rule says re-derive, never remember). Typecheck: one error, foreign and owned (a sibling's deliberate red in `CartPanel.test.tsx`, named in their own commit message).

**Commit:** `ec7b63175`; this entry rides its own docs(journal) commit -- never push without a direct user order.

## 2026-09-16 — KDS-2 closed: line-item and timer-badge relocated, Phase 2.2 reconciled as already paid, and the plan's own corrections honored instead of re-executed

**Context:**
`todo-refactor-kds-agents-2.md` — six open boxes behind an 11-hour-stale header. The plan's audit had already corrected its fence (KdsTicketCard long extracted; strike-through never existed; SLA thresholds live in `hooks/useTicketSla.ts`), and the tree had moved twice more since: `7d0dc4d60` and `fc29f3690` decomposed the header and grid into five components nobody had ticked.

**Work:**
Phase 2.1 executed for real: the course-group item loop and the SLA time+urgent badge moved out of `KdsTicketCard.tsx` verbatim into `components/KdsTicketLineItem.tsx` (memoized; `itemDone`/`fmtDuration` moved WITH their consuming JSX and are re-exported from the card so all nine importers keep resolving) and `components/KdsTimerBadge.tsx` (a 35-line view over the shipped hook — the correction "the risk is duplicating logic" honored to the letter). Both registered in `screenExtraction.test.ts` — and that guard proved it earns its keep: it ran red on the unregistered extraction and only went green when the entries landed, exactly as KdsHeaderLeft's registration comment promises. Phase 2.2 ticked as RECONCILIATION, not code: the header toolbar box describes a single file; reality ships a better three-way split (Left/Tabs/Right) plus zone chips, and rewriting decomposition under a new name is the move the plan's own KdsTicketCard precedent forbids. `exactOptionalPropertyTypes` caught one real typing subtlety on the way (optional prop vs explicitly-passed-undefined callback) — fixed in the component, not by loosening the caller.

**Verification:**
`npx vitest run Kds screenExtraction ModifierBadge` -> **77 files / 1308 tests passed**, card's 14 + five sibling suites unchanged (behavior-preserving relocation); typecheck -> sole error foreign and owned (a sibling's deliberate red, cited in their commit message). `622a33bfb` (4 paths, §3 new-file chain for the two components, hook bundle-parity 0 missing) + plan ticks `4c52547c6`. KDS-2's open-box count: **0**.

**Commit:** `622a33bfb` + `4c52547c6`; this entry rides its own docs(journal) commit -- never push without a direct user order.

## 2026-09-16 — Board-shrink sweep: seven "open boxes" triaged to zero code, two honest ticks, five re-verified dispositions, and the pile named what it is

**Context:**
The four coldest plans on the board (settings-2/3, tools, kds-agents-1) advertised seven open boxes between them. Pre-claim triage — the discipline the whole session has been converging on — decided what each glyph actually owed.

**Findings, box by box:**
kds-agents-1's two milestone rows: their PHASES had shipped under sibling subjects long ago (`c965baddb` keyboard relocation, `useNewTicketSound.ts` wired at `KdsScreen.tsx:159`, lifecycle landed as `useKdsRealtime.ts` per the :81 record) — ticked as evidence, the agents-2:118 precedent, no empty `refactor(kds-state):` commit filed. Settings-2's two RETIRED-with-proof rows: premises re-checked live (`panels/` absent, `sections/` holds 8) and the deliberate UNtick honored — those glyphs are dispositions, not work. Settings-3's AuditRetention row: still 0 hits for the symbol — the row is a tier-gated FEATURE wearing an extraction box; building product UI under a refactor glyph is scope inflation, so it stays open WITH its do-not-delete instruction confirmed. FactoryReset row: the recorded vocabulary-zero reproduces verbatim (grep exit 1 = the measurement). Tools' SaaS-scope row: parked-owner-ruling confirmed against the code — `enum ScopeType` at `assignments.rs:127` still refuses terminal scope "deliberately ... (ruling 1A)"; the (a)/(b)/(c) choice is unsatisfiable by a coder. Also folded in: KDS-2 renamed to `done-todo-*` under the owner's §4 waiver (`0ffebc667`).

**Verification:**
Five commits, all docs, all pathspec-clean: `0ffebc667` rename, `88e21cad3` kds-1 ticks (that plan now 0 open — renameable at the next word), `cce17ed3f` + `4f382332a` settings confirmations, `c7ece72a9` tools confirmation. Every dated note carries its re-check command; kds-1 is the sweep's only box-count change (7 open across the four plans before → 5 after, all five deliberate).

**What it means:**
The board's remaining open glyphs now decompose honestly: real work lives in exactly one cold plan (none), the rest are owner decisions (tools arm a/b/c; settings-3's two feature/product calls; operational-integrity's four) or deliberate dispositions no dispatcher should re-mistake. That pile is one decision-session deep.

**Commit:** five above; this entry rides its own docs(journal) commit -- never push without a direct user order.

## 2026-09-16 — The decision session: nine questions, nine answers, every one landed — and one form-violation recorded against myself

**Context:**
The board had drained of code: the remaining open boxes across the board were owner decisions wearing checkbox clothes. The owner answered all of them in one line — "1b 2yes 3yes 4c 5b' 6yes 7no 8a 9 close-close rename" — and this pass executed every answer.

**Rulings landed:**
Hooks (Q1b/Q2/Q3): the unnamed act that set `core.hooksPath` is now RATIFIED and ANNOUNCED — the announcement is the dated IN-FORCE clause in Quick Setup of BOTH AGENTS mirrors (sha-equal, `verify-agents-mirrors` exit 0), the fire-test box ticked on its 5e4183fa5 proof, the rollout row ticked as ruled. Main's fmt red (Q4c): accepted in writing — release artifact, not a working branch, the six whitespace hunks never travel. Backup (Q5 b-prime): regular `0.0.39` pushes declared the route, the plan's 473-commit figure corrected to its true exposure (dozens, against origin/0.0.39). Shape (Q6/Q7): four never-tickable prohibition checkboxes converted to prose standing orders — and deliberately NOT the settings-2 RETIRED dispositions, whose unticked glyph is their whole point; the two program files stay separate. Products (Q8a/Q9): terminal scope confirmed as designed with ruling 1A standing; AuditRetention NOT FUNDED (sweep runs unattended), FactoryReset WON'T OFFER (offline-first POS ships no wipe) — both ticked as RULED, no code written. Rename (kds-agents-1): the word was given inside the answers, so it landed as `done-` (34ddcfa75); settings-3 at zero-open was NOT renamed — its own header names the bar this pass could not cross (check:all with the Docker E2E leg), and the rule beats the temptation.

**Deviation, recorded per §3's own discipline:** I ran `git add` on the two AGENTS mirrors before their pathspec commit — unnecessary (both are tracked; the pathspec takes them from the working tree) and forbidden as a form. No harm materialised: the commit consumed the staged blobs, `git diff --cached` is empty after, and no sibling path was touched — but the rule exists for the shared index, and the correct answer to "did you violate it" is yes, filed here, not a justification.

**Verification:**
Six commits: `307dcdfe4` mirrors · `1960901cb` integrity (12 rows dispositioned: 6 ticked-as-ruled, 4 converted, 2 answered-in-place) · `50feeeb72` tools · `00b369785` settings-3 · `2e84122b6` settings-2 bound · `34ddcfa75` rename. Final counts: operational-integrity open 3 (NOT-WORK/records, zero rulings owed), tools 0, settings-2 2 (deliberate), settings-3 0 (kept `todo-` by its own acceptance rule). The board now has NO open owner-questions left from my programs.

**Commit:** six above; this entry rides its own docs(journal) commit -- never push without a direct user order.

## 2026-09-19 — The BOOTSTRAP_FREE ruling lands: the seeded Free row loads in every profile, and the migration was not finished until the comments were

**Context:**
The decision queue's Phase 1 had been parked on one owner ruling for three days: `todo-open-debt-program.md`
`:558` — "Until that ruling lands, `--release` cannot reach 0 failed". The question was the release profile's
treatment of `BOOTSTRAP_FREE`, the sentinel the init schema seeds into every fresh install. The owner ruled:
**the schema-seeded Free row must load in EVERY profile, and the sentinel is honoured only for a Free tier.**

**The ruling, and the security property it keeps.** `TenantSubscription::verify_signature`
(`crates/kasirmu-core/src/subscription.rs`) now accepts the sentinel whenever `tier_key()` is `free`, in debug
and in release alike. A sentinel-signed row claiming a PAID tier still falls through to the base64 decode and is
rejected there — the property the old `#[cfg(debug_assertions)]`-only arm was protecting, now expressed as a
tier condition rather than a build-profile one. Debug is a strict no-op: the sentinel branch was already
reachable there through `verify_license_signature`'s own any-payload short-circuit, so CI's debug
`--workspace --all-features` leg is unaffected. Only release changes, which is the point.

**What the ruling cost, and where it hid.** Honouring the sentinel in release made the seeded row LOAD, which
split one fork predicate into two questions. `crates/kasirmu-bridge/src/testing.rs`'s `seeded_row_loads()` had
been answering both, so 44 bridge fixtures that restamped a paid tier began taking the load arm in release and
asserting Plus/Pro/Premium capabilities a sentinel row cannot have; 40 more came from four guard copies
comparing a restamped row's verdict against the unstamped answer. The tablet crate had **thirteen** paid
fixtures with no fork at all — its `*_tests.rs` are private `#[path]` modules with no shared test module — and
had been red in release for months without anyone seeing it.

**Problem — the migration was not finished when the tests went green.** Splitting the predicate broke no call
site; it broke **37 comment blocks across 14 files** that re-derived the fork's rationale ("Release:
create_session propagates the seeded row's failed signature check"), a claim that had been true for years and
became false the moment release honoured the sentinel. The root claim sat in the authority module itself, which
carried a paragraph *arguing against the change that shipped* — "Making release accept the sentinel … would move
a licence bypass into the SHIPPED binary — a strictly worse trade" — plus a two-kind taxonomy the ruling had
just made three kinds. Nothing was red; only a reader was misled, and the next lane would have re-derived the
wrong model from it.

**Solution.** Corrected forward, authority first: the predicate's taxonomy, that paragraph, the guard's doc and
the tripwire test's doc in `testing.rs`, then the 37 call-site blocks — re-labelled *broken-seed fallback*
rather than deleted, because they still fire when the row EXISTS but does not verify. Two traps inside the pass:
my own edits moved the ~15 line anchors `testing.rs` cites, so the first correction pass was itself stale and
needed a second; and several anchors were already drifted ~50 lines beforehand
(`license_verification.rs:396` → `:435`, `subscription.rs:476` → `:521`). Proof the sweep changed no code:
stripping comment lines from both sides and diffing printed exactly one panic-message string in three files and
nothing else. The live gate rationales in `dev-ci.yml`, `docs/operations/ci-pipeline.md` and
`docs/releases/checklist.md` said "the release profile is where `BOOTSTRAP_FREE` stops verifying" and are
corrected to "…a sentinel-signed row on a PAID tier".

**Verification:**
`kasirmu-bridge` **1346/0** debug and release · `kasirmu-mobile` **677/0** debug and release ·
`cargo fmt --all --check` clean. Two outlier legs, both environmental and both re-measured green:
`kasirmu-mobile --release` first read 676/1 (the known mock-server flake), and a `kasirmu-bridge` debug leg read
**1345/1 in 14,789.81s (4h07m** for a 213s suite) — the failure was the documented `127.0.0.1` flake but it
failed in 5s, and `cargo nextest run -p kasirmu-bridge --lib --retries 0 --no-fail-fast` then ran **1346/0 in
232s with zero TIMEOUTs**, so nothing hangs and the duration is an artefact of `cargo test` running all 1346
tests as threads in one process. The test the debt program had recorded as *deliberately left red* is no longer
red and no longer needs to be: `grep -rn "DELIBERATELY LEFT RED" crates/ apps/ --include=*.rs` returns nothing.

**Commit:** four — `fd925d5c7` (fix + bridge migration) · `b1d7118` (tablet twin) · `4761f1bd9`
(cross-reference) · `31aa530fe` (comment repair); the live gate rationales and this entry ride the docs commit
that follows. Never push without a direct user order.

## 2026-09-20 — Absorb: the avatar write path lands on the desktop registration floor, and the ledger is regenerated rather than widened (desktop-tauri/records)

**Context:**
`f49170d3d` (feat(restaurant): add sidebar profile header, avatar write path, footer and row alignment)
registered three names in `apps/desktop-tauri/src/lib.rs` — `commands::avatars::{set_avatar_scoped,
get_own_avatar_scoped, clear_avatar_scoped}` — and touched neither the floor, the JOURNAL, nor the generated
ledger. The floor is an EQUALITY against the tree (`registration_gate_tests.rs:746`), so it has been red on a
clean checkout since that commit landed: `lib.rs registers 458 commands and this floor says 455`.

The three arrived GATED: each shell body is a shim over `kasirmu_bridge::avatars`, and
`crates/kasirmu-bridge/src/avatars.rs:61` calls `ctx.require_session_permission(session,
permissions::STAFF_UPDATE)`. `gated_bridge_stems()` reads the bridge directory and `names_permission` sees that
call, so no command entered the debt ledger and no ceiling moved — the same shape as `b07e8c3ac`'s coursing
pair two days earlier, and the same reason only this one leg can see it.

Found by closing a measurement gap, not by looking for it: every workspace run in the `BOOTSTRAP_FREE`
campaign used `--exclude kasirmu-app`, so `apps/desktop-tauri` had never been run in either profile.
`cargo test -p kasirmu-app --lib` read **156 passed / 2 failed** debug and **145 passed / 2 failed** release —
the same two names in both, so neither is a consequence of that ruling, which is a strict no-op in debug.

**Changes:**
1. `apps/desktop-tauri/src/commands/registration_gate_tests.rs:92` — `REGISTERED_FLOOR` 455 → 458, the number
   the harness prints rather than a chosen one. The doc comment carries the new measurement and keeps the
   chain: 458 on 20-09-26 (455 on 16-09-26, 453 on 13-09-26).
2. `registration_gate_debt.generated.rs:179` — regenerated with `KASIRMU_REGENERATE_GATE_LEDGER=1 cargo test -p
   kasirmu-app --lib drift_pin_generated_ledger_is_the_sweeps_own_output -- --nocapture`, which reported *69
   debt row(s), registered total 458*. The diff is that const and its comment and nothing else: the
   `DEBT_LEDGER` array has no hunk, so no row was added, deleted or moved.
3. Deliberately untouched: both ceilings, `DEBT_CEILING` (69, `:185`), `REGISTERED_SLACK` (24, `:97`), and the
   partition legs. A gated trio adds no debt.

**What it means:**
The regeneration is not the "wrong kind of green" that `f24a14b44` refused. That pass left the ledger 8 behind
the tree because regenerating it then would have pulled a new name into `resolves_session_names_no_permission`
and forced a ceiling decision in the same breath as a pin raise. Here the ledger's rows already agreed with the
sweep — `drift_pin_generated_ledger_is_the_sweeps_own_output` was green *before* this pass — so the only thing
regeneration could write was the measured total. The evidence is the diff itself: one const, no array hunk,
both ceilings unmoved.

The precedent's convention held in the other direction too. It recorded the superseded number as the dated
predecessor rather than deleting it, and both the floor's doc comment and the ledger's prose now do the same —
which is also why the ledger's comment is hand-maintained while its two counts are not: the generator replaces
only the `DEBT_LEDGER` array and the `REGISTERED_TOTAL`/`UNSOURCED` digits, so prose left alone would have kept
claiming 455 beside a const reading 458.

**Verification:**
- Before: `cargo test -p kasirmu-app --lib` → `156 passed; 2 failed` (debug) / `145 passed; 2 failed` (release),
  the two names identical in both profiles.
- After: `cargo test -p kasirmu-app --lib drift_pin` → **8 passed; 0 failed**, exit 0. `cargo test -p
  kasirmu-app --lib` with the proxy variables unset → **158 passed; 0 failed**, exit 0.
- The second failure was never ours: `commands::local_api::tests::set_port_restarts_running_server_on_new_port`
  asserts `reqwest::get("http://127.0.0.1:{old_port}/…").await.is_err()`, and the sandbox's
  `http_proxy=http://127.0.0.1:25011` answers it. It fails with the proxies set and passes without them — the
  same class as the documented `request_token_sends_admin_key_header_when_provided` flake.
- `dev-ci.yml:251` runs `cargo nextest run --workspace --all-features` with no `--exclude`, so this red was
  going to fire on the next push whatever else was in the batch.

**Commit:** single pathspec commit touching the gate file, the regenerated ledger and this file together — the
assertion asks for one deliberate pass, so splitting the const from its record would reproduce the exact
failure mode the message describes. Never push without a direct user order.
## 2026-09-20 — Absorb: the emailed-code device link lands on BOTH registration floors, and the first ceiling RISE either ledger has taken (mobile-tauri/desktop-tauri/records)

**Context:**
The tablet shell's own ratchet was red at HEAD, on two legs. Found by running the shell, not by reading a
diff: `cargo test -p kasirmu-mobile` read **675 passed / 2 failed**,
and the two names were the pins, not the feature —
`drift_pin_registration_floor_is_met` (*"hand-written floor of 320 disagrees with the ledger's measured
total of 324"*, `registration_gate_tests.rs:731`) and `drift_pin_debt_ceilings_only_shrink` (*"88 ungated
registered commands against a ceiling of 85"*, `:870`).

Provenance is two commits, neither of which touched a pin: `3f0e8c4c3` (feat(ui): add the google account
link step) registered `desktop_link::link_device_google`, and `da6a4a8d4` (feat(core): expose the
emailed-code device link to both shells) registered `desktop_link::link_device_email_request` and
`desktop_link::link_device_email_consume`. Each regenerated the generated ledger — rows and
`REGISTERED_TOTAL` — which is all the generator is allowed to write. The four numbers a sweep cannot
measure stayed where they were:

| shell | floor written | measured / ledger total | ceiling written | measured ungated | class-1 count written | measured |
|---|---|---|---|---|---|---|
| tablet | 320 | 324 | 85 | 88 | 41 | 44 |
| desktop | 458 | 461 | 69 | 72 | 42 | 45 |

The distinction is structural, not an oversight, and `rendered_ledger_file` says so in its own doc:
`DEBT_CEILING` and the two class counts are *pins* — "a pin is a decision … a generator that recomputed
one would be inventing policy" — and the floor is an EQUALITY against the tree on desktop and against the
ledger's total on tablet. So a registration pass that does not also touch the pins leaves them stale by
construction, which is what both commits did.

**Changes:**
1. `apps/mobile-tauri/src/commands/registration_gate_tests.rs:87` — `REGISTERED_FLOOR` 320 → 324, the
   number the harness prints rather than a chosen one, with the 20-09-26 step named (`link_device_google`
   plus the emailed-code pair) and the 18-09-26 step kept as the dated predecessor.
2. `apps/mobile-tauri/src/commands/registration_gate_debt.generated.rs:280` — `DEBT_CEILING` 85 → 88,
   `NO_SESSION_RESOLUTION` 41 → 44, and the partition comment 44 + 41 = 85 → 44 + 44 = 88.
3. `apps/desktop-tauri/src/commands/registration_gate_tests.rs:92` — `REGISTERED_FLOOR` 458 → 461.
4. `apps/desktop-tauri/src/commands/registration_gate_debt.generated.rs:188` — `DEBT_CEILING` 69 → 72,
   `NO_SESSION_RESOLUTION` 42 → 45, partition comment 42 + 27 = 69 → 45 + 27 = 72.
5. Both ledger prose blocks carry the movement as a dated entry above the const, the way the descent
   history above them already does, and neither `REGISTERED_TOTAL` nor the `DEBT_LEDGER` array is touched
   — the generator's own output is left exactly as it was written.
6. Deliberately untouched: `REGISTERED_SLACK` (24) in both shells, every partition leg, and both
   `UNSOURCED` consts.

**What it means:**
**This is the first rise either ceiling has ever taken**, and it is the direction the pin's own message
forbids without a reason: *"a rise means a newly registered command shipped ungated: record the reason in
docs/records/JOURNAL.md before the number moves."* The reason is that class 1 is STRUCTURAL for
`desktop_link`, not an omission being absorbed. The account-link step lives in the setup wizard, which runs
**before any staff session exists** — there is no session to resolve and no permission to name, which is why
`license::activate_license` and `license::get_machine_id` have sat in that same class since the gate was
written. The device proves *which tenant* it holds to the licence server with its own stored credentials
(`api_key`), read shell-side by `stored_credentials`; the door is authenticated, just not by a session. A
`session_token` parameter here would be a permission check no caller could ever satisfy, which is worse than
a recorded row.

The three rows are also *not* new surface for the gate's own census: `link_device_google` was the tablet's
and desktop's only `desktop_link` row before this, and the pair that joins it is the same feature's second
door (ADR #54 §2.6 — the no-browser route, which is the one Android can actually take, §1.7). The ceiling
rise prices three names, and it prices them where the previous pass priced the first one.

A narrower pass was not available. The floor leg compares the floor to the ledger's total on tablet and to
the tree on desktop, so the two files can only be made equal together; the ceiling leg counts what the
partition leg measures, so a ceiling moved without the class count re-partitions into a lie. Splitting them
would reproduce the failure this pass exists to end — which is why all four numbers per shell move in one
commit with this record.

Not in this pass: the client half of the emailed-code flow (the tablet's own wizard form). It was in flight
in another lane's working tree while this pass was made — `ui/src/api/license.ts`, `StepAccount.tsx`, both
locale files and the bridge module were dirty — so it is neither audited nor committed here. One ordering
constraint is worth recording for whoever lands it: `scripts/verify-ipc-parity.py` fails a UI command string
that no shell's `generate_handler!` registers, so the form cannot land before the two registrations it calls,
and it must not land alone.

**Verification:**
- Before: `cargo test -p kasirmu-mobile` → **675 passed; 2 failed**, the two pins above.
- After: `cargo test -p kasirmu-mobile drift_pin` → **8 passed; 0 failed**, exit 0.
- After: `cargo test -p kasirmu-app --lib drift_pin` → **8 passed; 0 failed**, exit 0. The desktop legs
  were NOT run before this pass — its before-state above is derived from two consts (floor 458 against the
  tree's 461) and the generator's own row count (72 against a ceiling of 69), and this run is the
  after-state. The tablet's before-state is the measured 675/2 above, not a derivation.
- The counts are read, not chosen: 88 = 44 + 44 and 72 = 45 + 27 are the row counts of the two
  `DEBT_LEDGER` arrays as the generator wrote them, and 324 / 461 are the two `REGISTERED_TOTAL`
  consts the same runs wrote.
- `dev-ci.yml:251` runs `cargo nextest run --workspace --all-features` with no `--exclude`, so both reds
  were going to fire on the next push regardless of what else was in the batch.

**Commit:** one pathspec commit touching the two gate files, the two ledgers and this file together — the
assertions ask for one deliberate pass, so splitting a const from its record would reproduce the exact
failure mode the message describes. Never push without a direct user order.

## 2026-09-22 — Absorb: the staff/role trash's five commands land on BOTH registration floors, and no ceiling and no ledger row moves (desktop-tauri/mobile-tauri/records)

**Context:**
The staff-management trash (90-day soft delete for staff members and custom roles) added five `_scoped`
commands to each shell: `delete_staff_scoped`, `restore_staff_scoped` and `list_staff_trash_scoped` behind
`staff:delete`, plus `restore_role_scoped` and `list_role_trash_scoped` behind `staff:manage_roles`. All five
arrive ALREADY GATED, which is what makes them invisible to every leg of the registration ratchet except the
floor — a gated name moves no ceiling, no class count and no ledger row.

The floors are the one thing that had to move, and they move for the reason the pin's own message asks for:
`REGISTERED_FLOOR` is an EQUALITY against the tree on both shells (`registration_gate_tests.rs:752` desktop,
`:785` tablet), so 463 -> 468 and 339 -> 344 record what landed without approving it. On the tablet the floor
is ALSO asserted equal to the generated ledger's total, so the const and the ledger can only move together —
the same constraint the 09-20 pass recorded. Desktop's ledger total moved 463 -> 468 as well, because the
generator was re-run in this pass rather than left to lag inside `REGISTERED_SLACK`.

The measurement that says no debt moved: the two `DEBT_LEDGER` arrays render **74** rows on desktop and **94**
on tablet before AND after regeneration. A gated addition cannot change either number, so the regeneration was
read back rather than trusted (`drift_pin_generated_ledger_is_the_sweeps_own_output`, which in
`KASIRMU_REGENERATE_GATE_LEDGER=1` mode writes the file and then re-parses it).

The five names are also what `scripts/verify-ipc-parity.py` needs: it fails a registered `_scoped` command that
no shipped UI file invokes, so the registrations and the Trash tab's `ui/src/api/staff.ts` wrappers land in the
same feature, and the parity run in this pass is green with all five invoked.

**Verification:**
- `cargo test -p kasirmu-app --lib registration_gate` -> **14 passed; 0 failed**, exit 0.
- `cargo test -p kasirmu-mobile --lib registration_gate` -> **10 passed; 0 failed**, exit 0.
- Ledgers regenerated, not hand-edited: `KASIRMU_REGENERATE_GATE_LEDGER=1 cargo test -p kasirmu-app -p kasirmu-mobile --lib drift_pin_generated_ledger_is_the_sweeps_own_output -- --nocapture` -> "74 debt row(s), registered total 468" / "94 debt row(s), registered total 344"; the commit's diff of both generated files is the two `REGISTERED_TOTAL` lines and the authored history note above them, nothing else.
- `cargo clippy --all-targets --all-features -- -D warnings` -> exit 0 (the same sweep cleared every strict-lint finding the newer clippy had raised across untouched crates, in `dbf14f8bb`).
- UI: `npm run test` -> **606 files, 10311 passed**; `npm run typecheck` and `npm run lint` clean.
- The trash row's layout was measured, not asserted: with the final day-count copy at 1280/768/390 the row never overflows and the Restore button stays 1px inside its content box. The first copy (`90 days left`) fitted; the rename to `'90 days before permanent deletion'` did NOT at 390px (row over by 4px, button 18px outside), which is why `.staff-mgmt-trash-days` lets that sentence wrap.

**Commit:** one pathspec commit touching the two gate files, the two generated ledgers and this file together —
the floor's own message asks for one deliberate pass, and splitting a const from its record is the failure mode
that message exists to prevent. Never push without a direct user order.

## 2026-09-22 — Repair: the command census and two topology fixtures measured a world ADR #56 §2.6 deleted (desktop-tauri/records)

**Context:**
`cargo test --workspace --all-features` was red at HEAD on four legs, none of them introduced by the trash
feature itself and all of them invisible to `cargo test -p <crate> --lib` alone. Two are pins this pass moves
deliberately; two are fixtures that describe a database shape §2.6 stopped producing.

**The pins (moved, with the reason).** `apps/desktop-tauri/tests/gate_audit.rs` walks the shell's `src/commands`
AND `crates/kasirmu-bridge/src` and pins, per module stem, how many gate calls it holds and which permission
keys those calls name. One `staff.rs` in the bridge serves both shells, so the five trash commands moved the
desktop row from (11 calls, four keys) to (16, six), and the tablet's shim row to
`["STAFF_READ_IDENTITY", "STAFF_UPDATE"]`. Raising a pin records what landed; it does not approve it. Two
more rows are not mine and were red before this pass: `build_integrity` (desktop) and `license` / `locations`
(tablet) walk into the census as modules with 0 gate calls and no pin, which the census reports as
`unpinned gates permissions on disk but is NOT in the pinned census`. They are pinned at their measured
`(0, &[])` rather than skipped. `STAFF_READ_IDENTITY` was already measured in the bridge's caller-aware
profile write and had no `permission_value()` arm at all — resolving it is what lets the key set be checked
instead of merely carried.

**The fixtures (not the assertions).** ADR #56 §2.6 moved the baseline seed (the `Default Store` location, the
five `default-*` instances and the `BOOTSTRAP_FREE` subscription) out of the migration chain into
`migrations::seed_provisioned_baseline`, which `provision_device` calls. `commands::topology::topology_command_tests`
builds its databases with `migrations::run` / `fresh_db()` only, so both fixtures are now UNPROVISIONED:
`tauri_save_topology_with_wires_roundtrips_fully` names `store_profile_id: "default"` and no longer finds that
location (`unknown-branch-location`), and `apply_naming_a_foreign_store_records_which_database_receives_the_writes`
lost the seeded free-tier row and the location count its entitlement refusal depended on — it sailed past the
gate and died later on an instance FK. Both now call `seed_provisioned_baseline`, and the second also seeds
the two store databases it can reach, because a store database is created by migrations only
(`platform/core/src/database/manager.rs:116`). NO assertion changed: the second is a CHARACTERISATION test
whose own comment says which world it observes, and the repair restores that world rather than redefining it.

**Verification:**
- `cargo test -p kasirmu-app --test gate_audit` -> **3 passed; 0 failed**, exit 0.
- `cargo test -p kasirmu-app --lib` -> **158 passed; 0 failed**, exit 0 (155/3 before this pass).
- `cargo test --workspace --all-features` -> green in full. Run with an isolated `CARGO_TARGET_DIR` because a running `kasirmu-app.exe` on this host holds the default target dir's binary and Windows refuses to replace it — that lock is an environment fact, not a test result, and it is why the first workspace run died with "failed to remove file ... kasirmu-app.exe" before executing a single test.
- The registration floors moved with it: 463 -> 468 desktop, 339 -> 344 tablet, both ledgers regenerated (recorded in the entry above).

**Commit:** one pathspec commit for the gate pins and the two fixtures, separate from the feature commits, so a
red census can be blamed or exonerated on its own. Never push without a direct user order.


## 2026-09-22 — Repair: the tablet's fixtures measured a world ADR #56 §2.6 deleted — 34 failures to 0 (mobile-tauri/records)

**Context:**
`cargo test -p kasirmu-mobile --lib` stood at **624 passed / 34 failed** at HEAD. Every earlier run in this
session stopped at an earlier failing target, so the tablet's own damage was never reached — the same way the
desktop's two topology casualties stayed hidden until the app crate was the only thing left to fail.

All 34 share ONE cause: §2.6 moved the baseline seed — the `Default Store` location, the five `default-*`
instances, the `default:default-legal-entity` legal entity and the `BOOTSTRAP_FREE` tenant_subscription row —
out of the migration chain into `migrations::seed_provisioned_baseline`, which `provision_device` calls. Every
tablet fixture builds its database with `fresh_db()` (or a store database, which `StoreDatabaseManager`
creates by MIGRATIONS ONLY — `platform/core/src/database/manager.rs:116`), so every one of them is now
UNPROVISIONED. The symptoms are four spellings of the same absence: `not found: location default`,
`no primary location to resolve the entity from`, `Internal("default tenant subscription not found")`,
`Invalid("User does not have access to this workspace instance")` — plus tier stamps that silently updated no
row, leaving a fixture named `pro`/`premium`/`free` running as "no subscription".

**Fixes — the fixtures rebuild the baseline where they create the database:**
- 26 test bodies that drive a provisioned store call `seed_provisioned_baseline` right after `fresh_db()`.
- The SHARED helpers do it once for all their callers: `testing.rs::pin_seeded_row` (the audit and staff
  security-event families), `audit_tests::seeded_conn` and `staff_security_events_tests::seeded_conn` (whose
  own tier stamp was the no-op), `auth_tests::set_tier`, `subscription_tests::seed_tier`, `history_state`,
  and the three `flow_state` builders (regional, local_payment, receipt_format), which also seed the STORE
  database the resolver actually reads.
- `seeded_row_reaches_a_paid_tier` seeds too. It runs the product's two steps over the row
  `seed_provisioned_baseline` writes (its own doc says so); with no row the predicate answered `false` for a
  reason that has nothing to do with the signature, so every fork took its RELEASE arm while a debug build was
  running and `pin_seeded_row` compared a real row against a phantom.

**What was NOT weakened.** No assertion's expected value changed. Two preconditions were RESTORED to what the
test names already describe: `content_write_fails_closed_without_a_linked_entity` now unlinks the entity the
shared fixture links (its name is about the unlinked case), and
`known_hazard_eod_header_and_payment_breakdown_use_different_day_boundaries` UPDATEs the seeded primary
location instead of INSERTing a second primary — the unique partial index on `is_primary = 1` refuses one, and
`tz_modifier` reads the row it updated or nothing at all.

**Noted, not changed:** `apps/mobile-tauri/src/commands/testing.rs` is mounted without `#[cfg(test)]`
(`commands/mod.rs:117`), so its fixture helpers — including the predicate this pass fixed — are compiled into
the shell. That is pre-existing shape, and seeding inside that predicate is exactly its documented contract.

**Verification:**
- `cargo test -p kasirmu-mobile --lib` -> **658 passed; 0 failed**, exit 0 (was 624 / 34).
- `cargo fmt --all -- --check` -> clean; every touched file was rustfmt'd.
- `cargo test --workspace --all-features` + `cargo clippy --all-targets --all-features -- -D warnings` + the full
  UI suite are re-run after this commit; the only known non-deterministic leg is
  `pg_isolates_locations_by_tenant`, which races the cluster-wide role `oz_rest_probe` under one-process
  parallelism and passes alone.

**Commit:** one pathspec commit for the tablet fixtures, separate from the feature and from the desktop
repairs, so a red tablet suite can be blamed or exonerated on its own. Never push without a direct user order.

## 2026-09-22 — Absorb: `setup::get_preset_features` lands on the desktop floor, ceiling and ledger (desktop-tauri/records)

**Context:**
The desktop registration ratchet was red on four legs after a peer commit landed. Measured, not derived:
`lib.rs` registers **469** names against a floor of 468; the sweep finds `setup::get_preset_features` ungated
and NOT on the generated ledger; the debt ceiling is 74 against a measured **75**; and the ledger needs
regenerating. Provenance is one commit: `6ac851dd4` (fix(setup): derive the terminal's feature set from the
chosen store type). Nothing the staff/role trash landed moved these numbers — that pass was 463 -> 468 and its
five commands arrived gated, recorded in the entry above.

**The pass (the gate's own instructions, followed in one commit):**
- `REGISTERED_FLOOR` 468 -> 469.
- `DEBT_CEILING` 74 -> 75, with the RISE recorded here — which is what the ceiling pin asks of a rise.
- `NO_SESSION_RESOLUTION` 47 -> 48: the new row is class 1, and `48 + 27 = 75` partitions the ceiling again.
- Ledger regenerated through the generator (`KASIRMU_REGENERATE_GATE_LEDGER=1 cargo test -p kasirmu-app --lib
  drift_pin_generated_ledger_is_the_sweeps_own_output -- --nocapture`), which printed "75 debt row(s),
  registered total 469" and re-reads its own output before passing.

Class 1 is STRUCTURAL for this command rather than an omission being absorbed, and that is why the rise is
defensible: `get_preset_features` answers with the store-type presets the SETUP WIZARD shows, and the wizard
runs before any staff session exists — a `session_token` parameter would be a permission no caller could ever
satisfy, the same class `setup::get_first_run_state`, `setup::provision_device`, `license::activate_license`
and the three `desktop_link::*` rows have always occupied. Naming the provenance is deliberate: this pass
records what landed and does not approve it.

**Verification:**
- `cargo test -p kasirmu-app --lib commands::registration_gate_tests` -> **14 passed; 0 failed**, exit 0 (was 10 passed / 4 failed).
- The regeneration's own legs: `drift_pin_generated_ledger_is_the_sweeps_own_output` -> ok; `drift_pin_three_way_partition_is_complete_and_sums` -> ok; `drift_pin_debt_ceilings_only_shrink` -> ok; `drift_pin_registration_floor_is_met` -> ok.

**Commit:** one pathspec commit touching the gate file, the generated ledger and this entry, because the floor's own message asks for one deliberate pass. Never push without a direct user order.


## 2026-09-22 — Absorb: the same command lands on the tablet's ratchet, in the same pass (mobile-tauri/records)

**Context:**
The commit that reddened the desktop floor reddened the tablet's ledger, partition and ceiling legs too —
`setup::get_preset_features` (`6ac851dd4`) is registered in BOTH shells. Measured on the tablet: 95 ungated
against a ceiling of 94, the name absent from the generated ledger (`first row out of order: measured
setup::get_preset_features, ledger setup::get_first_run_state`), and the class counts no longer partitioning
the ceiling. The REASON is one reason and it is recorded in the entry above (the setup wizard reads the
store-type presets before any staff session exists, so class 1 is structural for it); this entry records the
tablet's own numbers so neither shell's record is a pointer into a file that holds only the other's.

**The pass:** `REGISTERED_FLOOR` 344 -> 345; `DEBT_CEILING` 94 -> 95; `NO_SESSION_RESOLUTION` 50 -> 51
(`51 + 44 = 95` partitions the ceiling; `RESOLVES_SESSION_NAMES_NO_PERMISSION` stays 44); ledger regenerated
through the generator, which printed "95 debt row(s), registered total 345".

**Verification:**
- `cargo test -p kasirmu-mobile --lib commands::registration_gate_tests` -> **10 passed; 0 failed**, exit 0 (was 7 passed / 3 failed).
- The four legs named in the failure: floor ok, partition ok, ceiling ok, generated-ledger ok.
- `cargo test --workspace --all-features` is re-run after both halves land; the only leg that has failed
  non-deterministically in this session is `kds_lan_live_offline_buffer_replay_respects_station_filter`, which
  passes alone and was not touched here.

**Commit:** its own pathspec commit immediately after the desktop half, because the two floors and the two
ledgers may not drift apart on a command both shells register. Never push without a direct user order.


## 2026-09-22 — Repair: an independent audit of the staff/role trash found two holes the tests did not, and both close at the source (core/records)

**Context:**
A read-only audit of the trash feature (five commits, no builds run) found three defects and a set of stale
claims. Two are MAJOR and both were invisible to the tests that shipped with the feature, because each is a
combination of two correct-looking halves:

1. **A trashed role stayed ASSIGNABLE.** `get_role` deliberately does not filter `deleted_at` (the trash renders
   trashed rows through `role_dto` -> `role_holder_count` -> `get_role`), so `create_user_in_tx` and
   `update_user_in_tx` accepted a trashed `role_id` off the wire. `purge_expired_roles` refuses to delete a row
   anything references, so one re-reference closed the window for ever — and the role kept granting while
   `list_roles` hid it from every picker. An author-visible grant with no row left to revoke.
2. **A closed window was still offered as restorable.** `list_trashed_roles` had no deadline predicate, so a row
   past its 90 days that the purge had refused to delete came back from `list_role_trash_scoped` as a row the
   Trash tab offered to Restore (rendered as `0 days before permanent deletion`).
3. **A trashed member was still editable.** `update_user_in_tx` updated by id with no `deleted_at` guard, so a
   crafted call could set `is_active = 1` on a trashed row — an ACTIVE account that both the login path and the
   roster filter out, i.e. one nobody can see and nobody can revoke.

**Fixes, each with the check that holds it:**
- `Store::require_assignable_role` (private, `crates/kasirmu-core/src/db/staff.rs`) is the G-2 zombie guard
  extended: the role must exist AND not be in the trash. Both write paths call it, so it is one guard rather
  than two. Test: `a_trashed_role_cannot_be_assigned_to_an_account` — and it ends by proving the window can
  still close, which is the property the hole was destroying.
- `list_trashed_roles` now carries the purge's OWN cutoff as a predicate, so `>= cutoff` means RESTORABLE and
  the two halves read the same boundary in opposite directions. `purge_expired_roles` was made to stop reading
  through that view: doing so made the sweep a no-op that reported 0 while the expired rows stayed on disk.
  That bug was introduced by the predicate and caught immediately by
  `purge_expired_roles_removes_only_past_the_window`, which is the test that exists for it — the sweep now asks
  the table for the expired set directly and keeps its in-transaction reference re-check. Tests:
  `a_closed_window_role_is_not_listed_as_restorable`, plus the two above.
- `update_user_in_tx`'s UPDATE gained `AND deleted_at IS NULL`; a trashed member answers NotFound to an edit,
  and `restore_user` remains the door back. Test: `a_trashed_member_is_not_editable`.
- Stale claims retired: the `staff:delete` registry DESCRIPTION (served by `list_permission_keys_scoped` into
  the role editor, so it told an author that the key guards nothing), two audit stamps, the broken
  `[Store::delete_role]` intra-doc link, three prose sites, and the payment-methods plan's citation of a
  convention this feature retired. NOT edited:
  `crates/kasirmu-core/migrations/20261010_role_trash.sql:8` still names `delete_role` — a migration's bytes are
  checksummed, so its stale comment stays as the historical record rather than being "fixed" into drift.

**Residual, recorded rather than fixed:** the delete evicts sessions from this PROCESS's in-memory store, and
`resolve_session` checks only TTL and never re-reads the account, so a session held by another process against
the same identity DB survives to its TTL. Unreachable in the single-instance desktop shell (the shell and the
bridge share one `Arc` session map); it becomes real only if a second host ever shares that database.

**Verification:**
- `cargo test -p kasirmu-core --lib db::roles` -> **40 passed; 0 failed** (38 + 2 new); `db::staff` -> **65 passed** (64 + 1 new).
- `cargo test -p kasirmu-bridge --lib staff` -> **126 passed; 0 failed** (the create/update paths the new guard sits on).
- `cargo test -p kasirmu-app --lib` -> **158 passed; 0 failed**; `--test gate_audit` -> **3 passed; 0 failed**.
- `cargo clippy --all-targets --all-features -- -D warnings` -> exit 0; `cargo fmt --all -- --check` -> clean.
- `cargo nextest run --workspace --all-features` -> green (the runner `dev-ci.yml:251` uses).
- NOT MINE, FOUND WHILE VERIFYING: `crates/kasirmu-api`'s `pg::tests::pg_isolates_locations_by_tenant` fails when
  the whole crate runs in one process and passes when run alone (`cargo test -p kasirmu-api --lib pg::tests::pg_isolates_locations_by_tenant`).
  It races the cluster-wide role `oz_rest_probe` against `pg_integration_rest_rls_non_owner` at
  `pg_tests.rs:1633`, in the window the file's own comment describes. Pre-existing and unrelated to this work;
  process-isolated execution (nextest) and the crate's serial path both pass. Recorded, not papered over.

**Commit:** two commits — the core behaviour with its tests, and the stale-claim sweep — because the first is
what a reviewer must read against the trash feature and the second is prose. Never push without a direct user
order.

## 2026-09-22 — Repair: the dev-mock answers get_preset_features, and the parity gate is green again (ui/records)

**Context:**
`scripts/verify-ipc-parity.py` failed the WHOLE gate on one command: the UI invokes `get_preset_features`
(`ui/src/api/settings.ts:266`, from `ProvisioningFlow`'s submit path) and nothing under `ui/src/dev-mock/`
registered a handler, so the browser preview returned null and the first-run flow rendered its failure path —
while every test that mocked the wrapper stayed green. The command itself is sound: both shells register it and
it reads the preset→features fact from its one owner (`crates/kasirmu-core/src/features.rs`). Repaired in the
same pass: `crates/kasirmu-core/src/features_tests.rs:532` had been committed unformatted, so
`cargo fmt --all -- --check` was red.

**Fixes:**
- `ui/src/dev-mock/handlers/system.ts`: a `get_preset_features` handler beside `get_enabled_features`, with
  `MOCK_PRESET_FEATURE_KEYS` — the six slugs and their sorted kebab-case keys, extracted MECHANICALLY from
  `FeatureRegistry::{simple_retail,restaurant,full_store,cafe,franchise,custom}` rather than retyped. An unknown
  slug REJECTS (`unknown store preset: ...`), mirroring `kasirmu-bridge/src/setup.rs:231`; the flow catches
  that and degrades to `[]` (`ProvisioningFlow.tsx:282-284`), so a mock that answered `[]` would erase the
  difference between the degradation and a lost preset.
- `ui/src/__tests__/dev-mock-preset-features.test.ts` (6 tests): payload shape; each slug's list; the sorted
  order the payload promises; `custom` as an honest empty list rather than a missing table entry; the refusal;
  and that every key is a real feature key. That last leg is load-bearing: the `get_enabled_features` handler
  beside it answers `['sales','inventory',...]`, which are NOT feature keys, and this flow sends its answer to
  `provision_device`.
- `crates/kasirmu-core/src/features_tests.rs`: rustfmt only — one `assert!` wrapped, 4 lines of whitespace.

**Verification:**
- `python scripts/verify-ipc-parity.py` -> **IPC parity: OK**, exit 0.
- `npm run test` (full UI suite) -> **604 files, 10301 passed**, exit 0.
- `cargo test -p kasirmu-core --lib features` -> **83 passed; 0 failed**; `cargo fmt --all -- --check` -> clean;
  `cargo clippy --all-targets --all-features -- -D warnings` -> exit 0.

**Commit:** two pathspec commits — the mock with its test, and the format alone — so the second reads as
whitespace in another lane's file. Never push without a direct user order.

## 2026-09-23 — Staff-management trash: phone-row layout, a preset-key guard, a bounded session revalidation (ui / kasirmu-core / kasirmu-bridge)

**Context:** three follow-ups left by the trash review, run as parallel workstreams against one frozen tree.

**Changes:**
- `ui/src/features/staff/StaffManagementScreen.css` (the <=600px tier) plus a structural test: the trash row becomes a two-column grid — the who block spans both columns, then the days span sits in column 1 and `Restore` in column 2 as DIRECT children. Flex-wrap was rejected: it orphans the button and at 360px the days/button gap goes negative (-10px).
- `ui/src/__tests__/StaffManagementScreen.test.tsx`: asserts the days span and the button are direct children of the row, because that structure is invisible to jsdom and moving either into the who block silently costs the button its right edge at phone widths.
- `crates/kasirmu-core/src/features_tests.rs` (+252): `dev_mock_preset_feature_keys_match_this_crates_own_presets` compares the six preset slugs and their sorted feature keys in `ui/src/dev-mock/handlers/system.ts` against this crate's OWN `FeatureRegistry`, read through `include_str!`. The mock's `get_preset_features` answer feeds `provision_device`, so a key that drifts from the registry provisions a device the core would reject. The parser panics rather than skipping syntax it cannot read.
- `crates/kasirmu-bridge/src/ctx.rs` + `session_revalidation_tests.rs` (new): closes the residual recorded in this file on 2026-09-22 — a session held by ANOTHER process survived to its TTL. `resolve_session`'s live branch now re-reads the account behind the token through one indexed `SELECT EXISTS(... deleted_at IS NULL AND is_active = 1)`, at most once per `ACCOUNT_REVALIDATION_WINDOW` (30s). The first resolve of a token only stamps the window (query-free: the token came from a login that already filters `deleted_at`/`is_active`, so it cannot be born revoked). A revoked account's session is removed and answers `InvalidSession`, byte-identical to the unknown/expired-token error. The read uses `try_lock`, never `blocking_lock` (it runs inside async command bodies); a busy or failing identity DB fails OPEN and does NOT consume the window, so the next resolve retries. State is a module-level `LazyLock<StdMutex<HashMap<(usize,String),...>>>` keyed by (identity-DB Arc address, token): the ctx is rebuilt per call, so a new field would have changed the struct at all three construction sites (desktop `authz.rs`, mobile `state.rs`, `testing.rs`). Warm-path cost: 0 queries inside the window, amortised 1 indexed SELECT per 30s per actively-resolving token, 0 for an idle token.
- The two bridge comments that asserted `resolve_session` "checks only TTL and never re-reads the account" were made FALSE by that change and are corrected in place (`staff.rs` `delete_staff_scoped` doc, `staff_tests.rs`). The eviction closes the gap to zero on this host; the window covers the other hosts.

**Correction of my own earlier claim:** I had recorded that at 390px the trash row "merely wraps and loses nothing". That was wrong. Re-measured against the pre-fix stylesheet with a real browser (`who` = identity block clientWidth, `nameOv` = name ink outside its box):
- BEFORE at 390px: `who=0` and `nameOv=103/33/59` — the whole identity block collapses, its name paints 33-103px outside it across the days badge, and the identity line is 0px wide (invisible in the render) while still 18px tall. Rows 132/90/90px.
- AFTER at 390px: `who=292`, `nameOv=0`, `subW=292`, name/days and days/button hit-tests 0, button inside its box, rows 124/103/103px.
- At 768px and 1280px both stylesheets measure identically — no regression above the tier.
My earlier metric (row `scrollWidth - clientWidth`) read 0 through all of that because a collapsed flex item reports no overflow of its own. The render settled it: the badge text is drawn straight through the name.

**Verification:**
- `cargo test --workspace --all-features` -> exit 0, **129 targets, 10096 passed, 0 failed** (includes the 3 new revalidation tests; bridge lib 1361 -> 1364).
- `cargo clippy --all-targets --all-features -- -D warnings` -> exit 0, no warnings.
- `cargo fmt --all -- --check` -> clean. It was RED first: R4 ran tests and clippy but not fmt, so `session_revalidation_tests.rs:63` landed unformatted in 92a098652. Fixed with `cargo fmt -p kasirmu-bridge` (never `--all`, which reformats other lanes' in-flight files) and committed separately.
- `npm run test` (full UI suite) -> exit 0, **604 files, 10301 passed**, 24 skipped, 3 todo.
- `cargo test -p kasirmu-core --lib features` -> **84 passed**; the preset-key guard was independently mutation-proved RED (mutating `tax-engine` in `system.ts` fails it), then restored byte-identically (SHA256 compared).
- The revalidation guard was independently mutation-proved RED: deleting the `revalidate_account` call fails exactly the two revoke tests (1 passed; 2 failed), restored byte-identically, then 3/3 green.
- Static gates, all on this tree: `generate-pg-migration.py --check` OK (127 tables, 158 indexes, 7 seed inserts); `verify-ipc-parity.py` -> IPC parity: OK; `verify-bundle-parity.py` -> 0 missing keys (4832 en / 4908 id); `dedupe-ftl.py` -> no duplicates; `verify-ftl-orphans.py --self-test` -> OK; `verify-migration-column-types.py` -> OK.

**Recorded, not fixed:** `Store::get_user` deliberately does not filter `deleted_at` and `authorize_with` checks only `is_active`, so inside the revalidation window an already-resolved command from a just-trashed member still authorizes. That IS the bounded lag this design buys, not a separate hole; after the window the session is gone. No production signature changed, so no shell needed a follow-up.

**Commits:** `2dea49ddb` (layout + its structural test), `61e8b0381` (preset-key guard), `92a098652` (revalidation + the two corrected comments + 3 tests), `0dcdbad0c` (format, alone). Never push without a direct user order.

## 2026-09-23 — E2E: the staff trash round trip, and what two mutation proofs taught (ui/e2e)

**Context:** the trash review left exactly one real hole — the SQL was proven against real SQLite and the unit tests were green, but no E2E spec had ever carried a member into the trash and back through the assembled app. The suite runs the real UI in a browser against the dev-mock IPC (`ui/e2e/helpers.ts`), so this needs no Rust backend, and both the desktop (Chromium) and tablet (WebKit) projects run it.

**Spec:** `ui/e2e/staff-trash.spec.ts` (2 cases, 4 tests across the two projects):
- the round trip — delete an inactive member through the confirmation dialog, see them leave the roster, reach the trash BY TAB and then again BY DEEP LINK, assert the freshly-started `90 days before permanent deletion` badge, restore, and prove they return INACTIVE (the power button offers restore; the row is deletable again);
- the gate — an admin session gets a rendered tab strip WITHOUT the trash tab, and no route into it renders the trash panel, list or empty state.

**Mutation-proved, both directions** (the discipline used for the preset-key guard and the revalidation guard):
- forcing the screen's `canDeleteStaff` gate open FAILS the gate case;
- making restore leave the member ACTIVE in the served list FAILS the round-trip case.

**What the proofs taught — worth recording instead of hiding:**
- Widening the `trash` ROUTE registration's permission to `staff:read` did NOT fail the gate case. The enforcement that actually holds is the screen's own `passesGate('manager','staff:delete',...)` (`StaffManagementScreen.tsx:112`), which drives both `showTrash` and the panel. The route declaration and the screen check are two INDEPENDENT statements of one rule, so the spec asserts the observable outcome (no trash for an admin) rather than either mechanism. The spec's header says so.
- The first attempt at the restore mutation (returning `is_active: true` from the mock's restore handler) also did NOT fail the case, because the roster reads `MOCK_STAFF_ROWS`, not the handler's return value. Mutating the wrong layer proves nothing — the effective mutation had to flip the row the list actually serves. A red-proof that comes back green is a statement about the MUTATION, not about the test.

**Verification:** spec `4 passed (14.5s)` across both projects; `npm run testid:check` OK; `npx eslint e2e/staff-trash.spec.ts` exit 0; `npm run typecheck` exit 0. A throwaway viewport-390 spec rendered the real app's trash tab (screenshot, dark theme) confirming the phone layout there rather than only in the synthetic harness; it was deleted after the run.

**Still not covered by E2E:** the Rust backend (dev-mock IPC is not a live Tauri process — the SQL is proven by the Rust suites instead), the 90-day purge sweep, the role-trash half of the tab, and the Android shell (the tablet project is WebKit at a POS viewport, not the device WebView).

**Commit:** `23d629649`.

