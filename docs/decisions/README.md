# Architectural Decision Records

Every significant architectural decision in the POS framework is recorded as
an ADR in this directory (`docs/decisions/`). Each ADR follows the
"Context — Decision — Consequences" template and carries a `Status:` line in
its header. Some ADRs have a companion `*.status.md` file with a fuller
implementation-status walkthrough.

- Numbered ADRs (#1–#46) are the primary record.
- Research notes and phased implementation docs (topology phases, sync
  phases) are recorded here too, keyed by date rather than number.

## Numbered ADRs

| # | Title | Status |
|---|-------|--------|
| 1 | [Module System Design](./2026-01-15-module-system-design.md) | — |
| 2 | [Event Bus Design](./2026-02-01-event-bus-design.md) | — |
| 3 | [Frontend Restructure](./2026-03-01-frontend-restructure.md) | — |
| 4 | [Store-First Tenancy & Workspace Type/Instance Architecture](./2026-07-10-workspace-type-instance-design.md) | — |
| 5 | [Subscription Tier & Entitlement Architecture](./archived/2026-07-10-subscription-tier-entitlement.md) | — |
| 6 | [CRDT Delta Ledger & Offline Sync](./2026-07-10-crdt-delta-ledger-offline-sync.md) | — |
| 7 | [Data Scope Guard & Query Enforcement](./2026-07-10-data-scope-guard.md) | — |
| 8 | [Scoped Real-Time Event Bus](./2026-07-10-scoped-event-bus.md) | — |
| 9 | [License Server Architecture (PocketBase on Northflank)](./2026-07-10-license-server.md) | — |
| 10 | [Sync Performance Strategy](./2026-07-13-sync-performance-compression-batching.md) | — |
| 11 | [Zero-Downtime VPS Migration Strategy](./2026-07-13-zero-downtime-vps-migration.md) | — |
| 12 | [Whitelabel Branding System](./2026-07-15-whitelabel-branding-system.md) | — |
| 13 | [Desktop App Updater](./2026-07-16-desktop-app-updater.md) | — |
| 14 | [Release Automation](./2026-07-16-release-automation.md) | — |
| 15 | [Shadow Banding Mitigation — CSS Noise Dithering](./2026-07-18-shadow-banding-css-dither.md) | — |
| 17 | [KDS Multi-Layout System](./2026-07-18-kds-multi-layout-system.md) | — |
| 18 | [Multi-Location Inventory](./2026-07-18-multi-location-inventory.md) | — |
| 19 | [Sale-Deduction Flow for Multi-Location Inventory](./2026-07-19-sale-deduction-multi-location.md) | Implemented (see [status](./2026-07-19-sale-deduction-multi-location.status.md)) |
| 20 | [Payment-Capture Ordering — Stock Reservation Before Payment Capture](./2026-07-19-payment-capture-ordering.md) | Implemented (see [status](./2026-07-19-payment-capture-ordering.status.md)) |
| 21 | [Sync Conflict Resolution Strategy](./2026-07-20-sync-conflict-resolution-strategy.md) | — |
| 22 | [Visual Node-Based Store & Workspace Topology Builder](./2026-07-20-node-based-store-topology-builder.md) | — |
| 23 | [Free Trial Lifecycle & License Activation Workflow](./archived/2026-07-20-free-trial-lifecycle-and-license-activation-workflow.md) | — |
| 30 | [Domain Module Extraction & oz-core Decomposition](./2026-07-24-domain-module-extraction.md) | — |
| 43 | [React-only UI Decision](./2026-07-24-react-only-decision.md) | — |
| 31 | [Decentralized UI Feature Module Registration](./2026-07-24-decentralized-ui-module-registration.md) | — |
| 32 | [DB Layer Extraction (R2) & Platform File Split (R5)](./2026-07-25-db-extraction-and-platform-split.md) | — |
| 33 | [Panic Policy & Production unwrap/expect Enforcement](./2026-08-03-panic-policy.md) | — |
| 34 | [Topology Editor as the Business Logic Builder](./2026-08-07-business-logic-topology-builder.md) | — |
| 44 | [Typed Connection Gating & Live Validation (Implementation)](./2026-08-08-adr34-typed-connection-gating.md) | Implemented (2026-08-08) |
| 35 | [RBAC — Role Assignments with Branch/Workspace Scopes and User Profile Data](./2026-08-11-adr35-rbac-role-assignments-user-profile.md) | Accepted (ratified 2026-08-11) |
| 36 | [Retail POS Product Attributes — Cost, Brand, Rack, Notes + Configurable Columns](./2026-08-11-adr36-retail-product-attributes.md) | Implemented (2026-08-12) |
| 37 | [Product Popularity Index — Weighted Activity Score for Retail Sorting](./2026-08-11-adr37-product-popularity-index.md) | Implemented (2026-08-12) |
| 38 | [Retail POS Row Context Menu — View Product Images in Browser](./2026-08-11-adr38-retail-row-context-menu-browser-images.md) | Implemented (2026-08-12) |
| 39 | [Midtrans QRIS Subscription Payments (Phase 2)](./2026-08-18-adr39-midtrans-subscription-payments.md) | Approved — see TODO.md C3.1 |
| 40 | [Multi-Terminal Peer Model](./2026-08-20-adr40-multi-terminal-peer-model.md) | Implemented (2026-08-20) |
| 41 | [App Lifecycle, Device Onboarding, Dynamic Topology Workspaces, and Two-Layer Gated Home (Tier & RBAC)](./2026-08-28-adr41-app-lifecycle-device-onboarding-topology-home-gating.md) | Accepted (2026-08-28) |
| 42 | [Website Admin Dashboard & User Dashboard (Subdomain Architecture)](./2026-08-28-adr42-website-admin-and-user-dashboard.md) | Partially Implemented (2026-08-28) |
| 43 | [Cloud Sync Performance & Scale-Out Roadmap](./2026-09-02-adr43-cloud-sync-performance-scaleout-roadmap.md) | Implemented (D1–D4, D7, D9-ready) |
| 45 | [Topology Semantic Contract v2 — Endpoint Predicates, Kind Registry, Deliberate Cold Start, and Theme Parity](./2026-09-02-adr45-topology-semantic-contract-v2.md) | §1–§3, §4.1, §5, §4.2 backend + storage + migration fn (not yet invoked), §4.3 ordering rule Implemented (2026-09-02) · §4.2 UI swap, §4.3 checklist UI Proposed |
| 46 | [Topology Revision History, Change Notes, and Draft Restore](./2026-09-07-adr46-topology-revision-history-and-restore.md) | Accepted (2026-09-07) — Phase 1 next, per its Solo Implementation Protocol |

## Research notes

- [On-Device ML for Demand Forecasting](./2026-07-20-ai-demand-forecasting-research.md)
- [Cloud Warehouse Analytics Export](./2026-07-20-cloud-warehouse-analytics-research.md)
- [CRDT-Based Conflict-Free Replication](./2026-07-20-crdt-sync-research.md)
- [Voice-Controlled Checkout Research](./2026-07-20-voice-controlled-checkout-research.md)

## Phased implementation docs

- **Sync:** [Phase 1 diagnostics](./2026-08-09-local-sync-phase1-diagnostics.md),
  [Phase 2 startup](./2026-08-09-local-sync-phase2-startup.md),
  [Phase 3 Tauri diagnostics](./2026-08-09-local-sync-phase3-tauri-diagnostics.md),
  [Phase 4 verification](./2026-08-09-local-sync-phase4-verification.md),
  [isolated E2E harness](./2026-08-09-local-sync-isolated-e2e-harness.md),
  [status/retry](./2026-08-09-local-sync-status-retry.md),
  [auth hardening](./2026-08-09-sync-auth-hardening.md),
  [plan gating](./2026-08-09-sync-plan-gating.md)
- **Topology:** [Phase 1 branch persistence](./2026-08-09-topology-phase1-branch-persistence.md),
  [Phase 2 KDS source parity](./2026-08-09-topology-phase2-kds-source-parity.md),
  [Phase 3 semantic wire parity](./2026-08-09-topology-phase3-semantic-wire-parity.md),
  [Phase 4 runtime compiler](./2026-08-09-topology-phase4-runtime-compiler.md),
  [Phase 5 cycle validation](./2026-08-09-topology-phase5-cycle-validation.md),
  [Phase 6 legacy wire hardening](./2026-08-09-topology-phase6-legacy-wire-hardening.md),
  [Phase 7 KDS runtime consumer](./2026-08-09-topology-phase7-kds-runtime-consumer.md),
  [Phase 8 KDS fan-out](./2026-08-09-topology-phase8-kds-fanout.md),
  [Phase 9 stock routing](./2026-08-09-topology-phase9-stock-routing.md),
  [Phase 10 multi-warehouse allocation](./2026-08-09-topology-phase10-multi-warehouse-allocation.md)

## Trial & Billing Path — Cross-Reference

The trial lifecycle, license activation, and payment webhooks span four ADRs.
This table summarizes each ADR's implementation status and deviations from
the original design, so a reader can trace the shipped behavior back to the
authoritative record.

| ADR | Title | Status | Deviations from Original Design |
|-----|-------|--------|--------------------------------|
| [#5](./archived/2026-07-10-subscription-tier-entitlement.md) | Subscription Tier & Entitlement Architecture | Superseded for tier lineup/quotas by `subscription-tiers.md`; mechanism still valid | Tier lineup updated to Free · Plus · Pro · Premium · Enterprise (ADR #5 had Free / Pro / Premium / Enterprise). Quota values migrated in `subscription.rs` (C0.1). |
| [#9](./2026-07-10-license-server.md) | License Server Architecture (PocketBase on Northflank) | Implemented (2026-07-15) | **Dev 1:** `/status` changed from `GET /{tenant_id}` to `POST` with `Authorization: Bearer` auth (avoids leaking api_key in URLs). **Dev 2:** `trial_registrations` schema updated with `tenant_id` relation and `macos`/`unknown` platform values. |
| [#23](./archived/2026-07-20-free-trial-lifecycle-and-license-activation-workflow.md) | Free Trial Lifecycle & License Activation Workflow | Re-scoped by `subscription-tiers.md` §4 | **Dev 1:** Segmented trials shipped (14-day Plus general / 14-day Pro restaurant-cafe / 30-day Pro enterprise-referral). **Dev 2:** Paddle `custom_data` contract documented (`email` + `bundle` + `phone`; vertical not carried). **Dev 3:** Hardware-fingerprint trial lock shipped end-to-end (`trial_registrations` + `POST /license/trial` + `enforceTrialLock` + client `get_hardware_fingerprint`). |
| [#39](./2026-08-18-adr39-midtrans-subscription-payments.md) | Midtrans QRIS Subscription Payments (Phase 2) | Implemented (2026-08-18) | **Dev 1:** Signature is plain SHA-512 (not HMAC-SHA512). **Dev 2:** Midtrans custom-field contract documented (`custom_field1` tier, `custom_field2` email, `custom_field3` period, `custom_field4` bundle). **Dev 3:** `custom_field3` period cross-checked against price map. **Dev 4:** Amount-authoritative tier resolution (amount → map lookup is primary; custom_field1 cross-checked). **Dev 5:** Failed-payment grace via `calculateGraceUntil`. **Dev 6:** Dedup by `transaction_id` only. **Dev 7:** Subscription-notification canonical string not implemented (falls through default branch). **Dev 8:** Webhook-minted key activation fast-path in `activate.go`. |

> The `subscription-tiers.md` source-of-truth spec (§4 trial strategy, §3
> quota matrix) and `TODO.md` Phase C track the implementation details.

## Conventions

- Add new ADRs as `docs/decisions/YYYY-MM-DD-adrNN-<slug>.md` with a
  `Status:` line in the header; update this index when a new ADR lands.
- Older ADRs predate the `Status:` convention — their entries show `—` and
  carry implementation detail in the document body.
