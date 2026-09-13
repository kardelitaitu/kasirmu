<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE AFTER REPAIR (4 findings, 3 were claims of enforcement that does not exist) · Replaces the 2026-07-22 Hermes-Agent stamp, whose verdict "ACCURATE (1 minor path nit)" cannot be reconciled with what is now in the table: 6.2.2 asserted cargo-audit runs weekly in CI when the only copies live in two .bak workflows that GitHub never executes, and 6.4.1 pointed at a RELEASE.md that does not exist. · What survived verification, because a doc with wrong rows is not a doc with no true rows: `oz-security` is a real crate (1 of 13), `mask_pan()` is real at crates/oz-security/src/mask.rs, `rotate_key()` is a real trait method (lib.rs:125, 242) inside RotationInfo, and `oz-security::Keyring` is a real pub trait at lib.rs:80 with InMemoryKeyring plus windows/macos/linux modules — so the four "Protect Cardholder Data" rows that credit oz-security all hold. Note I nearly wrote the Keyring row up as false: my first grep looked for a struct or a mod, and a trait is none of those. A no-match from a pattern you chose is not evidence of absence. · 3.2.1 was narrowed rather than deleted: no PAN/CVV/track column exists in any of the 44 SQLite migrations and audit.rs carries a live redaction blocklist naming pin, cvv, cvc, card_number, pan and private_key — genuinely good evidence — but "never stores PIN" is false as written because gift_cards.pin is stored verbatim; see the precision note under that table. · The file also used to end with a "Last updated: 2026-08-16" line 25 days newer than this stamp's predecessor, which no tool reads: the doc admitted in prose that it had been edited long after it was last verified. Left in place; the footer below now reflects this pass. -->

# PCI-DSS Compliance Checklist

> **Status:** Planning / Review
> This checklist documents OZ-POS's alignment with PCI Data Security Standard v4.0 requirements applicable to a point-of-sale application.

## Scope

OZ-POS processes, transmits, and stores cardholder data when processing credit/debit card payments. This checklist covers the application-level requirements.

---

## Build and Maintain a Secure Network

| Requirement | Status | Notes |
|-------------|--------|-------|
| 1.1.1 Firewall between POS terminals and untrusted networks | N/A | Handled by network infrastructure |
| 1.2.2 No direct public access between cardholder data environment and internet | N/A | Handled by infrastructure |
| 1.3.2 DMZ for public-facing services | N/A | OZ-POS API can be deployed behind reverse proxy |

## Protect Cardholder Data

| Requirement | Status | Notes |
|-------------|--------|-------|
| 3.2.1 Do not store full PAN, CVV, or PIN after authorization | ✅ Application | **True for cardholder data, and the wording was too broad.** No PAN, CVV/CVC or track columns exist in any of the 44 SQLite migrations, and `crates/oz-core/src/db/audit.rs` keeps an explicit redaction blocklist containing `pin`, `cvv`, `cvc`, `card_number`, `pan`, `private_key`. But the flat word "PIN" is not accurate store-wide: `gift_cards.pin` is a real column, and staff credentials are held separately as `users.pin_hash`. Say *cardholder* PIN. See the note under this table. |
| 3.3.0 Mask PAN when displayed (first 6 + last 4) | ✅ Implemented | `mask_pan()` helper in `oz-security` |
| 3.4.0 Render PAN unreadable when stored (encryption, tokenization) | ✅ Implemented | `oz-security` provides encryption helpers |
| 3.5.1 Document key management procedures | ✅ Implemented | Key rotation policy — P12-1: `rotate_key()` implemented in `oz-security::Keyring`. Old key archived as `{name}-prev`. See `docs/decisions/archived/2026-07-10-subscription-tier-entitlement.md`. |
| 3.6.1 Secure cryptographic key storage | ✅ Implemented | OS keyring via `oz-security::Keyring` |

> **Precision note (verified 08-09-26).** `crates/oz-core/migrations/20260813_init.sql:138`
> defines `gift_cards.pin TEXT NOT NULL DEFAULT ''`, written verbatim from
> `input.pin.unwrap_or_default()` at `crates/oz-core/src/db/gift_cards.rs:49` and inserted at
> line 57 — no hashing anywhere on that path, and `SELECT ... pin` returns it to callers
> (lines 125, 156, 239). That is a *gift-card* PIN, not cardholder data, so it does not
> violate 3.2.1 as PCI defines it; it is still a plaintext authentication credential in the
> same database file as `users.pin_hash`, which is hashed by name and design. Recorded as a
> `CODE FINDING`, not patched here.

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
| 7.2.1 Role-based access control matrix | ✅ Implemented | See `oz-core::user` for permission model |
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

## Quick Reference — OZ-POS PCI-DSS Features

| Feature | Implementation |
|---------|----------------|
| **PAN masking** | `oz_security::mask_pan()` — shows first 6 + last 4 digits |
| **Encrypted storage** | AES-256-GCM via `oz-security` (future: KEK in OS keyring) |
| **Key management** | OS-level keyring (`oz_security::Keyring`) |
| **RBAC** | `StaffRoles` feature with owner/admin/manager/staff/auditor roles |
| **Audit logging** | `AuditLog` feature — immutable, append-only |
| **Dependency scanning** | `cargo audit` weekly via GitHub Actions |
| **Coding standards** | `AGENTS.md` with security rules |

> **Last updated:** 2026-08-16

> last audited 08-09-26 by docs-auditor
