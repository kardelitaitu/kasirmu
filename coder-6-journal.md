# Coder-6 Journal

> **Stream:** finisher-C — tax-separation P1 and the sync-chain work that follows
> from it. Opened 2026-09-08 by supervisor ruling: `coder-5-journal.md` is the
> recovered **finisher-A** stream (D2 grant authoring + L319), `coder-6-journal.md`
> is mine. Nothing was moved out of coder-5; the back-reference is here instead.
>
> **Back-reference — my earlier entries live in `coder-5-journal.md`** and were
> written before the split:
> - `cf935edb` / `dbb3aabe` — tax-separation P1 slice 1 (schema + scoped
>   resolver): the `TaxRateScope` ruling, why no DB trigger, why `TaxRate` was
>   not extended, exclusive `effective_to`, the untrusted-row vs malformed-date
>   split, and the sync hazard this stream then closed.
> - `4c41f5c3a` — the sync-pull column repair (six drop sites), plus the
>   ratified refuse-not-flatten deviation and the `snapshot_version` cache
>   fingerprint constraint (`d38cb0bcb`).
> Read those two sections before this one; they carry the design calls that this
> slice implements against.

---

## 2026-09-08 — finisher-C: the scoped resolver reaches MONEY (sale-path rewire)

The previous slices made a scoped rate *storable* and *syncable*. This one makes
it **price a sale**. Until now `resolve_tax_rate_for_location` had exactly one
caller — a test — so the entire scoping feature was inert: every receipt was
still computed from the single `is_default` row.

### Commit

| sha | subject | files |
|---|---|---|
| *(this commit)* | `feat(core): price sales by legal entity, location and business date` | tax.rs, sales_tax.rs, lib.rs, sales_tests.rs + this journal |

### Two doors, and why that is not the drift it looks like

`compute_sale_tax` / `compute_cart_tax` / `resolve_best_tax_rates_for_sku` keep
their exact signatures as **unscoped wrappers** that delegate with `None`. The
scoped entry points are separately named:
`compute_sale_tax_for_location`, `compute_cart_tax_for_location`,
`resolve_best_tax_rates_for_sku_at`.

A defaulted or `Option` argument would have made "forgot the scope" invisible in
a diff; a distinct name makes every call site state which door it uses. It also
kept 30+ existing money tests compiling untouched — and that is not merely
convenience, it is the equivalence proof: the unscoped path IS the old code with
`scope = None`, so `a_legacy_tenant_prices_identically_through_either_door`
cannot pass for the wrong reason.

### `TaxSaleScope`: both fields required, and the date is NOT mine to choose

`TaxSaleScope { location_id, as_of }`. No optional date: an optional `as_of`
silently degrades every scoped row to "as if today", and "today" is the exact
value the table windows on. A caller that does not know its location or business
date passes `None` for the whole scope and gets the tenant-global answer, not a
guessed one.

**Who owns `as_of` is recorded as open, not solved.** `sale.created_at` is a UTC
RFC3339 stamp and `locations.timezone` is written as an IANA name but read as a
fixed offset — regional open question 1 in `todo-global-saas-2.md`. Converting
inside core would invent a timezone policy in the middle of money math, so the
caller supplies the date. A sale rung up at 20:00 UTC on 31 December in Jakarta
is 03:00 on 1 January locally, and only the caller knows which one it means.
Ratified by the supervisor as a deferral, not an answer.

### What scoping actually changes in the chain

`resolve_best_tax_rates_for_sku_at` changes exactly two things:

* **levels 1 and 2** (product- and category-assigned rates) drop any assigned
  rate whose own scope or validity window does not cover this sale. An
  assignment is an instruction to USE a rate, not a licence to ignore where that
  rate says it applies — a product pinned to a Bali-only rate falls through in
  Jakarta rather than paying Bali tax, and a rate whose period has ended prices
  nothing. Falling through is the existing behaviour when an assignment list is
  empty, so no new control flow was needed.
* **level 3** asks the scoped walk (location → entity → tenant-global) instead
  of the single `is_default` row.

`window_covers` was extracted from `TaxRateCandidate::is_live` so the exclusive
`effective_to` rule is stated ONCE and shared by the walk and the new
applicability filter — two readers, one rule. `location_legal_entity` derives the
entity from the location row rather than trusting the request, so a caller cannot
claim an entity its branch does not have.

### One error vocabulary

`TaxSaleScope::as_date` originally raised `field: "tax_scope.as_of"` for a bad
date while `resolve_tax_rate_for_location` raised `field: "as_of"` for the same
mistake. A test caught the divergence; both now raise `"as_of"`, matching the
name already pinned in `coder-5-journal.md`.

