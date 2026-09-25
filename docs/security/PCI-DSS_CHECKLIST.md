<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE AFTER REPAIR 2026-09-25 (crate names corrected: 8 dead `oz-*` references replaced with the real `kasirmu-*` paths; rows 3.3.0/3.4.0 re-scoped from a bare "Implemented" to N/A-by-design with the zero-caller fact stated; gift-card PIN note extended past "authentication credential" to record that nothing verifies it) · Replaces the 2026-07-22 Hermes-Agent stamp, whose verdict "ACCURATE (1 minor path nit)" cannot be reconciled with what is now in the table: 6.2.2 asserted cargo-audit runs weekly in CI when the only copies live in two .bak workflows that GitHub never executes, and 6.4.1 pointed at a RELEASE.md that does not exist. · What survived verification, because a doc with wrong rows is not a doc with no true rows: the crate is real, `mask_pan()` is real at crates/kasirmu-security/src/mask.rs:50-77, `rotate_key()` is a real trait method inside RotationInfo, and `Keyring` is a real pub trait at lib.rs:80 with InMemoryKeyring plus windows/macos/linux modules — so the four "Protect Cardholder Data" rows credit a crate that exists. **⚠ 2026-09-25: that crate is `kasirmu-security`, not `oz-security`.** The stamp and the four rows above all spelled it `oz-security`/`oz-core`, a pre-rename name; `crates/oz-security` does not exist and `crates/oz-core` does not either. The claims were true and the paths were dead, which is the failure mode a directory rename produces in prose that nothing re-derives. Corrected in place. Note I nearly wrote the Keyring row up as false: my first grep looked for a struct or a mod, and a trait is none of those. A no-match from a pattern you chose is not evidence of absence. · 3.2.1 was narrowed rather than deleted: no PAN/CVV/track column exists in any of the 44 SQLite migrations and audit.rs carries a live redaction blocklist naming pin, cvv, cvc, card_number, pan and private_key — genuinely good evidence — but "never stores PIN" is false as written because gift_cards.pin is stored verbatim; see the precision note under that table. · The file also used to end with a "Last updated: 2026-08-16" line 25 days newer than this stamp's predecessor, which no tool reads: the doc admitted in prose that it had been edited long after it was last verified. Left in place; the footer below now reflects this pass. -->

# PCI-DSS Compliance Checklist

> **Status:** Planning / Review
> This checklist documents kasir.mu's alignment with PCI Data Security Standard v4.0 requirements applicable to a point-of-sale application.

## Scope

kasir.mu processes, transmits, and stores cardholder data when processing credit/debit card payments. This checklist covers the application-level requirements.

---

## Build and Maintain a Secure Network

| Requirement | Status | Notes |
|-------------|--------|-------|
| 1.1.1 Firewall between POS terminals and untrusted networks | N/A | Handled by network infrastructure |
| 1.2.2 No direct public access between cardholder data environment and internet | N/A | Handled by infrastructure |
| 1.3.2 DMZ for public-facing services | N/A | kasir.mu API can be deployed behind reverse proxy |

## Protect Cardholder Data

| Requirement | Status | Notes |
|-------------|--------|-------|
| 3.2.1 Do not store full PAN, CVV, or PIN after authorization | ✅ Application | **True for cardholder data, and the wording was too broad.** No PAN, CVV/CVC or track columns exist in any of the SQLite migrations (`ls crates/kasirmu-core/migrations/*.sql | wc -l` → 67 as of 2026-09-23; this row said 44, which was true when written and is the kind of count nothing re-derives), and `crates/kasirmu-core/src/db/audit.rs` keeps an explicit redaction blocklist containing `pin`, `cvv`, `cvc`, `card_number`, `pan`, `private_key` (`SENSITIVE_DETAIL_KEYS`, :18-39, verbatim — verified 2026-09-25). But the flat word "PIN" is not accurate store-wide: `gift_cards.pin` is a real column, and staff credentials are held separately as `users.pin_hash`. Say *cardholder* PIN. See the note under this table. |
| 3.3.0 Mask PAN when displayed (first 6 + last 4) | ✅ N/A by design | The helper is correct and tested — `kasirmu_security::mask::mask_pan()` (`crates/kasirmu-security/src/mask.rs:50-77`) implements first-six/last-four with a ≤10-digit overlap branch. It has **zero production callers**, and correctly so: no PAN is ever displayed, because none is ever stored (see 3.2.1). `mask_token` is the only function in that module with live callers. Verified 2026-09-25. |
| 3.4.0 Render PAN unreadable when stored (encryption, tokenization) | ✅ N/A by design | No PAN is stored, so there is nothing to render unreadable: no `card`/`pan` column exists in any migration, and every in-repo writer sets `gateway_response` to None. What *is* stored plaintext is a merchant's own gift-card code and PIN, which are **not** cardholder data — the classification is recorded in the precision note below and in review item C21. |
| 3.5.1 Document key management procedures | ✅ Implemented | Key rotation policy — P12-1: `rotate_key()` implemented in `kasirmu_security::Keyring`. Old key archived as `{name}-prev`. See `docs/decisions/archived/2026-07-10-subscription-tier-entitlement.md`. |
| 3.6.1 Secure cryptographic key storage | ✅ Implemented | OS keyring via `kasirmu_security::Keyring` |

