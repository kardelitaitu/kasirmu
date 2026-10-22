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
| Medium | 66 | 61 | **5** |
| Low | 23 | 17 | **6** |
| Test (O-T) | 16 | 10 | **6** |
| **Total** | **131** | **114** | **17** |

**Updated 2026-10-22 (round 10).** O-M24, O-M25 and O-M49 closed by this session; O-L01, O-L02, O-L06,
O-L07, O-L08, O-L09, O-L10, O-L11, O-L18 and O-M26 closed by concurrent sessions in the same round. **The
High tier is empty and 17 entries remain**: 6 Test, 6 Low, 5 Medium.

**One of them is not really closed: O-M46.** Commit `401ddd3da` says it resolves the entry, and the
`kasirmu-local-api` suite HANGS at HEAD because of two tests that commit added (§11AZ). The gate counts it
as closed because the commit subject says so; the tree says otherwise. **A suite that hangs is worse than
a suite that fails** — a red test names itself, a hang produces a CI timeout with no name — so the next
pass should fix or revert that commit before anything else.

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
count** — `crates/kasirmu-core/src/db/products_crud.rs:22-41` ✔
`list_products` has no LIMIT/OFFSET and materialises every row, then `attach_images`
(`:696-707`) builds `IN (?1,…?N)` with one placeholder per product — memory and SQL text grow
linearly with the catalog until `SQLITE_MAX_VARIABLE_NUMBER` turns a normal page load into a
hard error. *Fix:* paginate the list APIs and chunk the image lookup into fixed-size batches.

**O-H03 · kasirmu-core — offline-queue drain pays one fsync per item** —
`crates/kasirmu-core/src/sync_client.rs:86-105` ✔. ✅ **PAID** (re-verified at HEAD 2026-10-21:
`Store::mark_offline_synced_batch` exists at `db/offline.rs:298` with a test at `offline_tests.rs:302`).
Fixed: `apply_sync_outcomes` wraps all outcome transitions into a single transaction in autocommit mode, reducing N disk fsyncs during queue drain to 1. Added `Store::mark_offline_synced_batch`. Verified with unit tests in `offline_tests.rs` and `sync_client_tests.rs`.

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
`apps/mobile-tauri/src/commands/history.rs:58-82` ◦
The only bound is `sales_history_days()` — Pro is 5 years and higher tiers unlimited — so one
IPC call builds a `Vec<SaleListItem>` of every sale and serialises it to the renderer. *Fix:*
limit/offset (or keyset on `created_at`) with a default page.

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
mutex, and `zip` silently drops items** — `platform/sync/src/daemon.rs:214-270` ◦
A 1,000-item drain is 1,000 fsyncs with the DB lock held throughout, and
`pending.iter().zip(results.iter())` silently discards items if `results` is shorter. *Fix:*
one transaction (or `UPDATE … WHERE id IN (…)`), and assert/report the length mismatch.

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
`crates/kasirmu-bridge/src/ctx.rs:412-413` ✔ **PROMOTED TO O-H26 IN §9 — this is a guaranteed
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
*Fix:* multi-row INSERT / `unnest`.

**O-M27 · kasirmu-api — settings endpoint: 8 round trips to read, 3 writes with no
transaction** — `crates/kasirmu-api/src/routes/settings.rs:555-561`, `:498-509` ◦. *Fix:*
`WHERE key = ANY($1)`; wrap writes in one transaction.

**O-M28 · cloud-server — quota cooldown map never swept, two `String` allocs per probe** —
`apps/cloud-server/src/quota_detector.rs:103-116` ◦. Grows with tenant churn. *Fix:* prune on
insert; borrowed keys.

**O-M29 · mobile — the "batch" track-serial twin of O-H08** —
`apps/mobile-tauri/src/commands/products.rs:288-306` ✔. Fixed: `run_get_product_track_serial_batch` and `get_product_track_serial_scoped` now use `Store::get_products_track_serial_batch` and `Store::get_product_track_serial`, executing batched `WHERE sku IN (...)` directly against the products table. Verified with `mobile-tauri` tests.

**O-M30 · mobile — `discount_percent as u8` truncates above 255** —
`crates/kasirmu-bridge/src/pos/preview.rs:176` and `crates/kasirmu-bridge/src/pos/checkout.rs` ✔. Fixed: discount percent clamped with `checkout_discount_percent` across both preview and shortfall checkout doors; verified with `preview_and_shortfall_doors_treat_a_high_discount_percent_identically`.

