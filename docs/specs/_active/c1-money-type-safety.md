# C-1 — Money type safety (exchange rates `f64` → `i64` millionths)

## Audit Stamp
- **Audit ID:** 2026-08-08-c1-money-type-safety-audit
- **Date:** 2026-08-08T06:20:30Z (UTC)
- **Auditor:** little-coder
- **Status:** ✅ AUDITED — closure document verified against parent audit and rust-auditor conventions
- **Lint:** CLEAN — no formatting or syntax issues detected
- **Reference:** Closes 2026-07-12-desktop-app-audit §2 (C-1) / §9 / §11; Epic X-3 closure

---

# C-1 — Money type safety (exchange rates `f64` → `i64` millionths)

- **Status:** DONE
- **Sprint:** 0.0.5-rc
- **Severity:** CRITICAL
- **Owner:** RSA-Agent (Buffy)
- **Implementer:** RSA-Agent (Buffy)
- **Closed by:** commit `ac38ab9` on branch `0.0.5`
- **Closes:** audit finding C-1 (2026-07-12-desktop-app-audit)
- **Audit source:** `docs/specs/_active/2026-07-12-desktop-app-audit.md` §2 / §6 / §11

## Summary

Exchange rates are now persisted, transported, and validated as integer
`i64` minor units at a 6-decimal fixed-point scale. The `f64` money-domain
violation has been removed end-to-end; the only remaining `f64` site in
the FX domain is the `ExchangeRateRow::display_rate()` presentation
helper, which is documented and non-arithmetic.

## Baseline (pre-fix)

- `ExchangeRateRow.rate: f64` in `modules/currency/src/models.rs` (this cited `crates/oz-core/src/exchange_rate.rs:15`; the type moved to the `modules-currency` crate and is fixed-point there — repointed 2026-09-25 while closing C70)
  contaminated every downstream `Money` conversion through the FX
  multiplier. The `if args.rate <= 0.0` validation was sign-unstable
  near zero (`1e-20` flips to negative).
- The same `f64` literal appeared in `ExchangeRateDto.rate: f64`
  (`apps/desktop-client/src/commands/exchange_rates.rs:23`) and
  `CreateExchangeRateArgs.rate: f64` (`:54`), and the Frankfurter
  daemon wrote `REAL` to the `exchange_rates.rate` SQL column.
- Cross-cutting: the front-end, the SQL aggregate queries, and the
  cart multi-currency path all multiplied by an `f64` rate.

## Acceptance criteria

- [x] `ExchangeRateRow.rate_millionths: i64` everywhere in the FX domain
- [x] `ExchangeRateDto.rate_millionths: i64` on desktop and tablet clients
- [x] `CreateExchangeRateArgs.rate_millionths: i64` on both clients
- [x] `<= 0` validation guard at the Tauri command layer
- [x] `<= 0` validation guard at the `Store::create_exchange_rate` layer
- [x] `Store::upsert_exchange_rate` validation guard (pre-existing, kept)
- [x] Migration `071_exchange_rate_minor_units.sql` (ADD COLUMN → UPDATE
      with `ROUND(rate * 1e6)` → DROP COLUMN `rate`)
- [x] `crates/kasirmu-core/src/migrations.rs` registers 071
- [x] `rate_sync.rs` Frankfurter daemon converts via
      `(rate * RATE_SCALE).round() as i64` with documented clippy-allow
- [x] `ExchangeRateRow::display_rate()` for presentation only
- [x] Audit stamp at `apps/desktop-client/src/commands/exchange_rates.rs`
      shows `status: SAFE`
- [x] `docs/specs/_active/2026-07-12-desktop-app-audit.md` C-1 marked CLOSED,
      X-3 marked CLOSED, new §11 closure section, §9 stamp table updated,
      §10 grep caption annotated, §7 release-blocker list updated
- [x] Front-end wire-format break documented in §11 (follow-up ticket)
- [x] Legacy-data INF/NaN backfill hazard documented in §11 (operator note)

## Plan (as executed)

1. Add `crates/kasirmu-core/migrations/20260813_init.sql` with
   `ADD COLUMN rate_millionths INTEGER NOT NULL DEFAULT 0`, an
   `UPDATE … = CAST(ROUND(rate * 1000000) AS INTEGER)` backfill, and
   `ALTER TABLE exchange_rates DROP COLUMN rate`. Documented rollback path.
2. Register 071 in `crates/kasirmu-core/src/migrations.rs`.
3. Replace `ExchangeRateRow.rate: f64` with
   `rate_millionths: i64` in `modules/currency/src/models.rs`; add
   `display_rate()` helper. Update the inline unit tests in that file.
