# Statutory Rounding & Tax-Estimate Stamps

<!-- 2026-09-10 · DSH · E1-10 contract record · companion to sqlite-pg-roles.md; the landing chain with
     SHAs (E1-1..E1-9, F2-1..F2-8) lives in todo-global-saas-2.md's business-tax box, so this is only the rules. -->

Two owner rulings (2026-09-10) are load-bearing: **statutory rounding always wins over the store preference**,
and **a failed tax IPC warns and flags — never a silent 0**.

## 1. The directive is per rate, and it outranks the preference

`tax_rates.rounding_mode` (`crates/oz-core/migrations/20260929_tax_rate_rounding_mode.sql`) is
`TEXT NOT NULL DEFAULT '' CHECK (rounding_mode IN ('', 'half_up', 'truncate'))`. A CHECK can ride a **newly
added** column directly (SQLite only refuses to ALTER one onto an existing column): no rebuild, no backfill, no index.

- `''` = no directive, so the store preference applies, and every pre-existing row is `''`: the
  **zero-behavior-change invariant** — the whole pre-E1 tax suite still passes unmodified. `half_up`/`truncate`
  are `RoundingMode`'s serde `snake_case` names (`modules/tax/src/models.rs:17-41`, mirrored by `wire_name()`),
  so storage, wire and JSON share one spelling with no translation layer.
- Resolution lives in ONE place: `Store::effective_rounding_for_rate` (`crates/oz-core/src/db/sales_tax.rs:30`)
  = `directive.unwrap_or(preference)`, called **per rate** (`:224`), so two rates on one line each round their
  own contribution. Both compute loops take it (`compute_sale_tax_for_location`,
  `compute_cart_tax_for_location:397`), so the cart preview and the receipt cannot round differently.
- Read door: `Store::list_tax_rate_rounding_modes` (`db/tax.rs:561`, chunked at 500 ids, live rows only;
  single-id wrapper `:607`). An out-of-alphabet stored value is a **hard Validation error**, not a guess — the
  CHECK makes it hand-edited data. `''` and an unknown id both read `None` — the lookup must never become a
  second failure mode. The preference is the store KV (`crates/oz-core/src/settings.rs:258`, `:281`).
- A Lua `lua_overrides` line replaces the DB rates and so skips their directive: it rounds with the
  preference, stamps `preference` (`sales_tax.rs:210-217`) and warns per line
  (`first_statutory_directive_for_sku:48`, warn `:177`); plugin-vs-statute stays a parked owner question.

## 2. Freeze-at-write: the breakdown says what rounded, and why

Every rate contribution lands in `sale_lines.tax_breakdown_json` with `"rounding"` + `"rounding_source"` =
`statutory` | `preference` (`db/sales_tax.rs:250-257`), so a ticket states its own provenance forever and a
later edit to the rate row cannot relabel it. Pre-E1 rows carry **neither key** — read them as `preference`,
the only mode that existed (module doc `:16-20`). Pinned by `db/sales_tests.rs:4336` (statutory `truncate`
beats a `HalfUp` preference: 3335 x 1000bps = **333**, not 334), `:4364` (the preview agrees), `:4391`.

## 3. Freeze-at-write: the sale stamp is core-authored, client-claimed

`sales.tax_estimate_note` (`migrations/20260930_sales_tax_estimate_note.sql`) is NULLABLE with **no default
and no backfill**: NULL = unstamped = computed live, and an absent stamp must never read as a claim.

- Composed at insert **inside the checkout transaction** by
  `Store::complete_sale_deduction_with_locations_and_estimate` (`db/sales_checkout.rs:177`, stamp `:460-473`)
  as `{"estimated":true,"computed_tax":<i64 minor units>}`. `computed_tax` is **core's own number**; the
  caller supplies only the boolean (`db/sales_tests.rs:2866`; `:2900`: no claim leaves it NULL).
- IPC: `tax_estimated` on the scoped checkout args of both clients
  (`apps/desktop-client/src/commands/pos.rs:646`, wire `taxEstimated`;
  `apps/tablet-client/src/commands/pos.rs:902`), `unwrap_or(false)` at each delegate; the legacy wrapper
  passes `false` and stamps nothing.
- Read: `Store::sale_tax_estimate_note` (`db/sales_crud.rs:597`) — a dedicated getter, not a `Sale` field, on
  purpose: ~45 `Sale` literals across 9 files would need it. Do not promote it.
- Renderer: `ui/src/hooks/useCartTax.ts` caches the last successful `CartTaxResult` per session token, tagged
  with `cartTaxSignature` (`:46`); `cacheFresh` = tender-eligible, `invalidateCartTaxCache()` (`:57`) runs after
  every tax-config write, and stale/unknown tax **never joins the tender total** (`PosScreen.tsx:2019`).
- **Chain closed end-to-end:** `ui/src/api/sales.ts:186` carries `taxEstimated?: boolean` and the modal spreads
  it **only when the estimate is stale** (`PaymentModal.tsx:83`, sites `:723`/`:977`; derivations at
  `PosScreen.tsx:880`, `RetailPosScreen.tsx:985`). `commands/history.rs:130` serves the note as
  `taxEstimateNote` on the **detail door only** — the list stays unpopulated (no per-row N+1), so a badge may
  be read only from a detail view (`SalesHistoryScreen.tsx:62`, `:1192`). Never infer it from a list row.

## 4. Hub to branch sync: three back-compat rules