**O-M31 · mobile — org switch / session creation take the global DB mutex 5 and 3 times** —
`apps/mobile-tauri/src/commands/auth.rs:634-752`, `:413`, `:438`, `:467` ◦. Each acquisition
interleaves with the sync daemon and every POS command. *Fix:* one guard, no awaits inside.

**O-M32 · shells — conflict commands build a fresh `reqwest::Client`, no timeout** —
`apps/mobile-tauri/src/commands/sync.rs:588`, `:637`; `apps/desktop-tauri/src/commands/sync.rs:434`,
`:482` ◦. No keep-alive reuse and no timeout. *Fix:* shared client in `AppState` (as
`image_download.rs:180` already does).

**O-M33 · mobile — image-cache missing-set computed by one sequential stat per file per
cycle** — `apps/mobile-tauri/src/image_download.rs:231-236` ◦. 10k images = 10k awaited
syscalls per cycle. *Fix:* `read_dir` once into a `HashSet` and diff.

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

### Low — harmless today; a senior reviewer would still flag it

**O-L01 · kasirmu-core — INSERT re-planned per row in the legacy ledger loop** —
`crates/kasirmu-core/src/db/products_stock_adjust/ledger.rs:199-201` ◦. *Fix:*
`prepare_cached` above the loop.

**O-L02 · kasirmu-core — failed `ROLLBACK` discarded silently** —
`crates/kasirmu-core/src/db/stock_counts.rs:166-173` (same shape `downgrade.rs:126-131`) ◦. A
stuck connection poisons every later call and nothing records why. *Fix:* log the rollback
error alongside the original.

**O-L03 · kasirmu-core — `Store` fields are `pub`, exposing the raw connection** —
`crates/kasirmu-core/src/db/mod.rs:206-214` ◦. Callers can bypass the repository layer and the
documented transaction contract. *Fix:* privatise behind `conn()`.

**O-L04 · kasirmu-core — CSV export builds the whole file in memory** —
`crates/kasirmu-core/src/export/mod.rs:270-272`, `:321+` ◦. Memory scales with total history.
*Fix:* write rows into a `BufWriter<File>`.

**O-L05 · kasirmu-core — `format!` per endpoint comparison; linear pairing scan** —
`crates/kasirmu-core/src/topology.rs:195-197`, `:215-237` ◦. *Fix:* `strip_prefix`; index
pairings once.

**O-L06 · kasirmu-api — JWT cache key allocates two Strings per request; eviction is a full
O(n) sweep** — `crates/kasirmu-api/src/auth.rs:250-276` ◦. *Fix:* `Arc<str>` keys; incremental
eviction.

**O-L07 · kasirmu-api — a refcount-write failure is reported as a 400** —
`crates/kasirmu-api/src/routes/images.rs:141-146` ◦. A DB problem on upload is
indistinguishable from a malformed upload and the cause is dropped. *Fix:* 500 with the
underlying error.

**O-L08 · mobile — quadratic `Vec::contains` in the feature-toggle diff** —
`apps/mobile-tauri/src/commands/features.rs:171-175` ◦. *Fix:* `HashSet` snapshot.

**O-L09 · mobile — dead `Store::new` and `drop` of a borrowed guard** —
`apps/mobile-tauri/src/commands/products.rs:379-382` ◦. The file carries
`#[allow(dropping_references)]` — the borrow shape was worked around, not fixed. *Fix:* drop
the real guard.

**O-L10 · platform/sync — refund lines re-parse the same SQL per row** —
`platform/sync/src/queue.rs:517-533` ◦. *Fix:* `prepare` once above the loop.

**O-L11 · platform/sync — `VersionVector::iter` returns `(&String, &Counter)`** —
`platform/sync/src/crdt/version_vector.rs:139` ◦. *Fix:* return `(&str, &Counter)`.

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
`crates/kasirmu-hal/src/transport/bt_android.rs:63-86` ✔ (3A-05). The guard is taken for
`attach_current_thread` *and* the whole closure, which includes `BtRfcommStream::connect`
(multi-second) and `read` (blocks until data). One printer read stalls every Bluetooth operation
in the process. *Fix:* lock only long enough to clone the `JavaVM`, then attach and block
outside the guard.

