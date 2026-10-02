# Plan: Global Scale and Regional Market Adapters (Backlog Roadmap)

**Status:** Backlog  
**Date:** 2026-10-02  
**Recorded against:** branch `0.0.41`  
**Governing ADRs:** [ADR-59 (Regional Topology & Modular Delivery)](../../decisions/2026-09-21-adr59-regional-topology-and-modular-delivery.md), [ADR-64 (Tender Vocabulary & Offline Tender State)](../../decisions/2026-10-02-adr64-tender-vocabulary-and-offline-tender-state.md)  
**Strategy Reference:** [`docs/decisions/2026-10-02-global-kernel-and-region-pack-strategy.md`](../../decisions/2026-10-02-global-kernel-and-region-pack-strategy.md)  

---

## 1. Executive Summary

This roadmap outlines the sequenced expansion of `kasir.mu` from its Indonesian retail foundation to a multi-region, offline-first global operating system. In accordance with **ADR-59 §1.6 and §2.3**, country profiles are represented as **compiled relational data rows and localized Fluent assets**, while physical data sovereignty is managed through **isolated regional data plane deployments** (Jakarta, Frankfurt, São Paulo, Mumbai, etc.).

---

## 2. Expansion Phases

### Phase 1: Indonesia Market Hardening (Current Foundation)
* **Status:** In Progress / Maturing
* **Scope:**
  - Full QRIS lifecycle: static QR cash-reconciliation, dynamic QR generation & webhook settlement.
  - PB1 local restaurant tax & standard PPN calculation (nearest-integer rounding).
  - Localization: `id-ID` Fluent translation (`shared-ui/locales/shared.id.ftl`), Indonesian Rupiah (`IDR`) integer minor units.
  - Offline receipt printing via ESC/POS driver (`crates/kasirmu-hal`).
  - Host data residency: Jakarta (`ap-southeast-1`).

### Phase 2: Southeast Asia Regional Expansion (Backlog)
* **Prerequisite:** Completion of Indonesia enterprise hardening + partner PSP agreement.
* **Scope:**
  - Local QR rails integration via regional aggregators (Xendit, Midtrans, Stripe):
    - Singapore: PayNow / SGQR (`SGD`)
    - Malaysia: DuitNow QR (`MYR`)
    - Thailand: PromptPay / Thai QR (`THB`)
    - Philippines: QR Ph / GCash / Maya (`PHP`)
    - Vietnam: VietQR (`VND`)
  - Multi-currency display and regional tax presets in `crates/kasirmu-core/src/regional.rs`.

### Phase 3: Major Emerging Markets (India & Brazil) (Backlog)
* **Prerequisite:** Commercial market sponsor & certified local legal counsel.
* **Scope:**
  - **India**:
    - UPI dynamic rail integration & RuPay terminal bindings.
    - GST tax tier classification & e-way bill / e-invoicing export hooks.
    - Localization in Hindi (`hi-IN`) and regional scripts.
  - **Brazil**:
    - PIX dynamic rail & local card acquirer (Stone/Cielo) bindings.
    - Fiscal document architecture: NFC-e, SAT, and municipal tax engines.
    - LGPD compliance export & deletion audit workflows.

### Phase 4: US / EU / Global Platform (Backlog)
* **Prerequisite:** Dedicated legal/compliance team and certified security audits.
* **Scope:**
  - Sovereign cloud deployments in Frankfurt (`eu-central-1`) and US East (`us-east-1`).
  - PSD2 / SCA compliance redirect flows for European card payments.
  - GDPR right-to-be-forgotten cryptographic shredding & tenant data export pipelines.
  - Complex state/city sales tax calculation engine adapters.

---

## 3. Engineering & Governance Invariants

1. **No Speculative Modules (ADR-59 §Q3):** Never write concrete fiscal signing or e-invoicing code for an uncommitted country. Build adapters only when a verified customer contract exists.
2. **Software-Only & Non-Custodial (ADR-64 D6):** Never hold customer funds, process unencrypted raw card data (PAN/CVV), or act as a financial intermediary. Rely on regulated PSPs and certified SoftPOS hardware partners.
3. **Data Residency (ADR-59 Q1):** Transactional data must remain within the merchant's home sovereignty zone. Global control planes manage identity, subscription licensing, and feature flags only.
