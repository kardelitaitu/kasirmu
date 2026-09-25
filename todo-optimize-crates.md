# Optimize our own crates — census (round 1)

**Status:** OPEN — census round complete (§1–§6); scale-review journal appended 2026-09-25
(§7, §8, §9); §9 also closes the verification backlog and records the first pass over the test
mass. No code touched, no axis chosen.
**Date:** 2026-09-25 · **Branch:** `0.0.40` · **Recorded against:** `c7767e73e` (§8). §1–§7 recorded against HEAD at their own time of measurement.

---

## 0. Scope — "our crates", stated so the fence cannot drift later

**In scope (39 workspace members).** `Cargo.toml` globs `crates/*`, `modules/*`, `platform/*`
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

## 4. What this census does NOT tell us — no instrument was run

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
`crates/kasirmu-core/src/sync_client.rs:314-318` ✔
The outcome loop calls `store.mark_offline_synced(&item.id)` per accepted item, and that writer
opens and commits its own transaction per call (`db/offline.rs:627-636`). Draining a backlog
after an outage costs N BEGIN/UPDATE/COMMIT syncs — a 10k queue is 10k disk syncs on the till.
*Fix:* group outcomes by kind and apply them in one transaction / batched
`UPDATE … WHERE id IN (…)`.

**O-H04 · kasirmu-core — a fresh `reqwest::Client` per sync HTTP call** —
`crates/kasirmu-core/src/sync_client.rs:519-522` ✔ (repeat sites ◦)
Every call builds a new client — no connection-pool reuse, a fresh TCP+TLS handshake per
request. The same pattern recurs at `:683`, `:739`, `:839`, `:944`, `:1008` per the pass, so
the QRIS settlement poll and the memo poll pay handshake cost on every tick, on every terminal.
*Fix:* hold one client in process state (`OnceLock`/`LazyLock` or a `SyncConfig` field).

**O-H05 · kasirmu-bridge — staff screen costs 2N+2 queries and the whole roster** —
`crates/kasirmu-bridge/src/staff.rs:857-866` ✔
`list_staff_scoped` loads all users, then per user issues `get_user_profile` and
`assignment_for_user`, with no limit/offset anywhere on the path. Latency and memory grow
linearly with headcount on every staff-screen load. *Fix:* one batched core accessor (three
`IN`-clause queries) plus pagination on the command.

**O-H06 · kasirmu-bridge — catalog import probes existence per row inside one long
transaction** — `crates/kasirmu-bridge/src/data.rs:736-744` ✔
Per product: a full `serde_json::Value` clone, a `SELECT 1 FROM products WHERE sku = ?1`
existence probe, and a fresh RFC-3339 timestamp allocation — all inside one transaction that
holds the global write lock for the whole import. A 50k-SKU package is 50k probes plus one
lock held for minutes. *Fix:* `HashSet` of existing SKUs in one query, hoist `now`, reuse a
prepared statement.

**O-H07 · kasirmu-bridge — the whole offline queue goes up in one HTTP call** —
`crates/kasirmu-bridge/src/sync.rs:580` ✔
`list_pending_offline()` is unbounded and its result is handed to a single push; a terminal
offline for a week builds an unbounded `Vec` and an unbounded request body against a 30 s
transport ceiling. *Fix:* push in fixed-size batches (e.g. 500) with a cursor, looping until
the queue drains.

**O-H08 · kasirmu-bridge — the "batch" track-serial lookup runs a full join per SKU** —
`crates/kasirmu-bridge/src/products.rs:283-299` ✔
`run_get_product_track_serial_batch` maps over SKUs calling `get_product` — the full
`ProductWithDetails` join — per SKU, to read one boolean. A 40-line cart costs 40 wide queries
on the checkout path. *Fix:* one `SELECT sku, track_serial FROM products WHERE sku IN (…)`.

**O-H09 · cloud-server — plan middleware queries the DB on every sync request** —
`apps/cloud-server/src/sync_api.rs:236-242` ◦
`plan_middleware` runs on every `/api/sync/*` request; `get_tenant_plan`
(`sync_store/tenant.rs:34-46`) is a pool checkout + transaction + `set_config` GUC + SELECT +
rollback — four round trips per request, uncached, so DB load scales with request rate, not
tenant churn. *Fix:* short-TTL per-tenant plan cache.