### Gates

| gate | result |
|---|---|
| `cargo check -p oz-core --lib` / `--all-targets` | exit 0, zero warnings |
| `cargo test -p oz-core --lib` | see table below |
| `cargo test -p oz-core --lib tax` | 99 passed / 0 failed |
| `cargo test -p oz-core --lib compute_tax` | 14 passed / 0 failed |
| `cargo fmt --all --check` | clean |

7 new tests, all in `db::sales::tests` (they need `make_single_line_sale` /
`seed_product`, which live there): legacy equivalence across both doors, a
location rate that stops inheriting the default at that location only, the
exclusive boundary day, per-scope `is_inclusive` reaching the grand total, a
product-assigned rate scoped elsewhere falling through, an expired assigned rate
falling through, and a malformed business date erroring rather than pricing.

### Tree-repair note (this was the critical path for ~20 minutes)

Two of my edits broke the whole workspace and blocked finisher-B: a ```
placeholder leaked a backtick into a `format!` string, and Rust rejects field
access in format strings anyway (`{self.as_of:?}`), so the fix was a local
binding. A third report — 32 broken `sales_tests.rs` call sites — was my briefly
4-arg `compute_sale_tax`; the wrapper design above removed that churn entirely.
`sales_tax.rs` is a submodule of `db::sales`, not `db`, so `super::tax` does not
resolve there — use `crate::db::tax::…`.

### Still owed

* ~~Client call sites~~ — DONE, see the next section. Landed as its own commit
  after the core one, per the supervisor's checkpoint ruling.
* DB-level one-or-the-other scope guard (+ its `TRIGGER_MAP` plpgsql port).
* Write-side IPC — blocked on the hot `ui/src/dev-mock/tauri-api.ts` — and it
  must satisfy the `updated_at` / `snapshot_version` cache constraint from
  `d38cb0bcb`.
* `todo-global-saas-2.md` read, not written; the tax box at line 180 stays `[ ]`.

---

## 2026-09-08 — finisher-C: the clients pass a location (command-layer wiring)

The core slice made the scoped door exist; this one walks through it. Every
`*_scoped` POS command now resolves tax for the branch the cashier is signed
into.

### Commit

| sha | subject | files |
|---|---|---|
| *(this commit)* | `feat(pos): price sales at the signed-in location` | desktop + tablet `commands/pos.rs`, both `pos_tests.rs` |

### What was actually wired — 9 of 11 sites, and why two are not

| client | site | scope |
|---|---|---|
| desktop | `pos.rs` ×4 checkout/preview paths | `Some(&tax_scope_now(&session.store_id))` |
| desktop | `compute_cart_tax_scoped` | same |
| tablet | `preview_promoted_total_scoped`, `…_from_lines_scoped`, `complete_sale_scoped`, `compute_cart_tax_scoped`, `complete_sale_with_resolved_shortfalls_scoped` | same |
| tablet | legacy `complete_sale` | **stays unscoped** |
| core | `resolve_best_tax_rates_for_sku_at` | reached only through the two compute fns |

Tablet's legacy `complete_sale` takes no session token and publishes
`SaleCompleted { store_id: None }`, so there is genuinely no location to resolve
against. It keeps calling `compute_sale_tax` — the unscoped door — with a comment
saying so. Inventing a location there (the primary row, the first row, the
tenant default's own scope) would price a receipt from a branch nobody chose,
which is the failure this whole slice exists to prevent. "No location known,
tenant-global rate" is the honest answer, and it is also exactly what that path
does today, so wiring it to `None` changes nothing about it.

### `tax_scope_now`: the date is UTC and that is a recorded compromise

Both clients got an identical private helper rather than a shared one, because
the only shared home would be a new `platform/*` export for a two-line function —
and because the two files already duplicate their cart/sale plumbing. The
duplication is deliberate and each copy points at the other.

`as_of` is `Utc::now().format("%Y-%m-%d")`. That is NOT the business date a
Jakarta branch means at 20:00 UTC on 31 December; it is the date
`sale.created_at` already records, chosen so a cart preview and its checkout
receipt resolve on the same side of an exclusive `effective_to` instead of
straddling it differently. The correct owner of that value is the regional
slice's open question 1 (`locations.timezone` written as IANA, read as a fixed
offset), and converting it here would have invented a timezone policy inside
money math. Ratified as a deferral.

### Command-layer tests, and the honest limit of them

Two per client (4 new): `tax_scope_now` passes the store id through and yields a
date the core resolver parses; and a location-scoped rate beats the tenant
default **through the exact call shape the command uses** — `tax_scope_now` +
`compute_sale_tax_for_location` + `Settings::get_tax_rounding_mode` — while the
neighbouring branch keeps the default. That test also asserts what the unscoped
door would have returned, so the number a dropped argument would silently
produce is written down.

What it does NOT do is catch someone reverting a call site back to
`compute_sale_tax`: the test calls the function directly, not through the Tauri
command. A real guard needs a command harness with a live session, cart and
stock — tablet has `tauri::test::mock_builder()` for the auth-rejection path and
nothing beyond it. The actual protection there is structural: the unscoped door
has a different NAME, so a stale call site is visible in a diff instead of being
a silent behaviour change. Recorded rather than oversold.

### Gates

| gate | result |
|---|---|
| `cargo test -p oz-pos-app --lib` | **1329 passed / 0 failed** in 238.41s |
| `cargo test -p oz-pos-tablet --lib` | **538 passed / 0 failed** in 44.38s |
| the 4 new tests by name | desktop 1+1 passed, tablet 1+1 passed |
| `RUSTFLAGS=-D warnings cargo check -p oz-pos-app -p oz-pos-tablet --all-targets` | **exit 0**, zero warnings |
| `cargo fmt --all --check` | clean |

### Third occurrence of the same self-inflicted break, recorded so it stops

A `@`-as-backtick placeholder scheme I use to keep template literals parseable
leaked into committed Rust for the third time — here as
`panic!("... got {`?`}: {e}")`, which is an invalid format string and again made
`cargo fmt --all` unparseable, blocking every other agent's commit. The first
was `transport.rs`, the second `tax.rs:744`, this is the third. The failure is
not the leak alone but that a format string is the one place a stray backtick
turns into a whole-workspace build error rather than a wrong comment.

Standing rule for this stream going forward: **never put `@` inside a
`format!`/`panic!`/`println!` literal.** Write those strings with the edit
tool directly, or use `{x:?}` with no placeholder at all. And after any edit that
touches a format string, run `cargo fmt --all --check` before walking away — it
is two seconds and it is the only gate that catches this class before someone
else's commit does.

### Remaining on the tax box — all write-side

Write-side IPC (+ the hot `ui/src/dev-mock/tauri-api.ts` it is blocked on), the
DB-level one-or-the-other scope guard with its `TRIGGER_MAP` plpgsql port, and
the `updated_at` / `snapshot_version` cache constraint from `d38cb0bcb` as a
success criterion on that IPC writer. Reporting back for reassignment: the
read side is done end to end, hub to receipt.
### 2026-09-09 — docs/decisions ADR #48: timezone representation & as_of semantics (finisher-E)

Wrote `docs/decisions/2026-09-09-timezone-representation.md` (130 lines, house ADR
style) settling the three regional-configuration open questions. Grounded in the
tree, no web research (stripped task):

- DECISION 1 - stored format = IANA zone name string (not fixed offset).
  Schema is already IANA-shaped: `crates/oz-core/src/location_profile.rs:31`
  documents `timezone: String` as IANA, `crates/oz-core/migrations/20260813_init.sql:803`
  is `timezone TEXT NOT NULL DEFAULT 'UTC'`. Indonesia has NO DST (last offset
  change 1964); IANA absorbs future political changes via tzdata, no row migration.
  Fixed offsets remain a display-only concern (orthogonal).
- DECISION 2 - slice-4 editor = bounded preset list of the 3 Indonesian IANA
  zones (Asia/Jakarta, Asia/Makassar, Asia/Jayapura); no free offset field, no
  search. Enforce at the regional write boundary (still open: write path,
  todo-global-saas-2.md; location row is full-overwrite per
  `crates/oz-core/src/db/regional.rs:6-7`).
- DECISION 3 - as_of = business date (YYYY-MM-DD) in the location's IANA zone,
  converted from a `Utc::now()` instant. Contract already expects a business date:
  `crates/oz-core/src/db/tax.rs:476`, parse at :491-493, exclusive `effective_to`
  at :771 / `is_live` :819-828.

CORRECTION of the brief's "9 sites": only 4 production sites construct the
`Utc::now()` placeholder (verified by grep):
  1. apps/desktop-client/src/commands/pos.rs:44
  2. apps/tablet-client/src/commands/pos.rs:42
  3. apps/desktop-client/src/commands/exchange_rates.rs:238
  4. apps/tablet-client/src/commands/exchange_rates.rs:274
The rest of the `as_of` hits are resolver signatures/consumers
(`tax.rs:485,728,731-745,760,824`; `sales_tax.rs:450`), not placeholders.

Gate: `cargo check -p oz-core --lib` green (Finished dev profile, 0.35s). Commit
is docs-only (doc + this journal) with explicit pathspec.