**O-M44 · kasirmu-hal — `discover_all()` per configured USB printer at startup** —
`crates/kasirmu-hal/src/bootstrap.rs:299-302` ◦ (3A-07). N printers means N complete bus
enumerations, each returning the same list, of which only element 0 is kept. *Fix:* hoist one
`discover_all()` above the loop.

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

**O-M50 · kasirmu-cli — export deep-clones the payload and `.ok()`s a failure into an empty
array** — `crates/kasirmu-cli/src/commands/kasirpkg.rs:120-128` ◦ (3B-06). A serialisation
failure reports success with zero rows. *Fix:* move the `Vec` out in one step and propagate.

**O-M51 · kasirmu-lan — replay buffer clones its key on every hit and evicts by full scan** —
`crates/kasirmu-lan/src/replay.rs:136`, `:160-166` ◦ (3B-07). `entry(key.clone())` on the hot
path; once the 8,192 cap is reached, eviction is `min_by_key` over all queues. *Fix:* `entry_ref`,
plus a global FIFO index for O(log n) eviction.

**O-M52 · kasirmu-plugin — `read_entry` fallback is O(n²) with an allocation per entry** —
`crates/kasirmu-plugin/src/package.rs:330-339` ◦ (3B-09). *Fix:* keep the filename index built
during parse.

**O-M53 · kasirmu-notification — the message is rebuilt per recipient and the SMTP transport
per tick** — `crates/kasirmu-notification/src/email_scheduler.rs:118-150` (clones `:135`, `:140`;
transport `:116`) ✔ (3C-02) · **LIVE**. Both bodies cloned per recipient, one round trip each,
TCP+TLS re-established every tick. *Fix:* build the two `SinglePart`s once; cache the transport.

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

**Re-measured 11-10-26:** `crates/kasirmu-reporting/src/daily_summary.rs` NO LONGER EXISTS (the crate's `src/` is now `{error,lib,margin,menu_engineering}.rs`). The non-sargable-predicate substance DOES still hold, in the surviving files: `menu_engineering.rs` (261 lines) and `margin.rs` (126 lines) both still carry a `DATE(s.created_at)`-style predicate and neither carries a `LIMIT`. Repoint the two query names to those modules when acting on this item; the `daily_summary`/`query_daily_summary` spellings are the retired ones. 
```sql
130           AND DATE(s.created_at) BETWEEN ?1 AND ?2
```

**O-M55 · kasirmu-reporting — menu engineering performs five sorts per call** —
`crates/kasirmu-reporting/src/menu_engineering.rs:127-141`, `:170-171`, `:181-182` ◦ (3C-05).
Corrected in §9: round 3 said "the same key four times"; the verified count is **five** — three
sorts on `total_revenue_minor` (SQL `ORDER BY` at `:108`, inside the merge at `:171`, again by the
caller at `:131`) plus two full median sorts (`median_of` at `:182`, called at `:134` and `:135`).
*Fix:* keep merge order, drop the caller's re-sort, use `select_nth_unstable` on one buffer.

**O-M56 · kasirmu-media — `trim_borders` does per-pixel bounds-checked `get_pixel` over four
full-frame passes** — `crates/kasirmu-media/src/crop.rs:169-211` ◦ (3C-06). ~160 M calls at the
40 MP cap before the solid-colour guard fires. *Fix:* walk `as_raw()` rows, bail out early.

**O-M57 · kasirmu-logging — syslog layer allocates per field and blocks per record** —
❌ **MOOT 2026-10-21.** The target no longer exists: `crates/kasirmu-logging/src/syslog.rs` was
DELETED by `53dcb73a3` ("refactor(logging): delete the unwired syslog/eventlog sinks (C29/D13)",
2026-09-29), together with the `libc` dependency. `Cargo.toml:20-22` records the removal and
notes the crate "is now pure safe Rust". There is no syslog layer left to make non-blocking —
closed by deletion, not by fixing.
`crates/kasirmu-logging/src/syslog.rs:119-141`, `visitor.rs:27-49` ◦ (3C-07). One `CString` and
one blocking `libc::syslog()` per record on the emitting thread. *Fix:* `non_blocking`, `write!`
into a reused buffer.

**Re-measured 11-10-26:** `crates/kasirmu-logging/src/syslog.rs` and `eventlog.rs` NO LONGER EXIST — the crate's own README (audited 2026-10-11) records that the syslog/eventlog FFI modules were REMOVED, leaving `{error,lib,visitor}.rs`. The finding is retired with the code it described. (It also makes the ledger's O-M57-era claim that a syslog layer installs on deployments a dated reading — see the same-named item in `.agents/reviews/crate-review-ledger-24-09-26.md`.) 
**O-M58 · kasirmu-logging — eventlog layer allocates a `Vec<u16>` and blocks per record** —
❌ **MOOT 2026-10-21.** Same deletion as O-M57: `eventlog.rs` and the `windows-sys` dependency
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
`lib.rs:60-67` ◦ (3C-11). No concurrency cap or retry; `NotificationError::RateLimited {
retry_after_seconds }` is constructed but no non-test code matches on it, so the `Retry-After`
value is computed and thrown away. *Fix:* bounded queue with a semaphore; honour `Retry-After`
with a capped attempt count.