**O-H10 · cloud-server — conflict detection does ~10 round trips per pushed item** —
`apps/cloud-server/src/sync_store.rs:178-200` ◦
Per item, `detect_conflict` (`sync_store/conflicts.rs:239-297`) runs `load_entity_vector` +
`load_entity_payload` + `save_entity_vector`, each with its own pool checkout + transaction +
GUC — one 500-item push ≈ 5,000 round trips. *Fix:* hoist one connection/transaction around
the batch and read/write vectors with `IN (…)` statements.

**O-H11 · kasirmu-api — one product SELECT per sale line inside the sale transaction** —
`crates/kasirmu-api/src/pg.rs:1712-1727` ◦
Every sale line issues its own `SELECT … FROM products WHERE tenant_id = $1 AND sku = $2`, so a
30-line receipt costs 30 round trips and holds the pooled connection and row locks
proportionally longer. *Fix:* resolve all SKUs in one `WHERE sku = ANY($2)` before the insert
loop.

**O-H12 · kasirmu-api — the products endpoint is unbounded with a correlated subquery per
row** — `crates/kasirmu-api/src/pg.rs:1332-1345` ◦
`GET /api/v1/products` has no LIMIT/OFFSET and `PRODUCT_SELECT` (`pg.rs:1038`) adds a
correlated `SELECT SUM(ss.qty) FROM stock_summary` per row — response body and query cost both
grow linearly with catalog size. *Fix:* keyset pagination; replace the correlated subquery with
a grouped `LEFT JOIN`.

**O-H13 · kasirmu-api — synchronous file I/O inside async handlers** —
`crates/kasirmu-api/src/routes/images.rs:351` ◦
`std::fs::read` in the image route (and `std::fs::write`/`rename` at `:93-94`, read again at
`:441`) blocks a tokio worker; a slow volume stalls every other request on that worker thread.
*Fix:* `tokio::fs` or `spawn_blocking`.

**O-H14 · mobile — product list is an N+1 over tax rates with an unbounded payload** —
`apps/mobile-tauri/src/commands/products.rs:129-165` ◦
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
`apps/desktop-tauri/src/commands/kds.rs:112-130` ◦
Each status transition loops over active orders making two awaited bridge round-trips per
ticket (`get_kds_order_lines_scoped`, `resolve_kds_targets`) — O(active tickets) DB work per
keystroke instead of O(1). *Fix:* batch lines/stations for all ids, or refresh only the
changed ticket.

**O-H17 · mobile — every checkout loads the subscription and verifies RSA under the global DB
mutex** — `apps/mobile-tauri/src/commands/pos.rs:993-1006` ◦
Each checkout (and shortfall retry) takes the process-wide DB mutex, loads
`TenantSubscription::load`, and runs `verify_signature` (RSA-2048), then re-acquires the same
mutex for settlement — heavy CPU under the global lock on the hottest path. *Fix:* cache the
verified subscription keyed by row version; settle under one acquisition.

**O-H18 · platform/sync — full stock-summary rebuild per backlog page** —
`platform/sync/src/pg_daemon.rs:388-389`, `:844` ◦
The PG pull loop pages with no page cap, and any page containing a `stock.movement` triggers
`rebuild_stock_summary()` over the entire delta ledger — a large backlog costs
O(pages × all movements) inside one tick. *Fix:* cap pages per tick with a persisted cursor and
rebuild once after all pages (or make the rebuild incremental).

**O-H19 · platform/sync — the SQLite daemon push is unbatched** —
`platform/sync/src/daemon_tick.rs:267` ◦
`transport.push_items(&pending)` POSTs the whole pending vector in one request, while
`SyncEngine` batches at 64 KB — as the queue backs up, body size and the 30 s ceiling are
exceeded, the cycle fails, and the queue grows further. *Fix:* route through
`build_batches(&pending, MAX_BATCH_BYTES)`.

**O-H20 · platform/sync — PG transport does one network round trip per item** —
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
`platform/core/src/database/manager.rs:73-87` ◦
`store_dbs.lock()` is taken across file creation, pragma setup and a full migration run, so a
first touch of one store serialises every other store's connection lookup behind disk I/O.
*Fix:* lock only the map lookup/insert; run `open_or_create_connection` outside the guard.

### Medium — likely to bite within years

**O-M01 · kasirmu-core — `recompute_all_popularity` re-plans one UPDATE per SKU** —
`crates/kasirmu-core/src/db/popularity.rs:855-869` ◦. Runs at every app start; hoist a
prepared statement above the loop. *Fix:* `prepare` once, rebind per row.

