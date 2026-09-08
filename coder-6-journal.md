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

* **Client call sites (next commit, deliberately not here):** desktop
  `commands/pos.rs` ×5 and tablet ×6 must switch to `*_for_location` and pass
  `session.store_id`. No new IPC command, no DTO change, no UI surface — the
  location is already in scope at every site. Tablet's legacy `complete_sale`
  (no session, writes `store_id: None`) stays on the unscoped door, which is the
  honest answer: no location known, tenant-global rate.
* DB-level one-or-the-other scope guard (+ its `TRIGGER_MAP` plpgsql port).
* Write-side IPC — blocked on the hot `ui/src/dev-mock/tauri-api.ts` — and it
  must satisfy the `updated_at` / `snapshot_version` cache constraint from
  `d38cb0bcb`.
* `todo-global-saas-2.md` read, not written; the tax box at line 180 stays `[ ]`.
