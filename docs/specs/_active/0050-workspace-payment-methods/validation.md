# Validation

## Focused checks

```bash
cargo check -p kasirmu-core
cargo test -p kasirmu-core --lib payment_method
cargo test -p kasirmu-core --lib piutang
cargo test -p kasirmu-core --lib -- checkout_refuses_a_tender an_unconfigured_site
cargo test -p kasirmu-core --lib -- checkout_refuses_dynamic_qris a_free_tier_store
cargo clippy -p kasirmu-core --all-targets -- -D warnings
python3 scripts/generate-pg-migration.py --check
```

## Acceptance criteria

- A site with no rail surface refuses nothing, and a sale completes.
- A rail the site does not list is refused with `NotOffered`, naming the rail.
- A rail the site disabled is refused with `Withheld`, naming the rail.
- An ENABLED rail is admitted; the match ignores case and surrounding space.
- `qris` on a Free tier is refused with a message naming the TIER, and the same
  sale on Plus completes (the control).
- `qris_manual` is admitted on a Free tier — it is not a dynamic method.
- A day whose only takings were receivable repayments reports nothing on
  `payment_method_breakdown` and the full amount on `piutang_collections`.
- `piutang_collections` splits by tender AND currency, and excludes payments
  whose `paid_at` falls outside the range.
- A malformed date bound is refused with `field: "start_date"` (REP-03).

## Measured 2026-10-25

```
cargo test -p kasirmu-core --lib   -> 3697 passed; 0 failed
cargo clippy -p kasirmu-core --all-targets -- -D warnings -> clean
python3 scripts/generate-pg-migration.py --check -> 0
```

## Not covered

The acquirer's response. Every check above grades the local side of the contract;
Midtrans's own behaviour against a sandbox key is the open item recorded in
`docs/plans/_active/owner-question-2026-09-28-r4-r6-r7.md`.

> last audited 11-10-26 by docs-auditor