**O-M02 · kasirmu-core — popularity scoring re-reads settings and re-parses JSON per
point** — `crates/kasirmu-core/src/db/popularity.rs:354` (with `:593-595`) ◦. The
per-(period, category) loop re-queries `settings` and re-parses the category-means JSON every
point. *Fix:* parse once before the loop, pass `&HashMap`.

**O-M03 · kasirmu-core — pending-queue listers are unbounded** —
`crates/kasirmu-core/src/db/offline.rs:572-589` ◦. The store-side twin of O-H07/O-H21: the
table that grows fastest during degradation is loaded in one go at reconnect. *Fix:*
limit/cursor paging in the drain loop.

**O-M04 · kasirmu-core — offline idempotency probe substring-scans every payload** —
`crates/kasirmu-core/src/db/offline.rs:561-567` ◦. `instr(payload, …)` over all pending rows,
per sale, on the checkout path. *Fix:* indexed `sale_id` column and equality probe.

**O-M05 · kasirmu-core — tax-rate validation is a per-id round trip** —
`crates/kasirmu-core/src/db/tax/assignments.rs:26-34` ◦. Bulk reassignment of N ids costs N
`get_tax_rate` calls before the write tx opens. *Fix:* one `IN`-clause validation.

**O-M06 · kasirmu-core — `category_popularity` loads the whole catalog to keep top-N per
category** — `crates/kasirmu-core/src/db/popularity.rs:448-470` ◦. *Fix:* rank in SQL with
`ROW_NUMBER() OVER (PARTITION BY …)`.

**O-M07 · kasirmu-core — stock-movement archive commits a transaction per group** —
`crates/kasirmu-core/src/db/products_stock_adjust/movements.rs:93-94` ◦. Hundreds of
write-lock acquisitions and journal syncs where one batch would do. *Fix:* batch groups into
fewer transactions.

**O-M08 · kasirmu-core — promotion engine does a per-line DB lookup, twice** —
`crates/kasirmu-core/src/promotion_engine.rs:112-115` and `:167-172` ◦. `category_of` is
DB-backed at the call site and the Buy-X-Get-Y branch walks the lines again. *Fix:* resolve
SKU→category once into a map.

**O-M09 · kasirmu-core — the embedded RSA public key is re-parsed per verification** —
`crates/kasirmu-core/src/license_verification.rs:517-521` (also `:543`) ◦. Every subscription
gate and CRL check redoes constant PEM parsing. *Fix:* `OnceLock<RsaPublicKey>`.

**O-M10 · kasirmu-core — rate-limiter attempt map grows without bound** —
`crates/kasirmu-core/src/rate_limiter.rs:26`, `:54-61` ◦. Only per-key pruning on access; login
spam grows memory while the global lock is held, with a `String` alloc per attempt. *Fix:* cap
+ TTL sweep; borrow-keyed lookup.

**O-M11 · kasirmu-core — one `Mutex<redis::Connection>` held across a network round trip** —
`crates/kasirmu-core/src/cache.rs:165`, `:290-294` ◦. All product/inventory cache ops
serialise behind a single blocking Redis call. *Fix:* pooled/multiplexed client.

**O-M12 · kasirmu-core — location resolver: global mutex per lookup, map never evicted** —
`crates/kasirmu-core/src/location_resolver.rs:48-49`, `:56-58` ◦. Locked per cart-open and per
`add_line`; entries only cleared wholesale. *Fix:* evicting/sharded cache.

**O-M13 · kasirmu-core — per-location stock and name queries** —
`crates/kasirmu-core/src/location_resolver.rs:509-521` (also `:275-289`) ◦. O(locations)
queries per shortfall panel. *Fix:* one `IN`-clause query plus a name join.

**O-M14 · kasirmu-core — CRL re-deserialised and linearly scanned on every gate call** —
`crates/kasirmu-core/src/license_verification.rs:659-668`, `:682-685` ◦. Cost grows with
revocation-list length. *Fix:* cached `HashSet`s + precomputed key hash behind the signature
check.

**O-M15 · kasirmu-core — signed payload re-parsed on every entitlement check** —
`crates/kasirmu-core/src/subscription.rs:778-791` (also `:759`) ◦. `addons()` and
`allows_workspace_type` re-parse JSON per call with lowercased-`String` comparisons. *Fix:*
parse once into a struct; `eq_ignore_ascii_case`.

**O-M16 · kasirmu-bridge — staff role paths are N+1 in three places** —
`crates/kasirmu-bridge/src/staff.rs:915-919` (`role_dto` = 2 queries per role), `:788-792`
(owner gate loads and scans the whole user table to count), `:606-610` (linear role scan per
user) ◦. *Fix:* grouped count queries and one id→name map.