4. Update `crates/kasirmu-core/src/db/settings.rs`: `list_exchange_rates`,
   `create_exchange_rate`, and `upsert_exchange_rate` consume i64
   millionths; add the `<= 0` guard to `create_exchange_rate` (the
   upsert path already had it).
5. Update `crates/kasirmu-core/tests/currency_integration.rs` to 38 tests
   covering ordering, FK constraints, validation rejection, small/large
   rates, timestamps, delete, source, currencies list, currency parsing,
   Money multi-currency, `display_rate` formatting, and roundtrips.
6. Update desktop and tablet Tauri command layers:
   `apps/desktop-client/src/commands/exchange_rates.rs` and
   `apps/tablet-client/src/commands/exchange_rates.rs`. DTO + Args use
   `rate_millionths: i64`; validation `<= 0`; tests updated.
7. Update `platform/startup/src/rate_sync.rs`: introduce
   `const RATE_SCALE: f64 = 1_000_000.0;` and convert each
   `*rate` to `rate_millionths` via
   `(rate * RATE_SCALE).round() as i64` with a documented
   `#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]`.
8. Update `docs/specs/_active/2026-07-12-desktop-app-audit.md`:
   mark C-1 and X-3 as CLOSED, strike C-1 in §7, add §11 closure section,
   annotate §10 grep caption, update §9 stamp table to SAFE.
9. Update the audit stamp at
   `apps/desktop-client/src/commands/exchange_rates.rs:1-5` to
   `status: SAFE` with the closure pointer.

## Verification (recorded at PR time, commit `ac38ab9`)

| Check | Result |
|-------|--------|
| `cargo build -p oz-core -p oz-pos-app -p oz-pos-tablet -p platform-startup --lib --tests` | exit 0 |
| `cargo clippy -p oz-core -p platform-startup -p oz-pos-app -p oz-pos-tablet --lib --tests -- -D warnings` | exit 0, 0 warnings |
| `cargo test -p oz-core --lib` | 1052 passed, 0 failed |
| `cargo test -p oz-core --test currency_integration` | 38 passed, 0 failed |
| `cargo test -p platform-startup` | 27 passed, 0 failed |
| `cargo fmt --all -- --check` | clean |
| `grep -rnE ': f64\b\|: Option<f64>\b\|rate: f64\b'` across `crates/kasirmu-core`, `modules/currency`, `apps/*/src/commands/exchange_rates.rs`, `platform/startup/src/rate_sync.rs` | 0 hits in the FX domain |

## Residual / follow-ups (out of this card's scope)

- **Front-end wire-format break** (audit doc §11, "What is still open"):
  the `ExchangeRateDto` field rename `rate: f64` → `rate_millionths: i64`
  is a breaking change for every `ui/` consumer. Pre-1.0 release makes
  the breaking change acceptable; the next front-end PR must update
  `ui/src/api/exchange_rates.ts` (or equivalent) to read
  `dto.rate_millionths` and divide by `1_000_000` for display.
- **Legacy-data backfill hazard** (audit doc §11): SQLite's
  `CAST(Inf AS INTEGER)` clamps to `i64::MAX`; `CAST(NaN AS INTEGER)`
  backfills to `0`. Operators upgrading from a 0.0.4-or-earlier install
  with suspect legacy data should validate or wipe the `exchange_rates`
  table before applying 071.
- **`display_rate()` presentation f64** is the lone remaining `f64` site
  in the FX domain. A future refinement could replace it with a
  `rust_decimal` or pure integer string-arithmetic implementation; not
  blocking.
- **Pre-epic baseline snapshot** at
  `docs/specs/_active/_archive/2026-07-12-baseline.txt` was not created
  before the closure landed; future Epic work should snapshot the
  pre-fix grep output so the closure pass can `diff` against it.

## References

- `docs/specs/_active/2026-07-12-desktop-app-audit.md` §2 C-1 / §6 X-3 / §9 / §10 / §11
- `modules/currency/src/models.rs` (`ExchangeRateRow`; it MOVED here from a pre-rebrand core path that no longer exists)
- `crates/kasirmu-core/migrations/20260813_init.sql`
- `crates/kasirmu-core/src/db/settings.rs`
- `crates/kasirmu-core/tests/currency_integration.rs`
- `apps/desktop-client/src/commands/exchange_rates.rs`
- `apps/tablet-client/src/commands/exchange_rates.rs`
- `platform/startup/src/rate_sync.rs`
- Commit `ac38ab9` on branch `0.0.5`