1. **Absence is the sentinel.** `SnapshotTaxRate.rounding_mode` is `#[serde(default)]` on a plain `String`
   (`platform/sync/src/transport.rs:224`): a payload written before 20260929 carries no key and lands `''`
   (`sync_pull_tests.rs:8`). The hub PG read is `Option<String>.unwrap_or_default()` (`pg_transport.rs:401`,
   `:424`), so a hub database predating its own migration keeps pulling instead of erroring.
2. **Server-authoritative, so the conflict arm assigns unconditionally.**
   `rounding_mode = excluded.rounding_mode` — deliberately NOT `COALESCE(excluded.x, tax_rates.x)` — in both
   importers, column-for-column with each other (`crates/oz-core/src/sync_pull.rs:385-403`,
   `platform/sync/src/lib.rs:342-359`). A directive REMOVED at the hub must clear at the branch; COALESCE
   would keep a dead one alive (`sync_pull_tests.rs:23`). The scope/window columns already follow that rule,
   and a scope this DB cannot honour is refused rather than flattened (`sync_pull.rs:406`).
3. **A foreign alphabet is refused, never flattened.** A row whose mode is outside the CHECK set is **skipped
   and logged** (`sync_pull.rs:414`, `:449`; test `sync_pull_tests.rs:77`) — flattening it to `''` would round
   a statutory rate with the preference. Skipping degrades to "this row says nothing new", the rest of the
   snapshot keeps importing, and the table CHECK cannot abort a pull mid-transaction.

`tax_rates` has **no push path by design** (hub-authoritative, one-way): a branch directive never lands upstream.

## 5. Authoring a directive is hub-only, and byte-exact

`crates/oz-api/src/routes/tax_rates.rs` (`POST /api/v1/tax-rates`, `PUT /api/v1/tax-rates/{id}`) is the only
surface that may name one — request field `rounding_mode` (`:73`, `:107`, `#[serde(default)]`). The device IPC
writers (`db/tax.rs::create_tax_rate*`, `update_tax_rate*`) take **no** rounding parameter: that asymmetry IS
the D8 ruling, not an omission.

- `pg::validate_tax_rate_write` (`crates/oz-api/src/pg.rs:426-444`) maps `None`/`""` to `''` and otherwise
  accepts **byte-exact** `half_up` / `truncate`; anything else is a clean 400 naming the expected set — the
  same three values as the branch CHECK, so a hub-authored mode can never carry a spelling the branch refuses
  (`HALF_UP`, `bankers`, `round_half_up` are pinned 400s in `pg_tests.rs:1785`, `routes/tax_rates_tests.rs:297+`).
- The hub's SQLite arm mirrors its own `tenant_id` post-write stamp precedent (`routes/tax_rates.rs:294-322`,
  `:414`) because core's writer has no parameter to carry the mode; `''` or omitted writes nothing. There is no
  GET route and create/update still return the seven-field `TaxRate` — §4's snapshot is the only read-back.
- On a branch a directive is **display-only for scoped rows**: the select is editable only on the tenant-global
  arm (`isGlobalRoundingArm`, `TaxConfigurationScreen:101`, disabled `:757`), `ui/src/api/tax.ts:196`, `:211`
  omit an empty `roundingMode` instead of sending `''` as a claim, and badges distinguish statutory from
  preference-valued without ever fabricating one (`:510-518`, `tax.ftl:tax-config-rounding-statutory`).

## 6. Invariants that must not regress

- **Every tax-rate writer bumps `updated_at`.** The SQLite snapshot version is the per-table
  `(COUNT, MAX(updated_at))` triple including `tax_rates` (`apps/cloud-server/src/sync_store.rs:526-537`; PG
  reads `snapshot_versions`). A writer that stopped bumping would silently stop invalidating branch pull
  caches. Pin: `tax_rate_writers_bump_updated_at_for_the_snapshot_fingerprint` (`db/tax_tests.rs:1989`).
- **Never date a migration before the LAST DDL WRITER of the touched table.** Proven live: a `20260910_`-dated
  `rounding_mode` was silently **erased** by `20260926_tax_rate_scoped_authoring.sql`, whose rebuild copies an
  enumerated column list (`INSERT INTO tax_rates_new (...)`, line 105 of that file). Registry order is
  canonical (`docs/records/sqlite-pg-roles.md`), so `20260929`/`20260930` sort after `20260926` and after the
  last `sales` DDL writer, `20260923_fiscal_numbering.sql`. The registry comments carry the standing
  obligation (`migrations.rs:243-252`, `:257-266`): **any rebuild of `tax_rates` must carry `rounding_mode`,
  and any rebuild of `sales` must carry `tax_estimate_note`, through BOTH column lists.** Pins:
  `migrations_tests.rs:2110`, `:2179`, `:595-596` (registry tail).
- **One source for the directive.** `TaxRegimeRate.rounding` (`crates/oz-core/src/regional.rs:427`) is
  supplied by the caller from the SAME `list_tax_rate_rounding_modes` door the money path uses, via
  `RegionalConfig::tax_regime((rate, scope, rounding))` (`:371`). A second copy on the resolver's candidate
  struct existed for one commit and was **deleted**: provenance and computation must not disagree.
- **Stamps are the audit trail, not the money:** never let a stamp change an amount, and never trust an
  amount because a stamp claims it. Money itself is pinned by the untouched pre-E1 suite.