**O-M17 · kasirmu-bridge — tax settings read is one query per category** —
`crates/kasirmu-bridge/src/tax.rs:443-450` ◦. *Fix:* batched join, mirroring the products
fix.

**O-M18 · kasirmu-bridge — KDS chit fan-out is quadratic with per-pair clones** —
`crates/kasirmu-bridge/src/kds.rs:136-147` (dedup via linear scan; `orders.iter().find()` at
`:271`) ◦. *Fix:* `HashSet` dedup + map lookup.

**O-M19 · kasirmu-bridge — analytics loads the whole user table for a handful of names** —
`crates/kasirmu-bridge/src/analytics.rs:66-74` ◦. *Fix:* fetch names for the aggregate's ids
only.

**O-M20 · kasirmu-bridge — `blocking_lock()` on the async session-resolution path** —
`crates/kasirmu-bridge/src/ctx.rs:412-413` ✔ **PROMOTED TO O-H26 IN §9 — this is a guaranteed
panic, not a parked worker.** Recorded here in round 2 as parking a runtime worker; verification
re-read `audit.rs:257-266` and found the crate documenting the same pattern as a panic on first
use. See §9 for the corrected entry. *Fix:* `lock().await`, and delete the stale justification
at `:407-408`.

**O-M21 · kasirmu-bridge — failed store-DB creation silently discarded** —
`crates/kasirmu-bridge/src/locations.rs:263` ◦. `let _ = ctx.db_manager.create_store_db(…)`;
the caller succeeds for a location with no database, surfacing later as unrelated errors on a
growing set of locations. *Fix:* propagate; make row + DB creation atomic or failed.

**O-M22 · cloud-server — batch outcome reassembly is O(n²) with item clones** —
`apps/cloud-server/src/sync_api.rs:368-379` (clone at `:333`) ◦. A 1,000-item push does 10⁶
comparisons. *Fix:* direct indexing — `valid_indexes` is already sorted.

**O-M23 · cloud-server — the push payload is re-serialised just to measure its size** —
`apps/cloud-server/src/sync_api.rs:311` ◦. Doubles serialisation cost and peak memory on the
hottest write path. *Fix:* use the buffered body length.

**O-M24 · kasirmu-api — image pack: global SQLite mutex once per hash, query per hash,
2 MB body buffered** — `crates/kasirmu-api/src/routes/images.rs:413-451` ◦. *Fix:* one batched
query under one lock; stream the response.

**O-M25 · cloud-server — snapshot cache: one global mutex, full-clone hits, O(tenants)
sweep** — `apps/cloud-server/src/sync_api.rs:600-613`, `:691-702` ◦. Taken on every request.
*Fix:* shard (as `rate_limit.rs` does); serve `Bytes`/`Arc<[u8]>`.

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
`apps/mobile-tauri/src/commands/products.rs:258-276` ◦. One full `get_product` per SKU. *Fix:*
`IN`-clause store method.

**O-M30 · mobile — `discount_percent as u8` truncates above 255** —
`apps/mobile-tauri/src/commands/pos.rs:1154-1158` ◦ (bridge clamp at
`crates/kasirmu-bridge/src/pos.rs:1647`). Correctness rather than scale, but 300 becomes a 44%
discount and the two checkout doors disagree. *Fix:* route through the bridge clamp.

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
`platform/sync/src/lib.rs:157-177` ◦. Corrected in §9: the round-2 wording said "~3 full JSON
serialisations", which overstates it. What the loop does is clone the backlog for sort (`:157`),
`serde_json::to_vec(item)` **once** per item to measure size (`:166`), then clone each item into
its batch (`:175`). *Fix:* estimate from `payload.len()`; batch references; reuse bytes.

**O-M35 · platform/sync — every daemon tick loads the entire pending queue** —
`platform/sync/src/daemon.rs:140` ◦. Unbounded `list_pending_offline()` per tick. *Fix:*
bounded page per tick.

**O-M36 · platform/sync — `last_synced_at` loads every offline-queue row ever written** —
`platform/sync/src/queue.rs:881` ◦. To compute one MAX. *Fix:* `SELECT MAX(synced_at) …`.

**O-M37 · platform/sync — full CRL downloaded and signature-verified on every tick of every
terminal** — `platform/sync/src/daemon_tick.rs:585-589` ◦. Fleet traffic scales with
revocation count. *Fix:* delta CRL keyed by version watermark + local TTL cache.

