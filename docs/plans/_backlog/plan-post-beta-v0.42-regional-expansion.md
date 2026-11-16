# Plan: Post-Beta v0.0.42 Regional Expansion & Multi-Currency Engine

<!-- Status: ACTIVE PLAN · Target Milestone: v0.0.42 (Post-Beta Regional Expansion) -->
<!-- Created: 2026-11-16 · Recorded against: branch 0.0.41 -->
<!-- Governing ADRs: ADR-59 (Regional Topology & Modular Delivery), ADR-64 (Tender Vocabulary & Offline Tender State) -->
<!-- Strategy: docs/decisions/2026-10-02-global-kernel-and-region-pack-strategy.md -->

**Acceptance Command:** `cargo check -p kasirmu-core -p kasirmu-bridge && python scripts/verify-architecture-boundaries.py --strict`

---

## 1. Executive Summary

Following successful Beta trials and pilot merchant graduation on `0.0.41`, this plan establishes the sequenced architecture for **kasir.mu v0.0.42**. The milestone transitions the system from the Indonesian retail/F&B foundation to a localized Southeast Asian multi-currency operating platform while preserving core offline-first invariants (`Money` integer minor units, SQLite transactions, monotonic vector clock sync, and zero cross-tenant leakage).

---

## 2. Platform Architecture & Modular Expansion

```
crates/kasirmu-core/src/regional.rs
  ├── RegionalConfig (Location → Legal Entity → Tenant Global fallback)
  ├── TaxRegime (PPN, PB1, GST, VAT)
  └── CurrencyRegistry (IDR, SGD, MYR, THB, PHP, VND minor units)
```

### Invariants Preserved
1. **Integer Minor Units:** All monetary calculations maintain `i64` minor units. Zero floating point.
2. **Offline Durability:** Transactions queue to SQLite local WAL before cloud sync.
3. **Tenant Boundary:** Regional tax tables and tender configurations strictly isolate by `tenant_id`.

---

## 3. Sequenced Expansion Phases

### Phase 1: Regional Payment Rails Integration (Tender Vocabulary)
- [ ] Implement PayNow & SGQR (`SGD`, 2 decimal minor units) in `crates/kasirmu-core/src/db/payment_methods.rs`.
- [ ] Implement DuitNow QR (`MYR`, 2 decimal minor units) in `crates/kasirmu-core/src/db/payment_methods.rs`.
- [ ] Implement PromptPay (`THB`, 2 decimal minor units) in `crates/kasirmu-core/src/db/payment_methods.rs`.
- [ ] Implement QR Ph (`PHP`, 2 decimal minor units) and VietQR (`VND`, 0 decimal minor units).
- [ ] Wire offline payment outbox and settlement state transitions under ADR-64.

### Phase 2: Regional Tax Presets & Country Profiles
- [ ] Expand `RegionalConfig` in `crates/kasirmu-core/src/regional.rs` to support country tax preset tables:
  - Singapore: GST 9%
  - Malaysia: SST 6% / 8%
  - Thailand: VAT 7%
  - Philippines: VAT 12%
  - Vietnam: VAT 8% / 10%
- [ ] Verify tax resolution hierarchy: Product-specific rate $\to$ Category-specific rate $\to$ Location override $\to$ Tenant global default.

### Phase 3: Hardware Peripheral Code Pages & Thermal Printing
- [ ] Add ESC/POS code page switching for regional alphabets (Latin, Thai, Vietnamese) in `crates/kasirmu-hal/src/drivers/escpos.rs`.
- [ ] Validate 58mm and 80mm receipt formatting with localized currency symbols and date formats.

### Phase 4: Architecture Boundary & Contract Verification
- [ ] Verify 0 boundary violations across Cargo dependency graph (`verify-architecture-boundaries.py --strict`).
- [ ] Verify query plans for regional lookup queries (`check-query-plans.py --check`).
- [ ] Ensure 100% checker contract coverage (`census-checker-contracts.py`).

---

## 4. Verification & Acceptance Sign-off

```bash
cargo check -p kasirmu-core -p kasirmu-bridge
python scripts/verify-architecture-boundaries.py --strict
python scripts/check-query-plans.py --check
python scripts/census-checker-contracts.py
```