**O-M62 · modules-currency — the live IPC command ships the entire rate history** —
`modules/currency/src/repository.rs:50-72` ✔ (3D-01) · **PAID** (`a93b0b758`). Added `DEFAULT_MAX_EXCHANGE_RATES = 500` bound to `list_exchange_rates` and added `list_exchange_rates_bounded(limit)` with `LIMIT` pushdown. Verified in `repository_tests.rs`.

**O-M63 · modules-inventory — the DB mutex is held across the whole sale-deduction
transaction** — `modules/inventory/src/handlers.rs:220-241` ✔ (3D-02) · **latent**. Every line,
every BOM ingredient and the `commit()` run under one guard, so a single `sale.completed`
serialises all other access to that connection. *Fix:* pool or `spawn_blocking`; scope the guard
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
log field** — `modules/inventory/src/handlers.rs:69-93`, `:177-184` ✔ (3D-04). `SELECT id` then
`SELECT product_type` could be one; the ingredient `SELECT sku` exists only to make the `info!`
at `:197` readable. *Fix:* fold the pair, drop or join the ingredient lookup.

**O-M66 · modules-staff / platform-core — every permission check re-parses the grants JSON** —
`platform/core/src/staff.rs:52-60`, `platform/core/src/rbac.rs:259-280` ✔ (3D-06). Fixed (`1428ad443`): zero-alloc check on required domain wildcard (`strip_suffix(":*") == Some(domain)`) avoiding `format!` String allocation, and `check_permissions_json` with borrowed `Cow<str>` avoiding individual String allocations on every permission evaluation.

### Low — harmless today; a senior reviewer would still flag it

**O-L12 · kasirmu-hal — a fresh Java `byte[]` per Bluetooth read** —
`crates/kasirmu-hal/src/transport/bt_android.rs:291-314` (write `:265`) ◦ (3A-08). *Fix:* one
`GlobalRef` per stream.

**O-L13 · qris-core — a money percentage validated with `parse::<f64>()`** —
`crates/qris-core/src/validate.rs:58-62` ✔ (3A-09). Fixed (`df4d7aa2b`): delegated percentage validation to `is_valid_percent_str` backed by exact integer decimal parser `parse_percent`. Rejects `"1e3"`, `"NaN"`, `"inf"` and eliminates float arithmetic on monetary calculations.

**O-L14 · qris-core — CRC-16 is the bit-by-bit form** — `crates/qris-core/src/crc.rs:11-24` ✔
(3A-10). Fixed (`798211bf3`): replaced bit-by-bit calculation with 256-entry lookup table (`CRC16_TABLE`), cutting inner iteration count from 8 to 1 per byte during QRIS generation and validation.

**O-L15 · kasirmu-crypto — `master_key_from_env()` runs per encrypt/decrypt call** —
`crates/kasirmu-crypto/src/lib.rs:139-152` ✔ (3A-12). Fixed (`c656624c2`): cached `master_key_from_env()` with `OnceLock<Option<[u8; 32]>>`, avoiding repeated environment queries, string allocations, and hex decoding on every encryption and decryption invocation.

**O-L16 · kasirmu-hal — `barcode()` truncates the length with `n as u8`** —
`crates/kasirmu-hal/src/drivers/escpos.rs:92-100` ✔ (3A-13). Fixed: clamped input slice to 255 bytes (`slice.len() as u8`) and added test in `escpos_tests.rs` so payload length and GS k header length byte never diverge.