**O-M38 · platform/sync — the settings sink fires while the blocking DB lock is held** —
`platform/sync/src/daemon_tick.rs:369-380`, `:696` ◦. A slow Tauri emit stalls every other DB
consumer, checkout included; a DB-touching sink deadlocks. *Fix:* collect events, emit after
release.

**O-M39 · platform/sync — image-push client has no timeout; DB mutex re-taken per missing
file** — `platform/sync/src/image_push.rs:75`, `:176-178` ◦. A hung server stops image pushes
permanently. *Fix:* timeouts; accumulate failures, mark once.

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
across ten aggregate queries** — `crates/kasirmu-notification/src/email_scheduler.rs:71-81` ✔
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
class** — `crates/kasirmu-payment/src/registry.rs:100-114` ✔ (3A-06)
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
use an index** — `modules/reporting/src/repository.rs:31-54` ✔ (3D-05) · **latent**, zero
non-test callers
Three defects in one query. `strftime('%Y-%m-%d', created_at) = ?1` wraps the column in a
function, so any index on `created_at` is unusable and each report is a full scan growing with
history. `SUM(total_minor)` has no `GROUP BY currency`, so a multi-currency day adds IDR to USD.
The result is then stamped `Currency(*b"USD")` unconditionally — an IDR store's revenue is
labelled dollars. *Fix:* sargable half-open range (`created_at >= ?1 AND created_at < ?2`), group
by currency, and resolve the store's currency instead of hard-coding.

```rust
33               FROM sales WHERE strftime('%Y-%m-%d', created_at) = ?1 AND status = 'completed'",
...
49                  currency: Currency(*b"USD"),
```

### Medium — likely to bite within years

**O-M40 · kasirmu-hal — `probe_all` walks the USB bus four times** —
`crates/kasirmu-hal/src/transport/usb.rs:274-286` (with `:199-210`) ✔ (3A-01). Scanners cost two
walks (`CLASS_HID` + `CLASS_VENDOR_SPECIFIC`), scales a third `CLASS_HID`, printers a fourth,
and each walk opens every matching device to read three string descriptors (`:162-173`).
*Fix:* enumerate once into a `Vec<UsbDeviceInfo>` and classify in memory.

**O-M41 · kasirmu-hal — one full bus enumeration per device connect** —
`crates/kasirmu-hal/src/transport/usb.rs:320-337` ✔ (3A-02). `open_device` builds a fresh
`rusb::Context` and lists every device to find one VID/PID; it is the connect path for
`UsbReceiptPrinter::ensure_connected` and `UsbHidBarcodeScanner::connect`, so every reconnect
after `NoDevice` re-walks the bus. *Fix:* open by `rusb::Device` from the cached enumeration.

**O-M42 · kasirmu-hal — serial barcode read is one syscall per byte** —
`crates/kasirmu-hal/src/drivers/serial_scanner.rs:136-137` ✔ (3A-03), same block at
`drivers/bt_scanner.rs:144-145` ◦. A 13-character barcode costs 13 blocking `read()` calls, and
the dead `Ok(n)` arm (`:155-166`) shows a multi-byte read was intended. *Fix:* read into a
`[u8; 64]` and scan the returned slice for the terminator.

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
`crates/kasirmu-payment/src/resilience.rs:337-341` ◦ (3A-11). Every terminal in a fleet retries
on the same beat, and `1 << (attempt - 1)` with a `u32` config overflow-panics in debug past 64.
*Fix:* clamp at construction, add jitter.

**O-M46 · kasirmu-local-api — the audit sink writes through the handlers' DB mutex, one
unbounded task per event** — `crates/kasirmu-local-api/src/lib.rs:528-571` ✔ (3B-01). Every
mutating request queues an extra blocking `INSERT` behind the single connection the handlers use,
and each `record` spawns a task that clones the event and only `warn!`s on failure. *Fix:*
dedicated connection or a bounded channel with one writer; count failures rather than log them.

```rust
533          tokio::spawn(async move {
...
566              let conn = store.lock().await;
567              if let Err(e) = kasirmu_core::Store::new(&conn).log_audit(&entry) {
568                  tracing::warn!(error = %e, "local API audit write failed");
```