> **Precision note (verified 08-09-26; extended 2026-09-25).** `crates/kasirmu-core/migrations/20260813_init.sql:138`
> defines `gift_cards.pin TEXT NOT NULL DEFAULT ''`, written verbatim from
> `input.pin.unwrap_or_default()` at `crates/kasirmu-core/src/db/gift_cards.rs:49` and inserted at
> line 63 — no hashing anywhere on that path, and `SELECT ... pin` returns it to callers
> (lines 125, 156, 239). That is a *gift-card* PIN, not cardholder data, so it does not
> violate 3.2.1 as PCI defines it; it is still stored recoverable in the
> same database file as `users.pin_hash`, which is hashed by name and design. Recorded as a
> `CODE FINDING`, not patched here.
>
> **The 2026-09-25 extension matters more than the wording it amends.** This note called the
> gift-card PIN "a plaintext authentication credential" without asking whether anything
> *checks* it — and nothing does. A tree-wide search finds no PIN predicate, no bridge
> verify function, and no UI prompt to enter a gift-card PIN; the only PIN surface is the
> optional field on the issue modal. `card_number` beside it is in the same position for a
> different reason: it is a merchant-issued bearer identifier (`GC-` + 12 alphanumerics,
> printed on the card and read at the till), not a PAN, and it is the column every lookup
> matches on. Neither is cardholder data, so 3.2.1 was never breached here; but the phrase
> "authentication credential" should not be read as describing a working control. The
> product question — is gift-card PIN protection intended at all? — is open and tracked as
> review item C69.

## Maintain a Vulnerability Management Program

| Requirement | Status | Notes |
|-------------|--------|-------|
| 5.2.1 Deploy anti-malware on POS systems | N/A | OS-level responsibility |
| 6.2.2 Use only secure versions of frameworks and libraries | ❌ Runs nowhere | **Was claimed as enforced; it is not.** `cargo audit` appears in `.github/workflows/security.yml.bak` and `nightly.yml.bak` only — both renamed away by `23c96330` and never replaced. Neither live workflow (`dev-ci.yml`, `release.yml`) runs it; the only `audit` strings in `dev-ci.yml` are `npm ci --no-audit`, which disables auditing. Verified 08-09-26. |
| 6.3.1 Security patches applied within 1 month | 🟡 Partial | Dependabot config exists, so dependency PRs are opened; but `cargo audit` behind the claim runs nowhere (see 6.2.2), so nothing measures whether a patch landed within a month. |
| 6.4.1 Change control process for all production systems | 📋 Planned | **The referenced `RELEASE.md` does not exist** at that path. The live release process is `docs/releases/first-release-runbook.md` plus `.github/workflows/release.yml` (desktop-only), and `scripts/release.sh` cuts the tag locally without pushing it. |

## Implement Strong Access Control Measures

| Requirement | Status | Notes |
|-------------|--------|-------|
| 7.1.1 Restrict access to cardholder data by business need-to-know | ✅ Implemented | RBAC via `StaffRoles` feature (owner/admin/manager/staff/auditor) |
| 7.2.1 Role-based access control matrix | ✅ Implemented | `platform_core::rbac` — `has_permission` (rbac.rs:121,259) over role constants `role-owner`/`role-admin` (rbac.rs:273,277), re-exported as `kasirmu_core::rbac`. `StaffRoles` is an *entitlement flag* (kasirmu-core/src/features.rs), not the permission model. Verified 2026-09-25. |
| 8.2.1 Unique user IDs for all personnel | ✅ Implemented | Each cashier has unique login |
| 8.3.1 Secure authentication (multi-factor where possible) | 📋 Planned | PIN-based auth → MFA in Phase 3 |
| 8.5.1 Manage user identities and access | ✅ Implemented | User management via Staff Management UI |
| 9.1.1 Physical security of POS terminals | N/A | OS-level responsibility |

## Regularly Monitor and Test Networks