**O-L17 · kasirmu-plugin — `fire_event` clones the hook list and linear-scans each owner** —
`crates/kasirmu-plugin/src/manager.rs:499-515` ✔ (3B-08). Fixed (`06894624d`): replaced hook list clone with borrowed iteration, and replaced linear scan over sandboxes with O(1) `plugin_index` map lookup.

**O-L18 · kasirmu-cli — `copy_reference_data` inserts row by row with no transaction** —
`crates/kasirmu-cli/src/seed_demo.rs:218-227` ◦ (3B-10). One implicit transaction and WAL commit
per row, per table, per store DB. *Fix:* one transaction per table, stream from the cursor.

**O-L19 · kasirmu-lan — a fresh `String`/`Vec<u8>` per event per peer** —
`crates/kasirmu-lan/src/noise.rs:206-224` ◦ (3B-11). *Fix:* reusable per-connection buffer.

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
`crates/kasirmu-reporting/src/daily_summary.rs:137` ✔ (`hour` i64→u8) — **retired 2026-09-30 with the module (checklist C29), so this half is historical**;
`crates/kasirmu-media/src/thumbnail.rs:94-95` ◦ (u64→u32, unclamped) (3C-13) — **this half is still live**. *Fix:* `try_from`
with an explicit clamp.

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
`modules/sales/src/models.rs:173`, `:189` ◦ (3D-08). Corrected in §9: round 3 implied a
truncation hazard. Both casts are **`usize`→`i64`** — `cart.line_count()` returns `usize`
(`foundation/src/cart.rs:220`) and `i` comes from `.enumerate()` — so no truncation is possible on
any supported target. *Fix:* `i64::try_from` for clarity, or leave; this is not a correctness
risk.

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

The `Mutex` stays. `RwLock` would be worse, not better: `Backup::new` takes a `RefCell` borrow on its
source, so two readers would race it — a data race, not an optimisation.

**O-T05 · `daemon_tests.rs` states ~5.5 s of pure sleep** — `platform/sync/src/daemon_tests.rs:174-181` ✔
(4A-05). 27 sleeps (500 ms + 200 ms after every `daemon.start()`, three more pairs, 600 ms, 300 +
100) waiting on a daemon whose tick is 100 ms — a 5× floor. *Fix:* poll `daemon.status()` under a
1 s `timeout`.

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

**O-T10 · `run_sweep()` reads ~224 source files, six times per run** —
`apps/desktop-tauri/src/commands/registration_gate_tests.rs:466-481` ✔ (4A-10). Fixed: memoised via `std::sync::OnceLock<Sweep>`, eliminating 5 redundant 224-file source walks across test assertions.

**Low**

**O-T11 · four rate-limit tests drive ~400 sequential HTTP pushes** —
`apps/cloud-server/src/sync_api_tests.rs:2246-2255` ✔ (4A-11). *Fix:* keep one 101-request burst
for the 429 boundary.

**O-T12 · env-var tests take a process-wide lock *and* `#[serial]`, and tolerate 12 s** —
`apps/cloud-server/src/db_tests.rs:141-151`, `:333-347` ✔ (4A-12). *Fix:* injectable config;
tighten the bound to the 5 s `wait_timeout` under test.

**O-T13 · a test that asserts nothing** — `platform/sync/src/pg_daemon_tests.rs:543-551` ✔
(4A-13). `mark_offline_synced_nonexistent_item` computes a result and `let _ = result;`, with a
comment admitting either outcome is fine — it can only fail on panic, and still pays a snapshot
clone. *Fix:* assert the contract.

**O-T14 · four Redis legs are `#[ignore]`d from dev CI** —
`apps/cloud-server/src/redis_backend_tests.rs:96`, `:127`, `:141`, `:61` ✔ (4A-14). TTL/expiry
behaviour is untested in the default run. *Fix:* a fake backend, or record why dev CI cannot.

**O-T15 · 300 ms sleeps to hold a lock window open** —
`crates/kasirmu-core/src/db/sales_crud_tests.rs:132-135` ✔ (4A-15), same shape at
`db/shifts_tests.rs:629`, `db/gift_cards_tests.rs:811`/`:877`. *Fix:* drive the release with a
channel the blocked caller can reach.

**O-T16 · a 5 ms sleep to separate two timestamps** —
`crates/kasirmu-core/src/db/kds_tests.rs:1566` ✔ (4A-16). *Fix:* insert explicit distinct
`received_at` values.

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