**O-M47 · kasirmu-plugin — `validate_sql` compiles ~16 regexes per statement** —
`crates/kasirmu-plugin/src/db.rs:214-224`, `:323-330` ✔ (3B-03). `contains_word` builds a
`format!` pattern and calls `Regex::new` for 13 blocked keywords plus PRAGMA plus two
ALTER/TABLE checks on every plugin `exec`/`query`, while the ten table patterns a few lines away
are correctly cached in `OnceLock`s. *Fix:* cache the keyword regexes, or word-scan on bytes and
drop the `to_uppercase()`.

**O-M48 · kasirmu-plugin — plugin `query` is unbounded and clones each column name per cell** —
`crates/kasirmu-plugin/src/db.rs:93-128` ✔ (3B-04). No row cap; the whole result set is
materialised into `Vec<Value>` and `name.clone()` runs once per cell. *Fix:* enforce a row
ceiling and intern names once per query.

**O-M49 · kasirmu-cli — `kasirpkg` import probes existence per row, per table** —
`crates/kasirmu-cli/src/commands/kasirpkg.rs:346-372` ✔ (3B-05, also `:316-343`, `:398-457` ◦).
Two statements per row where one `INSERT … ON CONFLICT DO UPDATE` would do, plus a deep
`serde_json::Value` clone and a fresh RFC-3339 `String` per row. *Fix:* prepared upserts,
`into_iter()`, hoist `now`.

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
`crates/kasirmu-logging/src/syslog.rs:119-141`, `visitor.rs:27-49` ◦ (3C-07). One `CString` and
one blocking `libc::syslog()` per record on the emitting thread. *Fix:* `non_blocking`, `write!`
into a reused buffer.

**O-M58 · kasirmu-logging — eventlog layer allocates a `Vec<u16>` and blocks per record** —
`crates/kasirmu-logging/src/eventlog.rs:108-115` ◦ (3C-08). *Fix:* thread-local scratch buffer,
worker thread.

**O-M59 · kasirmu-logging — the JSON+file init path skips the writability preflight the text path
has** — `crates/kasirmu-logging/src/lib.rs:307-343` vs `:260` ✔ (3C-09). `try_init_with_file`
calls `ensure_log_dir_writable(log_dir)?` (`:260`); `try_init_json_with_file` never does, so on
an unwritable `log_dir` the non-blocking writer silently drops every line and the caller still
gets `Ok(())` — exactly the failure LOG-2 was added to catch. *Fix:* call the same preflight at
the top of the JSON variant.

**O-M60 · kasirmu-logging — retention runs once at init against hourly rotation** —
`crates/kasirmu-logging/src/lib.rs:262`, `:280-282`, `:317`, `:339-341` ✔ (3C-10). Hourly
rotation is 24 files/day with no count or size cap, and cleanup is a detached thread spawned once
— a process up for weeks never prunes. Deletion failures are discarded at `:207` ◦. *Fix:*
periodic timer or a rotation policy with a max-file limit; log the `remove_file` error.

**O-M61 · kasirmu-notification — unbounded `tokio::spawn` per event, and `RateLimited` is never
matched** — `crates/kasirmu-notification/src/handlers.rs:98-125`, `:179-212`, `:249-275`;
`lib.rs:60-67` ◦ (3C-11). No concurrency cap or retry; `NotificationError::RateLimited {
retry_after_seconds }` is constructed but no non-test code matches on it, so the `Retry-After`
value is computed and thrown away. *Fix:* bounded queue with a semaphore; honour `Retry-After`
with a capped attempt count.

**O-M62 · modules-currency — the live IPC command ships the entire rate history** —
`modules/currency/src/repository.rs:50-72` ✔ (3D-01) · **LIVE** via both shells'
`exchange_rates.rs`. No `LIMIT`, no date window, no pair filter — and the crate's own doc at
`:74-83` says the function "grows without bound" and that consumers should use
`list_latest_exchange_rates` instead. *Fix:* bound the query, or move the remaining callers to
`list_latest_exchange_rates` the way CUR-11 already did for `PaymentModal`.

**O-M63 · modules-inventory — the DB mutex is held across the whole sale-deduction
transaction** — `modules/inventory/src/handlers.rs:220-241` ✔ (3D-02) · **latent**. Every line,
every BOM ingredient and the `commit()` run under one guard, so a single `sale.completed`
serialises all other access to that connection. *Fix:* pool or `spawn_blocking`; scope the guard
to one transaction.

**O-M64 · modules-inventory — the same UPDATE is re-`prepare`d per line and per ingredient** —
`modules/inventory/src/handlers.rs:155`, `:187` ✔ (3D-03). A 20-line sale with a 4-ingredient BOM
compiles identical SQL ~100 times; `prepare_cached` is used nowhere in `foundation/` or
`modules/`. *Fix:* hoist one prepared statement above both loops.