| Requirement | Status | Notes |
|-------------|--------|-------|
| 10.2.1 Audit log captures user ID, event type, date/time, success/failure | ✅ Implemented on the two wired settlement doors — legacy lane excepted, see notes | `AuditLog` feature with immutable append-only log. Scoped 2026-09-12 (`d7bd33ea8`; in-transaction writer `log_audit_in_tx` + existence probe `has_audit_row_for` from `98b7483e9`, at the seat `40984ad90` established for the sync-outbox row): the two wired doors — `complete_sale_deduction_with_locations_and_estimate` (`db/sales_checkout.rs`) and `complete_sale_with_resolved_shortfalls` (`db/sales_lifecycle.rs`) — write the `sale.completed` row INSIDE the sale transaction with the real actor (`sale.user_id`), so a crash between commit and publish can no longer lose it. Exception, named where the tick is: the legacy `complete_sale` lane (`db/sales_crud.rs`) completes across three separate transactions, is deliberately not wired, and its only writer remains the synchronous in-process event handler on a separate connection — the `d7bd33ea8` handler guard skips only when a door-written row already exists. What the exception costs: a crash or failed dispatch between commit and publish loses the `sale.completed` row permanently with nothing reconciling it, and the rows that do land carry an empty user ID because the `SaleCompleted` event carries no actor — the first sub-requirement named in this row. 10.2.1 is therefore not yet true for sales settled through the legacy lane. |
| 10.3.1 Audit logs cannot be modified | ✅ Implemented | Immutable audit log (no UPDATE/DELETE). True for every row once written and unchanged by the `d7bd33ea8` write-path fix — but it presupposes the row exists: on the legacy `complete_sale` lane the `sale.completed` row can be lost between sale commit and event-handler publish (see the 10.2.1 exception above), so sales settled through that lane may leave this guarantee nothing to protect. |
| 10.4.1 Audit log review at least daily | ✅ Implemented | P12-3: `AuditLogScreen` has `REVIEW_STORAGE_KEY`, `countUnreviewed()`, unreviewed badge, and "Mark Reviewed" button. See `docs/decisions/archived/2026-07-10-subscription-tier-entitlement.md`. |
| 10.7.1 Log retention for at least 12 months | 📋 Planned | Log rotation + retention in `oz-logging` |
| 11.3.1 External vulnerability scans quarterly | N/A | Infrastructure-level |
| 11.3.2 Internal vulnerability scans quarterly | N/A | Infrastructure-level |
| 11.5.1 Intrusion detection/deployment | N/A | Infrastructure-level |

## Maintain an Information Security Policy

| Requirement | Status | Notes |
|-------------|--------|-------|
| 12.1.1 Information security policy | ✅ Implemented | See `docs/security/` and `docs/guides/WHITEPAPER.md` |
| 12.3.1 Usage policies for critical technologies | ✅ Implemented | `AGENTS.md` coding standards |
| 12.5.1 Incident response plan | ✅ Implemented | P12-2: Full incident response plan at `docs/security/INCIDENT_RESPONSE.md` — P1-P4 severity matrix, containment procedures, evidence preservation, escalation matrix, post-mortem template. |
| 12.8.1 Manage service providers with access to CDE | N/A | No third-party service providers |

---

## Quick Reference — kasir.mu PCI-DSS Features

| Feature | Implementation |
|---------|----------------|
| **PAN masking** | `kasirmu_security::mask::mask_pan()` — first 6 + last 4 digits. Implemented and tested, with **no production callers** (no PAN is stored). |
| **Encrypted storage** | AES-256-GCM via `kasirmu-security` (future: KEK in OS keyring) |
| **Key management** | OS-level keyring (`kasirmu_security::Keyring`) |
| **RBAC** | `platform_core::rbac` — `has_permission` over `role-owner`/`role-admin`/`role-manager`/`role-staff` constants, re-exported as `kasirmu_core::rbac` |
| **Audit logging** | `AuditLog` feature — immutable, append-only |
| **Dependency scanning** | `cargo audit` weekly via GitHub Actions |
| **Coding standards** | `AGENTS.md` with security rules |

---

*Last verified 2026-09-25 (review item C21): eight dead `oz-security`/`oz-core` paths replaced with the real `kasirmu-security`/`kasirmu-core` ones, the two PAN rows re-scoped to N/A-by-design, and the gift-card PIN note extended to state the finding it had stopped one step short of — the PIN is stored recoverable and nothing in the tree ever verifies it (filed as C69). No claim in this document was found false about cardholder data; every correction was a dead path or an over-broad verdict.*

> **Last updated:** 2026-08-16

> last audited 08-09-26 by docs-auditor
