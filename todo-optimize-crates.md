# Optimize our own crates — census (round 1)

**Status:** OPEN — census round complete (§1–§6); scale-review journal appended 2026-09-25 (§7). No code touched, no axis chosen.
**Date:** 2026-09-25 · **Branch:** `0.0.40` · **Recorded against:** HEAD at time of measurement.

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
`crates/kasirmu-bridge/src/ctx.rs:412-413` ◦. Parks a runtime worker for the duration of
another task's DB work — the exact contention `audit.rs:257-268` documents as an abort risk.
*Fix:* `lock().await` or move the lookup into the awaited path.

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

**O-M34 · platform/sync — ~3 full JSON serialisations of the backlog per cycle** —
`platform/sync/src/lib.rs:157-177` ◦. Clone for sort, serialise to measure, clone into batch,
re-serialise per batch. *Fix:* estimate from `payload.len()`; batch references; reuse bytes.

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
- **No crate code has been changed.** This section is the journal-first record the pass was
  asked for; fixes are unfunded until entries are picked from it.