**O-M65 · modules-inventory — two lookups per line, plus one query per ingredient purely for a
log field** — `modules/inventory/src/handlers.rs:69-93`, `:177-184` ✔ (3D-04). `SELECT id` then
`SELECT product_type` could be one; the ingredient `SELECT sku` exists only to make the `info!`
at `:197` readable. *Fix:* fold the pair, drop or join the ingredient lookup.

**O-M66 · modules-staff — every permission check re-parses the grants JSON** —
`modules/staff/src/models.rs:52-69` ◦ (3D-06). A full `serde_json` parse plus a `Vec<String>` per
call, and `unwrap_or_default()` turns malformed JSON into "authorises nothing" silently.
`platform_core::rbac::has_permission` then allocates a second `String` per call
(`platform/core/src/rbac.rs:259-265`). *Fix:* parse once into a `HashSet`; surface the parse
error.

### Low — harmless today; a senior reviewer would still flag it

**O-L12 · kasirmu-hal — a fresh Java `byte[]` per Bluetooth read** —
`crates/kasirmu-hal/src/transport/bt_android.rs:291-314` (write `:265`) ◦ (3A-08). *Fix:* one
`GlobalRef` per stream.

**O-L13 · qris-core — a money percentage validated with `parse::<f64>()`** —
`crates/qris-core/src/validate.rs:58-62` ◦ (3A-09). Accepts `"1e3"`, `"inf"`, `"NaN"`, which the
exact-decimal fee parser (`amount.rs:98`) rejects — so validation can pass a payload that fails
later. It is also `f64` on money, which `amount.rs:76-81` records as a rule the crate broke
itself out of. *Fix:* validate with the same parser the fee path uses.

**O-L14 · qris-core — CRC-16 is the bit-by-bit form** — `crates/qris-core/src/crc.rs:11-24` ◦
(3A-10). Runs twice per QRIS round trip. *Fix:* table-driven.

**O-L15 · kasirmu-crypto — `master_key_from_env()` runs per encrypt/decrypt call** —
`crates/kasirmu-crypto/src/lib.rs:87-91`, `:112`, `:162-168` ✔ (3A-12). An env lookup, a hex
decode and a `Vec<[u8;32]>` per call. *Fix:* `OnceLock`; try the master-derived key first.

**O-L16 · kasirmu-hal — `barcode()` truncates the length with `n as u8`** —
`crates/kasirmu-hal/src/drivers/escpos.rs:92-100` ◦ (3A-13). Over 255 bytes emits a wrong GS k
length byte and prints garbage silently — the same truncation class round 2 recorded as O-M30 for
discounts. *Fix:* error above 255, as `encode_field` does for the 99-byte TLV limit.

**O-L17 · kasirmu-plugin — `fire_event` clones the hook list and linear-scans each owner** —
`crates/kasirmu-plugin/src/manager.rs:499-515` ◦ (3B-08). *Fix:* id→index map, borrow the list.

**O-L18 · kasirmu-cli — `copy_reference_data` inserts row by row with no transaction** —
`crates/kasirmu-cli/src/seed_demo.rs:218-227` ◦ (3B-10). One implicit transaction and WAL commit
per row, per table, per store DB. *Fix:* one transaction per table, stream from the cursor.

**O-L19 · kasirmu-lan — a fresh `String`/`Vec<u8>` per event per peer** —
`crates/kasirmu-lan/src/noise.rs:206-224` ◦ (3B-11). *Fix:* reusable per-connection buffer.

**O-L20 · kasirmu-reporting — money crosses into `f64` at the median boundary** —
`crates/kasirmu-reporting/src/menu_engineering.rs:73-77`, `:176-208` ◦ (3C-12). `median_margin`
is a public `f64` and quadrant classification compares `(margin_minor as f64) >= median_margin`.
*Fix:* keep medians in `i64` minor units.

**O-L21 · truncating `as` casts on computed numerics** —
`crates/kasirmu-reporting/src/daily_summary.rs:137` ✔ (`hour` i64→u8);
`crates/kasirmu-media/src/thumbnail.rs:94-95` ◦ (u64→u32, unclamped) (3C-13). *Fix:* `try_from`
with an explicit clamp.

