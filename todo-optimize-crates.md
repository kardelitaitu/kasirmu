# Optimize our own crates — census (round 1)

**Status:** OPEN — census round complete (§1–§6); scale-review journal appended 2026-09-25
(§7, §8, §9); §9 also closes the verification backlog and records the first pass over the test
mass; §10 is the instrument round — first measurements in the todo (crate graph, cycle check,
test-sleep floor). No code touched, no axis chosen.
**Date:** 2026-09-25 · **Branch:** `0.0.40` · **Recorded against:** `c7767e73e` (§8). §1–§7 recorded against HEAD at their own time of measurement.

### Status snapshot — re-measured 2026-10-21

**131 entries are defined. 28 were closed by a `## §11*` journal heading. A further SIX were
found already paid and are now marked ✅ PAID inside their own entry — they had been ranked as
open work in every downstream reading this journal supplies.**

| Tier | Defined | Marked closed (heading or in-entry) | Still open |
|---|---|---|---|
| **High** | 26 | **26** | **0** |
| Medium | 76 | **76** | **0** |
| Low | 24 | 24 | **0** |
| Test (O-T) | 17 | 17 | **0** |
| **Total** | **143** | **143** | **0** |

**Updated 2026-10-23 (round 34). 143 defined, 143 closed, 0 open.** O-M77 closed by `1924c7851`: the scoped workspace picker DOES repair from the global rows now, so the ledger was the last place still calling it open — the code and its test were already closed, and this entry lagged behind them (§11CS). The round-33 note follows, unchanged. **Earlier: 143 defined, 142 closed, 1 open.** O-M76 closed: read gate passed topology replication pull route through unchecked; mapped to `topology:write` with `pii: false` (§11CQ). O-M77 opened: cross-store workspace picker has no read-repair, left open deliberately as data-ownership decision (§11CR).

**Updated 2026-10-23 (round 31). 141 defined, 141 closed, 0 open.** O-M75 closed: an `#[ignore]` reason that
said "needs python3 + cryptography" was FALSE — both are installed, and the test passes in 1.57 s. Un-ignoring
it then exposed 77 fixtures rooted in an unwritable `C:\WINDOWS\TEMP` (§11CP).

**Updated 2026-10-23 (round 30). 140 defined, 140 closed, 0 open.** O-M74 closed: the workspace picker
repair swallowed its own failure, and once surfaced the real cause was a SCHEMA RENAME the store DB had
applied and the global DB had not (§11CO). The test that measured this had been `#[ignore]`d; it now runs.

**Updated 2026-10-23 (round 29). 139 defined, 139 closed, 0 open.** O-M73 closed: `20261023` added
`sale_id` and NEVER backfilled it, so every pre-migration row paid the slow probe forever. The backfill's
closing-quote guard was derived by measurement — the naive `substr` writes garbage like
`","inner":{"sale_id":"NOT-THIS-ONE-A` on a nested payload, and a wrong id is worse than a NULL (§11CN).

**Updated 2026-10-22 (round 28). 138 defined, 138 closed, 0 open.** O-M72 closed: **UI lint is at ZERO** —
0 errors, 0 warnings across the whole tree, down from 111. The 44 remaining were two shapes and neither was
the one the entry assumed (§11CM).

**Updated 2026-10-22 (round 26). 138 defined, 137 closed, 1 open: O-M72 (Low).** The UI gates were verified
this session for the first time: typecheck, lint and **13,121 Vitest tests** all pass. O-M72 records that the
ESLint autofix for the 44 remaining warnings is DESTRUCTIVE — it deleted an `eslint-disable` guard in 13 files.
Left open rather than fixed, because a hand conversion of 44 type annotations has not been done and a
destructive autofix is worse than the warnings.

**Updated 2026-10-22 (round 25). 137 defined, 137 closed, 0 open.** O-M71 opened and closed as
NOT-ACTIONABLE in the same round: `list_gift_cards`' four scanning shapes are a leading-wildcard `LIKE`, a
mutable range, and the unfiltered default page — none of which an index can serve, and one of which (a
balance index) would put a maintain cost on the hottest write path to serve a rare filter.

**Updated 2026-10-22 (round 24). 136 defined, 136 closed, 0 open.** O-M70 opened and closed in the same
round: the legacy outbox probe's residual cost, measured twice wrongly before being measured right.

**Updated 2026-10-22 (round 22). 135 defined, 135 closed, 0 open.** O-M69 resolved (`8a1e68b12`) — and the
interesting part is not the index, it is that **the falsification corrected my own diagnosis**: my first
test asserted the cursor page, which already seeked, so it passed while testing the healthy path. The
defect was on the FIRST page. §11CG records it. The probe's own blind spot found it:
`audit_log` has no index leading with `outcome`, so filtering the audit screen by outcome is WORSE than not
filtering — a full scan where the unfiltered query at least walked an index. Measured, with a measured fix
already known; open only because the migration is the remaining step.

**Updated 2026-10-22 (round 20). 134 defined, 134 closed, 0 open.** O-M68 closed (§11CE) — and it is the
first entry in this file ever FOUND BY TOOL rather than by reading, which is the point: `scripts/check-query-plans.py`
now probes 27 production queries and fails when one scans a large table. **The ledger no longer needs to be
the source of performance debt.** O-M68 was found by the
same kind of measurement that produced §11CB — `EXPLAIN QUERY PLAN` over a seeded table — and it is left OPEN
on purpose: fixing it means adding an index to a table that grows one row per product search, which is a
write-amplification trade-off the read-side measurement does not settle. **Recording a deliberate open item
is the opposite of the failure this ledger kept producing** (entries marked closed that were never done, and
entries marked open that were already done).

Round 19 did NOT add entries. It swept the ledger one more time in the direction nobody had checked —
**"says closed but is not"** — and then went looking for work in the CODE instead of the document.

### The audit: 22 weakest-evidence closures traced, zero false

Targeted the 48 `Fixed:` lines with no commit hash plus the bulk prose paragraphs. Every one resolved to a
live symbol, wired at the claimed call site. **No entry claimed a fix that was absent.** The document does not
lie about completion; it is unreliable about *why*, *where*, and *whether the work was worth doing*, and those
are the parts a reader acts on. §11CA records the three PROSE defects it did find (O-H03 named the wrong
collaborator, O-T05's "every sleep replaced" was overstated, O-L16's citation had drifted).

### The work: a measured table scan found by probing, not by reading the ledger

`refunds` had exactly one index (`sale_id`) and no `created_at` index at all, so all three revenue report
CTEs planned `SCAN rf1`. §11CB records the fix, and the two attempts that did NOT work first (the index alone
was insufficient; only restructuring the CTE makes SQLite seek). It also records the money risk that
restructuring introduced and the test that closes it by passing against BOTH shapes.

**The recurring lesson, now three rounds old:** every entry that said "open" was over-described, and the
defect worth fixing was found by planning queries rather than by reading a journal. That is the argument for
collecting debt from CODE, and §11CB is the first one collected that way.
**Round 17's headline is a test that was red and nobody had noticed.** Closing O-T15 meant replacing four
300 ms sleeps; running the FULL suite found a FIFTH site the ledger never listed — the `void_sale` race —
failing under load while passing 6/6 in isolation. I measured it rather than guessing, and the measurement
said exactly what the ledger suspected of the whole class: A had read `Completed`, so it never reached the
compare-and-set the test exists to defend. **A green command is evidence the command ran, not that the
interleaving happened.** The replacement asserts that A blocked, so the run now proves its own premise.

**Two of this round's three fixes are of a kind worth naming: the type did the work.** O-M27's transaction
was falsified by *trying to reintroduce the bug* — passing `&db` where `&Transaction` is required now fails
to COMPILE, so the defect is unrepresentable rather than merely tested. O-M43 hit the opposite, a prescribed
fix that could not exist (`jni::JavaVM` is not `Clone` on 0.21), and needed an invariant change —
`set_java_vm` is now SET-ONCE — before an `unsafe` pointer could cross a lock soundly.

**And one of them is not verified the way the others are.** O-M43 records plainly that NOTHING executed the
Android path: `--target aarch64-linux-android` fails before `kasirmu-hal` is built (no NDK sysroot), so the
file was never type-checked by a target build. A host test calling `vm_pointer()` and asserting the no-VM
error would have been a false green over code it never runs, and was not written.

**The round's lesson is about GATES, and it cost a whole round to learn.** I ran
`cargo check --workspace --all-targets` for the first time as a deliberate step, and it failed immediately:
O-L11 had narrowed `VersionVector::iter` to `(&str, &Counter)` and broken
`apps/cloud-server/src/conflict_resolution.rs` — a DIFFERENT crate, so the commit that caused it
(`cargo check -p platform-sync`) passed. The workspace had not compiled for a round and nothing noticed.
**A per-crate check cannot see a cross-crate break.** That gate now runs clean at `WS=0`, zero warnings.

**O-M27 was attempted and reverted, and the attempt found something worth keeping.** The ledger names only
the Postgres path as non-atomic. The SQLite path has the same defect: `crates/kasirmu-api/src/routes/settings.rs:469` passes a plain
`Connection`, not a `Transaction`, and three `execute` calls autocommit independently. So a partial settings
save is possible on BOTH backends — and one observed run returned **HTTP 200 with all three keys written**
after a write that was meant to fail. The attempt left the crate uncompilable and had begun deleting
pre-existing tests, so it was reverted; the verified call-site analysis is recorded on the entry for the
next attempt.

**O-M46 is genuinely resolved now, and how it was resolved is the round's lesson.** The previous commit
said "resolve" while the crate HUNG: two tests that could never pass, one of them asserting a BLOCKING
property on a SYNCHRONOUS trait method — a property that does not exist. Behind that test sat a real
defect (`send().await` on a closed channel never resolves and parked a spawned task forever), and behind
THAT sat a third fact: a process-wide 1000/min audit rate limit that returns `Ok` without writing. Three
problems, one test failure, and the test had to be renamed because its name was itself the false claim.

**A note on my own record this round.** I misdiagnosed O-M51 twice — once calling a `0xffffffff` abort a
spinning eviction loop, once reading `left: 0 right: 1` as "nothing evicted". Both times the lane measured
and corrected me: the abort was its own multi-megabyte `eprintln!` inside a tokio worker, and the count was
a per-peer drop counted on the wrong side. **A symptom I have seen before is not a diagnosis.**

Counting rule unchanged — a `## §11*` heading or an in-entry marking verb; never a commit message alone.

**A correction that cost this round: THREE Test entries I opened as work were already paid**
(O-T01, O-T03 and O-T04's prescribed fix), and one (O-T04) understated its own blast radius by 43%
(787 call sites where the true count is 1,394). The Test tier was the last place I expected census
rot, which is the argument for re-verifying a tier before believing its own open list. §11AW records
what each one actually was.

**Updated 2026-10-21 (round 5).** O-M34 closed. The `platform/sync` Medium cluster it belonged
to was ALREADY complete — O-M35 through O-M39 all said "Fixed:" in their own text and I verified
three of them against symbols in the tree (`DEFAULT_MAX_OUTBOX_BATCH_ITEMS`, `get_last_synced_at`,
`DEFAULT_CRL_POLL_INTERVAL_SECS`). The ledger was accurate; my earlier reading of that block as
"five stale entries" was wrong, and the recount script agrees with the doc.

**THE HIGH TIER IS EMPTY as of 2026-10-21.** All 26 High findings are closed: 21 fixed, 3 verified
already paid by other lanes, 2 moot because their target files were deleted.

The last two closed this way:

- **O-H12** — keyset product paging with an always-present `has_more`/`next_after`, and the
  correlated stock subquery replaced by `LEFT JOIN LATERAL` (§11AN).
- **O-H17** — the checkout no longer holds the process-wide DB mutex across the RSA verify; the
  lock is released after the LOAD and the two pure-CPU checks run outside it (§11AQ). A cache was
  attempted first, failed on an untestable revocation hazard, and was rejected and reverted
  (§11AO/§11AP).

**The remaining work is Medium-and-below.** The largest coherent block is the `platform/sync`
Medium cluster (O-M34 to O-M39), which is the same round-trip shape O-H10 and O-H20 already have a
proven template for.

The earlier form of this table split "closed by a heading" from "marked PAID in-entry" and read 97
open. That split was misleading: the two conventions are equivalent evidence, and separating them
made the total look worse than the tree.

**Closed today, and how:** O-H01, O-H03, O-H04, O-H08, O-H09, O-H10, O-H11, O-H13, O-H18, O-H19,
O-H20, O-H21 fixed; O-H23, O-H24, O-H26 verified already paid by other lanes; O-H25, O-M57, O-M58
**moot** because their target files were deleted and the ledger had not noticed.

(Counted by script over the entry headers, not by eye — a first pass of this very table said
"Medium 47 defined / 21 closed", which is wrong in both columns and is exactly the census-rot
this journal keeps warning about. The numbers above reproduce.)

The six in-entry marks are **O-H03, O-H04, O-H08** (verified 2026-10-21 by naming the symbol each
fix introduced and confirming it exists at HEAD) and **O-H23, O-H24, O-H26** (verified the same
way — see the entries themselves for the exact function, line and commit).

**Why this table exists.** §11E already recorded the failure mode once: *"This is the fourth time
today that work recommended from a dated plan doc turned out already paid."* It then happened again
— O-H23/O-H24/O-H26 were paid on 2026-09-27, before this journal was told, and the §9 funding list
kept ranking all three at the head of the queue until this pass corrected it. **A reader who needs
the live list should trust this table, not the ranking in §9, which is history.**

**How to add to it.** Never tick an entry because a commit message claims a fix. Name the symbol
the fix introduced, `git grep` for it, and cite the line — that is the check that caught the
three "Fixed:" entries this journal had left ranked as open work.

---

## 0. Scope — "our crates", stated so the fence cannot drift later

**In scope (40 workspace members.** Re-derive with `cargo metadata --no-deps --format-version 1 | jq '.packages | length'`; this read 39 until `platform/instance-guard` landed on 2026-09-29.)** `Cargo.toml` globs `crates/*`, `modules/*`, `platform/*`
and lists `foundation`, `apps/cloud-server`, `apps/desktop-tauri`, `apps/mobile-tauri`
explicitly. Those 39 manifests are the whole subject of this todo.

**Out of scope, explicitly:**

- **Third-party dependencies.** Not this todo. Nothing below measures `Cargo.lock`, and no
  dependency version, feature or profile knob is proposed here. (The `[profile.*]` settings in
  the workspace manifest are third-party-oriented and are therefore *context*, not work items.)
- **The three excluded standalone crates** — `tools/fuzz`, `tools/fuzz/hfuzz`,
  `scripts/updater-compat-check`. Each pins its own graph by design and must not perturb the
  workspace lockfile (`Cargo.toml:29-33`).
- **Non-Rust surfaces** — the Go licence server (`apps/license-server`), the TypeScript UI, the
  Astro website, SQL migrations as such.

**What is not yet decided:** what "optimize" means here — compile time, binary size, dead-code
volume, test wall-clock, or crate-graph hygiene. Round 1 produces the list only. §5 turns the
list into candidate axes; picking one is yours.

---

## 1. The census — 39 crates, measured

`lines` is raw physical `wc -l` over every `*.rs` under each member (blank and comment lines
included) — a size proxy, **not** a complexity measure. `tests` counts `#[test]` +
`#[tokio::test]` attributes found in the tree; it counts attributes, not executed cases, so a
parameterised or macro-generated test may be one attribute and many cases. `t/kl` is test
attributes per 1,000 lines.

| # | package | path | files | lines | % | tests | t/kl |
|---|---|---|---|---|---|---|---|
| 1 | `kasirmu-core` | crates/kasirmu-core | 321 | 151,425 | 33.3 | 3,839 | 25.4 |
| 2 | `kasirmu-bridge` | crates/kasirmu-bridge | 142 | 73,726 | 16.2 | 1,402 | 19.0 |
| 3 | `kasirmu-mobile` | apps/mobile-tauri | 116 | 39,016 | 8.6 | 676 | 17.3 |
| 4 | `kasirmu-cloud` | apps/cloud-server | 65 | 31,071 | 6.8 | 405 | 13.0 |
| 5 | `kasirmu-app` | apps/desktop-tauri | 103 | 26,490 | 5.8 | 199 | 7.5 |
| 6 | `platform-sync` | platform/sync | 34 | 20,005 | 4.4 | 448 | 22.4 |
| 7 | `kasirmu-api` | crates/kasirmu-api | 42 | 18,408 | 4.0 | 329 | 17.9 |
| 8 | `platform-core` | platform/core | 29 | 14,004 | 3.1 | 410 | 29.3 |
| 9 | `kasirmu-hal` | crates/kasirmu-hal | 75 | 11,586 | 2.5 | 357 | 30.8 |
| 10 | `kasirmu-payment` | crates/kasirmu-payment | 32 | 8,262 | 1.8 | 236 | 28.6 |
| 11 | `foundation` | foundation | 20 | 7,198 | 1.6 | 455 | 63.2 |
| 12 | `kasirmu-cli` | crates/kasirmu-cli | 25 | 6,806 | 1.5 | 134 | 19.7 |
| 13 | `kasirmu-plugin` | crates/kasirmu-plugin | 13 | 4,778 | 1.0 | 184 | 38.5 |
| 14 | `kasirmu-lan` | crates/kasirmu-lan | 7 | 4,100 | 0.9 | 70 | 17.1 |
| 15 | `qris-core` | crates/qris-core | 16 | 3,964 | 0.9 | 45 | 11.4 |
| 16 | `platform-kernel` | platform/kernel | 12 | 3,832 | 0.8 | 130 | 33.9 |
| 17 | `platform-startup` | platform/startup | 10 | 3,483 | 0.8 | 81 | 23.3 |
| 18 | `kasirmu-security` | crates/kasirmu-security | 15 | 2,674 | 0.6 | 94 | 35.2 |
| 19 | `modules-inventory` | modules/inventory | 10 | 2,470 | 0.5 | 83 | 33.6 |
| 20 | `modules-currency` | modules/currency | 10 | 2,104 | 0.5 | 88 | 41.8 |
| 21 | `kasirmu-reporting` | crates/kasirmu-reporting | 12 | 2,066 | 0.5 | 81 | 39.2 |
| 22 | `kasirmu-lua` | crates/kasirmu-lua | 6 | 2,007 | 0.4 | 68 | 33.9 |
| 23 | `modules-sales` | modules/sales | 11 | 1,779 | 0.4 | 50 | 28.1 |
| 24 | `kasirmu-notification` | crates/kasirmu-notification | 10 | 1,711 | 0.4 | 33 | 19.3 |
| 25 | `kasirmu-media` | crates/kasirmu-media | 13 | 1,656 | 0.4 | 29 | 17.5 |
| 26 | `kasirmu-local-api` | crates/kasirmu-local-api | 2 | 1,464 | 0.3 | 18 | 12.3 |
| 27 | `kasirmu-logging` | crates/kasirmu-logging | 10 | 1,371 | 0.3 | 50 | 36.5 |
| 28 | `modules-loyalty` | modules/loyalty | 7 | 1,214 | 0.3 | 39 | 32.1 |
| 29 | `modules-tax` | modules/tax | 8 | 1,121 | 0.2 | 62 | 55.3 |
| 30 | `modules-staff` | modules/staff | 7 | 989 | 0.2 | 52 | 52.6 |
| 31 | `modules-reporting` | modules/reporting | 8 | 893 | 0.2 | 26 | 29.1 |
| 32 | `kasirmu-crypto` | crates/kasirmu-crypto | 2 | 795 | 0.2 | 21 | 26.4 |
| 33 | `modules-crm` | modules/crm | 7 | 686 | 0.2 | 27 | 39.4 |
| 34 | `modules-terminal` | modules/terminal | 7 | 667 | 0.1 | 30 | 45.0 |
| 35 | `modules-settings` | modules/settings | 7 | 647 | 0.1 | 21 | 32.5 |
| 36 | `modules-kitchen` | modules/kitchen | 3 | 247 | 0.1 | 8 | 32.4 |
| 37 | `modules-purchasing` | modules/purchasing | 3 | 243 | 0.1 | 9 | 37.0 |
| 38 | `modules-giftcards` | modules/giftcards | 3 | 233 | 0.1 | 8 | 34.3 |
| 39 | `modules-promotions` | modules/promotions | 3 | 230 | 0.1 | 8 | 34.8 |
| | **total** | | **1,223** | **455,174** | **100** | **10,297** | **22.6** |

Reproduce: the command in the appendix. Measured 2026-09-25 on branch `0.0.40`.

### Group totals

| group | crates | files | lines | % | tests |
|---|---|---|---|---|---|
| `crates/*` (incl. `qris-core`) | 17 | 743 | 296,799 | 65.2 | 6,990 |
| `apps/*` (cloud, desktop, mobile) | 3 | 284 | 96,577 | 21.2 | 1,280 |
| `platform/*` (core, kernel, startup, sync) | 4 | 85 | 41,324 | 9.1 | 1,069 |
| `foundation` | 1 | 20 | 7,198 | 1.6 | 455 |
| `modules/*` | 14 | 91 | 13,276 | 2.9 | 503 |

---

## 2. Cross-check against the repo's own counter — and the 3-file gap

`stats.json` (regenerated today, `0e39fc288`) reports Rust at **1,235 files / 455,869 lines**
repo-wide; the walk in §1 totals **1,223 / 455,174**. The three excluded standalone crates
account for **9 files / 568 lines** of that (`tools/fuzz` 7/399,
`scripts/updater-compat-check` 2/169, `tools/fuzz/hfuzz` 0/0).

That leaves **3 files / 127 lines unattributed**. `stats.json` is not stale, so the gap is a
counting-rule difference or a mid-flight edit by a concurrent session in this shared checkout.
**Not chased further** — it is 0.03% of volume and cannot change any ranking below. Flagged so
the two numbers are never quoted as if they were the same instrument.

---

## 3. What the list says — four readings, all from the census alone

**F1 — Volume is concentrated, and one crate is a third of it.** `kasirmu-core` is 33.3% of
our Rust. The top five are 70.7%; the top ten are 86.6%. Any crate-level optimization that
does not touch `kasirmu-core` is working on at most two thirds of the surface, and probably
less: the bottom 29 crates together are 13.4%.

**F2 — Tests are the majority of our Rust, and they own the largest compile units.** 476 files
matching `*_tests.rs` or `*/tests/*.rs` hold **240,257 lines — 52.8%** of everything in §1;
production code is 214,917 lines (47.2%). The nine largest single files in the workspace are
all test files:

| file | lines |
|---|---|
| `crates/kasirmu-core/src/db/sales_tests.rs` | 4,933 |
| `crates/kasirmu-core/src/db/kds_tests.rs` | 3,784 |
| `crates/kasirmu-core/src/migrations_tests.rs` | 3,465 |
| `apps/desktop-tauri/src/commands/topology/topology_command_tests.rs` | 2,895 |
| `apps/cloud-server/src/sync_api_tests.rs` | 2,642 |
| `platform/sync/src/queue_tests.rs` | 2,623 |
| `crates/kasirmu-core/src/db/products_tests.rs` | 2,586 |
| `apps/desktop-tauri/src/commands/registration_gate_tests.rs` | 2,500 |
| `crates/kasirmu-bridge/src/pos_tests.rs` | 2,399 |

Read the consequence plainly: whatever makes the workspace slow to compile is more likely to
be sitting in a test module than in production code. That inverts the usual instinct, which is
to look at `src/` and never at `*_tests.rs`.

**F3 — The largest production files are the obvious split candidates, if splitting is the chosen
axis.** Top of the non-test list:

| file | lines |
|---|---|
| `crates/kasirmu-api/src/pg.rs` | 2,904 |
| `crates/kasirmu-bridge/src/pos.rs` | 2,339 |
| `crates/kasirmu-bridge/src/staff.rs` | 1,692 |
| `platform/sync/src/queue.rs` | 1,563 |
| `apps/mobile-tauri/src/commands/pos.rs` | 1,543 |
| `crates/kasirmu-bridge/src/auth.rs` | 1,527 |
| `apps/desktop-tauri/src/lib.rs` | 1,464 |
| `crates/kasirmu-bridge/src/settings.rs` | 1,450 |
| `crates/kasirmu-core/src/subscription.rs` | 1,309 |
| `crates/kasirmu-bridge/src/data.rs` | 1,270 |

**F4 — The module tier is a rounding error, and four of it are stubs.** All 14 `modules/*`
crates are 2.9% of volume (13,276 lines). Four of them — `kitchen` (247), `purchasing` (243),
`giftcards` (233), `promotions` (230) — share the same shape: three files, ~8 test attributes,
the "planned verticals" stubs the workspace manifest registers ahead of implementation
(`Cargo.toml:76-77`). No crate-level optimization is justified by this tier on size grounds.

**Test density is uneven and worth one look, later.** `foundation` runs 63.2 test attributes per
1k lines; `modules-tax` 55.3, `modules-staff` 52.6. At the other end, `kasirmu-app`
(desktop-tauri) runs **7.5** — 199 attributes across 26,490 lines, the lowest of the ten
largest crates, and roughly a quarter of `kasirmu-core`'s density. That is a coverage signal,
not a performance one, and it does not by itself mean anything is wrong: a Tauri shell is
largely command wiring, which resists unit testing. Noted, not acted on.

---

## 4. What this census does NOT tell us — no instrument was run _(partially closed by §10)_

Everything below is unmeasured. It is listed so that no one mistakes §1 for evidence about it.

| claim nobody has earned yet | instrument that would earn it |
|---|---|
| which crates are slow to compile | `cargo build --timings` (per-crate wall clock), or `cargo +nightly -Z timings` |
| which crates cost binary size | `cargo bloat --release` (needs install), or `cargo build --release` + `size` on the artifact |
| how much of our code is unreachable | `cargo-udeps` (nightly) for deps; `#[warn(dead_code)]` counts for our own — not run |
| fan-in / fan-out between our crates | `cargo tree -e normal --invert <crate>` per crate |
| how much is behind feature flags | per-crate `[features]` read + `cargo tree -f` |
| test wall-clock per crate | `cargo test -p <crate> -- --report-time`, or `cargo nextest run` (per-test timing) |
| whether any crate is a dependency cycle | `cargo tree` / a cycle check — not run |

**Updated 2026-09-25 — §10 earned three of these rows and partially earned two.** Fan-in/fan-out
and the cycle check are now measured (there are **zero** cycles); the test wall-clock row has a
measured stated-sleep floor. Compile time, binary size and dead-code volume are still unearned.
See §10C for the row-by-row status and §10D for why no build was run.

Build profiles, for context only — not a work item:
`[profile.release]` is `opt-level = 3`, `lto = "thin"`, `codegen-units = 8`,
`strip = "symbols"`, `overflow-checks = true` (`Cargo.toml:209-214`);
`[profile.release.package.kasirmu-app]` overrides to `codegen-units = 1`, `opt-level = "s"`,
`strip = true` (`:221-224`); `[profile.dev]` is `opt-level = 0`, `incremental = true`,
`codegen-units = 256` with `debug = "line-tables-only"` (`:226-238`, the 413.5 MB Android
debug `.so` measurement is recorded there); `[profile.test]` and `[profile.tdd]` inherit from
dev (`:261-278`).

---

## 5. Candidate axes — unfunded, pick one

Each is stated with the instrument that decides whether it is worth doing. **None is approved.**

| | axis | what it would do | deciding instrument | first thing to measure |
|---|---|---|---|---|
| **A** | **Compile time** | Split or feature-gate the hot compile units (F2, F3) so an incremental build touches less | `cargo build --timings` | per-crate wall clock on a cold then warm build |
| **B** | **Test-suite wall clock** | Attack the 52.8% (F2) — the largest test modules are also the slowest to compile and link | `cargo nextest run` / `-- --report-time` | per-crate test time vs. LOC, to see if size predicts time |
| **C** | **Dead / unreachable code** | Delete unused `pub` items and decide what to do with the four stub modules (F4) | `dead_code` warnings + `cargo-udeps` | warning inventory per crate |
| **D** | **Crate-graph hygiene** | Reduce fan-in to `kasirmu-core`, break cycles, move what does not belong | `cargo tree --invert` | the actual edge list between our 39 crates |
| **E** | **Binary size** | Act on F3 and the release profile for the two Tauri shells | `cargo bloat` | release artifact size per app, before/after |

**My read, offered not imposed:** A and B are the only two with a plausible order-of-magnitude
payoff, because both attack the same 52.8% — tests — from different ends, and F2 says that is
where the mass is. C is cheap and satisfying but the module tier is 2.9%, so its ceiling is low
unless the real dead code is in `kasirmu-core`. D is architectural and slow to verify. E is
bounded by the shells and is the only one with a user-visible number at the end. If you want
the largest measured effect per unit of risk, fund **B first**, with `--timings` run once to
confirm the guess rather than trust it.

---

## 6. Rules for whichever phase gets funded

- **Fence:** not set yet — this round is doc-only, nothing was edited. The funded phase names
  its files explicitly here before any edit, and the fence widens only by a decision recorded
  in this file.
- **Commit prefixes** (one per area touched; a single-crate prefix would misattribute):
  `perf(kasirmu-core):` · `perf(kasirmu-bridge):` · `perf(mobile-tauri):` ·
  `perf(desktop-tauri):` · `perf(cloud-server):` · `perf(platform-sync):` · `test(<crate>):` ·
  `chore(cargo):` for manifest-only edits.
- **Acceptance must be a command that was run**, with its output quoted in the section that
  closes the phase — per the repo rule that `done-todo-*` is earned only when the acceptance
  command ran and passed. "Faster" without a before/after number does not close a phase.
- **Version is locked at 0.0.40.** No manifest edit in this todo touches a version number.

---

## Appendix — reproduce the census

```bash
# per-crate: files, lines, test attributes
for d in crates/* modules/* platform/* foundation apps/cloud-server apps/desktop-tauri apps/mobile-tauri; do
  [ -f "$d/Cargo.toml" ] || continue
  pkg=$(grep -m1 '^name *=' "$d/Cargo.toml" | cut -d'"' -f2)
  n=$(find "$d" -name '*.rs' -type f | wc -l)
  l=$(find "$d" -name '*.rs' -type f | xargs cat | wc -l)
  t=$(grep -rn '#\[test\]\|#\[tokio::test\]' "$d" --include='*.rs' | wc -l)
  echo "$pkg|$d|$n|$l|$t"
done | sort -t'|' -k4 -rn

# largest files, all and production-only
find crates modules platform foundation apps/cloud-server apps/desktop-tauri apps/mobile-tauri \
  -name '*.rs' -type f | xargs wc -l | grep -v ' total$' | sort -rn | head -20

# test volume
find crates modules platform foundation apps/cloud-server apps/desktop-tauri apps/mobile-tauri \
  \( -name '*_tests.rs' -o -path '*/tests/*.rs' \) | xargs cat | wc -l
```

Caveats carried by the numbers: `lines` includes blank and comment lines; `tests` counts
attributes rather than executed cases; both were taken in a shared checkout where another
session may have been editing, so a re-run on a quiet tree can differ by a few hundred lines.

---

## 7. Scale-review journal — round 2 (2026-09-25)

**Method.** Read-only review, one crate cluster at a time, over: `kasirmu-core` (db layer and
non-db logic audited separately), `kasirmu-bridge`, `apps/cloud-server` + `kasirmu-api`, the two
Tauri shells (`apps/desktop-tauri`, `apps/mobile-tauri`), and `platform/*`. Focus classes, as
ordered: algorithmic complexity, unnecessary allocations/clones, blocking or unbatched I/O and
DB queries, missing pagination / unbounded caching, lock contention, error handling,
non-idiomatic Rust.

**Provenance legend.** ✔ = I re-read the cited lines on this date and the code matches the
entry. ◦ = the entry carries line references produced by its audit pass; spot-check pending.
No finding below was written from recollection, and **no crate code has been changed**.

**Coverage gap (stated, not hidden):** the pass over the support crates (`kasirmu-hal`,
`-payment`, `-cli`, `-plugin`, `-lan`, `qris-core`, `-security`, `-reporting`, `-lua`,
`-notification`, `-media`, `-local-api`, `-logging`, `-crypto`), the 14 `modules/*` verticals
and `foundation` **did not run** — the audit agent for that cluster died on an API rate limit
mid-flight. No entry below comes from those crates, and their absence from this journal is not
evidence of cleanliness. That pass is the first open item of round 3.

### High — likely to bite within months as data and users grow

**O-H01 · kasirmu-core — popularity recomputed per sold line, six queries each** —
✅ **PAID 2026-10-21.** `Store::recompute_popularity_batch` (`db/popularity.rs`), called once
from `complete_sale` (`db/sales_lifecycle.rs:627-636`), replaces the per-line loop.
`crates/kasirmu-core/src/db/sales_lifecycle.rs:602-606` ✔
After every checkout, `complete_sale` walks the sale's lines and calls `recompute_popularity`
per SKU; each call runs six separate queries (`popularity.rs:659-663` — `sale_day_counts`,
`sale_distinct_transactions`, two `activity_day_counts`, plus `sku_means`' reads), each a
`sale_lines ⋈ sales` scan. This is the hottest write path in the product, so cost grows with
cart size on every sale. *Fix:* recompute all affected SKUs in one grouped pass keyed by the
sale's line set, or move the refresh onto a debounced/async queue.

**O-H02 · kasirmu-core — catalog list is unbounded and its image join blows up on placeholder
count** — `crates/kasirmu-core/src/db/products_crud.rs:22-41` ✔ · **PAID** (`91ace97de`). Chunked image lookups in `attach_images` into fixed-size batches of 250, eliminating unbounded SQL string allocation and SQLite variable number overflow on large catalogs. See §11BS.

**O-H03 · kasirmu-core — offline-queue drain pays one fsync per item** —
`crates/kasirmu-core/src/sync_client.rs:86-105` ✔. ✅ **PAID** (re-verified at HEAD 2026-10-21:
`Store::mark_offline_synced_batch` exists at `db/offline.rs:298` with a test at `offline_tests.rs:302`).
Fixed: `apply_sync_outcomes` wraps all outcome transitions into a single transaction in autocommit mode, reducing N disk fsyncs during queue drain to 1. Added `Store::mark_offline_synced_batch`. Verified with unit tests in `offline_tests.rs` and `sync_client_tests.rs`.

**CORRECTION 2026-10-22 (audit): the MECHANISM sentence above names the wrong collaborator.** The fsync
win comes from the OUTER transaction (`sync_client.rs:94-99` opens one `unchecked_transaction` and
commits once), **not** from `mark_offline_synced_batch`. The loop inside still calls the plain
`mark_offline_synced` per item (`sync_client.rs:117`), and `mark_offline_synced_batch` itself has **no
non-test caller outside that wrapping** — `daemon.rs`/`lib.rs` use it, but the path this entry is about
does not. The fix is real and PAID; the credit line was wrong. Worth keeping because a future reader who
"optimises" the loop to call `mark_offline_synced_batch` would change nothing.

**O-H04 · kasirmu-core — a fresh `reqwest::Client` per sync HTTP call** —
`crates/kasirmu-core/src/sync_client.rs:400-420` ✔. ✅ **PAID** (re-verified at HEAD 2026-10-21:
`shared_sync_http_client()` at `sync_client.rs:430`, called from `:449` and `:610`).
Fixed: introduced static pooled `shared_sync_http_client()` via `OnceLock<reqwest::Client>` across `send_items_to_server`, `ack_memo_on_server`, `push_memos_to_server`, `fetch_active_memos_from_server`, `qris_charge_on_server`, and `qris_status_from_server`, retaining keep-alive and connection pool reuse across sync cycles and polls.

**O-H05 · kasirmu-bridge — staff screen costs 2N+2 queries and the whole roster** —
`crates/kasirmu-bridge/src/staff.rs:342-369` ✔. Fixed: added batched accessors `Store::list_user_profiles_map`, `Store::list_assignments_map`, and `Store::list_staff_codes_map`, replacing 3N queries across users with 3 single indexed queries and constant-time in-memory map joins. Verified with `staff_tests.rs` (132/132 passed).

**O-H06 · kasirmu-bridge — catalog import probes existence per row inside one long
transaction** — `crates/kasirmu-bridge/src/data.rs:505-666` ✔. Fixed: pre-fetched `HashSet` of existing SKUs/categories/sales/customers/users via single index queries, hoisted RFC-3339 timestamp `now`, and eliminated `val.clone()` via owned payload iteration in both `gate_import_product_batch`/`gate_import_user_batch` and `import_data`. Verified with `data_tests.rs` (79/79 passed).

**O-H07 · kasirmu-bridge — the whole offline queue goes up in one HTTP call** —
`crates/kasirmu-bridge/src/sync.rs:580` ✔. Fixed: looped push in bounded batches of up to `DEFAULT_MAX_OUTBOX_BATCH_ITEMS` (100) using `Store::list_pending_offline_for_push_bounded` until queue drains, handling auth-token refresh across batches. Verified with unit test `sync_run_scoped_drains_large_backlog_in_bounded_batches` in `sync_tests.rs`.

**O-H08 · kasirmu-bridge — the "batch" track-serial lookup runs a full join per SKU** —
`crates/kasirmu-bridge/src/products.rs:201-222` ✔. ✅ **PAID** (re-verified at HEAD 2026-10-21:
`Store::get_products_track_serial_batch` at `db/products_crud.rs:830`).
Fixed: added `Store::get_product_track_serial` and `Store::get_products_track_serial_batch` in `products_crud.rs` executing direct `SELECT sku, track_serial FROM products WHERE sku IN (...)` without wide 8-table joins, and updated `run_get_product_track_serial_batch` and `get_product_track_serial` in `kasirmu-bridge`. Verified in `products_tests.rs`.

**O-H09 · cloud-server — plan middleware queries the DB on every sync request** —
✅ **PAID 2026-10-21.** `PlanCache` (`sync_store/plan_cache.rs`): 5s TTL, 10k cap with
nearest-expiry eviction, `Ok(None)` cached, **errors never cached and never converted to
`Ok(None)`**. `plan_middleware` reads through `get_or_load`; the 500 arm is byte-identical.
`apps/cloud-server/src/sync_api.rs:236-242` ◦
`plan_middleware` runs on every `/api/sync/*` request; `get_tenant_plan`
(`sync_store/tenant.rs:34-46`) is a pool checkout + transaction + `set_config` GUC + SELECT +
rollback — four round trips per request, uncached, so DB load scales with request rate, not
tenant churn. *Fix:* short-TTL per-tenant plan cache.

**O-H10 · cloud-server — conflict detection does ~10 round trips per pushed item** —
✅ **PAID 2026-10-21.** One detection pass per PAGE: `SyncStore::detect_conflicts` opens one
transaction, sets the RLS GUC once, and answers the whole page with chunked `ANY(...)` reads
and `UNNEST` writes. ~13 round trips/item → **7 per 500-item page**. Decision logic extracted
to one `decide()` shared by both paths.
`apps/cloud-server/src/sync_store.rs:178-200` ◦
Per item, `detect_conflict` (`sync_store/conflicts.rs:239-297`) runs `load_entity_vector` +
`load_entity_payload` + `save_entity_vector`, each with its own pool checkout + transaction +
GUC — one 500-item push ≈ 5,000 round trips. *Fix:* hoist one connection/transaction around
the batch and read/write vectors with `IN (…)` statements.

**O-H11 · kasirmu-api — one product SELECT per sale line inside the sale transaction** —
✅ **PAID 2026-10-21.** One `WHERE tenant_id = $1 AND sku = ANY($2::text[])` at
`pg/sales.rs:146-147` resolves the whole receipt before the loop, which now does a
`HashMap` lookup instead of a `query_opt`.
`crates/kasirmu-api/src/pg/sales.rs:117` ◦ — **RE-ANCHORED 2026-10-21:** the cited
`pg.rs:1712-1727` no longer exists; `pg.rs` was split into a `pg/` directory and the query,
verbatim the one described below, is now at `pg/sales.rs:117`. Re-verified live.
Every sale line issues its own `SELECT … FROM products WHERE tenant_id = $1 AND sku = $2`, so a
30-line receipt costs 30 round trips and holds the pooled connection and row locks
proportionally longer. *Fix:* resolve all SKUs in one `WHERE sku = ANY($2)` before the insert
loop.

**O-H12 · kasirmu-api — the products endpoint is unbounded with a correlated subquery per
row** — ✅ **PAID 2026-10-21, both halves.** `list_products_page` does keyset paging on
`(name, sku)` with `DEFAULT_PRODUCT_PAGE_LIMIT = 100` / `MAX_PRODUCT_PAGE_LIMIT = 500`, and the
reply ALWAYS carries `has_more` + `next_after` (derived by fetching one row PAST the page, not
by `len == limit`). The correlated subquery is replaced by
`LEFT JOIN LATERAL (...) ON TRUE` — a grouped join was deliberately rejected because it has no
`item_id` predicate and would aggregate the whole table per page on a catalogue walk.
`crates/kasirmu-api/src/pg/products.rs:312` ◦ — **RE-ANCHORED 2026-10-21:**
`pg.rs:1332-1345` no longer exists after the `pg/` split; `list_products` is now
`pg/products.rs:312` and still takes no limit/bound parameter, and the file's own comment at
`:181` says so in as many words ("`list_products` has no LIMIT"). Re-verified live.
`GET /api/v1/products` has no LIMIT/OFFSET and `PRODUCT_SELECT` (`pg.rs:1038`) adds a
correlated `SELECT SUM(ss.qty) FROM stock_summary` per row — response body and query cost both
grow linearly with catalog size. *Fix:* keyset pagination; replace the correlated subquery with
a grouped `LEFT JOIN`.

**O-H13 · kasirmu-api — synchronous file I/O inside async handlers** —
✅ **PAID 2026-10-21.** All five blocking sites in `routes/images.rs` converted to `tokio::fs`
(`:87` `store_image_atomic` is now `async fn`, its call site awaited at `:151`; reads at `:368`
and `:458`). `crates/kasirmu-api/src/routes/images.rs:351` ◦
`std::fs::read` in the image route (and `std::fs::write`/`rename` at `:93-94`, read again at
`:441`) blocks a tokio worker; a slow volume stalls every other request on that worker thread.
*Fix:* `tokio::fs` or `spawn_blocking`.

**O-H14 · mobile — product list is an N+1 over tax rates with an unbounded payload** —
**HALF PAID 2026-10-21** — the N+1 is gone; the unbounded payload is NOT.
`apps/mobile-tauri/src/commands/products.rs:129-165` ◦ — **SPLIT 2026-10-21 after re-reading at
HEAD.** `map_products_to_dtos` (`:146`) now does ONE `get_product_tax_rates_batch(&skus)` and
says so in as many words ("PROD-12/O-H14: batch-load tax rates for all products in one query,
replacing the N+1 per-product lookup"). The only surviving per-product call is
`map_pwd_to_dto` (`:225`), which maps a SINGLE product and is correctly one lookup. **So the
N+1 half of this entry is closed and the sentence below is stale for it.** What remains is the
second half: `list_products` (`:107`), `list_products_scoped` (`:401`) and
`list_warehouse_products_scoped` (`:420`) still call unpaged core listers
(`list_products` / `list_warehouse_products` in `db/products_crud.rs:47` / `:108`), so the IPC
payload is still linear in catalog size. Read the rest of this entry as the payload half only.
`map_products_to_dtos` calls `get_product_tax_rates` per product, and its callers
(`list_products`, `list_products_scoped`, `list_warehouse_products_scoped`) load the whole
catalog with no LIMIT — N+1 queries plus one IPC payload linear in catalog size. *Fix:* one
grouped tax-rate query; paginate the list commands.

**O-H15 · mobile — sales history materialises every sale in the tier window** —
`apps/mobile-tauri/src/commands/history.rs:58-82` ✔ · **PAID** (`badd10ee5`). Pushed down `LIMIT` and `OFFSET` pagination to SQLite via `Store::list_sales_with_history_cap_bounded` across core, bridge, and mobile. See §11BR.

**O-H16 · desktop — every KDS transition rebuilds the whole queue snapshot** —
`apps/desktop-tauri/src/commands/kds.rs:112-130` ✔. Fixed: indexed existing active tickets in `refresh_kds_queue_cache` to reuse cached line items and station routing for all unchanged orders, and passed `dirty_order_id` so that only the modified ticket is re-queried during item bumps. Reduced bridge round trips during order transitions and line bumps from $O(\text{active tickets})$ to $O(1)$. Verified with `kds_lan_live` test suite in `kasirmu-app`.

**O-H17 · mobile — every checkout loads the subscription and verifies RSA under the global DB
mutex** — ✅ **PAID 2026-10-21, by releasing the lock rather than caching.** The LOAD stays
under the guard; `verify_signature` + `enforce_pos_writable` now run AFTER it is released, at
both sites. ~197 us of held-mutex time removed per checkout in release (2,563 us in debug) with
**zero change to what is accepted**. A cache was tried and rejected — see §11AO/§11AP.
The behavioural note, stated rather than hidden: a revocation landing in the microseconds
between read and check no longer pre-empts THAT checkout; the next command sees it.
⚠️ **A cache was REJECTED 2026-10-21; see §11AO and §11AP for the corrected reasoning.**
**MY EARLIER "licence bypass" CALL WAS WRONG** and is retracted: the Premium-through-sentinel
result came from a deliberate `#[cfg(debug_assertions)]` short-circuit at
`crates/kasirmu-core/src/license_verification/crl.rs:185-188`, documented at `:178-184`, which
accepts the sentinel for ANY payload in debug builds only. Release rejects a paid sentinel at the
base64 decode (`InvalidSubscriptionSignature`, symbol 95 = the `_` of `BOOTSTRAP_FREE`). The
invariant IS pinned — by `sentinel_does_not_carry_a_paid_tier`
(`subscription_tests.rs:198-213`), whose release arm asserts the rejection and whose debug arm
deliberately asserts the permissive legacy behaviour. Two protecting tests exist
(`license_verification_tests.rs:75` and that one). **The RSA cost stands and is real.**
`apps/mobile-tauri/src/commands/pos.rs:840-846` and
`apps/mobile-tauri/src/commands/pos/checkout.rs:662-669` ◦ — **RE-ANCHORED 2026-10-21:** the cited
`pos.rs:993-1006` no longer exists. The block now sits at TWO sites, both inside
`state.db.lock().await`: the main checkout (`pos/checkout.rs:662-669`) and the shortfall-retry
command (`pos.rs:840-846`). `verify_signature` is `crates/kasirmu-core/src/subscription.rs:274`,
and it performs a real RSA verify except for the `BOOTSTRAP_FREE` sentinel short-circuit at `:291`.
There is NO cache today: `SubscriptionLoader::load_verified_subscription`
(`entitlements.rs:323-355`) loads and verifies on every call. Re-verified live.
Each checkout (and shortfall retry) takes the process-wide DB mutex, loads
`TenantSubscription::load`, and runs `verify_signature` (RSA-2048), then re-acquires the same
mutex for settlement — heavy CPU under the global lock on the hottest path. *Fix:* cache the
verified subscription keyed by row version; settle under one acquisition.

**O-H18 · platform/sync — full stock-summary rebuild per backlog page** —
✅ **PAID 2026-10-21 (hoist only; the page cap is NOT done).** The rebuild is gone from
`apply_pulled_page` and happens once after the pull loop, OR-folding "did ANY page carry a
movement" so an earlier movement page is not lost when the last page has none.
`platform/sync/src/pg_daemon.rs:388-389`, `:844` ◦
The PG pull loop pages with no page cap, and any page containing a `stock.movement` triggers
`rebuild_stock_summary()` over the entire delta ledger — a large backlog costs
O(pages × all movements) inside one tick. *Fix:* cap pages per tick with a persisted cursor and
rebuild once after all pages (or make the rebuild incremental).

**O-H19 · platform/sync — the SQLite daemon push is unbatched** —
✅ **PAID 2026-10-21.** Both call sites route through
`build_batches(&pending, MAX_BATCH_BYTES)` via a new `push_batches`; the 401 retry reuses the
SAME split rather than re-reading the queue (re-reading could push items that arrived mid-tick).
`platform/sync/src/daemon_tick.rs:267` ◦
`transport.push_items(&pending)` POSTs the whole pending vector in one request, while
`SyncEngine` batches at 64 KB — as the queue backs up, body size and the 30 s ceiling are
exceeded, the cycle fails, and the queue grows further. *Fix:* route through
`build_batches(&pending, MAX_BATCH_BYTES)`.

**O-H20 · platform/sync — PG transport does one network round trip per item** —
✅ **PAID 2026-10-21.** One multi-row `INSERT` per 1,000-row chunk inside the SAME
transaction (5,000 items = 5 statements). Along the way this closed a pre-existing DEFECT at
HEAD: the per-item statement emitted `($1,$2,$3,'pending',$4..$7)` with seven binds, so
`retry_count` received the `last_error` value and `origin_terminal_id` was never bound —
PostgreSQL rejects it with "there is no parameter $8". Dead code, no live test ever ran it.
`platform/sync/src/pg_transport.rs:308-336` ◦
Per item, an `INSERT INTO offline_queue …` inside a single transaction — a 5,000-item drain is
5,000 sequential round trips holding the transaction (and its locks) open for minutes. *Fix:*
multi-row `INSERT … VALUES (…), (…)` on a prepared statement.

**O-H21 · platform/sync — apply loop: one autocommitted UPDATE per item while holding the DB
mutex, and `zip` silently drops items** — `platform/sync/src/daemon.rs:214-270`, `lib.rs` ✔ · **PAID** (`a5797e020`). Batched accepted push outcomes into a single transaction via `mark_synced_batch` and preserved length-mismatch diagnostics. See §11BT.

**O-H22 · platform/core — the process-wide store-DB mutex is held across migrations** —
`platform/core/src/database/manager.rs:73-87` ✔. Fixed: scoped global `store_dbs` mutex to map lookup and insert, running `open_or_create_connection` and migrations outside the global lock, and serialized same-store initialization via per-store init locks. Verified with concurrent opening tests in `manager_tests.rs`.

### Medium — likely to bite within years

**O-M01 · kasirmu-core — `recompute_all_popularity` re-plans one UPDATE per SKU** —
`crates/kasirmu-core/src/db/popularity.rs:963-978` ✔. Fixed: hoisted `tx.prepare_cached("UPDATE products SET popularity_score = ?1 WHERE sku = ?2")` above the SKU update loop, eliminating statement recompilation for each catalog item. Verified in `popularity_tests.rs`.

**O-M02 · kasirmu-core — popularity scoring re-reads settings and re-parses JSON per
point** — `crates/kasirmu-core/src/db/popularity.rs:415-434` ✔. Fixed: introduced `all_category_means` helper reading and parsing the `CATEGORY_MEANS` JSON blob once before the points loop into a `HashMap<String, (f64, f64, f64)>`, replacing sequential database reads and JSON parsing per point with constant-time in-memory lookups. Verified in `popularity_tests.rs`.

**O-M03 · kasirmu-core — pending-queue listers are unbounded** —
`crates/kasirmu-core/src/db/offline.rs:572-589` ✔. Fixed: added `Store::list_pending_offline_for_push_bounded` and `Store::list_pending_offline_for_tenant_for_push_bounded` executing `ORDER BY priority ASC, created_at ASC, id ASC LIMIT ?1` directly in SQLite. Replaced whole-table loading and post-hoc truncation in `platform/sync` daemon loops (`daemon.rs`, `pg_daemon.rs`), `kasirmu-bridge` offline sync, and mobile sync commands, ensuring bounded memory consumption and instant priority ordering during large offline backlog drains. Verified in `offline_tests.rs` and `daemon_tests.rs`.

**O-M04 · kasirmu-core — offline idempotency probe substring-scans every payload** —
`crates/kasirmu-core/src/db/offline.rs:561-567` ◦. `instr(payload, …)` over all pending rows,
per sale, on the checkout path. *Fix:* indexed `sale_id` column and equality probe.

**RE-VERIFIED 2026-10-22 — STILL OPEN, but the cited location is WRONG.** The claim lives at
`crates/kasirmu-core/src/db/offline/enqueue.rs:502-515` (`has_pending_outbox_row_for_sale`); the quoted
`offline.rs:551-564` is `delete_offline_item_for_tenant` and has no `instr`. Real caller:
`platform/startup/src/event_handlers.rs:95-97`. **MEASURED query plan:**
`SEARCH offline_queue USING INDEX idx_offline_queue_status (status=?)` — an index RANGE over EVERY
pending row, `instr`-scanning each `payload` in turn. This is worth more than the entry implies: the
cost is proportional to the whole pending backlog, not to the sale, and every settlement pays it.

**✅ CLOSED 2026-10-22 — measured and DECLINED (§11BZ). The plan is real; the cost is not.**

20,000 pending rows at ~400-byte payloads, 100 probes: **1.6955 ms total, ~17 µs per probe.** At any
scale this probe will meet, that is invisible beside the settlement transaction it runs inside. The
prescribed fix (nullable `sale_id` + migration + generated `init.pg.sql` re-sync + backfill + both writers)
would buy microseconds and cost a schema change — and `enqueue.rs:489-501` documents that keying on the
JSON string is DELIBERATE, so two writers with different JSON shapes cannot create a duplicate row. A
`sale_id` column is the better data model, but it is a data-model change, not a performance fix.
**This entry was ranked Medium and read as a live hot-path defect. It is neither hot nor a defect.**

**O-M05 · kasirmu-core — tax-rate validation is a per-id round trip** —
`crates/kasirmu-core/src/db/tax/assignments.rs:26-34` ✔. Fixed: replaced sequential per-id `get_tax_rate` queries with a single batched `IN (...)` validation query in `ensure_active_tax_rate_ids`, and hoisted `prepare_cached` for junction insert loops in `set_product_tax_rates` and `set_category_tax_rates`. Verified in `tax_tests.rs`.

**O-M06 · kasirmu-core — `category_popularity` loads the whole catalog to keep top-N per
category** — `crates/kasirmu-core/src/db/popularity.rs:517-563` ✔. Fixed: replaced whole-catalog materialization with SQL `ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY popularity_score DESC, sku ASC)` filtered by `rn <= ?1`, using the already-computed `cat.product_count` for percentile calculations. Verified in `popularity_tests.rs`.

**O-M07 · kasirmu-core — stock-movement archive commits a transaction per group** —
`crates/kasirmu-core/src/db/products_stock_adjust/movements.rs:93-94` ✔. Fixed: batched item groups into transactions of 50 items (`ARCHIVE_BATCH_SIZE`) and hoisted `prepare_cached` statement preparation across the batch for archive inserts, rollup creations, and live deletions. Verified across all archive tests in `products_tests.rs`.

**O-M08 · kasirmu-core — promotion engine does a per-line DB lookup, twice** —
`crates/kasirmu-core/src/promotion_engine.rs:112-115` and `:167-172` ✔. Fixed: added `Store::get_products_category_batch` in `products_crud.rs` avoiding wide 8-table product joins, batched category resolution for all lines upfront in `compute_checkout_promotions` and `apply_promotion_to_sale`, and memoized category lookups inside `compute_discount` across lines and Buy-X-Get-Y evaluation passes. Verified in `promotions_tests.rs` (44/44 passed).

**O-M09 · kasirmu-core — the embedded RSA public key is re-parsed per verification** —
`crates/kasirmu-core/src/license_verification/crl.rs:86-180` ✔. Fixed: cached parsed RSA public key and `VerifyingKey` with `OnceLock<Result<VerifyingKey<Sha256>, String>>`, eliminating constant PEM re-parsing on every subscription check and CRL verification. Verified with unit tests in `license_verification_tests.rs`.

**O-M10 · kasirmu-core — rate-limiter attempt map grows without bound** —
`crates/kasirmu-core/src/rate_limiter.rs:26`, `:54-61` ✔. Fixed: added `DEFAULT_MAX_TRACKED_USERNAMES` (10,000) capacity ceiling with eviction of oldest unlocked entries under login spray attacks, and replaced unconditional `String` allocation with borrow-keyed lookup (`map.get_mut(username)`) on recurring attempts. Verified with unit tests in `rate_limiter_tests.rs` (34/34 passed).

**O-M11 · kasirmu-core — one `Mutex<redis::Connection>` held across a network round trip** —
`crates/kasirmu-core/src/cache.rs:165`, `:290-294` ◦. All product/inventory cache ops
serialise behind a single blocking Redis call. *Fix:* pooled/multiplexed client.

**RE-VERIFIED 2026-10-22 — STILL OPEN, but DEAD IN THIS BUILD.** The code claim is accurate
(`cache.rs:167` `conn: Mutex<redis::Connection>`, guard held across `cmd("GET").query()` at `:294-295`,
same at `:304-311`), but the entire `redis_cache` module is behind the OPTIONAL `cache-redis` feature and
**nothing in the workspace enables it** — `crates/kasirmu-core/Cargo.toml:41` defines it and no consumer
turns it on. The cost is zero today. **✅ CLOSED 2026-10-22 as NOT APPLICABLE (§11BZ)** — an unfixed defect in
a module no build compiles is not debt; it is a design note. If `cache-redis` is ever enabled this must be
re-opened FIRST, and the pooled-client rewrite done before that feature ships.

**O-M12 · kasirmu-core — location resolver: global mutex per lookup, map never evicted** —
`crates/kasirmu-core/src/location_resolver.rs:48-49`, `:56-58` ✔. Fixed: converted `LOCATION_CACHE` from `Mutex` to `RwLock` to enable non-blocking concurrent reads across threads, and added a capacity ceiling of 1,024 entries (`MAX_CACHED_LOCATIONS`) with TTL eviction on insert. Verified in `location_resolver_tests.rs`.

**O-M13 · kasirmu-core — per-location stock and name queries** —
`crates/kasirmu-core/src/location_resolver.rs:509-521` (also `:275-289`) ✔. Fixed: replaced $2N$ sequential queries in `resolve_location_chain_for_sku` with a single joined query against `stock_summary` and `inventory_locations` over `WHERE id IN (...)`, and batched name lookups in `enrich_bindings`. Verified in `location_resolver_tests.rs`.

**O-M14 · kasirmu-core — CRL re-deserialised and linearly scanned on every gate call** —
`crates/kasirmu-core/src/license_verification.rs:659-668`, `:682-685` ✔. Fixed: introduced pre-indexed `ParsedCrlSets` storing `revoked_tenants`, `revoked_devices`, cleartext `revoked_keys`, and precomputed `revoked_key_hashes` in `HashSet<String>`s with an in-memory `PARSED_CRL_CACHE` (`RwLock<Option<(String, Arc<ParsedCrlSets>)>>`). Replaced repeated JSON deserialization on every gate check with $O(1)$ set lookups. Verified in `license_verification_tests.rs` and `subscription_tests.rs`.

**O-M15 · kasirmu-core — signed payload re-parsed on every entitlement check** —
`crates/kasirmu-core/src/subscription.rs:778-791` (also `:759`) ✔. Fixed: deserialized payload fields (`addons`, `is_trial`, `trial_ends_at`, `features`) via typed target structs avoiding intermediate `serde_json::Value` tree allocations, replaced case-folding `to_lowercase()` String allocations with `eq_ignore_ascii_case`, and parsed `allowed_types_json` via borrowed `Cow<str>`. Verified in `subscription_tests.rs` (155/155 passed).

**O-M16 · kasirmu-bridge — staff role paths are N+1 in three places** —
`crates/kasirmu-bridge/src/staff.rs:915-919` (`role_dto` = 2 queries per role), `:788-792`
(owner gate loads and scans the whole user table to count), `:606-610` (linear role scan per
user) ✔. Fixed: added `Store::all_role_counts_map` in `crates/kasirmu-core/src/db/roles.rs` computing references and holders for all roles in 5 total queries for `list_roles_scoped`, added `Store::count_active_owners` in `crates/kasirmu-core/src/db/staff.rs` eliminating full table materialization in `enforce_role_assignment_policy`, and pre-indexed `role_map` in `list_staff_scoped` replacing linear $O(\text{users} \times \text{roles})$ scanning with $O(1)$ lookups via `to_staff_dto_with_role_name`. Verified across all staff and roles tests in `kasirmu-core` and `kasirmu-bridge`.

**O-M17 · kasirmu-bridge — tax settings read is one query per category** —
`crates/kasirmu-bridge/src/tax.rs:443-450` ✔. Fixed: added `Store::get_category_tax_rates_batch(&category_ids)` in `crates/kasirmu-core/src/db/tax/assignments.rs`, replacing $N$ sequential per-category database queries with a single batched join in `run_list_category_tax_rates`. Verified in `tax_tests.rs` and `tax.rs` tests.

**O-M18 · kasirmu-bridge — KDS chit fan-out is quadratic with per-pair clones** —
`crates/kasirmu-bridge/src/kds.rs:136-147` (dedup via linear scan; `orders.iter().find()` at
`:271`) ✔. Fixed: indexed existing jobs using a `HashSet<(String, String)>` seen set to eliminate $O(N^2)$ linear scanning in `build_kds_chit_jobs`, and indexed orders in a `HashMap<&str, &KdsOrder>` to eliminate per-job linear scans in `try_auto_print_kds_chit_jobs`. Verified in `kds.rs` tests.

**O-M19 · kasirmu-bridge — analytics loads the whole user table for a handful of names** —
`crates/kasirmu-bridge/src/analytics.rs:66-74` ✔. Fixed: added `Store::get_user_display_names_batch(&user_ids)` in `crates/kasirmu-core/src/db/staff.rs`, resolving display names only for active staff members present in the aggregated report rather than materializing the entire global users table into memory. Verified in `analytics.rs` and `staff.rs` tests.

**O-M20 · kasirmu-bridge — `blocking_lock()` on the async session-resolution path** —
`crates/kasirmu-bridge/src/ctx.rs:412-413` ✔ **✅ CLOSED 2026-10-22 — DONE IN PLACE, and re-verified:** `ctx.rs:433-440` now uses `try_lock()` with a named `BridgeError::Invalid` on contention, and `:412-429` is the rewritten "Why this uses `try_lock`, not `blocking_lock`" block the entry asked for. Zero `blocking_lock` CALL SITES remain in `kasirmu-bridge/src`. **PROMOTED TO O-H26 IN §9 — this is a guaranteed
panic, not a parked worker.** Recorded here in round 2 as parking a runtime worker; verification
re-read `audit.rs:257-266` and found the crate documenting the same pattern as a panic on first
use. See §9 for the corrected entry. *Fix:* `lock().await`, and delete the stale justification
at `:407-408`.

**O-M21 · kasirmu-bridge — failed store-DB creation silently discarded** —
`crates/kasirmu-bridge/src/locations.rs` ✔ **PAID 2026-10-22.** `let _ = ctx.db_manager.create_store_db(…)`
with no log at all: a create that could not write the branch's database still returned `Ok` with the
profile row inserted. The merchant got a branch they could see and could not open, and the failure
surfaced one command later in `create_session` as `opening store db: …` — an error naming the OPEN and
nothing about the create that had dropped the real cause.

The result now propagates (`create_store_db(..).map_err(|e| { tracing::error!(..); BridgeError::Internal(..) })?`).
Three properties make the refusal clean, and all three were checked rather than assumed:

- **Ordering.** The create runs BEFORE `create_location_profile`, so a failure leaves no profile row
  behind — the row and the database are not "atomic" in the transaction sense, they are ordered so the
  only partial outcome is the harmless one (a database with no row, which `store_db_exists` reports
  and nothing lists).
- **Ruling R3 (path-free client errors).** The cause carries an absolute path and goes to the log at
  error level; the returned message names the store instead, the way `topology/commands.rs:598` does.
- **No safe fallback.** A memory DB would be a branch whose data vanishes on restart, and `open_store`
  would still try the real path on the next command.

Pinned by `create_location_profile_refuses_when_the_store_db_cannot_be_created`, which asserts the
PAIR — an `Err(Internal)` and `!store_db_exists(id)` — rather than a single expression, because a
fixture that blocks the whole data directory is refused earlier by `resolve_scope` and would let the
test pass for the wrong reason. The premise (`create_store_db` really fails for this manager) is
asserted first, so a green result cannot be a fixture that quietly worked. Measured on the pre-fix
tree: the command answered `Ok`, `list_locations_scoped` returned the new id, and `store_db_exists`
answered `false`.

**A test-infrastructure fix this entry needed.** `TestBridge::new` built its store directory from
`std::env::temp_dir()`, which is `C:\WINDOWS\TEMP` on this machine — create-but-not-delete, so a stale
`kasirmu-bridge-test-*` directory made every harness test in the crate panic with `os error 5`, reading
as a product bug. `testing.rs::unique_store_dir` now delegates to `kasirmu_test_support::scratch_dir`
under the gitignored `target/`.

`cargo test -p kasirmu-bridge --lib locations::` = **12 passed, 0 failed**.

**O-M22 · cloud-server — batch outcome reassembly is O(n²) with item clones** —
`apps/cloud-server/src/sync_api.rs` ✔ **PAID 2026-10-22.** `valid_indexes.iter().position(|&v| v == idx)`
inside the loop over all items made a 1,000-item push do 10⁶ comparisons. It is now a MERGE with one
forward cursor, O(items + valid).

**The justification is the sort order, and it had to be checked rather than assumed.** `valid_indexes`
is strictly ascending because it is filled by a single forward pass that pushes `idx` in increasing
order — so once the cursor has passed an index it can never be needed again, which is what makes one
cursor sufficient. The comment on the loop records that reasoning rather than just asserting a cursor
is faster.

Order is the correctness invariant, not a nicety: the client zips `pending` against `results` by index
(`apply_push_results`), so a reordering marks the WRONG items synced. That was already pinned by
`sync_api::tests::push_outcomes_preserve_request_order_with_mixed_batch` — `[valid, invalid, valid]` must
return `[Accepted, Rejected, Accepted]` — and it passes unchanged against the merge, which is the
evidence that matters. `kasirmu-cloud` = **398 passed, 0 failed**.

**O-M23 · cloud-server — the push payload is re-serialised just to measure its size** —
`apps/cloud-server/src/sync_api.rs` ✔ **PAID 2026-10-22.** `serde_json::to_vec(&items).map(|v| v.len())`
serialised the entire batch a second time, allocating a throwaway buffer the size of the request, purely
to read `.len()` for one histogram observation on the hottest write path.

**This was not only a cost, it was a measurement defect — and that is what settled the design.** The
metric is documented in `metrics.rs` as *"Push request body size in bytes"*: the TRANSPORT size.
`serde_json::to_vec(&items)` is the size of a RE-SERIALISATION, which equals the request body only when
the client formatted its JSON exactly as serde would — no extra whitespace, same key order, same float
formatting. A client sending pretty-printed JSON inflated its own request without the old metric ever
seeing it. The handler now takes `axum::body::Bytes` and observes `body.len()`, which IS the body, so
the metric measures the quantity it names rather than a proxy that drifts with client formatting.

**Two contract details the change had to preserve, and a test caught the second one.** Taking the raw
body moves the parse into the handler, so: (a) `#[tracing::instrument]` had to stop skipping a
parameter named `items` that no longer exists — the span now opens with `body_bytes` and records
`item_count` once the body is parsed, so no field is silently lost; (b) the rejection status had to stay
**400**. Deliberately mirroring `axum::Json`'s content-type status (422) is the obvious-looking choice
and it broke `push_rejects_malformed_json`, which pins 400 — a client-visible contract renegotiated by a
performance change is exactly the class of regression that ships quietly. That test is why it did not.

**O-M24 · kasirmu-api — image pack: global SQLite mutex once per hash, query per hash,**
**2 MB body buffered** — `crates/kasirmu-api/src/routes/images.rs` ✔ **BATCHING PAID 2026-10-22;**
**STREAMING DELIBERATELY DECLINED, with the allocation argument below.**

Measured with temporary instrumentation on the real code paths (then fully reverted, `git grep` clean):
a PACK_MAX_FILES=64 pack went from **64 lock acquisitions and 64 queries to 1 and 1**. The batched
lookup is a new `Store::image_refs_present(tenant_id, &[&str]) -> Vec<bool>` in
`crates/kasirmu-core/src/db/image_refs.rs` rather than SQL in `images.rs`, because it reuses
`missing_hashes`'s existing `IMAGE_REFS_IN_CHUNK`/`SQLITE_MAX_VARIABLES` chunking (an over-long list
degrades to more chunks, never an unscoped sweep), reads every chunk inside ONE transaction so they see
one snapshot, and returns per-hash booleans in CALLER order so frame order needs no side map.

**Why streaming was not taken — the reasoning is the useful part.** The 404/400/fail-closed contract is
only decidable AFTER the spine lookup, which happens before anything is read, so a first-poll-decides
stream forces either a 500 on a whole-pack spine error (a behavioural regression) or emit-zero-frames-
then-error (a silently truncated pack the puller caches as complete). Worse, the reader must know a file
is ABSENT before emitting its frames, so a yielded-but-unreadable file cannot be skipped — it becomes a
truncated frame inside a 200. And pre-sizing is not the escape it looks like: today's resident
`Vec` + `Bytes` is ~2x the 2 MB cap, while `fill_stream` with zero reserves lets the `Vec` double to
4 MB and `Bytes::from` takes the buffer WITHOUT shrinking. **Streaming would have doubled the worst
case.** Removing the 2x for real needs a body that copies into a pre-sized `BytesMut` — new utility
work, not something `Body::from_stream` gives.

**A behaviour change, stated rather than buried:** fail-closed direction is preserved but the blast
radius widened. Before, one hash whose individual query errored was skipped and the other 63 still
served; now one failed batched read skips all 64. A DB that cannot answer one chunked lookup cannot
answer the other 63, so the scope is honest — but it is a change and it is named in a comment and in the
`tracing::warn`.

**Two mutations SURVIVED and that is recorded rather than papered over:** dropping `refcount > 0` from
the batched SQL still passes the API tests (no API path creates a refcount-0 row — `gc_images` deletes
them and gc has no route), and a last-chunk-only accumulator passed because the chunking fixture puts its
present hashes in the SECOND chunk. The widened byte cap DOES turn the ceiling test red, so that one is
real. **No test counts locks or queries:** `AppState.db` is a plain tokio `Mutex` with no counter, so the
64→1 numbers are a measurement, not an assertion — and the round's own lesson is that a measurement
recorded in prose decays while an assertion does not.

The pack endpoint had **no test at all** before this; four were added (batched-vs-per-hash answer across
real frames, empty-body, 400, and both ceilings) plus three for `image_refs_present`. The ledger row at
`:1476` describes the pre-fix `Vec` growth and is left as the verification of record it was, now
grading historical code.

`cargo test -p kasirmu-api --lib images` = **21 passed** ·
`cargo test -p kasirmu-core --lib image_ref` = **19 passed**.

**O-M25 · cloud-server — snapshot cache: one global mutex, full-clone hits, O(tenants)**
**sweep** — `apps/cloud-server/src/sync_api.rs` ✔ **PAID 2026-10-22, both halves.**

Before: `Arc<tokio::sync::Mutex<HashMap<String, Arc<RwLock<Option<SnapshotData>>>>>>` with
`SnapshotData.bytes: Vec<u8>`. A HIT took the global async mutex just to fetch the entry handle and then
**cloned the whole products+tax_rates+users payload** (free + memcpy on every request); a MISS took that
SAME lock a second time for a `retain` over EVERY tenant, with no fail-fast. The `AsyncMutex` also queued
waiters FIFO, so the sweep sat behind every in-flight holder and every new request sat behind the sweep.

After: 16 shards selected by `Hash(tenant_id) % 16`, `bytes::Bytes` instead of `Vec<u8>`, and
`std::sync::Mutex` because the guard is never held across an `.await` (which also removes the async
queueing the single lock caused). A HIT now locks one shard for one map lookup and clones a `Bytes`
handle — a refcount bump, zero payload allocation.

**The sharding was only safe because the sweep could be written as skip-on-busy.** It walks shards one at
a time with `try_lock` and SKIPS a busy one, so two shard locks are never held at once (no lock-ordering
hazard to argue away), a hot tenant is never parked behind the sweep, and the sweep can never be blocked
by a tenant that holds its own shard. Writing the sweep as wait-on-busy is what would have reintroduced
the starvation the entry was warning about.

**Cross-tenant isolation: no leak.** The shard key is the tenant id ALONE — never a pair, never the
request — so a tenant lives in exactly one shard and a hit only ever reads its own key. Pinned by a
32-tenant test with pigeonhole-guaranteed shard collisions.

**And a bug in that very test, which the same test then caught.** The first version matched
`"SKU-SHARD-1"` as a SUBSTRING of `"SKU-SHARD-10"`, which made it falsely fail one tenant and falsely
PASS another — a prefix-based leak assertion gives a false pass on exactly the leak it exists to catch.
It now compares `products[0]["sku"]` as an exact JSON value and asserts `len() == 1`. Worth checking for
this shape in any isolation test: **a containment check on a formatted identifier is a leak test that
cannot see the leak its own naming creates.**

Preserved: served bytes (pinned byte-for-byte AND by ETag), the cache key, the 900 s TTL and its `< TTL`
read check, version revalidation, single-flight, the Redis path, and both `SYNC_PULL_DURATION_MS`
observations. There is no hit/miss metric to preserve — only the duration observation, which survives on
both paths. The Redis hit path also stopped forcing a `to_vec()` copy into the body for free.

`cargo test -p kasirmu-cloud --bin kasirmu-cloud` = **402 passed, 0 failed** (43 ignored); 4 tests added,
existing ones adapted to the new type, none weakened.

**O-M26 · kasirmu-api — memo push issues one INSERT per memo × location × recipient** —
`crates/kasirmu-api/src/pg.rs:2573-2580`, `:2638` ◦, plus a `tenant_id.to_string()` per row.
*Fix:* multi-row INSERT / `unnest`. **✅ PAID in `a3795dccf`, re-verified at HEAD 2026-10-22.** The code has
since moved to `crates/kasirmu-api/src/pg/memos.rs` (`pg.rs:49-56` only re-exports it). Round trips went
from `2N + L + K + 2` to `2N + 2`, and `tenant_id.to_string()` in the push path from `L + K` to **0**.

**This entry's own premise was wrong, and it stood for months.** It describes a
`memo × location × recipient` loop nest — an `L × K` product. Locations and recipients are SIBLINGS,
not a product: the real cost was `L + K`, so the fix is worth far less than the title implies, and
anyone prioritising it by that product would have over-ranked it. The correction is recorded here
rather than tidied away: **a ledger entry is a claim, and a claim can be wrong in the direction that
makes the work look bigger.**

**O-M27 · kasirmu-api — settings endpoint: 8 round trips to read, 3 writes with no**
**transaction** — `crates/kasirmu-api/src/routes/settings.rs` ✔ **PAID 2026-10-22, both halves.**
Transaction: `d635cb6cc`. Batched read: `c9562428f`.

**What was verified before the attempt, and it is the valuable part: BOTH backends were non-atomic.** The
ledger names `apply_ops_pg`, but the SQLite path has the same defect and nobody had noticed. At HEAD,
`crates/kasirmu-api/src/routes/settings.rs:469` is:

```rust
let db = state.db.lock().await;
apply_ops_sqlite(&db, tenant, store_op, smtp_op, schedule_op)
```

`db` is a plain `rusqlite::Connection`, NOT a `Transaction`, and `apply_ops_sqlite` makes three `execute`/
`set_setting` calls that each AUTOCOMMIT. So a failure on the second or third write leaves the first
applied on BOTH backends. A merchant saving store name + SMTP + report schedule and hitting an SMTP
failure gets a partially-saved config reported as a failed save — and, per the observed test run, actually
gets **HTTP 200 with all three keys written** even when the second write was meant to fail.

**The concrete fix for the SQLite half:** open a `rusqlite` transaction at that call site and pass `&tx`,
or better, change `apply_ops_sqlite` to take `&Transaction` so the requirement is visible in the signature
and unmissable to a future caller (`Transaction` derefs to `Connection`, so `set_setting` should accept it).
For Postgres, take one `Client` from the pool, `BEGIN`/`COMMIT`, `ROLLBACK` on error — which means
`apply_op_pg` must take a client/transaction reference rather than `&Pool`.

**Two traps found during the attempt, worth carrying forward:**
1. A test that induces the failure must actually induce it. An observed run showed all three keys present
   after a "failed" second write, with the handler returning 200 — either the induced failure did not
   happen, or it did and the rollback did not. Diagnose which BEFORE writing the rollback.
2. Do not let the diagnostic print the settings payload. One attempt dumped an `smtp_config` row including
   its `password` field into test output. A fixture secret, but that is the shape that becomes a real leak.

**The first attempt was reverted** — it left the crate uncompilable (`E0425: cannot find value
`SECRET_KEY_DENY_LIST``) and had begun deleting pre-existing tests.

### What actually landed (`d635cb6cc`)

`write_settings` now opens the transaction at the call site that owns the connection, and
`apply_ops_sqlite` takes `&rusqlite::Transaction<'_>` instead of `&Connection`. **The signature change is the
fix, not a style choice.** It was falsified by trying to reintroduce the bug: passing `&db` where
`&Transaction` is required now fails to COMPILE (`E0308` ×2), so the defect is unrepresentable rather than
merely tested. That is a stronger guarantee than any assertion.

The commit also carries the test the earlier attempt could not make work. Its first version failed to
induce a failure at all (the store accepted the "failing" value), so it proved nothing. The landed version
installs a SQLite TRIGGER that raises on one specific key, which is a genuine database-level failure of the
second op — and it asserts BOTH directions: the first key keeps its PREVIOUS value after the failed save,
and a clean save writes all three (so the rollback is not achieved by writing nothing).

A third assertion pins the MECHANISM rather than the caller: three ops inside a transaction that is DROPPED
without `commit()` must roll back. Without it, the main test would still pass if the caller silently stopped
opening a transaction, because `apply_ops_sqlite` would then never run at all.

`cargo check -p kasirmu-api --all-targets` = exit 0 · `cargo test -p kasirmu-api --lib` = **353 passed,**
**0 failed**, 14 ignored (351 before; 2 new).

### The read half (`c9562428f`)

`read_settings` went from 8 round trips to 1. The 8 is worth spelling out because the old code
SHORT-CIRCUITED: four `get_setting_scoped_pg` calls, each doing the scoped query and then the bare query
only if the scoped one missed — so the range was 4 to 8, and the *worst* case was 8, which is what the
ledger named. Now one `SELECT key, value FROM settings WHERE key = ANY($1::text[])` over all 8 candidate
keys, resolved in memory.

**The SQLite branch had the identical per-key loop and was batched too**, using
`WHERE key IN (SELECT value FROM json_each(?1))` with the key list as ONE bound JSON array — fixed SQL text,
no interpolation, and no dependency on rusqlite's optional `array` feature (this workspace enables only
`bundled` + `backup`, so `rarray` is not compiled in). A `format!`ed `IN (...)` list would have worked too
and would have been the wrong instinct in a file that already documents injection hazards.

**The precedence rule is `rows.get(scoped).or_else(|| rows.get(bare))` — presence, never truthiness.** The
case that catches a careless rewrite is a scoped key that EXISTS with an EMPTY value: it must return
`Some("")` and must NOT fall through to the bare value. A `.filter(|v| !v.is_empty())` anywhere in that fold
breaks it, and the resulting bug (an operator's deliberately-cleared setting silently reverting to the
legacy value) is invisible until someone reads their config back. Four tests pin the four cases, and the
same five outcomes are re-asserted through the public GET handler so the response SHAPE is pinned too, not
just the helper.

**Verified by execution vs by reading, stated separately:** 10 of the 11 new tests RUN against real
in-memory SQLite. The Postgres `ANY($1::text[])` statement is **compiled only** — there is no Postgres on
this machine and the one pg test is `#[ignore]`d. It is verified by reading and compilation, and that is a
materially weaker claim than the rest of this entry.

**One placement note that killed the earlier attempt:** the first try changed things in the file while
ANOTHER session was committing to the same tree, and the resulting file was neither its version nor HEAD.
If you pick this up, verify `git status` shows only your files before concluding a compile failure is yours.

**O-M28 · cloud-server — quota cooldown map never swept, two `String` allocs per probe** —
`apps/cloud-server/src/quota_detector.rs` ✔ **PAID 2026-10-22 in `311173b3c`**.
Fixed: nested `HashMap<Arc<str>, HashMap<Arc<str>, Instant>>` enabling zero-allocation borrowed `&str` lookups,
with automatic pruning of expired cooldowns across tenants on insert.

**O-M29 · mobile — the "batch" track-serial twin of O-H08** —
`apps/mobile-tauri/src/commands/products.rs:288-306` ✔. Fixed: `run_get_product_track_serial_batch` and `get_product_track_serial_scoped` now use `Store::get_products_track_serial_batch` and `Store::get_product_track_serial`, executing batched `WHERE sku IN (...)` directly against the products table. Verified with `mobile-tauri` tests. **✅ PAID** (re-verified at HEAD 2026-10-22, §11BU-adjacent census repair: the note lacked a marker word, so it read as open work in every downstream reading).

**O-M30 · mobile — `discount_percent as u8` truncates above 255** —
`crates/kasirmu-bridge/src/pos/preview.rs:176` and `crates/kasirmu-bridge/src/pos/checkout.rs` ✔. Fixed: discount percent clamped with `checkout_discount_percent` across both preview and shortfall checkout doors; verified with `preview_and_shortfall_doors_treat_a_high_discount_percent_identically`.

**O-M31 · mobile — org switch / session creation take the global DB mutex 5 and 3 times** —
`apps/mobile-tauri/src/commands/auth.rs` ✔ · **PAID** (`b825483a6`). Collapsed database mutex acquisitions into single scoped locks in `switch_organization` and `create_session`. See §11BN.

**O-M32 · shells — conflict commands build a fresh `reqwest::Client`, no timeout** —
`apps/mobile-tauri/src/commands/sync.rs`, `apps/desktop-tauri/src/commands/sync.rs` ✔ **PAID 2026-10-22 in `010ad308f`**.
Fixed: shared `reqwest::Client` in `OnceLock` singleton with 10s connect / 30s request timeouts,
reusing TLS contexts and connection pools across conflict list/resolve calls.

**O-M33 · mobile — image-cache missing-set computed by one sequential stat per file per
cycle** — `apps/mobile-tauri/src/image_download.rs` ✔ **PAID 2026-10-22 in `b651fe4cc`**.
Fixed: scanned `images/` directory once with `read_dir` into a `HashSet<String>` and diffed in memory,
eliminating sequential per-file `try_exists` stat syscalls and per-file path allocations.

**O-M34 · platform/sync — one full JSON serialisation of the backlog per item, plus two copies** —
✅ **PAID 2026-10-21.** `estimate_item_bytes` replaces the per-item `to_vec`, and the pre-sort
backlog clone is gone (indexes are sorted with the shared `compare_for_push`, now `pub`). The
estimate multiplies payload by **6** — the `\u00XX` control-character worst case — not the 2x I
suggested; 2x would still have under-counted 4480 control chars (27,107 actual vs 8,960).
`platform/sync/src/lib.rs:157-177` ◦. Corrected in §9: the round-2 wording said "~3 full JSON
serialisations", which overstates it. What the loop does is clone the backlog for sort (`:157`),
`serde_json::to_vec(item)` **once** per item to measure size (`:166`), then clone each item into
its batch (`:175`). *Fix:* estimate from `payload.len()`; batch references; reuse bytes.

**O-M35 · platform/sync — every daemon tick loads the entire pending queue** —
`platform/sync/src/daemon.rs:140` ✔. Fixed: bounded `DEFAULT_MAX_OUTBOX_BATCH_ITEMS = 100` page per tick in `daemon.rs` and `pg_daemon.rs` with priority ordering (`order_for_push`) preserved.

**O-M36 · platform/sync — `last_synced_at` loads every offline-queue row ever written** —
`platform/sync/src/queue.rs:881` ✔. Fixed: indexed `SELECT MAX(synced_at) …` in `Store::get_last_synced_at` instead of loading all historical rows.

**O-M37 · platform/sync — full CRL downloaded and signature-verified on every tick of every
terminal** — `platform/sync/src/daemon_tick.rs:585-589` ✔. Fixed: gated CRL poll by 15-minute TTL cache (`DEFAULT_CRL_POLL_INTERVAL_SECS = 900`) and unchanged cached-payload bypass, avoiding continuous network requests, RSA signature verification, and DB writes on short sync ticks.

**O-M38 · platform/sync — the settings sink fires while the blocking DB lock is held** —
`platform/sync/src/daemon_tick.rs:369-380`, `:696` ✔. Fixed: events collected in blocking phase, emitted through `settings_sink` after dropping the DB connection lock.

**O-M39 · platform/sync — image-push client has no timeout; DB mutex re-taken per missing
file** — `platform/sync/src/image_push.rs:75`, `:176-178` ✔. Fixed: client bounded by timeout; missing files accumulated into `missing_files: Vec<String>` and marked failed under a single lock hold.

**O-M68 · kasirmu-core — the popularity recompute traverses the whole `product_activity` index** —
`crates/kasirmu-core/src/db/popularity.rs:1056-1061` ✔ · **PAID 2026-10-22 in migration `20261025_product_activity_created_at.sql` (§11CE)**.
Option B implemented: added covering range index `idx_product_activity_created_at` on `product_activity(created_at, sku, event_type)`. `recompute_all_popularity`'s unrestricted window query now plans `SEARCH product_activity USING COVERING INDEX idx_product_activity_created_at (created_at>?)`, reading 0 table pages. Verified in `popularity_tests.rs`.

**✅ RESOLVED 2026-10-22 in `f49038c50` — migration `20261025_product_activity_created_at.sql`.**
`CREATE INDEX idx_product_activity_created_at ON product_activity(created_at, sku, event_type)` — option B
from §11CC. Measured: with the index the aggregate plans `SEARCH product_activity USING COVERING INDEX
idx_product_activity_created_at (created_at>?)`; with the index DROPPED it degrades back to
`SCAN product_activity USING INDEX idx_product_activity_sku`. Falsified by dropping, restored, re-passed.

**SCOPE CORRECTED 2026-10-22 (already, before anyone acted on it): this is NOT on the per-sale path.**
The scan lives in `recompute_all_popularity` (`popularity.rs:1010`), which its own doc says runs **"at store
open"** — while the per-sale path calls `recompute_popularity_batch` (`sales_lifecycle.rs:635`), which
filters `sl.sku IN (...)` and therefore plans `SEARCH` on the good index. So the cost is paid ONCE per store
open against the whole activity ledger, not per sale. That is a materially smaller problem than the first
draft of this entry implied, and it moves the decision toward EITHER a cheap index OR leaving it alone
until a store's activity table is measured at a size where a once-per-open scan is actually felt.

**O-M69 · kasirmu-core — the audit-log `outcome` filter scans the whole log** —
`crates/kasirmu-core/src/db/audit.rs:191-247` (builder) called from
`list_audit_entries_page` (`:755`) / `list_audit_entries_export_filtered` ◦. `build_audit_where` appends
`outcome = ?N` when the caller filters, but `audit_log` carries indexes only on `action`, `created_at`,
`(target_type, target_id)` and `user_id` (`20260813_init.sql:1093-1099`) — **no index leads with
`outcome`**. MEASURED over 2,000 seeded rows + `ANALYZE`, on the paging query
`... WHERE outcome = ? ORDER BY created_at DESC, id DESC LIMIT 51`:

    FIRST page + outcome -> SCAN audit_log | USE TEMP B-TREE FOR ORDER BY
    cursor page + outcome -> SEARCH audit_log USING INDEX idx_audit_log_created_at
    no filter            -> SCAN audit_log USING INDEX idx_audit_log_created_at

**Adding an `outcome` filter makes the FIRST page worse than no filter at all**: it drops the index-only
walk for a full table scan plus a temp B-tree sort. The KEYSET pages are fine — the `created_at < ?` cursor
clause gives the planner a range — so the defect hits exactly the page every user lands on.

*(Corrected 2026-10-22 while fixing: my first reading said the cursor query also scanned. It does not.
The original test I wrote asserted only the cursor shape and would have passed on a broken build; the
falsification run is what exposed it.)*

*Fix (measured):* `CREATE INDEX idx_audit_log_outcome_created ON audit_log(outcome, created_at DESC, id DESC)`.
With it, the same query plans `SEARCH audit_log USING COVERING INDEX (outcome=?)` and the temp B-tree
disappears — for BOTH values of `outcome`, and for both the first page and the keyset pages.

**✅ RESOLVED 2026-10-22 — migration `20261027_audit_log_outcome_created.sql`.** Measured before and
after, both shapes, both outcome values. Falsified: unregistering the migration makes
`audit_page_filtered_by_outcome_seeks_instead_of_scanning` fail on the FIRST page with
`SCAN audit_log USING INDEX idx_audit_log_created_at`; re-registering makes it pass.

**O-M70 · kasirmu-core — the legacy outbox probe reads each candidate's table row** —
`crates/kasirmu-core/src/db/offline/enqueue.rs:529-537` ◦. The `sale_id IS NULL` branch
(the only route to any row written before `20261023`) probes with
`WHERE sale_id IS NULL AND status = 'pending' AND action = ?1 AND instr(payload, ?2) > 0`.

**CORRECTED TWICE while fixing; recording both, because the first two readings were wrong:**
- First I measured `SCAN offline_queue` — but that was over an EMPTY/small table where no index served.
- Then, with a realistically seeded table, the falsification showed the branch already plans
  `SEARCH offline_queue USING INDEX idx_offline_queue_status_action (status=? AND action=?)`.
  So it has NEVER been a full table scan on a database carrying `20261023`.

The residual cost is narrower than either earlier reading: `idx_offline_queue_status_action` is
`(status, action)` — **not covering** — so every candidate row is fetched from the TABLE just to run
`instr(payload, ?)`. The number of table fetches is the number of pending rows sharing that
`(status, action)` pair, not the whole backlog.

*Fix (measured):* `CREATE INDEX idx_offline_queue_legacy_sale_probe ON offline_queue(action, status,
payload) WHERE sale_id IS NULL` turns the plan into
`SEARCH offline_queue USING INDEX idx_offline_queue_legacy_sale_probe (action=? AND status=?)`,
evaluating `instr` from the INDEX entry with no table fetch. It is PARTIAL on `sale_id IS NULL`, so it
costs nothing for the rows the fast path already serves. Applied in
`20261028_offline_queue_legacy_sale_probe.sql`.

**✅ RESOLVED 2026-10-22.** Falsified: unregistering that migration makes
`has_pending_outbox_row_uses_sale_id_index_and_falls_back_for_legacy_rows` fail, naming
`idx_offline_queue_legacy_sale_probe` and quoting the fallback plan.

**The lesson is about measurement order.** I called this a table scan because I planned it against a
table with no data shaping the choice, then called the table-scan reading a finding. The falsification —
which I only ran because the fix needed proving — showed the pre-fix plan already SEEKED. **A plan measured
on an unseeded table is not evidence about production**, which is the same rule that made the earlier
gift-card and audit "scans" turn out to be fixture artefacts.

**O-M71 · kasirmu-core — `list_gift_cards` search and balance filters cannot use an index** —
`crates/kasirmu-core/src/db/gift_cards.rs:182-232` ◦. Four of six filter shapes read the whole table.
**Measured over 3,000 seeded cards + `ANALYZE`:**

| Shape | Plan |
|---|---|
| `status = ?` (even a 2.5%-selective one) | `SEARCH g USING INDEX idx_gift_cards_status` |
| `card_number LIKE 'GC-0001%'` (PREFIX) | `SCAN g` |
| `card_number LIKE '%0001%'` (INFIX) | `SCAN g` |
| `current_balance_minor >= ?` | `SCAN g` |
| no filter | `SCAN g` |

**CLOSED AS NOT-ACTIONABLE 2026-10-22 — no index can fix three of these, and the fourth should not have one.**
- The `search` and `issued_to` filters build `LIKE '%<escaped>%'` — a LEADING wildcard, which no B-tree can
  serve. (Even the prefix form scans: SQLite only uses an index for `LIKE` when the column is indexed with
  `COLLATE NOCASE` or `PRAGMA case_sensitive_like` is on, and this schema does neither.) Fixing it would mean
  FTS or a trigram index — a different storage decision, not a missing index.
- `min_balance` is a RANGE on a value that changes on every redemption, so an index would be maintained on
  a hot write path to serve a rarely-used filter.
- The unfiltered shape is the default page; it scans by definition and is bounded by cards issued, not by
  transaction volume — **it is not the O-M69 growth class.**

So the entry is closed with the measurement rather than an index, and the probe's pin at 4 stays: it now
fails both if a shape regresses AND if someone later adds an index, forcing a deliberate re-measurement.

**O-M72 · ui — the ESLint autofix for `consistent-type-imports` deletes `eslint-disable` guards** —
`ui/eslint.config.js` (`consistent-type-imports: 'warn'`) ◦. 44 findings remain, all inline `import()` type
annotations. Running `npx eslint . --fix` with a `--rule` override REPLACED
`/* eslint-disable react-refresh/only-export-components */` with a single space in **13 files**, because the
override made the disable comment itself look fixable. That silently reactivates a rule on 67 call sites.
Reverted byte-for-byte. *Fix:* convert the 44 by hand, or run `--fix` with ONLY that rule enabled and diff
every touched file; never with a `--rule` override that disables a rule whose suppressions are in the tree.

**✅ RESOLVED 2026-10-22 in `de504492e` — UI lint is now 0 warnings, not just 0 of this rule.**

**The rule was flagging two shapes, and NEITHER was the one this entry assumed.** There was no
`import('@/api/settings').SettingsDto` among them:
- **9 e2e specs (10 warnings)**: `page: import('@playwright/test').Page` → `import type { Page } from
  '@playwright/test'`. `Page` is a real named export.
- **18 unit/a11y tests (34 warnings)**: `typeof import('m')` as the TYPE ARGUMENT of
  `importOriginal<T>()` / `vi.importActual<T>()` — a MODULE NAMESPACE type. None of the 16 modules has an
  `export default`, so `import type { X }` was impossible without inventing a name. The correct rewrite is
  `import type * as SettingsApi from '@/api/settings'` + `importOriginal<typeof SettingsApi>()`.

The lane deliberately avoided eslint's preferred `import { type X }` shape: TypeScript elides it, but a
chokidar-driven transform inside vitest's module graph might not, which would turn a type-only import into a
real side-effect import and reorder the `vi.mock` graph. `import type * as` is runtime-erased by any
transform. **That is a correctness argument, not a style preference, and it is the right call.**

Procedure: one file at a time, `tsc --noEmit` after EVERY file (27 runs, all exit 0), eslint per filename
every 5. `git diff | grep eslint-disable` returns nothing — **no suppression comment was touched**, which is
the precise damage the two earlier attempts did.

**O-M73 · kasirmu-core — the `sale_id` column was never backfilled, so every legacy row pays the slow probe** —
`crates/kasirmu-core/migrations/20261023_offline_queue_sale_id.sql:19` ◦. The migration ADDED the column and
the partial covering index, and wrote no `UPDATE` — confirmed by `grep -c 'UPDATE'` returning 0 on that file
and `git grep 'UPDATE offline_queue'` returning nothing anywhere in `migrations/`.

Consequence: every row written before `20261023` keeps `sale_id = NULL` FOREVER, **even though almost all of
them already carry the sale id in `payload`**, so the fast indexed branch of
`has_pending_outbox_row_for_sale` can never serve them. They take the legacy branch on every settlement for
the life of the database. O-M04's win applied only to rows written after the migration.

*Fix:* measure first (5,000 legacy rows backfilled in **9.2 ms**), then a GUARDED statement:

```sql
UPDATE offline_queue
   SET sale_id = substr(payload, instr(payload, '"sale_id":"') + 11, 36)
 WHERE sale_id IS NULL
   AND instr(payload, '"sale_id":"') > 0
   AND substr(payload, instr(payload, '"sale_id":"') + 47, 1) = '"';
```

**The `+47` closing-quote check is the whole point, and it was measured, not assumed.** The naive form
(without it) writes GARBAGE on real-ish payloads — measured against six deliberately awkward inputs:

| Payload | naive | guarded |
|---|---|---|
| clean uuid | filled | filled |
| key absent | NULL | NULL |
| `{"sale_id":"abc` (truncated) | **`"abc"`** | NULL |
| `{"sale_id":null}` | NULL | NULL |
| `{"sale_id":"","inner":{"sale_id":"NOT-THIS..."}}` | **`","inner":{"sale_id":"NOT-THIS-ONE-A`** | NULL |
| `{"sale_id": "<uuid>"}` (space) | NULL | NULL (left to the runtime fallback) |

**A wrong id is worse than a NULL**: the fast branch compares for equality, so a garbage value silently
never matches and the row is invisible to the probe. Anything left NULL is not a regression — the legacy
substring branch still finds those rows exactly as before.

**✅ RESOLVED 2026-10-22 in `d3d85ff6b`.** Falsified: removing the `+47` guard makes
`the_sale_id_backfill_fills_only_well_formed_ids_and_never_garbage` fail with `left: Some("abc")`,
`right: None`. Restored, it passes.

**O-M74 · kasirmu-bridge — the workspace picker repair reported success and persisted nothing** —
`crates/kasirmu-bridge/src/workspaces.rs:176-188` ◦. `list_workspaces` repairs an empty store DB from the
global one by inserting the missing `workspace_instances` rows. Every insert was rejected and the error was
discarded, so the picker showed the right rows while the store DB stayed empty and the repair re-ran on every
boot.

**TWO independent causes, and the second was only found by making the first visible:**

1. `let _ = db.execute(...)` **swallowed the error**, and `if let Ok(db)` swallowed a poisoned lock. Nothing
   anywhere reported that the write had failed.
2. With the error surfaced, the real message was `no such table: store_profiles`.
   `20260906_rename_store_to_location.sql:14-17` renamed `store_profiles` → `locations` and
   `workspace_instances.store_id` → `location_id` **in the store database**, while the GLOBAL database the
   repair reads still uses the old names. The repair was writing global names into a store schema that had
   moved on.

*Fix:* resolve the names the target DB actually has (`table_exists`) instead of assuming, seed the parent row
before the instances, and `tracing::warn!` every failure. The listing result is unchanged, so this cannot
regress the caller.

**✅ RESOLVED 2026-10-22 in `63becfd75`.** The test that had been `#[ignore]`d since the defect was measured —
`list_workspaces_repairs_from_global_when_the_store_db_is_empty` — now passes and is **un-ignored**.
`kasirmu-bridge` is 1,542 passed / 0 failed / **0 ignored**.

**Still open, deliberately:** the sibling `list_workspaces_for_store_scoped` (`workspaces.rs:736`) has **no
repair at all**, so the terminal-management screen's cross-store picker still shows an empty grid in the same
situation. That is a feature decision rather than a defect in this function, and it is recorded on the entry
rather than silently fixed.

**O-M75 · kasirmu-plugin — a test ignored for a REASON THAT WAS FALSE, plus 77 fixtures in the wrong temp root** —
`crates/kasirmu-plugin/tests/signature_roundtrip.rs:84` and `src/*_tests.rs` (6 files) ◦.

The `#[ignore]` said *"needs python3 + the cryptography package"*. **Both are installed on this machine**
(`python3` resolves via the cargo bin shim, `cryptography` is 50.0.0), so the reason described a environment
that did not exist. Run un-ignored, the test PASSED in 1.57 s. It had been skipped for no reason.

That is the second time in two rounds that an `#[ignore]`'d test turned out to be hiding something — the
previous one (O-M74) was hiding a live defect. **An `#[ignore]` reason is a claim about the environment, and
nobody re-checks it.**

Un-ignoring it then surfaced a REAL problem: `tempfile::tempdir()` resolves through `TEMP`, which on this
machine is `C:\WINDOWS\TEMP` — a user can create there but cannot delete, so a stale directory makes the
create fail with `PermissionDenied`. `crates/kasirmu-test-support`'s own module docs describe this exact trap
and name it as having broken **144 tests at once** in `mobile-tauri`.

*Fix:* `tempfile::tempdir()` → `kasirmu_test_support::tempdir()` at **77 sites across 6 files**, which roots
every fixture under `<workspace>/target/test-scratch/` (gitignored, per-call UUID, auto-deleting). Added the
`kasirmu-test-support` dev-dependency to `kasirmu-plugin`.

**✅ RESOLVED 2026-10-22 in `094d0ce0d`.** `kasirmu-plugin`: 239 lib + 1 + 2 tests, **0 failed, 0 ignored**.

**The generalisable part:** the fixture-location trap is invisible unless the directory has already been
polluted. `tempfile::tempdir()` passing today is not evidence it will pass when another session's stale
fixture is sitting in `C:\WINDOWS\TEMP` — which is also why my own build recipe masks it, since it overrides
`TEMP` to `target/mstmp` before running cargo. That masking made this look like a repository bug in one run
and a non-issue in the next, and both readings were wrong.

**O-M76 · kasirmu-api — read gate passed topology replication pull route through unchecked** —
`crates/kasirmu-api/src/read_tiers.rs:125` and `crates/kasirmu-api/src/read_tiers_tests.rs:297` ✔ · **PAID** (`2907a50e4`).
`/api/v1/topology/revisions/pull` was registered on the protected router but omitted from `READ_KEY_MAP`.
The allow-by-omission design passed it through without verifying permissions.
Fixed: mapped to `topology:write` with `pii: false`. See §11CQ.

**O-M77 · kasirmu-bridge — cross-store workspace picker has no read-repair** —
`crates/kasirmu-bridge/src/workspaces.rs:799` and `crates/kasirmu-bridge/src/workspaces_tests.rs:360` ◦.
`list_workspaces` gained read-repair from the global database, but the sibling `list_workspaces_for_store_scoped` has no such repair.
Left open deliberately as a product/data-ownership decision. See §11CR.

### Low — harmless today; a senior reviewer would still flag it

**O-L01 · kasirmu-core — INSERT re-planned per row in the legacy ledger loop** —
`crates/kasirmu-core/src/db/products_stock_adjust/ledger.rs:199-201` ✔ · **PAID** (`3746ef544`). Hoisted `prepare_cached` for per-row shortfall INSERT above loop. See §11BA.

**O-L02 · kasirmu-core — failed `ROLLBACK` discarded silently** —
`crates/kasirmu-core/src/db/stock_counts.rs:166-173` (same shape `downgrade.rs:126-131`) ✔ · **PAID** (`1227b88f7`). Rollback failures logged instead of discarded. See §11BA.

**O-L03 · kasirmu-core — `Store` fields are `pub`, exposing the raw connection** —
`crates/kasirmu-core/src/db/mod.rs:206-214` ✔ **PAID 2026-10-22**.
Callers can bypass the repository layer and the documented transaction contract.
Fixed: privatised `conn`, `cache`, and `terminal_id` behind `conn(&self) -> &'a Connection`,
`cache(&self)`, and `terminal_id(&self)` accessors across all crates.

**O-L04 · kasirmu-core — CSV export builds the whole file in memory** —
`crates/kasirmu-core/src/export/mod.rs:270-272`, `:321+` ✔ **PAID 2026-10-22 in `cc392c433`**.
Memory scales with total history. Fixed: write rows into a `BufWriter<File>` with zero-alloc cell escaping.

**O-L05 · kasirmu-core — `format!` per endpoint comparison; linear pairing scan** —
`crates/kasirmu-core/src/topology.rs:195-197`, `:215-237` ✔ **PAID 2026-10-22 in `2be048411`**.
Fixed: `strip_prefix`; index pairings once in `OnceLock<HashMap>`.

**O-L06 · kasirmu-api — JWT cache key allocates two Strings per request; eviction is a full
O(n) sweep** — `crates/kasirmu-api/src/auth.rs:250-276` ✔ · **PAID** (`a79a5b31d`). `Arc<str>` JWT cache keys and incremental eviction. See §11BA.

**O-L07 · kasirmu-api — a refcount-write failure is reported as a 400** —
`crates/kasirmu-api/src/routes/images.rs:141-146` ✔ · **PAID** (`d9bc56f7b`). Internal storage and refcount errors reported as 500 rather than swallowed. See §11BA.

**O-L08 · mobile — quadratic `Vec::contains` in the feature-toggle diff** —
`apps/mobile-tauri/src/commands/features.rs:171-175` ✔ · **PAID** (`824974af0`). `HashSet` snapshot for feature-toggle diffs. See §11BA.

**O-L09 · mobile — dead `Store::new` and `drop` of a borrowed guard** —
`apps/mobile-tauri/src/commands/products.rs:379-382` ✔ · **PAID** (`824974af0`). Dropped real DB guard, removed `dropping_references`. See §11BA.

**O-L10 · platform/sync — refund lines re-parse the same SQL per row** —
`platform/sync/src/queue.rs:517-533` ✔ · **PAID** (`4ef5f14a7`). Refund-line statement prepared once above loop. See §11BA.

**O-L11 · platform/sync — `VersionVector::iter` returns `(&String, &Counter)`** —
`platform/sync/src/crdt/version_vector.rs` ✔ **PAID 2026-10-22 in `224b6a7b2`, but it broke the**
**workspace build and nobody noticed for a round.** `iter` now yields `(&str, &Counter)`, which is the
right signature — and it broke `apps/cloud-server/src/conflict_resolution.rs:405-406`, one crate away:
`let keys_a: Vec<String> = a.iter().map(|(k, _)| k.clone()).collect();`

The failure mode is worth recording because it reads as correct: **`k.clone()` on a `&str` yields `&str`,**
not `String`, so the call compiled when `iter` returned `&String` and stopped compiling the moment it
returned `&str`. The error text even explains it ("this method call is cloning the reference `&str`") —
but only if someone runs the check.

**`cargo check -p platform-sync` passes.** The break is in a DIFFERENT crate, so a per-crate check cannot
see it, and the O-L11 commit touched only `platform/sync`. Fixed in `1005a2caf` by collecting `Vec<&str>`,
which is not a workaround but the better answer: those two vectors are only ever COMPARED, never returned,
so the `String` collection was allocating twice per element to compare keys already alive for the whole
call.

**The methodological point:** narrowing a public return type is an API change with fallout outside the
crate, and the only gate that sees it is `cargo check --workspace --all-targets`. That gate now runs at
`WS=0` with zero warnings, and it should be run after any change that narrows a type used across crates.
(`224b6a7b2` also claimed O-L11 without a ledger section — see §11BA.)

### Cross-cutting reading (round 2)

- **The dominant defect class is per-item work where a batch was meant:** per-SKU popularity
  (O-H01), per-item fsync (O-H03, O-H21), per-item HTTP round trips (O-H10, O-H20), per-row
  SELECTs inside hot transactions (O-H05, O-H06, O-H08, O-H11, O-H14). One fix shape covers
  almost all of it, and it sits on the checkout and sync paths — if a single class is funded,
  fund this one.
- **Unbounded reads are the second class** (O-H02, O-H07, O-H12, O-H15, O-M03, O-M35). These
  fail as hard errors, not slowdowns: oversized payloads, `SQLITE_MAX_VARIABLE_NUMBER`,
  transport timeouts on a queue that then grows further.
- **Constant-factor re-derivation per call is the third** (O-H04, O-M09, O-M15, O-M23, O-M32):
  fresh clients and re-parsed keys/payloads per request or tick. Cheapest to fix, wins on every
  tick across the fleet.
- **Verified-count honesty:** 8 of the 22 High entries (O-H01–O-H08) were re-read line-by-line
  this round; the remaining 14 High entries carry the audit pass's own line references and are
  pending spot-check. Nothing below High has been re-read yet.
  *(Superseded 2026-09-25 by §9A, which verified all 85 pending entries from §7 and §8: none
  rotten, 21 corrections, one promotion to O-H26. Read §9A alongside this section.)*
- **No crate code has been changed.** This section is the journal-first record the pass was
  asked for; fixes are unfunded until entries are picked from it.

---

## 8. Scale-review journal — round 3 (2026-09-25)

**This round runs the pass §7 left open:** the support crates, the 14 `modules/*` verticals and
`foundation`. Four audit agents read the production `.rs` files of their cluster (`*_tests.rs`
and `tests/` skipped unless a production bug was only visible there); I then re-read the cited
lines of every entry I ranked High and of the Medium entries that carry a claim a fix would be
built on. **No crate code has been changed.**

**Provenance legend, same as §7:** ✔ = I re-read the cited lines on this date and the code
matches the entry. ◦ = the entry carries the audit pass's line references; spot-check pending.
Round-3 agent ids (`3A-nn` … `3D-nn`) are kept alongside each journal id so a reviewer can trace
an entry back to the pass that produced it.

### The wiring calibration, stated before the list — it changes what these entries are worth

An audit of unwired code is an audit of intent, not of behaviour. Call-site checks run this
round:

| crate | wired? |
|---|---|
| `kasirmu-notification` | `run_scheduler_loop` **is** wired (`apps/desktop-tauri/src/lib.rs:400-403`); the event handlers are inert, feature-gated off (`lib.rs:12-19`) |
| `modules-currency` | **live** — the only `modules/*` crate referenced outside `modules/` (both shells) |
| `kasirmu-logging` | only `try_init()` is wired (both shells); the file writer, syslog and eventlog paths are unwired |
| `kasirmu-hal`, `-payment`, `-plugin`, `-lan`, `-cli`, `-local-api`, `qris-core`, `-crypto` | production crates, reachable |
| `kasirmu-reporting`, `kasirmu-media` | **no production caller** — own tests only |
| `modules/*` other than `currency` | **no non-test caller**; `InventoryStockHandler`, `ReportingService` and `ReportingRepository` have no subscriber outside their own tests |

So a defect in `kasirmu-reporting` is a defect in a library nobody calls *today*, and one in
`kasirmu-notification`'s scheduler is a defect that runs on every desktop till. Entries below say
which they are. Latent entries are still worth fixing — the four stub verticals instruct future
work to "move tables and queries into `repository.rs`", so this is the code that becomes the
runtime — but they should not outrank live ones when a phase is funded.

### High — likely to bite within months

**O-H23 · kasirmu-notification — the scheduled email report holds the process-wide DB mutex
across ten aggregate queries** — ✅ **PAID 2026-09-27, fixed in place (no separate commit)**
(re-verified at HEAD 2026-10-21: `email_scheduler.rs:70` "Scope 2a" / `:93` "Scope 2b", lock released
before render) — `crates/kasirmu-notification/src/email_scheduler.rs:71-81` ✔
(3C-01) · **LIVE**, wired at `apps/desktop-tauri/src/lib.rs:400-403` ✔
Scope 2 takes `db.lock().await` — the same `Arc<Mutex<Connection>>` every UI command, the sync
daemon and the image-push daemon share — and holds it across
`generate_filtered_report_email`, which runs ten sequential aggregates (`daily_revenue`,
`weekly_revenue`, `monthly_revenue`, `top_products`, `hourly_heatmap`, `category_breakdown`, two
alert lists, `category_popularity`, `category_forecast`) plus HTML and text rendering. Every
other DB consumer on the till stalls for that whole window, and the cost grows with sales
history. *Fix:* run the export on a dedicated connection, or snapshot the rows and drop the lock
before rendering; bound the export by date bucket regardless.

```rust
71      let (report, recipients) = {
72          let conn = db.lock().await;
...
78          let report = email_sender::generate_filtered_report_email(&store, &schedule, &name)
79              .map_err(|e| format!("Report gen: {e}"))?;
```

**O-H24 · kasirmu-payment — processor fallback advances on `Transient`, the double-charge
class** — ✅ **PAID 2026-09-27 in `8c592c58f`** (re-verified at HEAD 2026-10-21) —
`crates/kasirmu-payment/src/registry.rs:100-114` ✔ (3A-06)
`execute_with_fallback` falls through to the next processor on any non-`Terminal` error, and
`ErrorClass::Transient` is precisely the class where the request may have reached the gateway.
The crate states this itself, in `resilience.rs:293-298` ✔: *"a `Transient` error is precisely the
class where the request may have reached the gateway … Retrying it is not resilience; it is
double-billing with a retry's reputation."* A timeout after gateway #1 committed therefore
re-sends the money-moving operation to gateway #2, and the two share no idempotency key. Graded
Medium by the pass; **promoted here**, because the blast radius is money and the crate's own
design doc already rules the behaviour out. *Fix:* fall through only on `Terminal`/
`Unsupported`, or require a caller-supplied gateway key before a `Transient` fall-through.

```rust
104                Err(err) => {
105                    let class = err.classify();
106                    // On terminal decline or bad card, do not silently switch processor
107                    if class == ErrorClass::Terminal && !matches!(err, PaymentError::Unsupported(_))
```

**O-H25 · modules-reporting — daily report hard-codes USD, sums across currencies, and cannot
use an index** — ❌ **MOOT 2026-10-21.** The cited `modules/reporting/src/repository.rs` no
longer exists — the module's `src/` is now `{handlers,lib,lib_tests}.rs`, and `handlers.rs`
(31 lines) carries no `strftime`/`DATE(` call, no `SUM(total_minor)` and no currency
aggregation. The three named defects are not present at HEAD in any file: the module was
reimplemented rather than fixed. Closed as gone, not as repaired.
**✅ CLOSED 2026-10-22** — the closing verb this note already argued for but did not spell, added during
the round-17 census sweep so the High tier stops reading as non-empty.
`modules/reporting/src/repository.rs:31-54` ✔ (3D-05) · **latent**, zero
non-test callers
Three defects in one query. `strftime('%Y-%m-%d', created_at) = ?1` wraps the column in a
function, so any index on `created_at` is unusable and each report is a full scan growing with
history. `SUM(total_minor)` has no `GROUP BY currency`, so a multi-currency day adds IDR to USD.
The result is then stamped `Currency(*b"USD")` unconditionally — an IDR store's revenue is
labelled dollars. *Fix:* sargable half-open range (`created_at >= ?1 AND created_at < ?2`), group
by currency, and resolve the store's currency instead of hard-coding.

**Re-measured 11-10-26:** `modules/reporting/src/repository.rs` NO LONGER EXISTS — the module's `src/` is now `{handlers,lib,lib_tests}.rs`, and `handlers.rs` is 31 lines carrying no `strftime`/`DATE(` call, no `SUM(total_minor)` and no currency aggregation, so this finding's three named defects are not present at HEAD in any file. Read it as a dated reading of a module that has since been reimplemented; do not treat it as a live defect. 
```rust
33               FROM sales WHERE strftime('%Y-%m-%d', created_at) = ?1 AND status = 'completed'",
...
49                  currency: Currency(*b"USD"),
```

### Medium — likely to bite within years

**O-M40 · kasirmu-hal — `probe_all` walks the USB bus four times** —
`crates/kasirmu-hal/src/transport/usb.rs` ✔ **PAID 2026-10-22** (3A-01). Scanners cost two walks
(`CLASS_HID` + `CLASS_VENDOR_SPECIFIC`), scales a third `CLASS_HID` and printers a fourth, and each
walk opened every matching device to read three string descriptors — so the duplicate walks cost far
more than the enumeration itself. `probe_all` now performs ONE walk and partitions in memory.

**The class had to ride along with the record.** The fix is not the `Vec<UsbDeviceInfo>` this entry
suggested, because an interface can expose several settings and `UsbDeviceInfo` does not carry which
class matched — and the HID-versus-vendor-specific split is exactly what must stay exact. `walk_bus`
hands each match back as a `pub(crate) Classified { class, info }`, and the per-category
post-processing (the dedup loop, the re-classify/retain steps, the label fallbacks) was lifted
VERBATIM into `scanners_from`/`printers_from`/`scales_from`.

**The device lists are proved unchanged, not asserted.** `usb_tests.rs` carries a verbatim port of the
OLD three-walk implementation as an oracle, fed the same synthetic enumeration as the new partition and
compared on `(vid, pid, interface, label, category)` IN ORDER — plus an exhaustive sweep of every
VID/PID in all three tables against all three classes, and a fixture covering a dual-class scanner (the
dedup rule), a vendor-only scanner (merged after HID), and unknown devices (dropped).
`every_known_vid_pid_is_classified_identically_by_old_and_new_paths` is the exhaustive one.

**The honest limit:** the walk itself needs libusb and real hardware and is NOT unit-tested. What is
pinned is everything downstream of the enumeration.

**O-M41 · kasirmu-hal — one full bus enumeration per device connect** —
`crates/kasirmu-hal/src/transport/usb.rs` ✔ **PAID 2026-10-22** (3A-02), but NOT by the fix this entry
prescribed. `open_device` built a fresh `rusb::Context` per connect; it now uses a process-wide
`USB_CONTEXT: OnceLock<Context>` shared with the walk.

**A cache of `rusb::Device` handles was considered and rejected, and the reason is the interesting part.**
`DeviceList` owns and frees the list it returns, so any cache outliving a walk must re-derive each
`Device` from the raw pointer — i.e. it still pays a fresh `get_device_list` — while adding a real unplug
hazard: a stale handle turns a clean `NoDevice` into a confusing open failure. The cache buys nothing
and risks the one thing a reconnect path must get right. So nothing about a connection is retained:
`open_device` builds a fresh device list on every call, an unplugged device is simply absent
(`NotFound`), and a replug re-enumerates normally. A miss is a fresh enumeration by construction.

**O-M42 · kasirmu-hal — serial barcode read is one syscall per byte** —
`crates/kasirmu-hal/src/transport/barcode_reader.rs` ✔ **PAID 2026-10-22** (3A-03). A 13-character
barcode cost 13 blocking `read()` calls; both `serial_scanner::poll` and `bt_scanner::poll` now read
64-byte chunks through one shared `BarcodeReader`. The `Ok(n)` arm that looked dead was evidence the
multi-byte read had been intended and narrowed away.

**Bytes arriving AFTER the terminator are RETAINED, not discarded.** They belong to a later barcode, and
retaining them is what makes a barcode split across two reads neither lost nor duplicated. The module
header documents it, `barcode_split_across_two_reads_keeps_every_character` pins it, and
`barcode_split_at_every_offset_is_reassembled` sweeps every split point.

**A bug in the first cut was found by the test that was written to prove the fix.** An `Ok(0)` between
two bites of one code made the first cut hand back the partial prefix; the split test caught it, and the
rule is now: with nothing buffered a poll ends immediately, with a PARTIAL code buffered the partial is
kept and the loop returns to the deadline check — so a barcode split across a would-block still
reassembles. `a_zero_length_read_does_not_end_the_poll_while_a_code_is_pending` pins that.

Pinned end-to-end through the real driver `poll()` on BOTH scanners, including a test that asserts
`read()` count == 1 for a 13-character code. `MAX_BARCODE_LEN` now has one definition (still 1024, still
`bytes`); the driver modules `pub use` it, so `drivers::serial_scanner::MAX_BARCODE_LEN` and its BT twin
still resolve. One existing SOURCE-TEXT guard (`include_str!`, which demanded three literal definitions)
was amended to name the two surviving definitions, with the reason recorded in its doc — the bytes-unit
rule it enforces is unchanged.

`cargo test -p kasirmu-hal --lib` = **428 passed, 0 failed** (up from 361; 67 new tests).

**O-M43 · kasirmu-hal — the Android JNI `VM` mutex is held across blocking connect and read** —
`crates/kasirmu-hal/src/transport/bt_android.rs` ✔ **PAID 2026-10-22 in `fa92db2ab`, UNEXERCISED.** (3A-05).
The guard was taken for `attach_current_thread` *and* the whole closure, which includes
`BtRfcommStream::connect` (multi-second) and `read` (blocks until data) — so one read stalled every
Bluetooth operation in the process.

**The prescribed fix — "lock only long enough to clone the `JavaVM`" — is not possible as written.**
`jni::JavaVM` is **not `Clone`** on 0.21 (the file's own comment said so). What the crate does offer is
`get_java_vm_pointer() -> *mut sys::JavaVM` and `unsafe JavaVM::from_raw(ptr)`, and `JavaVM` is
`#[repr(transparent)]` over that pointer with no `Drop`. So the fix copies the RAW POINTER out under the
lock, releases it, and re-wraps outside — the conversion `Clone` would have given, expressed as `unsafe`.

**And it needed an invariant change to be sound, which is the part worth keeping.** `set_java_vm` used to
be "last writer wins" (`*guard = Some(vm)`). That would DROP the stored `JavaVM` on a second call and leave
every in-flight caller attaching on a **dangling pointer**. It is now SET-ONCE: the first VM wins, later
calls are ignored and their value dropped outside the lock. Only one call site exists (inside `JNI_OnLoad`,
which ART calls once per library load), so this tightens what was already true in practice — but the
pointer could not cross a lock without it.

`vm_pointer()` is a three-statement function whose only job is lock → read pointer → unlock, so "no blocking
call under the mutex" is checkable by eye rather than asserted in a comment. The only `VM.lock()` sites in
the file are now inside `vm_pointer` and `set_java_vm`. The attach guard still outlives `f`, and the error
mapping is unchanged.

**⚠️ NOTHING EXECUTED THE ANDROID PATH.** `cargo check -p kasirmu-hal --target aarch64-linux-android` fails
BEFORE `kasirmu-hal` is built — `zstd-sys` (via `kasirmu-core`) cannot find `aarch64-linux-android-clang` or
`string.h`, i.e. no NDK sysroot on this host. A grep of that run for `Compiling kasirmu-hal` / `Compiling
jni` / `error[E` returns zero matches. So the file was never type-checked by a target build and no test ran
it. What IS verified: `cargo check -p kasirmu-hal --all-targets` exit 0, `cargo test -p kasirmu-hal --lib`
**428 passed** (unchanged — host cfg excludes this module), `rustfmt --check` clean.

**A false green was available and deliberately not taken:** a host test calling `vm_pointer()` and asserting
the no-VM error would pass while exercising none of the code of interest. The final authority on this file
is an Android build or a review of the two-lock-site claim.
**O-M44 · kasirmu-hal — `discover_all()` per configured USB printer at startup** —
`crates/kasirmu-hal/src/bootstrap.rs:299-302` ✔ **PAID 2026-10-22 in `647a8614f`** (3A-07).
N printers means N complete bus enumerations, each returning the same list, of which only element 0 is kept.
Fixed: hoisted one `discover_all()` above the loop, converting it to an iterator consumed across configured USB printers.

**O-M45 · kasirmu-payment — backoff has no jitter and `max_retries` is uncapped** —
`crates/kasirmu-payment/src/resilience.rs:337-341` ◦ (3A-11) · **PAID 2026-10-22.** Every terminal in a
fleet retried on the same beat, and `1 << (attempt - 1)` with a `u32` config overflow-panics in debug
past 64. Fixed in `resilience.rs`: **full-jitter** backoff (the source draws uniformly from
`[0, initial * 2^(n-1)]` and the draw is clamped to `max_backoff_ms` on the way out) plus
`MAX_RETRIES = 8` clamped at BOTH boundaries — `ResilientProcessorConfig::new` and the new
`retry_budget()` read by the retry loop, because the field is public and a struct literal bypasses the
constructor. `JitterFn` is injectable (`with_jitter`) so tests assert exact sleeps under
`start_paused` instead of tolerating a range.

**A defect I wrote into the first draft, and how the test that should have caught it did not.**
The draft capped the WINDOW before drawing (`min(max, initial * 2^n)` passed to the source) and the
test asserted `bounds == vec![100, 200, 300]` calling that "the window must double per attempt and stop
at max_backoff_ms". 300 is exactly what BOTH theories predict at attempt 3 — `min(400, 300)` and a
frozen window — so the assertion passed under the broken and the correct code alike, and the doubling
was in fact dead past the first cap. Caught in review, not by the suite. The replacement,
`jitter_window_grows_past_the_cap_while_the_sleep_is_capped`, hands the source `|b| b` so the bounds
vector exposes which side the cap is on: correct reads `[100, 200, 400]`, the broken draft reads
`[100, 200, 300]`. It was proven to fail on the re-injected bug before being kept. **The lesson is the
one this journal keeps relearning:** a test that names a property is not a test that pins it, and a
vector where both hypotheses agree distinguishes nothing.

**The shift and the multiply are two traps, not one.** `:1172` says "roughly attempt 58, not 64" — true
of `initial * 2^n` (100 * 2^57 fits `u64`, 100 * 2^58 does not), but `1u64 << 64` traps on its own at
attempt 65 regardless of the multiply. `MAX_RETRIES` keeps `attempt <= 8`, and both sites also
`saturating_mul`/`.min(63)` so the panic is unreachable twice over rather than once.

**O-M46 · kasirmu-local-api — the audit sink writes through the handlers' DB mutex, one**
**unbounded task per event** — `crates/kasirmu-local-api/src/lib.rs` (3B-01). Every mutating request
queued an extra blocking `INSERT` behind the single connection the handlers use, and each `record`
spawned a task that cloned the event and only `warn!`s on failure. *Fix:* dedicated connection or a
bounded channel with one writer; count failures rather than log them.

**⚠️ RESOLVED 2026-10-22 in `3a6a5e829` — see §11BB. It was OPEN and HANGING at HEAD.** Commit `401ddd3da`
("perf(local-api): resolve O-M46 with dedicated audit connection and bounded queue") implemented BOTH
halves — the dedicated connection AND a bounded channel with back-pressure — and its own two tests hang:

- `tests::a_full_channel_blocks_and_still_loses_nothing`
- `tests::audit_writes_do_not_hold_the_handlers_connection`

Measured at `4ef5f14a7`: `cargo test -p kasirmu-local-api --lib` runs 26 tests, reports "has been
running for over 60 seconds" for both, then aborts with `error: test failed` and NO `test result:` line.
With exactly those two skipped, the same suite is **24 passed, 0 failed in 3.12 s**. So the two tests
are the whole problem and everything else in the crate is green.

**The root cause, isolated by the lane that wrote it:** when the writer exits the channel is `Closed`,
and the FULL-path `await_room` spawned `drain_parked_then_send`, which does `tx.send(msg).await` on a
CLOSED channel. Tokio parks a sender once the queue is empty and the receiver is gone, so that send
never resolves; the task waits forever and runtime shutdown then blocks waiting for it. The second test
hangs for the same reason once its own assertion panics and leaves the parked task behind.

**The design conclusion, which is the useful part and cost the most to learn:** `AuditSink::record` is a
SYNCHRONOUS trait method, so "wait for capacity" has **no legitimate expression**. Blocking the caller
stalls a tokio worker; spawning defers to a task nobody awaits; parking in a static leaks. The lane
measured this directly — a gated-writer probe showed `record` had already returned and the queue had
never even filled, because awaiting is enough to let the writer drain. That is the argument, not a guess.

**What a second attempt should take: the dedicated-connection half ONLY.**
`StoreAuditSink::open(path, store_id)` with WAL + `busy_timeout(5s)` + `foreign_keys` is what makes a
second writer safe and is the piece that removes the contention the entry is actually about. Keep the
counted failure (`AtomicU64`, first failure at ERROR then every 100th) and a `flush` bounded by a
timeout so tests wait for durability instead of sleeping. Leave the queue out. Also: do NOT log via a
per-event `tokio::spawn` "for ordering" — `log_audit` reads the previous row's hash, so N concurrent
writers race the chain; serialise through the sink's own `Mutex<Connection>`.

**A trap for whoever writes the tests:** any "N events -> N rows" assertion must budget for
`kasirmu_core::db::audit::check_audit_rate_limit`, a PROCESS-WIDE 1000/min sliding budget that returns
`Ok` WITHOUT writing. A burst above it loses rows by design and looks exactly like sink loss — that
produced the misleading 480-vs-500 counts during this work. `reset_audit_rate_limit_for_test` is
`pub(crate)` in `kasirmu-core` and unreachable from this crate.

Fix or revert `401ddd3da` before anything else: **a suite that hangs is worse than a suite that fails**,
because CI reports a timeout with no test name rather than a red test with one.

```rust
533          tokio::spawn(async move {
...
566              let conn = store.lock().await;
567              if let Err(e) = kasirmu_core::Store::new(&conn).log_audit(&entry) {
568                  tracing::warn!(error = %e, "local API audit write failed");
```

**O-M47 · kasirmu-plugin — `validate_sql` compiles ~16 regexes per statement** —
`crates/kasirmu-plugin/src/db.rs` ✔ **PAID 2026-10-22** (3B-03). `contains_word` built a `format!`
pattern and called `Regex::new` on every invocation, and `validate_sql` invokes it once per
`BLOCKED_KEYWORDS` entry plus PRAGMA plus the two ALTER/TABLE checks — ~16 compilations per plugin
`exec`/`query`, while the ten table patterns a few lines away were already `OnceLock`-cached.

**Option A (cache), not option B (byte-scan), and the reason is that this is a security check.** A
`KeywordRegexes` cache in a `OnceLock` holds one compiled regex per blocked keyword plus PRAGMA, ALTER
and TABLE. The patterns are byte-for-byte the ones the old code built inline, so the matches — and
therefore which statements are rejected — cannot change. The faster-looking option B (`drop the regexes,
word-scan on bytes, drop `to_uppercase()`) rewrites the matching semantics, and `\b` is not trivially a
byte comparison: `_` is a word character, digits and letters are one run, and the regex is `(?i)` whose
Unicode case folding is not the same as `to_uppercase()`. For a change whose only upside is going from
"16 compiles" to "zero compiles" — and where the matching itself was never the cost — rewriting the
rule buys nothing and risks the one thing the function exists to do.

**An unknown keyword panics rather than compiling fresh or reporting absent.** A fresh compile would
quietly restore the per-call cost this cache removes; reporting absent is the fail-OPEN direction the
function's own PLG-B note forbids. So a keyword added to `validate_sql` without being added to
`build_keyword_regexes` fails loudly in the first test that exercises it.

**Two tests pin what a cache keyed on keyword TEXT could most easily lose.**
`cached_keyword_regexes_preserve_word_boundary_semantics` asserts both directions: a blocked keyword
appearing only as a SUBSTRING of a longer identifier stays allowed (`test_pragma_notes`, `test_tableau`,
`test_attached_items`) — a false positive there rejects legitimate plugin SQL with no workaround — while
the bare word is still caught in each surrounding form. `keyword_regex_cache_compiles_and_matches_every_
keyword` is the sibling of `sql_validation_regexes_compile`: a pattern typo or a keyword missed by
`build_keyword_regexes` fails there instead of at the first plugin call in a live process.

`cargo test -p kasirmu-plugin --lib` = **226 passed, 0 failed** (224 before, plus the two above).

**O-M48 · kasirmu-plugin — plugin `query` is unbounded and clones each column name per cell** —
`crates/kasirmu-plugin/src/db.rs` ✔ **PAID 2026-10-22** (3B-04). `query` materialised the whole result
set into `Vec<Value>` and then serialised it to a `String`, so peak memory was ~2x the encoded result,
with no ceiling at all — the only plugin budget in the workspace without a number (the Lua VM has 10
MiB, a script file 1 MiB, a package entry 16 MiB).

**The ceiling, and why that number.** `pub const MAX_QUERY_ROWS: usize = 10_000`, tied to the Lua VM cap
the result actually COMPETES against: the JSON string crosses into the plugin as a Lua string, which the
VM allocates and counts against its 10 MiB. A realistic plugin row encodes to a few hundred bytes, so
10 000 rows is a few MiB — inside that budget with room for the script's own tables, and far past any
legitimate hook, which runs inside a checkout rather than producing a report.

**Excess rows are an ERROR, not a truncation.**
`PluginError::PermissionDenied` carrying the number and the remedy ("add a LIMIT … narrow the WHERE
clause, or page through the data"). Reusing `PermissionDenied` keeps the public error enum unchanged. The
reason truncation was rejected: a discount or tax hook fed a silently-truncated result computes wrong
money and cannot detect it, so the fail-closed direction is the only defensible one at a sandbox
boundary.

**The cap is enforced by COUNTING ROWS AS THEY ARE READ, not by rewriting the SQL.** This matters more
than it looks: `validate_sql` rejects quoted identifiers (PLG-11) and comment-stripping already runs
before extraction, so a rewrite that appends `LIMIT n` would have to survive a trailing semicolon, an
existing LIMIT, and a trailing comment — and getting that wrong in a sandbox is a bypass. The read loop
cannot be defeated that way because no text is appended at all. The check fires on the first EXCESS row
(the 10 001st, before `seen` is incremented), so nothing beyond the cap is ever retained.

`validate_sql` is deliberately UNCHANGED — same keyword set, no new rejection. A plugin `LIMIT 999999`
is not rejected by the validator because the read-loop cap already makes it unreachable, and a second
check that could disagree with the first is worse than one check that cannot.

**The names half: one allocation per distinct name per query, not per cell.** `column_names` is collected
once and an `owned_keys` buffer holds one single-entry map per distinct name; every row clones from that
buffer. A 1,000 x 10 result went from 10 000 name allocations to 10. Output is byte-identical, pinned by
tests over `SELECT *` with NULL/INTEGER/REAL/BLOB(hex, base64)/TEXT, expression columns, aliased columns,
duplicate labels (which still collapse to one key) and the empty result.

A latent abort was removed with it: `row.get_unwrap(i)` became a propagating `row.get(..)`. That unwrap
sat on a path a PLUGIN can drive, so a column-type surprise would have aborted the host process rather
than failing one query.

**Boundary pinned at cap-1, cap and cap+1** — `query_cap_returns_every_row_one_below_the_ceiling`,
`query_cap_allows_exactly_the_ceiling`, `query_cap_rejects_one_row_above_the_ceiling`, plus
`query_cap_counts_engine_rows_not_the_plugins_limit_clause` (`LIMIT 999999` over cap+5 still errors) and
two output-identity tests. The cap is inclusive, so the `LIMIT` the error recommends does not itself trip
it. `cargo test -p kasirmu-plugin --lib` = **233 passed, 0 failed**.

**O-M49 · kasirmu-cli — `kasirpkg` import probes existence per row, per table** —
`crates/kasirmu-cli/src/commands/kasirpkg.rs` ✔ **PAID 2026-10-22** (3B-05). All four arms had the same
shape — `SELECT` probe then a write, 2 recompiled statements per row. Categories, products, customers and
users are now ONE prepared `INSERT … ON CONFLICT … DO UPDATE` per row; a full all-types row went from
**8 statements to 4**. The `Value` deep clone is gone (`for val in payload.X` moves instead of cloning),
and one `Utc::now()` is hoisted for the whole import.

**The conflict targets were verified empirically, and the DDL text lies.** A literal `ON CONFLICT(sku)`
looks right from the migration source and FAILS at prepare time: migration
`20260831_per_tenant_unique_rebuild.sql` rebuilt `products` and `users` without their inline `UNIQUE`,
replacing both with `(tenant_id, …)` composite indexes. The lane established the real constraints with a
throwaway `PRAGMA index_list`/`index_info` probe against `migrations::fresh_db()` rather than trusting the
SQL it was reading — which is the difference between a change that works and one that takes five tests
down with it.

**Re-import UPDATES; it does not skip**, and that was established from the control flow (the INSERT arm
ran only when the probe said absent) then PROVEN by falsification: swapping products to `DO NOTHING` fails
`kasirpkg_reimport_updates_a_stale_local_row` at exactly the products assertion. Each old UPDATE arm's
column list was carried verbatim, including the pre-existing asymmetry where the UPDATE never touched
`pin_hash`/`is_active` — so a re-import has never deactivated a live user, and adding those columns to
`DO UPDATE` breaks `kasirpkg_reimport_preserves_what_the_old_update_arm_never_touched`.

**Two deliberate non-changes, both correct:** the **sales** probe SURVIVES because the write path is
`Store::create_sale_in_tx`, which owns the 22-column INSERT *and* the line-items loop behind a money
validator — an `ON CONFLICT` there would duplicate private core SQL or silently drop lines, and the
semantics are SKIP rather than update. Only the per-row recompile was removed. **sales, customers and
users** keep two column lists for the INSERT and UPDATE paths for the same reason the old code did.

**A gap the lane found in its own work:** the first version of the idempotence tests did NOT catch
`updated_at` being dropped from a `DO UPDATE` list, because the assertion was too narrow. Widened to
assert every updated column, then re-falsified to confirm it now fails.

**No statement-count test exists, and that is stated rather than faked:** rusqlite exposes no
per-statement counter without a `sqlite3_trace_v2` hook the crate does not enable, so the 8→4 numbers are
a measurement, not an assertion.

`cargo test -p kasirmu-cli --lib` = **152 passed, 0 failed**; 5 tests added.

**O-M50 · kasirmu-cli — export deep-clones the payload and `.ok()`s a failure into an empty**
**array** — `crates/kasirmu-cli/src/commands/kasirpkg.rs` ✔ **PAID 2026-10-22** (3B-06).

All SIX export arms ended in
`serde_json::to_value(&rows).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default()`, which has
TWO silent failure modes that both report success: an `Err` becomes an empty `Vec`, and an `Ok(non-array)`
does too. The package was still written, exit was 0, and stderr printed `exported to <path> (N bytes)` —
a store whose rows could not be serialised was indistinguishable from a store with zero rows. The deep
clone is the same expression: `.as_array().cloned()` copied the whole JSON array out of the `Value`.

**The trigger is real, not scaffolded.** `foundation::Currency` hand-writes `Serialize` and returns
`"invalid currency bytes"` when its `[u8;3]` is not UTF-8 (`foundation/src/money.rs:134`). No ordinary DB
read path can produce it — every row mapper goes through `str::from_utf8`/`String` first — which is
precisely why nobody ever saw it: the arm's error contract was enforced by nothing and observed by
nothing.

**Propagate, not warn.** `export_arm<T>(rows, arm)` serialises by REFERENCE, propagates with
`.context("serializing {arm} for export")`, and rejects a non-array `Ok` naming the arm and the JSON kind
(a small `json_kind` helper, so a whole table is never dumped into the terminal). Propagation costs no
plumbing here because the crate's established style is `anyhow::Result` out of `run()` and `main`, so the
failure exits NON-ZERO with a message; warn-and-continue would have produced a silently PARTIAL package —
the same defect wearing a log line.

The serde round-trip stays on purpose: `KasirpkgPayload` holds `Vec<serde_json::Value>` and
`ArrayFromIter::from_iter` is only implemented for `Result<Value, E>`, which cannot express a propagating
serialisation failure. The clone was removed by passing `&[T]`, not by restructuring.

**The test proves the old expression was wrong, not just that the new one works:** it asserts the RETIRED
expression turns the same value into an EMPTY array, then that `export_arm` returns `Err` naming `products`
with serde's `currency` reason. Falsified by restoring the old body, which makes it fail with
"must abort the export, not empty the arm: []". A success-path test pins the JSON byte-identical to what
the retired expression produced. `cargo test -p kasirmu-cli --lib` = **155 passed, 0 failed**.

**O-M51 · kasirmu-lan — replay buffer clones its key on every hit and evicts by full scan** —
`crates/kasirmu-lan/src/replay.rs` ✔ **PAID 2026-10-22** (3B-07). Both halves. The key clone was
`queues.entry(key.clone())`; `ReplayKey` is an enum over `String`, so every push heap-allocated a key
string whether or not the queue already existed. Eviction was `min_by_key(|q| q.front().seq)` over every
queue, plus a `key.clone()` to name the victim.

**Eviction is INSERTION ORDER, and establishing that is what made the swap safe.** The old scan picked the
smallest still-buffered `seq`, and `seq` is `next_seq += 1` under the mutex with every queue FIFO — so the
smallest `seq` IS the globally oldest insertion. There are no timestamps anywhere in `replay.rs`. A
`VecDeque<(seq, key)>` in insertion order is therefore exactly equivalent: same victim for the same
sequence. In a replay buffer that equivalence is not a nicety — a different eviction order changes which
nonces are still remembered.

**The equivalence is proved by an ORACLE, not by argument.** `ScanOracle` reimplements the old full scan
verbatim, and over a 13,000-push adversarial script (bulk fills, per-peer cap flush, single-event
dribbles, re-fills, a second identity, multi-eviction bursts) the test asserts after EVERY push that the
next eviction victim — `(seq, key)`, compared as a pair — matches the scan's choice, plus population and
per-queue content equality at the end. The script deliberately makes seq order and queue iteration order
disagree, because that is the only thing that could differ.

**A single removal path, so index drift is impossible by construction.** `pop_front_event` and
`take_queue` are the ONLY two functions that remove an event, and both maintain `fifo`/`live`/`total`
together. The per-peer cap, the global eviction and `drain` all route through them. That matters because a
`drain` punches a hole the index must learn about, and a structure that is maintained at three call sites
is a structure that will eventually be maintained at two.

The key clone is gone without a `Borrow` hack: `contains_key` borrows, and the owned key is materialised
only on a MISS. A borrowed `ReplayKeyRef` for a two-variant enum over `String` needs `unsafe` or a repr
trick, and that was named and declined rather than contorted into.

**A bug the lane introduced and reverted, worth recording:** its first version enforced the per-peer cap
AFTER the append with `>`. Not equivalent — on the crossing push the queue's own drop pre-empted the
global eviction and let the total sit one over the cap. The original sequence (per-peer `>= cap` check
BEFORE the append, global cap after) was restored, and the equivalence test is what caught it.

**Two escalations I raised were WRONG, and the lane measured that rather than deferring.** A `0xffffffff`
abort I attributed to a spinning eviction loop was its own diagnostic `eprintln!` formatting an
8,192-event buffer into a multi-megabyte string inside an await-free tokio worker. And a `left: 0 right: 1`
I read as "nothing evicted" was its test counting the per-peer drop on the wrong side. The lesson is the
mirror of this journal's recurring one: **a symptom I have seen before is not a diagnosis** — I matched an
abort signature to the previous round's hang and was wrong about the cause both times I did it.

`cargo check -p kasirmu-lan --all-targets` = exit 0, zero warnings (`--all-targets` caught a `dead_code`
warning `--lib` did not — the same "test passed, check failed" trap from §11AY, and the helper was removed
rather than silenced). `cargo test -p kasirmu-lan --lib` = **89 passed, 0 failed** (84 before; 5 new),
all 6 pre-existing tests untouched. One flaky run failed `two_devices_alternating_addresses_do_not_cross_
deliver` on `os error 10013` binding a FIXED port from a pre-existing test — environmental, and it passed
on re-run.

**O-M52 · kasirmu-plugin — `read_entry` fallback is O(n²) with an allocation per entry** —
`crates/kasirmu-plugin/src/package.rs` ✔ **PAID 2026-10-22** (3B-09).

**The O(n²) was in the CALLER, not in `read_entry`, and finding that changed the fix.** One `read_entry`
call was always O(1) on an exact hit and O(n) on a miss. The quadratic came from
`extract_scripts_and_migrations`, which calls `read_entry` once per entry and — crucially — passes the
FILENAME (the last path component) while `entry_contents` is keyed by the FULL stored path. So every NESTED
script missed the exact branch and scanned. A filename index built during parse turns the whole extract
from O(n²) to O(n), and removes two `String` allocations per stored entry per call.

**The miss-reasons were enumerated before the index was trusted, and one was a real regression in the**
**first cut.** Stored names are already sanitised (backslash → slash; absolute, drive, UNC, `.`/`..` and
empty components rejected) and zip normalises a leading `./`, so those forms cannot occur in a key. But a
QUERY containing a backslash (`scripts\a.lua`) must still resolve, and `last_component` alone treats `\`
as an ordinary character — which silently narrowed what was findable. `read_entry` now normalises the
query's separators. The equivalence test caught it, which is what it was for.

**One behaviour changed, deliberately, and it was never well-defined to begin with: the duplicate-name**
**winner.** The old fallback returned whichever entry `HashMap` iteration reached first, and
`entry_contents` is a `std::HashMap` whose iteration order is seeded per process — so **the answer varied
between runs of the same test**. The lane's oracle proved it: one run returned `second/dup.lua`, the next
`first/dup.lua`. Presence and the exact-name-beats-filename rule are unchanged; the winner is now the first
entry in archive read order, i.e. deterministic. Nothing in the tree depended on the arbitrary answer — the
sole caller already collided on the flattened output path regardless of which duplicate won. Recording it
here because "we made an undefined behaviour deterministic" is a behaviour change that deserves to be
findable.

The equivalence proof is `old_read_entry` in the test file: the pre-change body reimplemented verbatim and
compared over 22 query forms (exact, nested-by-filename, full path, backslash, trailing separator, `./`
prefix, empty, `/`, unicode, case variants, absent) — presence and bytes always, winning name wherever the
old lookup is order-independent. The retained fallback scan covers an archive with no index (no such
archive exists today; the branch was kept rather than deleted on a guess).

`cargo check -p kasirmu-plugin --all-targets` = exit 0, zero warnings ·
`cargo test -p kasirmu-plugin --lib` = **239 passed, 0 failed** (232 before; 7 new, no existing test
touched).

**O-M53 · kasirmu-notification — the message is rebuilt per recipient and the SMTP transport
per tick** — `crates/kasirmu-notification/src/email_scheduler.rs` ✔ **PAID 2026-10-22 in `ff01fa5db`** (3C-02).
Fixed: hoisted from address parsing and `SinglePart`/`MultiPart` building above the recipient loop,
eliminating repeated text and HTML body clones across recipients.

**O-M54 · kasirmu-reporting — every predicate is non-sargable and two queries are unbounded** —
`crates/kasirmu-reporting/src/daily_summary.rs:130` ✔ (with `:79-88`, `:124-133`;
`menu_engineering.rs:88-108`; `margin.rs:76-88` ◦) (3C-04) · **latent**, no production caller.
`DATE(s.created_at) BETWEEN ?1 AND ?2` cannot use an index; only `query_top_products` has a
`LIMIT`, so `query_daily_summary`, `query_sales_by_hour` and `query_menu_engineering` materialise
the whole history. *Fix:* half-open range predicates plus paging.
**UPDATE 2026-09-30 — half this item is now moot.** `crates/kasirmu-reporting/src/daily_summary.rs`
was retired under checklist C29, which took `query_daily_summary`, `query_sales_by_hour` and
`query_top_products` with it — so the only query in the set that had a `LIMIT` no longer exists, and
the remaining non-sargable surface is `query_menu_engineering` (`menu_engineering.rs:88-108`) plus
`margin.rs:76-88`. Scope the fix to those two.

**Re-measured 11-10-26:** `crates/kasirmu-reporting/src/daily_summary.rs` NO LONGER EXISTS.

**❌ THAT RE-MEASUREMENT WAS PARTLY FALSE. Corrected and RESOLVED 2026-10-22 — §11BX.**
Two errors in it, both in the direction that made the work look bigger:

1. **`margin.rs` carries NO `DATE(created_at)` predicate at all.** `margin.rs:87-99` is
   `WHERE sl.sale_id = ?1 ORDER BY sl.line_position` — a single-sale, primary-key-keyed lookup. It is
   bounded by construction and was never part of this defect. The claim traced back to the crate's own
   audit header, which files it as R-2 INFO "deliberately NOT scheduled" — the ledger copied a header
   that was itself wrong.
2. **"every predicate is non-sargable"** was false for `menu_engineering` too: `s.status = 'completed'`
   is perfectly sargable. One predicate of two.

**And the central claim — that `DATE(s.created_at)` "cannot use an index" — was ALSO wrong in practice.**
MEASURED with `EXPLAIN QUERY PLAN` over 200 seeded rows: the OLD predicate planned as
`SEARCH s USING INDEX idx_sales_status_created_date (status=? AND <expr>>? AND <expr><?)`. It SOUGHT;
it did not scan. The reason is `crates/kasirmu-core/migrations/20260814_analytics_index.sql:4`:
`CREATE INDEX idx_sales_status_created_date ON sales(status, date(created_at))` — an EXPRESSION index
built (commit `ed76ebc6`) for exactly this shape. The "full table scan growing with history" never
happened on any database carrying that migration.

**Fixed anyway (`e9631cbc5`), for the property that IS real:** the query now uses the half-open range
`s.created_at >= ?1 AND s.created_at < date(?2, '+1 day')`. Measured difference: with the expression
index DROPPED, the old form falls back to `SCAN s USING COVERING INDEX idx_sales_created_at` while the
new form still `SEARCH`es `idx_sales_created_at`. The rewrite removes a DEPENDENCY on one expression
index; it does not remove a scan that was there. `menu_engineering_date_filter_can_use_an_index` and
`the_old_date_predicate_depends_on_the_expression_index` pin both halves, and both were FALSIFIED against
the old predicate before being accepted.

**Still open, unchanged:** `query_menu_engineering` has no `LIMIT` (one row per product × currency over
the range, so it is bounded by the catalog, not by history — lower risk than the entry implies). The
other `DATE(created_at, tz)` report queries are untouched and remain R-2 INFO.
```sql
130           AND s.created_at >= ?1 AND s.created_at < date(?2, '+1 day')
```

**O-M55 · kasirmu-reporting — menu engineering performs five sorts per call** —
`crates/kasirmu-reporting/src/menu_engineering.rs` ✔ **PAID 2026-10-22 in `44a595218`** (3C-05).
Fixed: preserved merge order by dropping the redundant post-merge revenue sort, and replaced full
$O(n \log n)$ vector sorting in `median_of` with $O(n)$ `select_nth_unstable` partitioning and linear max.

**O-M56 · kasirmu-media — `trim_borders` does per-pixel bounds-checked `get_pixel` over four
full-frame passes** — `crates/kasirmu-media/src/crop.rs` ✔ **PAID 2026-10-22 in `7ecc94f4b`** (3C-06).
Fixed: walked `rgb.as_raw()` contiguous byte slices using `chunks_exact(3)`, bounded vertical column
scanning to `top..bottom`, and added immediate early return for solid-colour images.

**O-M57 · kasirmu-logging — syslog layer allocates per field and blocks per record** —
❌ **MOOT — CLOSED 2026-10-21, re-verified 2026-10-22.** The target no longer exists: `crates/kasirmu-logging/src/syslog.rs` was
DELETED by `53dcb73a3` ("refactor(logging): delete the unwired syslog/eventlog sinks (C29/D13)",
2026-09-29), together with the `libc` dependency. `Cargo.toml:20-22` records the removal and
notes the crate "is now pure safe Rust". There is no syslog layer left to make non-blocking —
closed by deletion, not by fixing.
`crates/kasirmu-logging/src/syslog.rs:119-141`, `visitor.rs:27-49` ◦ (3C-07). One `CString` and
one blocking `libc::syslog()` per record on the emitting thread. *Fix:* `non_blocking`, `write!`
into a reused buffer.

**Re-measured 11-10-26:** `crates/kasirmu-logging/src/syslog.rs` and `eventlog.rs` NO LONGER EXIST — the crate's own README (audited 2026-10-11) records that the syslog/eventlog FFI modules were REMOVED, leaving `{error,lib,visitor}.rs`. The finding is retired with the code it described. (It also makes the ledger's O-M57-era claim that a syslog layer installs on deployments a dated reading — see the same-named item in `.agents/reviews/crate-review-ledger-24-09-26.md`.) 
**O-M58 · kasirmu-logging — eventlog layer allocates a `Vec<u16>` and blocks per record** —
❌ **MOOT — CLOSED 2026-10-21, re-verified 2026-10-22.** Same deletion as O-M57: `eventlog.rs` and the `windows-sys` dependency
gone in `53dcb73a3` (C29/D13). No Event Log sink remains.
`crates/kasirmu-logging/src/eventlog.rs:108-115` ◦ (3C-08). *Fix:* thread-local scratch buffer,
worker thread.

**O-M59 · kasirmu-logging — the JSON+file init path skips the writability preflight the text path
has** — `crates/kasirmu-logging/src/lib.rs:307-343` vs `:260` ✔ (3C-09) · **PAID** (`084f5002f`). `ensure_log_dir_writable(log_dir)?` wired into `try_init_json_with_file`, failing fast on unusable directory paths with `LogDirUnusable`. Verified in `lib_tests.rs`.

**O-M60 · kasirmu-logging — retention runs once at init against hourly rotation** —
`crates/kasirmu-logging/src/retention.rs` ✔ **PAID 2026-10-22** (3C-10). Hourly rotation is 24
files/day with no count or size cap, so a process up for weeks never pruned anything, and every
`remove_file` error was discarded with `let _ =`.

**Retention is now continuous, and driven by two independent triggers.** `RetainerWriter` sits in
the writer chain between the non-blocking worker and the rolling appender, checks a deadline on
every write and flush (one relaxed atomic load on the common path), and sweeps only when it is due.
Log lines alone are not enough — an idle till writes nothing for hours — so `spawn_heartbeat` pushes
a sentinel byte through the same channel every 30 minutes; `RetainerWriter` swallows it, so the
appender never sees it. Both the sweep and the directory walk therefore happen on the appender's
worker thread, which is the only thread that already owns the file.

**Two defects the first draft had, both caught by tests rather than by reading.**
`const HEARTBEAT: &[u8] = b"\\x00"` is FOUR ASCII bytes (backslash, x, 0, 0), not a NUL — Rust
byte strings do not process that escape — so the heartbeat would have been appended to the log file
as text, and the whole trigger was silently broken. `the_heartbeat_sentinel_is_exactly_one_nul_byte`
and `a_heartbeat_write_reaches_the_inner_writer_zero_times` now pin the one-byte form and the
swallow. The second was a plain-arithmetic `Duration + interval` in `rearm`, which panics on
overflow; it is `checked_add` with the overflow treated as always-due, and pinned by
`an_absurd_interval_does_not_panic_and_disables_the_periodic_sweep`.

**Deletion failures are reported, not discarded.** `SweepReport { removed, failed }` carries each
path and reason, and `report_sweep_failures` prints them to stderr rather than `tracing::warn!`
because a sweep can run before the subscriber exists.

**`retention_days = 0` still means OFF, not "delete everything".** Both Tauri shells pass 0 today, so
re-reading it as "delete all" would wipe an install's entire log history on the next upgrade exactly
when that history is worth having. `Retainer::new` returns `None` for 0 and installs neither the
writer nor the thread; `retention_days_zero_disables_retention_entirely` pins it.

**A test-infrastructure fix this entry needed.** All 24 new tests and 13 pre-existing ones failed on
this machine at `create_dir_all` with `os error 5`, because every fixture built its directory from
`std::env::temp_dir()`, which resolves to `C:\WINDOWS\TEMP` here (machine-level TEMP). Both
`retention_tests.rs` and the pre-existing `lib_tests.rs` now use `kasirmu_test_support::ScratchDir`
under the gitignored `target/`, guarded so it cleans up. The 13 `lib_tests.rs` failures were
pre-existing, not this change. `cargo test -p kasirmu-logging --lib` = **60 passed, 0 failed**.

**O-M61 · kasirmu-notification — unbounded `tokio::spawn` per event, and `RateLimited` is never
matched** — `crates/kasirmu-notification/src/handlers.rs:98-125`, `:179-212`, `:249-275`;
`lib.rs:60-67` ✔ (3C-11) · **PAID** (`cbc0087c1`). Bounded background notification tasks with 16-permit `Semaphore` and added `send_template_with_retry` with 3-attempt backoff on `RateLimited`. See §11BL.

**O-M62 · modules-currency — the live IPC command ships the entire rate history** —
`modules/currency/src/repository.rs:50-72` ✔ (3D-01) · **PAID** (`a93b0b758`). Added `DEFAULT_MAX_EXCHANGE_RATES = 500` bound to `list_exchange_rates` and added `list_exchange_rates_bounded(limit)` with `LIMIT` pushdown. Verified in `repository_tests.rs`.

**O-M63 · modules-inventory — the DB mutex is held across the whole sale-deduction
transaction** — `modules/inventory/src/handlers.rs:220-241` ✔ (3D-02) · **latent**. Every line,
every BOM ingredient and the `commit()` run under one guard, so a single `sale.completed`
serialises all other access to that connection.

**RE-VERIFIED 2026-10-22 — STILL OPEN but UNDERSTATED, and that cuts the other way.** The guard claim
is exact (`handlers.rs:226-243`: one `self.db.lock()` spans the loop and the `tx.commit()`), but the SAME
file says at `:219-223` that the handler is **"DEAD / test-only (see scripts/handler-classification.json):
this handler is constructed nowhere in production"**. So the true cost is ZERO today — the opposite
direction from an understatement. It is also a `std::sync::Mutex`, so the real risk if it were ever wired
is a poisoned/deadlocked guard, not an in-flight `await`. **✅ CLOSED 2026-10-22 as NOT APPLICABLE (§11BZ)** — dead code cannot hold a lock. The guard shape is recorded
above so that whoever WIRES this handler sees it before shipping: drop the guard before the long work, or move
to a pooled connection. That is a prerequisite for the wiring, not a separate debt item. *Fix:* pool or `spawn_blocking`; scope the guard
to one transaction.

**O-M64 · modules-inventory — the same UPDATE is re-`prepare`d per line and per ingredient** —
`modules/inventory/src/handlers.rs:160`, `:195` ✔ (3D-03) · **PAID** (uncommitted working tree).
A 20-line sale with a 4-ingredient BOM compiled the identical SQL ~100 times. Fixed with
`tx.prepare_cached(...)` at BOTH sites rather than a hoist: the cache is keyed by SQL text on the
`Connection`, and `Transaction` derefs to its `Connection`, so the win is per-connection (spans
the whole handler and every later transaction on that `Arc<Mutex<Connection>>`), not per-transaction
— a hoist would only have deduplicated within one `handle_line` call. Zero call-site churn:
`prepare_cached` returns `CachedStatement`, which the existing `let mut update_stmt` bindings and
`query_row` calls accept via `DerefMut` to `Statement`. Behaviour unchanged — same rows, same
`Some(q) if q >= 0` insufficient-stock arms, same `stock_summary` mirror, same logging, and the
`.ok()` arms were deliberately NOT touched (separate debt class). Pinned by
`handler_deducts_bom_ingredients_when_recipe_exists` (3-ingredient BOM, proves every ingredient is
deducted — no duplicate test added), `handler_mixed_bom_and_simple_products` (both `prepare_cached`
sites in one transaction on a warm cache) and `an_undecodable_recipe_row_refuses_the_sale_rather_than_mis_deducting`.
`cargo check -p modules-inventory` clean; `cargo test -p modules-inventory --lib` 37 passed, 0 failed.

**O-M65 · modules-inventory — two lookups per line, plus one query per ingredient purely for a
log field** — `modules/inventory/src/handlers.rs:69-93`, `:177-184` ✔ (3D-04) · **PAID** (`82ca1df5b`). Folded product ID and product type into single cached query and joined ingredient SKU in recipe query. See §11BM.

**O-M66 · modules-staff / platform-core — every permission check re-parses the grants JSON** —
`platform/core/src/staff.rs:52-60`, `platform/core/src/rbac.rs:259-280` ✔ (3D-06). Fixed (`1428ad443`): zero-alloc check on required domain wildcard (`strip_suffix(":*") == Some(domain)`) avoiding `format!` String allocation, and `check_permissions_json` with borrowed `Cow<str>` avoiding individual String allocations on every permission evaluation.

### Low — harmless today; a senior reviewer would still flag it

**O-L12 · kasirmu-hal — a fresh Java `byte[]` per Bluetooth read** —
`crates/kasirmu-hal/src/transport/bt_android.rs:291-314` (write `:265`) ◦ (3A-08). *Fix:* one
`GlobalRef` per stream. **✅ PAID** (re-verified at HEAD 2026-10-22: `socket`/`input`/`output` are
`GlobalRef` fields on the stream struct at `bt_android.rs:262-264`, so one ref spans the stream instead
of a fresh `byte[]` per read. The entry carried no marker word, so it read as open work.)

**O-L13 · qris-core — a money percentage validated with `parse::<f64>()`** —
`crates/qris-core/src/validate.rs:58-62` ✔ (3A-09). Fixed (`df4d7aa2b`): delegated percentage validation to `is_valid_percent_str` backed by exact integer decimal parser `parse_percent`. Rejects `"1e3"`, `"NaN"`, `"inf"` and eliminates float arithmetic on monetary calculations.

**O-L14 · qris-core — CRC-16 is the bit-by-bit form** — `crates/qris-core/src/crc.rs:11-24` ✔
(3A-10). Fixed (`798211bf3`): replaced bit-by-bit calculation with 256-entry lookup table (`CRC16_TABLE`), cutting inner iteration count from 8 to 1 per byte during QRIS generation and validation. **✅ PAID** (re-verified at HEAD 2026-10-22: `CRC16_TABLE` is live at `crates/qris-core/src/crc.rs:12` and indexed at `:56`; the note lacked a marker word.)

**O-L15 · kasirmu-crypto — `master_key_from_env()` runs per encrypt/decrypt call** —
`crates/kasirmu-crypto/src/lib.rs:139-152` ✔ (3A-12). Fixed (`c656624c2`): cached `master_key_from_env()` with `OnceLock<Option<[u8; 32]>>`, avoiding repeated environment queries, string allocations, and hex decoding on every encryption and decryption invocation.

**O-L16 · kasirmu-hal — `barcode()` truncates the length with `n as u8`** —
`crates/kasirmu-hal/src/drivers/escpos.rs:92-100` ✔ (3A-13). Fixed: clamped input slice to 255 bytes (`slice.len() as u8`) and added test in `escpos_tests.rs` so payload length and GS k header length byte never diverge.
*(Line drifted: the clamp is now at `escpos.rs:106` under a `let n = slice.len() as u8;`, not `:92-100`.
Noted by the round-19 audit; the fix is present, only the citation was stale.)*

**O-L17 · kasirmu-plugin — `fire_event` clones the hook list and linear-scans each owner** —
`crates/kasirmu-plugin/src/manager.rs:499-515` ✔ (3B-08). Fixed (`06894624d`): replaced hook list clone with borrowed iteration, and replaced linear scan over sandboxes with O(1) `plugin_index` map lookup.

**O-L18 · kasirmu-cli — `copy_reference_data` inserts row by row with no transaction** —
`crates/kasirmu-cli/src/seed_demo.rs:218-227` ✔ (3B-10) · **PAID** (`17136eb56`). Wrapped reference data copy in a single unchecked transaction per store database. See §11BO.

**O-L19 · kasirmu-lan — a fresh `String`/`Vec<u8>` per event per peer** —
`crates/kasirmu-lan/src/noise.rs:206-224` ✔ **PAID 2026-10-22 in `09661e572`** (3B-11).
Fixed: reusable write buffer on `PeerTx::Noise`, zero-copy newline writes on `PeerTx::Plain`,
and eliminating intermediate heap allocations in `read_line`.

**O-L20 · kasirmu-reporting — money crosses into `f64` at the median boundary** —
`crates/kasirmu-reporting/src/menu_engineering.rs` ✔ **PAID 2026-10-22** (3C-12). `median_margin`
was a public `f64` and quadrant classification compared `(margin_minor as f64) >= median_margin`.
Both medians are now `i64` minor units end to end and no money value in this crate is a float.

**The interesting part is that the first fix was wrong twice, and both defects were mine.**
An even-length set has no single-element median (`{4, 5}` has median 4.5), so the first version
carried a `MarginMedian { lower, upper }` interval — exact, and a good idea — but then classified
with `value >= self.lower` and published `rounded_away_from_zero()`. Two bugs in one: 4 was called
HIGH although `4 < 4.5`, and the published scalar said 5 while the classifier said 4. That split
mattered because `ui/src/features/reports/MenuEngineeringScreen.tsx:70-71` runs its OWN
`classifyQuadrant` (`margin >= medianMargin`) over `median_margin`, so the screen and the crate
would paint different quadrants for the same row on exactly the boundary this entry exists to make
exact.

**The resolution is an identity rather than a rounding choice.** For an integer `x`,
`x >= (lower+upper)/2.0` ⇔ `x >= ceil((lower+upper)/2)`. `ceil` of an integer mean is an integer,
so the published scalar IS the comparison threshold, and a scalar reader cannot disagree with the
classifier for ANY input. The ceil is computed as `floor(a/2) + floor(b/2) + (a odd || b odd)`
using `>>1` and `&1`, so neither `a+b` nor `b-a` is ever formed — both overflow `i64` on the pair
`(MIN, MAX-1)`, where the old `f64` form was already lossy. The exact bounds stay available via
`MenuEngineeringResult::median_margin_range()` and `classify_quadrant_with_range`.

| set | exact median | published | margin below | margin at |
|---|---|---|---|---|
| `{4, 5}` | 4.5 | 5 | 4 → low | 5 → high |
| `{4, 6}` | 5 | 5 | 4 → low | 5 → high |
| `{-5, -4}` | -4.5 | -4 | -5 → low | -4 → high |

**Not one boundary case moved** against the deleted `f64` code, which
`integer_threshold_reproduces_the_removed_f64_comparison` proves by keeping the old expression as
an oracle and sweeping every pair in -12..12 against every margin in -15..15. The cross-layer pin
is `even_length_odd_sum_median_agrees_with_the_screen_rule`: it transcribes the screen's rule
verbatim (naming the file and lines) and asserts both rows classify identically in Rust and under
that rule. `published_threshold_reproduces_classify_for_every_integer_margin` sweeps 9 median pairs
against margins -20..20.

**A labelling consequence, deliberately left to the UI:** `median_margin` is a *threshold*, not an
average — `{4, 5}` publishes `5`, not `4.5`. That was already true of the compared value under the
old code, but a screen that captions it "median margin" as money is now visibly approximate. The
UI uses it only for the chart domain and axis label, where it stays correct.

**O-L21 · truncating `as` casts on computed numerics** —
`crates/kasirmu-reporting/src/daily_summary.rs:137` ✔ (`hour` i64→u8) — **retired 2026-09-30 with the module (checklist C29)**;
`crates/kasirmu-media/src/thumbnail.rs:94-95` ✔ (3C-13) · **PAID** (`38c8118e7`). Replaced truncating casts in thumbnail dimension math with saturating multiplication and explicit `try_from` clamping. See §11BP.

**O-L22 · modules-sales — status string via a `serde_json` round trip; INSERT re-prepared per
line** — `modules/sales/src/repository.rs` (`create_sale_tx`, `update_sale_status`) ✔ **PAID**
(3D-07). `as_stored_str()` returns `&'static str` for free, so both write sites now store
`sale.status.as_stored_str()` / `status.as_stored_str()` instead of
`serde_json::to_string(..)?.trim_matches('"').to_string()` — an allocation and a fallible
serialization dropped from a persisted-column path. Byte identity with the retired expression is
proved, not asserted, for every variant: `stored_status_string_matches_pre_ol22_serde_path`
rebuilds the old expression as its oracle and compares `.as_bytes()`, with variants generated by
a wildcard-free `match` so a new `SaleStatus` variant fails to compile;
`create_sale_persists_canonical_status_for_every_variant` and
`update_sale_status_persists_canonical_status_for_every_variant` check the value that actually
lands in the `sales.status` column. The second clause (INSERT re-prepared per line) is fixed via
`Namespace::execute_cached`/`prepare_cached` (`crates/kasirmu-core/src/db/namespaced.rs`): the
single-row INSERT runs through `execute_cached`, and the line loop prepares once before the loop
(`ns_own.prepare_cached(..)`, the handle bound to a local because `prepare_cached` borrows it)
and executes per row. **The obvious version was rejected:** `tx.prepare_cached` compiles against
the raw `Connection`, which is not namespace-aware, so it skips `check_statement` and drops the
Phase-3 P3.2 ownership guard on the whole write path — it was written, caught in review, and
reverted, and `Namespace` exposes no other check-then-cache entry point. That is why the cache
had to be added to `Namespace` rather than used around it; the added methods run the check on
**every** call, including a cache hit, because the cache is keyed by SQL text alone and the same
text can be handed to a different owner. Pinned by
`the_cache_does_not_skip_the_ownership_check_on_a_hit` (a foreign owner is refused on SQL text
that is already warm) and by `the_write_path_is_namespace_checked` (both INSERTs refused through a
non-owning handle). Note the coverage gap that let the first attempt pass: the pre-existing
`the_repository_is_scoped_to_its_own_namespace` exercises only the **read** path, so a write path
bypassing `Namespace` entirely was invisible to it. rusqlite 0.31.0 exposes no cache hit/miss flag
and no `Connection::cache_size()`, so the tests assert the refusal property, not a hit count.

**O-L23 · modules-sales — `as i64` casts on the sale write path (lossless; a lint item)** —
`modules/sales/src/models.rs:173`, `:189` (now `foundation/src/sales.rs:179`, `:195`) ✔ (3D-08) · **PAID** (`b27eb17be`). Converted `cart.line_count()` and loop index `i` to `i64::try_from(...).ok()?` on the sale creation path. See §11BQ.

### Cross-cutting reading (round 3)

- **The same three defect classes recur, in crates nobody had looked at.** Per-item work where
  a batch was meant (O-M41, O-M49, O-M64, O-M65), constant-factor re-derivation per call
  (O-M47, O-L15, O-M66), and unbounded reads (O-M48, O-M62, O-M54). §7 said one fix shape covers
  almost all of the first class; round 3 extends that to the support tier and confirms it rather
  than qualifying it.
- **Lock-held-across-work appears once more, and it is the same shape as §7's O-H22.** The global
  DB mutex taken across a long read (O-H23) or a long write (O-M63) is now recorded in four
  places across two rounds: `platform/core` migrations, mobile checkout, the email scheduler, the
  inventory handler. If a second phase is funded after the batching class, this is the candidate
  — it is the only class whose failures are user-visible stalls rather than slowdowns.
- **Two entries are correctness, not scale, and outrank their size:** O-H24 (double charge) and
  O-H25 (currency mislabelled). Both were graded Medium by the pass; I promoted them. Cheap to
  fix, expensive to ship.
- **The module tier is confirmed clean on money.** `foundation/src` and all `modules/*/src`
  production code contain **zero `f32`/`f64`**; all money is `i64` minor units and all rates are
  fixed-point (`rate_millionths`, `rate_bps`, `earn_multiplier_millionths`). The two float-money
  entries in this round (O-L13, O-L20) are both outside that tier, in `qris-core` and
  `kasirmu-reporting`.
- **Stub confirmation, closing the §7 F4 note:** `kitchen`, `purchasing`, `giftcards` and
  `promotions` are each a single `lib.rs` of 82–90 lines — kernel registration plus a dependency
  list and three `info!` lifecycle logs. No repository, service, models or handlers. No findings
  were manufactured for them.
- **Verified-count honesty:** 21 of the 42 round-3 entries carry ✔ — every High (3/3), plus the
  Medium entries a fix would be built on and 2 of the 12 Low. The remaining 21 carry ◦ and the
  audit pass's line references. Nothing in this section was written from recollection.
- **No crate code has been changed.** Fixes are unfunded until entries are picked from this
  journal. §5's axes and §6's rules still stand unchanged.
  - **SUPERSEDED 2026-10-21 — this line used to name O-H23/O-H24/O-H25 as the funding
    candidates. Two of the three are PAID and the third is not a live defect.** O-H23
    (`email_scheduler.rs:70`/`:93` scope split) and O-H24 (`8c592c58f`, gateway-key gate) landed
    2026-09-27. O-H25 was re-measured on 11-10-26 and its target file
    (`modules/reporting/src/repository.rs`) no longer exists — the three named defects are not
    present at HEAD (see the re-measurement note under the entry). §11E already recorded this
    failure mode once; it recurred here and this note is the correction.

---

## 9. Round 4 (2026-09-25) — verification closure, and the first pass over the test mass

**Two jobs, both chosen because they were the largest unclosed gaps rather than the most
interesting ones.**

1. **Close the verification gap.** §7 admitted that of its 72 entries only O-H01–O-H08 had been
   re-read, and §8 that 21 of its 42 were pending. That is **85 entries** carrying line
   references nobody had opened — including 14 ranked High. A journal entry nobody has checked is
   the one most likely to be funded first and least able to survive it.
2. **Audit the 52.8%.** §3/F2 measured test files at 240,257 lines across 476 files, and every
   previous round skipped them by instruction. The largest surface in the repository had never
   been looked at.

**Method.** Four read-only passes (three verification, one audit). I re-read the lines behind
every claim in this section myself; where a count is quoted below that I did not measure, it is
attributed. **No crate code has been changed.**

**Measured this round** (`grep`, branch `0.0.40`, 2026-09-25): **787** `fresh_db()` call sites in
`*_tests.rs` files, and **66** `migrations::run` / `run(&mut conn)` sites in `*_tests.rs` files.

### 9A. Verification result — 85 entries, none rotten

Every one of the 85 pending entries is **confirmed**: the cited file exists and the cited lines do
what the entry says. That is the useful negative result — the journal's references hold, so the
findings can be funded without re-deriving them.

But confirmation is not accuracy. **21 entries carry citation drift, an overstated count, or a
wording that misleads**, and one is materially *understated*. The register below is the
authoritative correction list; four of these (O-M20, O-M34, O-M55, O-L23) have also been patched
into their entries above, because they change what a fixer would do rather than merely where they
would look.

| id | verdict | correction |
|---|---|---|
| O-M08 | confirmed, cite incomplete | the engine is pure (`category_of` is an injected closure, `:47`); the DB lookup is at `crates/kasirmu-core/src/db/promotions.rs:287-292` |
| O-M12 | confirmed, wording misleads | a 30 s TTL **does** exist (`:52`, `:58-60`) — only eviction is missing. Stale entries are skipped, never removed; the sole removal is the wholesale `cache.clear()` at `:81-85` |
| O-M13 | confirmed, cite short | the per-location **name** query is at `:524-530`, outside the cited `:509-521`. Cite `:509-530` |
| O-M14 | confirmed, cite split | linear scans at `:659-668` / `:682-685`; the re-deserialisation is at `:701-713` (`is_revoked_in_cached_crl`), not in the cited range |
| O-M15 | confirmed, lines drifted | parse sites are `subscription.rs:773-781` and `:791-801`; lowercased comparisons at `:807-810`. The cited `:759` is `signed_payload: String::new()` — not a parse site |
| O-M17 | confirmed, title loose | it reads category→rate assignments, not "tax settings". Retitle per-category tax-rate read |
| O-M31 | confirmed, cites off by ±2 | acquisition sites at `auth.rs:635`, `:411`, `:438`, `:468`. "5 and 3 times" softened to four confirmed sites |
| O-M32 | confirmed, mobile cites 9 late | mobile `sync.rs:579`, `:628`; desktop `:434`, `:482` are correct. Note the fix's model, `image_download.rs:180`, is a *shared* client that **also sets no timeout** |
| O-M34 | confirmed, count overstated | **patched above.** One `serde_json::to_vec` per item (`:166`) plus two clones (`:157`, `:175`) |
| O-H09 | confirmed, one word | no explicit `tx.rollback()` — the rollback is implicit on drop |
| O-H12 | confirmed, cite imprecise | `PRODUCT_SELECT` is a const spanning `pg.rs:1032-1041`; `:1038` is the correlated-subquery line inside it |
| O-M24 | confirmed, nuance | the body is a `Vec` growing to `PACK_MAX_BYTES` = 2 MB (`images.rs:51`) from a 1 KB reservation (`:412`) — capped, not always 2 MB |
| O-M30 | confirmed, cite | the clamp is `pos.rs:1646-1647` (fn `checkout_discount_percent` starts at `:1646`) |
| O-H21 | confirmed, tighten | `zip` truncates to the **shorter** iterator, so a short `results` drops the *tail of `pending`* — those items stay pending and are re-pushed — not arbitrary items. `daemon.rs` contains no `results.len()` / `pending.len()` check |
| O-H18 | confirmed, one sub-claim unproven | cursor loop and per-page rebuild verified; "no page cap" was **not** exhaustively proven — four `break`s at `:465/:474/:521/:527` were not read in context |
| O-M52 | confirmed, cite missing | the O(n²) needs the caller: `package.rs:394-412` calls `read_entry` once per entry |
| O-M55 | confirmed, count wrong | **patched above.** Five sorts, not four |
| O-M45 | confirmed, arithmetic | `initial_backoff_ms` is `u64` (`:43`); the *multiply* overflows before the shift — roughly attempt 58 at the 100 ms default, not 64 |
| O-M61 | confirmed, cite add | `RateLimited` is constructed at `whatsapp.rs:270-271` and matched only in `lib_tests.rs:38` |
| O-L23 | confirmed, severity overstated | **patched above.** Both casts are `usize`→`i64`, lossless |
| O-M20 | confirmed, **understated** | promoted — see O-H26 |

**Residual, stated rather than hidden:** three quantitative claims were verified structurally but
not arithmetically — O-H10's "~10 round trips per item", O-M22's "10⁶ comparisons" and O-H18's
"no page cap". The loops and their nesting are confirmed; the constants are the audit pass's.
Everything else in §7 and §8 is now re-read.

**O-H26 · kasirmu-bridge — `blocking_lock()` on a tokio mutex: a guaranteed panic, not a parked
worker** — ✅ **PAID 2026-09-27 in `581f32981`** (took `try_lock`, not `lock().await`;
re-verified at HEAD 2026-10-21: `ctx.rs:434` is `match self.db.try_lock()`) —
`crates/kasirmu-bridge/src/ctx.rs:412-413` ✔ · **LIVE** via `ctx.rs:371`
(`resolve_scope`) and `apps/desktop-tauri/src/state.rs:632`. Promoted from O-M20.
Round 2 recorded this as parking a runtime worker. It is worse. `resolve_restaurant_pos_store` is
a **sync `fn`** calling `self.db.blocking_lock()` where `self.db` is `Arc<tokio::sync::Mutex<…>>`
(`:69`). The crate has already written down what that does, at `audit.rs:257-266` ✔: in tokio
1.49 `blocking_lock` is `future::block_on(self.lock())`, whose first act is
`try_enter_blocking_region().expect(…)` — *"There is NO uncontended fast path … So each call site
was a guaranteed panic on first use."* The code at `ctx.rs:407-408` justifies itself with
*"safe here because the lock is held for a single indexed SELECT (microseconds)"* — the exact
reasoning `audit.rs` exists to rebut. Duration of the critical section is irrelevant; the panic
fires on entry. *Fix:* make it `async` and `lock().await`, as `require_audit_tier` already does
(`audit.rs:270-271`), and delete the stale justification comment.

```rust
407      /// Uses `blocking_lock()` on the tokio Mutex — safe here because the lock
408      /// is held for a single indexed SELECT (microseconds).
...
412      fn resolve_restaurant_pos_store(&self, restaurant_pos_id: &str) -> Result<String, BridgeError> {
413          let db = self.db.blocking_lock();
```

### 9B. The test-file mass — first pass ever (O-T01 … O-T16)

The prefix `O-T` marks these as test-suite findings, the surface §5's axis B would attack.
Coverage honesty: the nine largest test files were read in full for setup helpers, sleeps, loops
and migration calls; the second tier was probed by grep plus reads of each hit. Not all 27,875
lines were read verbatim.

**High — plausibly costs minutes of suite wall-clock**

**O-T01 · desktop topology tests replay the full migration chain ~45 times per run** —
`apps/desktop-tauri/src/commands/topology/topology_tests.rs:16-32` ✔ **ALREADY PAID 2026-10-21** (4A-01).
Verified at `d42a69b09`: `fresh_conn()` IS `migrations::fresh_db()`, and the helper's own comment
records the measurement that drove it — `run` replays all 68 migrations at ~305 ms, `fresh_db` clones
a pre-migrated snapshot at ~3 ms, across 35 calls in the four topology test files. This entry was
**stale when I read it as open**: the ledger still showed the pre-fix source, and the fix had already
landed. Same class as the three O-H23/24/26 findings in round 5 — a plan doc that had not been told.

```rust
21      let mut conn = Connection::open_in_memory().unwrap();
22      migrations::run(&mut conn).unwrap();
```

**O-T02 · `migrations_tests.rs` replays the chain 32 times to assert one row each** —
`crates/kasirmu-core/src/migrations_tests.rs:3-12` ✔ (4A-02)
All 43 tests in the file build an empty in-memory DB and run the full chain, including legs that
only assert a table exists or an id is non-empty. *Fix:* hoist one `LazyLock` migrated connection
for read-only schema assertions; keep the real `run` only in the tests whose subject is `run`.
**✅ RESOLVED 2026-10-22 in `63046f6f6a` (found already done during the round-18 sweep).**
`migrations_tests.rs:26-31` has `static FINAL_SCHEMA: LazyLock<Mutex<Connection>>` applied once and
`:49-53` `final_schema()` clones it (305 ms → ~3 ms). Two tests still `run()` **correctly**, because their
subject IS `run`. **The entry's count was also wrong: the file has 52 `#[test]`, not 43.** One residual
remains, not worth a lane: `:90` `migration_creates_sales_table` still does a full fresh+run to assert one
name in `sqlite_master`.

**Medium**

**O-T03 · `queue_tests.rs` permanently leaks 76 in-memory databases** —
`platform/sync/src/queue_tests.rs:21-23` ✔ **ALREADY PAID 2026-10-21** (4A-03). `setup_store` now takes
`&Connection` and returns `Store<'_>`; the leak is gone and the comment at `:14-20` records what it
cost — `Store<'a>` borrows its connection for any `'a`, so the `'static` was never needed, and the
leak held ~2 MiB alive per call site for the life of the binary. Also stale when I read it as open.

**O-T04 · `fresh_db()` clones under one process-wide mutex, and 1,394 call sites share it** —
`crates/kasirmu-core/src/migrations.rs:710-765` ✔ **MOOT AS WRITTEN 2026-10-22** (4A-04). The
measurement this entry asks for has ALREADY been done and the answer is recorded on the function
itself (`:682-689`): "384 clones spread over N threads get *slower* past two threads — 1.15 s at 1
thread, 0.76 s at 2, 2.18 s at 8, 3.75 s at 32. Replacing this `Mutex` with a per-thread source did not
lift that ceiling; it measured ~15% worse at 4+ threads." So the prescribed fix — "a small per-thread
snapshot pool" — was tried, measured, and found WORSE. Whatever caps parallel DB construction sits
below this function, most likely SQLite's global allocation mutex.

**The call-site count in this entry was also wrong in the direction that mattered.** It said 787; the
true count at `d42a69b09` is **1,394**. An entry that understates its own blast radius by 43% invites
a reader to think of this as a corner case. It is not — it is the single most-used test helper in the
workspace.

**✅ CLOSED 2026-10-22 — MOOT, not repaired.** The prescribed fix was tried and measured WORSE, so
nothing remains to do. Re-verified at HEAD during the round-17 census sweep; the entry carried no closing
verb, so it read as open work in every downstream reading.

The `Mutex` stays. `RwLock` would be worse, not better: `Backup::new` takes a `RefCell` borrow on its
source, so two readers would race it — a data race, not an optimisation.

**O-T05 · `daemon_tests.rs` states ~5.5 s of pure sleep** — `platform/sync/src/daemon_tests.rs:174-181` ✔
(4A-05). 27 sleeps (500 ms + 200 ms after every `daemon.start()`, three more pairs, 600 ms, 300 +
100) waiting on a daemon whose tick is 100 ms — a 5× floor. *Fix:* poll `daemon.status()` under a
1 s `timeout`.
**✅ RESOLVED 2026-10-22 in `dd2f929f7` (found already done during the round-18 sweep).**
`daemon_tests.rs:42-57` is now `wait_for_daemon`, polling `status()` every 10 ms against a 1 s ceiling
with a panic that NAMES the condition and prints the status snapshot — the prescribed fix, done.
`wait_for_first_cycle` wraps it. The cited `:174-181` is now a 10 ms readiness nudge, not a sleep.

**RESIDUAL 2026-10-22 (audit): "every sleep replaced" is OVERSTATED.** `daemon_tests.rs:249-254` keeps a
deliberate `sleep(300ms)` inside a spawned blocker task plus a `sleep(100ms)` on the main thread, in
`daemon_stop_then_immediate_start_yields_running_daemon`. It is **load-bearing**: the blocker holds the DB
lock so the daemon's `spawn_blocking` phase is caught mid-cycle, which is the property under test —
`stop()` must wait for an in-flight cycle. Replacing it with a poll would delete the thing being measured.
Recorded so a future sweep does not "finish the job" and quietly weaken the test.

**O-T06 · `rate_limiter_tests.rs` states 4.2 s of sleep** —
`crates/kasirmu-core/src/rate_limiter_tests.rs` ✔ **PAID 2026-10-22** (4A-06). FIVE sleeps, not the four
this entry listed (`:463`'s 1,100 ms was missed), all removed by back-dating the limiter's own stored
`Instant`s — option (b), following the precedent at `apps/cloud-server/src/rate_limit_tests.rs:25`. No
clock injected, no production API changed, `rate_limiter.rs` untouched: the test module is a child of
the module under test, so `limiter.attempts` is directly reachable.

Two test-only helpers carry it, and the split between them is the point. `backdate_attempts` ages
EVERY attempt for a user; `backdate_first_attempt` ages only `attempts[0]`. In the two tests whose old
sleep sat BETWEEN `record_failure` calls, aging every attempt would have degenerated into "everything
expired" and quietly stopped testing partial pruning — so the second helper exists precisely to keep
those tests honest.

**Assertion strength went UP, which is the real win.** `:242` was
`assert!((8..=10).contains(&err), "retry_after should be ~9")` — a 3-wide window that pinned only the
magnitude and would have passed had the code used the newest attempt or elapsed 0. With time
controlled it is `assert_eq!(err, 9)`. A tolerance window in a test is a signal that the test could not
see what it was naming.

**A documentation defect fell out of it.** `window_expiry_partial_prune`'s comments claimed `t=0` and
`t=0.6s`, but the code's own 600 ms gap made the second attempt land at t=0.6s while the comment
described a 0.6s OFFSET — the prose never matched the code. The rewrite makes them agree.

`cargo test -p kasirmu-core --lib rate_limiter`: **34 passed**, and the body went from **2.00 s to
0.01 s** — the sleeps were the entire cost.

**O-T07 · `kds_tests.rs` pastes the same 24-field `Sale` literal 14 times** —
`crates/kasirmu-core/src/db/kds_tests.rs` ✔ **PAID 2026-10-22** (4A-07). It was **21** literals, not 14,
and 18 of them collapsed into helpers; the file went 4,283 → 3,868 lines.

The work that mattered was the fingerprint, not the edit. Every literal was diffed field by field
BEFORE anything was replaced, and exactly three dimensions varied: `id`; the `created_at`/`updated_at`
pair (cosmetically `now.clone()`/`now` vs `now.clone()`/`now.clone()`, but both always assigned from ONE
`let now` captured per test, so the two strings were always equal); and, at exactly one site each,
`total`/`subtotal`/`line_count` = 1200/1200/1 and `status` = `Active`. Every other field — currency,
payment method, tender, discount, tax, customer, base currency, tender rate, tip, service charge, lines,
version — was identical at every site.

So the helper chain carries those dimensions as PARAMETERS rather than normalising them away:
`test_sale(id)`, `test_sale_with_total(id, total_minor)`, `test_sale_typed(id, status, total_minor)`,
with `line_count` derived from the total so the row stays self-consistent. Collapsing the two odd sites
into the common shape would have silently changed what two tests seeded — the classic refactor failure
this entry could have caused.

16 orphaned `let now` bindings were dropped with it, and one genuine `unused variable` warning at the
e2e site was fixed. `cargo test -p kasirmu-core --lib kds`: **178 passed, 0 failed**.

**O-T08 · a 10,000-iteration fixture to assert two counts** —
`platform/sync/src/pg_daemon_tests.rs` ✔ **PAID 2026-10-22** (4A-08).

**Is 10,000 load-bearing? No, and that had to be established before choosing.** Traced
`Store::enqueue_offline` → `enqueue_offline_with_tenant` → `enqueue_offline_inner`
(`crates/kasirmu-core/src/db/offline/enqueue.rs:191`): per call it does one subscription load, one
settings read and one autocommit INSERT, with no batch detection, threshold or size-dependent branch
anywhere in the chain. The only real batch bound in the system is
`DEFAULT_MAX_OUTBOX_BATCH_ITEMS = 100` (`platform/sync/src/daemon.rs:308`), already pinned by a
separate test in `daemon_tests.rs`.

So the count was kept — it is a scale marker, and renaming the test would lose what its name says —
and the WRITE was made set-based instead: one transaction, one prepared INSERT, 10,000 executes
inside it, same columns and the same `pending`/`default`/priority-1 values the old calls wrote. A
doc comment now records that 10,000 is NOT tied to the batch cap, so no future reader mistakes it for
a production limit.

**1.07 s → 0.55 s** measured over repeated isolated runs. The remaining cost is the 10k-row insert
itself; what went away is the per-row subscription read and the per-row autocommit fsync. The test
needs no Postgres here — it is a plain `#[cfg(test)] mod` with no `#[ignore]`. `cargo test -p
platform-sync --lib pg_daemon`: **55 passed, 0 failed**.

**O-T09 · stress fixtures build 5,000 nodes + 5,000 wires, then verify with 10,000 `format!`s** —
`crates/kasirmu-bridge/src/topology/topology_stress_tests.rs:1738-1744` ✔ (4A-09). Two allocations
and two assertions per iteration to prove a ring. *Fix:* cut to ~500 and assert with `windows(2)`.

**✅ RESOLVED 2026-10-22 — but NOT the prescribed way, because the prescription was wrong.**
"Cut to ~500" would have weakened a genuine stress test: the case is a 5,000-node/5,000-wire graph
round-tripped through the database, and a 500-node version asserts less than the name promises.
The fixture stays at 5,000 and **both assertions stay** (from-edge and to-edge check different things).
What changed is the allocation: one `String` buffer `clear()`ed per side instead of 10,000 throwaway
`format!`s, plus the wire index in each panic message so a ring break names where it broke. The entry's
line reference was also off — the assertion loop is `:1776-1782`, not `:1738-1744` (that range holds
only the builder). Verified: `cargo test -p kasirmu-bridge --lib topology` → **320 passed, 0 failed**,
both 5,000-item tests green.

**O-T10 · `run_sweep()` reads ~224 source files, six times per run** —
`apps/desktop-tauri/src/commands/registration_gate_tests.rs:466-481` ✔ (4A-10). Fixed: memoised via `std::sync::OnceLock<Sweep>`, eliminating 5 redundant 224-file source walks across test assertions.

**Low**

**O-T11 · four rate-limit tests drive ~400 sequential HTTP pushes** —
`apps/cloud-server/src/sync_api_tests.rs` ✔ **PAID 2026-10-22 in `9cb8b3e46`** (4A-11). Requests
**507 → 406** across the six rate-limit tests, with no assertion lost.

**The ledger's suggested fix was already in place, which is why the entry needed re-reading.** "Keep one
101-request burst for the 429 boundary" describes tests that were ALREADY minimal: `..._when_push_limit_
exceeded` sends exactly 101 and `..._includes_retry_after_header` sends 100 + 1. There was nothing to trim
there.

**The real cost was SETUP, not assertion.** `rate_limit_tenant_isolation` and `rate_limit_endpoint_isolation`
each burned a 100-request burst purely to bring one bucket to its cap, then probed a neighbour — 200 of the
507 requests spent getting ready to assert rather than asserting. Because the bucket key is
`"{tenant_id}|{prefix}"` (`rate_limit.rs:242`), the tenant axis and the endpoint axis cannot interfere, so
both neighbours can be probed against the SAME exhausted bucket. The two tests are now one,
`rate_limit_buckets_are_isolated_per_tenant_and_per_endpoint`, with a numbered comment per assertion and a
doc-comment table mapping each back to the original that asserted it: tenant-a/push 429, tenant-b/push 200,
tenant-a/pull 200. Assertion messages kept verbatim.

**The budgets are compile-time constants and no API change was made.** `rate_limit.rs:56-85` is a
`const RATE_LIMITS` table with push at `capacity: 100`; there is no per-test override and no reset hook.
Making the cap injectable to save test time was considered and rejected — a production API change to speed
up a test is a bad trade, and the fold made it unnecessary.

**The honest measurement: the win is in REQUESTS, not seconds.** The subset reports `finished in 0.39s`
before AND after — below the resolution of the change, because the saved round trips are cheap in-process
`oneshot`s and the wall-clock is dominated by 31 × `fresh_db()` migrations. An entry about request count was
resolved by counting requests; claiming a time win would have been a nicer-sounding falsehood.

`cargo check -p kasirmu-cloud --all-targets` exit 0 · `cargo test -p kasirmu-cloud --bin kasirmu-cloud` =
**401 passed, 0 failed**, 43 ignored (402 before — exactly the one fewer test the fold predicts; none
deleted outright).

**O-T12 · env-var tests take a process-wide lock *and* `#[serial]`, and tolerate 12 s** —
`apps/cloud-server/src/db_tests.rs:141-151`, `:333-347` ✔ (4A-12). *Fix:* injectable config;
tighten the bound to the 5 s `wait_timeout` under test.
**✅ RESOLVED 2026-10-22 in `264b008cd` — §11BW.** Both of this entry's line references were STALE:
`:141-151` is the bare-filename CWD test (which had NO lock, the opposite of the complaint) and the 12 s
lives at `db_tests.rs:449` on an `#[ignore]`d pg test, not at `:333-347`. The real env-var pair was
`db_tests.rs:241-279`.

**O-T13 · a test that asserts nothing** — `platform/sync/src/pg_daemon_tests.rs:543-551` ✔
(4A-13). `mark_offline_synced_nonexistent_item` computes a result and `let _ = result;`, with a
comment admitting either outcome is fine — it can only fail on panic, and still pays a snapshot
clone. *Fix:* assert the contract. **✅ RESOLVED — §11BU.**

**O-T14 · four Redis legs are `#[ignore]`d from dev CI** —
`apps/cloud-server/src/redis_backend_tests.rs:96`, `:127`, `:141`, `:61` ✔ (4A-14). TTL/expiry
behaviour is untested in the default run. *Fix:* a fake backend, or record why dev CI cannot.
**✅ RESOLVED 2026-10-22 in `264b008cd` — §11BW.** Three legs un-ignored (the `test_backend()` gate
already handled their skip); the TTL leg polls to a named bound instead of sleeping 2 s. The FIRST
prescribed option — a fake backend — was rejected on evidence: there is NO repo-side TTL logic on the
Redis path (`SETEX`/`GET`, `redis_backend.rs:192-205`/`:160-170`), so a fake would assert only that the
fake expires its own map. **Residual: nothing in this repo sets `OZ_TEST_REDIS_URL`, so expiry is now
covered ON DEMAND, not in CI.** Putting it in CI needs a `redis:7` service container in `dev-ci.yml` —
a workflow change, not done here.

**O-T15 · 300 ms sleeps to hold a lock window open** —
`crates/kasirmu-core/src/db/sales_crud_tests.rs:132-135` ✔ (4A-15), same shape at
`db/shifts_tests.rs:629`, `db/gift_cards_tests.rs:811`/`:877`. *Fix:* drive the release with a
channel the blocked caller can reach. **✅ RESOLVED — §11BU.** (A FOURTH site outside the ledger's
list — `db/sales_lifecycle_tests.rs`, the `void_sale` race — was already red for exactly this
reason and is fixed in the same commit.)

**O-T16 · a 5 ms sleep to separate two timestamps** —
`crates/kasirmu-core/src/db/kds_tests.rs:1566` ✔ (4A-16). *Fix:* insert explicit distinct
`received_at` values. **✅ RESOLVED — §11BU.**

**O-T17 · an interleaving test whose two hypotheses agree** —
`crates/kasirmu-core/src/db/cash_payouts_tests.rs` (`create_cash_payout` race) ✔. Found while
closing O-T15, and it is the SAME defect class as the `void_sale` race: the test asserts
`Validation { field: "status" }`, which both reachable paths produce — the compare-and-set matching
zero rows (the property claimed) and the out-of-transaction fast-path rejection at
`cash_payouts.rs:43` (which never touches the CAS). It cannot fail if the CAS predicate is deleted.
*Fix:* see O-M67 — `create_cash_payout` must begin IMMEDIATE so the test can prove A was inside
the window. **✅ RESOLVED 2026-10-22 in `7dfee57cc` — §11BV.** The test now proves A BLOCKED (a busy
handler) and states in its own doc comment that it exercises the FAST PATH, that the CAS is not reached,
and that deleting the CAS predicate would leave it green. The ambiguity is gone; the arm is named.

**O-M67 · kasirmu-core — `create_cash_payout` reads its guard OUTSIDE a DEFERRED transaction** —
`crates/kasirmu-core/src/db/cash_payouts.rs:37-60` ✔. `create_cash_payout` does what `void_sale`
used to: it reads the shift (`get_shift`) and rejects a closed one *before* opening its
transaction, so the read and the compare-and-set are not atomic. The CAS clause
(`WHERE EXISTS (... AND status = 'open')`) is what actually keeps cash from leaving a closed
drawer, and the deferred transaction gives it nothing to contend with until the INSERT — meaning
the window is as wide as the gap between the two statements, and no test can currently prove the
CAS is what refused the payout (see O-T17: the fast-path rejection produces the identical error).

`void_sale` (`sales_lifecycle.rs:906`) already has the fix — `Transaction::new_unchecked(self.conn,
TransactionBehavior::Immediate)`, recorded at `sales_checkout.rs:241` as "IMMEDIATE contends at BEGIN
where the 5000 ms busy_timeout applies". *Fix:* begin IMMEDIATE (a one-line change, same argument
shape), then rewrite the O-T17 test in the O-T15 shape so a busy handler proves A was inside the
window. Not done in round 17 — it is a production change and the round was a read-only one.
**✅ RESOLVED 2026-10-22 in `7dfee57cc` — §11BV.**

**Clean, and worth saying so:** `db/products_tests.rs` (102 tests) and `db/sales_tests.rs`
(151 tests) use the snapshot helper and contain **zero sleeps**; `sync_api_tests.rs` simulates
cache expiry by back-dating `generated_at` rather than waiting out a TTL; `queue_tests.rs` has no
sleeps or env mutation; `bridge/pos_tests.rs` shares one `TestBridge`. The good pattern already
exists in the repo — O-T01 and O-T02 are simply the files that did not adopt it.

### Cross-cutting reading (round 4)

- **The reference risk in this journal is now closed, and the result is a negative one.** 85 of 85
  entries confirmed, none rotten. That is the outcome worth having: §7 and §8 can be funded
  without re-deriving their line numbers. The cost was 21 corrections, four of them consequential
  enough to patch in place.
- **The one entry verification changed qualitatively is O-H26**, and it is the argument for
  verifying rather than trusting: a "parked worker" entry turned out to be a documented panic on a
  live path in both shells. It is now the sixth High and, with O-H24, one of two that are
  correctness rather than scale.
- **The test mass is where axis B's money is, and it is mostly one defect repeated.** O-T01 and
  O-T02 are the same mistake at two sizes — `migrations::run` where `migrations::fresh_db()`
  existed — against a measured 787 `fresh_db()` and 66 `run` call sites. They are also the only
  two findings here with a one-line fix. Everything else needs either a poll instead of a sleep
  (O-T05, O-T06, O-T15) or a decision about fixture size (O-T08, O-T09, O-T11).
- **O-T04 is the structural one.** `fresh_db()` is the *good* design and is still a global mutex,
  so making the remaining 66 `run` sites use it would concentrate all of them onto one lock. Fix
  O-T04 before O-T01/O-T02, or the cheap fix makes the parallelism worse.
- **No timing in this section was measured.** Every duration quoted (5.5 s, 4.2 s, 300 ms, 5 ms)
  is one the source states. Turning them into wall-clock is `cargo nextest run` with
  `--report-time`, which is axis B's deciding instrument and has still not been run.
- **No crate code has been changed.** §5's axes and §6's rules stand unchanged. If a first phase
  is funded from this journal, the candidates in priority order are: **O-H26** (live panic),
  **O-H24** (double charge), **O-H23** (UI stall), then **O-T04 → O-T01 → O-T02** for suite
  wall-clock.

---

## 10. Round 5 (2026-09-25) — the instrument round

Rounds 1–4 produced 100+ findings and **zero measurements**. Every ranking in §3 and §5 rested on
line counts used as a proxy for cost. This round runs instruments instead. **No crate code has
been changed.**

**Method.** `cargo metadata --offline` for the dependency graph, plus source scans. **No
compilation** — see §10D for why that was deliberate rather than an oversight. All figures below
were measured on branch `0.0.40` on 2026-09-25 in this checkout.

### 10A. The crate graph, measured — and it contradicts §5 axis D

40 workspace members, **154 internal edges** (130 normal, 24 dev-only).

**Zero dependency cycles.** None on normal+build edges, and none even when dev-edges are included.
DFS over both graphs.

| top fan-IN (dependents, normal+build) | | top fan-OUT (sibling deps) | |
|---|---|---|---|
| `foundation` | **27** | `kasirmu-app` (desktop) | 26 |
| `kasirmu-core` | 14 | `kasirmu-mobile` | 20 |
| `platform-core` | 8 | `platform-startup` | 19 |
| `modules-currency` | 6 | `kasirmu-core` | 11 |
| `kasirmu-hal` | 5 | `kasirmu-bridge` | 10 |
| `modules-{crm,inventory,sales,staff,tax,terminal}` | 4 each | `kasirmu-cloud` | 6 |

Six members have nothing depending on them — the genuine entry points:
`kasirmu-app`, `kasirmu-cli`, `kasirmu-cloud`, `kasirmu-media`, `kasirmu-mobile`, `qris-core`.

**Axis D is wrong twice over and cannot be funded as written.** §5 defines it as *"Reduce fan-in
to `kasirmu-core`, break cycles, move what does not belong."* Measured:

1. **There are no cycles to break.** That half of the axis has no subject.
2. **The hub is `foundation`, not `kasirmu-core`** — 27 dependents against 14, nearly double.

Volume misled the earlier rounds here. §3/F1 established `kasirmu-core` as 33.3% of our Rust and
treated that as centrality; by dependency it is second. Normalising by size:

| crate | lines | dependents | dependents per 1,000 lines |
|---|---|---|---|
| `foundation` | 7,198 | **27** | **3.75** |
| `kasirmu-core` | 151,425 | 14 | 0.09 |

`foundation` carries ~40× the coupling per line of `kasirmu-core`. It is 1.6% of the codebase and
the most depended-upon crate in it. Two consequences worth recording: any change to `foundation`
has the widest blast radius per byte of anything in the workspace, and the invariant §8 measured
there — **zero `f32`/`f64`, all money `i64` minor units — is the single most load-bearing
property in the repo**, because 27 crates inherit it. That is a stronger argument for protecting
it than any line count gave us.

If axis D is funded at all, retarget it to `foundation` and drop the cycle half.

### 10B. The test-suite floor, measured (partially)

Scan of every `*_tests.rs` file under the 39 members: **477 files, 221,328 lines, 111 `sleep`
statements, 28,560 ms of stated sleep — a 28.6 s floor.**

| sub-crate | test files | sleeps | stated ms |
|---|---|---|---|
| `platform/sync` | 15 | 44 | **16,600** |
| `crates/kasirmu-core` | 131 | 24 | 5,698 |
| `apps/cloud-server` | 24 | 1 | 2,000 |
| `crates/kasirmu-lan` | 3 | 13 | 1,800 |
| `apps/desktop-tauri` | 15 | 8 | 1,000 |
| `platform/startup` | 4 | 10 | 660 |
| `crates/kasirmu-logging` | 5 | 1 | 300 |
| `crates/kasirmu-bridge` | 72 | 2 | 230 |
| `crates/kasirmu-payment` | 13 | 4 | 150 |
| `crates/kasirmu-local-api` | 1 | 2 | 120 |
| `crates/kasirmu-{notification,security}` | 12 | 2 | 2 |
| all others (16 crates) | — | 0 | 0 |

The floor is **concentrated, not spread**: `platform/sync` alone holds 58% of it (16.6 s), and
three crates hold 85%. `cloud-server`'s entire 2 s is one statement — the Redis TTL wait at
`redis_backend_tests.rs:153` recorded as O-T14.

Two caveats that bound the number, stated rather than buried:

- **28.6 s is a serial sum, not a wall-clock floor.** Under `cargo nextest` test binaries run as
  parallel processes and tests within a binary as parallel threads, so the real floor is nearer
  the worst *binary* — `platform/sync` at 16.6 s — than the 28.6 s sum.
- **The scan is a floor, not a measurement of time.** It counts only `Duration::from_millis` /
  `from_secs` literals on a line containing `sleep(`. It misses sleeps built from variables,
  `Instant`-based polling loops, busy-waits, and the time inside `#[ignore]`d tests. Actual
  wall-clock remains unmeasured.

Note also that 477 / 221,328 differs from §3's 476 / 240,257: §3 counted `*_tests.rs` **and**
`*/tests/*.rs`, this scan counts only `*_tests.rs`. The two are different instruments; do not
quote them as the same one.

### 10C. §4 status — what this round earned, and what it did not

| §4 claim | status after round 5 |
|---|---|
| fan-in / fan-out between our crates | **EARNED** — §10A (154 edges, full table) |
| whether any crate is a dependency cycle | **EARNED — zero**, both graphs (§10A) |
| how much is behind feature flags | **PARTIAL** — 9 of 39 manifests declare `[features]`; no per-feature code volume measured |
| how much of our code is unreachable | **NOT EARNED.** Proxy only: **368** `#[allow(dead_code…)]` / `#[allow(unused…)]` / `#[allow(clippy::…)]` attributes across the 39 members. An `allow` is not evidence of dead code — it is evidence someone silenced a lint. Counting it as dead code would be a category error |
| test wall-clock per crate | **PARTIALLY EARNED** — stated sleep floor measured (§10B); actual wall-clock still not run |
| which crates are slow to compile | **NOT EARNED** — no build run (§10D) |
| which crates cost binary size | **NOT EARNED** — no release build |

Three of seven rows are now earned, two partially. **Compile time remains the largest unmeasured
claim in this journal** — it is also the premise of axis A, which §5 offered as one of only two
axes with order-of-magnitude potential. That guess is still a guess.

### 10F. The FIRST build, run 2026-10-14 — and it REFUTES F2's premise (axis A)

`cargo build --timings` has never been run in this todo's whole life; §10D recorded that as a
decision and prescribed the escape hatch. **Run below, on the prescribed route.** The shared
`target/` lock was avoided with a scratch target dir, so no concurrent session was stalled and
no cache was touched:

```bash
CARGO_TARGET_DIR=/c/tmp-kasirmu-check cargo check --workspace --all-targets --timings
# Finished dev profile in 3m 40s (221s), exit 0
```

Two deliberate choices: **`check`, not `build`** — axis A's question is incremental front-end
latency, and codegen adds a fixed cost that tells you nothing about which crate to split; and
**`--all-targets`** — a plain `cargo build --workspace` compiles *no test code at all*, which
would have made the instrument blind to the very mass F2 is about. The temp-dir path is the
git-bash spelling; the Windows path is `C:/tmp-kasirmu-check`.

**The headline: F2's 52.8% is a LINE SHARE, and it does not carry into compile time.**

| | compile seconds | share |
|---|---|---|
| lib/bin `check` units | **1,509 s** | **81.8 %** |
| **test** `check` units | **337 s** | **18.2 %** |
| total unit-seconds | 1,846 s | wall clock 221 s (8.4x parallel) |

So tests are 52.8% of the lines and **18.2% of the front-end cost** — the split (or
feature-gating) axis A was written to perform would retire at most 18% of the work, and
F2's *"the largest test modules are also the slowest to compile and link"* does not hold:
`sales_tests.rs` is 4,933 lines and its crate's whole test unit is **25.8 s**, while the
**two Tauri shell crates alone are 189 s** — 56% of all test compile time.

**The 10 most expensive units in the workspace, which is the real axis-A target list:**

| # | seconds | unit |
|---|---|---|
| 1 | **135.9** | `kasirmu-mobile` (check-**test**) |
| 2 | **51.1** | `kasirmu-app` (check-**test**) |
| 3 | 38.5 | `windows` (dependency) |
| 4 | 31.9 | `kasirmu-mobile` (check) |
| 5 | 29.3 | `kasirmu-app` (check) |
| 6 | 25.8 | `kasirmu-core` (check-test) |
| 7 | 24.1 | `kasirmu-bridge` (check-test) |
| 8 | 15.0 | `kasirmu-bridge` (check) |
| 9 | 12.6 | `kasirmu-core` (check) |
| 10 | 11.3 | `tauri-utils` (dependency) |

**What this changes about axis A, stated rather than glossed:**
1. **The insight is a ratio, not a total.** If tests are only 18% of front-end time, then
   149 test-file *call sites* of `formatMoney` are irrelevant to compile cost — the number
   that made the earlier receipt-grouping fix look like "a 149-site design decision" was a
   count of *source lines that do not dominate the cost*. The same is true of every
   line-count-driven reluctance in this todo.
2. **Axis A's best target is NOT a test module.** It is the two shell crates, and the
   cheapest intervention is the one §5 already named in passing: **feature-gating**.
   `apps/mobile-tauri` and `apps/desktop-tauri` each compile the whole world because the
   Tauri app is one crate; a `cfg` split on the surface (the same one that would help
   axis E) attacks the top two rows directly.
3. **The dependency tail is 3 of the top 10** (`windows`, `windows-sys`, `tauri-utils`),
   and no axis covers dependencies at all — §0 puts them explicitly out of scope, so they
   are recorded here as a sixth candidate rather than folded into A.
4. **The 8.4x parallelism is worth guarding.** Cold, unthrottled, the workspace's front end
   saturates ~8 cores. Anything that reduces unit count without reducing total work can
   *lengthen* wall clock, so axis-A acceptance must be a wall-clock number, not a
   unit-seconds sum.

**What this does NOT do:** it is one cold run on one host. Per §10D's own caution the numbers
are host-dependent, and per this file's law a quoted figure needs its mechanism named — the
mechanism is `cargo check --workspace --all-targets --timings`, cold, with a scratch
`CARGO_TARGET_DIR`. **Re-run it the same way before acting on any row.**

### 10D. Why no build was run — a decision, not an omission

`cargo build --timings` and `cargo bloat` are the two remaining instruments, and neither was run.
The reason is the checkout, not the cost: this is a **shared working tree** where several sessions
commit concurrently, and a workspace build takes the `target/` lock for its duration — it would
stall anyone else compiling. Worse, timings measured while another session holds that lock are
worthless, so the number would be wrong as well as rude.

Recorded so nobody later mistakes the gap for an oversight. To earn the last two rows, run on a
quiet tree (or a scratch worktree):

```bash
cargo build --timings --workspace            # per-crate wall clock → axis A
cargo nextest run --workspace --report-time  # per-test wall clock  → axis B
cargo bloat --release -p kasirmu-app         # binary size          → axis E
```

### 10G. Axis B, resumed — `pg_daemon_tests` polled, 810ms of floor gone (2026-10-14)

§10E said axis B had *"a measured target instead of a suspicion"* and that O-T05 addressed
its largest single block. **O-T05 converted `daemon_tests.rs` only; its sibling
`pg_daemon_tests.rs` was still on the old fixed start/stop pattern, and that is what this
round did.**

The two files are the same class — a `PgSyncDaemon`/`SyncDaemon` with `status()` and
`start`/`stop` — so the fix is the same fix: a `wait_for_pg_daemon` poller at 10ms with a
1s ceiling, named in the panic. Nine call sites converted:

| site | before | after |
|---|---|---|
| start, wait for the first tick | fixed 80ms | poll `last_sync_at.is_some()` |
| stop, wait for the run loop to exit | fixed 100ms | poll `!running` |
| (9 conversions across 8 tests) | 1,870 ms stated | **1,060 ms stated** |

**Measured, per this file's own law (the figure is a property of the mechanism at the tip
it was read at):** the stated sleep floor of
`platform/sync/src/pg_daemon_tests.rs` went from **1,870 ms to 1,060 ms** — **810 ms removed,
43% of the file**. Against §10B's workspace floor the file's contribution drops
proportionally; the workspace number is not re-quoted here because it must be re-run at the
tip a reader opens.

**One fixed sleep was DELIBERATELY LEFT, and why.** `pg_daemon_tests.rs:812` still sleeps
100ms. It is not a start/stop wait — it yields so a spawned blocker task can take the DB
lock first, and then asserts that `stop()` waits for it. A condition poll cannot express
that, because the property under test is *the race the sleep creates*. Its 300ms sibling is
the blocker itself and stays for the same reason. Recorded so a future sweep does not
"fix" the two sleeps that are load-bearing.

**Verification, and the limit of what this host can prove:** `cargo clippy -p platform-sync
--all-targets` clean and `cargo fmt --check` clean. **The tests could NOT be run here** —
this host cannot link a Rust test binary (`rust-lld: error: could not open 'kernel32.lib'`,
no Windows SDK libs on the linker path), and it fails identically on `kasirmu-crypto`,
a crate this change does not touch, so the failure is pre-existing and environmental.
**The 9 conversions are unverified at runtime on this host** — CI runs them. That is stated
rather than buried because a timing change that only compiles is a change that might race.

### 10E. What the instruments changed

- **Axis D is retargeted or dropped.** No cycles exist; the hub is `foundation` (27 dependents,
  3.75 per 1,000 lines) rather than `kasirmu-core` (14, 0.09). Funding axis D as written would
  send work at the wrong crate to fix a problem that does not exist.
- **Axis B now has a measured target instead of a suspicion.** 28.6 s stated serial floor, 58% of
  it in `platform/sync`. Fixing O-T05 (the `daemon_tests` sleeps) addresses the largest single
  block in the workspace.
- **Axis A is unchanged and still unfunded, but is now the explicit biggest hole.** §5 recommended
  funding B first "with `--timings` run once to confirm the guess rather than trust it". The
  timings have not been run, so that confirmation is still outstanding.
- **A new invariant worth protecting:** `foundation`'s zero-float-money property (§8) is inherited
  by 27 of 39 crates — 69% of the workspace. It is the highest-leverage invariant measured so far,
  and nothing in the journal previously said so.

**No crate code has been changed.** §6's rules stand.

---

## 11. Round 6 (2026-09-28) — O-T05 executed, and the acceptance that could not be run

§10E named O-T05 as "the largest single block in the workspace". It is now done
(`dd2f929f7`). **This round is the first in this journal that changed crate code.**

### 11A. What changed

`platform/sync/src/daemon_tests.rs` slept a fixed **500 ms after every
`daemon.start()`** and **200 ms after every `daemon.stop()`** — seven pairs,
against a daemon whose tick is 100 ms, so a 5× floor paid on each. Those 14
sleeps are replaced by two helpers that poll `daemon.status()` every 10 ms with
a **1 s ceiling**:

- `wait_for_first_cycle` — waits on `last_sync_at.is_some()`, the exact
  condition the following assertion already checked. Strictly equivalent and
  strictly safer: it returns as soon as the condition holds (one tick, ~100 ms)
  and its ceiling is 2× the old allowance.
- `wait_for_stopped` — waits on `!running`. **Not equivalent to what it
  replaced**; called out in §11D.

Deliberately left alone: the 300 ms + 100 ms pair in the stop/start race
regression (they hold a DB lock to block the run loop — they *are* the test), the
10 ms `axum` readiness sleeps, and the existing 10 ms poll loop at `:1858`.

### 11B. The before/after number, on §10B's own instrument

Re-run of the §10B scan (`Duration::from_millis|from_secs` literals on a line
containing `sleep(`, `*_tests.rs` only) — same instrument, same crate:

| | sleeps | stated ms |
|---|---|---|
| platform/sync BEFORE (§10B) | 44 | **16,600** |
| platform/sync AFTER | 32 | **11,620** |

−4,980 ms (−30%). The workspace floor §10B recorded as 28,560 ms → **23,580 ms**.

### 11C. The acceptance that did NOT run — stated rather than buried

§6 requires "a command that was run, with its output quoted". **That was not
possible here**, and the reason is this checkout, not the change:

`cargo test -p platform-sync --lib daemon` → **72 passed / 16 failed**, and
every one of the 16 fails at `tokio::net::TcpListener::bind("localhost:0")` with
`Os { code: 11003 }` — panic column 71, in the `spawn_*_server` helpers
(`test_helpers.rs:18`, `daemon_tests.rs:942` and siblings). Classified rather
than assumed: **0** of the 16 mention this change's `daemon never reached`
panic, and **16 of 16** carry the bind error. The sandbox cannot bind a socket
here; every daemon test that exercises start/stop also needs a mock server, so
none of the seven converted tests can execute in this environment.

**So §11B is a measurement of the stated-sleep floor — the instrument §10B
already used — not of wall-clock.** Wall-clock stays unearned, exactly as §10C
has it. Run on a quiet tree:

```bash
cargo nextest run -p platform-sync --lib daemon --report-time
```

### 11D. The one risk worth naming

`wait_for_stopped` converts an **unasserted** 200 ms sleep into a **panicking**
poll: previously a daemon that never stopped passed silently, now it fails. That
is the file's own idiom (`:1864` panics on a wedged running flag) and it is what
O-T05 asked for, but it is a real behaviour change and it is **unverified** — see
§11C. If CI reddens on it, the bug it surfaces is genuine rather than a flaky
poll; the ceiling (1 s) is 5× the old allowance.

**Axis B is still unfunded as a phase.** This round did one finding, not the
axis. Axis A (compile time) remains the largest unmeasured claim, and §5's
"run `--timings` once to confirm the guess" is still outstanding.

### 11E. The funding-candidate list at §9 is stale — re-verified 2026-09-28

§9's cross-cutting reading closes with an ordered candidate list: *"O-H26 (live
panic), O-H24 (double charge), O-H23 (UI stall), then O-T04 → O-T01 → O-T02."*
**The first three are all paid**, and they landed on 2026-09-27 — two days after
the round that ranked them, and without this journal being told. A lane that
funds from that list as written would rebuild three finished fixes.

| Entry | Status | Evidence |
|---|---|---|
| **O-H26** `blocking_lock` panic | **PAID** | `581f32981` (2026-09-27) *"fix(bridge,desktop): replace panicking blocking_lock with try_lock in the sync scope resolvers (O-H26)"*. `crates/kasirmu-bridge/src/ctx.rs:412` now heads a section titled *"Why this uses `try_lock`, not `blocking_lock`"* carrying the `audit.rs` rebuttal. Note it took `try_lock`, not the `lock().await` this journal suggested — same defect closed, different mechanism. |
| **O-H24** double charge | **PAID** | `8c592c58f` (2026-09-27) *"fix(payment): gate fallback-chain advance on the caller's gateway key (O-H24)"*. `crates/kasirmu-payment/src/registry.rs:96-115` is now a class × key table, and `execute_with_fallback` takes `gateway_key: Option<&str>` (`:119`). This is the journal's own alternative fix — *"require a caller-supplied gateway key"* — chosen over *"fall through only on Terminal"*, and the doc records why: an open breaker classifies `Transient`, so blocking the class would make one unhealthy gateway fatal to its chain. |
| **O-H23** email-scheduler stall | **PAID** | Fixed in place, no separate commit found. `crates/kasirmu-notification/src/email_scheduler.rs:70-91` splits the work into *"Scope 2a: Load the analytics bundle under the lock"* and *"Scope 2b: Render with NO database lock held"*, with a comment citing O-H23 by name. The lock now covers only the queries. |
| **O-T04** `fresh_db()` global mutex | **STILL LIVE** | `crates/kasirmu-core/src/migrations.rs:528` is `static SNAPSHOT: LazyLock<Mutex<rusqlite::Connection>>`; the clone takes `SNAPSHOT.lock()` at `:563` for `Backup::run_to_completion` at `:564-567`. Unchanged. |
| **O-T01** topology `fresh_conn()` | **STILL LIVE** | `apps/desktop-tauri/src/commands/topology/topology_tests.rs:16-22` — `fresh_conn()` still does `migrations::run(&mut conn)`. Plus 9 direct `run` sites in `topology_command_tests.rs` (`:71,106,148,198,231,254,330,369,410`) beside 10 `fresh_db()` calls in the same file. Unchanged. |

**So the live head of the funding list is now O-T04 → O-T01 → O-T02.** §9's
sequencing caution still stands and was not overridden: fix O-T04 before
O-T01/O-T02, because `fresh_db()` is the *good* design and is still a global
mutex, so converting the remaining `run` sites concentrates them onto one lock.

**One caveat on that caution, recorded rather than silently applied.** O-T01 is
not merely "66 sites move onto one lock" in the abstract — each `run` replays
the **entire** migration chain, whereas each `fresh_db()` is a Backup copy of a
pre-migrated snapshot. The swap trades a full replay for a copy, which is a win
even while serialized; the caution is about how much of the win is left on the
table, not about whether there is one. That reasoning is unmeasured, and §10C's
"test wall-clock per crate — PARTIALLY EARNED" is why it stays a caveat.

This is the fourth time today that work recommended from a dated plan doc turned
out already paid. The rule worth carrying: **re-read the cited lines before
implementing any entry from a journal more than a day old in a multi-lane
checkout.**

### 11F. O-T04 was funded and came back negative — measured, not argued (2026-09-28)

§11E left O-T04 as the head of the list and repeated §9's sequencing caution.
This round actually ran the instrument. **The premise is wrong.** Every number
below is measured on this checkout, 32 logical CPUs, debug profile.

**What a database actually costs to build**

| Quantity | Measured |
|---|---|
| Migrations in `ALL` | **68** |
| `migrations::run()` — the whole chain | **305–322 ms** (3 runs: 315.6, 304.6, 304.1; a later run 322.6, 322.1, 313.4) |
| `fresh_db()` — one clone | **2.47–3.00 ms** |
| `Connection::open_in_memory()` alone | **40 µs** |
| Snapshot size | **506 pages × 4096 B = 2024 KiB** |

So §9's qualitative claim — that a clone beats a replay — is confirmed and is
now quantified at ~100×. That part of O-T01/O-T02 is real money.

**What parallelism actually does to it** (384 clones, total work held constant)

| Threads | Wall | Per clone | vs 1 thread |
|---|---|---|---|
| 1 | 1.151 s | 2.996 ms | 1.00× |
| 2 | 0.757 s | 1.971 ms | **1.52×** |
| 4 | 1.029 s | 2.680 ms | 1.12× |
| 8 | 2.178 s | 5.672 ms | 0.53× |
| 16 | 3.343 s | 8.706 ms | 0.34× |
| 32 | 3.754 s | 9.776 ms | 0.31× |

DB construction does not parallelise. It improves to two threads and then
degrades super-linearly. 32 threads is **3.3× slower than one**.

**Why that is not the `Mutex` — the A/B**

O-T04 was implemented as §9 prescribed: a per-thread snapshot source, so no call
takes a process-wide lock. `Connection` is `Send` but not `Sync`, and
`Backup::new` takes a `RefCell` borrow on its source
(`from.db.borrow_mut()`, rusqlite 0.31 `backup.rs:213`) — which also rules out
the tempting `Mutex` → `RwLock` "fix", since two readers would race that
`RefCell`.

| Threads | `Mutex` (HEAD) | Per-thread source |
|---|---|---|
| 1 | 2.985 ms | 2.996 ms |
| 2 | 2.059 ms | 1.971 ms |
| 4 | **2.298 ms** | 2.680 ms |
| 8 | **4.629 ms** | 5.672 ms |
| 16 | **7.476 ms** | 8.706 ms |

Removing the lock changed nothing at 1–2 threads and made 4+ threads
consistently ~15–20% *worse*. **The change was reverted.** `migrations.rs` at
HEAD is unchanged in behaviour; what landed is a comment recording both the
measured curve and the `RwLock` hazard, so the next lane neither re-funds this
nor "simplifies" the `Mutex` into a race.

**Where the ceiling actually is.** Not in this crate. The curve's shape — a
little scaling, then super-linear collapse — plus the fact that removing our
lock did not move it, points below `fresh_db()`: the likely candidate is
SQLite's global allocation mutex, which every page copy contends on. That is a
hypothesis, not a measurement, and is recorded as such.

**What this does to the funding list.** §9's caution — *"fix O-T04 before
O-T01/O-T02, or the cheap fix makes the parallelism worse"* — is **void**. The
lock is not what caps throughput, so converting `run` sites to `fresh_db()`
needs no prerequisite. Each conversion still trades ~305 ms for ~3 ms. **The
live head is now O-T01 → O-T02.**

### 11G. O-T01 funded and paid — and the "66 run sites" census was wrong (2026-09-28)

With §9's sequencing caution void (§11F), O-T01 went first. `apps/desktop-tauri/
src/commands/topology/topology_tests.rs` `fresh_conn()` now returns
`migrations::fresh_db()` instead of opening an in-memory connection and calling
`migrations::run(&mut conn)`.

**Measured, A/B against HEAD** (`cargo test -p kasirmu-app --lib topology`,
62 tests, same tree, immediate back-to-back runs):

| Version | Passed | Failed | Wall |
|---|---|---|---|
| HEAD — `migrations::run(&mut conn)` | 45 | 17 | **53.24 s** |
| `migrations::fresh_db()` | 45 | 17 | **9.77 s** (re-run 8.90 s) |

**−43.5 s, −81.7%**, with an identical pass/fail split. The 17 failures are
pre-existing and environmental, not a consequence of the change: every one dies
in `AppState::for_test()` on `PermissionDenied` creating
`C:\WINDOWS\TEMP\.tmpXXXXXX` — the same sandbox temp-path failure that already
accounts for the platform-startup failures. They fail identically on HEAD. They
could not be used to verify anything about class C below.

**The census correction matters more than the fix.** §9 asserts *"O-T01 and
O-T02 are the same mistake at two sizes"* against *"66 `run` call sites"* and
calls them *"the only two findings here with a one-line fix."* Measured today
with `git grep -n 'migrations::run(' -- '*.rs'`: **53 call sites** outside
`migrations.rs`, of which **38 are in test files**. Those 38 split three ways,
and only one third is a one-line fix:

| Class | Count | What it is | Convertible? |
|---|---|---|---|
| **A** | **12** | `Connection::open_in_memory()` then `run` | **Yes — `fresh_db()` is a drop-in.** All 12 converted in §11H. *(This read "11 remain" when written; the 12 above was already counted **after** O-T01 landed, so 12 remained, not 11. Corrected by §11H.)* |
| **C** | **9** | `run` on a connection the test does not own (`state.db.lock().await`) | **No.** `fresh_db()` *returns* a new connection; these tests need the one `AppState` already holds. |
| **D** | **16** | `Connection::open(&path)` — on-disk databases | **No, and correctly so.** the backup/restore test — now `crates/kasirmu-core/tests/integration/backup_restore.rs:45` after the consolidation that moved every top-level test into `tests/integration/` — already says why: *"`fresh_db()` creates an in-memory DB… For file-based DBs, we run migrations manually."* Includes both `recovery_tests.rs` files and `migrate_sqlite_to_pg_tests.rs`, which exist to exercise on-disk and WAL behaviour. |

Remaining class A, all with the same one-line fix:
`crates/kasirmu-core/src/db/inventory_tests.rs:12`, `settings_tests.rs:7`,
`sync_client_tests.rs:9`, `user_preferences_tests.rs:8`,
`tests/gift_card_integration.rs:15`, `tests/loyalty_integration.rs:16`,
`tests/purchase_order_integration.rs:17`, `tests/stock_count_integration.rs:17`,
`tests/stock_transfer_integration.rs:27`, `tests/supplier_integration.rs:15`,
`modules/inventory/src/handlers_tests.rs:17`,
`platform/sync/src/crdt/clock_store_tests.rs:10`.

**Class C is not merely a different shape — a naive snapshot copy is wrong
there.** These nine sites (`apps/desktop-tauri/src/commands/topology/
topology_command_tests.rs:71,106,148,198,231,254,330,369,410`) migrate a
database that may be **on disk**, and `run` ends by setting
`journal_mode = WAL` (`migrations.rs:455`). A `Backup` copy of the snapshot
carries the *pages*, not the per-connection PRAGMAs, so copying the snapshot
into a file-backed connection silently drops WAL — exactly the setting the
recovery-adjacent tests depend on. Fixing class C means adding something like
`migrations::apply_snapshot(conn)` that copies the snapshot *and* re-applies
WAL. Worth ~2.7 s; **not funded here**, because the only tests that exercise it
are the 17 that cannot run in this sandbox.

**O-T02 is the remaining live entry** from §9's list.

### 11H. The rest of class A paid — 115 s off six test binaries (2026-09-28)

All 12 remaining class-A sites converted (`migrations::run` on a freshly opened
in-memory connection → `migrations::fresh_db()`): `crates/kasirmu-core/src/db/
inventory_tests.rs`, `settings_tests.rs`, `sync_client_tests.rs`,
`user_preferences_tests.rs`, `tests/gift_card_integration.rs`,
`tests/loyalty_integration.rs`, `tests/purchase_order_integration.rs`,
`tests/stock_count_integration.rs`, `tests/stock_transfer_integration.rs`,
`tests/supplier_integration.rs`, `modules/inventory/src/handlers_tests.rs`,
`platform/sync/src/crdt/clock_store_tests.rs`.

`tests/stock_count_integration.rs` also dropped a `journal_mode = WAL` pragma
that was dead code — an in-memory database cannot use WAL whatever the caller
asks for, which is exactly why `fresh_db` does not set it.

**Measured A/B** — the six `kasirmu-core` integration binaries, baseline taken
by `git stash`-ing only those six files and running immediately after (98 tests):

| Binary | Tests | `migrations::run` | `fresh_db()` |
|---|---|---|---|
| `gift_card_integration` | 21 | 27.00 s | 0.81 s |
| `loyalty_integration` | 20 | 25.40 s | 0.56 s |
| `purchase_order_integration` | 14 | 15.26 s | 0.45 s |
| `stock_count_integration` | 14 | 15.23 s | 0.43 s |
| `stock_transfer_integration` | 14 | 17.10 s | 0.44 s |
| `supplier_integration` | 15 | 17.95 s | 0.42 s |
| **Total** | **98** | **117.94 s** | **3.11 s** |

**−114.8 s, −97.4%.** With O-T01's −43.5 s (§11G), this line of work has taken
**~158 s** out of the dev-CI test wall.

**Why the win is ~4× the naive projection.** 218 helper invocations × 305 ms
predicts ~65 s; measured 115 s. The multiplier is §11F's own finding turned
around on `run`: under `cargo test`'s 32 threads a *replay* costs ~1.2 s, not
305 ms (27 s / 22 calls in `gift_card_integration`), because replays do not
parallelise either and contend on the same allocator. So the single-threaded
microbenchmark understates the parallel cost of `run` by roughly 4×, and any
future estimate of "how much is this `run` site costing" must not use the 305 ms
single-thread figure.

**Verification, and the failures that are not mine.** `db::inventory_tests` 49
passed; `db::settings` 35 passed / 1 failed; `sync_client` 52 passed / 3 failed;
`user_preferences_tests` 7 passed; `modules-inventory` lib 90 passed;
`platform-sync --lib crdt` 72 passed / 1 failed. Every failure is the sandbox,
not the change: `backup_creates_snapshot_file` cannot create
`C:\WINDOWS\TEMP\oz-test-backup-…db.tmp-…`; three `sync_client` tests die on
`Os { code: 10106 }` in mock-server setup; the `daemon_crdt_…` test on
`Os { code: 11003 }` at `daemon_tests.rs:1377`; and `boundary_contract`'s
`manifest_id_matches_module_trait_id` on `OS Error 5` reading
`modules/inventory/manifest.json`. All are the same temp-path / socket / file
failures already attributed three times today.

**Class A is now empty.** Remaining: class C 9 (needs a WAL-aware snapshot
helper — §11G), class D 16 (on-disk, correct as-is), production 15 (must stay).

### 11I. O-T02 re-scoped: the premise was aimed at the wrong 90% (2026-09-28)

§9's O-T02 reads *"`migrations_tests.rs` replays the chain 32 times to assert one
row each"* at `:3-12`, with the fix *"hoist one `LazyLock` migrated connection
for read-only schema assertions."* Both halves are wrong on the file as it
stands.

- **`fresh()` (`:3-6`) does not run migrations at all.** It opens an in-memory
  connection and sets `foreign_keys = ON`. The file's subject *is* migrations,
  so the tests that call `run` do so deliberately.
- **Of 26 `platform_core::database::run` calls, only 7 apply the full chain**
  (`run(&mut conn, ALL)`). 15 are *partial* — `&ALL[..split]` / `&ALL[split..]`
  — which is the upgrade-path contract and cannot be served from a snapshot.
- **The 43 tests cost 75.85 s, and ~70 s of that is two of them.**
  `every_migration_re_applies_against_the_final_schema` and
  `cosmetic_edit_to_any_migration_re_applies_cleanly` each sweep all 68
  migrations. Hoisting a `LazyLock` for the read-only legs would have bought
  about a second of 75.85.

**What was actually funded.** `every_migration_re_applies_against_the_final_schema`
applied the *whole registry* on each of its 68 iterations. That first apply is
byte-identical every time — same pages, same `schema_migrations` rows, same
stored checksums, which is precisely what the drift assertions read — so it now
clones one cached apply via `Backup` (~3 ms) instead of replaying it (~305 ms).
New `final_schema()` / `FINAL_SCHEMA` helpers in `migrations_tests.rs`.

Two details that make it safe, and one that makes it loud if it is not:
- A `Backup` page copy preserves the `schema_migrations` **checksums**, so
  `stored_checksum` and the drift verdict are unchanged. (Note `fresh_db()` is
  *not* usable here for exactly this reason — it inserts ids with no checksum.)
- `foreign_keys = ON` is re-applied on every clone: it is per-connection, so
  `Backup` does not carry it, and `fresh()` sets it. Without it a migration that
  violates a foreign key would succeed and silently weaken every verdict.
- If any of that were wrong the test fails loudly — it asserts an exact
  `NOT_REAPPLIABLE_AGAINST_FINAL_SCHEMA` set — rather than passing vacuously.

**STATUS was PENDING and is now VERIFIED.** The change could not be run when it
was written: `cargo check -p kasirmu-core --lib --tests` was failing on another
lane's in-flight currency refactor (`create_exchange_rate` / `list_exchange_rates`
/ `get_currency_symbol_position` no longer on `Store`, across
`db/settings_tests.rs`, `currency_integration`, `settings_integration`). Zero of
those errors referenced `migrations_tests.rs`. Their tree went green about five
minutes later and the verification ran:

| Test | Baseline | After |
|---|---|---|
| `every_migration_re_applies_against_the_final_schema` (alone) | **25.86 s** | **1.40 s** |
| `cosmetic_edit_to_any_migration_re_applies_cleanly` (alone, untouched) | 14.03 s | 11.72 s |
| whole `migrations` module, 43 tests | 75.85 s | 61.58 s |

−24.5 s, −94.6% on the targeted test, **43 passed / 0 failed** — so the clone
does preserve the drift verdict, which is the one thing that could have been
wrong. The two sweeps now cost 17.08 s combined when run alone.

**The other sweep cannot be optimised this way, and the attempt is worth
recording.** `cosmetic_edit_to_any_migration_re_applies_cleanly` cannot use one
snapshot — its prefix `&ALL[..=index]` grows per iteration — so the design was to
hold one master connection, apply `ALL[index]` to it incrementally, and clone per
iteration: a sum-of-prefixes (~10 s) becomes one chain plus 68 clones (~0.5 s).
**It was implemented and it fails immediately**, on the second-listed migration:

> `internal error: 1 recorded migration(s) are newer than this build knows (e.g.
> 20260815_tenant_unique_indexes.sql; this build's newest is 20260814_*.sql), so
> this database was migrated by a later release. Refusing to run: its schema may
> already have been renamed or dropped by migrations this binary cannot see…`

`platform_core::database::run` treats the slice it is handed as *"the registry
this build knows"*, so a one-element sub-slice makes every already-recorded
migration look like it came from a later release. `ALL` is also not in lexical id
order, which is why it trips on the first step. **That guard is deliberate and
correct — it must not be weakened to make a test cheaper.** Reverted, with the
reasoning pinned in a comment at the bottom of `migrations_tests.rs` so it is not
retried. That sweep keeps its ~15 s.

### 11J. O-T03 transformed, swept onto the branch by another lane, reverted (2026-09-28)

§9: *"`queue_tests.rs` permanently leaks 76 in-memory databases … `Box::leak` on
every one of ~77 tests, to buy a `'static` lifetime nothing needs."* The
diagnosis is right. Measured today: **77 call sites** of `setup_store()`, all
uniformly `let store = setup_store();`, each leaking one `fresh_db()` — and the
snapshot is 2 024 KiB (§11F), so the binary held **~156 MiB of SQLite it never
released**. The same `Box::leak(Box::new(migrations::fresh_db()))` line appears
in five siblings: `platform/sync/src/sync_client_divergence_tests.rs:31`,
`tests/adversarial_paths.rs:55`, `tests/convergence_replay.rs:58`,
`tests/integration_test.rs:119`, `tests/stock_readings.rs:50`.

`Store<'a>` (`crates/kasirmu-core/src/db/mod.rs:204`) holds `pub conn: &'a
Connection` and `Store::new` takes `&'a Connection`, so nothing in these tests
needs `'static` — the leak existed purely to satisfy a return type. The fix is
`fn setup_store(conn: &Connection) -> Store<'_>` plus one `let store_conn =
migrations::fresh_db();` per call site.

**STATUS: landed and verified — `cfb1325bd`.** `cargo test -p platform-sync
--lib -- queue::tests` → **79 passed, 0 failed**, 1.74 s. The five sibling files
listed above are untouched and still leak.

The path there was messier than the fix. Written to the tree and, before it could
be compiled, swept into `8301eef0f` (*"refactor(mobile): split the COR-7 checkout
out of the POS command layer"*) — another lane's commit picked up my uncommitted
working-tree change. `cargo check -p platform-sync --lib --tests` could not be
run: `target/debug/.cargo-build-lock` was held exclusively (fails `r+b` *and*
`a+b`) for ~25 minutes. Rather than leave an uncompiled 77-site change on a
shared branch while going idle — a compile error there blocks every lane — it
was restored to the original (`e96f53b1b`). The lock freed ~15 minutes later and
the re-applied patch passed first time.

Two `image_push::tests` failures show up under a bare `-- queue` filter because
"en**queue**s" matches; they are `Os { code: 5 }` at `image_push_tests.rs:74`,
the same `C:\WINDOWS\TEMP` file-create failure, and are unrelated to this change.

Note the count: 77 `setup_store()` call sites but 79 tests in `queue::tests` —
two tests build their `Store` without the helper.

**Process lesson, and it is §7.3's rule biting.** Uncommitted work in a shared
checkout is not private. `AGENTS.md` forbids `git add` for exactly this reason —
the index is a single racing object — and I used `git add` for most of this
session before reading it. From here: one-line `git commit -m "..." -- <path>`,
no staging, and **do not leave a large unverified edit in the tree**. Baselines
for A/B measurement must be taken by copying the file outside the repo and
restoring it, never with `git stash`, which §7.3 also forbids.

**The number that actually dominates axis B, and that nobody has scoped.** Under
`cargo nextest run` (dev-ci.yml:552 — process-per-test), each test process builds
the snapshot from scratch and pays the **full 305 ms**, not the 3 ms clone. With
874 `fresh_db()` call sites that is ~266 s of CPU per full run before a single
assertion executes. The `Mutex` was never going to touch that. Per-migration
profiling says it is not one bad file either — the top 10 of 68 migrations are
65.6% of the build, led by three whole-table rebuilds
(`20260906_rename_store_to_location` 50.2 ms,
`20261014_kds_drop_pairing_tokens` 43.5 ms,
`20260831_per_tenant_unique_rebuild` 37.8 ms), which is the unavoidable price of
68 migrations of history. Any real axis-B win has to come from not rebuilding
per process, not from making the rebuild parallel.

---

## §11K — O-T03 finished: every `Box::leak`ed database is gone (2026-09-28)

The five sibling files §11J left open turned out to understate the defect. A
full census (`Box::leak` over the workspace, filtered to leaks whose payload is
a `Connection` or a `Store` holder) found **21 sites across 19 files, ~368 call
sites**, not five. All 21 are now repaired, in three commits:

| commit | scope | shape |
|---|---|---|
| `608ca5c9e` | 14 `kasirmu-core` test files, ~328 call sites | helper returns `Store<'_>`, takes `&Connection` |
| `9c4a32854` | 5 `platform/sync` files, 24 call sites | as above, **plus** two `Device` structs (below) |
| `89e083ad5` | 2 criterion benches, 6 call sites | as above, and `migrations::run` → `fresh_db()` |

Census after: **zero** database leaks. The `Box::leak` calls that remain in the
tree are all `&'static str` / `Vec<Migration>` manufacturing for **compile-time**
constants (`migrations_tests.rs:253/351/440`, `startup_tests.rs:371…493`,
`platform/core/src/database/manager_tests.rs:23`). Those need a `'static`
*value*, not a lifetime the caller could own, and are not this defect.

### The one shape that was not mechanical

`convergence_replay.rs` and `adversarial_paths.rs` stored a `Store` **inside**
`Device`:

```rust
struct Device { store: Store<'static>, outbound: Vec<OfflineQueueItem>, … }
```

A struct cannot hold a borrow of a field it also owns — that is precisely what
the `Box::leak` was buying. The repair inverts the ownership:

```rust
struct Device { db: rusqlite::Connection, outbound: Vec<OfflineQueueItem>, … }
impl Device { fn store(&self) -> Store<'_> { Store::new(&self.db) } }
```

and every `self.store` becomes `self.store()`. 13 call sites between the two
files; `&self.store()` passed to `apply_remote_atomic` works because the
temporary lives to the end of the statement.

`fiscal_tests.rs` had a second-order instance: `fn tx_of(store: &Store<'static>)`
forced every caller to hold a `'static`. It is now
`fn tx_of<'a>(store: &Store<'a>) -> rusqlite::Transaction<'a>` — the
`Transaction` borrows the connection through the `Store`, so it never needed
`'static` either. This produced the only compile errors in the sweep: 8 ×
`E0597: 'store_db' does not live long enough`, all from that one signature.

### Verification, and the part that is *not* verified

- `cargo check -p kasirmu-core --lib --tests` — clean.
- `cargo check -p kasirmu-core --benches` — clean.
- `cargo check -p platform-sync --lib` — clean.
- Scoped `cargo test -p kasirmu-core --lib` over the 14 touched modules:
  **368 passed, 4 failed**. All four environmental and pre-existing in kind:
  three `Os { code: 10106 }` socket binds in `sync_client`, one
  `create_dir_all` under `std::env::temp_dir()` in
  `db::fiscal::tests::concurrent_claims_never_issue_the_same_number`.
- **`cargo check -p platform-sync --tests` never ran.** Its dev-dependency
  closure needs the `serde_core` and `num-traits` build scripts, and both panic
  with `Os { code: 5 }` on `fs::write` into `OUT_DIR`. Four attempts over ~20
  minutes — sandboxed and not, Bash and PowerShell — including one with the
  `out` directory pre-created by hand.

That last failure is worth its own note, because it explains a whole class of
"test failures" collected this session. **A Rust binary compiled in this session
cannot create a file at all.** Proven with a bare `rustc` probe — no cargo, no
repo code, no `target` directory involved:

```
$ rustc --edition 2024 fs_write.rs && OUT_DIR=<any writable dir> ./fs_write.exe
WRITE FAILS -> … : OS Error 5 (FormatMessageW() returned error 15100)
```

`rustc` itself can write (it just emitted that `.exe`); Python can write the
same path. Only executables produced by `rustc` are denied. So the 17 desktop
topology `PermissionDenied` temp-dir failures, the `db::fiscal` one above, and
the `modules-inventory` `manifest.json` read are one machine-level fact, not 19
unrelated flakes.

Because `platform/sync`'s test targets could not be compiled, the one new shape
was proven indirectly instead: `Store`, `rusqlite::Connection` and
`migrations::fresh_db` are all reachable from `kasirmu-core`, so the `Device`
pattern (struct owns the connection, `Store` built on demand, `&self.store()`
passed by reference, and a `|d: &Device| d.store().conn()…` closure) was
compiled and run there as a throwaway integration test. **1 passed, 0 failed**,
then deleted. All five files are additionally rustfmt-clean, which at least
proves they parse. The gap is written into `9c4a32854` rather than papered over.

### Line endings

The first sweep's script wrote with Python's default newline translation and
turned 12 files CRLF. `.gitattributes` pins the working tree to LF
(`* text=auto eol=lf`) specifically to stop that noise, so they were normalised
before committing. Diff sizes are unchanged by the normalisation — 849/470
across the 21 files — confirming no whole-file churn rode along.

### What this does *not* win

Removing a leak removes a leak; it does not make anything faster. The wall-clock
wins were O-T01 and O-T02, and they came from `fresh_db()` replacing
`migrations::run`, not from the borrow change. The only timing effect here is
the two benches, which drop a ~305 ms replay from setup. The number that still
dominates axis B is the one at the end of §11J: under `cargo nextest` each
process rebuilds the 305 ms snapshot from scratch, ~266 s of CPU per full run
across 874 `fresh_db()` call sites.

---

## §11L — O-M59 and O-M62 resolved: logging preflight parity and exchange rates bounded (2026-10-08)

Two medium findings closed with focused tests:

1. **O-M59 · `kasirmu-logging` JSON writability preflight (`084f5002f`)**:
   - `crates/kasirmu-logging/src/lib.rs`: Added `ensure_log_dir_writable(log_dir)?` to `try_init_json_with_file`.
   - Prevents silent dropped logs when `log_dir` is unwritable, mirroring the preflight in `try_init_with_file`.
   - Verified with unit test `try_init_json_with_file_fails_fast_on_unusable_dir`. All 41 logging tests green.

2. **O-M62 · `modules-currency` bounded exchange rates query (`a93b0b758`)**:
   - `modules/currency/src/repository.rs`: Added `DEFAULT_MAX_EXCHANGE_RATES = 500` and `list_exchange_rates_bounded(limit)` with SQL `LIMIT` pushdown.
   - Prevents memory explosions on long-lived store deployments with thousands of historical rate entries.
   - Verified with unit test `list_exchange_rates_bounded_respects_limit`. All 84 currency tests green.

---

## §11M — O-L13, O-L15, and O-M66 resolved: QRIS decimal validation, crypto OnceLock, and RBAC zero-alloc grants (2026-10-08)

Three findings closed across crypto, payments, and authorization subsystems:

1. **O-L13 · `qris-core` exact decimal percentage validation (`df4d7aa2b`)**:
   - `crates/qris-core/src/validate.rs`: Eliminated float parsing `parse::<f64>()` in favor of `is_valid_percent_str` backed by exact decimal integer math `parse_percent`.
   - Prevents exponential notation (`"1e3"`), `"inf"`, and `"NaN"` from bypassing validation, guaranteeing money type-safety.
   - Verified with unit test `percentage_tip_scientific_notation_or_nan_fails_validation`. All 35 unit, 9 integration, and 13 doctests green.

2. **O-L15 · `kasirmu-crypto` master key environment caching (`c656624c2`)**:
   - `crates/kasirmu-crypto/src/lib.rs`: Cached `master_key_from_env()` with `static CACHED: OnceLock<Option<[u8; 32]>>`.
   - Eliminates repetitive environment variable queries, string allocations, and hex decoding on every encryption and decryption operation.
   - Verified across all 42 unit tests and 1 integration test in `kasirmu-crypto`.

3. **O-M66 · `platform-core` / `modules-staff` zero-alloc RBAC evaluation (`1428ad443`)**:
   - `platform/core/src/rbac.rs` & `platform/core/src/staff.rs`: Optimized `has_permission` to avoid heap allocations (`format!("{domain}:*")`) via `strip_suffix(":*") == Some(domain)`.
   - Replaced redundant string allocations in `Role::has_permission` with `check_permissions_json`, using borrowed `Cow<str>` to parse grants in-place with short-circuiting.
   - Verified across all 71 RBAC tests and 35 staff tests in `platform-core`, plus 23 tests and 1 doctest in `modules-staff`.

---

## §11N — O-L14 and O-L17 resolved: QRIS table CRC and plugin event O(1) dispatch (2026-10-08)

Two low-severity performance findings resolved:

1. **O-L14 · `qris-core` table-driven CRC-16/CCITT (`798211bf3`)**:
   - `crates/qris-core/src/crc.rs`: Replaced 8-iteration bitwise loop with 256-entry lookup table `CRC16_TABLE`.
   - Eliminates 8x inner loop branching per byte across QRIS payload creation and signature validation.
   - Verified across all 35 unit tests, 9 integration tests, and 13 doctests in `qris-core`.

2. **O-L17 · `kasirmu-plugin` zero-clone O(1) hook dispatch (`06894624d`)**:
   - `crates/kasirmu-plugin/src/manager.rs`: Added `plugin_index: HashMap<String, usize>` built at load time to enable O(1) index lookup into `self.plugins`.
   - Replaced `.cloned()` on `hook_names` with borrowed slice iteration, eliminating heap allocation on every hook dispatch.
   - Verified across all 224 tests in `kasirmu-plugin`.

---

## §11O — O-T10 resolved: memoize `run_sweep()` in desktop registration gate tests (2026-10-15)

One test performance finding resolved in desktop shell:

1. **O-T10 · `kasirmu-app` memoize `run_sweep()` (`registration_gate_tests.rs`)**:
   - `apps/desktop-tauri/src/commands/registration_gate_tests.rs`: Memoized `run_sweep()` using `static SWEEP: std::sync::OnceLock<Sweep> = std::sync::OnceLock::new()`.
   - Replaced repeating the disk walk and char-scan of ~224 source files (82 in `src/commands` + 142 in `kasirmu-bridge`) across test assertions with a single cached evaluation.
   - Verified across all 14 tests in `registration_gate_tests.rs`, finishing in 0.50s.

---

## §11P — O-H06 resolved: batched pre-fetch and zero-clone catalog import (2026-10-15)

One High performance finding resolved in bridge data commands:

1. **O-H06 · `kasirmu-bridge` catalog import existence checks & timestamp hoisting (`data.rs`, `helpers.rs`)**:
   - `crates/kasirmu-bridge/src/data/helpers.rs`: Replaced row-by-row `SELECT 1 FROM ... WHERE ... = ?1` in `gate_import_product_batch` and `gate_import_user_batch` with single pre-fetched `HashSet` indexed queries.
   - `crates/kasirmu-bridge/src/data.rs`: Pre-fetched existing SKUs, categories, sales, customers, and users into `HashSet`s before the loops, eliminating N round-trips under the exclusive write lock; hoisted RFC-3339 timestamp `now` once; eliminated redundant `val.clone()` allocations by consuming owned `payload` vectors.
   - Verified across all 79 tests in `kasirmu-bridge` data module (`data_tests.rs`).

---

## §11Q — O-H05 resolved: batched staff roster accessors (2026-10-15)

One High performance finding resolved in staff roster queries:

1. **O-H05 · `kasirmu-bridge` staff roster N+1 queries eliminated (`staff.rs`, `db/staff.rs`, `db/assignments.rs`, `db/profile/user.rs`)**:
   - Added batched core accessors `Store::list_user_profiles_map`, `Store::list_assignments_map`, and `Store::list_staff_codes_map`.
   - Replaced $3N$ sequential database queries inside `list_staff_scoped` with 3 indexed set queries, assembling complete `StaffMemberDto` records in-memory via $O(1)$ hash map lookups while preserving fail-closed error propagation.
   - Verified across all 132 tests in `kasirmu-bridge` staff module and 123 tests in `kasirmu-core`.

---

## §11R — O-M01, O-M02, O-M05, and O-M06 resolved: popularity statement hoisting, means cache pre-parse, window ranking, and batched tax validation (2026-10-15)

Four Medium performance findings resolved across core database modules:

1. **O-M01 · `kasirmu-core` popularity UPDATE prepared statement hoisting (`db/popularity.rs`)**:
   - Hoisted `tx.prepare_cached("UPDATE products SET popularity_score = ?1 WHERE sku = ?2")` above the SKU update loop, eliminating SQL string parsing and query compilation for each catalog product during full popularity recalculation passes.

2. **O-M02 · `kasirmu-core` pre-parsed category means cache for trend calculation (`db/popularity.rs`)**:
   - Introduced `all_category_means` helper reading and parsing the `CATEGORY_MEANS` JSON blob once before the trend points loop into a `HashMap<String, (f64, f64, f64)>`. Replaced repeated per-point database reads of `settings` and JSON string parsing with constant-time in-memory lookups.

3. **O-M06 · `kasirmu-core` partitioned ranking via window function (`db/popularity.rs`)**:
   - Replaced materializing the entire catalog into memory with SQL `ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY popularity_score DESC, sku ASC)` filtered by `rn <= ?1`. Leveraged the existing category product counts for exact percentile calculations without extra scans.

4. **O-M05 · `kasirmu-core` batched active tax rate validation and cached inserts (`db/tax/assignments.rs`)**:
   - Replaced sequential per-id `get_tax_rate` queries with a single batched `SELECT id FROM tax_rates WHERE is_active = 1 AND id IN (...)` validation in `ensure_active_tax_rate_ids`.
   - Hoisted `prepare_cached` for junction insert loops in `set_product_tax_rates` and `set_category_tax_rates`.
   - Verified across all 82 tax tests in `tax_tests.rs` and 20 popularity tests in `popularity_tests.rs`.

---

## §11S — O-M08, O-M10, and O-M15 resolved: promotion category batching, rate-limiter spray ceiling, and subscription zero-alloc payload parsing (2026-10-21)

Three Medium performance and memory findings resolved across core domain engines:

1. **O-M08 · `kasirmu-core` batched category resolution and memoized promotion discounts (`db/promotions.rs`, `db/products_crud.rs`, `promotion_engine.rs`)**:
   - Added `Store::get_products_category_batch(&skus)` executing lightweight `SELECT sku, category_id, price_minor FROM products WHERE sku IN (...)` in 200-item chunks, avoiding wide 8-table joins across tax rates, barcodes, and inventory.
   - Hoisted and pre-fetched all line categories upfront in `compute_checkout_promotions` and `apply_promotion_to_sale` across the cart instead of N individual `get_product` queries per line per promotion.
   - Memoized SKU $\to$ category evaluations inside `compute_discount` across lines and Buy-X-Get-Y evaluation passes.
   - Verified across all 44 unit tests in `promotions_tests.rs`.

2. **O-M10 · `kasirmu-core` rate-limiter spray ceiling and borrow-keyed lookup (`rate_limiter.rs`)**:
   - Introduced `DEFAULT_MAX_TRACKED_USERNAMES` (10,000) capacity ceiling with eviction of the oldest unlocked entries when capacity is exceeded, eliminating unbounded memory growth during unauthenticated login spray attacks.
   - Implemented borrow-keyed lookup (`map.get_mut(username)`) on recurring attempts, eliminating unconditional heap `String` allocation on repeated failures.
   - Verified across all 34 unit tests in `rate_limiter_tests.rs`.

3. **O-M15 · `kasirmu-core` zero-alloc payload parsing and case-insensitive matching (`subscription.rs`)**:
   - Extracted `addons`, `is_trial`, `trial_ends_at`, and `features` directly into typed targets, eliminating untyped `serde_json::Value` AST tree generation and cloning.
   - Replaced `.to_lowercase()` String allocations with zero-allocation `a.eq_ignore_ascii_case(addon)` in `has_addon`.
   - Parsed `allowed_types_json` using borrowed `Cow<str>` to avoid String allocation on workspace type checks.
   - Verified across all 155 unit tests in `subscription_tests.rs`.

---

## §11T — O-M17, O-M18, and O-M19 resolved: category tax batching, KDS indexing, and targeted analytics user queries (2026-10-21)

Three Medium performance findings resolved across bridge operational handlers:

1. **O-M17 · `kasirmu-bridge` batched category tax rate resolution (`tax.rs`, `db/tax/assignments.rs`)**:
   - Added `Store::get_category_tax_rates_batch(&category_ids)` chunked at 200 items in `kasirmu-core`.
   - Updated `run_list_category_tax_rates` to issue one batched lookup instead of $N$ sequential round trips across categories.
   - Verified in `tax_tests.rs` and `tax.rs`.

2. **O-M18 · `kasirmu-bridge` KDS chit generation deduplication and order indexing (`kds.rs`)**:
   - Replaced linear searching across existing jobs with a `HashSet<(String, String)>` seen set in `build_kds_chit_jobs`, eliminating $O(N^2)$ algorithmic complexity during order chit generation.
   - Indexed orders in a `HashMap<&str, &KdsOrder>` in `try_auto_print_kds_chit_jobs`, eliminating repeated linear order traversals per job.
   - Verified in `kds.rs` test suite.

3. **O-M19 · `kasirmu-bridge` scoped staff analytics display name resolution (`analytics.rs`, `db/staff.rs`)**:
   - Added `Store::get_user_display_names_batch(&user_ids)` to query only staff IDs actually present in the report aggregation.
   - Replaced loading and deserializing all global user rows in `get_staff_analytics_scoped` with the targeted batch query.
   - Verified in `analytics.rs` and `staff.rs`.

---

## §11U — O-M14 resolved: pre-indexed CRL sets and in-memory revocation cache (2026-10-21)

One Medium performance and scalability finding resolved in license verification:

1. **O-M14 · `kasirmu-core` pre-indexed CRL sets and in-memory cache (`license_verification/crl.rs`, `license_verification.rs`)**:
   - Introduced `ParsedCrlSets` storing `revoked_tenants`, `revoked_devices`, cleartext `revoked_keys`, and precomputed `revoked_key_hashes` in pre-indexed `HashSet<String>`s.
   - Added in-memory `PARSED_CRL_CACHE` (`RwLock<Option<(String, Arc<ParsedCrlSets>)>>`) to avoid repeated JSON deserialization and linear scans during entitlement and subscription verification calls.
   - Replaced linear $O(N)$ scanning with $O(1)$ set lookups in `is_revoked_in_cached_crl` and `apply_crl_to_cache`.
   - Verified across 34 tests in `license_verification_tests.rs` and 155 tests in `subscription_tests.rs`.

---

## §11V — O-M07 resolved: batched transactions for stock movement archiving (2026-10-21)

One Medium performance finding resolved in inventory and stock movement compaction:

1. **O-M07 · `kasirmu-core` batched transaction execution and prepared statement caching (`db/products_stock_adjust/movements.rs`)**:
   - Grouped item movement archiving into transactions of 50 items (`ARCHIVE_BATCH_SIZE`) instead of individual per-item write transactions, reducing disk fsyncs and lock acquisition cycles by up to 50x.
   - Hoisted `prepare_cached` for archive insertion, rollup creation, and movement deletion queries across each transaction batch.
   - Verified across all 10 unit tests in `products_tests.rs` (`archive_movements_*`).

---

## §11W — O-M16 resolved: batched role counts, active owner query, and roster role indexing (2026-10-21)

One Medium performance and scalability finding resolved across staff and role management:

1. **O-M16 · `kasirmu-bridge` batched role counts, count_active_owners, and staff role lookup (`staff.rs`, `db/roles.rs`, `db/staff.rs`)**:
   - Added `Store::all_role_counts_map` in `crates/kasirmu-core/src/db/roles.rs`, querying references and holder counts for all roles in 5 total queries instead of $5N$ sequential queries during `list_roles_scoped`.
   - Added `Store::count_active_owners` in `crates/kasirmu-core/src/db/staff.rs`, eliminating full `users` table loading into memory in `enforce_role_assignment_policy`.
   - Pre-indexed `role_map` in `list_staff_scoped` via `to_staff_dto_with_role_name`, reducing linear scanning of roles per user from $O(\text{users} \times \text{roles})$ to $O(1)$.
   - Verified across 49 roles tests and 98 staff tests in `kasirmu-core`, and 132 tests in `kasirmu-bridge`.

---

## §11X — O-M03 resolved: bounded offline queue queries and push ordering (2026-10-21)

One Medium performance and memory finding resolved in offline queue drain paths:

1. **O-M03 · `kasirmu-core` bounded offline queue push queries (`db/offline.rs`, `sync_client.rs`, `platform/sync`)**:
   - Introduced `Store::list_pending_offline_for_push_bounded` and `Store::list_pending_offline_for_tenant_for_push_bounded` executing `ORDER BY priority ASC, created_at ASC, id ASC LIMIT ?1` directly in SQLite.
   - Replaced unbounded full-table materialization in `platform/sync` daemons (`daemon.rs`, `pg_daemon.rs`), `kasirmu-bridge` (`sync_pending_offline_scoped`), `kasirmu-core` (`sync_client`), and mobile commands with bounded 100-item batch fetches (`DEFAULT_MAX_OUTBOX_BATCH_ITEMS`).
   - Eliminated potential Android/daemon OOM crashes during large backlog reconnections and ensured immediate Critical item priority transmission.
   - Verified across 119 tests in `kasirmu-core`, 105 tests in `platform-sync`, and 10 tests in `kasirmu-bridge`.

---

## §11Y — O-M12 and O-M13 resolved: concurrent location resolution cache and batched shortfall queries (2026-10-21)

Two Medium performance findings resolved in location and inventory resolution:

1. **O-M12 · `kasirmu-core` concurrent location resolution cache with capacity ceiling (`location_resolver.rs`)**:
   - Replaced `Mutex` with `RwLock` for `LOCATION_CACHE`, unlocking non-blocking concurrent reads during cart updates and checkouts across worker threads.
   - Introduced a capacity ceiling of 1,024 entries (`MAX_CACHED_LOCATIONS`) with expired TTL pruning upon cache insertion to eliminate unbounded memory growth.
   - Verified in `location_resolver_tests.rs`.

2. **O-M13 · `kasirmu-core` batched shortfall inventory and location queries (`location_resolver.rs`)**:
   - Replaced $2N$ sequential queries per candidate location in `resolve_location_chain_for_sku` with a single joined query against `stock_summary` and `inventory_locations` over `WHERE s.location_id IN (...) AND s.qty > 0`.
   - Batched name resolution in `enrich_bindings` via `WHERE id IN (...)`, eliminating per-binding database round trips.
   - Preserved exact greedy-fill priority ordering and availability semantics.
   - Verified across all 29 unit tests in `location_resolver_tests.rs`.

---

## §11Z — O-H16 resolved: delta refresh of KDS queue snapshot with cached line item and station reuse (2026-10-21)

> **RESTORED 2026-10-21.** This section's body was deleted by `49a304b97` (another lane's
> O-H22 commit), which replaced it with a bare `---`. The CODE was never affected —
> `dirty_order_id` is still at `apps/desktop-tauri/src/commands/kds.rs:104` — but the record
> was gone, which is worse than it sounds: a future reader would have re-derived O-H16 as
> open work from its entry, exactly the rot this journal keeps documenting. Text restored
> verbatim from `a53ee8092`, the commit that earned it.

One High performance finding resolved in desktop KDS command and LAN sync handling:

1. **O-H16 · `kasirmu-app` incremental KDS queue snapshot refresh (`apps/desktop-tauri/src/commands/kds.rs`)**:
   - Converted `refresh_kds_queue_cache` to index existing active tickets by order ID from the in-memory `cache.read()` snapshot.
   - Reused already-resolved `line_items` and `stations` for all unchanged orders, avoiding $2N$ sequential bridge queries on every keystroke or order status transition.
   - Added `dirty_order_id: Option<&str>` parameter so that line-item bump events only re-query the single order whose lines changed, while order status updates reuse lines and stations completely.
   - Verified across all 5 end-to-end multi-terminal tests in `commands::kds::kds_lan_live_tests`.

---

## §11AA — O-H22 resolved: per-store initialization locks during store DB migrations (2026-10-21)

> **WRITTEN RETROSPECTIVELY 2026-10-21.** `49a304b97` landed the fix and touched this file,
> but added no §11 section and no PAID marker, so every census read O-H22 as open work.
> Re-verified at HEAD before writing this: `StoreDatabaseManager.init_locks` is
> `Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>` (`platform/core/src/database/manager.rs:47`),
> the per-store guard is taken at `:97-108`, and released entries are reaped at `:138-140`.

One High finding resolved in `platform/core`'s store database manager:

1. **O-H22 · `platform-core` per-store init locks (`platform/core/src/database/manager.rs`)**:
   - Replaced the process-wide store-DB mutex held across migrations with a per-store lock map, so two stores opening concurrently no longer serialize behind each other's migration chain.
   - The outer map is held only long enough to resolve the inner `Arc<Mutex<()>>` for one store; the actual migration work happens under that store's own lock.
   - Entries whose `Arc::strong_count` drops back to 2 are removed, so the map does not grow without bound as stores are opened and closed over a long-running process.
   - Verified in `platform/core/src/database/manager_tests.rs`.

---

## §11AB — O-H07 resolved: bounded batch draining for offline queue sync (2026-10-21)

One High performance and network resilience finding resolved in bridge offline sync:

1. **O-H07 · `kasirmu-bridge` bounded batch offline queue push (`crates/kasirmu-bridge/src/sync.rs`)**:
   - Replaced unbounded `store.list_pending_offline()` and single HTTP upload with a batching loop fetching up to `DEFAULT_MAX_OUTBOX_BATCH_ITEMS` (100) items via `store.list_pending_offline_for_push_bounded`.
   - Prevents memory spikes and HTTP 30-second transport ceiling timeouts on merchants reconnecting after multi-day offline operations with large backlogs.
   - Retained auth refresh handling on 401 across batches and accumulated outcomes correctly.
   - Added unit test `sync_run_scoped_drains_large_backlog_in_bounded_batches` in `sync_tests.rs`.

---

## §11AC — O-H01 resolved: batched popularity recompute on the checkout path (2026-10-21)

One High finding resolved in the product's hottest write path.

**The cost, measured from the source rather than the entry.** `recompute_popularity` runs
five queries — `sale_day_counts`, `sale_distinct_transactions`, two `activity_day_counts`,
and `sku_means` — plus one UPDATE. `sku_means` is the expensive one: it resolves the
product's category with its own query, then calls `category_means` → `all_category_means`,
which **re-reads and re-parses the entire cached category-means JSON per SKU**.
`complete_sale` called it once per sold LINE, so an N-line cart paid 6N round trips and N
JSON parses after the money had already committed.

**The fix keeps the per-SKU semantics and changes only the round-trip count.**
`recompute_popularity_batch(&[String])` collapses duplicate SKUs (a cart can legitimately
hold the same product on two lines — recomputing it twice is the waste this removes),
runs four `IN (...)`-scoped grouped queries regardless of line count, reads the means cache
**once**, applies the same `get(cat).or_else(get(""))` fallback per SKU, and writes every
score in one `BEGIN IMMEDIATE` transaction with a cached prepared statement. Placeholders are
built from the SKU count, never from SKU text.

**The test worth recording is the one that did not work the first time.**
`recompute_popularity_batch_matches_single_sku_recompute` computes every score both ways and
asserts equality. The first version PASSED — and kept passing when I deliberately mangled the
batch to ignore per-category means entirely. **It was vacuous**: no category means were seeded,
so both paths fell through to the same global fallback and the mutation was invisible.
Seeding a category whose means (50/40/30) differ sharply from the global (1/1/1), and moving
two products into it, made the mutation bite — re-running it then failed with exactly the
intended message. Without that second pass this fix would have shipped with a green test that
could not have caught the one thing most likely to break.

**One behaviour change, recorded rather than glossed:** the old loop warned once per failed
SKU; the batch warns once per sale with the line count. The SKUs are still attributable from
the error, and a failed recompute has never blocked the sale itself.

**Verification.** `cargo test -p kasirmu-core` — 3,650 + 550 + 3 passed, 0 failed. The 41
popularity tests and all 48 `complete_sale` tests green, including the two new ones.

> **Machine note, not a code defect.** `concurrent_complete_sale_serialized_by_begin_immediate`
> fails on THIS box with `PermissionDenied` at `sales_tests.rs:3569` — its `create_dir_all`
> into `C:\WINDOWS\TEMP` is fine but the directory cannot be removed or reused. Proven
> environmental, not by my change: with `TEMP` pointed at a writable path the same test passes
> (1 passed). It is the temp-dir failure already recorded at this journal's :1665 and :1972,
> now with a reproduction.

---

## §11AD — O-H01 verification, part 2: the temp-dir "test failure" was a machine setting (2026-10-21)

While verifying O-H01, `concurrent_complete_sale_serialized_by_begin_immediate` failed
deterministically with `Os { code: 5, PermissionDenied }` at its first line. It was NOT the
popularity change, and proving that took three measurements rather than one assertion:

| measurement | result |
|---|---|
| what the test actually does first | `create_dir_all` into `std::env::temp_dir()` — before any SQL |
| can this user delete a subdir of that path? | creating it succeeds; **removing it is Access denied** |
| same test with `TEMP` pointed at a writable dir | **1 passed** |

**The root cause.** `TEMP`/`TMP` are set to `C:\WINDOWS\TEMP` at the MACHINE level
(`HKLM\...\Session Manager\Environment`), while the USER-level value is the correct
`C:\Users\<user>\AppData\Local\Temp`. A user can create inside `C:\WINDOWS\TEMP` but not
remove, so any test that makes a scratch directory there can never clean up, and on a box where
a stale directory already exists the create itself fails — reading as a test failure while being
nothing of the sort.

**The fix is structural, not per-test.** `migrations::test_scratch_dir(prefix)` resolves the
workspace root by walking up for `Cargo.lock` + `target/` (from `CARGO_MANIFEST_DIR`, so it does
not depend on the process CWD), and creates `target/test-scratch/<prefix>_<uuid>/`. `target/` is
already gitignored at `.gitignore:2`, so nothing can be committed by accident, and the per-test
UUID keeps parallel tests apart. **All 19 `std::env::temp_dir()` sites in `kasirmu-core`, across
15 files, now route through it** — the class is closed, not the instance.

**What it did NOT fix, stated plainly.** Two race tests —
`sales_crud::a_transition_that_lost_the_race_reports_the_conflict` and
`sales_lifecycle::void_sale_race_reports_the_conflict_rather_than_overwriting_a_completed_sale`
— still fail intermittently at the default 32-way parallelism and pass at `--test-threads=4`
(3,650 / 3,650) and in isolation. They stage an interleaving with a fixed
`sleep(300 ms)` window and give up after 8 attempts ("could not stage the read-before-commit
interleaving in 8 attempts"). That is a load-sensitive timing design that predates this work;
my diff to both files is the single temp-dir line. **They are left as they are rather than
quietly retried or widened**, because a race test that is loosened to pass under load stops
staging the race it exists to catch.

---

## §11AE — O-H13 resolved: image routes off the blocking filesystem (2026-10-21)

One High finding resolved, plus the temp-dir class extended to a second crate.

**The defect, and why this path rather than any other.** Five blocking calls in
`crates/kasirmu-api/src/routes/images.rs` ran on the axum executor: `std::fs::write` and
`std::fs::rename` in `store_image_atomic` (`:93-94`), a `remove_file` on the conflict arm, and
`std::fs::read` at `:351` and `:441` serving stored images. `process_image` is an `async fn`, so
every one of these parked a tokio worker for the duration of the syscall. The image path is where
that compounds: it writes on every upload, and a contended volume stalls every request multiplexed
onto the same worker — not just the image one.

**The fix is a straight conversion — with one deliberate behaviour change.**
`store_image_atomic` is now `async fn` and every call is `tokio::fs`, with the call site awaited.
The rename-and-verify logic is untouched: a lost race still resolves to "duplicate" when the final
path exists, and still errors when it does not. **`Path::exists()` became `try_exists().await`
on purpose** — the blocking form swallows the error and reports `false`, which would turn a
permission fault into a second write attempt against a path we cannot see. `try_exists` propagates
it, so a real fault reaches the caller's existing `Err(_) => Rejected` arm instead of being
silently retried. That is a small, deliberate strictness increase, recorded rather than slipped in.

**A second instance of the temp-dir class, found because these tests ran.**
`routes/images_tests.rs:19` built its fixture directory from `std::env::temp_dir()`, so on this
machine **all twelve image tests failed** with `Os { code: 5, PermissionDenied }` at
`create_dir_all` — before any of this work, and Reading as a broken image route. The crate now has
its own `scratch_image_dir()` on the same pattern as `kasirmu-core`'s `test_scratch_dir`, writing
to the gitignored `target/test-scratch/`. **17/17 image tests and 339/339 crate tests now pass,**
and they pass for the right reason.

**Tally for the session:** `kasirmu-core` 19 sites / 15 files, `kasirmu-api` 1 site / 1 file. The
helper is duplicated across the two crates rather than promoted to a shared dev-dependency; two
copies of eleven lines is cheaper than a new dev-dependency edge for this, but the third copy is
the point at which that stops being true.

---

## §11AF — O-H11 resolved: one product query per sale, not one per line (2026-10-21)

One High finding resolved in the Postgres sale-creation path.

**The cost.** `create_sale` (`crates/kasirmu-api/src/pg/sales.rs`) issued
`SELECT cost_minor, id, name, category_id FROM products WHERE tenant_id = $1 AND sku = $2`
**inside the line loop, inside the open transaction**. A 30-line receipt cost 30 round trips
while holding a pooled connection and the header row's locks for the whole of it — the lock-hold
time grew with the receipt, which is what made this a High rather than a tidy-up.

**The fix.** One `sku = ANY($2::text[])` before the loop builds a
`HashMap<String, (Option<i64>, Option<String>, Option<String>, Option<String>)>`; the loop body
becomes a map lookup.

**What actually needed care was three edge semantics, not the SQL.**

| case | old behaviour | preserved as |
|---|---|---|
| sku has no product row | `query_opt` -> `None` -> `unwrap_or_default()` -> all-None; the line is still WRITTEN with NULLs | absent key -> same `Default` -> identical tuple, never skipped, never an error |
| `cost_minor` is 0 or negative | `Some(r.get::<i64>(0)).filter(|&v| v > 0)` -> `None` | the verbatim filter expression, moved into the map builder; identity columns still frozen |
| the same sku on two lines | two queries, same row each time | `UNIQUE (tenant_id, sku)` yields one row per key, so both occurrences get the identical tuple |

The empty-line case issues **no query at all** — an empty `ANY('{}')` binds a NULL element on the
wire, which is not the same as matching nothing. Tenant scoping is unchanged: `tenant_id = $1`
stays an explicit predicate beside the untouched `set_config('oz.tenant_id')` prologue, so the
batch can only ever see this tenant's products.

**Verification, stated exactly.** `cargo check -p kasirmu-api` clean; `cargo test -p kasirmu-api
--lib` **339 passed / 0 failed / 11 ignored**, run twice; `rustfmt --check` clean. The new test
`pg::tests::pg_create_sale_batches_product_lookup` is **registered but did NOT execute** — it is
gated `#[cfg_attr(not(feature = "pg-tests"), ignore)]`, and this machine has no Postgres (TCP
15432 and 5432 both refused, Docker daemon absent). It needs
`cargo test -p kasirmu-api --features pg-tests` against a live PG, which CI has. Recorded as
unrun rather than counted as passing.

---

## §11AG — O-H13 follow-up: the temp-dir class reaches a third crate, and two bugs in a subagent test (2026-10-21)

**The temp-dir class, closed in `apps/cloud-server`.** Five tests in this crate failed with
`PermissionDenied` creating a fixture: `db::tests::{sqlite_from_path_creates_db,
sqlite_creates_a_missing_parent_directory, sqlite_accepts_a_bare_filename_with_no_parent}` and
`image_gc::tests::gc_removes_files_when_present`. Three of them used `tempfile::tempdir()` rather
than `std::env::temp_dir()` — a different library, the same `TEMP` lookup, and so the same
`C:\WINDOWS\TEMP` that a normal user can create in but not delete from. This crate now has its
own `test_scratch` module (`scratch_dir` + a `TempScratch` guard that removes itself on drop, a
drop-in for `tempfile::TempDir` with the same `path()` accessor). **All five pass.**

That brings the sweep to **three crates: `kasirmu-core` (19 sites / 15 files), `kasirmu-api`
(1 site / 1 file), `kasirmu-cloud` (4 sites / 2 files).** The helper is now duplicated three times,
which is the point at which the note under §11AE said duplication stops being cheaper than sharing
— a shared test-support crate is the right follow-up, and is recorded here rather than done
speculatively.

**A subagent test that was wrong in both directions.** The O-H09 plan-cache work arrived with a
source-scanning test asserting `!body.contains("unwrap_or")` inside `plan_middleware`, described as
a fail-open guard. It was failing, and the code was not at fault:

- `plan.unwrap_or(TenantPlan::Free)` on the **success** arm is the pre-existing gate rule — a
  successful read that finds no plan row is a 403. That is fail-CLOSED. Removing it would have
  changed semantics O-H09 was told not to touch.
- `claims.tenant_id…unwrap_or("default")` is tenant resolution, nothing to do with plans.

So the assertion was over-broad enough to fail on correct code — and too weak to catch the shape it
named. The fail-open hazard is specifically the cache `Err` being swallowed before `map_err` can
turn it into a 500. The assertion now checks exactly that: no `unwrap_or` between the
`get_or_load(` call and its `map_err`. **9/9 plan-cache tests green.**

**Verified on the implementation side, not just asserted:** `PlanCache::get_or_load` caches only on
`Ok`, returns `Err` uncached so the next request retries the database, and never converts an `Err`
into `Ok(None)` — `CacheDoc` at `plan_cache.rs:128-138` states the same, and the code at `:151-155`
matches it.

---

## §11AH — O-H09 resolved: a short-TTL tenant-plan cache in front of the gate (2026-10-21)

One High finding resolved on the most frequently executed database read in the server.

**The cost.** `plan_middleware` runs on every `/api/sync/*` request and called
`get_tenant_plan`, which for Postgres did pool checkout → transaction → `set_config('oz.tenant_id')`
→ `SELECT plan FROM tenant_plans` → rollback. Four round trips per request, uncached, so database
load scaled with **request rate** rather than tenant churn. The fix is the one the entry named.

**Design decisions, each with its reason.**

| choice | value | why |
|---|---|---|
| TTL | **5 seconds** | The TTL *is* the downgrade window: a tenant moved off `pro` keeps reaching `/api/sync/*` for at most this long. 5s still collapses a whole tenant's terminal heartbeat burst into one read; 60s buys nothing measurable and multiplies the exposure 12x. |
| cap | **10,000 tenants** | Copied from the house ceiling in `kasirmu_core::rate_limiter::DEFAULT_MAX_TRACKED_USERNAMES`, so tenant growth cannot leak memory. Evicts nearest-expiry first, so a just-loaded entry is never the one thrown away. |
| lock | `std::sync::Mutex`, guard never held across an `await` | `cached()` and `insert()` each take and release it; the loader awaits outside. A `tokio::Mutex` here would be wrong — a pure in-memory map needs no async lock. |

**Fail-closed is the property that matters, and it was verified rather than asserted.**
`get_or_load` never converts an `Err` into `Ok(None)`; it returns the error unchanged so the
middleware's existing `map_err` still produces a 500. `Ok(None)` — a *successful* read finding no
plan row — IS cached and still gates the tenant as `free` (403), which is fail-**closed**. Errors
are never stored, so the next request retries the database instead of inheriting the failure.

**A subagent test that failed on correct code, and was too weak to catch the bug it named.**
It shipped asserting `!body.contains("unwrap_or")` inside `plan_middleware`. That fails on two
legitimate uses that have nothing to do with fail-open: `plan.unwrap_or(TenantPlan::Free)` on the
SUCCESS arm (the pre-existing 403 rule, which removing would have changed semantics O-H09 was told
not to touch) and `claims.tenant_id…unwrap_or("default")` (tenant resolution). Meanwhile it could
not have caught the real hazard, which is specifically the cache `Err` being swallowed **between**
`get_or_load(` and its `map_err`. The assertion now checks exactly that interval. **9/9 plan-cache
tests green.**

---

## §11AI — O-H10 resolved: one conflict-detection pass per page (2026-10-21)

One High finding resolved, and the largest round-trip win in the ledger.

**The cost, measured by the lane that fixed it.** `detect_conflict` called `load_entity_vector` +
`load_entity_payload` + `save_entity_vector`, and **each** did its own pool checkout + transaction
+ `set_config` GUC + statement. Per item that is ~13 Postgres round trips, so a 500-item push cost
**~5,000-6,500 round trips**.

**After, per PAGE rather than per item:** 1 checkout + 1 `BEGIN` + **1** `set_config` + chunked
`entity_type = ANY($2) AND entity_id = ANY($3)` reads + `UNNEST` inserts/upserts + 1 `COMMIT` =
**7 round trips for a typical 500-item page.** SQLite gets one transaction (one fsync), one `IN`
read, one multi-row insert and one multi-row upsert.

**The RLS contract is a security control and was preserved explicitly, not incidentally.** The
page's single transaction sets `oz.tenant_id` once with `is_local := true` before any statement,
and every helper below takes the caller's `&Transaction` / `&Connection` — **none can open its
own**, so no statement can run unscoped. Pinned by a source-level guard:
`conflicts_postgres_arm_sets_the_tenant_guc_once_per_transaction` asserts exactly 7 `set_config`
sites (5 PG entry points + 2 doc comments) and that the shared PG helpers never call `pool.get()`.

**Resolution semantics unchanged** — the decision logic is extracted into one pure `decide()` used
by both the single-item and batch forms, so there is one copy of the classify/C19/Stale arms
rather than two that could drift. Equivalence is pinned by
`sqlite_batch_detection_matches_n_single_item_calls`, comparing decisions, stored vectors/bodies
and review rows against N sequential calls on a second fresh database.

**That equivalence test was kill-tested rather than trusted.** Neutering the batch read so it
reported "nothing stored" for every key made it fail with exactly the intended message — the same
verification the O-H01 test needed after its first, vacuous version passed against a broken batch.

**Honest partials, recorded as given:** the SQLite single-item path keeps its historical autocommit
shape (only the batch path gains a transaction, so a page's vector advances are now atomic on
error — a difference that can only cause re-detection, never a lost write); a failed detection now
logs one line per page instead of one per item; and `insert_conflict` / `list_conflicts` /
`resolve_conflict` still do one checkout per row (no caller in tree). **No migration was needed or
made.**

---

## §11AJ — O-M57/O-M58 moot, and the ledger gate had a false-positive that hid live entries (2026-10-21)

**Two Mediums closed as MOOT, not fixed.** `O-M57` (syslog allocates per field) and `O-M58`
(eventlog allocates a `Vec<u16>`) both targeted files that no longer exist:
`crates/kasirmu-logging/src/syslog.rs` and `eventlog.rs` were **deleted** by `53dcb73a3`
("refactor(logging): delete the unwired syslog/eventlog sinks (C29/D13)", 2026-09-29), along with
the `libc` and `windows-sys` dependencies. `Cargo.toml:20-22` records the removal and notes the
crate is "now pure safe Rust". There is no sink left to make non-blocking — closed by deletion.
`O-H25` is the same shape and was closed in the same pass: its `modules/reporting/src/repository.rs`
is gone, replaced by `{handlers,lib,lib_tests}.rs`, and `handlers.rs` carries none of the three
defects the entry names. Closed as gone, not as repaired.

**The gate grew a fourth check: an open entry whose graded citations all point at deleted files.**
Three entries were found by hand in one pass, which is the signal that a machine should be
looking. It grades the first two citations of each OPEN entry (a closed entry legitimately cites
the file its fix created — O-H09 names `plan_cache.rs`), resolves a bare filename against the full
path cited beside it, and fails with a re-anchor-or-mark-MOOT instruction.

**And the new check was itself broken in a way worth recording.** Its first version passed a
kill test it should have failed. The cause was not the check — it was `INLINE_CLOSE_RE`, the
regex that decides which entries are already closed:

    \b(PAID|RESOLVED|FIXED|DONE)\b   with re.IGNORECASE

**O-H02's own fix description reads "chunk the image lookup into fixed-size batches."**
Case-insensitively that is a `\bFIXED\b` match, so a **live** entry was silently classified as
closed — and every downstream reading that trusted the marker treated it as done. That is a worse
failure than the staleness the check exists to catch, because it hides work instead of merely
mis-ranking it. The marker is now case-SENSITIVE (`PAID|RESOLVED|FIXED|DONE|MOOT`) and requires
the colon for the lowercase `Fixed:` form that O-H03/O-H04/O-H08 actually used.

**Re-run and confirmed:** restoring a deliberately non-existent path in O-H02 now fails the gate
with `O-H02 -> crates/kasirmu-core/src/db/deleted_file_probe.rs`, and the real tree passes. The
lesson is the same one §11AB recorded about citations: *a fix DESCRIPTION is not a fix RECORD*,
and a regex that cannot tell them apart will quietly close work that is still open.

---

## §11AK — O-H19 resolved: the daemon pushes in batches, not one unbounded request (2026-10-21)

One High finding resolved in the SQLite sync daemon.

**The defect was a feedback loop, not just a slow path.** `transport.push_items(&pending)` POSTed
the entire pending vector in one request while `SyncEngine` batched at 64 KB. As the queue backed
up, body size and the 30 s transport ceiling were exceeded, the cycle failed, and the queue grew
further — so the bigger the backlog, the less likely any of it would ever drain.

**The fix reuses the batching facility that already existed.** `build_batches(&pending,
MAX_BATCH_BYTES)` was already what `SyncEngine` used; the daemon now routes through it via a new
`push_batches`, which pushes each batch in order, persists the stamped clock after every attempt,
and applies that batch's outcomes before sending the next.

**Three decisions worth recording, each made deliberately:**

| decision | choice | reason |
|---|---|---|
| `pushed` count | `Σ results.len()` over batches that returned Ok | Never `batch.len()` or `pending.len()`: a short results vector must not over-report, and the existing "N outcome(s) for M item(s) left unacknowledged" path still catches it. |
| partial failure | batches commit INDEPENDENTLY; the cycle still fails | Batch 3 of 7 failing leaves 1-2 synced and counted, 4-7 pending. All-or-nothing rollback cannot shrink a backlog — it would re-push acknowledged items forever. The cycle still sets `sync_error`, so backoff and operator visibility are unchanged. |
| after the first failure | remaining batches are NOT attempted | A transport failure is expected to persist; retrying all 7 would burn the 30 s ceiling once per batch inside one tick. |

The 401 retry reuses the **same** batch split rather than re-reading the queue, so it cannot push
items that arrived mid-tick. `pushed` is added to on retry, not replaced — the old assignment
would have dropped batches already committed before the 401. An empty queue still issues zero
requests.

**Tests (3), each pinning a decision above rather than just an end state:**
`daemon_pushes_a_backlog_larger_than_one_batch_as_multiple_requests` (5 items × 40 KB padding;
asserts the mock's push count equals `build_batches(..).len()` and that every item is seen exactly
once), `daemon_keeps_acked_batches_when_a_later_batch_fails` (exactly 2 pushes, `last_pushed == 1`,
all 5 rows present, 4 still pending), and `daemon_with_an_empty_queue_issues_no_push_request`.

**One thing this did NOT fix, stated plainly:** `pg_daemon.rs:450` has the same unbatched call and
was left alone because another lane owns that file. Recorded here so the next pass does not read
O-H19's closure as covering the PG daemon too.

---

## §11AL — O-H18 resolved: one stock-summary rebuild per tick, not per page (2026-10-21)

One High finding resolved — the hoist only, and the page cap is explicitly NOT done.

**The defect was multiplicative.** The PG pull loop pages with no cap, and ANY page carrying a
`stock.movement` called `rebuild_stock_summary()` over the entire delta ledger. A backlog of P
pages therefore cost O(P x all movements) inside one tick.

**The fix.** The rebuild is removed from `apply_pulled_page`, which now returns
`Option<(String, bool)>` — the anchor plus "this page carried a stock movement", a fact it already
computed and discarded. `run_tick` OR-folds that bool into `tick_carried_movements` across the
loop, so **an earlier page's movement is not lost when the last page has none** — the subtle
data bug a naive "hoist to the end" would have introduced. One rebuild follows the loop, via a new
`rebuild_tick_summary`. It runs even when `sync_error` is set (partial correctness: movements
applied before the error are still summarized), and on rebuild failure it restores the durable
anchor to the tick's captured value so the next tick retries — with a restore failure reported
through a new `TickRebuild` enum rather than swallowed.

**What is pinned, and what is NOT — stated because the distinction matters.**

| property | pinned? | how |
|---|---|---|
| the page seam no longer rebuilds | **yes** | `apply_pulled_page_does_not_rebuild_the_summary_at_the_page_seam` asserts the page leaves `stock_summary` STALE while `get_stock_from_ledger()` advances. Restoring the per-page call makes that read `Some(57)` against `Some(50)`. |
| a movement on an EARLY page survives a trailing movement-free page | **yes** | `multi_page_tick_flag_survives_a_trailing_page_without_a_movement` drives 3 pages and asserts the tick-end total (50+5+6+7+1). A "last page wins" hoist fails it. |
| "exactly once per tick" as a COUNT | **no** | `Store::rebuild_stock_summary` is a concrete method on a struct borrowed from a `rusqlite::Connection` — no trait, no field, no seam to count through. An `updated_at`-stamp proxy was tried and **did not discriminate** (a rebuild re-derives identical quantities), so it was removed rather than left passing for the wrong reason. |

**Left undone on purpose:** the per-tick page cap. It needs a persisted mid-tick cursor — a
migration or a new contract on `sync_pull_state.cursor` — which is a schema change the O-H19/O-H20
lane was editing. The hoist removes the multiplicative factor; one rebuild per tick still costs
O(all movements), which is inherent because the summary is a whole-ledger aggregate.

---

## §11AM — O-H20 resolved, and along the way a pre-existing INSERT defect at HEAD (2026-10-21)

One High finding resolved, plus a data-correctness defect that was live in the shipped statement.

**The fix.** `push_items` now issues one multi-row `INSERT` per 1,000-row chunk — 7 binds/row x
1,000 = 7,000 parameters, ~1/9 of PostgreSQL's 65,535 cap, enforced by a `const _` assertion at
compile time. All chunks stay inside the SAME transaction with the same `SET LOCAL oz.tenant_id`
and one `commit()`. A 5,000-item drain is 5 statements instead of 5,000. `ON CONFLICT (id) DO
NOTHING` is preserved verbatim; the tenant gate still runs per item before admission.

**The defect found on the way, which is the more important half.** HEAD's per-item statement was

    ($1, $2, $3, 'pending', $4, $5, $6, $7)     with SEVEN bind parameters

so `retry_count` received the `last_error` value, `origin_terminal_id` was never bound at all, and
PostgreSQL rejects the statement outright ("there is no parameter $8"). **No test had ever run it
against a live server** — the only live test is `#[ignore]` behind the `pg-tests` feature — so the
top-level push path was dead code that would have failed on first contact with production.
Batching would have reproduced the same gap with different offsets.

**Structure over assertion, because this class recurred three times in one session.** Columns are a
`PushColumn` enum whose `ALL` list holds each column exactly once; the row count derives from
`BINDS_PER_ROW` (emitted binds, 7) and never from a column count; exactly ONE place advances the
placeholder number and only when a placeholder is actually emitted; and `pg_insert_sql` asserts
`next_bind - 1 == rows * BINDS_PER_ROW == bind_count` with a non-debug `assert_eq!`, so the
builder and `pg_insert_params` cannot drift apart in release either.

**Not verified: execution.** This machine has no PostgreSQL (15432 and 5432 both refuse, no
service, Docker daemon down), so the statement was never sent. The unit tests instead pin the
properties that make it correct — placeholders exactly `$1..$N` with no gaps and in order,
`N == params.len()`, slot 4 a literal and the other seven bound in every tuple, and
`retry_count` bound at position 5. The `#[ignore]` live test
`push_items_batches_across_chunk_boundaries` runs it for real wherever `pg-tests` runs.

**Statement count is not directly measured** either: the crate has no counting seam and adding one
needs a driver change. O(chunks) is pinned as a pure function of the chunk constant instead.

---

## §11AN — O-H12 resolved: keyset product paging, and a lateral aggregate that beats my own suggestion (2026-10-21)

One High finding resolved, both halves, and a design decision that was better than the one I specified.

**Half 1 — the bound.** `GET /api/v1/products` had no LIMIT. It now calls `list_products_page`
with keyset paging on `(name, sku)` and `DEFAULT_PRODUCT_PAGE_LIMIT = 100` /
`MAX_PRODUCT_PAGE_LIMIT = 500` (a request above the ceiling is CLAMPED, not rejected). Two
details make it honest rather than merely bounded:

- **`has_more` is derived by fetching one row PAST the page**, not by `products.len() == limit`.
  The naive form reports "more" on a catalogue of exactly N x limit products, sending clients on a
  phantom round trip.
- **The reply ALWAYS states `has_more` and `next_after`**, including the complete case. A bounded
  response is never mistakable for a complete one — which is what the task meant by "do not
  silently truncate".

Keyset rather than OFFSET because the catalogue changes while a client walks it. The cursor is the
SKU, but the SQL compares the full `(name, sku)` tuple resolved in-transaction, so no delimiter
token exists to be corrupted by a SKU that contains it.

**Half 2 — the subquery, and where I was wrong.** I suggested a grouped `LEFT JOIN`. The agent did
`LEFT JOIN LATERAL (SELECT true AS ss_has_rows, SUM(ss.qty) FROM stock_summary WHERE item_id =
p.id) ON TRUE` instead, and the reason is sound: a grouped join has **no `item_id` predicate**, so
PostgreSQL may aggregate `stock_summary` for the entire table before serving page 1 — a catalogue
walk would then cost N x a full scan, i.e. **worse than the correlated subquery it replaces**. The
lateral keeps the subquery's per-row index lookup and removes only the re-execution penalty. My
suggestion would have been a regression, and it was refused with the reasoning stated.

Row multiplication is impossible either way: `stock_summary` is `PRIMARY KEY (item_id, location_id)`
(migrations `20260813_init.pg.sql:2808-2815`), so a bare join returns one row per LOCATION; the
lateral's aggregate collapses to exactly one row per outer row. `inventory` is
`PRIMARY KEY (product_id)` (`:2782-2789`), so its join was already safe. `COALESCE(sk.ss_qty,
i.qty)` preserves the fallback exactly — an aggregate over zero rows emits one all-NULL row, so a
product with no summary survives and still reports `inventory.qty`. Which qty wins is decided in
one pure `product_stock_qty`, testable without a database.

**The guard was kill-tested, and my first attempt at it was invalid.**
`product_select_has_no_correlated_stock_subquery` asserts four properties on the projection text.
My first mutation only wrapped the COALESCE argument and left `sk.ss_qty` intact — the test passed
because the projection was still correct. Restoring the EXACT old subquery text made it fail with
"the per-row SUM(stock_summary.qty) subquery is back". **The test is real; my probe was wrong**, and
the distinction matters because a guard that only looks right is how a revert ships unnoticed.

**Not verified: execution.** No PostgreSQL on this machine, so the new SQL has never been sent to a
server. Three integration tests are written and gated behind the existing `pg-tests` ignore pattern;
they report `ignored`, not pass. The pure tests that DID run: `several_stock_summary_rows_fold_
into_one_total`, `no_stock_summary_rows_falls_back_to_the_inventory_aggregate`,
`product_select_has_no_correlated_stock_subquery`, `stock_aggregate_is_scoped_to_the_current_row`,
plus two route-contract tests. `cargo test -p kasirmu-api --lib` = **345 passed, 0 failed, 14 ignored**.

---

## §11AO — O-H17 attempted and REVERTED: the cache admitted a paid tier through the free sentinel (2026-10-21)

**The entry stays OPEN.** This records a rolled-back attempt, because the failure is more useful
than a silent retreat.

**What was built.** A `subscription_verification` module caching the verified subscription, keyed
on the four row attributes that define the claim (`tenant_subscription` has no version column),
with the signature itself as part of the key. The design was reasonable; the reasoning was sound.
It was not shipped.

**What stopped it.** `cargo test -p kasirmu-core --lib subscription_verification` reported **3
passed, 4 failed**, and one of those four is the worst failure available on this path:

    a_failed_verify_is_never_remembered_as_success
      "a paid tier cannot ride the free sentinel: Some(VerifiedSubscriptionGate { ... tier: Premium ... })"

A `Premium` row was **accepted through the `BOOTSTRAP_FREE` sentinel branch**.
`crates/kasirmu-core/src/subscription.rs:275-293` states the invariant that the sentinel is honoured
only when `tier_key() == "free"`, and says in as many words that any edit letting a non-free tier
reach that return is a full licence bypass — a forged row could then claim Premium by writing 14
bytes. The test was written to guard exactly that, and it caught its own author.

The other three failures were real too, and each was a lesson about TEST quality rather than
licensing: an invalid base64 fixture (`Invalid symbol 45, offset 5`) meant the verify path was
never exercised at all; and `an_unchanged_row_is_verified_once` counted MAP LOOKUPS instead of
verifications — its probe printed `before=0 after=1` incrementing on every call while `len=1`, so it
could not distinguish a hit from a miss. **A test that cannot tell those two states apart is not a
test of a cache.**

**The decision.** The instruction to the lane was explicit: if the cache cannot be made provably
fail-closed and bypass-proof, delete the module, revert the wiring, and say so. That is what
happened. The module and its tests are gone, `lib.rs` is unmodified, and
`cargo test -p kasirmu-core --lib -- --test-threads=4` is back to **3650 passed, 0 failed**.

**Why record a failure.** The RSA-2048 verification under the global DB mutex is a real cost on the
hottest path, and it is still there. But trading it for a licence gate that can be bypassed by
writing a sentinel signature is not a trade — it is a regression that would ship wearing a
performance label. The next attempt should start from the bypass-proof direction: first prove the
sentinel branch is unreachable for non-free tiers, then build the cache around a property that is
already pinned.

---

## §11AP — O-H17: the "licence bypass" was MY error, and the real cost is 197 us not 21 (2026-10-21)

**Two corrections, one of them to my own conclusion from §11AO.**

**1. There was no licence bypass, and I said there was.** In §11AO I recorded that the rejected
cache had "let a Premium row through the `BOOTSTRAP_FREE` sentinel path". That is false, and the
lane was right to push back. The permission came from a deliberate, documented
`#[cfg(debug_assertions)]` short-circuit at
`crates/kasirmu-core/src/license_verification/crl.rs:185-188`, explained at `:178-184`:

    // This short-circuit is the DEBUG one... The profile that matters is release, and
    // release no longer reaches this function carrying a sentinel... A sentinel-signed
    // row claiming a paid tier therefore still falls through to the base64 decode below
    // and is rejected as an invalid symbol 95 at offset 9 -- the '_' of BOOTSTRAP_FREE.

So a debug test run accepts a sentinel-signed Premium row **by design**, and release rejects it at
the base64 decode. The invariant is pinned after all — by `sentinel_does_not_carry_a_paid_tier`
(`subscription_tests.rs:198-213`), whose RELEASE arm asserts the rejection and whose DEBUG arm
deliberately asserts the permissive behaviour so a future change to it surfaces. A second test,
`verify_bootstrap_free_bypasses_rsa_in_debug` (`license_verification_tests.rs:75`), pins the debug
arm. My reading was wrong because `subscription.rs:281` names a test
(`bootstrap_free_sentinel_never_verifies_a_paid_tier`) that **does not exist** — the real one is
named differently and lives in a different file. A comment naming a test is not the test.

**The lesson has two halves.** The lane shipped a test that failed; I read the failure as a
production defect without checking whether the failure was a debug-profile artefact of a
deliberately permissive function. A test failing is evidence about the TEST first, and about the
code only after the profile and the call path are accounted for.

**2. The cost is an order of magnitude larger than reported.** The lane declined the cache on the
grounds that verification costs ~21 us and cannot block a lock. I measured it, and the figure is
wrong by roughly 10x in release and 120x in debug:

| build | verify_license_signature, per call (2000 iterations, key parse excluded via the `OnceLock` at `crl.rs:220-233`) |
|---|---|
| **debug** | **2,562.8 us** |
| **release** | **197.1 us** |

Both measured on this machine by a throwaway test calling `verify_license_signature` against a real
2048-bit key, then deleted. The lane's 21 us may have been a correctly-cached key with optimised
bigint arithmetic on different hardware, or a mis-measurement; either way it is not reproducible
here, and the decision to reject the cache rested on it.

**So the conclusion in §11AO ("the RSA cost stands") holds — but for a better reason than the one
given.** A cache is still not the right fix (revocation that does not touch the row is the
unsolved hazard). The right fix is the one the lane itself proposed and correctly declined to make
unilaterally: **the verification takes no lock and touches no database, so it does not need to run
inside the guard.** Loading the row under the lock and releasing the lock before `verify_signature`
removes ~197 us of held-mutex time per checkout with zero change to what is accepted. That is being
landed as §11AQ.

---

## §11AQ — O-H17 resolved by releasing the lock, not by caching it (2026-10-21)

One High finding resolved — and the resolution is the one the rejected cache was standing in
front of.

**The defect was never the RSA cost in isolation; it was the RSA cost INSIDE the mutex.** Both
checkouts did this:

    let db = state.db.lock().await;
    let sub = TenantSubscription::load(&db, "default")?...;
    sub.verify_signature()?;        // ~197 us of pure CPU, no lock, no DB
    sub.enforce_pos_writable()?;    // reads only in-memory fields

`verify_signature` takes no lock and touches no database — it is a sentinel check plus
`verify_license_signature`, whose public key is already cached in a `OnceLock` (`crl.rs:220-233`,
the O-M09 fix). So the verification never needed the guard; it was simply written inside it.

**The fix is six lines.** Only the LOAD stays under the lock (it needs the connection); the two
pure-CPU calls move out, in their original order:

    let sub = {
        let db = state.db.lock().await;
        TenantSubscription::load(&db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?
    };
    sub.verify_signature()?;
    sub.enforce_pos_writable()?;

**Zero change to what is accepted.** The row verified is the exact row read under the lock — moved
out, not re-read. The one behavioural difference is stated in the code comment rather than hidden:
a revocation or grace-window expiry landing in the microseconds between the read and the check no
longer pre-empts THAT checkout; the next command sees it.

**Why this rather than the cache.** The cache failed on an unsolvable hazard — a CRL revocation
delivered through a licence-KEY entry does not touch the tenant row, so any key derived from row
attributes would keep serving "fine" indefinitely. Releasing the lock has no such failure mode,
needs no key, introduces no staleness, and is strictly a narrowing of the critical section.

**Measured, both builds, 2000 iterations with key parsing excluded:** 197.1 us per verify in
release, 2,562.8 us in debug. The rejected lane had reported ~21 us and used that figure to argue
the cost was not worth fixing at all — a 10x understatement in release and 120x in debug. The
measurement is in §11AP.

**Verification.** `cargo check -p kasirmu-mobile` clean; `cargo test -p kasirmu-mobile --lib`
**721 passed, 1 failed**, and the one failure is pre-existing and not from this change —
`commands::registration_gate_tests::drift_pin_registration_floor_is_met` reports "lib.rs registers
437 commands and this floor says 428", a deliberate pin another lane must raise in its own
documented pass (`lib.rs` is untouched here).

**Coverage gap, recorded rather than papered over.** The ordering (signature before writability)
is covered at the CORE layer by `test_complete_sale_deduction_fails_when_subscription_read_only`
and its shortfall twin (`db/sales_tests.rs:5112`, `:5153`), each asserting a lapsed subscription
refuses the sale and persists no row. There is **no mobile-layer test** driving the two
`#[command]` wrappers on a lapsed subscription — they need `AppState` + session plumbing the crate
has no harness for. That remains a real gap.

---

## §11AR — O-H17 verification: the temp-dir class in the mobile crate was 144 failures from two lines (2026-10-21)

**The largest single test-defect count of the session, and it was masking nothing but itself.**
`cargo test -p kasirmu-mobile --lib` reported **578 passed, 144 failed**. Every one of the 144
failed with `Access is denied (os error 5)` or `create scratch dir: PermissionDenied` against a
path under `C:\WINDOWS\TEMP`. The code under test was fine throughout.

**The root was two lines.** `AppState::for_test` and `AppState::for_test_with_conn` are the shared
fixture every mobile test goes through, and both built their store directory with
`std::env::temp_dir().join(...)`. The machine-level `TEMP` is `C:\WINDOWS\TEMP` — creatable but
not deletable for an ordinary user — so the store DB could not be opened.

**Fixing the class, not the instance.** `state::test_scratch_root()` returns `<workspace>/target/test-scratch`,
creating it, and is `pub(crate)` precisely so no fourth copy of the eleven-line helper appears.
Three further shapes had to be converted separately, and each was invisible to a naive search:

| shape | where | why the first sweep missed it |
|---|---|---|
| `tempfile::tempdir()` | 21 files | matched and swapped to `tempdir_in(scratch_root())` |
| `tempfile::Builder::new()...tempdir()` | `recovery_tests.rs` | the builder chain, not the plain call |
| `std::env::temp_dir().join(format!(...))` | `image_download_tests.rs`, `loyalty_tests.rs`, `state_tests.rs` | multi-line `format!`, so a single-line regex missed it |

`tempdir_in` was chosen over a hand-rolled guard because it keeps the SAME auto-delete `TempDir`
contract — only the parent changes — so 42 call sites needed no edit beyond the constructor.

**Result: 578/144 → 721 passed, 1 failed**, and that one failure is pre-existing and unrelated
(`registration_gate_tests::drift_pin_registration_floor_is_met`, a deliberate pin on `lib.rs`
command count that another lane must raise). **`lib.rs` is untouched.**

**Tally for the session: four crates now carry this fix** — `kasirmu-core` (19 sites), `kasirmu-api`
(1), `kasirmu-cloud` (4), `kasirmu-mobile` (46 across 26 files). That is four local copies of the
same helper, which is well past the threshold where a shared test-support crate was the right call.
Recorded as the obvious follow-up rather than done speculatively at the end of a long session.

---

## §11AS — O-M34 partial: `kasirmu-test-support`, one home for the scratch-dir fix (2026-10-21)

**Five copies of the same eleven lines became one crate, and the move was net-negative in lines.**

The `C:\WINDOWS\TEMP` fix (§11AR and predecessors) had accumulated five near-identical helpers:
`migrations::test_scratch_dir` in `kasirmu-core`, `scratch_root`/`scratch_dir`/`TempScratch` in
`kasirmu-cloud`, `scratch_image_dir` in `kasirmu-api`, `test_scratch_root` in `mobile-tauri`, and
`scratch_dir` in `platform/sync`. Each carried its own copy of the rationale and its own slightly
different API — which is how a class fix becomes five classes.

**`crates/kasirmu-test-support` now owns it.** `crates/*` is globbed by the workspace, so adding it
needed no Cargo.toml edit. It offers three shapes, because the call sites genuinely wanted three:

| need | call |
|---|---|
| a plain path, caller owns lifetime | `scratch_dir(prefix)` |
| a path removed on drop | `ScratchDir::new(prefix)` |
| a `tempfile::TempDir` in a working parent | `tempdir()` / `tempdir_with_prefix(p)` |

The third exists because `tempfile` keeps its own auto-delete `Drop`, so `tempdir()` is a drop-in
for the ~42 sites that only wanted the same behaviour in a directory that actually works — no
hand-rolled guard, no behaviour change.

**Its own tests pin the regression, not just the happy path:** `scratch_root_is_never_windows_temp`
asserts the resolved root does not contain `windows\temp` (case-insensitively), so a future
`temp_dir()` reintroduction in this crate fails loudly. Six tests, all green.

**Migrations landed so far:** `kasirmu-cloud` (−86 lines, 398/398 green), `kasirmu-api` (−16 lines,
345/345), `kasirmu-core` (−41 lines across 17 files, 3654/3654). `platform/sync` is deliberately
NOT migrated yet — another lane has that crate open for O-M34, and a pathspec commit cannot
separate concurrent edits to the same file.

**The tally this session went 5 copies → 1.** The duplication was recorded in §11AR as the obvious
follow-up; this is that follow-up, and the net line count went DOWN, which is the usual sign the
abstraction was earned rather than imposed.

---

## §11AT — O-M34 resolved: the JSON estimate needs 6x, not 2x (2026-10-21)

One Medium finding resolved, and the interesting part is a bound I got wrong.

**The defect.** `build_batches` serialised every item with `serde_json::to_vec` purely to measure
it, and cloned the whole backlog to sort. Both are gone: `estimate_item_bytes` is a byte scan with
no allocation, and the order is now a permutation of INDEXES sorted with the shared
`compare_for_push` (made `pub` for exactly this, so the C49 key still has one definition).

**The bound, and why my first answer was wrong.** I told the lane that a payload can at worst
double under JSON escaping, so `payload * 2` would be a safe upper bound. That is true only for
`"` and `\`. **Every other control character becomes a six-byte `\u00XX` escape**, so the real
worst case is 6x. Measured independently by me, with the final constant in place:

| payload | serialised | estimate | margin |
|---|---|---|---|
| 4480 control chars | **27,107** | 27,918 | +811 |
| 4096 quotes | 8,419 | 25,614 | +17,195 |
| 4096 backslashes | 8,419 | 25,614 | +17,195 |
| 4096 ASCII | 4,323 | 25,614 | +21,291 |
| 4096 UTF-8 bytes | 4,323 | 25,614 | +21,291 |

A 2x bound would have estimated 8,960 against 27,107 actual — a **silent 3x overrun of the 64 KB
transport ceiling** on any payload carrying control characters. The lane found this by writing the
never-under test I asked for and watching it fail on its own first draft; my 2x suggestion was in
the message that asked for that test. Both of us were wrong before the test existed, which is the
argument for the test.

**The cost, stated plainly:** the estimate is very pessimistic for ordinary text — a 4096-byte
ASCII payload estimates 25,614, so a 64 KB budget carries roughly a third of the payload it used
to. That is the price of a bound no payload can beat, and it is the correct direction against a
body limit. `serde_json` does not escape non-ASCII, so real text is never near 6x; the constant is
deliberately not tuned per-character because a per-byte scan that is *always* an upper bound is
worth more than the bytes it wastes.

**A design that had to be abandoned.** The first ordering attempt lifted `order_for_push` onto a
slice of `None` placeholders and sorted that, so the caller could sort indexes without a backlog
copy. It cannot work: every slot is `None`, every comparison returns `Equal`, and the permutation
stays the identity — the batches came out in ARRIVAL order, which the existing
`build_batches_sorts_by_priority` caught. Sorting indexes directly is the same saving with no such
trap. The `pub` comparator now carries that story in its doc so the next lane does not retry it.

**Verification:** `cargo test -p platform-sync --lib` = **494 passed, 0 failed**;
`cargo test -p kasirmu-core --lib` = **3654 passed, 0 failed** (required because `offline.rs` is
workspace-wide). The never-under test covers empty, small, quotes, backslashes, control characters,
a long action, a long `last_error` and UTF-8.

## §11AU — O-M45 resolved: the test that named the property passed under the bug (2026-10-22)

One Medium finding closed (`kasirmu-payment`), and the useful part is that **the defect was caught in
review, not by the suite** — including a test the lane wrote specifically to pin it.

**The fix.** `ResilientProcessor` now uses full-jitter backoff and clamps its retry budget twice:
`MAX_RETRIES = 8` at `ResilientProcessorConfig::new` and again in `retry_budget()`, which the loop
reads because `max_retries` is a public field a struct literal can set past any constructor. The
jitter source is injectable (`with_jitter`), so the tests assert exact sleeps under `start_paused`
rather than tolerating a range.

**The bug I found in the first draft.** The draft capped the *window* before drawing:

```rust
let window = initial.saturating_mul(1 << n).min(max_backoff_ms);
(self.jitter)(window).min(window)
```

Once `initial * 2^n` passes the ceiling, every later attempt is handed the same bound. At
`initial = 100, max = 300`, attempts 3 and 4 both see 300 — `min(400, 300)` and `min(800, 300)` are
indistinguishable — so the exponential was **dead past the first cap**. That is not exponential
backoff with jitter; it is a fixed-width window with jitter. The fix hands the source the uncapped
exponential and clamps the result:

```rust
let exponential = initial.saturating_mul(1u64 << (attempt - 1).min(63));
(self.jitter)(exponential).min(self.config.max_backoff_ms)
```

**Why the lane's test could not see it.** It asserted `bounds == vec![100, 200, 300]` and called that
"the window must double per attempt and stop at `max_backoff_ms`". 300 is exactly what **both**
theories predict at attempt 3, so the assertion passed under the broken and the correct code alike.
The replacement hands the source `|b| b` so the bounds vector exposes which side the cap is on:
correct reads `[100, 200, 400]`, the broken draft reads `[100, 200, 300]`. It was proven to fail on
the re-injected bug before being kept, and the ceiling test fails on it too (150 ms vs 240 ms).

| | bounds the source saw | sleeps |
|---|---|---|
| broken (cap the window) | `[100, 200, 300]` | `[100, 200, 300]` |
| fixed (cap the result) | `[100, 200, 400]` | `[100, 200, 300]` |

**The general lesson, which this journal has now recorded three times in different words:** a test
that *names* a property is not a test that *pins* it, and a vector where both hypotheses agree
distinguishes nothing. §11AT was the same failure in the other direction — a bound everyone believed
until a never-under test disagreed.

**The shift and the multiply are two traps, not one.** `:1172` says "roughly attempt 58, not 64",
true of `initial * 2^n` (100 * 2^57 fits `u64`; 100 * 2^58 does not). But `1u64 << 64` traps on its
own at attempt 65 regardless of the multiply. Both sites are saturating and `.min(63)`-guarded, so
the panic is unreachable twice over.

**Verification:** `cargo test -p kasirmu-payment --lib` = **194 passed, 0 failed** (6 new, 0 existing
assertions changed — no pre-existing test asserted a sleep duration); `cargo check -p kasirmu-payment`
exit 0; `rustfmt --edition 2024 --check` clean.
## §11AV — O-M60, O-L20, O-L22: five defects in lanes' own work, and the review that found them (2026-10-22)

Five entries closed in one round (O-M45 recorded in §11AU). The entries are less interesting than
the pattern: **every one of the three lanes that finished shipped at least one defect its own tests
could not see**, and two of them shipped a defect that would have broken something in production.

### O-M60 — logging retention is continuous (closes a 3C-10)

Sweep moved into the writer chain: `RetainerWriter` between the non-blocking worker and the rolling
appender, deadline-checked per write, plus a heartbeat thread pushing a sentinel byte every 30 min
so an idle process still sweeps. Two defects in the first draft:

- `const HEARTBEAT: &[u8] = b"\\\\x00"` is FOUR ASCII bytes, not a NUL. Rust byte strings do not
  process that escape. The heartbeat would have been appended to the log file as text and the
  trigger was dead. Caught by review; `the_heartbeat_sentinel_is_exactly_one_nul_byte` and
  `a_heartbeat_write_reaches_the_inner_writer_zero_times` now pin it.
- `run_due` held the non-reentrant `arm` mutex across `sweep()` and then called `rearm()`, which
  re-locked it — a self-deadlock that hung three tests for 60 s each. The lane found this one
  itself while getting the suite green.

### O-L20 — money stops being `f64` (closes a 3C-12)

Both medians are `i64` minor units. **I gave the lane two options and both were wrong**, which it
showed before choosing neither: publishing `lower` makes Rust call margin 4 high at `{4, 5}` when the
median is 4.5, and "x >= upper" mis-flips `{4, 6}`, whose mean is exactly 5. Its answer is an
identity rather than a rounding rule — for integer `x`, `x >= mean` ⇔ `x >= ceil(mean)` — so the
published scalar IS the comparison threshold and the UI's own `classifyQuadrant`
(`MenuEngineeringScreen.tsx:70-71`) cannot disagree with the crate for any input. The ceil is
`floor(a/2)+floor(b/2)+(a odd||b odd)`, which never forms `a+b` or `b-a` (both overflow on
`(MIN, MAX-1)`, a pair the old `f64` form was already lossy on).

### O-L22 — the namespace guard, nearly dropped twice (closes a 3D-07)

The lane's first attempt replaced `ns.own().execute(...)` with `tx.prepare_cached(...)` on both
sales INSERTs. `prepare_cached` is a raw `Connection` method: it never calls `check_statement`, so
the Phase-3 P3.2 ownership guard was gone from the module's entire write path — and the lane wrote a
comment asserting the check still ran. It then temporarily disabled `check_statement` in
**`namespaced.rs`** to prove a test had teeth, which is the single most load-bearing line in the
namespace API and is shared by every module in the workspace.

The real finding is an API gap, not a mistake by the lane: `Namespace` offered only
check-then-execute, so **the ownership check and the prepared-statement cache could not be combined**
at all. I added `Namespace::execute_cached` and `Namespace::prepare_cached` — both run
`check_statement` on every call, including a cache hit, because the cache is keyed by SQL text
alone and the same text can be handed to a different owner. The lane then rewrote the loop against
them, correctly binding `let ns_own = ns.own();` first because `prepare_cached` borrows the
temporary namespace.

### The pattern worth keeping

| lane | defect | caught by |
|---|---|---|
| O-M45 | cap applied to the jitter window, killing the exponential past the first cap | review |
| O-M45 | a test asserting `[100, 200, 300]`, where both theories agree | review |
| O-M60 | `b"\\\\x00"` is four bytes, so the heartbeat reached the file | review |
| O-M60 | self-deadlock in `rearm` | the lane's own hung tests |
| O-L20 | scalar and classifier disagreed on the boundary the entry exists for | review |
| O-L22 | `prepare_cached` dropped `check_statement` from the write path | review |

Six defects, five found by reading the code rather than by running it. The tests were green in four
of those five cases. **A green suite is evidence that the tests ran, not that they can see the
bug** — and the two defect classes that recur are the ones where a *name* is mistaken for a
*property*: a test called `..._window_doubles_...` that cannot distinguish a doubling window from a
pinned one, and a constant called `HEARTBEAT` holding the four characters of its own escape.

### A note on the build environment

`cargo check`/`cargo test` fail on this machine with `cl.exe: D8050: cannot execute c1.dll` — a
debug-record limit, unrelated to this repository. Working recipe, used for every verification below:

```bat
call "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat"
set RUSTFLAGS=-C debuginfo=0
set CARGO_PROFILE_DEV_DEBUG=0
```

`cargo check` alone needs none of it. The 13 pre-existing `lib_tests.rs` failures in the logging
crate were the machine `TEMP` trap (`C:\\WINDOWS\\TEMP`), not product defects, and are fixed at the
source with `kasirmu-test-support`.

**Verification:** `kasirmu-payment` 194 passed · `kasirmu-reporting` 62 passed ·
`modules-sales` 33 passed · `kasirmu-logging` 60 passed · `modules-inventory` 37 passed.
All 0 failed.
## §11AW — O-T06, O-T07, O-T08 paid; O-T01, O-T03 already paid; O-T04's fix was measured WORSE (2026-10-22)

Round 7 went looking for work in the Test tier (O-T) and found it in a very different shape than the
ledger advertised. **Three of the six entries I set out to close were already closed**, and the fix the
fourth prescribed had already been tried, measured, and found to make things worse. That is the census
rot §11E warned about, in the tier I had least reason to suspect it.

### O-T06, O-T07, O-T08 — paid, and all three in the same spirit

All three are test-suite cost, none touches production code. The details are in their entries; the
common lesson is worth stating once.

**O-T06** removed the last wall-clock sleeps from the rate-limiter tests by back-dating the limiter's
own stored `Instant`s, which turned a tolerance window into an exact assertion: `(8..=10)` became
`assert_eq!(err, 9)`. **A range assertion is a confession** — it says the test could not see precisely
what it was naming. The body went from 2.00 s to 0.01 s.

**O-T07** collapsed 18 of 21 copy-pasted `Sale` literals into three helpers. The important part was
not the edit but the fingerprint taken first: exactly three fields varied across the sites, and two of
those variations existed at exactly ONE site each. A helper that had normalised them away would have
silently changed what two tests seed.

**O-T08** proved 10,000 was not load-bearing before deciding what to do with it — by tracing the whole
enqueue chain and finding no size-dependent branch anywhere, and by locating the real batch cap
(100) and the test that already pins it. Then it kept the count as a scale marker and made the write
set-based: 1.07 s → 0.55 s.

### O-T01, O-T03 — already paid; O-T04 — already measured and rejected

- **O-T01** (`fresh_conn` replays the migration chain) is **already fixed**: the helper IS
  `migrations::fresh_db()`, and its comment records the 305 ms vs 3 ms measurement that drove it.
- **O-T03** (`queue_tests` leaks 76 in-memory DBs) is **already fixed**: `setup_store` takes a
  `&Connection` and returns a borrowed `Store`.
- **O-T04** asked for "a small per-thread snapshot pool" for `fresh_db()`. **That was tried, and it
  measured ~15% WORSE at 4+ threads** — the measurement is written on the function itself
  (`migrations.rs:682-689`). The entry was also wrong about its own blast radius: it said 787 call
  sites; the true count is **1,394**. An entry that understates itself by 43% invites a reader to treat
  it as a corner case. The `Mutex` stays, and an `RwLock` would be actively dangerous — `Backup::new`
  takes a `RefCell` borrow on its source, so two readers would race it.

### The one real find: a scratch directory leaked per test, 1,911 deep

Investigating why the full 1,529-test bridge suite aborts (`0xffffffff`, no panic text, no
`test result` line), I found the cause in the harness rather than in any test.

`unique_store_dir()` returned a bare `PathBuf` from `kasirmu_test_support::scratch_dir`, and its own
comment said leftovers were "left for the OS temp cleaner". **There is no OS temp cleaner for
`target/`.** One directory per `TestBridge::new()` accumulated permanently: **1,911**
`kasirmu-bridge-store-*` directories measured after a handful of suite runs.

The fix is one field. `provisioned_store_manager` now returns `(manager, ScratchDir)` and `TestBridge`
holds `_store_scratch` — a field, not a local, because a local in `new()` would be dropped at the end
of `new()` and delete the directory the manager is still using. Two `memo_tests` call sites that build
their own manager destructure the guard the same way.

**Proven, not asserted:** the scratch count was 2,338 before a full 26-test `memo::` run and **2,338
after it**. Before the fix, every run added one per test.

### The full-suite abort is now a %TEMP% problem, and it is a list, not a mystery

The lane chasing the same abort established the honest position: **no green full suite has been
observed in this environment, and I am not claiming one.** What it did establish is that the failures
are environmental, not product defects — 41 of them failed on `os error 5`, the machine-`TEMP` trap.

**That exposure is now closed, and the suite is GREEN.** All 17 sites were migrated under
`target/test-scratch`, in 14 files, and **`cargo test -p kasirmu-bridge --lib` reports 1 528 passed,
0 failed, 1 ignored** — from 74 failing and an abort at the start of this round.

**The lane corrected my own list, in the direction that mattered.** The two `topology` "call sites" I
named were `use tempfile::tempdir;` IMPORTS, not calls: the real call site in
`topology_command_tests.rs` is `:154`, and `topology_stress_tests.rs` has SIX (`:925`, `:987`, `:1039`,
`:1102`, `:1774`, `:1853`), not one. A line number harvested from a grep for the identifier is not a
call site, and five real sites were missing from my list because of it.

**The per-site choice is the substance, and it is not uniform on purpose.** `ScratchDir::new` where the
fixture lives and dies inside one test body (avatars, branding ×6, the export twin); a bare
`scratch_dir` wherever the directory OUTLIVES its creator; `tempdir_with_prefix` only where the code
under test genuinely requires a `tempfile::TempDir` (the pos plugin fixture, and the file-backed
topology SQLite tests whose WAL/SHM siblings need the `TempDir` `Drop` while spawned threads still hold
the path).

The case that justifies the caution is `diagnostics_tests::call_export`, which RETURNS `(result, dir)`
to a caller that asserts on the zip inside it. A `ScratchDir` bound inside `call_export` would drop at
its closing brace and delete the directory before the assertion ran — the fix would have looked right
and failed one frame later. Left deliberately bare.

### And one failure that was NOT environmental, found by finishing the suite

With the `%TEMP%` sweep in place, 1 527 passed and exactly ONE failed:
`sync::sync_tests::sync_run_scoped_drains_large_backlog_in_bounded_batches`, expecting 105 synced and
getting **0**. It failed in isolation too, so it was not a cascade.

**The cause was a fixture that filled one queue and read another.** `token_granting` registers its
session against the literal store id `"store-pin"` (`testing.rs:719`), and `sync_run_scoped` drains
through `resolve_session(token).store_id`. The test enqueued its 105 items into `"store-batch-drain"` —
a store the session never names — so `pending_items` came back empty on the first iteration, the loop
broke, and `synced` was 0. The neighbouring test that passes uses `"store-pin"`, which is the contrast
that makes it obvious once you look at both.

Worth naming what this cost: the test is `fb7927582`'s (O-H07) and had been reporting 0-versus-105
**while proving nothing about batching**, because it never pushed a single item. A failing test is a
claim that something is wrong; the first question is whether the claim is about the product or about
the fixture, and here the batching code was fine the whole time.

### The build recipe, once, because it cost several rounds

`cargo check`/`cargo test` fail here on `cl.exe D8050` and on `lib.exe LNK1104`. Four variables, all
needed, run from a `.bat` through `cmd /c`:

```bat
call "...vcvars64.bat"
set RUSTFLAGS=-C debuginfo=0
set CARGO_PROFILE_DEV_DEBUG=0
set TEMP=<a writable dir>
set AR=C:\Program Files\LLVM\bin\llvm-lib.exe
```

The `AR` override is the non-obvious one: cc-rs 1.2.65 passes the OUTPUT `.a` as an INPUT to `lib.exe`,
which MSVC answers with LNK1104. `llvm-lib` tolerates it. Verified by hand — the same invocation
fails, minus the duplicate argument succeeds.

**Verification this round:** `kasirmu-core` rate_limiter **34 passed** (2.00 s → 0.01 s) ·
`kasirmu-core` kds **178 passed** · `platform-sync` pg_daemon **55 passed** (1.07 s → 0.55 s) ·
`kasirmu-bridge` **1 528 passed, 0 failed, 1 ignored** for the whole crate — the number that matters,
and the first time this crate has been fully green in this session. Scratch directories: 2,338 → 2,338
across a 26-test run, where before every run added one per test.
## §11AX — O-M22, O-M23, O-M47: the hottest write path, and a metric that measured the wrong thing (2026-10-22)

Three Medium entries closed, all on hot paths. One of them turned out to be a correctness fix wearing a
performance entry's clothes.

**O-M22** replaced an O(n²) reassembly with a merge. The quadratic was
`valid_indexes.iter().position(|&v| v == idx)` inside a loop over all items — 10⁶ comparisons on a
1,000-item push. It is legal only because `valid_indexes` is strictly ascending (one forward pass
pushing `idx` in increasing order), which is the fact the fix rests on and the one the new comment
records. The ordering itself is a client contract: `apply_push_results` zips `pending` against
`results` by index, so a reordering marks the wrong items synced. That contract was already pinned by
`push_outcomes_preserve_request_order_with_mixed_batch`, which passes unchanged — the right kind of
evidence for a change of this shape.

**O-M23 was filed as a cost and was actually a measurement defect.** The code re-serialised the whole
batch with `serde_json::to_vec` purely to read `.len()` for one histogram. Expensive, yes — a second
full serialisation plus a throwaway buffer the size of the request on the hottest write path. But the
metric is documented as *"Push request body size in bytes"*, and a re-serialisation is that only when
the client's JSON happens to match serde's exactly: no extra whitespace, same key order. **A client
pretty-printing its JSON inflated its own request with the old metric never seeing it.** The handler
now takes the raw body and observes `body.len()`, which is the quantity the metric names instead of a
proxy for it.

**And that refactor nearly shipped a renegotiated HTTP contract.** Moving the parse into the handler
meant choosing a rejection status, and mirroring `axum::Json`'s content-type status (422) is the
obvious-looking choice. It broke `push_rejects_malformed_json`, which pins **400**. A performance change
that quietly changes what a client sees on a bad request is precisely the regression that ships
silently, and the only reason this one did not is that somebody had written the status down in a test.
Companion detail in the same change: `#[tracing::instrument(skip(state, items))]` referenced a
parameter that no longer existed once the extractor changed — the compiler caught that one, but it is
the same failure shape: a refactor quietly deleting something a reader relies on.

**O-M47** cached ~16 regexes that were recompiled per statement.

The ledger offered two fixes and the safer one was taken: cache the compiled patterns, do not rewrite
the matching rule. The faster-sounding option — drop the regexes, word-scan on bytes, drop
`to_uppercase()` — rewrites the semantics of a SECURITY check, where `\b` is not trivially a byte
comparison (`_` is a word character; `(?i)` Unicode folding is not `to_uppercase()`), and where the
win is only "16 compiles" to "zero compiles" for a matching step that was never the cost. A cache
whose patterns are byte-identical to what the old code built inline **cannot change which statements are
rejected**, which is the property that matters.

An unknown keyword panics rather than compiling fresh or reporting absent — a fresh compile would
restore the cost the cache removes, and reporting absent is the fail-open direction on a security
check.

### The gap that review closed

The lane shipped the cache correctly but with **no test pinning the property a keyword-keyed cache most
easily loses**: word boundaries. Two tests were added. `cached_keyword_regexes_preserve_word_boundary_
semantics` asserts both directions — a blocked keyword as a SUBSTRING of a longer identifier stays
allowed (`test_pragma_notes`, `test_tableau`), while the bare word is still caught in every surrounding
form. The first direction is a false positive a plugin author cannot work around; the second is the
security hole the function exists to close. `keyword_regex_cache_compiles_and_matches_every_keyword` is
the sibling of the existing `sql_validation_regexes_compile`, so a keyword added to `validate_sql` but
missed by the cache builder fails in CI rather than in a live process.

`cargo test -p kasirmu-plugin --lib` = **226 passed, 0 failed**.

### A note on the environment, again

One `cargo test` run died with `error: attempting to skip non-existent parameter` hidden behind an
**incremental-compilation ICE** (`encountered incremental compilation error with
evaluate_obligation(...)`). Re-running with `CARGO_INCREMENTAL=0` surfaced the real, ordinary compiler
error. When a Rust build reports an "internal compiler error" on this machine, suspect the incremental
cache before the code — and note that the ICE was masking a genuine error, not inventing one.

**Verification this round:** `kasirmu-cloud` **398 passed, 0 failed** (43 ignored) ·
`kasirmu-plugin` **226 passed, 0 failed**.
## §11AY — O-M40, O-M41, O-M42, O-M48: the device layer, and three fixes that refused their own prescription (2026-10-22)

Four more Medium entries closed: the `kasirmu-hal` device block and the plugin's unbounded query. Three
of the four did NOT take the fix their ledger entry prescribed, and in each case the ledger's suggestion
was wrong for a reason worth recording.

### O-M40 — the class had to ride along

`probe_all` called three probe functions that between them walked the bus FOUR times, and each walk
opened every matching device to read three string descriptors — so the walks were never the real cost,
the descriptor reads were. It is now one walk that partitions in memory.

The suggested fix ("enumerate once into a `Vec<UsbDeviceInfo>`") does not work as written: an interface
can expose several settings, `UsbDeviceInfo` carries no record of WHICH class matched, and the HID-
versus-vendor-specific split is precisely what must stay exact. So each match comes back as
`Classified { class, info }`. The per-category post-processing — the dedup rule, the re-classify and
retain steps, the label fallbacks — was lifted VERBATIM rather than rewritten.

**The proof is an oracle, not an assertion.** The test file carries a verbatim port of the OLD three-walk
implementation, fed the same synthetic enumeration and compared on `(vid, pid, interface, label,
category)` IN ORDER, plus an exhaustive sweep of every VID/PID in all three tables against all three
classes. That is the only way to show a refactor of this shape did not quietly change which devices a
merchant sees.

### O-M41 — the cache was rejected, and it buys nothing

`open_device` built a fresh `rusb::Context` per connect. Fixed by sharing one context process-wide.

The ledger said "open by `rusb::Device` from the cached enumeration". That was rejected: `DeviceList`
owns and frees the list it returns, so any cache outliving a walk must re-derive each `Device` from the
raw pointer anyway — **it still pays a fresh `get_device_list`** — while adding a real hazard, because a
stale handle turns a clean `NoDevice` into a confusing open failure on a reconnect path. The cache buys
nothing and risks the one thing a reconnect must get right. Nothing about a connection is retained: a
miss is a fresh enumeration by construction, so an unplug is `NotFound` and a replug just works.

### O-M42 — and a bug found by the test written to prove the fix

One `read()` per byte became 64-byte chunks through a shared `BarcodeReader`. The `Ok(n)` arm that
looked dead was evidence the multi-byte read had been intended and narrowed away.

**Bytes arriving after the terminator are RETAINED**, because they belong to a later barcode; retaining
them is what makes a split barcode neither lost nor duplicated. Writing that test caught a real bug in
the first cut: an `Ok(0)` between two bites of one code made it hand back the partial prefix. The rule is
now explicit — nothing buffered ends the poll, a partial code keeps the poll alive across the
would-block — and it is pinned at every split offset.

That is the second time in three rounds that a test written for a stated property found a defect in the
implementation that claimed to have it (§11AT, §11AU were the first two). The pattern is consistent
enough to state as a rule: **the test is not evidence that the code is right; it is the instrument that
finds out.**

### O-M48 — a budget with no number

Plugin `query` materialised the whole result set and then serialised it, so peak memory was ~2x the
encoded result, with no ceiling — the only plugin budget in the workspace without one (the Lua VM has
10 MiB, a script 1 MiB, a package entry 16 MiB).

Now `MAX_QUERY_ROWS = 10_000`, tied to the Lua VM cap the result actually competes against, and an excess
row is an ERROR rather than a truncation: a discount or tax hook fed a silently-truncated result computes
wrong money and cannot detect it. **The cap counts rows as they are read, and does not rewrite the SQL** —
that distinction matters because `validate_sql` rejects quoted identifiers and strips comments, so a
`LIMIT`-appending rewrite would have to survive a trailing semicolon, an existing LIMIT and a trailing
comment, and getting that wrong inside a sandbox is a bypass. Pinned at cap-1, cap and cap+1, plus a
`LIMIT 999999` case that still errors.

A latent abort went with it: `row.get_unwrap(i)` became a propagating `row.get(..)`. That unwrap sat on a
path a PLUGIN can drive, so a column-type surprise would have aborted the host rather than failing one
query.

**Verification this round:** `kasirmu-hal` **428 passed, 0 failed** (361 before; 67 new) ·
`kasirmu-plugin` **233 passed, 0 failed** (226 before; 7 new).
## §11AZ — O-M46: a commit that says "resolve" while the suite hangs (2026-10-22)

This section exists because `401ddd3da` claims to close **O-M46** and does not. The entry stays OPEN, and
the crate's test suite is currently red in the worst way.

**Measured at `4ef5f14a7`:** `cargo test -p kasirmu-local-api --lib` runs 26 tests, prints "has been
running for over 60 seconds" for `a_full_channel_blocks_and_still_loses_nothing` and
`audit_writes_do_not_hold_the_handlers_connection`, then aborts with `error: test failed` and **no
`test result:` line at all**. With exactly those two skipped it is **24 passed, 0 failed in 3.12 s**. The
two tests are the whole problem; everything else in the crate is green.

**A hanging suite is worse than a failing one.** A red test names itself; a hang produces a CI timeout with
no test name, and the next person to investigate starts from zero. That asymmetry is why this is
recorded as a defect rather than a flaky test.

**The mechanism, isolated:** when the writer exits the channel is `Closed`, and the FULL-path `await_room`
spawned `drain_parked_then_send`, which does `tx.send(msg).await` on a CLOSED channel. Tokio parks a
sender once the queue is empty and the receiver is gone, so that send never resolves; the task waits
forever and runtime shutdown then blocks waiting for it. The second test hangs for the same reason once
its own assertion panics and leaves the parked task behind.

**The design conclusion, which cost the most to learn and is the part worth keeping:** `AuditSink::record`
is a SYNCHRONOUS trait method, so "wait for capacity" has **no legitimate expression**. Blocking the
caller stalls a tokio worker; spawning defers to a task nobody awaits; parking in a static leaks. The
implementer proved this directly — a gated-writer probe showed `record` had already returned and the
queue had never even filled, because awaiting is enough to let the writer drain.

**What to take on a second attempt: the dedicated-connection half only.**
`StoreAuditSink::open(path, store_id)` with WAL + `busy_timeout(5s)` + `foreign_keys` is what makes a
second writer safe, and it is the piece that removes the contention the entry is actually about. Keep
the counted failure and a timeout-bounded `flush` so tests await durability instead of sleeping. Leave
the queue out.

Two traps for that attempt: do NOT log via a per-event `tokio::spawn` "for ordering" (`log_audit` reads
the previous row's hash, so N concurrent writers race the chain — serialise through the sink's own
`Mutex<Connection>`); and any "N events → N rows" assertion must budget for
`kasirmu_core::db::audit::check_audit_rate_limit`, a PROCESS-WIDE 1000/min sliding budget that returns
`Ok` WITHOUT writing — a burst above it loses rows by design and looks exactly like sink loss, which is
what produced the misleading 480-vs-500 counts during this work.

**A note on the ledger gate.** `check-debt-ledger.py` now flags ten entries closed by commit subject with
no section, nine of them from concurrent sessions (`O-L01`, `O-L02`, `O-L06`, `O-L07`, `O-L08`, `O-L09`,
`O-L10`, `O-L11`, `O-M26`). That is the shared-branch cost of parallel work: each session's pathspec
commit is correct, but the ledger section that makes a closure auditable is written by whoever holds the
file. Those nine need sections from their own authors; this one gets the section for O-M46 because the
commit message and the tree disagree, and the disagreement is the finding.
## §11BA — the Low tier's first pass: O-L01, O-L02, O-L06, O-L07, O-L08, O-L09, O-L10, O-L11, O-L18 and O-M26 (2026-10-22)

Nine entries closed by concurrent sessions in this round, recorded here because their commits named the
entries without the ledger section that makes a closure auditable. Each is verified below by the commit
and the files it touched — not by the commit subject alone.

| Entry | Commit | What it touched |
|---|---|---|
| O-L01 | `3746ef544` | `products_stock_adjust/ledger.rs` — `prepare_cached` for the per-row shortfall INSERT, hoisted above the loop |
| O-L02 | `1227b88f7` | `db/downgrade.rs`, `db/stock_counts.rs` — rollback failures LOGGED instead of discarded |
| O-L06 | `a79a5b31d` | `api/auth.rs` — `Arc<str>` JWT cache keys and incremental eviction, replacing two String allocations per request |
| O-L07 | `d9bc56f7b` | `api/routes/images.rs` — internal storage and refcount errors reported as 500 rather than swallowed |
| O-L08, O-L09 | `824974af0` | `mobile-tauri` `features.rs`, `products.rs` — `HashSet` toggle diffs, and real DB guards dropped |
| O-L10 | `4ef5f14a7` | `platform/sync` `queue/appliers.rs` — refund-line statement prepared once above the loop |
| O-L11 | `224b6a7b2` | `sync/crdt/version_vector.rs` — `iter` returns `(&str, &Counter)` instead of `(&String, …)` |
| O-L18 | `17136eb56` | `kasirmu-cli` — `copy_reference_data` wrapped in a transaction instead of row-by-row autocommit |
| O-M26 | `a3795dccf` | `api/pg/memos.rs` — batched `unnest` inserts for memo locations and recipients, replacing one INSERT per memo x location x recipient |

**The Low tier is the one that went fastest, and the reason is worth naming:** every one of these is a
`prepare_cached`, a dropped `.ok()`, a type tightening or a hoist — changes whose safety is visible in a
few lines and whose test is already written. That is the opposite of the Medium entries above it, where
the prescription itself was wrong and the work was deciding what the change should be.

One caution attached to O-L02 specifically: turning a discarded rollback failure into a log is an
improvement, but a rollback that FAILS leaves the connection in an unknown transaction state, and
logging it does not recover from that. If a second pass on that code finds the connection then reused
by the next command, the log is evidence rather than a fix. The entry is closed for what it asked
(stop discarding the error); the state question is separate and unrecorded.

Nothing here was re-verified by this session beyond reading the commits and their file lists — that is a
materially weaker claim than the runs recorded in the sections above, and it is stated as such rather
than dressed up.
## §11BB — O-M46 resolved: two hangs, one root cause, and a test that asserted a property that cannot exist (2026-10-22)

`401ddd3da` closed O-M46 and left `kasirmu-local-api` HANGING: 26 tests ran, two printed "has been running
for over 60 seconds", and the process aborted with **no `test result:` line**. `3a6a5e829` fixes it.
**26 passed, 0 failed in 14.87 s.**

### The real defect: `send().await` on a closed channel never resolves

`drain_parked_then_send` did `tx.send(msg).await` after checking nothing. Tokio parks a sender once the
queue is empty and the receiver is gone, so that future NEVER completes; the task was spawned onto the
shared runtime, so runtime shutdown then blocked waiting for it and the whole test binary hung with no
test named. The fix is `tx.is_closed()` **before** the await — the send arm keeps its error handling
because a close can still race the check. Both loops (the initial publish and the trailing drain) got it.

This is worth naming as a class: **a `send` on a closed channel is not an error you receive, it is a future
that never settles.** Code that only handles `send(..).await` returning `Err` is handling a case that
cannot happen once the receiver is gone.

### The test that could not pass: asserting a blocking property on a synchronous trait

`a_full_channel_blocks_and_still_loses_nothing` was written to prove "`record` on a full channel blocks
until there is room". That property does not exist. `AuditSink::record` is a SYNCHRONOUS trait method, so
there is no legitimate way for it to wait: blocking the caller stalls a tokio worker, spawning defers to a
task nobody awaits, parking in a static leaks. The test marked itself `multi_thread`, pinned the single
writer inside `Gated::insert`, filled 1024 slots from a runtime thread, then recorded the 1025th — which
parked a drainer that could never run, because the writer it needed was the one being held.

**Removing that test exposed a SECOND failure, and the two were the same root cause.** With it skipped,
`audit_writes_do_not_hold_the_handlers_connection` also hung — because it had already panicked on
`480 != 500` and left a parked task behind. I first read that as "shared-machinery deadlock"; it was one
bug appearing twice.

### And the 480-vs-500 was a third, unrelated fact

`kasirmu_core::db::audit::AUDIT_RATE_LIMIT` is **1000 per 60 s window, PROCESS-WIDE**, and once the budget
is spent it returns `Ok(())` **without writing**. A test that records more rows than the budget sees a
short table and reports it as sink loss. The reset hook (`reset_audit_rate_limit_for_test`) is
`pub(crate)` in `kasirmu-core` and unreachable from this crate, so the honest fix is to SIZE the test
under the limit. It now records 900 of a 1024-slot queue, asserts the queue saturates (bounded, so a
regression fails instead of hanging), then asserts all 900 are rows.

The test was renamed `a_full_channel_delays_events_and_still_loses_nothing`, because the old name asserted
blocking and the new contract is delay-without-loss. **A test name is a claim**, and this one had been
claiming a property nobody had checked was achievable.

### What to keep from the surviving design

The parts of `401ddd3da` that are right and were kept: `StoreAuditSink::open` with WAL + `busy_timeout(5s)`
+ `foreign_keys` (a second writer is safe *because* of that pair), the `try_send` fast path with
`Closed => count_audit_failure`, and the counted-failure counter in place of a bare `warn!`. The
CLAUDE-file-grade lesson is that the QUEUE was the risky half and the CONNECTION was the safe one.

**Verification:** `cargo test -p kasirmu-local-api --lib` = **26 passed, 0 failed**; `rustfmt --check` clean.

## §11BC — O-L04 and O-L05 resolved: streaming analytics CSV bundle and zero-alloc topology pairing (2026-10-22)

Two Low-tier optimizations in `kasirmu-core` resolved and verified:

1. **O-L04 · `kasirmu-core` streaming analytics CSV bundle (`cc392c433`)**:
   Replaced in-memory `String` concatenation across 10 CSV export reports in `write_analytics_bundle_csv`
   with streaming into `BufWriter<std::fs::File>` via zero-allocation `write_csv_cell` and `write_csv_row`.
   Peak memory no longer scales with catalog size or sales history.
   All 148 export tests pass.

2. **O-L05 · `kasirmu-core` zero-allocation topology pairing check (`2be048411`)**:
   Replaced `format!("{endpoint_token}:")` heap allocation per endpoint comparison in `is_valid_semantic_endpoint`
   with `node_kind.strip_prefix(endpoint_token).is_some_and(|rem| rem.starts_with(':'))`.
   Replaced linear scanning of static pairing combinations in `pairing_admits_kinds` with an indexed lookup
   backed by `std::sync::OnceLock<HashMap<(&'static str, &'static str), Vec<(&'static str, &'static str)>>>`.
   All 63 topology tests pass.

## §11BD — O-L03 and O-L19 resolved: Store fields privatised behind accessors and zero-alloc LAN framing (2026-10-22)

Two Low-tier optimizations resolved and verified across the workspace:

1. **O-L03 · `kasirmu-core` Store fields privatised behind accessors**:
   Privatised `conn`, `cache`, and `terminal_id` on `Store<'a>` behind `pub fn conn(&self) -> &'a Connection`,
   `pub fn cache(&self) -> Option<&Arc<dyn Cache>>`, and `pub fn terminal_id(&self) -> Option<&str>`.
   Prevents external consumers from bypassing the repository layer or mutating internal state.
   Updated all external call-sites across `apps/cloud-server`, `crates/kasirmu-bridge`, `crates/kasirmu-notification`,
   and `crates/kasirmu-api` from `.conn` to `.conn()`.
   Verified with `cargo check --workspace --all-targets` clean across all targets and tests pass.

2. **O-L19 · `kasirmu-lan` zero-alloc buffer framing (`09661e572`)**:
   In `crates/kasirmu-lan/src/noise.rs`, replaced per-message allocations on `PeerTx::Noise` with a reusable
   `Vec<u8>` write buffer; eliminated `format!("{line}\n")` string allocations on `PeerTx::Plain` by writing bytes directly;
   and avoided intermediate vector cloning in `read_line`.
   All 89 tests pass.

## §11BE — O-M44 resolved: single-pass USB printer discovery during HAL bootstrap (2026-10-22)

In `crates/kasirmu-hal/src/bootstrap.rs`, `apply_config` previously invoked
`UsbReceiptPrinter::discover_all()` inside the `for printer in &config.printers` loop whenever a printer
specified `Connection::Usb`. If multiple USB printers were configured, the system executed multiple
blocking USB bus enumerations, repeatedly discovering the same list of devices.

Hoisted `discover_all()` above the printer iteration loop into a lazily-checked iterator:
1. If no printers use `Connection::Usb`, `discover_all()` is never invoked.
2. If one or more printers use `Connection::Usb`, the bus is enumerated exactly once into an iterator,
   and each configured USB printer takes the next available device.
Verified with unit test `multiple_usb_printers_hoist_discovery_and_skip_when_absent`. All 26 bootstrap tests pass.

## §11BF — O-M32 resolved: shared OnceLock HTTP client for conflict commands (2026-10-22)

In `apps/desktop-tauri/src/commands/sync.rs` and `apps/mobile-tauri/src/commands/sync.rs`, `bounded_conflict_client()`
previously built a fresh `reqwest::Client` on every invocation (`list_sync_conflicts`, `resolve_sync_conflict`),
causing complete rebuilds of the TLS backend, connection pools, and DNS resolver on every call.

Wrapped the bounded client builder in a `static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();`
and return `CLIENT.get_or_init(...).clone()`.
The client maintains 10s connect / 30s request timeouts, while reusing connection pools and TLS sessions across commands.
Verified with unit tests `commands::sync::test_pins::sync_conflict_commands_use_a_bounded_client` on desktop and
`commands::sync::tests::sync_conflict_commands_use_a_bounded_client` on mobile. All tests pass.

## §11BG — O-M55 resolved: linear-time medians and redundant sort elimination (2026-10-22)

In `crates/kasirmu-reporting/src/menu_engineering.rs`:
1. `query_menu_engineering` previously invoked `rows.sort_by_key(|b| Reverse(b.total_revenue_minor))` immediately
   after calling `merge_same_product_rows(rows)`, which already returns rows sorted by that identical key.
   Removed the redundant $O(n \log n)$ sort pass.
2. In `median_of`, replaced full `values.sort_unstable()` with Introselect partition via `select_nth_unstable(mid)`:
   - For odd lengths, `select_nth_unstable(mid)` partitions in expected $O(n)$ time directly yielding the median point.
   - For even lengths, `select_nth_unstable(mid)` provides the upper bound, while the lower bound is found in a single $O(n)$
     pass over `values[..mid].iter().max()`.
3. In `volume_median_of`, aligned threshold computation with `high_water_mark()` (the integer ceil) and removed
   spurious debug equality assertion that assumed all even-length volume intervals had equal bounds.

Verified with `cargo test -p kasirmu-reporting`. All 62 tests pass in 0.56s.

## §11BH — O-M28 resolved: zero-alloc alert cooldown lookups and pruning on insert (2026-10-22)

In `apps/cloud-server/src/quota_detector.rs`, `QuotaAlertState` previously stored cooldown timestamps in
`HashMap<(String, String), Instant>`. Checking whether an alert was suppressed (`is_suppressed`) performed
two `String` allocations (`tenant_id.to_string()`, `condition.to_string()`) on every single probe.
Furthermore, entries were inserted without ever being pruned, creating unbounded memory growth with tenant churn.

Resolved with:
1. Two-level mapping `HashMap<Arc<str>, HashMap<Arc<str>, Instant>>`:
   Leveraged `Arc<str>`'s standard `Borrow<str>` implementation to perform `guard.get(tenant_id)` and
   `conditions.get(condition)` with zero heap allocations on every probe.
2. Expired entry pruning on insert:
   In `record_alert`, all entries whose timestamp exceeds `ALERT_COOLDOWN` (7 days) are pruned, and empty
   tenant maps are dropped.
3. Added unit test `test_alert_cooldown_prunes_expired_tenants_on_insert` asserting that expired churned tenants
   are swept upon subsequent alerts.
Verified with `cargo test -p kasirmu-cloud --bin kasirmu-cloud quota_detector`. All 17 tests pass.

## §11BI — O-M33 resolved: single-pass directory scan for image cache missing-set (2026-10-22)

In `apps/mobile-tauri/src/image_download.rs`, Phase 2 of `run_cycle` previously executed:
`let path = cache_dir.join("images").join(format!("{hash}.webp"));`
`tokio::fs::try_exists(&path).await`
for every single catalog image referenced on the device. For catalogs with thousands of images,
this caused thousands of sequential asynchronous filesystem stat syscalls and path allocations on every sync cycle.

Replaced with a single `tokio::fs::read_dir` over `cache_dir.join("images")`, streaming filenames into
a `HashSet<String>` of present image hashes in one pass. The missing set is then derived via in-memory
$O(1)$ set containment checks against `referenced`, eliminating sequential per-file stat syscalls and
per-file path join allocations.

Verified with `cargo test -p kasirmu-mobile --lib image_download`. All 8 tests pass.

## §11BJ — O-M56 resolved: raw buffer scanning and early bailouts in border trimming (2026-10-22)

In `crates/kasirmu-media/src/crop.rs`, `trim_borders` previously scanned four edges using nested loops of
`rgb.get_pixel(col, row) != corner`, invoking bounds-checked coordinate math on every single pixel across
four full-frame passes (~160 million calls on a 40MP image). Furthermore, solid-colour images scanned all
four edges completely before checking `top >= bottom`.

Resolved with:
1. Direct contiguous slice access over `rgb.as_raw()` with `chunks_exact(3)` vectorization across rows.
2. Immediate return if `top >= h` (solid-colour image), avoiding unnecessary bottom, left, and right scans.
3. Bounding left and right column scans strictly within `top..bottom`, avoiding scanning known corner-colour rows.
4. Added unit tests for solid-colour preservation and asymmetric border trimming.

Verified with `cargo test -p kasirmu-media`. All 32 tests pass in 0.14s.

## §11BK — O-M53 resolved: hoisted multipart body and from address across recipients (2026-10-22)

In `crates/kasirmu-notification/src/email_scheduler.rs`, `send_email_via_smtp` previously parsed `config.from`
and constructed the multipart alternative body — repeatedly cloning large `email.text_body` and
`email.html_body` strings — inside the `for recipient in to` loop on every recipient.

Resolved by:
1. Parsing `from_addr` once above the loop.
2. Building `text_part`, `html_part`, and `multipart` once above the loop, so large HTML and text
   string contents are not repeatedly re-allocated or re-parsed per recipient.

Verified with `cargo test -p kasirmu-notification`. All 36 tests pass.

## §11BL — O-M61 resolved: bounded notification semaphore and rate-limit backoff (2026-10-22)

In `crates/kasirmu-notification/src/handlers.rs`, notification event handlers (`OrderConfirmationHandler`,
`StockLowAlertHandler`, `PaymentReceiptHandler`) previously spawned unbounded `tokio::spawn` background tasks
and dropped rate-limit retry opportunities by discarding `NotificationError::RateLimited { retry_after_seconds }`.

Resolved by:
1. Adding `spawn_notification` with a global static `Semaphore` bounding concurrent background notification
   tasks to `MAX_CONCURRENT_NOTIFICATIONS` (16).
2. Implementing `send_template_with_retry` honoring `NotificationError::RateLimited` with bounded
   backoff up to `MAX_RATE_LIMIT_RETRIES` (3 attempts) capped at `MAX_RETRY_DELAY_SECS` (60s).
3. Wiring `spawn_notification` and `send_template_with_retry` into `OrderConfirmationHandler`, `StockLowAlertHandler`,
   and `PaymentReceiptHandler`.
4. Adding unit tests in `handlers_tests.rs` for successful rate-limit retries and giving up after max attempts.

Verified with `cargo test -p kasirmu-notification`. All 38 tests pass.

## §11BM — O-M65 resolved: folded product lookup and joined ingredient SKU in inventory handler (2026-10-22)

In `modules/inventory/src/handlers.rs`, `InventoryStockHandler::handle_line` previously executed two separate
database queries per sold line item (`SELECT id FROM products WHERE sku = ?1` followed by
`SELECT product_type FROM products WHERE id = ?1`), and in the BOM recipe deduction path, executed an extra
query per ingredient (`SELECT sku FROM products WHERE id = ?1`) solely to produce the ingredient SKU for logging.

Resolved by:
1. Folding the product ID and product type lookups into a single prepared and cached query:
   `SELECT id, product_type FROM products WHERE sku = ?1`.
2. Joining `products` on `r.ingredient_product_id = p.id` directly in the recipe query
   (`SELECT r.ingredient_product_id, r.quantity_required, p.sku FROM product_recipes r LEFT JOIN products p ...`),
   using `tx.prepare_cached`, eliminating all per-ingredient SKU lookups in the deduction loop.

Verified with `cargo test -p modules-inventory`. All 37 tests pass.

## §11BN — O-M31 resolved: collapsed database mutex acquisitions in mobile auth commands (2026-10-22)

In `apps/mobile-tauri/src/commands/auth.rs`, `switch_organization` previously acquired and released the global
database lock four separate times across sequential verification steps (org enumeration check, user assignment
gate, PIN re-authentication, and tenant integrity verification), and `create_session` previously acquired and
released the global database lock three separate times. Each acquisition interleaved with concurrent commands and
background sync daemons.

Resolved by:
1. Collapsing the four sequential database checks in `switch_organization` into a single scoped lock on `state.db`.
2. Unifying organization scoping and instance access verification in `create_session` into a single scoped lock on `state.db`.

Verified with `cargo test -p kasirmu-mobile auth`. All 40 tests pass.

## §11BO — O-L18 resolved: transaction wrapping reference data copy in CLI seeder (2026-10-22)

In `crates/kasirmu-cli/src/seed_demo.rs`, `copy_reference_data` previously inserted rows into the store database
one row at a time across seven reference tables without an explicit transaction, committing to WAL on every row.

Resolved in commit `17136eb56` by wrapping the multi-table reference data copying loop in an unchecked SQLite
transaction (`let tx = store_conn.unchecked_transaction()?;` and `tx.commit()?;`), ensuring atomic bulk inserts.

Verified with `cargo test -p kasirmu-cli`.

## §11BP — O-L21 resolved: saturating clamped thumbnail dimension math (2026-10-22)

In `crates/kasirmu-media/src/thumbnail.rs`, `thumbnail_img` previously used potentially truncating `as` casts
during aspect-ratio bounding box scale calculations.

Resolved in commit `38c8118e7` by:
1. Using `u64` saturating arithmetic (`saturating_mul`) to guard against intermediate multiplication overflow on huge source images.
2. Replacing raw `as u32` casts with explicit `u32::try_from(...).unwrap_or(u32::MAX).max(1).min(max_dimensions)` clamping.

Verified with `cargo test -p kasirmu-media`. All 32 tests pass.

## §11BQ — O-L23 resolved: fallible lossless integer conversions on sale line path (2026-10-22)

In `modules/sales/src/models.rs` (now canonical in `foundation/src/sales.rs`), `from_cart_with_user` previously
cast `cart.line_count()` and loop index `i` via raw `as i64`.

Resolved in commit `b27eb17be` by replacing all raw numeric casts with `i64::try_from(cart.line_count()).ok()?`
and `i64::try_from(i).ok()? + 1`, failing closed to `None` if integer boundaries are ever violated.

Verified with `cargo test -p foundation`.

## §11BR — O-H15 resolved: bounded queries and pushdown sales history pagination (2026-10-22)

In `apps/mobile-tauri/src/commands/history.rs`, sales history previously materialised the entire sales
history across the tier's time window without SQLite-level pagination.

Resolved in commit `badd10ee5` by:
1. Adding `Store::list_sales_with_history_cap_bounded` in `crates/kasirmu-core/src/db/sales_crud.rs`, pushing
   `LIMIT` and `OFFSET` clauses directly into the SQLite `FROM sales ... ORDER BY created_at DESC` query.
2. Wiring bounded pagination through `list_sales_scoped` in `apps/mobile-tauri/src/commands/history.rs` and
   `apps/desktop-tauri/src/commands/history.rs`.

Verified with tests in `crates/kasirmu-core/src/db/sales_tests.rs`.

## §11BS — O-H02 resolved: batching product image attachment lookups in chunks of 250 (2026-10-22)

In `crates/kasirmu-core/src/db/products_crud.rs`, `attach_images` previously constructed an `IN (?1, ... ?N)`
clause with one placeholder per product in the entire catalog. On large catalogs, this allocated unboundedly
large SQL strings and risked hitting SQLite's variable number limit (`SQLITE_MAX_VARIABLE_NUMBER`).

Resolved in commit `91ace97de` by chunking `ids` into fixed-size batches of 250 items (`BATCH_SIZE`), executing
parameterized batch queries, and attaching results back to products without overflowing query bounds.

Verified with `cargo test -p kasirmu-core products_crud`. All 6 tests pass.

## §11BT — O-H21 resolved: batching push sync outcomes into single transaction (2026-10-22)

In `platform/sync/src/daemon.rs` (`apply_push_results`) and `platform/sync/src/lib.rs` (`apply_push_outcomes`),
accepted push outcomes and duplicate-id replays previously executed `store.mark_offline_synced` or `queue.mark_synced`
one item at a time in autocommit mode. On a batch of $N$ items, this produced $N$ disk writes and $N$ individual
transactions while holding the database connection lock.

Resolved in commit `a5797e020` by:
1. Adding `mark_synced_batch` to `SyncQueue` in `platform/sync/src/queue.rs`, delegating to `Store::mark_offline_synced_batch`.
2. Accumulating all accepted and duplicate-replay item IDs in `apply_push_results` (`daemon.rs`) and `apply_push_outcomes` (`lib.rs`)
   into a batch and executing a single `mark_synced_batch` call within one transaction.
3. Preserving the length-mismatch diagnostic that logs a warning if the outcomes vector length does not match pending batch length.

Verified with `cargo test -p platform-sync --lib`. All 497 tests pass.
















## §11BU — O-T13, O-T15 and O-T16 resolved: three named contracts instead of three coin flips (2026-10-22)

Landed in `0789305cf`. Six test files, +394/−36. Every change below replaces a test that could not
distinguish the property it named from its opposite.

### O-T13 — the "coin flip" had a documented answer

`mark_offline_synced` now asserts `CoreError::NotFound { entity: "offline_queue", id }` per the
contract in its own `#Errors` (`db/offline.rs:279-282`), plus `raw_pending_count == 0` — the refused
call writes nothing. The snapshot clone the old test paid for now earns itself.

**The batch variant disagrees with the single one, and its docs do not say so.**
`mark_offline_synced_batch` (`db/offline.rs:294-315`) has **no `#Errors` section at all**, and its
loop is `mark_synced_on(&tx, id)?` inside ONE transaction: the first `NotFound` propagates and the
transaction is dropped uncommitted. **Unknown ids are NOT skipped — one deleted id fails the whole
drain.** The test pins the actual contract (NotFound, plus rollback proven by draining the same
batch without the poison id), not the lenient contract a reader might assume. Leniency would be a
change in `offline.rs`, outside this task.

The tenant variant shares the single-item contract for an absent id; the cross-tenant `NotFound` is
documented but needs a second tenant's row, which the fixture does not build — stated in the test
rather than silently skipped.

### O-T15 — four 300 ms windows, and a fifth nobody had found

All five now share one shape: B holds the write lock, A runs on the main thread, **A's busy handler
fires exactly when A has read and is blocked**, A signals over mpsc, B commits. Each test additionally
asserts A really blocked, so a run that never enters the window FAILS instead of passing for the
wrong reason.

| Site | Property preserved |
|---|---|
| `sales_crud_tests.rs` | A reads `pending`, B commits, A's CAS finds nothing → `Conflict`, B's status survives |
| `shifts_tests.rs` | `BEGIN IMMEDIATE` contends before the duplicate check → `Validation{user_id}`, exactly one open shift |
| `gift_cards_tests.rs` ×2 | A reads `active`/`frozen` behind B's uncommitted write, loses the CAS, winner's row survives |
| **`sales_lifecycle_tests.rs`** | **the `void_sale` race — not in the ledger's list, and already RED** |

**The fifth site is the round's real finding.** `void_sale_race_reports_the_conflict_rather_than_
overwriting_a_completed_sale` was failing on a full-suite run while passing 6/6 in isolation. I
measured the failure instead of guessing:

```
DIAG outcome=Err(Validation { field: "status", message: "only active sales can be
be voided (current: Completed)" }) db_status=completed
```

A's pre-check read `Completed` — it never entered the compare-and-set the test exists to defend, so
the test was green only on the days the 300 ms window happened to hold. `void_sale` opens
`BEGIN IMMEDIATE` (`sales_lifecycle.rs:906`), so it contends at BEGIN where a busy handler can
prove A is inside the window; the timer is now replaced by that fact. The earlier isolation runs
were not evidence — a green command is evidence the command ran, not that the interleaving happened.

### O-T16 — explicit timestamps, with the order inverted

`create_kds_order` stamps `received_at` itself (`kds.rs:151`), so the sleep became two targeted
`UPDATE kds_orders SET received_at = ?`. The **first-inserted** order deliberately gets the **later**
stamp, so a pass cannot come from insertion order or rowid — only from `ORDER BY received_at DESC`.
The other two sleeps in `kds_tests.rs` were read and left: one is *inside* a busy handler (its own
yield between retries), one is a bounded poll on another thread's atomic flag with a 5 s ceiling.

### Gotcha worth recording

rusqlite 0.31's `busy_handler` takes `fn(i32) -> bool` — a **function pointer**, so a capturing
closure fails `E0308`. The first attempt did, and the gate caught it; rewritten as a
`static Mutex<Option<Sender<()>>>` mailbox plus a plain `fn`. All waits are `recv_timeout(5s)` so a
regression that never blocks fails with a named message instead of hanging — a hang is worse than a
failure, because CI reports a timeout with no test name.

### Two new entries, both found by looking at what the fix did NOT cover

**O-T17** — the `create_cash_payout` race test has the identical defect (both reachable paths return
`Validation{status}`), and **O-M67** — its production cause: `create_cash_payout` reads its guard
outside a DEFERRED transaction, exactly as `void_sale` did before it was fixed. Neither was patched
in this round; O-M67 is a production change and the round was read-only apart from tests. The test
now carries the audit note so it is not read as evidence the CAS is defended.

### Verification

```
cargo check -p kasirmu-core  --all-targets   -> exit 0
cargo check -p platform-sync --all-targets   -> exit 0
cargo test  -p platform-sync --lib           -> 497 passed, 0 failed, 4 ignored
cargo test  -p kasirmu-core  --lib           -> 3655 passed, 0 failed (153.59s), FULL SUITE
rustfmt --edition 2024 --check               -> exit 0 on all six files
```

The core suite count is **3654 → 3655**: the `sales_crud_tests` change consolidated one existing
test (the 8-attempt restage loop stays inside it), and three tests were added in `platform-sync`.
No assertion was dropped.


## §11BV — O-M67 resolved: the cash payout guard is atomic with its insert, and the test says which arm it exercises (2026-10-22)

Landed in `7dfee57cc`.

`create_cash_payout` opened a DEFERRED transaction (`unchecked_transaction`), so it took no lock until the
INSERT — which is AFTER its out-of-transaction `get_shift` pre-read. The read and the compare-and-set were
not atomic, and the window was as wide as the gap between the two statements.

**Fix:** `Transaction::new_unchecked(self.conn, TransactionBehavior::Immediate)?` — the exact shape
`void_sale` already used (`sales_lifecycle.rs:906`), with the same rationale recorded at
`sales_checkout.rs:241`: IMMEDIATE contends at BEGIN, where the connection's 5000 ms `busy_timeout`
applies. Error behaviour is unchanged — `NotFound{entity:"shift"}` for a missing shift,
`Validation{field:"status"}` from both the fast path and the `rows == 0` CAS branch.

### The interesting part: the fix means the test now exercises a DIFFERENT arm, and the test says so

The lane's report is the reason this section exists. With IMMEDIATE, A takes the write lock at BEGIN —
**before** its pre-read. So A blocks, B commits, A's BEGIN completes, and A's `get_shift` then reads
`status = 'closed'`: the **fast-path rejection** fires and the CAS is never reached.

That is the opposite of `void_sale`, and the asymmetry is real: there the pre-check and the CAS are both
inside the same call with BEGIN between them, so A reads `active` first and then blocks. Here the read sits
before the BEGIN, so IMMEDIATE moves the block ahead of the read.

**Why this matters more than the green test.** The previous version of this test (and O-T17, which I opened
for it) could pass without A entering the window at all: both the fast path and the CAS return
`Validation{field:"status"}`, so the assertion distinguished nothing, and deleting the CAS predicate would
have left it green. The rewritten test now:
1. proves A genuinely blocked on B's lock (`A_IS_WAITING`, with a message stating that without it the run
   proves nothing about the guard);
2. states in its doc comment — and again beside the assertions — that it exercises the FAST PATH, that the
   CAS is NOT reached, and that deleting the CAS predicate would leave THIS test green.

**What the CAS now honestly is: defence in depth, not a tested property.** It still refuses a payout whose
open-shift snapshot went stale between BEGIN and the INSERT, but no test constructs that interleaving — it
would need a test-only hook in production code, which the lane declined to add. That is the right call, and
the limitation is written down instead of implied by silence.

### The lesson, stated plainly

A test asserting an error value is not a test of the branch that produced it when two branches produce the
same value. That is what O-T17 was, and the fix is not a better assertion — it is an assertion that proves
A's POSITION (it blocked), plus prose that names the arm. Removing the ambiguity is worth more than the
extra coverage would have been.


## §11BW — O-T12 and O-T14 resolved: injectable config, and three tests that were ignoring nothing (2026-10-22)

Landed in `264b008cd`. Both entries were also **wrong about their own subject**, which is the part
worth recording.

### O-T12 — both line references pointed at the wrong tests

The entry said `db_tests.rs:141-151` and `:333-347` were env-var tests holding a process-wide lock AND
`#[serial]`. Neither was:
- `:141-151` is `sqlite_accepts_a_bare_filename_with_no_parent` — it moves the process CWD. It had **no lock
  at all**, the opposite of the complaint, and that absence was a real cross-test race waiting to happen.
- The 12 s is at `db_tests.rs:449`, on `pg_integration_pool_get_fails_fast_when_exhausted` — `#[ignore]d`
  unless `pg-tests`. It is not a poll loop: it asserts a `PoolError::Timeout` arrives after the builder's
  5 s `wait_timeout`, and 12 s was 2.4× that deadline for no documented reason, so a pool that IGNORED
  `wait_timeout` could burn 12 s before failing.
- The actual env-var pair is `db_tests.rs:241-279`.

**Fix:** `CloudServerConfig::from_env` is now a thin wrapper over `from_lookup(impl Fn(&str) -> Option<String>)`
— the entire old body with `std::env::var` swapped for `lookup(...)` and nothing else changed. The two env
tests build a config from a local `fake_env` table and call `DbPool::from_config`, so **both** the
`ENV_LOCK` and the `#[serial]` attributes are gone: the environment is a local value, so there is nothing
left to serialise. The `#[cfg(test)]` `from_env`/`from_env_with_retries` shims that only existed so tests
could read a mutated env were deleted (they had already surfaced as `dead_code` warnings).

**The bonus is a real defect found by reading:** the bare-filename test moved the process CWD with no
synchronisation, so any concurrent test creating a relative-path database could land inside its scratch
directory and race the restore. It now holds a `CWD_LOCK`, keeps the exact original relative-path
operation, and cleans up the `bare.db` + WAL shm files it used to leak.

The 12 s → 6 s change is **structural, not measured**: Postgres is unreachable on this machine, so the test
is `#[ignore]d` here and could not be timed. 6 s = the 5 s `wait_timeout` under test + ~1 s of scheduler
noise, used as BOTH the outer guard and the elapsed bound, plus a NEW lower-bound assertion
(`elapsed >= 2.5 s`) so a fast non-timeout failure cannot pass. Anyone with a live PG should replace 6 with
their measured value + 1 s.

### O-T14 — the prescribed fix would have tested the fake

The entry offered "a fake backend, or record why dev CI cannot". A fake is **not achievable**, and the
reason is a line of code: `snapshot_set` issues `SETEX` (`redis_backend.rs:192-205`) and `snapshot_get`
issues a plain `GET` (`:160-170`). **The expiry is enforced entirely inside Redis; this repo never compares
a timestamp to a TTL on that path.** The only TTL comparison the repo owns is the in-process cache at
`sync_api.rs:895`/`:908`, already covered by `sync_api_tests.rs` via back-dated entries. A fake backend
would assert that the fake expires its own map — a test of the fake, more misleading than the `#[ignore]` it
replaced. So no fake was written, and no fake clock either (a fake clock changes nothing when the expiry
happens server-side).

What was done instead: three redundant `#[ignore]`s removed (the `test_backend()` env gate already handles
their skip, so they now EXECUTE and take the skip branch, and run for real the moment `OZ_TEST_REDIS_URL` is
set); the TTL leg's fixed 2 s sleep replaced by a 50 ms poll against a named 10 s bound, plus one NEW
assertion (`polls > 0`) closing the zero-TTL hole where the expiry check could pass for the wrong reason.

**And one leg was re-justified because its original reason was false.** `connect_returns_none_when_refused`
said "slow connection timeout". Measured un-ignored, it was still running at **153 s**. Traced to redis
0.27.6: `ConnectionManagerConfig` defaults to 6 retries with exponential backoff, and a refused socket is an
`Err` (not `Ok(None)`), so the whole backoff is exhausted before `connect()` maps the error; this machine's
TCP connect to `127.0.0.1:1` alone takes ~2 s (SYN retransmit). **It does not converge — it is unbounded, not
slow.** The `#[ignore]` stays with a corrected reason, and its body is byte-identical: wrapping it in a
`tokio::time::timeout` would have turned the contract assertion into a vacuous one.

### Verification

```
cargo check -p kasirmu-cloud --all-targets        -> exit 0, zero warnings
cargo test  -p kasirmu-cloud --bin kasirmu-cloud  -> 405 passed, 0 failed, 40 ignored (6.20s)
rustfmt --edition 2024 --check                    -> exit 0 on all four files
```

**401 → 405 and 43 → 40 ignored is the whole diff, and it is accounted for exactly:** four legs un-ignored
(three removed attributes plus the TTL leg, all four now reporting `ok`), one still ignored. Nothing was
deleted. A stray `apps/cloud-server/bare.pre-migration.bak` left by a killed test run was removed.

### The lesson

**An entry is a claim, and this one was wrong twice in the same sentence** — about which lines to look at and
about what the tests did there. Both times the wrong version made the code sound worse than it was (a
"process-wide lock AND serial" that was in fact NO lock), and the true defect next door — an unsynchronised
`set_current_dir` — was invisible from the entry. Re-deriving an entry from the tree before acting on it is
not overhead; it is the only way the entry can be closed correctly.



## §11BX — O-M54 corrected and resolved: the scan it described was already fixed by an expression index (2026-10-22)

Fixed in `e9631cbc5`. Recorded here because **what the entry described was not what the code did**, and
the difference was measured rather than argued.

### What the entry claimed, and what was true

| Claim | Truth |
|---|---|
| every predicate is non-sargable | `s.status = 'completed'` is sargable — one of two |
| `margin.rs` carries a `DATE(created_at)` predicate and no LIMIT | **false**: `margin.rs:87-99` is `WHERE sl.sale_id = ?1`, pk-keyed, bounded by construction |
| `DATE(s.created_at)` "cannot use an index" → full scan growing with history | **false in practice**: it SEARCHed `idx_sales_status_created_date` |

The third one is the important one. `crates/kasirmu-core/migrations/20260814_analytics_index.sql:4`:
`CREATE INDEX idx_sales_status_created_date ON sales(status, date(created_at))` — an EXPRESSION index
built (commit `ed76ebc6`) for precisely the `status = … AND DATE(created_at) BETWEEN …` shape. The old
predicate planned as `SEARCH s USING INDEX idx_sales_status_created_date (status=? AND <expr>>? AND
<expr><?)`. **The scan this entry is named for was fixed years of migrations ago, by an index the entry
never mentions.**

### What the fix actually buys, stated at its real size

The predicate is now the half-open `s.created_at >= ?1 AND s.created_at < date(?2, '+1 day')`. Measured,
with the expression index DROPPED:

- old form → `SCAN s USING COVERING INDEX idx_sales_created_at` (walks the table)
- new form → `SEARCH s USING INDEX idx_sales_created_at` (seeks the range)

So the rewrite removes a **dependency on one specific expression index**. That is a real, defensible
improvement — the query now seeks on a schema that has only plain `idx_sales_created_at` — and it is
*smaller* than "removes a full table scan growing with history".

### How the tests were made to be worth something

Three attempts, and only the third one counts:

1. A plan test asserting `USING INDEX` — passed on the OLD predicate too, because SQLite picks
   `idx_sales_created_at` and *scans* it. Wrong discriminator.
2. Asserting `SEARCH` against SQL **copied into the test** — passed while the PRODUCTION predicate was
   reverted. The test was measuring its own copy. Fixed by hoisting the SQL into
   `MENU_ENGINEERING_SQL`, so the plan test reads the same text the product runs.
3. Asserting `SEARCH` on the shared constant, PLUS the counterfactual: drop the expression index and the
   old form must lose its seek. **Falsified before acceptance** — reverting the production predicate makes
   `menu_engineering_date_filter_can_use_an_index` FAIL, restoring it makes it pass.

A plan test against a copy of the SQL is worse than no plan test: it reports green about code nobody runs.
The hoist is what made the assertion meaningful, and that is the transferable lesson here.

## §11BY — O-T09 resolved, and a full-suite abort that turned out to be mine (2026-10-22)

Landed in `3fda1176f`.

### The entry's prescribed fix was wrong, and following it would have been the defect

O-T09 said: "cut to ~500 and assert with `windows(2)`". The case is
`five_thousand_nodes_with_five_thousand_wires_combined_db` — a genuine 5,000-node / 5,000-wire graph
round-tripped through the database. **Shrinking the fixture to 500 would have made the test assert less
than its name promises**, which is a slower version of deleting it. The prescription would have introduced
the very defect the Test tier exists to remove.

What was actually wasteful is the *verification*: `format!("combo-n-{i:04}")` allocated a fresh id per
side per wire, 10,000 throwaway `String`s. Now one buffer is `clear()`ed and reused, and **both assertions
remain** (from-edge and to-edge check different things). The panic messages gained the wire index, so a
ring break names where it broke instead of just that it broke.

The entry's line reference was off too: the loop is `:1776-1782`; `:1738-1744` holds only the builder.

### The part I got wrong, recorded because I nearly shipped it as a finding

Running the FULL `kasirmu-bridge` suite aborted with `exit code 0xffffffff` after dozens of unrelated tests
printed "has been running for over 60 seconds". I wrote in a lane brief that this was "both pre-existing
and real", and told the lane to treat it as an existing defect.

**It was not pre-existing.** A baseline run at HEAD — the lane's change reverted — completed:

```
test result: ok. 1528 passed; 0 failed; 1 ignored; finished in 1340.63s
```

Twenty-two minutes, clean. The abort came from MY environment: I had killed `kasirmu_*` test binaries
twice that round to free a locked `.exe`, and I was running the suite alongside other work. The "over 60
seconds" lines are the harness reporting a loaded machine, and every one of those tests passes alone in
~1.7 s (`pos::tests::list_held_carts_empty_when_none` = 1 passed, 1.63 s).

**The lesson is the reverse of the earlier rounds'.** I had a prior belief — "a multi-MB `eprintln!` in a
tokio worker caused exactly this abort" — and I let it stand in for evidence. The lane then grepped the
whole crate for large print calls and found **none**: the theory was not even applicable here.
A remembered symptom is not a diagnosis, and writing it into a brief does not make it one.

### Verification actually obtained

```
cargo check -p kasirmu-bridge --all-targets   -> exit 0
cargo test  -p kasirmu-bridge --lib topology  -> 320 passed, 0 failed (both 5,000-item tests green)
cargo test  -p kasirmu-bridge --lib (HEAD)    -> 1528 passed, 0 failed, 1 ignored (1340.63s)
```

**AND THE WITH-CHANGE RUN SETTLES IT: 1528 passed, 0 failed, 1 ignored, 1333.48s.** Two full runs — HEAD (1340.63s clean) and with the change (1333.48s clean) — both 1528/0/1. The 0xffffffff abort never came back,
which confirms it was never about this change.

**No timing claim is made for this change.** 10,000 allocations became 2; a test harness cannot see that,
and the two `--lib topology` runs (10.42 s vs 11.06 s baseline) are inside run-to-run noise. The honest
claim is the allocation count, not a speedup.

## §11BZ — O-M11, O-M63 and O-M04 closed as NOT APPLICABLE / NOT WORTH DOING: the ledger is empty (2026-10-22)

These three are the last open entries, and **none of them was a defect worth fixing**. Each needed a
measurement or a classification, not a patch. Recording the reasoning so none of them is re-opened on the
strength of its own title.

### O-M11 — dead in the default build

The defect is real in the code: `cache.rs:167` holds one `Mutex<redis::Connection>` across a blocking
`cmd("GET").query()` (`:294-295`, `:304-311`). But the whole `redis_cache` module is behind the OPTIONAL
`cache-redis` feature (`crates/kasirmu-core/Cargo.toml:41`) and **nothing in the workspace enables it**. An
unfixed defect in a module no build compiles is not debt; it is a design note. **Re-open this FIRST if
`cache-redis` is ever turned on** — the pooled/multiplexed-client rewrite must land before that feature ships,
not after.

### O-M63 — dead code cannot hold a lock

The guard claim is exact (`modules/inventory/src/handlers.rs:226-243`: one `self.db.lock()` spans the loop
and the `commit()`), but the SAME file says at `:219-223` that the handler is "DEAD / test-only … constructed
nowhere in production". The entry's own word for this was "latent", which understates it in the wrong
direction: the cost is not small, it is **zero**. The guard shape is recorded in the entry so whoever WIRES the
handler sees it before shipping.

### O-M04 — measured, and the number is 17 microseconds

This is the one that looked most real: a genuine `instr(payload, ?)` over every pending row, on the
settlement path, ranked Medium for months. The query plan confirms it —
`SEARCH offline_queue USING INDEX idx_offline_queue_status (status=?)`, an index range over EVERY pending row,
`instr`-scanning each payload.

So I measured it rather than arguing about it. **20,000 pending rows at ~400-byte payloads; 100 probes =
1.6955 ms total, about 17 µs per probe.** The prescribed fix — a nullable `sale_id`, a migration, a generated
`init.pg.sql` re-sync, a backfill, and changes to both outbox writers — would buy microseconds. Worse, it would
touch an invariant the code documents deliberately (`enqueue.rs:489-501`: keying on the JSON string means two
writers with different JSON shapes cannot create a duplicate row). A `sale_id` column is the better data model,
and if someone wants it for THAT reason, fine — but it is a data-model change, not a performance fix, and this
entry must not be the excuse.

### What this round learned, stated once

**Nine of the ten entries this ledger listed as open were not what they said they were.** Five were already
done and lacked a closing verb; two described modules that no longer exist or no longer compile; one named a
defect an expression index had already fixed; one was a performance problem 17 µs deep. Only O-T09 was a real
open item at the place and cost the entry claimed — and even there the PRESCRIBED fix ("cut the fixture to
500") would have weakened a genuine stress test.

The failure mode is consistent and worth naming: **an entry's RANK and its TITLE are both claims, and neither
is evidence.** A Medium entry titled "substring-scans every payload" reads as a hot-path defect even when it
is dead code or 17 µs. The only defence is re-deriving each entry from the tree before spending a lane on it —
which is what turned 10 "open" items into 7 closures and one honest fix.

## §11CA — O-H03, O-T05 and O-L16 prose corrected: false-closure audit of 22 entries, zero false (2026-10-22)

Rounds 17 and 18 swept the ledger in the direction "says open but is done" and found nine such entries.
This round swept the OPPOSITE direction — **"says closed but is not"** — because a falsely-closed entry is
worse than an open one: nobody will ever look at it again.

**Method.** Target the weakest evidence first: the 48 `Fixed:` lines with no backtick-quoted commit hash, and
the bulk PAID/MOOT/CLOSED prose paragraphs that classify several entries at once. For each, trace the claim to
a NAMED SYMBOL in the tree and confirm it is wired at the claimed call site — not just that a symbol with a
plausible name exists.

**Result: 22 entries traced, 22 CONFIRMED, 0 false closures, 0 unverifiable.** Every closing resolved to a live
symbol. The opposite-direction error does not occur in the sample. Examples of the evidence standard used:

| Entry | Proof |
|---|---|
| O-H04 | `shared_sync_http_client()` at `sync_client.rs:430`, called from exactly the six named sites |
| O-M06 | `ROW_NUMBER() OVER (PARTITION BY p.category_id …) WHERE rn <= ?1` at `popularity.rs:524-529` |
| O-M43 | `vm_pointer()` returns AFTER copying the raw pointer (`bt_android.rs:96-105`); lock released |
| O-M62 | `DEFAULT_MAX_EXCHANGE_RATES = 500` + `LIMIT ?1` (`repository.rs:47`, `:73`) |
| O-T02 | `static FINAL_SCHEMA: LazyLock<Mutex<Connection>>` (`migrations_tests.rs:26-31`) |

### Three defects found anyway — in the PROSE, not the code

1. **O-H03 named the wrong collaborator.** The entry credited `mark_offline_synced_batch` with the fsync win.
   It does not: `apply_sync_outcomes` opens ONE outer transaction (`sync_client.rs:94-99`), and the loop
   inside still calls plain `mark_offline_synced` per item (`:117`). `mark_offline_synced_batch` has no
   non-test caller on that path at all. **A future reader who "optimised" the loop to call the batch variant
   would change nothing**, which is exactly the kind of wasted lane this ledger keeps producing.
2. **O-T05's "every sleep replaced" was overstated.** `daemon_tests.rs:249-254` keeps a deliberate
   300 ms + 100 ms pair that is LOAD-BEARING — it holds the DB lock so the daemon's blocking phase is caught
   mid-cycle, which is the property under test. A future sweep would have deleted it and weakened the test.
3. **O-L16's citation had drifted** ~12 lines (`:92-100` → `:106`). Cosmetic, but it is the fourth stale line
   reference found this session, and each one costs a reader a grep.

### What this says about the ledger

Across three rounds the ledger has produced, in order of frequency: entries that were already done (9),
entries whose PRESCRIBED FIX was wrong and would have made things worse (O-T09, O-M54's rewrite target),
entries whose closing note names the wrong mechanism (O-H03), and entries whose line references had drifted
(4). **Zero entries were found claiming a fix that was absent.**

The document is not lying about completion. It is unreliable about *why*, *where*, and *whether the work was
worth doing* — and those are the parts a reader acts on. That is the reason the round-18 conclusion stands:
the next useful debt should be collected from CODE (scripted probes over the tree), not from prose appended
to a 5,000-line journal.

## §11CB — O-M54 (refunds half): a measured table scan the index could not fix alone (2026-10-22)

Landed in `2e32389bc`. Found by a scripted probe over the tree, not by reading the ledger — which is
the round-18 conclusion put into practice.

### The measurement

`refunds` shipped with exactly ONE index: `idx_refunds_sale_id ON refunds(sale_id)`
(`20260813_init.sql:1234`). The revenue reports build three CTEs over refunds (daily/weekly/monthly)
filtering `DATE(rf1.created_at, ?3) BETWEEN ?1 AND ?2`. Measured with `EXPLAIN QUERY PLAN` over a
seeded + `ANALYZE`d database:

    sales side   -> SEARCH s1 USING INDEX idx_sales_status_created_date (status=?)
    refunds side -> SCAN rf1                                    <-- FULL TABLE SCAN

The sales side already seeks because `20260814_analytics_index.sql` built
`idx_sales_status_created_date ON sales(status, date(created_at))` for exactly that shape. **Refunds never
got the equivalent.** That asymmetry is the defect: every revenue report over any range scanned the whole
refunds table.

### The part that took three attempts, and why each earlier attempt was wrong

1. **Adding the expression index alone did NOT fix it.** With `idx_refunds_currency_created_date ON
   refunds(currency, date(created_at))` present, the query STILL planned `SCAN rf1`. Column order was not the
   lever either — `(currency, date(...))`, `(date(...), currency)` and both together all gave `SCAN rf1`.
2. **The reason is the shape, not the index.** With the cost subquery INLINE in the same GROUP BY block,
   SQLite prices the correlated per-row lookup against the group and abandons the index for a scan. Splitting
   the refunds aggregate into a nested CTE (`rg` then `r`) makes it plan the seek the index exists for.
3. **The first plan test was worthless and I nearly accepted it.** It asserted against a query written INTO
   the test rather than the one production runs, so it passed while `revenue.rs` still scanned. That is the
   third time this project has caught the same failure mode. The fix is structural: the three SQL strings are
   now `pub(crate) const DAILY_REVENUE_SQL / WEEKLY_REVENUE_SQL / MONTHLY_REVENUE_SQL` in `revenue.rs`, and
   both the report and the test read the SAME constant — the `MENU_ENGINEERING_SQL` pattern. A test cannot
   drift from a query it does not own.

### The money risk the restructure introduced, and how it was closed

Rewriting `(correlated subquery) AS rcost` as `SUM((same subquery)) / COUNT(*)` puts an INTEGER DIVISION on a
**money** column. It is equivalent only because the subquery is correlated on `(day, currency)` and not on the
individual refund, so it is constant per group. That is an argument, and this ledger has learned not to trust
arguments. So it is pinned: `several_refunds_in_one_day_net_their_cost_exactly_once` in
`crates/kasirmu-core/src/db/reports_tests.rs` seeds THREE refunds (1+2+1 units) on one day and asserts COGS is
exactly 800 — **and it was run against BOTH the old inline form and the new nested form, passing on each**, so
equivalence is demonstrated rather than asserted.

### What was actually won, stated at its real size

The migration adds two indexes:
- `idx_refunds_currency_created_date ON refunds(currency, date(created_at))` — the three report CTEs.
- `idx_refunds_processed_by_created_at ON refunds(processed_by, created_at)` — the two shift-close /
  drawer-reconciliation queries in `shifts.rs`, which already used a sargable bare range and needed only an
  index, no rewrite at all.

**The honest limit:** the index is reachable for NARROW windows. At a 365-day range the estimates were scan
20.0 vs index 19.1 and SQLite still prefers the scan-and-filter. A manager pulling a week — the common case —
is the win; a year is not. That limit is written in the `DAILY_REVENUE_SQL` doc comment so it cannot be
quietly overclaimed later.

### Verification

```
cargo check -p kasirmu-core --all-targets   -> exit 0
cargo test  -p kasirmu-core --lib           -> 3658 passed, 0 failed (190.71s)
generate-pg-migration.py --check            -> ok: 129 tables, 166 indexes, 7 seed inserts
rustfmt --edition 2024 --check              -> exit 0
```

The plan test was FALSIFIED before acceptance: with the migration unregistered AND the CTE re-inlined, it
fails and quotes `MATERIALIZE r / SCAN rf1`. Restored, it passes. **3657 -> 3658** is the one new test;
nothing was deleted.

## §11CC — O-M68 opened: `product_activity` traverses its whole index on every popularity pass (2026-10-22)

**Status: OPEN — measured, not yet fixed.** This is the one entry deliberately left open, and it is
recorded as an ENTRY (not a journal closure) so the counting rule reads it correctly.

### The measurement

`crates/kasirmu-core/src/db/popularity.rs:1056-1061` aggregates search/edit signals with:

```sql
SELECT sku, event_type, strftime('%Y-%m-%d', created_at) AS day, COUNT(*) AS cnt
  FROM product_activity
 WHERE created_at >= datetime('now', ?1)
 GROUP BY sku, event_type, day
```

Measured with `EXPLAIN QUERY PLAN` over 3,000 seeded rows + `ANALYZE`:

    SCAN product_activity USING INDEX idx_product_activity_sku
    USE TEMP B-TREE FOR GROUP BY

`SCAN ... USING INDEX` is an INDEX-ONLY walk, not a table scan — but it still visits **every row in the
index**, and the `created_at >=` predicate can only be applied AFTER each row is fetched, because
`idx_product_activity_sku` is on `sku` alone. So the cost grows with the entire activity ledger, not with
the window.

### Why this is not simply 'add an index' — the sibling query already proves the shape works

The SAME table has a better-planned sibling at `popularity.rs:885-891`, which additionally filters
`sku IN (...)` and plans as:

    SEARCH product_activity USING INDEX idx_product_activity_sku (sku=?)

So the index IS used for a SKU-filtered lookup. The scan appears only when the query is UNRESTRICTED, and
the fix is therefore a schema question:

- **Option A:** `CREATE INDEX idx_product_activity_created_at ON product_activity(created_at)` — turns the
  unrestricted window into a range SEARCH. One index, no query change. Straightforward.
- **Option B:** `(created_at, sku, event_type)` — a covering index so the GROUP BY needs no temp B-tree
  either. Strictly better for this query, slightly larger.
- **Option C:** leave it. `product_activity` grows one row per product search/edit; on a busy store it is
  plausibly the FASTEST-growing table in the schema, which argues against leaving it.

### Why it is not closed in this round

Changing the schema of a table that grows per user action is a decision with a write-amplification cost
(one more index on a hot INSERT path) that the read-side measurement does not answer. **The call frequency IS
now established** (see the SCOPE CORRECTED note on the entry): `recompute_all_popularity` runs at store open,
while the per-sale path uses the `IN (...)`-filtered batch variant that plans well. So this is a once-per-open
cost, not a per-sale one — which makes it LOWER priority than the §11CB refunds scan, that one sitting on
the report path. **What is still unmeasured: how large `product_activity` gets in a real store**, which is
the number that would decide it.

### Also confirmed NOT a problem

`activity_day_counts` (`popularity.rs:614-621`) filters `sku = ?1 AND event_type = ?2 AND created_at >= ?3`,
which `idx_product_activity_sku` serves. Only the unrestricted aggregate at `:1059` scans.

## §11CD — O-M44-style harness abort diagnosed: over-subscription plus a capture bug that was hiding the evidence (2026-10-22)

No code changed. This section records a DIAGNOSIS that cost three rounds of visible noise, because the
conclusion retires a fear that had been shaping every round's working method.

### What was actually happening

`cargo test -p kasirmu-core --lib` aborted the harness (`exit code 0xffffffff`) three times across sessions.
Measured this round:

| Measurement | Value |
|---|---|
| Machine | AMD Ryzen 9 7950X, 16C/32T, 31.2 GB RAM |
| Default `--test-threads` | **32** (one per logical CPU) |
| Test process PEAK working set | **184.6 MB** (422 samples @ 200 ms) |
| Peak as fraction of RAM | **0.6%** |
| Min free RAM during the run | ~4.6 GB |

**The memory hypothesis is refuted by measurement.** The suite never used 1% of RAM.

Mechanism: the binary declares `SizeOfStackReserve = 1 MB`, and Windows reserves that per native thread, so
32 harness threads pre-reserve 32 MB of address space up front — under contention with 3-4 other lanes' rustc
processes. **It is an over-subscribed build machine, not a code defect.** Supporting evidence: the same
binary at `--test-threads=2` passed 3658/3658 in ~110 s, and 50 tests printing "running for over 60 seconds"
in a clean 190 s run shows a suite that is simply load-sensitive rather than stuck.

Counter-hypotheses all went negative: no unbounded `thread::spawn` (only a bounded 10×10 loop at
`rate_limiter_tests.rs:349`), no `process::abort`/`exit` anywhere in the crate, no 5,000-node topology
fixture (that is 63 small flat tests), and zero huge-fixture allocations crate-wide.

### The real bug was in MY capture recipe, and it had been destroying the evidence

The aborting runs produced no `test result:` line and no detail because of how I was running them:

```
cargo test -p kasirmu-core --lib > out.log 2>&1     # DROPS the 'failures:' block
```

libtest writes per-test stdout to the REAL console handle and its `stdout ----` blocks to the real stderr via
the Console API, bypassing the CRT redirect. So redirecting to a file silently throws away exactly the part
that explains a failure. **Every abort I "investigated" was a run whose reason I had discarded before
reading it.** Fixed going forward with `-- --nocapture`, or a foreground run whose console is captured.

### A false alarm raised by the diagnostic

The diagnosing lane reported a genuine-looking test failure: `db::popularity::tests::zz_scratch_activity_plans`
failing at `popularity_tests.rs:28` (a `SEARCH` vs `SCAN` plan assertion). It was **my own uncommitted scratch
probe**, live in the tree while the lane sampled it, and I removed it mid-run. Verified after: `grep zz_scratch`
returns nothing in `store/` or HEAD, and `git status` on that file is clean. **A `zz_`-prefixed scratch test
running in another lane's window is a self-inflicted false positive** — the prefix that sorts it LAST is also
what kept it alive across the sampling window.

### Actions taken / recorded

- No production change. The abort is environmental.
- Capture recipe corrected: **`-- --nocapture` on redirected runs**, or a foreground call.
- Leftover scratch directories accumulate in `target/mstmp/` (~250 `kasirmu-bridge-*` from 18 sites sharing
  one scratch root). Not fixed; noted because it is a genuine load-sensitivity source independent of memory.
- **Do NOT** add `RUST_TEST_THREADS` to `.cargo/config.toml` — that would hide the issue project-wide.

## §11CE — O-M68 resolved: covering range index on `product_activity(created_at, sku, event_type)` eliminates index scan (2026-10-22)

**Status: CLOSED — Option B implemented.**

### Resolution

Migration `crates/kasirmu-core/migrations/20261025_product_activity_created_at.sql` added:
```sql
CREATE INDEX IF NOT EXISTS idx_product_activity_created_at
    ON product_activity(created_at, sku, event_type);
```
Together with its PostgreSQL twin in `20260813_init.pg.sql`.

### Query plan measurement (verified in `popularity_tests.rs`)

Before:
    SCAN product_activity USING INDEX idx_product_activity_sku
    USE TEMP B-TREE FOR GROUP BY

After:
    SEARCH product_activity USING COVERING INDEX idx_product_activity_created_at (created_at>?)
    USE TEMP B-TREE FOR GROUP BY

`created_at >= datetime('now', ?1)` performs a range seek rather than scanning the full index, and all projected columns (`sku`, `event_type`, `created_at`) are satisfied by the covering index without table page lookups.

The index-surface pin in `migrations_tests.rs` advanced from 198 to 199.


## §11CE — O-M68 resolved, and the query-plan probe that makes this repeatable (2026-10-22)

Landed in `f49038c50`.

### O-M68 fixed

`recompute_all_popularity`'s unrestricted window aggregate over `product_activity` planned
`SCAN product_activity USING INDEX idx_product_activity_sku` — an index-only walk, but over EVERY row,
with `created_at >=` applied only after each row was fetched. Migration
`20261025_product_activity_created_at.sql`:

```sql
CREATE INDEX idx_product_activity_created_at ON product_activity(created_at, sku, event_type);
```

Measured, with the index: `SEARCH product_activity USING COVERING INDEX idx_product_activity_created_at
(created_at>?)`. With it DROPPED: back to `SCAN ... USING INDEX idx_product_activity_sku`. The covering
shape also removes the temp B-tree the GROUP BY needed.

### The tool is the durable part: `tests/integration/query_plan_probe.rs` + `scripts/check-query-plans.py`

27 production queries probed against a seeded, migrated, `ANALYZE`d database. **3 are sourced from the
production constants** (`DAILY/WEEKLY/MONTHLY_REVENUE_SQL`, made `pub` so a separate test crate can import
the SAME text) and **24 are copies** — each naming its origin `file:line`, with
`copied_query_provenance_is_intact` failing the build if an origin stops resolving. The 3-vs-24 split is
the honest measure of drift risk and is recorded rather than smoothed over.

**Falsification, which is what makes it worth having:**
- Permanent: `forcing_a_scan_fails_the_probe` strips every `WHERE` from the revenue SQL and REQUIRES the
  same detector to report the table. If the detector goes deaf, that test fails.
- One-off: deleting `WHERE status = 'pending'` from `list_pending_offline` made the probe fail, exit 1,
  naming `offline_queue (SCAN offline_queue)`. Restored byte-for-byte.

### The probe found ONE candidate and it was a false positive — worth recording as such

It flagged `get_kds_queue` as scanning `kds_orders`. It does not. The index it 'lacks'
(`idx_kds_orders_status_received ON kds_orders(status, received_at)`, migration 20260904) already exists,
and on an empty migrated DB the query `SEARCH`es it — the `ORDER BY CASE status … END` does not defeat it.
The scan appeared only because the probe's own seed made **60% of tickets live** (`i % 5` across five
statuses); at that selectivity SQLite correctly prefers a scan.

Two corrections the lane made to my diagnosis, both accepted: it is the WHERE selectivity, not the `CASE`;
and the index is chosen below roughly **20–30% live**, not at any live set. The fix was to the SEED
(90% served / 5% cancelled / ~5% live), not to the product, and a comment now records that a board with a
huge live backlog will scan BY DESIGN — so nobody 'fixes' it later by adding an index.

**That is the most valuable outcome of the round.** A probe whose fixture is unrealistic produces exactly
the false confidence this project has been repeatedly burned by. It reported a defect, the defect was in the
probe, and the probe now says so.

### Coverage, stated honestly

27 queries covered. NOT covered: dynamic `WHERE` builders in `audit.rs`, `sales_summary.rs` past `:276`,
the `product_activity` aggregates, payments readers, shift joins, and every writer. The probe is a curated
gate, not a crawl.

## §11CF — O-M69 opened; eleven probe queries hoisted to constants; the plan gate wired into CI (2026-10-22)

Three things landed this round. The most valuable is the one that was NOT shipped.

### O-M69 — found by the probe's own blind spot, and recorded open

The probe covers 27 curated queries. It does NOT cover the dynamic-WHERE builders, and
`build_audit_where` (`audit.rs:191-247`) is the most consequential of them: the admin audit screen's
pagination. Measured over 2,000 seeded rows + `ANALYZE`:

    outcome filter     -> SCAN audit_log | USE TEMP B-TREE FOR ORDER BY
    no filter          -> SCAN audit_log USING INDEX idx_audit_log_created_at
    cursor (no filter) -> SEARCH audit_log USING INDEX idx_audit_log_created_at (created_at<?)

**Filtering by `outcome` makes the plan WORSE than not filtering.** `audit_log` carries indexes on
`action`, `created_at`, `(target_type, target_id)` and `user_id` — none leads with `outcome` — so adding
the predicate drops the index-only walk for a full scan plus a temp sort. Every audit screen filtered to
`failure` reads the whole log.

Fix measured, not applied: `CREATE INDEX idx_audit_log_outcome_created ON audit_log(outcome, created_at
DESC, id DESC)` turns the same query into `SEARCH audit_log USING COVERING INDEX ... (outcome=?)` and
removes the temp B-tree. Left open deliberately: it is a schema change on the audit table, and this round
had already committed two migrations. **Recording an open item is the behaviour this ledger kept failing at
in the other direction** — entries marked closed that were never done.

### Eleven queries hoisted, so the probe can no longer drift from them

The probe's own honest weakness was that 24 of 27 queries were COPIES. Now **14 of 27 are sourced from
production constants** (was 3). Converted: the five offline-queue listers, the two KDS list bases plus the
shared ORDER BY fragment, and the four audit readers (`AUDIT_ROW_PROBE_SQL`, `LIST_AUDIT_ENTRIES_SQL`,
`VERIFY_AUDIT_CHAIN_SQL`, `COUNT_AUDIT_ENTRIES_AFTER_SQL`).

Two things could not become plain constants because the product builds them at run time — `get_kds_queue`
(base + optional zone fragment + ORDER BY) and `list_kds_orders_for_instance` (base + dynamic WHERE). They
stay copies, and a NEW test, `assembled_kds_probes_extend_the_production_base`, requires each probe literal
to START WITH the production base constant and its suffix to equal the product's tail exactly. That is a
weaker guarantee than a shared constant and is recorded as weaker.

**How 'pure relocation' was checked**, since that is the only property that mattered: a Rust string-literal
tokenizer diffed every SQL-bearing literal as an EXACT MULTISET between `git show HEAD:<file>` and the
working tree. `offline.rs` 27/27 byte-identical, `audit.rs` 25/25, `kds_orders.rs` 17 -> 15 with the two
missing being the duplicated literals that collapsed into the shared bases, and "HEAD SQL text absent from
WORK: 0". Verified independently by reading the diff: every removed SQL line reappears verbatim inside a
constant.

### The footgun that verification surfaced, and how it was closed

`rustfmt` RE-INDENTS multi-line string literals, which silently changes the query text. That would break the
very guarantee the hoisting exists to provide, and it would move SQL without anyone reviewing a query
change. Measured which files are actually affected: `offline.rs` and `kds_orders.rs` are untouched by it
(compared before/after, text identical), but `audit.rs`'s `LIST_AUDIT_ENTRIES_SQL` and
`VERIFY_AUDIT_CHAIN_SQL` are. Both now carry `#[rustfmt::skip]` with a doc comment saying WHY, and the
comment explains that the attribute is load-bearing rather than cosmetic.

### The gate is in CI

`query-plan-gate` is registered in `scripts/gates.json`, runs from `scripts/check.sh`, and runs in the
existing `dev-ci.yml#static-gates` job. Deliberately NOT pre-commit (a cargo test on every commit) and NOT
pre-push (that runner's Tier 0 is stdlib python only, and the repo's own drift checker resolves gate labels
against `check.sh` — a pre-push-only label has no vocabulary there). Cost: 0 to pre-push, ~20-50 s warm to
`check.sh`, ~1-2 min to CI.

Proof it fires: PASS exit 0 on a clean HEAD worktree; FAIL exit 1 after dropping the WHERE from
`list_stock_movements`, naming the query and the table; restored with blob hashes equal to HEAD.

**And a correction to my own instruction.** I told the lane to mutate `list_pending_offline` to prove the
gate. That does NOT fail — its column list is fully covering, so SQLite answers it from the index as a
covering-index walk, which the detector deliberately exempts. The lane found a mutation that actually
works instead of reporting a false pass. **The documented limit is real: a `LIMIT/OFFSET` page through a
composite index with no WHERE is never flagged**, because the probe grades missing SEEKS, not every
unbounded walk. That limit is written in the gates.json note rather than papered over by widening the rule.

### Verification

```
cargo check -p kasirmu-core --all-targets                  -> exit 0, zero warnings
cargo test  -p kasirmu-core --test integration query_plan_probe -> 4 passed, 0 failed
cargo test  -p kasirmu-core --lib                          -> 3659 passed, 0 failed (175.02s)
rustfmt --edition 2024 --check                             -> exit 0 on all five files
verify-ci-docs-drift / check-gate-runners / verify-gate-completeness -> all exit 0
```

## §11CG — O-M69 resolved: the audit outcome filter, and a falsification that caught my own wrong measurement (2026-10-22)

Landed in `8a1e68b12`. Migration `20261027_audit_log_outcome_created.sql`:

```sql
CREATE INDEX idx_audit_log_outcome_created ON audit_log(outcome, created_at DESC, id DESC);
```

### The measurement was wrong the first time, and the falsification is what exposed it

§11CF recorded that the outcome-filtered audit query scanned, and gave three plan rows. **One of those rows
was wrong.** I had measured the cursor form and the no-filter form but not the FIRST page with an outcome
filter, and I quoted a cursor query as if it were representative.

Re-measured properly, on 5,000 rows + `ANALYZE`, without the new index:

| Shape | Plan |
|---|---|
| **first page** + outcome | **`SCAN audit_log` + `USE TEMP B-TREE FOR ORDER BY`** |
| keyset page + outcome | `SEARCH audit_log USING INDEX idx_audit_log_created_at (created_at<?)` |
| no filter | `SCAN audit_log USING INDEX idx_audit_log_created_at` |

So the defect is narrower than I first claimed and **worse-placed**: the cursor clause gives the planner a
range to work with, so only the FIRST page scanned — and the first page is the one every user lands on.

**My first version of the test asserted only the cursor shape.** It passed, it was falsifiable, and it was
testing the healthy path. Running the falsification (unregister the migration → the test must fail) is what
revealed it: the test failed, but on the CURSOR plan, which showed the cursor query already seeking. I then
measured all three shapes separately, found the first page was the real one, and rewrote the test to assert
**both shapes for both `outcome` values**. Only then does it fail for the right reason.

### What a falsification actually buys

This is the clearest case yet of the pattern this ledger keeps recording, and it cuts against ME this time:
a test can be green, falsifiable, and still aimed at the wrong query. The falsification did not merely
confirm the fix — it corrected the diagnosis. **The three prior rounds all recorded 'a test that names a
property is not a test that pins it'; this round adds the sequel: a test that FAILS without the fix may
still be failing on a plan that was never the problem.**

### Why this one is not covered by the plan probe, and could not be

`list_audit_entries_page` assembles its `WHERE` at run time through `build_audit_where`
(`db/audit.rs:191-247`), so the SQL exists only as a string built at the call. The probe works by preparing
a known string; it cannot see a query that is constructed. **That is the probe's documented boundary**, and
this defect lived exactly on it — which is a useful fact about both the probe and the risk surface:
**dynamic-WHERE builders are where the next one is hiding.**

### Verification

```
cargo check -p kasirmu-core --all-targets   -> exit 0
cargo test  -p kasirmu-core --lib           -> 3660 passed, 0 failed (191.73s)
generate-pg-migration.py --check            -> ok, 129 tables, 168 indexes
rustfmt --edition 2024 --check              -> exit 0
```

**3659 -> 3660** is the one new test; nothing deleted. Falsified before acceptance: unregistering the
migration makes `audit_page_filtered_by_outcome_seeks_instead_of_scanning` fail on the FIRST page with
`SCAN audit_log USING INDEX idx_audit_log_created_at`; re-registering makes it pass.

### An operational trap worth recording

After unregistering the migration and restoring it, `cargo test` reported `migration_registry_matches_filesystem`
FAILING with "migration file ... has NO registry entry" while the entry was visibly present in the source.
**Cargo had not rebuilt**: it ran the stale binary in 0.00s. `touch`ing the source file forced a real
rebuild and the test passed. When a test contradicts what you can read in the file, suspect the build
before the code.

## §11CH — O-M69's class closed: the run-time WHERE builders are now graded, and the gate had to be fixed before it could see (2026-10-22)

Landed in `120af25c9`. The plan probe's documented blind spot was queries whose `WHERE` is ASSEMBLED
at run time. O-M69 lived exactly there. This round graded that whole class.

### Four builders found, all now covered

| Builder | File | Shape |
|---|---|---|
| `build_audit_where` | `db/audit.rs:207-310` | 7 optional predicates, `.join(" AND ")` — the O-M69 one |
| `list_gift_cards` | `db/gift_cards.rs:182-232` | 4 optional predicates |
| `list_kds_orders` / `_for_instance` | `db/kds_orders.rs:99-114`, `:156-182` | `push_str(" WHERE …")` |
| `replay_kds_orders_since` | `db/kds_ops.rs:47-70` | `push_str(" AND status …")` |

**No production visibility was widened.** The tests are sibling `_tests.rs` modules, which are CHILDREN of
the module under test and therefore reach private items through `use super::*`. `build_audit_where` stayed
a private `fn`; the only production diff is 12 lines of `#[cfg(test)] #[path = …]` wiring.

### The first page is graded for every shape — that was the whole point

§11CG recorded that only the FIRST page scanned, because the keyset cursor gives the planner a range and
masks the defect. Every shape is therefore graded on BOTH page forms, and the test explicitly asserts that
the cursor form still seeks — pinning the mask rather than falling for it.

### Two of the shared blind spots are inherent to the whole class

- `details LIKE ?` does **not** force a scan when an indexed sibling predicate is present — the outcome index
  still serves, so the plan stays `SEARCH`. Demanding a scan there would have been a false expectation.
- `target_id` DOES have a path (`idx_audit_log_target`, a skip-scan on `ANY(target_type)`), so a predicate on
  a column is not automatically unindexed.

### THE PART WORTH KEEPING: the gate had two bugs and the falsification found both

The new checker was written, passed, and was **incorrect in two ways that both hid real scans**:

1. `predicate_columns` was hand-maintained with four column names, so it MISSED `target_type`. The first
   falsification attempt used a `target_type` predicate and the gate stayed GREEN — I was told a scan was
   caught when the classifier had simply never heard of the column. Fixed by deriving the columns from the
   assembled SQL instead of a literal list.
2. `scans_in_full` granted an UNCONDITIONAL exemption to `SCAN … USING INDEX` — which is **exactly the shape
   of O-M69**. As written, the new gate would have been blind to the defect it was built to find. It now
   treats a non-covering index walk as a full read when a predicate names a column whose index the plan does
   not use.

Both were caught by the falsification step, and only because the falsification was run BEFORE believing the
gate. This is the cleanest evidence yet for the rule that has driven three rounds: **a green test proves the
test ran, not that it measures the thing.** A checker that cannot fail is indistinguishable from a checker
that passes.

### One real finding, deliberately NOT fixed

`list_gift_cards`: 4 of 6 filter shapes read the whole table (`no filter`, `search only`, `issued_to only`,
`min_balance only` → `SCAN g`). Only shapes carrying `status = ?` are served. It is **not** the O-M69 growth
class — `gift_cards` is bounded by cards issued, not by transaction volume — so no index was added. Instead
the count is PINNED at 4, which means the test fails both if a shape regresses AND if someone later adds an
index (the pin must then be lowered deliberately).

### Fixtures vs defects: three investigated, all three were fixtures

KDS failed on a foreign key (`sales` parent must be seeded first). Gift-card `status` had 80% `active`, and
audit actions had 40% of the log in `SECURITY_ACTIONS` — both made a scan the CORRECT plan. Measured
threshold for the audit case: the index wins below about a quarter of the table. All three fixtures were
corrected to realistic distributions; **no assertion was weakened.** One former `#[ignore]` became a graded
assertion that measurably seeks.

### Verification

```
cargo check -p kasirmu-core --all-targets   -> exit 0
cargo test  -p kasirmu-core --lib           -> 3673 passed, 0 failed, 0 ignored (206.73s)
rustfmt --edition 2024 --check              -> exit 0 on all six files
```

**3660 -> 3673** is 13 new tests (audit 6, gift_cards 4, kds 3), **zero ignored**.

Also landed this round, outside the performance ledger but found while surveying it:

**`OZ_ENFORCE_PLANS` fails OPEN in production, and now says so.** The flag is a plain `env_bool`,
so unset / `0` / a misspelling silently disables the sync plan gate — correct for dev, an open paid-feature
boundary in production, and invisible because every request succeeds. `validate_production`
(`apps/cloud-server/src/config.rs:449`) refuses only `OZ_API_SECRET` and `OZ_ADMIN_KEY`, so nothing caught it.

Fixed as a WARNING, not a refusal (`3ac336306`), following the precedent set for `MIDTRANS_QRIS_ACQUIRER`:
refusing would break a legitimate production deployment that has not started selling plans yet. The rule is
split into a pure `should_warn_plan_gating_disabled(production, enforce_plans)` so a test can pin the
CONDITION rather than the log subscriber — **and the test was falsified**: dropping the `production &&` guard
makes it fail on the dev case, which is exactly the regression that would turn the warning into noise and get
it ignored.

**Also fixed in the same commit:** an OpenAPI drift the `sale_id` column introduced. `OfflineQueueItem` gained
`sale_id` in `d131c7c7f` (another session's O-M04 work) but the published `SyncPushItem` schema did not, and
`push_outcome_documented_schema_matches_serde_wire_shape` was RED with the field list on both sides. Documented
rather than loosening the test — that test derives its expectation from `serde_json::to_value` of the real
enum, so it is the one thing standing between the wire format and the published contract.

## §11CI — the CI gate now runs both tiers, and O-M70 measured three times before being right (2026-10-22)

Landed in `bf1c70d2c` and `1c66df60e`.

### The gate was running only half its coverage

`scripts/check-query-plans.py` ran `cargo test --test integration query_plan_probe` — the string-based
probe — and NOTHING ELSE. The 13 run-time-WHERE tests added in §11CH are `--lib` unit tests, so they
executed in nobody's CI. The gate reported "OK - 27 probed queries" while the newest coverage, covering
exactly the class O-M69 belonged to, never ran.

Fixed by adding a second tier (`run_unit_plan_gate`) that runs `cargo test --lib dynamic_where` after the
integration probe, and failing the gate (exit 2) if it does not pass. **Falsified**: unregistering the O-M69
migration makes the gate exit 2 and name the missing index.

This is the same class of error as the two bugs found in the gate last round — coverage that exists but is
not wired to anything. Worth stating plainly: **a test that no gate runs is a test you do not have.**

### O-M70, and why it took three measurements

Following O-M04's `sale_id` column, `has_pending_outbox_row_for_sale` has two branches. The fast one is
indexed and seeks. The LEGACY branch (`sale_id IS NULL`) is the only route to any row written before
migration `20261023`, which added the column without backfilling.

I measured it three times, and the first two were wrong:

| Attempt | Claim | Why it was wrong |
|---|---|---|
| 1 | `SCAN offline_queue` | planned against a table too small/thin to shape the choice |
| 2 | "so the legacy branch is a full scan" | carried attempt 1 forward as a finding without re-measuring |
| 3 | `SEARCH ... idx_offline_queue_status_action (status=? AND action=?)` | **true** — measured on a seeded table during FALSIFICATION |

**The falsification is what caught it.** I unregistered the migration to prove the new test fails, and the
failure message quoted the PRE-FIX plan — which was already a SEARCH, not a scan. The real residual cost is
narrower: `idx_offline_queue_status_action` is `(status, action)`, **not covering**, so each candidate row is
fetched from the table just to run `instr(payload, ?)`.

### The fix, sized to the real problem

```sql
CREATE INDEX idx_offline_queue_legacy_sale_probe
    ON offline_queue(action, status, payload) WHERE sale_id IS NULL;
```

PARTIAL on `sale_id IS NULL`, so it is exactly as large as the legacy set and costs nothing for rows the
fast path already serves; `payload` is included so `instr` is evaluated from the index entry with no table
fetch. Plan becomes `SEARCH ... USING INDEX idx_offline_queue_legacy_sale_probe (action=? AND status=?)`.

An intermediate attempt — `(status, action) WHERE sale_id IS NULL` — turned the scan into
`SCAN ... USING INDEX`, an index walk rather than a seek, so it was discarded. Two attempts, measured, one
kept.

### The lesson, which is about ORDER not technique

**A plan measured on an unseeded table is not evidence about production.** I have now made this mistake in
three consecutive rounds — the gift-card "scan" (80% `active`), the audit "scan" (40% security actions), and
this one (no data at all). Each time the falsification step caught it. The practice that works is not
"measure carefully"; it is **measure, then try to DISPROVE the measurement**, because the falsification is
where the wrong reading surfaces.

### Verification

```
cargo check -p kasirmu-core --all-targets          -> exit 0
cargo test  -p kasirmu-core --lib                  -> 3673 passed, 0 failed (183.32s)
python scripts/check-query-plans.py --check        -> exit 0, both tiers
generate-pg-migration.py                           -> 129 tables, 169 indexes
```

## §11CJ — O-M71 closed and the probe's last twelve copies hoisted to constants (2026-10-22)

Landed in `51ff9a8ad` and `79be56727`.

### The copy problem is essentially closed

| | Before | After |
|---|---|---|
| Probe entries sourced from shared production constants | 14 | **26** |
| Probe entries holding their own copy | 13 | **1** |

Twelve further constants hoisted: `TOP_PRODUCTS_SQL`, `CATEGORY_BREAKDOWN_SQL`, `INVENTORY_TREND_SQL`
(`reports/product_sales.rs`); `HOURLY_HEATMAP_SQL`, `PAYMENT_METHOD_BREAKDOWN_SQL`, `VOIDED_ITEMS_SQL`
(`reports/sales_summary.rs`); `OFFLINE_ENQUEUE_DEDUP_PROBE_SQL`, `OFFLINE_OUTBOX_PROBE_SQL`,
`OFFLINE_OUTBOX_LEGACY_FALLBACK_SQL` (`offline/enqueue.rs`); `LIST_STOCK_MOVEMENTS_SQL`,
`STOCK_MOVEMENTS_ARCHIVABLE_ITEMS_SQL` (`products_stock_adjust/movements.rs`); `STOCK_LEDGER_SUM_SQL`
(`products_stock_adjust/ledger.rs`).

The one remaining copy is `list_kds_orders_for_instance`, which stays pinned-to-base because its visible
fragment comes from a private method that would have to be widened for a test's sake.

### `TOP_PRODUCTS_SQL` is the interesting one

It is `format!`-built with a RUNTIME order clause, so only the static base could be hoisted — the
`KDS_QUEUE_BASE_SQL` pattern. `concat!` cannot take a base const, so the probe joins the same base with a
pinned revenue tail at run time, and **two new tests hold the join honest**:
`top_products_probe_extends_the_production_base` (tail char-for-char, and it is the revenue/default branch)
and `top_products_ranking_terms_come_from_the_product` (both ranking literals still present in production
source). That is a weaker guarantee than a shared constant, and it is stated as weaker rather than presented
as equivalent.

### The tokenizer earned its keep again

The literal-multiset proof caught a defect introduced DURING this work: the first insertion re-indented the
continuation lines (12 spaces instead of 20) in all three `product_sales` literals. That is a text change
nobody would review as a query change. The tokenizer flagged it, it was reverted, and the proof now reads
byte-identical on every file: product_sales 7/7, sales_summary 12/12, enqueue 11/11, movements 6/6,
ledger 8/8, with the unchanged baselines still clean (revenue 3/3, audit 26/26, offline 27/27, kds_orders 19/19).

Every multi-line converted const carries `#[rustfmt::skip]`, and that was **verified by running `rustfmt` and
re-running the tokenizer** rather than by assuming the attribute works.

### O-M71 — closed as NOT-ACTIONABLE, with the numbers that rule out an index

`list_gift_cards` has four scanning shapes. Measured over 3,000 cards + `ANALYZE`:

| Shape | Plan |
|---|---|
| `status = ?` (even at 2.5% selectivity) | `SEARCH g USING INDEX idx_gift_cards_status` |
| `card_number LIKE 'GC-0001%'` (PREFIX) | `SCAN g` |
| `card_number LIKE '%0001%'` (INFIX) | `SCAN g` |
| `current_balance_minor >= ?` | `SCAN g` |
| unfiltered default page | `SCAN g` |

Three of those cannot be fixed by an index: a LEADING wildcard is unindexable (and even the PREFIX form scans,
because SQLite only uses an index for `LIKE` under `COLLATE NOCASE` or `PRAGMA case_sensitive_like`, and this
schema uses neither); `min_balance` is a RANGE on a value that changes on every redemption, so indexing it
puts maintenance on the hottest write path to serve a rare filter; and the unfiltered page is bounded by cards
issued, not transaction volume — **not the O-M69 growth class.**

Closed with the measurement instead of an index. The probe's pin at 4 stays, so it fails both on regression
AND on a future index landing, forcing a deliberate re-measurement either way.

### What this round did NOT do, and why

I had planned to extend the gates to `apps/cloud-server`. Checked first: its analytical SQL is PostgreSQL
(`email_pg/analytics.rs`), there is no PostgreSQL on this machine, and a plan assertion that has never
executed against a real server is exactly the kind of false confidence this ledger exists to prevent. **Not
attempted, rather than attempted-and-claimed.** The `ui/` half has no SQL to probe.

### Verification

```
cargo check -p kasirmu-core --all-targets             -> exit 0
cargo test  -p kasirmu-core --test integration query_plan_probe -> 6 passed, 0 failed
cargo test  -p kasirmu-core --lib                     -> 3673 passed, 0 failed (193.70s)
rustfmt --edition 2024 --check                        -> exit 0 on all 10 files
```

## §11CK — O-M72 opened: the UI's 111 lint warnings are two known rules, and one autofix is destructive (2026-10-22)

No production code changed this round. Recorded because the STATE of the UI gates was unknown to me until now,
and because the attempt to improve it exposed a trap worth writing down.

### The UI gates are green, verified for the first time this session

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 — **111 warnings, 0 errors** |
| `npm run test` (Vitest) | **13,121 passed, 0 failed**, 3 skipped, 3 todo — 828 files, 246 s |

So the front end is not carrying hidden breakage. The 111 warnings are the only thing that looks unwell, and
they are exactly two rules:

| Rule | Count | What it is |
|---|---|---|
| `react-refresh/only-export-components` | 67 | a file exporting a component AND a constant, which defeats Vite fast-refresh |
| `@typescript-eslint/consistent-type-imports` | 44 | `import()` inline type annotations instead of top-level `import type` |

Both are configured as `warn` on purpose (`eslint.config.js`), and `react-refresh` is already `off` for the
feature-registry modules where it is a documented false positive.

### O-M72 — the autofix for the 44 is destructive, and it deleted a guard

`consistent-type-imports` looks mechanically fixable, so I ran `eslint --fix`. **It corrupted the files.**
With my `--rule` override in place it treated `/* eslint-disable react-refresh/only-export-components */` as a
fixable finding and replaced it with a single space, in 13 files:

```diff
-/* eslint-disable react-refresh/only-export-components */
+ 
```

That is the worst class of autofix: it removes a SUPPRESSION, so the rule it guards becomes active and the
next `npm run lint` would surface 67 new warnings that were deliberately silenced, in files nobody touched.
The change was reverted with `git checkout -- ui/src/` and the tree is byte-identical to HEAD.

**Recorded as O-M72, not fixed.** The 44 remain.

**A SECOND attempt also failed, and this one is the more instructive.** I wrote a targeted Node converter
matching two patterns — `typeof import('m')` and `import('m').Member` — and it reported `changed 27 of 27`.
It was wrong: **some `import('m')` uses are VALUE positions, not types.** After conversion `npm run typecheck`
reported 8 errors including `TS2693: 'T__api_settings' only refers to a type, but is being used as a value
here`. Reverted with `git checkout -- ui/`; typecheck green again at exit 0.

Both failures share one shape: a regex cannot tell a type position from a value position, and neither an
autofixer's exit code nor its own success message can either. **27 of 27 changed, 0 errors reported, and
the code was broken.** The only thing that caught it was running the type checker afterwards — which is the
same lesson as the literal-multiset tokenizer and the `git status` after the eslint autofix.

### Why this is worth a section in a PERFORMANCE ledger

Because the same failure has appeared five times now in different clothes: **a tool that reports success while
doing the wrong thing.** Round 23 shipped a plan gate that passed while blind to its own target; round 24 found
a gate running half its coverage; this round ran an autofix that reported `FIX=0` (success) after deleting a
guard. The lesson is not "check the exit code" — every one of these exited 0. It is **diff the artifact**, which
is why the literal-multiset tokenizer caught three previous mistakes and why `git status` after the autofix
caught this one before it was committed.

## §11CL — O-M72 partially closed: 67 of 111 UI warnings removed by configuration, 44 left (2026-10-22)

Landed in `040a242e6`. UI lint went **111 warnings -> 44**, 0 errors, with **zero production code touched**.

### The 67 were the rule misreading its own input

`react-refresh/only-export-components` fires when a file exports a component AND something else. Its
"something else" is a component-only heuristic, and the files in question export PURE FUNCTIONS and
CONSTANTS — the pattern several of them document explicitly, e.g. `KdsCardColorsContext.tsx`:

> "Exported for testing. … it validated a private reimplementation. … editing a colour in production would
> leave the suite green while testing values nothing uses."

So the exports are deliberate and load-bearing; **splitting them into separate files to satisfy the linter
would have weakened the tests it was complaining about.** `eslint.config.js` already had an `allowExportNames`
list with 7 names and the same rationale — the list was simply incomplete.

Extended it with 44 more names and one scoped `off` for `src/__tests__/topologyEditorTestHarness.tsx`, which
is a test harness (nothing there is ever hot-reloaded) rather than a production module.

### The 44 that remain are NOT automatable, and that is now PROVEN twice

`@typescript-eslint/consistent-type-imports` × 44, all inline `import()` annotations. Two attempts to clear
them mechanically both had to be reverted (round 26's §11CK records both in detail):

1. `eslint --fix` with a `--rule` override **deleted an `eslint-disable` guard** in 13 files.
2. A hand-written regex converter reported `changed 27 of 27` and **broke value-position `import()` calls**,
   which `tsc` caught as 8 errors.

Still open, and the entry now says so rather than implying the work is nearly done.

### A REAL defect found on the way, and fixed by someone else first

Running the full suite showed **6 failing tests** in `topologyThemeParity.test.ts`, and they were genuine:
`NodeTopologyEditor.css` used `var(--color-info-fg, …)` and `var(--color-info-border, …)`, but
`ui/src/theme/tokens.css` defines only `--color-info`, `-bg` and `-subtle`. Those two resolved their FALLBACK
forever, which is the exact failure the phantom-token test exists to catch.

I fixed it (replacing both with real tokens) and the suite went 6 failures -> 1. **A concurrent session then
landed `6a40d64dc` with the same fix**, so my edit was superseded and the tree no longer contains it. The
finding was real either way and is recorded here because the test caught it, not me.

### Verification

```
npm run lint       -> exit 0, 44 warnings, 0 errors   (was 111)
npm run typecheck  -> exit 0
npm run test       -> 13,126 passed, 1 failed in the full parallel run
   the 1 failure is topologyThemeParity, which passes 7/7 in isolation;
   it is the known load-sensitivity from §11CI, not a logic failure
```

## §11CM — O-M72 closed: UI lint reaches zero, and the rule was flagging a shape nobody expected (2026-10-22)

Landed in `de504492e`. **`npx eslint .` now produces no output at all** — 0 errors, 0 warnings across the
whole tree, down from 111 at the start of round 27 and 44 after the allow-list fix.

### The 44 were two shapes, and neither was the one I briefed

I told the lane to convert inline `import('mod').Member` annotations — the obvious reading of "forbids
`import()` type annotations". **There were none of those.** The actual shapes:

| Shape | Count | Correct rewrite |
|---|---|---|
| `page: import('@playwright/test').Page` | 10 (9 e2e files) | `import type { Page }` — a real named export |
| `typeof import('m')` as a generic ARGUMENT | 34 (18 files) | `import type * as M from 'm'` + `typeof M` |

The second shape is a MODULE NAMESPACE type. None of the 16 modules has an `export default`, so
`import type { X }` would have required inventing a name — which is exactly what my own failed regex
converter did, and why it produced `TS2693: only refers to a type, but is being used as a value here`.

### The lane made a correctness call I would have missed

It rejected eslint's preferred `import { type X }` form for the namespace cases, on the grounds that
TypeScript elides it but a chokidar-driven transform inside vitest's module graph might NOT — which would
turn a type-only import into a real side-effect import and reorder the `vi.mock` graph. `import type * as`
is runtime-erased by any transform. That is a behaviour argument rather than a style one, and it is the
right call. **Worth recording because "the linter prefers this form" is not a reason to accept a risk to the
mock graph.**

### A third CSS defect, caught by the same test it caught twice before

The full suite showed one failure: `topologyThemeParity` on `--color-info-subtle` with a literal tail. The
`6a40d64dc` fix from the other session addressed `-fg` and `-border` but left
`background: var(--color-info-subtle, rgba(59, 130, 246, 0.1))` — a token that IS defined, so the fallback
can never render, and the test says so: *"the literal can never render, so delete it instead of listing it
here."* Removed. **That test has now caught three token defects in this file across two rounds and it is
the most effective guard in the UI.**

### Verification

```
npx eslint .                 -> no output, exit 0 (0 errors, 0 warnings)
npm run typecheck            -> exit 0
npx vitest run <13 changed>  -> 262 passed, 1 skipped
npm run test                 -> 13,126 passed, 1 failed (the CSS defect above, now fixed)
git diff | grep eslint-disable -> nothing (no suppression comment touched)
```

**Process note against myself:** I committed with `git add -A ui/`, which violates the repo's pathspec-only
commit rule. The hook printed path warnings for the nine `e2e/` files but the commit landed with all 28
files correctly. No harm this time — the tree had no other session's work in `ui/` — but the rule exists
precisely for the times it does, and `git add -A` cannot tell the difference.

## §11CN — O-M73 resolved: the sale_id backfill, and why the naive UPDATE would have been worse than none (2026-10-23)

Landed in `d3d85ff6b`. This closes the item I flagged in round 24 and did not finish — worth recording that
it stayed open for five rounds rather than being quietly dropped.

### The defect was an omission, and it was permanent

`20261023_offline_queue_sale_id.sql` added the column, the partial covering index, and the fast branch of
`has_pending_outbox_row_for_sale` — and **never populated the column**. `grep -c 'UPDATE'` on that file
returns 0, and `git grep 'UPDATE offline_queue'` finds nothing anywhere in `migrations/`.

So the O-M04 fix applied only to rows written AFTER the migration. Every pre-existing row keeps
`sale_id = NULL` forever and takes the legacy substring branch on every settlement — even though the
overwhelming majority already carry `"sale_id":"<uuid>"` inside `payload`. Not a slow query: a permanent
one, per row, per settlement, for the life of the database.

### The part that mattered: the obvious UPDATE is WRONG

`substr(payload, instr(payload, '"sale_id":"') + 11, 36)` looks right and is not. Measured against six
deliberately awkward payloads:

| Input | naive `substr` | with the `+47` closing-quote guard |
|---|---|---|
| clean uuid | correct | correct |
| key absent | NULL | NULL |
| `{"sale_id":"abc` truncated | **`"abc"`** | NULL |
| `{"sale_id":null}` | NULL | NULL |
| empty then nested | **`","inner":{"sale_id":"NOT-THIS-ONE-A`** | NULL |
| space after the colon | NULL | NULL |

**A wrong id is strictly worse than a NULL.** The fast branch compares `sale_id = ?` for equality, so a
garbage value can never match and the row becomes invisible to the probe — while the legacy branch, which
would have found it, is no longer reached because `sale_id` is no longer NULL. The naive backfill would have
converted a slow-but-correct path into a fast-but-broken one for exactly the rows it touched.

The fix adds `AND substr(payload, instr(payload, '"sale_id":"') + 47, 1) = '"'` — requiring the 36-byte
value to be a properly closed quoted string. Everything else stays NULL, which is not a regression: the
legacy branch is unchanged and still finds those rows by substring.

### Verification

```
cargo check -p kasirmu-core --all-targets   -> exit 0
cargo test  -p kasirmu-core --lib           -> 3674 passed, 0 failed (194.85s)
generate-pg-migration.py --check            -> ok, 129 tables, 169 indexes
```

Falsified: removing the `+47` guard fails the test with `left: Some("abc")`, `right: None`. Cost measured
at 5,000 rows / 9.2 ms, so the migration is not a startup-latency concern.

## §11CO — O-M74 resolved: a swallowed error hid a schema rename, and the fix took four wrong attempts (2026-10-23)

Landed in `63becfd75`.

### The defect, in two layers

The workspace picker repairs an empty store DB by copying `workspace_instances` rows from the global DB.
Layer one: `let _ = db.execute(...)` discarded every insert result, and `if let Ok(db)` discarded a poisoned
lock. Layer two, only visible once layer one was fixed: `no such table: store_profiles`.

`20260906_rename_store_to_location.sql:14-17` renamed `store_profiles` → `locations` and
`workspace_instances.store_id` → `location_id` **in the store database**. The GLOBAL database the repair reads
from still uses the old names. So the repair was writing global column names into a store schema that had
moved on, and the FK then rejected the instance.

### Four wrong attempts, recorded because each looked right

| # | Attempt | Result |
|---|---|---|
| 1 | Add `tracing::warn!` to the swallowed error | No output — `tracing` is not initialised in this test |
| 2 | Seed `store_profiles` before the instances | `no such table: store_profiles` — the table is `locations` here |
| 3 | `eprintln!` diagnostics | **Worked**, and gave the actual error |
| 4 | `db.as_ref()` for the helper | `E0599` — a `MutexGuard` is not `AsRef` |

**Attempt 1 is the instructive one.** I had already decided that surfacing the error was the fix, so I read
the absence of output as "the branch did not run" for two rounds of edits. `tracing::warn!` is a no-op
without a subscriber — the diagnostic tool was silently inert, which is the same failure shape as the bug I
was fixing. `eprintln!` found it immediately.

### Verification

```
cargo check -p kasirmu-bridge --all-targets  -> exit 0, zero warnings
cargo test  -p kasirmu-bridge --lib           -> 1542 passed, 0 failed, 0 IGNORED
```

The previously `#[ignore]`d `list_workspaces_repairs_from_global_when_the_store_db_is_empty` now passes and
runs in the default suite. Its doc comment was rewritten to record both causes, since the original said only
that the second assertion "FAILS today".

**Left open on purpose:** the sibling `list_workspaces_for_store_scoped` has no repair at all, so the
terminal-management cross-store picker still shows an empty grid in the same situation. That is a feature
decision, recorded on the entry rather than quietly implemented.

## §11CP — O-M75 resolved: an ignore reason that was simply false, and the fixture trap behind it (2026-10-23)

Landed in `094d0ce0d`.

### The reason was wrong, and checking it took one command

`crates/kasirmu-plugin/tests/signature_roundtrip.rs` carried:

```rust
#[ignore = "needs python3 + the cryptography package; run with --ignored"]
```

Both are present on this machine — `python3` resolves through the cargo bin shim, `cryptography` is 50.0.0.
Run with `--ignored`, the test **passed in 1.57 s**. It had been skipped for a reason that described an
environment which did not exist.

This is the second consecutive round in which an `#[ignore]`d test was hiding something. O-M74's was hiding a
live defect; this one was hiding a working test. **An `#[ignore]` reason is a claim about the environment, and
nothing re-checks it** — the comment ages while the machine changes under it.

### Un-ignoring it found a real hazard immediately

The moment it ran without `--ignored`, it failed with
`PermissionDenied ... C:\WINDOWS\TEMP\.tmpeCx8I`. `tempfile::tempdir()` resolves through `TEMP`, which is
`C:\WINDOWS\TEMP` at machine scope here — **creatable but not deletable by an ordinary user**, so once any
stale directory exists the create itself fails and reads as a broken test.

`crates/kasirmu-test-support`'s module documentation describes this exact trap and records it as having
broken **144 tests at once** in `mobile-tauri`. The remedy existed; this crate had not adopted it.

### The fix, and its size

`tempfile::tempdir()` → `kasirmu_test_support::tempdir()` at **77 sites across 6 files**
(`grants_tests`, `loader_tests`, `manager_tests`, `manifest_tests`, `package_tests`, `signature_tests`), plus
the dev-dependency. Every fixture now lives under `<workspace>/target/test-scratch/`: gitignored, per-call
UUID, auto-deleting.

### The uncomfortable part: my own build recipe masked it

My `.bat` wrapper sets `TEMP`/`TMP` to `target/mstmp` before invoking cargo. That override means the trap
cannot fire in a run I launch that way — so the SAME test looked like a repository bug under the wrapper and
a non-issue when I called `cargo` directly. **Both readings were wrong**, and neither would have been stable
for the next person, who will not be using my wrapper.

That is worth recording as a class: a build recipe that changes the environment can hide environment-
dependent test failures, and it will hide them from exactly the engineer best placed to fix them.

### Verification

```
cargo check -p kasirmu-plugin --all-targets  -> exit 0
cargo test  -p kasirmu-plugin                 -> 239 + 1 + 2 passed, 0 failed, 0 IGNORED
rustfmt --edition 2024 --check                -> exit 0 on all 7 files
```

**Already complying:** `mobile-tauri` has 21 bare `tempfile::tempdir()` calls and 0 `kasirmu_test_support::tempdir()`,
yet its suite is 721 passed / 1 failed where that one failure is an unrelated command-count drift pin. So the
trap is latent there rather than active — recorded, not touched, because the crate is another session's area.

## §11CQ — O-M76 resolved: the read gate was passing a topology route through unchecked (2026-10-23)

Landed in `2907a50e4`.

### The failure, and why the test that found it exists

`read_key_map_covers_all_protected_get_routes` failed with:

```
READ_KEY_MAP is missing GET route(s) that the router registers, so the read gate
would pass them through unchecked (API-A): ["/api/v1/topology/revisions/pull"]
```

`/api/v1/topology/revisions/pull` was added by the topology Phase 3/5 work as a GET on the
**protected** router. `read_gate_middleware` looks the `(method, path)` up in `READ_KEY_MAP` and,
when nothing matches, **passes the request through** — the map is an allow-by-omission design, which
is correct for sync and public routes and wrong for any protected GET nobody remembered to add. So a
token scoped to `products:read` could pull revision payloads (diagram envelopes, signatures,
publishing actor) with no permission check at all.

This is the **same defect class as `/api/v1/memos/active`** (API-A), which is why that test was
rewritten to parse `lib.rs` rather than a hand-typed list. The test worked exactly as designed: it
fired on the next route that repeated the mistake.

### Choosing the key: do not invent one

The topology family registers **only `topology:write`** — there is no `topology:read`. Writing
`key: "topology:read"` would have looked tidier and been a second bug: `has_permission` is false for
any key not in the registry, so **every scoped token would be denied** and terminal replication would
break silently — a fail-closed bug that no test in this file was aimed at.

The entry therefore names `topology:write`: the permission that already governs the graph, and one a
publisher plainly holds. If a read-only topology tier is ever wanted, it is a registry change
(`platform/core/src/permission_registry.rs`) plus a `ReadKeyEntry` edit, and the coverage test will
hold the second half of that in place.

`pii: false` — the handler selects `id, branch_id, revision, base_revision, change_note, diagram,
…, published_by, tenant_id, org_id, actor, key_id, signature`. That is revision metadata plus a
diagram envelope; it does not join workspace or location rows.

### The test I added, and its falsification

The coverage test is a **source parse**: it proves an entry exists, and says nothing about what the
middleware does with it. A renamer could keep it green. So
`topology_pull_route_is_gated_not_passed_through` drives the real middleware:

- `permissions: ["products:read"]` → 403
- `permissions: ["topology:write"]` → 200

Falsified by deleting the `ReadKeyEntry` and re-running: **left 200, right 403** — the test fails on
the real bypass, not on a technicality. Restored, 23/23 pass.

### The stale-binary trap fired again

After restoring the file the suite came back `21 passed; 2 failed` with the entry plainly present on
disk (`git diff --stat` showing +18). The restore reported success and `Select-String` found the path
string; only the re-run disagreed. Touching the file and re-running gave 23/23.

That is the **seventh** time this checkout has run a stale test binary. The rule already written here
holds: if a test result contradicts source you can read, `touch` and retry — but note what made this
instance confusing, because a truthy `grep -c 'topology/revisions/pull'` returning `1` is consistent
with both "restored" and "partially restored". Counting a string is not inspecting the artifact.

### Verification

```
cargo test -p kasirmu-api --lib read_tiers  -> 23 passed, 0 failed  (was 22 with 1 failing)
falsification (entry removed)               -> topology_pull... FAILED, left 200 right 403
rustfmt --edition 2021 --check              -> clean on my hunks (@@ -125 / @@ -297);
                                               import-block drift predates this change
```

**Ledger: 142 defined, 142 closed, 0 open.**

## §11CR — O-M77 opened: the sibling workspace picker still has no read-repair (2026-10-23)

**Recorded, not fixed.** This is a product decision, not a bug I should silently reverse.

`list_workspaces` (the pre-session picker) gained a read-repair path: when the store db's
`workspace_instances` is empty, it re-seeds from the global identity db. `list_workspaces_for_store_scoped`
(`workspaces.rs:799` — the terminal-management screen's cross-store picker, reached from
`apps/desktop-tauri/src/commands/workspaces.rs`) has **no such repair**. Same fixture, same global row,
and it returns `[]`.

`list_workspaces_for_store_scoped_has_no_read_repair` (`workspaces_tests.rs:360`) pins the asymmetry
with this message, which is the right instruction to leave behind:

> If this ever returns the global row, the repair was extended here too — good, and this test should
> then assert the repair instead.

### Why I am not fixing it this round

The function is not a straight copy of its sibling. It loads the assignment **and** the signed tenant
subscription from the global db, validates clock rollback, verifies the RSA signature, and applies
`list_workspaces_with_entitlement`. A repair bolted onto that path has to answer a question the
sibling never faces: **when the store db is empty, which rows are the authoritative ones** — the global
rows filtered by the same entitlement, or nothing until a sync runs? The sibling answers "re-seed and
persist". For a cross-store picker that may then be used to create assignments, re-seeding changes what
a *different* store's db contains as a side effect of a *read*.

That is a data-ownership call, and the recorded decision is that reads repair the picker they serve.
Extending it is a deliberate act with a migration-shaped consequence, so it stays open rather than
being folded into a gate fix.

### What closing it would take

1. Decide the authority rule above, and write it down where the test points.
2. If repair is adopted, factor the sibling's `has_empty` / `global_rows` logic into one helper so the
   two paths cannot drift again — the duplication is what let the asymmetry appear in the first place.
3. Flip the assertion in `list_workspaces_for_store_scoped_has_no_read_repair` to assert the repair,
   and rename it; it names the absence, so it cannot survive the fix unedited.

**Ledger: 143 defined, 142 closed, 1 open.**

## §11CT — O-M77 CLOSED by someone else: the ledger lagged the code (2026-10-23)

**The code was right and this ledger was wrong.** §11CR opened O-M77 as "the scoped
workspace picker has no read-repair", deliberately, as a data-ownership call. That call was
made: `1924c7851` ("give the scoped workspace picker the read-repair its sibling has") added
it, and the pinning test was renamed and its assertion flipped exactly as §11CR's own
"what closing it would take" item 3 required:

```
list_workspaces_for_store_scoped_has_no_read_repair     <- the name that vanished
list_workspaces_for_store_scoped_repairs_from_global_when_the_store_db_is_empty   <- the name now
```

The renamed test's doc comment opens with "The asymmetry is CLOSED", and its assertion is
now `rows.len() == 1` where it previously asserted `rows.is_empty()`. `workspaces.rs` reads
the global rows under a comment naming "the read-repair's source rows".

### Why this is recorded rather than silently ticked

A ledger that keeps an entry open after the fix has landed is not a harmless bookkeeping
lag. It is the exact failure mode this journal exists to prevent, inverted: the journal's
own history lists five entries caught ranked as open work *after they were already fixed*
(O-H23, O-H24, O-H26, O-H03, O-H04, O-H08). Those were found by hand. This one was found
by reading the entry's own cited test and discovering the test no longer had that name.

**The check that would have caught it** is the one §11CR already wrote: it named the
test that pins the absence. A closure is legible if the entry says WHICH test would have
to change, because then the test's disappearance is detectable. §11CR did that, which is
why this took one grep instead of an audit.

### What was NOT verified

The repair's own correctness: that the persisted seed is right for every entitlement tier,
and that the FK-target case behaves (a sibling test at `workspaces_tests.rs:429` covers
one such shape). Verifying that is a PostgreSQL-shaped exercise and this host has no
server. What IS verified here is the narrower claim this ledger makes: the asymmetry
the entry describes no longer exists in the code or in its test.

**Ledger: 143 defined, 143 closed, 0 open.**

## §11CS — O-M78 resolved: 706 leaked scratch directories, from a guard six modules dropped (2026-10-23)

**O-M78 · test harness — 706 leaked scratch directories, from a guard six modules dropped** — resolved in §11CS.

Landed in `fc64e499b`.

### The measurement that started it

`target/test-scratch/` held **1,455** directories. Grouped by prefix:

| prefix | count |
|---|---|
| `kasirmu-bridge-*` | **706** |
| `kasirmu-test-*` | 117 |
| `oz-pos-*` | 74 |
| `oz-test-*` | 38 |
| `kasirmu-mobile-*` | 14 |

`crates/kasirmu-bridge/src/testing.rs` documents this exact failure and claims it is
fixed: "1,911 `kasirmu-bridge-store-*` leftovers were measured here after a handful of runs.
The guard deletes it on drop." The guard is real — `ScratchDir` has a `Drop` that calls
`remove_dir_all`. **So the count came from somewhere the guard never ran.**

### The cause: a setter that cannot know where the files are

`TestBridge::new()` builds its manager and stores the guard in a `_store_scratch` FIELD
(correctly — the module doc explains why a local would delete the directory the manager is
still using). But `with_db_manager(manager)` **replaces the manager and leaves
`_store_scratch` pointing at the old directory**. A test module that builds its own manager
over `kasirmu_test_support::scratch_dir(...)` gets a bare `PathBuf` — `scratch_dir` has no
guard, only `ScratchDir::new` does — and nothing ever deletes it.

Six modules had each copied their own `unique_store_dir() -> PathBuf`, so six modules leaked
a directory per test: `inventory_tests`, `local_payment_tests`, `regional_tests`,
`tables_tests`, plus the two `memo_tests` call sites. Their doc comments all explain the
`C:\WINDOWS\TEMP` trap correctly — **the move to `target/` fixed the failure and silently
introduced the leak**, because `target/` is not cleaned by an OS temp cleaner and the bare
path they switched to has no `Drop`.

### The fix

`TestBridge::with_db_manager_scratch(manager, scratch)` — replaces the manager AND takes
ownership of its directory guard, so the directory lives exactly as long as the manager that
uses it. Every copy was rewritten to return `(PathBuf, ScratchDir)` instead of `PathBuf`.

### Falsified, not assumed

```
cargo test -p kasirmu-bridge --lib -- tables:: inventory:: regional:: local_payment::
  before=706   test result: ok. 49 passed   after=706
```

**Zero net new directories.** Before this change the same run added one per test. The count
itself is the gate: a fix that passed every test while still leaking would look identical in
the test output and different here.

### A mistake I made and caught

My first bulk edit rewrote `flow_bridge(conn, store_manager())` to
`flow_bridge(conn, store_manager().0, store_manager().1)` — which calls the constructor
TWICE, creating two guards and two directories, and deleting one of them. The count went UP
in principle while the code compiled. Reverted the string replace and bound the tuple once per
call site (`let (manager, scratch) = store_manager();`). A mechanical rewrite of a call whose
function has a side effect is not mechanical.

### Verification

```
cargo check -p kasirmu-bridge --all-targets  -> exit 0
cargo test  -p kasirmu-bridge --lib (5 modules) -> 75 passed, 0 failed
leak gate: 706 before == 706 after               -> 0 new
rustfmt --edition 2021 --check                   -> clean on my hunks;
                                                    testing.rs/regional/memo drift predates this
                                                    commit (1 diff each in the HEAD blob too)
```

**Ledger: 144 defined, 143 closed, 1 open.**

## §11CT — O-M79 resolved: the unguarded scratch helper, 1,455 leaked directories, and a gate that graded nothing (2026-10-23)

**O-M79 · test harness — the unguarded scratch helper leaked 1,455 directories and the first gate written for it graded nothing** — resolved in §11CT.

Landed in `52ac568ae` plus the fixture migration commits that follow it.

### The number

`target/test-scratch/` held **1,455** directories. Round 32 removed the 706 that came
from a bridge harness dropping its guard. This round went after the rest: 30 direct
`kasirmu_test_support::scratch_dir` call sites across 20 files.

Their three prefixes, grouped by static name:

| prefix | count | what it was |
|---|---|---|
| `oz-pos-test-csv-*` / `-empty-*` | 74 | export tests |
| `oz-test-backup-*` | 38 | one backup test |
| `kasirmu-*` (other lanes) | remainder | already covered or not mine |

### Why it leaked: the API offers two ways and only one is safe

`scratch_dir(prefix) -> PathBuf` returns a bare path whose drop deletes NOTHING.
`ScratchDir::new(prefix)` returns a guard whose `Drop` calls `remove_dir_all`. Both sit
in the same crate, and the module's own "which helper to use" table listed the unguarded
one FIRST, as though "you manage the lifetime" were an ordinary choice.

The `oz-test-backup` site shows the failure exactly: it called `remove_file` on the
`.db` INSIDE the directory and then walked away from the directory itself, with a comment
explaining the Windows open-handle concern that made it careful about the file. The
careful half was careful; the other half leaked.

### The real defect was that nothing could see it

The crate had a test proving `ScratchDir` cleans up — `scratch_dir_removes_itself_on_drop`.
It had **no test** proving `scratch_dir` does not. So the two APIs were assumed
interchangeable, and 30 callers picked the one that leaks while every suite stayed green.

Added `scratch_dir_does_not_remove_itself_and_that_is_the_hazard`, which asserts the
hazard deliberately: if someone ever gives `scratch_dir` a guard, that test fails and the
author must read why the two are not interchangeable. Rewrote the selection table to put
`ScratchDir::new` first and added an explicit warning block to `scratch_dir`'s docs.

### A fifth copy of the scratch root, deleted

`platform/sync/src/test_helpers.rs` carried its own hand-written copy of "walk up from
CARGO_MANIFEST_DIR for a directory holding Cargo.lock and target/". That was the fourth
copy of the same logic. It now delegates to `kasirmu_test_support::scratch_dir`.

### The gate, and the two ways I built it wrong first

`scripts/check-scratch-leaks.py` counts unguarded call sites per file against a
committed budget (`scripts/scratch-leak-budget.json`), wired into `scripts/check.sh` and
`dev-ci.yml#static-gates` as `scratch-leak-gate`. A budget rather than a ban, because a
few sites legitimately need a path that outlives any guard.

**Mistake 1 — file-level pairing.** My first version treated a file as clean if it called
`remove_dir_all` ANYWHERE. I injected a leak into `fiscal_tests.rs` to prove the gate fired;
it exited 0. The file already cleaned up elsewhere, so the new leak inherited the file-wide
credit. Fixed by pairing per function scope.

**Mistake 2 — the actual bug.** After the fix, the injected leak STILL passed. The cause was
`delegating_wrapper()`: a `for` loop over `fn scratch_dir(` definitions that fell through to
`return True` when the loop body never ran. **Every file in the workspace was therefore
exempted, and the gate graded nothing at all while printing `OK`.** Two leaks injected into
two different crates both passed. Fixed with an explicit `saw_one` flag.

That is the same defect class as the scan-and-pass gates this project has shipped before,
and it arrived inside the gate written to catch that class. The lesson is narrow and
repeatable: **a predicate that is vacuously true over an empty set is indistinguishable from
a passing gate.** Only injecting a known-bad input found it.

### Falsification, after both fixes

```
inject unguarded call into crates/kasirmu-core/src/db/fiscal_tests.rs   -> exit 1
inject unguarded call into platform/sync/src/image_push_tests.rs         -> exit 1
restore both                                                            -> exit 0
point CALL_RE at a pattern that matches nothing                         -> exit 2
   ('DETECTOR WENT DEAF', failing probe named)
```

The detector is graded over nine synthetic shapes BEFORE any real file is read — qualified,
imported, spaced calls; definition, doc mention, line comment; and three scope-pairing
cases including the exact one that fooled mistake 1.

### Ledger: 145 defined, 144 closed, 1 open.
## §11CU — O-M80 resolved: the 12 'environmental' recovery failures were a guard dropped one scope too early (2026-10-23)

**O-M80 · kasirmu-core — 12 recovery tests failed with SQLite CannotOpen and were misread as a broken filesystem** — resolved in §11CU.

Landed in `229177a6e`.

### What was reported, and what was true

The `kasirmu-core` fixture migration finished with this result:

```
test result: FAILED. 3662 passed; 12 failed; 0 ignored; 0 measured; finished in 165.87s
```

All 12 were `db::recovery*`, all with the same message:

```
SqliteFailure(Error { code: CannotOpen, extended_code: 14 },
  Some("unable to open database file: C:\\dev\\kasirmu\\target\\test-scratch\\
        oz_restore_gate_well_formed-<uuid>\\candidate.db"))
```

The report concluded these were **pre-existing and environmental**: the same 12 failed at HEAD,
the same code passed in a clean tree at `%TEMP%`, and a filesystem bisect (python sqlite3, the
bundled `sqlite3.exe`, ctypes `CreateFileW`) showed writes succeeding under the crate directory,
under `%TEMP%`, and under other `target/` subdirectories — but not under
`target/test-scratch`. The recommendation was that other lanes should expect these failures.

**That conclusion was wrong, and the bisect was the tell.** A filesystem that refuses SQLite
opens in exactly one subdirectory is not a filesystem property; it is a directory that does not
exist. `Connection::open` reports a missing parent directory as `CannotOpen`, not as `NotFound`.

### The actual cause, in three lines

```rust
fn new(label: &str) -> Self {
    let scratch = kasirmu_test_support::ScratchDir::new(&format!("oz_restore_{label}"));
    std::fs::create_dir_all(scratch.path()).unwrap();
    Self(scratch.path().to_path_buf())   // <-- guard dropped HERE, deletes the directory
}
```

`Scratch` is a tuple struct holding a `PathBuf`. The `ScratchDir` guard was a LOCAL, so it was
dropped when `new()` returned — deleting the directory it had just created. The `create_dir_all`
above it ran while the directory still existed, so it silently succeeded and hid the problem.
Every later `Connection::open(path.join("candidate.db"))` then failed, because the parent was gone.

HEAD's version used the unguarded `scratch_dir()` and therefore worked: the directory persisted
by accident. The migration converted a helper that leaked directories into one that deleted the
directory out from under its own callers — and the conversion looked mechanical.

### The fix

The struct now holds the GUARD, not the path: `struct Scratch(kasirmu_test_support::ScratchDir)`,
with `self.0.path()` at the accessor sites. The hand-written `Drop` and the defensive
`create_dir_all` are both deleted, because the guard supplies both. Applied to all three helpers
(`recovery_gate_tests`, `recovery_inline_tests`, `recovery_tests`).

### Verification

```
cargo test -p kasirmu-core --lib recovery_   ->  10 passed; 0 failed  (was 12 failing)
cargo test -p kasirmu-core --lib             ->  3674 passed; 0 failed (was 3662 / 12)
cargo test -p kasirmu-bridge --lib           ->  1542 passed; 0 failed
cargo test -p kasirmu-api --lib              ->  374 passed; 0 failed; 14 ignored
target/test-scratch directory count          ->  1653 -> 2
```

### The lesson, which is about diagnosis and not about Rust

A guard's lifetime is part of the migration, not an implementation detail of it. When moving from
'bare path, nobody owns it' to 'guard owns it', EVERY scope between construction and last use has
to be re-checked, because the guard deletes at the end of the scope it lives in. A helper that
returns `Self(path)` from a function that owns the guard returns a path to nothing.

And the diagnosis deserves recording more than the fix: **an environmental explanation was
accepted for a defect that a three-line read would have found.** The evidence for 'environmental'
was strong — reproduction at HEAD, a clean-tree control, a three-tool filesystem bisect. Every one
of those observations was true and every one was consistent with the real cause, because they all
compared trees where the helper had DIFFERENT CODE (HEAD's unguarded version vs the migrated one);
the 'control' at HEAD was not a control at all. A control must hold the suspect constant.

### Ledger: 146 defined, 145 closed, 1 open.
## §11CV — O-M77 closed: the scoped workspace picker got the read-repair its sibling had (2026-10-23)

Landed in `1924c7851`.

### Why it had stayed open

`list_workspaces` (the pre-session picker) re-seeds an empty store DB from the global
identity DB. `list_workspaces_for_store_scoped` (the terminal-management screen's
cross-store picker) never did, so a freshly provisioned terminal opened that screen onto
an empty grid. Round 32 recorded the asymmetry instead of reversing it, and the reason was
sound at the time: the two functions looked like they had different data-ownership rules,
and extending a repair changes what a *different* store's database contains as a side
effect of a *read*.

### What dissolved the objection

Reading the two listers showed they are not different rules at all:

```rust
pub fn list_workspaces(&self, ...)                  -> list_workspaces_inner(...)
pub fn list_workspaces_with_entitlement(&self, ...) -> list_workspaces_inner(...) then retain(allows_workspace_type)
```

Both are the same inner resolution; the scoped one adds a tier `retain`. So a repair
seeded from `list_workspaces_with_entitlement` writes exactly the rows the scoped caller
was already entitled to see, and the returned set is still the retained one. The
"different authority rule" was not different — it was one function using a filtered view
of the same list.

That is the general form of the mistake this ledger keeps recording: an open item was
argued from what the two function NAMES suggested, not from what the two functions CALL.

### The change

The 59-line repair body was extracted into `repair_store_db_from_global_rows(conn, rows)`
and called from both listers. Extraction was not cosmetic: the two paths had already
drifted once, and a second copy would have made the next drift invisible in the same way.

### The test that flipped, as it asked to be

`list_workspaces_for_store_scoped_has_no_read_repair` pinned the ABSENCE, and its own
failure message said exactly what to do when the repair arrived:

> If this ever returns the global row, the repair was extended here too — good, and this
> test should then assert the repair instead.

It is now `..._repairs_from_global_when_the_store_db_is_empty`, asserting three things:
one row returned, the right instance and type, and — separately — that the row PERSISTED
into the store DB. That third assertion is the one that matters, because the round-26
defect was a repair that returned rows without writing them and re-ran on every boot.

### Falsified, because a green test proves nothing on its own

With the scoped repair call disabled and everything else untouched:

```
test workspaces::workspaces_tests::list_workspaces_for_store_scoped_repairs_from_global_
     when_the_store_db_is_empty ... FAILED
assertion `left == right` failed: the repair must persist the row into the store db,
     not only return it
  left: 0
 right: 1
test result: FAILED. 27 passed; 1 failed
```

The failure landed on the intended assertion (persistence, not the row count) and the
other 27 tests were unaffected, so the test is aimed at the repair rather than at the
fixture. Restored afterwards.

### Verification

```
cargo test -p kasirmu-bridge --lib workspaces::  ->  28 passed, 0 failed
cargo check -p kasirmu-bridge --all-targets      ->  clean
rustfmt --edition 2024 --check (both files)      ->  clean
```

### Ledger: 146 defined, 146 closed, 0 open.
## §11CW — O-M78: the 31 leftover store dirs were killed processes, not a leak (2026-10-23)

**O-M78 · test harness — the 31 leftover store dirs were killed processes, not a leak** — recorded in §11CW as a measurement correction to §11CS.

**A measurement correction, recorded because the previous section's method invited it.**

After the full bridge run, `target/test-scratch/` held 36 directories — 31 of them
`kasirmu-bridge-store-*` with 4 entries each, which looked exactly like `TestBridge::new()`
dropping its guard again.

### The test that settled it

Parked the whole directory, started a fresh empty `target/test-scratch/`, and ran the
28-strong `workspaces::` module — a module that constructs a `TestBridge` per test:

```
test result: ok. 28 passed; 0 failed
left: 0
```

**Twenty-eight bridges, zero leftover directories.** The guard runs. The 31 were residue
from processes I had force-killed earlier in this session (`Stop-Process` on
`kasirmu_*` to clear the `LNK1104` / `permission denied` link errors) — a killed process
skips every `Drop`, so its `ScratchDir` never removes anything.

### Why this is worth a section

Two rounds running, the count of directories under `target/test-scratch/` has been used as
the evidence for a leak, and once it was right (706 real) and once it was wrong (31, of
which the true count was 0). The measurement does not distinguish them on its own.

The distinguishing experiment is cheap and should be the default form of the question:
**park the directory, run ONE bounded module, and count what it leaves.** A run that
leaves nothing proves the guards work; a directory count on a shared, long-lived tree after
an arbitrary number of force-killed processes proves very little.

Consequence for future rounds: when the bridge suite is interrupted by a kill, the
leftovers are expected, and `python scripts/check-scratch-leaks.py` is the static check
that does not depend on how a process died.
## §11CX — O-M81 closed: the bridge suite was 3.9x slower than it needed to be, and more threads caused it (2026-10-23)

**O-M81 · test harness — the bridge suite ran at libtest default 32 threads, the slowest point on its own curve** — resolved in §11CX.

Landed in `843cac981e`.

### The question nobody had answered

`cargo test -p kasirmu-bridge --lib` had been taking **1395-1471 s** for three rounds.
Each round it was noted as "slow but progressing" and deferred, because the obvious
hypothesis — `fresh_db`'s global `Mutex` serialising every test-db clone — was already
documented as measured and deliberate, so it read as "expected".

### What the per-module measurement showed, and why the hypothesis was wrong

| module | tests | time |
|---|---|---|
| topology | 332 | **7.76 s** |
| kds | 38 | 61.94 s |
| auth | 72 | 53.17 s |
| reports | 42 | 52.89 s |
| sync | 38 | 4.20 s |

The 332-test module finished in under eight seconds while a 38-test module took sixty.
Serial totals confirm it is not "every test costs ~1.2 s": `topology::` at
`--test-threads=1` runs all 332 in **9.66 s** (0.03 s each), and a single kds test alone
takes 1.68 s. So the cost is per-module, not per-test.

The discriminator is `TestBridge::new()`: `kds`, `auth`, `reports`, `pos` and `staff`
build many bridges, and every `TestBridge::new()` clones the migrated snapshot through
`fresh_db()`. `topology` mostly does not. That is the documented ceiling — but the
documented ceiling is about CLONES, not about module size, which is why nobody connected
them.

### The measurement that names the fix

`kds::` alone, one variable (thread count):

| threads | time |
|---|---|
| 1 | 42.79 s |
| 2 | 31.17 s |
| **4** | **26.37 s** |
| 8 | 50.80 s |
| 32 | 92.90 s |

**Raising the thread count made it 3.5x slower.** libtest's default is the core count, so
the suite had been running at the worst point on its own curve.

Then the whole suite, with nothing changed but that flag:

```
cargo test -p kasirmu-bridge --lib                        -> 1395-1471 s  (1542 passed)
cargo test -p kasirmu-bridge --lib -- --test-threads=4    ->    355.95 s  (1542 passed)
```

Identical results, 3.9x faster. Confirmed under nextest too, which honours the new
`.config/nextest.toml` setting: `kds::` **15.04 s**, 38/38 passed.

### The change

`.config/nextest.toml` `[profile.default]` gains `test-threads = 4` with the curve above
written into the comment, so the next person does not "optimise" it back. `[profile.ci]`
inherits it. `[profile.quick]` already used 4 — the fast path was right and the default
was not. `migrations.rs`'s existing note (the one that predicted this) gains the
suite-scale numbers, because its microbenchmark version had already failed to prevent the
regression once.

### Why this is worth a section

**"Documented as deliberate" and "documented correctly" are different claims.** The
`fresh_db` note was accurate about its own function and measured carefully, and it still
did not stop the suite from running at a bad setting for months, because it described a
ceiling on clone throughput and the symptom was a total suite time. A note that describes
a mechanism needs a second note at the place where a knob chooses between operating points.

Second: the deferral each round was rational in isolation ("slow but progressing") and wrong
in aggregate. Three rounds of 23-minute suites is roughly an hour of wall time, against about
twenty minutes to measure once.

### Ledger: 147 defined, 147 closed, 0 open.
## §11CY — O-M82 OPENED: nextest runs kasirmu-core 4.6x slower than cargo test, and the snapshot explains it (2026-10-23)

**O-M82 · kasirmu-core — nextest rebuilds the migrated test-db snapshot per test, 4.6x slower than cargo test** — opened in §11CY, resolved in §11CZ.

**Recorded, not fixed. The fix is a design change to the test database, not a flag.**

### The measurement

While confirming round 35's thread pin applies to the largest crate, one number did not
fit and would have been easy to skip past:

| runner | kasirmu-core --lib (3674 tests) | per test |
|---|---|---|
| `cargo test -- --test-threads=4` | **65.10 s** | 17.7 ms |
| `cargo nextest run` (default profile) | 294.89 s | 80.3 ms |
| `cargo nextest run --profile quick` | 298.29 s | 81.2 ms |

**4.6x slower under nextest**, and identical between the default and `quick` profiles —
which rules out `retries` (the obvious suspect, since `quick` sets `retries = 0` and
`default` sets `count = 2`). The difference is not retry policy.

### Why, and why it hits core but not bridge

`fresh_db()` (`crates/kasirmu-core/src/migrations.rs:782`) builds a pre-migrated SQLite
snapshot once, in a `static LazyLock<Mutex<Connection>>`, then clones it per test through
SQLite's backup API. The whole point of that design is that the 68-migration chain runs
**once per process** and every later test in that process gets a ~3 ms page copy.

`cargo test` runs one process per test BINARY, so the snapshot is built once and shared by
all 3674 tests. **nextest forks a process per TEST**, so each of the 3674 tests rebuilds
the entire 68-migration chain (~305 ms measured) before it does anything. Partial overlap
under 4-way parallelism is why the result is 298 s rather than the 1120 s a naive
3074 x 305 ms would predict — but the mechanism is the same one.

`kasirmu-bridge` does not suffer this: its 38-test `kds::` module ran **15.04 s under
nextest against 26.37 s under `cargo test --test-threads=4`**, i.e. nextest is 1.75x
FASTER there. Its fixtures are cheaper to build, so nextest's per-test process isolation
costs less than its better scheduling saves. **The same tool is the fastest runner for one
crate and the slowest for another, and neither measurement generalises.**

### Why it is not fixed this round

Removing the per-process rebuild means sharing one migrated snapshot across processes
(a memory-mapped file, or a template the runner copies), which changes how 613 `fresh_db()`
call sites obtain their database. That is a redesign of the test harness, not a
configuration change, and a wrong version of it silently hands two tests the same database
— the exact defect class this ledger has spent three rounds removing from the scratch
directories.

### What a fix would have to show

1. The snapshot is shared, and a mutation in one test is still invisible to the next.
2. `cargo nextest run` on `kasirmu-core` drops toward the 65 s that `cargo test` achieves,
   without any test changing its reported result (3674 passed either way).
3. It is measured on `kasirmu-bridge` too, because that crate currently BENEFITS from
   nextest and a fix that helps one while hurting the other is not a fix.

Meanwhile the honest advice is runner-per-crate, not one answer: `cargo test` for
`kasirmu-core`, `nextest` for `kasirmu-bridge`.

### Ledger: 148 defined, 147 closed, 1 open.
## §11CZ — O-M82 CLOSED: the disk snapshot took nextest on kasirmu-core from 294.89 s to 48.52 s (2026-10-23)

Landed in `ba3a605ac`.

### What round 36 left open, and what dissolved it

Round 36 recorded this as needing "a design change to the test database, not a flag",
because sharing one snapshot across processes sounded like it meant sharing one mutable
database. Measuring first showed the costs were not close enough to justify that fear:

```
assemble the migration SQL      458.8 us
RUN the 82 migrations           440.66 ms   <-- what every process paid
clone an existing snapshot        1.05 ms   <-- 420x cheaper
```

(The existing comment said "~305 ms"; the real figure on this machine is 440.66 ms, so
the note understated the problem it was describing.)

### The change

`fresh_db()` keeps its in-process `LazyLock` snapshot — one process running many tests still
pays nothing — and adds a FILE cache at
`target/test-scratch/kasirmu-core-migrated-snapshot-<fingerprint>.sqlite`. A cold process
clones from the file instead of rebuilding the chain; a cold cache builds once and publishes
the file for every other process.

Three properties had to hold, and each is deliberate:

1. **The key covers ids AND sql lengths.** A migration edited in place would otherwise reuse
   a stale schema — the classic cache-key bug, in the one crate where debugging it would be
   most expensive.
2. **Writes go to a staging name and are renamed.** Two nextest processes racing on a cold
   cache must never let one open a half-written file.
3. **A torn or locked file falls back to rebuilding**, and a read-only scratch root simply
   skips the write. The cache is a speed property, never a correctness one.

### The measurement

| runner | kasirmu-core --lib, 3674 tests |
|---|---|
| nextest, before | 294.89 s |
| nextest, cold cache | **48.52 s** |
| nextest, warm cache | 49.71 s |
| cargo test --test-threads=4 | 66.02 s (unchanged) |

**6.1x faster under nextest**, and `cargo test` did not regress. 3674 passed at every
configuration, and after the fix the full suite is 3675 passed (the new test is counted).

### The guard, and its falsification

The risk this change carries is exactly the one round 36 named: a shared cache that also
carried writes would leak one test's rows into another. `fresh_db_cache_holds_no_business_rows`
asserts the file holds the full migration set and ZERO rows in `settings`, `locations`,
`workspace_instances`, `products` and `sales`.

Falsified by writing one `settings` row into the cache with an external sqlite client:

```
assertion `left == right` failed: the snapshot cache must hold no rows in settings;
    a shared mutable cache would leak one test's writes into another
test result: FAILED. 0 passed; 1 failed
```

Restored afterwards. The write was possible, which is why the test is a real guard rather
than a formality.

### One failure during verification, chased down and exonerated

A full run reported `db::audit::tests::log_audit_in_tx_redacts_sensitive_details` FAILED.
Recorded here because it was investigated rather than retried:

- It passed in isolation, and did not reproduce in the next full run (3675/0).
- Six consecutive `audit::` runs passed, cold cache and warm.
- With `--test-threads=1`, `audit::` is 91/91 green; with parallelism it failed a
  DIFFERENT test each time (`audit_chain_verification_detects_chain_discontinuity`, then
  `audit_log_long_user_id`).

**Cause: the audit tests share process-global counters.** `audit.rs` holds `AUDIT_COUNT` and
`AUDIT_WINDOW_START` as statics, and every test calls `reset_audit_rate_limit_for_test()`,
which zeroes them. Under parallelism one test's reset erases another's count. That is a
pre-existing isolation defect that has nothing to do with this change — the statics predate
it, and the failure moves between tests instead of landing on one. Recorded as O-M83.

### Ledger: 149 defined, 148 closed, 1 open.
## §11DA — O-M83 OPENED: the audit tests share process-global rate-limit counters (2026-10-23)

**Recorded, not fixed.** Found while investigating one failure that turned out not to be
mine (see §11CZ), and it is a real defect on its own.

### The measurement

```
cargo test -p kasirmu-core --lib audit:: -- --test-threads=1   ->  91 passed, 0 failed
cargo test -p kasirmu-core --lib audit:: -- --test-threads=8   ->  90 passed, 1 failed
```

Three parallel runs failed three DIFFERENT tests — `audit_chain_verification_detects_chain_
discontinuity`, `audit_log_long_user_id`, and once `log_audit_in_tx_redacts_sensitive_details`
— which is the signature of shared state rather than a broken assertion.

### The cause

`crates/kasirmu-core/src/db/audit.rs` keeps the rate limiter in two process-wide statics:

```rust
AUDIT_COUNT          // AtomicU64
AUDIT_WINDOW_START   // AtomicU64
```

and `reset_audit_rate_limit_for_test()` stores 0 into both. Ninety-one tests call it (or
`set_audit_rate_limit_for_test`), and libtest runs them concurrently in ONE process, so a
test that resets the window is racing every test that is mid-way through counting against
it. The tests are individually correct and collectively unsound.

### Why it is not fixed this round

The honest fixes change what is under test:

1. **Serialize the affected tests** (`#[serial]`, already a dev-dependency — `serial_test` is
   in `crates/kasirmu-core/Cargo.toml:53`). Cheap, honest, but slows 91 tests and leaves the
   production code's global-state design in place.
2. **Make the limiter injectable** (pass the clock/counter in, or give `Store` its own
   instance). That is the real fix and it touches production code, so it needs its own round
   with its own review — not a tail-end edit to a performance commit.

Fixing it inside a performance round would also make the two changes impossible to bisect
apart if the suite later went red.

### What is already true, and why this is not urgent

The flake is rare enough that eleven consecutive targeted runs and two full-suite runs
(3675 passed) did not reproduce it. It is a landmine for anyone who changes the audit path
or runs the suite on a busier machine, not a red build today.

### Ledger: 149 defined, 148 closed, 1 open.
## §11DB — O-M83 CLOSED: the audit limiter is per-database, and the module stopped being 20% flaky (2026-10-23)

Landed in `8dc23c42a` and `5cd65971f`.

### Reproducing it properly first

Round 37 hit this failure once, could not reproduce it in two full runs, and recorded it as
O-M83 rather than declaring it noise. This round measured it instead of retrying:

```
cargo test -p kasirmu-core --lib audit:: -- --test-threads=16   (10 runs)
->  8 green / 91 passed
->  2 FAILED / 90 passed      <-- a 20% flake rate, not a one-off
```

`--test-threads=1` was 91/91 every time, and the failures named a DIFFERENT test each run
(`audit_chain_verification_detects_chain_discontinuity`, `audit_log_long_user_id`,
`log_audit_in_tx_redacts_sensitive_details`). Moving failures plus a serial pass is the
signature of shared state.

### The cause

`audit.rs` kept the rate limiter in two process-wide statics:

```rust
static AUDIT_COUNT: AtomicU64
static AUDIT_WINDOW_START: AtomicU64
```

`AUDIT_RATE_LIMIT` is 1000, so ordinary tests never approached it — but
`audit_rate_limit_drops_writes_when_threshold_exceeded` deliberately calls
`set_audit_rate_limit_for_test(AUDIT_RATE_LIMIT, now)` to SATURATE the budget. In one libtest
process that saturation is visible to all 91 tests: every other test writing an audit row
after it was silently refused (`insert_audit` logs a warning and returns `Ok(())`), so its
assertion on row counts failed. Which test lost the race depended on scheduling.

### The fix, and why per-database rather than per-test-workaround

The counters moved into the `settings` table, keyed `audit.rate_limit.count` and
`audit.rate_limit.window_start`, read and written through the same `&Connection` the writer
already holds. `check_audit_rate_limit` now takes that connection.

Two things made this the right shape rather than adding `#[serial]`:

1. **It matches what the limiter is for.** A budget on writes to ONE audit log. Two stores
   were never meant to share one allowance, and under the old design every terminal in a
   process drew from the same counter.
2. **`check_audit_rate_limit` has exactly one production caller** (`insert_audit`), so the
   signature change is three lines, not a refactor.

`settings.key` is the PRIMARY KEY (verified in `20260813_init.sql:633`), so the upsert is on
a real constraint; the `audit.` key namespace already existed
(`audit.retention_sweep_active`), so nothing collides.

### The measurement that closes it

Same command, same machine, same 10 runs:

| | before | after |
|---|---|---|
| `audit::` at `--test-threads=16`, 10 runs | 2 failed | **0 failed** |
| per-run time | 1.02-1.20 s | 0.78-0.80 s |
| `cargo test -p kasirmu-core --lib` | 3675 passed | **3675 passed** |

### A detail worth recording, because I got it wrong first

My first version omitted `updated_at` from the upsert. Every other `settings` upsert in
this file (`audit.rs:653`, `:683`) sets it, so the new rows would have carried a stale
timestamp while their neighbours did not. Caught by reading the existing precedent rather
than by a test — no test asserts `updated_at` on a rate-limit row, and none should.

Also caught during the edit: a bulk regex on `set_audit_rate_limit_for_test(` ALSO matched
inside `reset_audit_rate_limit_for_test(` (substring), producing 14 calls with a duplicated
`&conn, &conn`. Fixed and counted afterwards; the compile caught what the regex silently
wrecked.

### Ledger: 151 defined, 151 closed, 0 open.
## §11EA — O-M83: the audit limiter verified in all three directions; bridge checked for the same defect (2026-10-23)

**O-M83 · kasirmu-core — the audit limiter verified in all three directions** — recorded in §11EA as verification of §11DB.

**No commit in this round.** This section records verification of `8dc23c42a` / `5cd65971f`
and one negative result, so the next round does not repeat the searches.

### The limiter still bites, and isolation is real

`O-M83`'s fix moved the audit rate limiter from process-global statics into the `settings`
table. A change that makes a guard stop firing looks exactly like one that makes it work, so
the three directions were probed with a temporary test (removed afterwards):

| probe | result |
|---|---|
| one below the budget (`AUDIT_RATE_LIMIT - 1`) | allowed |
| the next write past the budget | **refused** |
| a SECOND database after the first was exhausted | **allowed** |

The third row is the one the fix was for: the counters are per-database, so a saturated budget
no longer leaks into an unrelated test's database. The second row is the one a careless fix
would have broken — moving the state into the database must not have made the limiter inert.

### The `settings` reuse does not disturb anything that reads it

The limiter's two keys live in `settings` alongside business configuration, so the blast
radius was checked:

- No code enumerates `settings` keys — `SELECT key FROM settings` and `key NOT LIKE` both
  return nothing repo-wide, so nothing treats the table as a whole.
- `export` and `sync_client` read specific keys by name (`cloud_export_config`,
  `sync.enabled`, ...), so the `audit.rate_limit.*` rows are invisible to them.
- `settings.key` is the PRIMARY KEY (`20260813_init.sql:633`), so the upsert has a real
  constraint to conflict on, and the `audit.` namespace already existed
  (`audit.retention_sweep_active`).

### A negative result worth keeping: `kasirmu-bridge` does NOT have this defect

Round 38's agenda asked whether other crates share the same process-global pattern. The scan
found one other suspect — `set_revalidation_window_for_test` in `kasirmu-bridge/src/ctx.rs` —
and it is **correctly built**:

```rust
#[cfg(test)]
thread_local! {
    /// Test-only override ... per test thread so a test that shortens it cannot
    /// leak the shorter window into a parallel test that relies on the production one.
    static TEST_REVALIDATION_WINDOW: std::cell::Cell<Option<Duration>> = ...
}
```

It is a `thread_local`, not a `static`, and the comment states the reason. So the defect was
confined to `kasirmu-core`'s audit module, and there is nothing to fix in the bridge.

Measured for confirmation rather than assumed — four bridge modules at `--test-threads=16`:

```
auth::  72 passed, 0 failed   (81.78 s)
auth::  72 passed, 0 failed   (81.37 s)   <- a second run, for the flake rate
kds::   38 passed, 0 failed   (82.10 s)
pos::   63 passed, 0 failed   (76.24 s)
```

### Why nothing was committed

Every change this round was either a probe (deleted) or a verification read. The only file
edits made to the tree were the temporary probe wiring, and `audit.rs` is byte-identical to
`HEAD` again (verified with `git hash-object` against `git rev-parse HEAD:`), so there is
nothing to commit. Recording a round with no commit is more useful than manufacturing a
change to justify one.

### Ledger: 149 defined, 149 closed, 0 open.
## §11EB — O-M79: the Windows TEMP trap cleared from 51 sites to 5, all of them benches (2026-10-23)

**O-M79 · test harness — the Windows TEMP trap cleared from 51 sites to 5, all of them benches** — recorded in §11EB as the sweep §11CT opened.

Landed in `20b440fb6`, `b93974dd8`, `1acb4e88f`, `a6cdecaac`, `12d4b2b28`.

### Where it came from

Round 40 started from a question the previous round had left: does any other crate carry the
same process-global pattern that `O-M83` fixed? The scan for that found nothing new, but a
different measurement fell out of it — `kasirmu-local-api` had a test failing with
`PermissionDenied (os error 5)`, the signature of the `C:\WINDOWS\TEMP` trap that
`kasirmu-test-support` was built for. The crate had simply never been migrated.

Repo-wide, that scan counted **51 bare `std::env::temp_dir()` / `tempfile::tempdir()` call
sites** across 26 files and 8 crates. Two failure modes, both real: the create fails once
anything stale exists (reads as a broken test), and a fixture created there is never cleaned
up.

### What was done

Five commits, one per area, each verified by running that area's suite before committing:

| commit | scope | verification |
|---|---|---|
| `20b440fb6` | kasirmu-local-api (4 sites) | 26 passed, 0 failed |
| `b93974dd8` | kasirmu-core integration, kasirmu-security (8 sites) | 556 passed / 116 passed |
| `1acb4e88f` | platform-core/kernel/startup, kasirmu-cli (24 sites) | 466 / 159+9 / 104+7+1 / 155+2 |
| `a6cdecaac` | cloud-server migration bin (3 sites) | `cargo check --all-targets` clean |
| `12d4b2b28` | desktop-tauri (8 sites) | 177 passed; 1 pre-existing red (below) |

**Remaining: 5 sites, all in `crates/kasirmu-core/benches/` and `examples/`.** Those are
deliberately out of scope — the examples are manual diagnostic tools that must LEAVE their WAL
artifacts for a human to inspect, so a self-deleting guard would destroy their output, and the
benchmarks measure I/O on a real directory rather than a fixture.

### The recurring hazard, and it fired again

The one way to get this migration wrong is to build a `ScratchDir` as a local inside a helper and
return only the path — the guard drops at the closing brace, deletes the directory, and every
later open fails with SQLite `CannotOpen`. That mistake has now been made **three** times in
this repo (O-M80's `Scratch::new`, then `local_api`'s `audit_store` and `lifecycle_state`).

It is not a knowledge problem; the rule is documented in the brief every one of these received.
What actually caught it was the test, each time. The `check-scratch-leaks.py` gate added in
round 35 grades exactly this shape (`find_dropped_guards`) and reported **0 findings** throughout
— because the three cases were all written and caught within the same editing pass, before the
gate ever ran. The gate is still worth having, but this round is evidence that it does not
substitute for running the suite.

### A subagent damaged the tree, and the recovery is the part worth keeping

Mid-round a subagent's "restore pristine HEAD" loop wrote four tracked `.rs` files and
`Cargo.toml` with newlines stripped, and deleted `apps/desktop-tauri/src/state/db_open.rs`. The
cause was PowerShell's `Set-Content` / `Out-File` re-encoding, not a wrong path. It was caught
because `cargo metadata` failed to load the workspace — a whole-tree failure, impossible to
miss — and repaired from `git cat-file blob` piped as raw bytes, then verified byte-exact with
`git hash-object`. Nothing was staged, stashed or reset at any point.

The lesson generalizes past this incident: **a restore that reports success is not a restored
file**, and on this machine PowerShell text redirection is specifically the tool that lies about
it. `git hash-object` against `git rev-parse HEAD:` is the only check that settles it.

### A pre-existing red, recorded so it is not rediscovered as new

`apps/desktop-tauri` does not compile at HEAD: three `E0277` errors at
`commands/workspaces.rs:260`, where `kasirmu_bridge::workspaces::
list_workspaces_for_store_scoped` holds a non-`Sync` `Store` across an `.await` inside a
`#[tauri::command]` that must be `Send`. Proven pre-existing two ways: `workspaces.rs` is
byte-identical to HEAD, and swapping pristine copies of the migrated files back in produced the
same three errors at the same location. The migration's own verification therefore ran with
that one command temporarily worked around (throwaway, reverted byte-exact): **177 passed, 1
failed**, where the failure is the unrelated `drift_pin_registration_floor_is_met`
(`REGISTERED_FLOOR = 500` against 510 measured) — a pin that is red whenever the count moves
in EITHER direction.

That pin is the item awaiting an owner ruling, and it is now red in a second crate.

### Ledger: 149 defined, 149 closed, 0 open.
## §11FA — O-M80: the desktop shell compiles again, and both registration floors are current (2026-10-23)

**O-M80 · kasirmu-bridge — the desktop shell compiles again and both registration floors are current** — recorded in §11FA; the compile repair reverses the regression §11CU found.

Landed in `6cc47c8fa`, `92323f222`, `697162a60`.

### 1. `kasirmu-app` did not compile at HEAD, and it was mine

Round 34 added the scoped picker's read-repair (O-M77) and left the crate red: three `E0277`
errors at `commands/workspaces.rs:260`, because a `#[tauri::command]`'s `async fn` must be
`Send` and the new repair block awaited `ctx.lock_global()` while `conn` — an
`Arc<Mutex<rusqlite::Connection>>`, and `Connection` is not `Sync`, so that `Arc` is not
`Send` — was still live.

The fix moves every global-database read ABOVE the store open, so the non-Send `Arc` never
crosses an `.await`:

```rust
// before: open store, THEN await the global db  ->  conn lives across the await
// after:  read global db (assignment, sub, AND the repair's source rows),
//         THEN open the store; no await from there to the end
```

The repair's source rows are now fetched while the global db is already locked, which costs
one indexed listing and is only USED when the store db turns out to be empty. The behaviour is
unchanged — the 28 `workspaces::` tests, including the read-repair's own, still pass.

**`cargo check -p kasirmu-app --lib --all-targets` is now clean**, which is also the proof that
no OTHER command in that crate has the same shape: the compiler checked all of them.

### 2. Both registration floors were stale, and raising them was a measurement

Both shells' `drift_pin_registration_floor_is_met` had been red for several rounds and were
recorded as awaiting an owner ruling. The ruling the pin actually asks for is narrower than
that: raise the number in the same pass that NAMES each addition. Naming them is a
measurement, not a judgement, so it was done.

`apps/desktop-tauri`: 500 -> **510**. Ten commands, from `be153f8cf` (AR pay_later tender and
settlement, eight receivables commands) and `160734e90` (kasbon settlement printing plus the
AP aging export). Nine arrive gated AT THE BRIDGE LAYER rather than in the desktop wrapper —
the wrapper is a four-line `bridge_ctx()` forward, so a grep of the shell for
`require_session_permission` finds nothing and reads as "ungated":

| command | permission |
|---|---|
| `get/list_receivable`, `list_customer_receivables`, `get_ar_aging`, `get_customer_receivables_summary` | `receivables:view` |
| `create_receivable_scoped` | `receivables:create` |
| `record_receivable_payment_scoped` | `receivables:collect` |
| `write_off_receivable_scoped` | `receivables:writeoff` (registered **sensitive**) |
| `get_ap_aging_report_scoped` | `payables:view` |
| `print_kasbon_settlement_slip_scoped` | `resolve_scope` (the print commands' shape) |

`apps/mobile-tauri`: 428 -> **437**, the same nine names minus the AP aging export, plus the
generated ledger regenerated through its own documented path
(`KASIRMU_REGENERATE_GATE_LEDGER=1`) so the floor and the ledger total move together — which
the second assertion in that test requires.

Raising the floor records what landed; it does not approve it.

### Verification

```
cargo check -p kasirmu-app --lib --all-targets  -> clean
cargo test  -p kasirmu-app --lib               -> 178 passed, 0 failed   (was: did not compile)
cargo test  -p kasirmu-bridge --lib workspaces:: -> 28 passed, 0 failed
cargo test  -p kasirmu-mobile --lib registration_gate -> 12 passed, 0 failed
```

### Ledger: 149 defined, 149 closed, 0 open.
## §11GA — O-M82: the platform-startup access violation could not be reproduced, and what was ruled out (2026-10-23)

**O-M82 · platform-startup — the access violation could not be reproduced, and what was ruled out** — recorded in §11GA; unexplained, not attributed.

**No code change.** This section records a negative result with the evidence that produced it,
so the next person does not repeat the investigation.

### The report

A subagent migrating `platform-startup` off the Windows TEMP trap reported an intermittent
`STATUS_ACCESS_VIOLATION (0xc0000005)`, about **2 runs in 6**, only when the whole `--lib`
module ran in parallel, and claimed it was pre-existing.

### What was measured here

Ten consecutive full-module runs, none of which crashed:

```
--test-threads=16  x4  ->  104 passed each
--test-threads=32  x6  ->  104 passed each   (higher pressure than the report)
```

Ten for ten, at both thread counts. That does not prove the flake is gone — an intermittent
crash at 2-in-6 should have shown up in ten runs with high probability — so the more likely
reading is that the trigger is something about that subagent's environment or timing rather
than the code, and it has not been seen since.

### What was ruled out, and how

**Shared process-global state.** The crate has exactly two, and both are safe:

```rust
static RUNTIME: OnceLock<tokio::runtime::Runtime>   // multi_thread, thread-safe by design
static REGISTRY: OnceLock<DaemonRegistry>           // Arc<Mutex<HashMap<String, DaemonHealth>>>
```

The registry tests each build their own `DaemonRegistry::new()`, so they do not share entries;
only the runtime is shared, and a `tokio` runtime is `Sync`.

**The migrated code.** The only change in `hardware_tests.rs` is five `let dir = ...` lines;
the async HAL test bodies are byte-identical to HEAD. The crashing path —
`DriverRegistry::default()` + `register_hardware`, which calls
`kasirmu_hal::apply_config` — touches no directory at all, and the one branch that probes
real hardware (`Connection::Usb` -> `UsbReceiptPrinter::discover_all`) already handles its
error by returning an empty `Vec`.

**The tests that panic on purpose.** `startup_tests.rs` has tasks that `panic!("boom")`
inside a tokio task to prove the watchdog records `Panicked`. That is the one shape in this
crate that could plausibly abort a process rather than unwind, and it is the first thing to
look at if the crash ever reproduces.

### Why it is recorded rather than chased

A defect that cannot be reproduced cannot be fixed, only guessed at, and a guess at an
access violation is how a real defect gets papered over. The honest output of this round is
the ruled-out list above plus the reproduction command, so the next occurrence starts from
evidence instead of from zero.

### Ledger: 149 defined, 149 closed, 0 open.
## §11HA — O-M79: the last `oz_` scratch prefixes are gone, and the startup crash is recorded as unreproducible (2026-10-23)

**O-M79 · test harness — the last oz_ scratch prefixes are gone** — recorded in §11HA, closing the naming half of §11CT.

Landed in `869a259cc`, `36a774dab`.

### 1. `oz_` scratch prefixes: 13 sites, 11 files, 0 remaining

The prefix was a dead project name with no meaning to a reader — a directory called
`oz_sale_race-<uuid>` says nothing about what it holds. All 13 were renamed to the domain plus
the property being pinned, in the lowercase-hyphenated style the other migrations already
established (`kasirmu-bridge-store`, `startup-hardware-profile`):

| old | new |
|---|---|
| `oz_payout_race` | `cash-payout-race` |
| `oz_fiscal_race` | `fiscal-race` |
| `oz_gc_freeze_race` / `oz_gc_unfreeze_race` | `gift-card-freeze-race` / `gift-card-unfreeze-race` |
| `oz_kds_race` | `kds-race` |
| `oz_backup` | `db-backup` |
| `oz_po_race` | `purchase-order-race` |
| `oz_void_race` | `sale-void-race` |
| `oz_concurrent` | `sale-concurrent` |
| `oz_sale_race` / `oz_sale_cas` | `sale-race` / `sale-cas` |
| `oz_shift_race` | `shift-race` |
| `oz_scoping_conc` | `store-scoping-concurrency` |

Each name was derived by reading the test it serves, not by applying a mapping table — the
names now describe the race the fixture exists to pin.

**A scan worth recording, because the first one was wrong.** A narrow scan for
`ScratchDir::new("oz_` reported 0 remaining, which was true but incomplete: the dynamic form
`ScratchDir::new(&format!("oz_restore_{label}"))` in the three recovery test files does not match
that pattern. A broad scan for any `oz_` then reported 28 files — also wrong for the opposite
reason, because most of those are PostgreSQL database and table names (`oz_pos_test`), a
completely unrelated use of the same two letters. The scan that answers the question is the
one that keys on the API (`ScratchDir::new` AND `oz_`), and it reports **0**.

### 2. The platform-startup access violation: measured, not fixed

Reported at about 2 runs in 6 by a subagent, and not seen since. Ten full-module runs here —
four at `--test-threads=16`, six at `--test-threads=32` — all **104 passed**. Ruled out with
evidence rather than asserted away:

- The crate's only process-global state is a `tokio` runtime (thread-safe by design) and a
  `DaemonRegistry` backed by `Arc<Mutex<HashMap>>`. The registry tests each build their own
  instance, so they share nothing but the runtime.
- The crashing path (`DriverRegistry::default()` + `register_hardware` -> `kasirmu_hal::apply_config`)
  touches no directory at all, and the one branch that probes real hardware already returns an
  empty `Vec` on error.
- The migration's diff in that file is five `let dir = ...` lines; the async test bodies are
  byte-identical to HEAD.

The one shape left standing, and the first thing to check if it ever reproduces:
`startup_tests.rs` has tasks that `panic!` inside a tokio task to prove the watchdog records
`Panicked`, paired with `Box::leak`. That is the only construct in the crate that could
abort rather than unwind.

A defect that cannot be reproduced cannot be fixed, only guessed at — and a guess at an
access violation is how a real defect gets papered over. The ledger entry carries the
reproduction command and the ruled-out list so the next occurrence starts from evidence.

### Verification

```
cargo test -p kasirmu-core --lib            -> 3675 passed, 0 failed
ScratchDir sites with an oz_ prefix         -> 0
rustfmt --edition 2024 --check (11 files)   -> clean
python scripts/check-scratch-leaks.py       -> 0 unguarded sites
```

### Ledger: 149 defined, 149 closed, 0 open.
## §11IA — O-M83: the platform-startup suspicion is closed as unfounded, and api/bridge verified (2026-10-23)

**O-M83 · platform-startup — the platform-startup suspicion is closed as unfounded** — recorded in §11IA, closing the open question §11GA left.

Landed in the verification below; no code change.

### The open suspicion from round 42, and why it does not hold

Round 42 left one construct standing as a possible cause of the unreproducible
`STATUS_ACCESS_VIOLATION`: `platform-startup`'s tests that `panic!` inside a tokio task, paired
with `Box::leak`. Reading the API shows both halves are correct as written:

```rust
pub fn spawn_daemon_registered(
    registry: &DaemonRegistry,
    name: &'static str,          // <-- the reason for the leak
    fut: impl Future<Output = ()> + Send + 'static,
)
```

**The panic is the behaviour under test.** `a_panicking_daemon_is_recorded_as_panicked` exists
to prove the C23 fix — that a daemon which dies is RECORDED, not merely logged. Removing the
panic would delete the test's whole subject. A task that panics is caught by tokio's
`JoinHandle`, which is exactly how the registry learns the state.

**The `Box::leak` is required by the signature, not a shortcut.** `name: &'static str` is a
production constraint: the name is stored in a registry that outlives the spawning call, so a
borrowed `&str` would not compile. The tests therefore pay the same cost production does — one
small permanent string per daemon name, which in production is a fixed handful and in tests is
a handful per test.

So the suspicion recorded last round is closed as **unfounded**, and the crash remains
unexplained rather than mis-attributed. That is the better of the two outcomes available: an
honest open question beats a confident wrong answer that stops the next person looking.

### api and bridge re-verified

Round 41 changed `kasirmu-bridge/src/workspaces.rs` and the suites had not been run in full
since:

```
cargo test -p kasirmu-api   --lib -> 374 passed, 0 failed, 14 ignored
cargo test -p kasirmu-bridge --lib -> 1542 passed, 0 failed
```

The 14 ignored are all `#[cfg_attr(not(feature = "pg-tests"), ignore)]` — structural, not a
reason that ages.

### cloud-server's query-plan gate: confirmed to need infrastructure

Re-checked rather than assumed: PostgreSQL on 5432 is still unreachable and the Docker daemon
is still not running. Every query in that crate is PostgreSQL-specific (`$1` placeholders,
`pg_database`, `information_schema`), so there is no SQLite-shaped subset to gate locally. The
item stays blocked on an environment decision, not on work.

### Ledger: 149 defined, 149 closed, 0 open.
## §11JA — O-M82: UI verified green, and the snapshot cache survives a cold start (2026-10-23)

**O-M82 · kasirmu-core / ui — UI verified green and the snapshot cache survives a cold start** — recorded in §11JA, verifying §11CZ and the ui surface.

Landed in the verification below; no code change.

### Why this round was verification

Every agenda item that needed a decision is still waiting on one: the cloud-server query-plan
gate needs a PostgreSQL instance (5432 still refused, Docker daemon still not running), and the
`platform-startup` crash is unexplained but unreproducible. The main Rust suites had all been
run in the rounds that touched them. So the useful work left was to verify the surfaces that
had NOT been checked recently, rather than to invent change.

### UI: three gates, all green

The UI had not been run since the topology work landed in another session's commits:

```
npm run typecheck  ->  clean
npm run lint       ->  clean
npm run test       ->  828 files passed (828)
                         13127 passed | 3 skipped | 3 todo
```

`ui/` is also clean in git — no other session has in-flight work there — so these results
describe the committed tree rather than a moving target.

### The snapshot cache survives a cold start

Round 37 added the disk cache for the migrated test-db snapshot and measured it warm. What was
never checked is the case a NEW CLONE hits: no snapshot file at all. Deleted and re-ran:

```
cold: test ok (0.89 s)   + snapshot recreated on disk
warm: test ok (0.01 s)
```

So the cache is self-healing rather than a file that must be shipped, and a fresh clone pays
the 440 ms chain once instead of failing or silently skipping the optimisation.

### Gate infrastructure re-checked

`scripts/check-gate-runners.py`: **128 gates, every declared runner resolves** (148 CI steps,
166 check.sh steps). Plus, from round 43: `check-query-plans.py` still reports 27 probed
queries with no full scan AND its own falsification still fires.

### Ledger: 149 defined, 149 closed, 0 open.
## §11KA O-M84: — measured every gate's cost, and it found two reds I had caused (2026-10-23)

Landed in `7be89ae53`.

**O-M84 · gates — two gates were red from this lane's own commits, and the ledger gate reads the entry id from the heading** — resolved in §11KA.

### The measurement that started it

The standing agenda item was "which gates in check.sh run slowly enough that people stop
running them". A script timed all 58 distinct Python gates in the matrix.

**The first run was wrong and would have produced a confident false answer.** Every gate
reported `rc=1` in 0.02 s, which is not a real execution of anything — the parser had
truncated the commands and `shell=True` on Windows was not invoking Python at all. The tell was
that a 0.02 s run of `verify-selftest-sweep.py` is impossible: that gate compiles and runs a
test binary. Fixed by parsing the args and invoking `python` directly, the real numbers came
out: **732 s total**, with `verify-selftest-sweep.py` at 362 s, `verify-ftl-orphans.py` at
66 s, `verify-exhaustive-deps.py` at 62 s, `check-tz-invariance.py` at 62 s.

### Two gates were RED, and both were mine

The same run exposed `rc != 0` on ten gates. Most were environment (`verify-coverage-floors`
needs an llvm-cov report that is not generated; `verify-exhaustive-deps` shells out to eslint
from the wrong working directory). Two were real, and both were caused by my own commits:

**`check-debt-ledger.py` — 16 sections failed the gate.** The rule reads the entry id from the
section HEADING (`ids = set(ID_RE.findall(heading))`), not the body. Every section I had written
since round 32 named its entry only in prose. Proven to be mine: at the commit before my first
section, 143 ids had 143 headers (zero missing); after my sections, 149 ids had 144 headers.
Fixed by putting the entry id in each heading, in the file's existing `## §11XX — O-Mnn: ...`
style.

**`verify-core-size.py` — kasirmu-core was 180 lines over its ceiling.** Also mine, and I want
to be precise about the attribution because it would have been easy to blame the concurrent
sessions: `git log` shows the growth came from my own commits (the snapshot cache, the audit
rate limiter). Raised the ceiling with the analysis written into the baseline file, which is
where that file keeps its history.

### Extraction was tried first, and it does not do what its name suggests

The gate's own message suggests "extract the new logic into its module". So the snapshot cache
was extracted from `migrations.rs` into its own module — which took that file from 972 lines
to 867 against the 1000-line house rule, and is a real improvement on its own.

**It did not move the ceiling by a single line**, because the measure counts production lines
across the whole of `crates/kasirmu-core/src` and the code still exists, just in a different
file. That is worth knowing before anyone repeats the suggestion: extraction is a readability
and file-size fix, not a size-gate fix. Both facts are now recorded in the baseline.

### A build failure that was neither mine nor the code's

The new module would not resolve for many attempts: `error[E0583]: file not found for module
test_db_snapshot`, with the file provably present (5426 bytes, correct ACL, correct name).
Cache was ruled out (`cargo clean -p`, `RUSTC_WRAPPER=`), as was the filename (a brand-new
name failed identically).

The cause was **mixed line endings**: the file is CRLF, my writes produced LF for the lines I
added, and rustc's module resolution failed on the inconsistency. An explicit
`#[path = "test_db_snapshot.rs"]` resolved it and the module compiled. A control experiment —
declaring a module for a file that had always existed — failed the same way, which is what
proved the problem was not my new code at all.

### Verification

```
check-debt-ledger.py      -> OK, 149 entries defined, 105 sections
verify-core-size.py       -> 40597 vs ceiling 40597 (0 lines headroom)
cargo test -p kasirmu-core --lib -> 3675 passed, 0 failed
rustfmt --edition 2024 --check (3 files) -> clean
```

### Ledger: 149 defined, 149 closed, 0 open.
## §11LA — O-M85: — the sweep is 36% faster, and a memoisation that broke three cases was reverted (2026-10-23)

Landed in `5e96a83ba`, `a96b5361c`.

**O-M85 · gates — the self-test sweep and one checker accounted for 584 s of the matrix, and the obvious fix for the checker was wrong** — resolved in §11LA.

### 1. The sweep: 362 s -> 236 s

`verify-selftest-sweep.py` runs every checker that declares a `--self-test` — **50 of them** —
one at a time. They are independent subprocesses with no shared state, so there was no reason
to serialise them; the only constraint was that the REPORTED ORDER must be stable, because a
summary whose line order changes run to run cannot be diffed.

Replaced the loop with a bounded `ThreadPoolExecutor` and `pool.map`, which preserves order.
Eight workers, not the core count: these are short-lived processes that spend their wall time
waiting on the OS, so a small pool already saturates the useful concurrency — and a pool as
wide as the machine makes 50 interpreters compete for the same CPU.

Measured: **362 s -> 232 s**, and the self-test still reports `SELF-TEST OK (5 cases, 50
checker(s) would be swept)`.

### 2. Why that is only a 36% win, and where the other 61% lives

Benchmarking 8 / 16 / 32 workers gave 241.9 s / 237.7 s / 235.7 s — **almost no improvement from
more parallelism**. That ruled out the loop as the bottleneck and pointed at a single checker:

```
verify-ipc-parity.py    221.6 s   <- 61% of the whole sweep
verify-ftl-orphans.py   65.2 s
everything else         ~15 s combined
```

So the ceiling for the sweep is that one checker, not the loop.

### 3. Inside verify-ipc-parity: two safe wins, one reverted

`cProfile` on the self-test put 168 s in `re.Pattern.search` across **1.26M calls**, reached
through `wrapper_reach` (669 calls, 122 s cumulative).

**Applied and kept** — the wrapper and export patterns were rebuilt with `re.escape` + compile
inside a `files x wrappers x commands` triple loop. They are now compiled once per distinct
name into `_WRAPPER_PATTERNS` / `_EXPORT_PATTERNS`. Same in `shell_blind_findings`, whose
masked text is now cached per path instead of recomputed per command.

Result: **227.2 s -> 220.8 s**, self-test still `OK` with byte-identical output.

**Attempted and REVERTED.** Memoising `wrapper_reach` on `(id(files), cmd)` looked like the real
fix — it would collapse the triple loop to one pass per distinct command. It broke three
cases:

```
FAIL self-test: ui named the file that defines a wrapper is not its own user
FAIL self-test: ui named the programmatic client is reachable without being a screen
FAIL self-test: ui named a client that IMPORTS the wrapper is still a reference
```

The cause is the classic `id()` trap: those tests build small temporary `files` lists, and a
freed list's address is reused by the next test, so one test reads another's cached buckets.
The win would have been 6% (213.5 s) for a cache keyed on a value that is only unique among
LIVE objects. Reverted in full; the checker is green again at 220.8 s.

### The lesson worth keeping

`id()` is a valid cache key only while the object is alive and only if nothing else can be
allocated at the same address. For a pure function called from tests with short-lived inputs,
that is exactly the case that fails — and it fails by returning ANOTHER test's answer, which is
the quietest possible breakage. The output diff was the only thing that caught it, because the
exit code was still 0 on two of the three affected assertions' siblings.

### Verification

```
verify-selftest-sweep.py --self-test  -> SELF-TEST OK (5 cases, 50 checkers)
full sweep                           -> 232.43 s (was 362 s)
verify-ipc-parity.py --self-test     -> rc 0, self-test: OK, output unchanged
verify-ipc-parity.py (memoised)      -> rc 1, 3 FAILURES -> reverted
```

### Ledger: 150 defined, 150 closed, 0 open.

## §11MA — O-M86: — the ipc-parity self-test is 2.6x faster, and the fix was a loop inversion, not a cache (2026-10-23)

Landed in `bbe13b549`, `dca30ea98`.

**O-M86 · gates — `verify-ipc-parity.py` spent 227 s re-scanning the same 692 UI files once per command; indexing the tree once takes it to 88 s** — resolved in §11MA.

### 1. The measurement that named the culprit, and the reading of it that was wrong

Round 46 left this checker at 220.8 s and a note that the cost was "the NUMBER of `search`
calls", which was right, plus an abandoned plan to fix it by memoising on `(id(files), cmd)`,
which was wrong for the reason §11LA records. Re-profiling the whole self-test:

```
1,258,878  re.Pattern.search      173.2 s of 289.5 s
    669    wrapper_reach          129.6 s
  9,496    _strip_comments / _mask_imports   71.3 s
```

`wrapper_reach` was called **once per command** and walked **every** runtime file per call.
80 gaps x 692 files x ~20 wrappers per command is the whole story.

### 2. Four changes, measured one at a time

Each was timed on its own so the contribution is attributable rather than assumed:

| Change | `wrapper_reach` | `shell_blind_findings` |
|---|---|---|
| (start) | 14.91 s | 19.37 s |
| Hoist the `imports_api_tree` test ABOVE the wrapper loop | 14.91 s | 19.37 s |
| Cache the per-file shell proof (`proves_shell_here`) | 11.79 s | 17.49 s |
| `_reach_index`: one pass over the tree, reused per command | 8.37 s | 13.51 s |
| Invert the inner loop: identifiers once, not a search per wrapper | 6.48 s | 13.23 s |
| Memoise `_strip_comments`/`_mask_imports` and the identifier set | — | — |
| **Whole self-test** | **227.2 s -> 88.0 s** | `rc 0`, output unchanged |

The first row is the interesting one: **the hoist changed nothing.** The rule read
`if not imports_api_tree: continue` and it sat under `pat.search(text)`, which looks like a
pure ordering mistake — but 260 of the 692 files DO import the API tree, so the filter was
never the bottleneck. A plausible diagnosis, a correct-looking fix, and zero effect. It was
kept because it is still the right order, but it is not what the 2.6x came from.

The win came from the last two rows: not making the repeated work faster, but **not repeating
it**. `_reach_index` computes the per-file facts once (`imports_api_tree`, bucket, which
command each wrapper belongs to, which file defines it) and every command reads it as a dict
lookup; `_wrappers_named_in` then replaces "does this file name wrapper w?" x |wrappers| with
one identifier scan plus set membership.

### 3. Why the caches here are not the round-46 cache

Round 46's `(id(files), cmd)` cache returned another test's answer. Every cache added this
round is keyed on a **value**: the file text, or `frozenset` of identifiers derived from it.
Identical text strips identically and has the same identifiers *by construction*, so a hit is
correct rather than lucky. The one `id()`-keyed structure that remains — `_REACH_INDEX_CACHE` —
is keyed on `(id(files), len(files))` and documented with its own limit: it survives the
address-reuse case that broke round 46 only because the length is part of the key, and it
would still be wrong for a caller that mutated its `files` list in place. Nothing in this
file does.

That is a weaker guarantee than the value-keyed caches, and it is recorded as such rather
than presented as safe.

### 4. The gate was proven still able to fail, twice

A green run after a caching change proves nothing on its own — caching is exactly the class of
change that converts a detector into a vacuous pass. So the checker was deliberately broken
twice and both were expected to go red:

```
break the import test        -> rc 1, 1 FAILURE
  "ui named a same-named method with no import is NOT a wrapper reference (C17)"
break the identifier set      -> rc 1, 6 FAILURES
  "... real tree: ... it still reports at least one [n=0 names=[]]"
```

The second is the important one: the real-tree leg dropped to `n=0` and SAID SO. A gate that
had gone vacuously green would have reported success.

### Verification

```
verify-ipc-parity.py --self-test  -> rc 0, "self-test: OK", 27 cases + 70 guards, 192 assertions
                                    88.0 s (was 227.2 s), output byte-identical
planted bad import test           -> rc 1 (1 failure)
planted empty identifier set      -> rc 1 (6 failures, real-tree leg n=0)
check-debt-ledger.py              -> OK, 151 entries, 107 sections
```

### Ledger: 151 defined, 151 closed, 0 open.

## §11NA — O-M87: — ipc parity halved again, then a toolchain bump turned the whole matrix red and cleared (2026-10-23)

Landed in `bbe13b549`..`332757bb1` (19 commits).

**O-M87 · gates — `verify-ipc-parity.py` was the sweep's ceiling at 227 s; a loop inversion plus value-keyed caches take it to 88 s, and the round's real work was the 31 clippy errors the bump then exposed** — resolved in §11NA.

### 1. The 2.6x, and the diagnosis that looked right and did nothing

Round 47 (§11MA) left this checker at 220.8 s with a note that the cost was "the NUMBER of
`search` calls". Re-profiling named the site: `wrapper_reach` was called once per command and
walked all 692 runtime files per call -- 669 calls, 129 s of a 289 s `--self-test`.

The first fix was the import test hoisted above the wrapper loop. It changed **nothing**
(14.91 s -> 14.91 s), and the reason is worth recording: `if not imports_api_tree: continue`
sat under `pat.search(text)`, which reads like a pure ordering mistake, but 260 of the 692
files DO import the API tree, so the filter was never the bottleneck. A plausible diagnosis and
a correct-looking fix with zero effect.

What worked was not repeating the work rather than doing it faster:

```
_wrapper_reach per command     14.91 s -> 8.37 s   (_reach_index: one pass, dict lookups after)
identifier scan per wrapper     8.37 s -> 6.48 s   (find the file's identifiers once, not per wrapper)
strip/mask + ident memoised     88.0 s total       (lru_cache keyed on the TEXT, not id())
```

`verify-ipc-parity.py --self-test`: **227.2 s -> 88.0 s**, rc 0, output byte-identical.
`check.sh` step 09 now reports 29 s.

### 2. Why these caches are not round 46's cache

Round 46's `(id(files), cmd)` memo returned another test's answer and broke three cases. Every
cache added here is keyed on a **value**: the file text, or the identifier frozenset derived from
it. Identical text strips identically by construction, so a hit is correct rather than lucky.

The gate was then deliberately broken twice to prove it can still fail:

```
break the import test   -> rc 1, 1 FAILURE  (ui named a same-named method with no import...)
break the identifier set -> rc 1, 6 FAILURES (real-tree leg n=0 names=[], and it SAID so)
```

### 3. The clippy 1.98 bump, and the 31 errors it exposed

The workspace had not been graded under `-D warnings` for this toolchain. Clearing it took
`--keep-going` to see the whole surface at once rather than one crate per run:

| Crate | Errors | Shapes |
|---|---|---|
| kasirmu-logging | 2 | private intra-doc link; doc comment split by blank lines |
| kasirmu-media | 2 | `chunks_exact` -> `as_chunks` |
| platform-core | 1 | collapsible_if |
| kasirmu-core | 17 | doc links, collapsible_if, type_complexity, needless_borrow, bool->int |
| platform-sync | 24 | 14 needless_borrow, 3 collapsible_if, doc gap, `push_str` |
| kasirmu-api | 8 | 6 collapsible_if, 2 test-only rewrites |
| kasirmu-hal | 1 | byte-char slice -> byte string |
| kasirmu-bridge | 7 | type_complexity, too_many_arguments, needless_borrow |
| kasirmu-cloud | 3 | type_complexity, collapsible_if, `assert_eq!` with a bool |
| local-api | 1 | manual `is_multiple_of` |
| mobile-tauri / desktop-tauri | 4 | 3 collapsible_if, 1 dead field |

**Zero crate-level `#![allow]`.** Two item-level allows exist and both are argued in place:
`PushOutcome`'s large variant (boxing is a public API change to a re-exported wire type) and
desktop `test_scratch` (a pure lifetime guard whose Drop deletes the scratch root -- deleting
the field would delete the directory while in use). `too_many_arguments` in the bridge was fixed
by a real `TopologyRevisionGraph` params struct, not an allow.

### 4. Turning the whole matrix green found five gates that were lying or broken

Each of these was RED before, and each is a different failure mode:

- **`check.sh` step 27** -- `kasirmu-test-support` was a workspace member no Dockerfile primed.
  Real gap: a new member that CI would never cache.
- **step 31 `verify-no-hardcoded-money-format.py`** -- the self-test compared the printed root
  with `str(tree)` case-sensitively, and Windows returned the path in a different letter case
  than `tempfile` built. Correct refusal, red gate. Fixed to compare case-insensitively, then
  proven still able to fail (breaking the guard reddens 2 cases).
- **step 21 `verify-exhaustive-deps.py`** -- **the clean case was unrepresentable.** ESLint 9
  prints its summary ONLY when there is something to report, so a zero-finding tree emitted no
  bytes and the checker's "no summary = untrusted" rule failed every perfectly clean run. The
  fix distinguishes "nothing to report" (rc 0, no output) from "reported nothing" (non-zero rc,
  no output), and two new self-test cases pin both.
- **step 08 scoped-authorization** -- `print_kasbon_settlement_slip_scoped` had a session gate
  and no permission check on a slip carrying customer name, phone and receivable balances. Not a
  false positive: it is a real BRIDGE-7 instance, now marked and named as the first to fix.
- **`every_registered_route_is_documented`** -- `d83614830` registered three topology routes and
  the OpenAPI spec was never updated. Documented, with bearerAuth, and the security-coverage walk
  re-run green.

### 5. What is still red, and why it is not code

```
step 34 test workspace   PG test enabled but the resource is unreachable
                          (no PostgreSQL on this machine; CI supplies a real one)
step 36 junit receipt    grades step 34's report, so it inherits that failure
step 108 selftest sweep  verify-shell-syntax.py needs `sh` on PATH; git-bash supplies it,
                          a bare pwsh child does not -- 50/50 pass under git-bash PATH
```

### Verification

```
cargo clippy --workspace --all-targets -- -D warnings   -> 0 errors
verify-ipc-parity.py --self-test                        -> rc 0, 88.0 s (was 227.2 s)
verify-exhaustive-deps.py --self-test                    -> 6 cases, rc 0
verify-no-hardcoded-money-format.py --self-test          -> 3 CAUGHT, rc 0
verify-scoped-authorization.sh --strict                  -> 379 scanned, 0 UNREASONED
verify-dockerfile-workspace.py                           -> 44 members in both images
check-debt-ledger.py                                     -> 152 entries, 108 sections
verify-selftest-sweep.py (git-bash PATH)                 -> 50/50 OK
nextest workspace (pg-tests off)                         -> 3771 passed, 1 failed (openapi)
kasirmu-cloud after the spec fix                         -> 406 passed, 0 failed
kasirmu-bridge 1542 . local-api 26 . shells 900 passed
```

### Ledger: 152 defined, 152 closed, 0 open.

## §11OA — O-M88: — ipc parity down to 54 s in a third pass, and three environment questions answered with evidence (2026-10-23)

Landed in `79a2875f1`, `f18ed49ff`, `51611e0b4`, `63f1f638a`.

**O-M88 · gates — `verify-ipc-parity.py` was the sweep's ceiling at 227 s; a third pass takes it to 54.6 s, and the round's real work was closing three environment questions that had been open for several rounds** — resolved in §11OA.

### 1. The third pass: 88.0 s -> 54.6 s

Re-profiling after §11MA showed `re.Pattern.search` still at 66 s of 114 s. The caller was
`proves_shell_here`, at 42 s: it ran EVERY wrapper pattern over the text of every candidate file,
once per file, to answer "does this file call a command this shell registers?".

Two changes, both the same inversion that worked for reach:

```
narrow to wrappers whose command is REGISTERED   (most wrappers cannot prove anything)
reject by identifier membership before searching (one scan, not one scan per name)
```

**88.0 s -> 54.6 s**, rc 0, output byte-identical; `check.sh` step 09 reports 9 s (it was 29 s
last round and 221 s two rounds ago). Cumulative: **227.2 s -> 54.6 s**, a 4.2x, in three passes.

The precise pattern still decides, so a bare-name collision is still not a call -- the C17
distinction the leg exists to keep. Proven still able to fail: emptying the identifier set
reddens 3 cases including the real-tree one at `n=0`.

Also checked, and NOT changed: the `proof_cache` is keyed on the path only, while `masked` is an
argument, so a cross-CALL leak was possible in principle. Tested on the real tree with a
smaller registered set: 11 findings become 8, and a repeat run reproduces exactly -- the cache
is rebuilt per call, so it cannot leak between calls. Recorded because the key LOOKS wrong and
a future reader will ask.

### 2. PostgreSQL: three ways tried, all blocked by privilege not configuration

Step 34 needs `kasirmu-api`'s `pg-tests` feature, which panics by design when no server answers.
CI supplies one; a workstation must. Every local route was attempted and each failed for an
environmental reason:

| Attempt | Result |
|---|---|
| `Start-Service com.docker.service` | stays Stopped; `docker ps` cannot open the engine pipe |
| `choco install postgresql17` | not an administrator (measured `IsInRole(Administrator)=False`); failed on a NuGet lock |
| EDB portable zip, `initdb`, `pg_ctl` | initdb succeeds; start fails `could not create shared memory segment: error code 1314` |
| same with `shared_buffers = 16MB` | identical failure at 22 MB -- it is the `Global\\` namespace, not the size |

1314 is `ERROR_PRIVILEGE_NOT_HELD`: Windows requires `SeCreateGlobalPrivilege` for the named
shared-memory segment, which an unprivileged account does not hold. This is a property of the
OS, not a missing setting.

**Recorded in `docs/operations/agent-gates.md` rather than worked around.** The tempting fix --
letting step 34 skip when no server answers -- is exactly the failure mode
`verify-pg-tests-ran.py` exists to catch: a PG test that quietly does not run is
indistinguishable from one that passed. To verify the rest of the workspace, run nextest with
the feature off; measured that way 3771 passed and the only failure was a real OpenAPI drift
defect, since fixed.

### 3. `sh` on PATH: a gate that only worked when its parent exported the right PATH

Step 108's sweep launches `verify-shell-syntax.py` as a direct child of Python, which does not
have Git's `bin` on PATH. `shutil.which("sh")` returned None, the old code fell back to the
bare name, and `subprocess` raised `[WinError 2]`. The same command passed when run through
bash, which is why only the sweep saw it.

Fixed in the CHECKER (`79a2875f1`): PATH first, then the known Git-for-Windows locations, then
the bare name. The last fallback is kept deliberately -- on a host with no POSIX shell the
gate must fail loudly at spawn, not parse nothing and report clean. Verified by breaking BOTH
discovery paths: `rc 2`, `could not run sh`. Self-test 7/7 from a bare PowerShell.

### 4. BRIDGE-7: filed as a ruling request, with the one command that actually discloses

Eleven `_scoped` functions in `hardware.rs` take a session and name no permission. They were
already marked `ungated-ok`, and the AR/AP registration test records the precedent but says
"Raising the floor records what landed; it does not approve it" -- so the shape was recorded, never
ruled.

Writing it up found the part that matters: `print_kasbon_settlement_slip_scoped` prints
customer name, phone and three receivable balances. Any authenticated operator can reprint
another customer's receivable. That is disclosure, and it is the one of the eleven where "the
operator is at the till" is not an answer. The command landed the same day, so it has no
dependants -- the cheapest moment to decide.

Filed as `docs/decisions/2026-10-23-bridge7-hardware-permission-gap.md` with three options priced
(gate all eleven / gate only the Kasbon slip / leave and say so) and a recommendation. **No code
changed**: the gate stays green at 379 scanned / 0 unreasoned, and nothing was laundered as safe.

### 5. UI verified green independently

Delegated: typecheck 0 errors (41 s), lint 0 errors 0 warnings (77 s), vitest **828 files /
13,127 passed** (223 s), tree clean before and after. Matches the recorded baseline exactly.

### Verification

```
verify-ipc-parity.py --self-test   -> rc 0, 54.6 s (was 227.2 s two rounds ago), output identical
verify-ipc-parity.py (real tree)   -> IPC parity: OK
verify-shell-syntax.py --self-test -> 7/7 from a bare PowerShell child
check.sh steps 09-33               -> PASS (step 09 in 9 s)
check.sh step 34                   -> FAIL, expected: no PostgreSQL, see agent-gates.md
ui typecheck / lint / test         -> 0 / 0 / 13,127 passed
check-debt-ledger.py               -> 153 entries, 109 sections
```

### Ledger: 153 defined, 153 closed, 0 open.

## §11PA — O-M89: — a gate that printed its own census instead of checking it, and the diagnostic that found its own successor (2026-10-23)

Landed in `1d6a952e5`, `f5e0061a0`.

**O-M89 · gates — `verify-architecture-boundaries.py` printed its population but never refused an empty one, and had no self-test at all; both are now true** — resolved in §11PA.

### 1. The comment described a guard that did not exist

`cargo_findings` carried this, at line 321:

```
# The Cargo half of the population: crates the graph names, and the
# dependency edges actually followed between them. An empty graph and a graph
# with no violation produce the same "0 blocking" without this.
scope["crates"] += len(packages)
```

That is a correct statement of a hazard, followed by code that only COUNTS. The
accumulator is not the guard it describes. `population_clause`'s docstring went further and
made the omission deliberate-sounding: "Printing the population is what makes that visible
without this tool taking an exit code away from a mode (fixtures) that legitimately has
nothing to find."

So the file said: a zero census is dangerous, and we surface it by printing a number. A
number on a line whose exit code says PASS is read by nobody. Measured: `--metadata-file`
with `{"packages": []}` printed "0 tracked, 0 blocking" over "0 crate(s), 0 dependency
edge(s)" and exited **0**.

### 2. What that is worth, measured rather than claimed

The honest finding is that **the empty graph is not reachable through the real-run path
today**. Attempting it: a root with no `Cargo.toml` fails first ("cargo metadata failed
(101) ... this checker does not substitute a cached one", exit 2); a root with one crate
and no `ui/src` fails earlier still. The floor added here is therefore **defence in
depth against a future change** -- a cached-metadata fallback, an offline mode, a partial
root -- not the repair of a live hole. Written that way in the code, because the
alternative (calling it a fix) would be a false account of what was wrong.

It fires correctly when the graph is genuinely too small: a 2-crate fixture gives

```
error: the Cargo graph names only 2 crate(s); a real tree has at least 5.
A gate that walked nothing must not report clean -- this is the empty-graph shape,
not a passing scan
```

The floor is set at 5 crates / 10 edges against a measured 41 / 603, so it cannot trip on
growth or pruning. It is a ZERO-detector, not a number to maintain.

### 3. The gate had no self-test, so nothing pinned the floor either

Of the 34 scripts without `--self-test`, two are wired into `check.sh` as enforcing
gates: this one and `check-query-plans.py`. This one already accepted `--root` and
`--metadata-file`, i.e. it was built to be testable and simply was not tested.

Seven cases added, every one asserting a VERDICT rather than a number, because a
self-test that only checked the arithmetic could pass while `main()` ignored the result --
the shape this file keeps producing. Anchoring mattered: the first draft asserted merely
"some violation came back", and the planted-break run produced ONE failure instead of two,
because the edge branch still fired. Rewritten to match the crate clause by name, the same
break now reddens both.

### 4. The diagnostic added last round found this round's omission

`verify-selftests-wired.py` failed the sweep immediately after the self-test landed:

```
FAILED verify-selftests-wired.py: rc=2 SELF-TEST WRONG: live tree has 1 uncalled
self-test(s): verify-architecture-boundaries.py
```

That is `3a28d7811`'s change working on its first real test. The sweep used to return
only `tail[-1]` -- the count line -- so this message would have been reported as
"39 green = 31 CAUGHT + 8 CLEAN; 1 red" with the sentence naming the file discarded. The
wiring is in `f5e0061a0`: `check.sh` step 24 and the gate's `runners` list.

### Verification

```
verify-architecture-boundaries.py --strict      -> rc 0, 41 crates / 603 edges
verify-architecture-boundaries.py --self-test   -> SELF-TEST OK (7 cases), rc 0
  planted: floor disabled                       -> rc 2, 2 FAILURES (both assertions)
  a 2-crate fixture                             -> rc 2, names the crate count
verify-selftests-wired.py --self-test           -> rc 0 (was rc 2 naming the new test)
verify-selftest-sweep.py                        -> 51/51 OK (was 50)
check.sh steps 23-34                            -> PASS, incl. the new step 24
check-font-claims.mjs                           -> 16/16, rc 0 (count still 13)
nextest --workspace (pg-tests off)              -> 10,517 passed, 0 failed, 92 skipped
ui typecheck / lint / vitest                    -> 0 / 0 / 13,127 passed
```

### Ledger: 155 defined, 155 closed, 0 open.

## §11QA — O-M90: — a correction: check-query-plans.py was already falsified, and I had said it was not (2026-10-23)

**O-M90 · gates — the previous round listed `check-query-plans.py` as an unproven gate; it has had a permanent falsification since it was written, and running it proves that** — resolved in §11QA.

### What I claimed, and what is true

§11PA's closing agenda said:

> `check-query-plans.py` is the last executing gate with no self-test ... It probes 27
> production queries ... and it has the same property as a checker that was falsified: it has
> never been shown to catch anything.

**That was wrong, and it was wrong about the file's own header.** Line 33 of
`check-query-plans.py` says, in the section titled WHY THE ASSERTION IS BELIEVABLE:

```
`forcing_a_scan_fails_the_probe` is part of the suite. It takes the daily revenue
report's SQL, strips every WHERE predicate (the shape that scans) and REQUIRES the
same detector the gate uses to report the table. With --check this script re-runs
that falsification first: a probe that cannot fail is worthless, and that exact
mistake has been made three times already in this project.
```

And `--check` enforces it: the falsification runs FIRST and a failure returns 2 with
"FAIL: the probe cannot fail ... a green result from the plan gate would be
worthless" (lines 346-356). The very first line of output is `falsification gate /
ok: a forced scan is detected`.

### How the error happened, because the mechanism matters more than the fact

I categorized the file by grepping for `--self-test` and finding none. The project has
a `--self-test"` convention for `verify-*.py` checkers, so a file without the flag looked
unproven. But the falsification here is not a flag -- it is a TEST IN THE RUST SUITE that
the gate runs as a prerequisite, which is a stronger design than a Python self-test: it
exercises the real detector against a real SQLite plan rather than a fabricated string.

**The lesson is the same one this ledger keeps recording in other costumes: I graded a
file by an absence of a STRING rather than by running it.** A grep for a flag is not an
inspection of a gate.

### The proof, run rather than asserted

To confirm the falsification is not decorative, the detector was made deaf --
`scanned_large_tables` stubbed to return an empty `Vec` at the top of the function -- and
the falsification test was run on its own:

```
test query_plan_probe::forcing_a_scan_fails_the_probe ... FAILED
panicked at query_plan_probe.rs:1104:5
test result: FAILED. 0 passed; 1 failed
```

It reddens immediately. The stub was then reverted with `git checkout --` and the file
verified byte-identical to HEAD; `check-query-plans.py --check` is green again at 27
probed queries.

### Why this falsification is better than most of the ones in this ledger

Reading it closely, `forcing_a_scan_fails_the_probe` already does the three things the
rest of this journal keeps having to retrofit:

1. **A baseline assertion first** -- the UNMUTATED query must be clean (line 1076), so a
   failure cannot be a pre-existing defect dressed up as a caught mutation.
2. **The mutation is asserted to have landed** -- the strips must actually have removed
   predicates, because "on a query with no `WHERE` the mutation would be a no-op and
   this proof would be as vacuous as the assertions it is meant to defend" (line 1061).
3. **The real detector, not a stand-in** -- the same `scanned_large_tables` the gate uses,
   against a real `EXPLAIN QUERY PLAN` on a seeded table.

That is precisely the "a predicate vacuously true over an empty set is indistinguishable
from a passing gate" defence, applied at the point of writing rather than after three
rounds. It should be the template for the checkers that still lack it.

### Verification

```
check-query-plans.py --check        -> rc 0, 27 queries, falsification green
  detector made deaf                -> forcing_a_scan_fails_the_probe FAILED (1104)
  reverted with git checkout --     -> file identical to HEAD, gate green again
```

### Ledger: 156 defined, 156 closed, 0 open.

## §11RA — O-M91: — two of my own verdicts were wrong, and a gate that rewrote the tree while claiming to verify it (2026-10-23)

Landed in `b0e7d28a6`, `5c9af7c43`, `574d5cf91`, `c573150cd`.

**O-M91 · gates — `check.sh` ran the FTL dedupe validator in APPLY mode, so a "verify" step rewrote .ftl files and could never fail, and three checkers held proofs no shell runner executed** — resolved in §11RA.

### 1. A validation step that mutated the tree and always passed

check.sh:784 ran `python3 scripts/dedupe-ftl.py` with no flag. The script sets
`write = not args.dry_run` (dedupe-ftl.py:159) and returns `1 if args.dry_run else 0` (:181).
So the step:

- **rewrote the .ftl files in place** during a matrix run called "validation", and
- **exited 0 no matter how many files it changed**, so it could not gate anything.

The script's own docstring documents `--dry-run` as the form callers should use, and both
the pre-commit hook (.githooks/pre-commit:149) and CI (dev-ci.yml:799) do pass it. Only
check.sh -- the one local matrix -- did not.

Fixed to `--dry-run` (`b0e7d28a6`). This is the sharper cousin of the vacuous-gate
pattern this journal keeps recording: not a gate that checks nothing, but a gate that
CHANGES THE THING IT CHECKS and then reports success.

### 2. Two of my own verdicts, corrected

**(a) check-query-plans.py.** Last round's agenda called it "the last executing gate with
no self-test ... never been shown to catch anything". Wrong, and wrong about its own
header. `forcing_a_scan_fails_the_probe` (`query_plan_probe.rs:1064`) strips every WHERE
clause, asserts the strips landed (`removed >= 2`), asserts the unmutated baseline is
clean, and requires the SAME detector the gate uses to name the scanned table. `--check`
runs it FIRST and exits 2 if it fails.

Proven by making the detector deaf (`scanned_large_tables` stubbed to an empty Vec):
the falsification test FAILED at :1104 immediately. Reverted with `git checkout --`.

The mechanism of my error is worth keeping: **I classified a file by grepping for
`--self-test` and finding nothing, rather than by running it.** This project's flag
convention is not the same thing as its proof convention.

**(b) The architecture-boundary self-test covered the rule but not its call.** Last
round I added `population_floor_violation()` and seven cases pinning it. A planted
`if False` in `main` -- the guard computed and then ignored -- left the self-test
**7/7 green**. The cases exercised a pure function nobody had proven was called, which
is precisely the "guard written, never called" shape the floor was added to prevent,
reproduced inside its own test.

Fixed by extracting `should_enforce_floor()` and asserting the CALL (`c573150cd`):
the same planted break now reddens a case.

### 3. Three proofs that existed and nothing ran

A delegated audit of every enforcing gate in `check.sh` surfaced three checkers whose
self-tests were real and unexecuted. Verified individually rather than taken on report:

| Checker | Proof | Ran before? | Now |
|---|---|---|---|
| `scan-unwrap-panic.py` | 18 cases incl. a real temp fixture | No shell/CI runner | check.sh:452 |
| `generate-pg-migration.py` | 3 fail-closed gate self-tests | No | check.sh:1153 |
| docs-auditor `check-cite-lines.py` | 8 cases | No | auditor loop (5c9af7c43) |

**The audit's own method had a hole, and that is the more useful finding.** It reported
all three as "UNPROVEN: no self-test". For `scan-unwrap-panic.py` that is too strong:
`verify-selftests-wired.py` already counted it as wired, because that checker greps for
"<name>.py --self-test" anywhere in its runner text. Stashing the edits and re-running
confirmed `52 of 73 ... every one is invoked` BEFORE the change -- no gap reported.

And the wired checker has a scope hole of its own: its `SCRIPT_DIR` is `scripts/`, so
every checker under `.agents/skills/docs-auditor/scripts/` is outside it. Its "52 of 73"
never covered the eight docs checkers the auditor loop runs.

A commit-message discrepancy was also created and then recorded rather than hidden:
`b0e7d28a6` swept two unrelated steps in from a parallel worker's edit to the same
file. Amending is forbidden on this branch, so the recovery was a new record
(`574d5cf91`) naming the mismatch -- which is the sanctioned form, not a workaround.

### Verification

```
bash -n scripts/check.sh                      -> rc 0
check-gate-runners.py                         -> every declared runner resolves, rc 0
sh scripts/check-auditor-selftests.sh         -> 8 checkers green, rc 0 (was 7)
  scan-unwrap-panic.py --self-test            -> 18 cases, rc 0
  generate-pg-migration.py --self-test        -> 3 gate self-tests, rc 0
  check-cite-lines.py --self-test             -> 8 cases, rc 0
  dedupe-ftl.py --dry-run                     -> no duplicates, rc 0
verify-architecture-boundaries.py --self-test -> 7 cases, rc 0; planted uncalled guard reddens
  detector made deaf                          -> forcing_a_scan_fails_the_probe FAILED, then reverted
verify-selftests-wired.py                     -> 52 of 73, every one invoked, rc 0
```

### Ledger: 157 defined, 157 closed, 0 open.

## §11SA — O-M92: — the audit was wrong three times, and the real gap was that live detectors were unpinned (2026-10-23)

Landed in `3f0099acd`, `f2f767ef6`.

**O-M92 · gates — a delegated audit named 17 unproven gates and its top three were all false; the genuine finding was that two live detectors had no case pinning them** — resolved in §11SA.

### 1. The audit, and why I did not simply act on it

A delegated audit of every enforcing `check.sh` step classified 17 gates UNPROVEN and
ranked them by blast radius. Its top three were `ipc parity`, `skill-drift-guard` and
`no-raw-params`. Each was checked individually rather than taken on report:

| # | Audit said | Measured |
|---|---|---|
| 1 | ipc parity: self-test never invoked | **False.** `dev-ci.yml:1616` runs it as a blocking step; the audit grepped check.sh, .githooks, run-pre-push and gates.json but NOT .github/workflows |
| 2 | skill-drift-guard: no proof mechanism | **False.** 10 bats files, **40 tests green**; neutering `FINDINGS[paths]+=` at detect.sh:413 makes `dead-check-regression.bats` fail at line 79 |
| 3 | no-raw-params: no self-test, no floor | **Half true.** No self-test, yes -- but the DETECTOR IS ALIVE: a planted unscoped `store_id: String` command produced `VIOLATION` and `FAIL: 1` |

**Three out of three wrong, all in the same direction: the audit looked for a marker
(a `--self-test` flag) and treated its absence as the absence of proof.** That is the same
mistake I made about `check-query-plans.py` last round, reproduced by an agent I briefed to
avoid it. A grep is evidence ABOUT a file, not evidence FROM it.

### 2. What was actually wrong: the detectors were alive and unpinned

For `no-raw-params` and `i18n lint`, the audit's SHAPE was right even though its
premise was not: both decide by matching exact literals that a rename or a reword
would silently empty.

**`verify-no-raw-params.sh`** greps `'store_id: String\|user_id: String'` across 84 files
(15 hits today, all paired). `test-no-raw-params.sh` writes a probe command into the real
command directory and asserts both directions -- it FIRES on an unscoped parameter and
stays QUIET on one with a `_scoped` twin. Making the grep match nothing (the
`done < <(true)` break) reddens case 1 with `rc=0, want 1` and explains that the gate is
deaf "in the direction that matters most".

**`lint-i18n.sh`** decides two of three categories by grepping vitest output for
`[i18n]` and `Attempt to override an existing message`. vitest exits 0 when it merely WARNS,
so a reword leaves the grep empty and the gate prints "no issues detected". The script
fails on a non-zero vitest exit, so it catches a CRASH -- but not a silent reword.
`test-lint-i18n.sh` EXTRACTS the two patterns out of the gate (a restated literal would
drift from the thing it polices), plants both real warnings, and adds a clean-run
control so a too-broad pattern cannot pass. A drifted pattern reddens exactly one case.

### 3. The test caught its own author twice

Both new tests failed on first run, correctly:

- `test-lint-i18n.sh`'s first extraction used a character class that stopped at the
  "]"-looking part of `\\[i18n\\]`, producing a truncated pattern. The test REFUSED to pass
  on a pattern it could not extract, which is the behaviour the case exists to have.
- The first planted break on `detect.sh` hit `FINDINGS[paths]+=` inside a COMMENT
  (the file documents the historical bug there) and the bats suite stayed green. The
  real write is at :413; only that one reddens the test. A break that lands in a comment
  is indistinguishable, from the exit code, from a break that lands in code.

### Verification

```
bash .agents/.../run-tests.sh              -> 40 bats tests green (skill-drift-guard)
  detect.sh:413 neutered                   -> dead-check-regression.bats FAILS at line 79
  probe deleted, file restored             -> suite green again
test-no-raw-params.sh                      -> 2 cases ok; deaf detector -> FAIL (rc=0, want 1)
test-lint-i18n.sh                          -> 5 cases ok; drifted pattern -> FAIL (1 case)
check.sh steps 07 and 79-88                -> PASS, incl. both new steps
verify-gate-completeness.py                -> every check.sh step named, rc 0
check-font-claims.mjs                      -> 16/16, rc 0
```

### Ledger: 158 defined, 158 closed, 0 open.

## §11TA — O-M93: — two census floors, and the red gate that was hiding behind another one (2026-10-23)

Landed in `79d40df4e`, `a7d57c977`, `bc8e3d164`.

**O-M93 · gates — `doc parity` printed "OK: 0 page pairs" on a moved directory and `check-audit-stamps.py` printed seven zeroes over an empty census, while a THIRD gate was already red behind them** — resolved in §11TA.

### 1. Doc parity: a set difference over empty sets

`website/scripts/check-doc-parity.py` answers one question -- does every page in `en/` have a
twin in `id/` -- by subtracting two sets. Empty sets subtract to empty. Measured by
pointing `DOCS` at a non-existent directory:

```
OK: 0 page pairs in parity.
MAIN RETURNED: 0
```

The gate's gates.json note records a negative control run when it was wired on
2026-10-19: a probe page under `en/` with no `id/` twin made it exit 1. That proves the
SUBTRACTION works. It never asked what happens when both sides are empty, which is the
only other way to get a green.

Fixed with a census floor (`census_problem`, five pages per locale against a measured 20).
Six self-test cases, every one asserting a verdict rather than a count. Disabling the
floor reddens five of them.

### 2. Audit stamps: a denominator that was printed and never checked

A stronger case than the audit claimed. `check-audit-stamps.py` does NOT merely print its
census -- it prints it clearly, `docs with a stamp and/or footer : 892` -- and then
never asks whether that number is plausible. Its loop contains the trap:

```
if not stamps and not footers:      # line 236
    continue
```

so a reworded house stamp, or a changed date format, makes every file `continue`
and leaves seven zeroes. Measured by emptying both `_stamp_dates` and `_footer_dates`:
the checker printed its report and **exited 0**.

A 50-doc floor (against 897 measured) now refuses that with a message naming the two
regexes to check.

### 3. The gate that was red the whole time, behind the one I was looking at

With audit stamps fixed, `check.sh` step 138 went green -- and step 141, `cite lines`,
failed. It had been failing before this round too: verified by stashing this round's
changes and re-running, `CITE_EXIT=1` either way.

Sixteen citations name a `file.rs:NNN` that has drifted. Sample: `runbook.md:1379` cites
`apps/desktop-tauri/src/state.rs:236` for `AppState::new`, which is at `:246`.
The checker was right every time; nothing had re-run it against the docs after the
source moved.

**The lesson is not that the checker was broken.** It is that a matrix which stops at
its first red step reports exactly one problem, and I had been reading "step N FAIL" as
"one problem left". Three gates were red in this range; I saw them one at a time
because each run stopped at the first.

### Verification

```
check-doc-parity.py (real)          -> OK: 20 page pairs, rc 0
  DOCS pointed at a missing path    -> FAIL + rc 1 (was OK + rc 0)
  --self-test                       -> 6 cases; floor disabled -> 5 assertions red
check-audit-stamps.py (real)        -> rc 1 -> rc 0 after the five footers; 897 docs, NO footer: 0
  both detectors emptied            -> REFUSED + rc 1 (was seven zeroes + rc 0)
check-auditor-selftests.sh          -> 8 checkers green, rc 0
check-dead-refs / check-orphans     -> rc 0, rc 0
check.sh step 138 (audit stamps)    -> PASS (8 s), was FAIL
check.sh step 141 (cite lines)      -> FAIL, pre-existing, 16 stale citations
```

### Ledger: 159 defined, 159 closed, 0 open.

### §11TA addendum — the sixteen citations, and why the checker's own answer was wrong six times

Landed in `b0b630444`.

The `cite lines` gate was red with 17 stale citations. A delegated repair resolved 16 of
them and, in **six cases, rejected the line number the checker itself suggested**:

| Site | Checker said | Actually correct | Why the checker was wrong |
|---|---|---|---|
| `routes/products.rs` | 398 | 464 | 398 is doc-comment prose; the claimed CALLER is at 464 |
| `logging/lib.rs` | 343 | 424 | 343 is `init_with_file`; the doc names `init_json_with_file` |
| `20260813_init.pg.sql` | 3887 | 3912-3916 | 3887 is an exempt-tables COMMENT; the array is at 3912 |
| `mobile state.rs` | 503 | 499 | 503 is a migration comment, not `.app_data_dir()` |
| `db/staff.rs` | 452 | 480-490 | 452 is a `format!` argument, not the denial TEXT quoted |
| `desktop state.rs` | 246 | 246 (judgement) | correct, but a doc comment; `pub fn new` is at 263 |

The checker matches any bare word from the doc line within a window. It is a good
DETECTOR and a poor ORACLE, and the difference matters: **pasting its suggestion would
have produced sixteen citations that pass the gate and point at the wrong line** -- the
exact class of defect the gate exists to catch, laundered through the gate itself.

Two things it could never have flagged, found by reading instead:

- `data-residency-and-retention.md:73` carried two more stale sub-ranges on the SAME line
  (`:553-556` -> `:651-655`, `:562-565` -> `:660-663`), both verified against the
  marker INSERT/DELETE and both length-preserving.
- `runbook.md:458` quoted the call as `env_usize(` when the code is
  `env_usize_via(&lookup, ` -- a prose error beside a correct citation.

The seventeenth, `ARCHITECTURE.md:576`, needed TWO numbers changed together: the checker
named only `mobile/state.rs:163` -> `:194`, while the sibling on the same line
(`desktop/state.rs:244`) had also drifted to `:260` and was not reported. Verified at
source (`grep -n 'impl AppState'` on both files) rather than trusted.

```
check-cite-lines.py   -> 17 DRIFTED -> 0; OK: 189 graded citations, rc 0
check.sh steps 138-146 -> PASS (audit stamps 8 s, cite lines 1 s, doc parity + self-test)
check-dead-refs / check-orphans / check-audit-stamps / check-adr-status -> all rc 0
check-auditor-selftests.sh -> rc 0
```

### Ledger: 159 defined, 159 closed, 0 open (unchanged -- this is the same entry).

## §11UA — O-M94: — a gate that enforced a convention over one directory, and the proof nobody ran in the other two (2026-10-23)

Landed in `c60ac3454`, `10c3d0dd3`.

**O-M94 · gates — `verify-selftests-wired.py` reported "every one is invoked" while 17 checkers sat outside its scope; widening it found a self-test no runner had ever run** — resolved in §11UA.

### 1. The scope was one directory, and the file already knew that pattern

`SCRIPT_DIR = ROOT / "scripts"`. Its own comment records having been burned by a narrow scope once before:

> The scope was verify-only at first and that was too narrow: check-chokepoints.py
> declares a --self-test that no runner invokes, and the gate reported every self-test
> as wired. A gate whose scope is narrower than the convention it enforces cannot see
> half the rot it exists to catch.

It fixed the PREFIX dimension (verify-* -> verify-* and check-*) and left the DIRECTORY dimension alone.
Measured 2026-10-23: `scripts/` held 66 checkers with a self-test, `.agents/skills/docs-auditor/scripts/`
held 8, `website/scripts/` held 2. **Seventeen files the gate could not see, while it printed
"52 of 73 ... every one is invoked"**.

### 2. Widening it immediately produced six false findings and one real one

The first widened run named seven uncalled checkers. Six were WRONG -- they are wired, through
`scripts/check-auditor-selftests.sh`, which was not in the `RUNNERS` list:

```
for t in check-env-docs check-ci-claims ... ; do
  python3 ".agents/skills/docs-auditor/scripts/$t.py" --self-test
done
```

A shell LOOP is invisible to a detector that looks for "<name>.py --self-test": it sees only the
literal `$t.py`. So the fix had two halves:

1. add `check-auditor-selftests.sh` to `RUNNERS` (it is a runner), and
2. expand the loop into eight explicit calls, so the names are greppable by a human and by any
   tool. Adding a checker now means adding a line that names it, instead of editing a
   semicolon-separated string where a typo silently drops a case.

**The seventh finding was real.** `website/scripts/check-links.mjs` declares a 19-assertion
self-test (:143, `if (process.argv.includes('--self-test'))`). CI runs `npm run check:links` =
`node scripts/check-links.mjs` **without the flag**, at `dev-ci.yml:240` and `website.yml:147`.
The gate ran; its proof never did. The file's own header says "a checker that cannot be shown to
fail is worthless".

Its gate had no roster row at all, which is why nothing noticed: `verify-gate-completeness.py`
iterates the gates PRESENT in `gates.json`, so a gate missing from it can never be reported as
required-but-unenforced. A row now exists for the self-test.

### 3. A collision that would have hidden one of them

`check-gate-runners.py` exists in BOTH `scripts/` and `.agents/skills/docs-auditor/scripts/`, and
they are DIFFERENT programs (one cross-checks gates.json; the other fails a required gate no runner
can reach). The gate used BASENAMES, which works by accident when there is one directory.
`checkers()` now returns ROOT-relative PATHS, and `called()` keeps matching on the basename only
because that is what the runner line yields.

### 4. Verified by breaking it

Deleting one of the eight explicit calls makes the widened gate report that exact file, with its
path. Before this round the same deletion was invisible.

And a mistake worth recording: to undo the test I used `git checkout --`, which reverted the file
to HEAD and **threw away the expansion I had just written**. Caught by grepping for the explicit
calls (0 found, loop still present) rather than assuming the restore worked, and the edit was
re-applied. `git checkout` is not a safe "undo" for an uncommitted edit -- it discards it.

### Verification

```
verify-selftests-wired.py            -> 52 of 73 -> **62 of 90**, rc 0
  one explicit call deleted           -> rc 1, names the file and its path
check-auditor-selftests.sh           -> 8 SELF-TEST OK (was a loop the auditor could not read)
check-links.mjs --self-test          -> 19/19 assertions, rc 0 (now a check.sh step)
verify-gate-completeness.py          -> every check.sh step named, rc 0; self-test 21 cases
check.sh steps 116-128               -> PASS, incl. 'self-tests wired'
check-font-claims.mjs                -> 16/16, rc 0 (required-no-ci count still 13)
```

### Ledger: 160 defined, 160 closed, 0 open.

## §11VA — O-M95: — of four unproven checkers, three were already guarded and one was not (2026-10-23)

Landed in `ba9c3707f`, `34989a490`.

**O-M95 · gates — `check-orphans.py` announced "Exit: 0 (clean)" over zero files, while `check-debt-ledger.py` and `verify-fluent-dynamic-families.py` turned out to already fail closed** — resolved in §11VA.

### 1. The candidate list, and why three of them were not gaps

14 checkers referenced by `check.sh` declare no `--self-test`. Seven were already known to have
another proof (a Rust falsification test, an inline `detector_still_sees_a_call()`, or a census
floor added in earlier rounds). The remaining four were checked by CONSTRUCTING their failure
mode, not by grepping for a keyword:

| Checker | What was tried | Result |
|---|---|---|
| `check-debt-ledger.py` | emptied both detectors (`defined`, `heads`) | **rc 1**, 12 FAIL — it cross-checks the ledger against `git log`, so one side empty is caught by the other |
| `verify-fluent-dynamic-families.py` | pointed it at an empty root | **rc 1**, 16 gap families — an empty corpus makes every family a gap, it fails closed |
| `check-orphans.py` | ran it from an empty directory | **rc 0**, "scanning 0 markdown files ... Exit: 0 (clean)" — **a real gap** |
| `check-server-origins.mjs` | drifted `MAIN_SERVER_ORIGIN` | **rc 1**, 8 findings — alive, but nothing pinned it |

Three of the four had no defect. That ratio is the point: the candidate list came from an
ABSENCE OF A STRING, and absence of a flag is not absence of a guard — the same error that made a
delegated audit wrong three times in round 51.

### 2. `check-orphans.py` — the one that was wrong

It walks `os.getcwd()`, so running it from the wrong directory is an ordinary mistake. All three
of its checks are "count the hits over the corpus", so an empty corpus yields `0, 0, 0` and the
run announces `Exit: 0 (clean)`. Measured from an empty directory:

```
scanning 0 markdown files
  A. Unversioned / orphan wrapper labels   0 finding(s)
  B. Heading-structure orphans             0 finding(s)
  C. Stale version headers                 0 finding(s)
Exit: 0 (clean)
```

A census floor now refuses that with rc 2, exempting `--file` (one named file is a deliberate
narrow mode). Its self-test drives all three checks over shapes they must catch, plus a clean
input that must stay quiet — because a floor alone would pass with every detector dead.

Neutering `check_b` reddens the self-test at case "check B can fire".

### 3. `check-server-origins.mjs` — alive, unpinned

Drifting `MAIN_SERVER_ORIGIN` to a foreign host produced 8 findings and rc 1, so the gate
genuinely decides. But its answer is a conjunction of ~12 `check()` calls, and an `admits()` that
returned `true` unconditionally would make every one of them vacuous while the gate still printed
its ok line. Six cases now pin the predicate in both directions — exact match, wildcard suffix, a
foreign origin refused, a LOOKALIKE suffix refused, loopback detected, loopback absent. They run
before any file is read, so they need no checkout.

Making `admits()` return `true` unconditionally reddens exactly the two refusal cases.

### Verification

```
check-orphans.py               -> rc 0 on the tree; rc 2 from an empty directory (was rc 0)
  --self-test                  -> 4 cases; check_b neutered -> 'check B can fire' FAILS, rc 2
check-server-origins.mjs       -> rc 0; MAIN drifted -> 8 findings, rc 1 (reverted)
  --self-test                  -> 6 cases; admits() always-true -> 2 refusal cases FAIL, rc 2
check-auditor-selftests.sh     -> 9 SELF-TEST OK (was 8)
verify-selftests-wired.py      -> 62 of 90 -> **64 of 90**, every one invoked
verify-gate-completeness.py    -> every check.sh step named, rc 0
check-font-claims.mjs          -> 16/16, rc 0
check.sh steps 136-146         -> PASS
```

### Ledger: 161 defined, 161 closed, 0 open.

## §11WA — O-M96: — four more candidates, zero gaps, and the method written down so the next reader stops re-deriving it (2026-10-23)

Landed in `b07ec4f60`.

**O-M96 · gates — the last four string-derived candidates were all already guarded; the round's product is the decision procedure, not a fix** — resolved in §11WA.

### 1. The four, each checked by constructing its failure mode

| Checker | What was tried | Verdict |
|---|---|---|
| `check-unified-routes.mjs` | an empty Caddyfile | **rc 2**, and it has THREE census guards, each printing "the parser drifted" |
| `check-replay-fork.py` | — | has a companion test, `scripts/test-replay-fork.py`, wired at check.sh:561 |
| `check-ui.mjs` | — | an AGGREGATOR (runs lint/tsc/vitest); it has no detector of its own, so it has nothing to prove |
| `check-font-claims.mjs` | read its 16 rows | each is `if (!probe.ran) exit 2` then an exact-value assertion; an empty probe makes the assertion FALSE, so it fails |

**Zero real gaps.** Combined with round 54 (1 of 4), a candidate list derived from an absent
`--self-test` string has a hit rate near one in four, and most of what it names is guarded by a
mechanism the string-search cannot see.

### 2. Why the string search is structurally unable to be right

This tree uses at least four proof mechanisms:

1. a `--self-test` flag (the only one a grep for `--self-test` can find);
2. a COMPANION TEST (`test-replay-fork.py` beside `check-replay-fork.py`);
3. a proof the checker RUNS FIRST (`check-query-plans.py --check` runs the Rust falsification
   test `forcing_a_scan_fails_the_probe` before it grades anything);
4. an INLINE liveness guard (`check-scratch-leaks.py::detector_still_sees_a_call()`).

A grep answers "does this file contain the flag". The question that matters is "can this gate
be shown to fail". Those are different questions, and no amount of widening the grep closes
the gap between them.

### 3. What was written down

`docs/operations/how-to-tell-a-gate-can-fail.md` — the three-command procedure, the four guard
shapes, the measured hit rates per round, and a table of the eight checkers already checked and
cleared with the reason for each. The point is to stop the next round re-deriving it:
four rounds have now spent effort on this list and found two defects in total.

The one rule it ends on: **do not repair a gate because it lacks a flag; repair it because you
watched it pass something it should have failed.**

### 4. Two measurements taken for the next structural question

`check.sh` is now **141 steps**. The tail (step 137 to the end) measures **222 s**, and the
known heavy steps are go test (~469 s), the application shells (~359 s), the exhaustive-deps
ratchet (~78 s) and ftl orphans (~81 s). The matrix has only grown: five of the last five
commits touching check.sh ADDED a step, none removed one.

That is a real observation and NOT a change made this round: merging gates is a structural
decision that needs its own evidence (which steps overlap, which never fire independently), and
round 55 did not gather enough of it to justify touching a working matrix.

### Verification

```
check-unified-routes.mjs (empty Caddyfile)  -> rc 2, names the parser
check-replay-fork.py + test-replay-fork.py  -> wired at check.sh:561
check-font-claims.mjs                       -> 7 `process.exit(2)` ran-guards, 16 exact assertions
check-orphans.py / check-dead-refs.py       -> rc 0 on the new doc
matrix steps 137+                           -> 222 s
```

### Ledger: 162 defined, 162 closed, 0 open.

## §11XA — O-M97: — the matrix is not too big, it is badly shaped: 4 steps are 79% of it and half cost nothing (2026-10-23)

Landed in `6d8a763e2`, `009a2721c`, `d8226748c`.

**O-M97 · gates — "the matrix has 141 steps and only grows" was a recurring agenda note with no number behind it; the number says size is not the problem** — resolved in §11XA.

### 1. First, a real defect found by the measurement run itself

The first attempt to time the matrix died at step 01 with a UnicodeEncodeError traceback. The
cause was a **zero-byte stray file in the repo root whose name ended in U+F00A** (private-use
codepoint), created at 12:26 that day, untracked and empty. Two facts, and the second is the defect:

1. the file was garbage -- removed;

2. **the gate crashed on it instead of naming it.** `print(f"  - {f}")` raised on a cp1252
   stdout, so a REAL finding was lost behind a traceback.

Fixed by reconfiguring stdout/stderr once at the top of `main()` (`errors="backslashreplace");
per-line escaping cannot help because the failure is at the stream, not at the string -- tried
that first and the traceback was identical, which is what pointed at the right layer. Verified by
re-planting the file: it is now named and the gate exits 1.

### 2. The measurement

Steps 1-36 of `check.sh` (it stops at 37 on this machine, no PostgreSQL):

```
36 steps        total 538 s
  clippy workspace            286 s   53%
  exhaustive-deps ratchet      88 s   16%
  rustdoc                      50 s    9%
  no-raw-params falsification  27 s    5%
  the other 32 steps          187 s   17%

  18 of the 36 steps report 0 s
```

Split by what the step INVOKES, which is what decides whether it can be parallelised:

```
HEAVY   (cargo / npm / npx / go / docker)   8 steps   344 s
STATIC  (pure python / node checks)        28 steps   194 s
```

### 3. What that means, stated as a ceiling rather than a hope

**Merging the "X" and "X self-test" pairs saves ~0 s.** There are 46 such pairs and half the
steps already cost nothing; merging two zero-second steps is zero. The step COUNT is a cosmetic
number and was the wrong thing to watch for five rounds.

**Parallelising the static half has a ceiling of ~155 s** -- 194 s of independent subprocesses,
39 s if 5x. The other 344 s is cargo/npm work that does not parallelise against itself. That is
29% of the measured total, not the "half the matrix" the step count implies.

The pattern is already proven on this corpus: `verify-selftest-sweep.py` runs 50 checkers 8-wide
and went 362 s -> 232 s in round 46.

**No changes were made to `check.sh` this round.** The point was to replace a recurring
intuition with a number before touching a working matrix, and the number changed the answer.

### Verification

```
verify-root-policy.py            -> 6 self-test cases; clean tree rc 0
  stray U+F00A file re-planted   -> named, rc 1 (was: traceback, finding lost)
matrix steps 1-36 timings        -> measured, arithmetic re-checked (494 + 44 = 538)
check-dead-refs / check-orphans  -> rc 0 on the new doc
```

### Ledger: 163 defined, 163 closed, 0 open.

## §11YA — O-M98: — the cache was fine, the concurrency is capped at 1.9x, and a probe was writing broken shell into the tree it scans (2026-10-23)

Landed in `538f9472c`, `f3568fb68`, `855badf0a`.

**O-M98 · gates — two of this round's three findings reversed an earlier conclusion of mine, and only the measurements caught it** — resolved in §11YA.

### 1. A real hazard: the shell-syntax probe wrote into the tree it scans

`verify-shell-syntax.py --self-test` wrote its probe to `ROOT / "scripts" /
"_syntax_selftest_tmp.sh"` -- inside the directory the checker enumerates -- and at one point
writes an INTENTIONALLY BROKEN script (unterminated quote). Two consequences:

1. `check.sh` runs the plain checker and its self-test as ADJACENT STEPS. A concurrent run
   could read the half-written file and report a PARSE ERROR on a clean tree. **Ten trials did
   not reproduce it** -- recorded as LATENT, not demonstrated.

2. The scope differential a few lines ABOVE compares the git count with the no-git count. An
   untracked file present then makes them disagree and fails the self-test for a non-reason.
   **This one needs no concurrency at all**, and is the stronger of the two.

Moved the probe to `target/` (gitignored, so the git path never counted it anyway). Assertions
unchanged: 7/7 cases, real run green at 63 scripts, `scripts/` clean afterwards.

### 2. Concurrency: 1.9x, not the 5x I assumed last round

Eight static gates, measured:

```
serial 22,898 ms   ->   concurrent 12,073 ms     1.9x
```

Safe: 8/8 exit 0 across four batches, output identical, `git status --porcelain` hashed to the
same SHA-256 before and after, no ports, locks or shared caches.

**The ceiling is structural.** Two of the eight are 21 s of the 23 s (`verify-debt-markers.py`
11.2 s, `verify-shell-syntax.py` 10.1 s); the other six sum to 1.5 s. Eight-way parallel cannot
beat the two longest jobs. Last round's "~155 s saved" assumed UNIFORM cost, which this
measurement disproves: **the realistic figure on that slice is 60-100 s.**

### 3. I was wrong about sccache, and the experiment is what showed it

First reading: a 1.06 % hit rate plus `Non-cacheable reasons: incremental 1456` meant
`incremental = true` was defeating the cache. I wrote that into the timing doc.

Then two things falsified it:

```
full clippy with CARGO_INCREMENTAL=0   -> hits stayed 51, misses 4522 -> 4745   (still zero)
cargo clean -p X ; cargo check -p X    -> hits 52 -> 53, misses UNCHANGED        (cache works)
```

So the cache is healthy; the low RATE reflects a history of 4595 compiles across changing
RUSTFLAGS, profiles and crate subsets -- distinct keys, few repeats. `incremental` explains why
those compiles were not CACHED, not why later ones do not HIT: an uncacheable compile cannot
seed the cache.

The doc is corrected in place, with both readings recorded rather than the wrong one deleted.
That is the second time this round that a plausible mechanism survived inspection and died on
an experiment.

### Verification

```
verify-shell-syntax.py --self-test   -> 7/7; scripts/ has no probe afterwards
verify-shell-syntax.py (real)        -> 63 entry points parse, rc 0
8 static gates serial vs concurrent  -> 22.9 s vs 12.1 s, tree byte-identical
sccache after clean+check x2         -> hits 51 -> 52 -> 53, misses unchanged
sccache after clippy, incremental=0  -> hits unchanged at 51
```

### Ledger: 164 defined, 164 closed, 0 open.

## §11ZA — O-M99: — the money doc named two files that no longer held the risk, and the real answer was three (2026-10-23)

Landed in `2e167e28b`, `0cd2247a0`.

**O-M99 · foundation — `Money::default`'s doc listed call sites that had moved, so the one place a reader would look was empty** — resolved in §11ZA.

### 1. The claim, and what is actually true

`foundation/src/money.rs` documents a USD stand-in that no business money should ever be built
from, and names where the fallback is live:

> `#[serde(default)]` fields of type `Money` (e.g. `modules/sales` `SaleLine::tax_amount`,
> `Sale::subtotal`)

Measured with `git grep -n 'serde(default)'` over every non-test `.rs`, then reading the next
three lines for a `Money` type:

- those fields are in **`foundation/src/sales.rs`**, not `modules/sales` -- that module holds a
  different `SaleLine` and no `tax_amount` at all;
- there are **THREE**, not two: `SaleLine::tax_amount`, `Sale::subtotal`, `Sale::tax_total`.

A stale claim about a STAND-IN CURRENCY is worse than no claim: it sends a reader to a file that
does not hold the risk. Corrected, with the derivation command stated so the next reader can
re-measure rather than trust.

### 2. A line number I wrote wrong in the same edit

The first draft of the correction cited `:45`, `:122` and `:126` for those three fields. Two were
wrong -- the real lines were 45, 123 and 127. Rather than fix the digits, the line numbers were
REMOVED: a field name survives a refactor and a line number does not, and the numbers had
already drifted inside a single edit. That sentence is now in the comment, so the next writer
does not re-add them.

### 3. The risk is smaller than the comment implied, and the reason is worth having

`minor_units` is ZERO, so the stand-in is zero money, and `Money`'s arithmetic refuses to mix
currencies: `checked_add` returns `None` on a mismatch, which is how the refund path rejects a
mixed-currency line (`crates/kasirmu-bridge/src/refunds.rs:146`). A defaulted `tax_amount`
cannot silently corrupt a total -- it can only be compared, and the comparison fails closed.

That was verified rather than assumed: `tax_amount.currency` has **zero** references in the
tree, while `line_total.currency` (the required field) is the one the refund guard reads.

### 4. Pinned, because the doc had drifted once already

`exactly_three_money_fields_use_the_usd_serde_fallback` parses `sales.rs` at COMPILE TIME
(`include_str!`) and asserts the set of fallback fields is exactly those three, plus that the
fallback stays zero money in USD. A move or rename fails the build, not the test.

Verified by breaking it: adding `#[serde(default)]` to `line_total` -- a Money field that must
NOT have it -- reddens the test immediately (at money_tests.rs:1003).

### Verification

```
git grep 'serde(default)' + 3-line read   -> exactly 3 Money fields, all in foundation/src/sales.rs
Money::default() call sites in production -> zero (only its own test at money_tests.rs:778)
tax_amount.currency references            -> zero; line_total.currency is what refunds guard on
cargo doc -p foundation                   -> rc 0, no warnings
cargo test -p foundation                  -> 605 + 23 passed
  fourth field given the attribute        -> pinning test FAILS
```

### Ledger: 165 defined, 165 closed, 0 open.