**O-L22 · modules-sales — status string via a `serde_json` round trip; INSERT re-prepared per
line** — `modules/sales/src/repository.rs:148-151`, `:180-201` ◦ (3D-07). `as_stored_str()`
returns `&'static str` for free. *Fix:* use it; hoist a `prepare_cached`.

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
  journal. §5's axes and §6's rules still stand unchanged; O-H23/O-H24/O-H25 are candidates for
  funding ahead of any axis work, because they are correctness and availability rather than
  optimization.

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
worker** — `crates/kasirmu-bridge/src/ctx.rs:412-413` ✔ · **LIVE** via `ctx.rs:371`
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
`apps/desktop-tauri/src/commands/topology/topology_tests.rs:16-24` ✔ (4A-01)
`fresh_conn()` does `migrations::run(&mut conn)` — the whole chain, not the cached snapshot — and
it is the shared helper: 22 `fresh_conn()` calls plus 9 direct `run` sites in
`topology_command_tests.rs`, 10 in `topology_tests.rs`, 3 in `topology_serde_tests.rs`, 1 in
`topology_stress_tests.rs`. The crate already ships `migrations::fresh_db()`, and the bridge's own
topology tests already use it — this is the one file that did not get the memo. *Fix:* one line —
`fresh_conn()` calls `migrations::fresh_db()`.

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
`platform/sync/src/queue_tests.rs:13-16` ✔ (4A-03). `setup_store()` does
`Box::leak(Box::new(migrations::fresh_db()))` on every one of ~77 tests, to buy a `'static`
lifetime nothing needs. *Fix:* return a borrowed fixture; drop the leak.

**O-T04 · `fresh_db()` clones under one process-wide mutex, and 787 call sites share it** —
`crates/kasirmu-core/src/migrations.rs:524-568` ✔ (4A-04). The snapshot is a
`static SNAPSHOT: LazyLock<Mutex<Connection>>` (`:528`) and the clone takes that lock (`:563`) for
a full `Backup::run_to_completion` (`:564-567`). With **787** `fresh_db()` call sites in test files
(measured today), every DB construction in a test binary serialises on one lock — a hard barrier
under `cargo nextest`'s per-binary threads. *Fix:* a small per-thread snapshot pool.

**O-T05 · `daemon_tests.rs` states ~5.5 s of pure sleep** — `platform/sync/src/daemon_tests.rs:174-181` ✔
(4A-05). 27 sleeps (500 ms + 200 ms after every `daemon.start()`, three more pairs, 600 ms, 300 +
100) waiting on a daemon whose tick is 100 ms — a 5× floor. *Fix:* poll `daemon.status()` under a
1 s `timeout`.

**O-T06 · `rate_limiter_tests.rs` states 4.2 s of sleep** —
`crates/kasirmu-core/src/rate_limiter_tests.rs:211`, `:223-225`, `:238` ✔ (4A-06). Four sleeps
(2 s, 600 + 600 ms, 1 s); the file annotates its own jitter at `:241`. *Fix:* inject a clock, or
back-date `last_refill` as `apps/cloud-server/src/rate_limit_tests.rs:25` already does.

**O-T07 · `kds_tests.rs` pastes the same 24-field `Sale` literal 14 times** —
`crates/kasirmu-core/src/db/kds_tests.rs:446-470` ✔ (4A-07). ~340 duplicated lines of source and
compile unit; the file already defines the right helper locally at `:703` (`mk_sale`) and simply
never hoisted it. *Fix:* module-level `fn test_sale(id)`.

**O-T08 · a 10,000-iteration fixture to assert two counts** —
`platform/sync/src/pg_daemon_tests.rs:573-589` ✔ (4A-08). `large_batch_enqueue_10k_items` performs
10,000 `enqueue_offline` calls, each running a subscription load plus an autocommit INSERT, to
assert a count. *Fix:* a few hundred rows, or one set-based insert.

**O-T09 · stress fixtures build 5,000 nodes + 5,000 wires, then verify with 10,000 `format!`s** —
`crates/kasirmu-bridge/src/topology/topology_stress_tests.rs:1738-1744` ✔ (4A-09). Two allocations
and two assertions per iteration to prove a ring. *Fix:* cut to ~500 and assert with `windows(2)`.

**O-T10 · `run_sweep()` reads ~224 source files, six times per run** —
`apps/desktop-tauri/src/commands/registration_gate_tests.rs:466-481` ✔ (4A-10). Each sweep walks
82 `.rs` files under `src/commands` plus 142 under `crates/kasirmu-bridge/src` and char-scans every
function body, recomputing an identical result. *Fix:* memoise in a `LazyLock<Sweep>`.

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
