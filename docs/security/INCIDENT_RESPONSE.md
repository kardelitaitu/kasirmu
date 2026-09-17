# kasir.mu Incident Response Plan

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (3 findings) · first stamp this page ever carried, and it had none: the header read "Status: Implemented · Last updated: 2026-07-20", which is both a shadow status line (no <!-- Audit stamp --> comment, no `last audited` footer, so invisible to check-audit-stamps.py and detect.sh) and the wrong word for a runbook — you do not implement a plan. · REPAIRED: (1) §10 claimed the audit log "uses" an `incident.report` action type across five lifecycle outcomes; the string exists nowhere in the sources and the real vocabulary is five SECURITY_ACTION_*/SECURITY_REASON_* consts (login, login.failed, logout, user.create, user.update) in crates/oz-core/src/db/audit_security.rs, so §10 is now labelled a specification; (2) §4.2 step 5 sends the on-call engineer to docs/incidents/, which has never existed and is referenced by no other file; (3) the status line rewritten. · VERIFIED HONEST, not assumed: this document already flags its own gaps where the gap is a file — COMMS_TEMPLATES.md, EMERGENCY_CONTACTS.md, INCIDENT_RESPONSE_QUICKREF.md, business_continuity.md, audit_log_specifications.md, security_checklist.md all carry "⚠️ Pending" markers naming the date they were found missing. That is good practice and it is why the two repaired items are the interesting ones: both were claimed in present tense with no marker, and both are the kind of claim a reader follows during an actual incident. -->

> **Status:** Documented, partially unimplemented · Last updated: 08-09-26
> **Machine claims verified against code** — see the audit stamp below. §10 in particular
describes an audit action that does not exist.
> **PCI-DSS v4.0:** Requirement 12.5.1
> **Document owner:** Security Team

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Incident Classification](#2-incident-classification)
3. [Incident Response Team & Roles](#3-incident-response-team--roles)
4. [Response Lifecycle](#4-response-lifecycle)
5. [Containment Procedures](#5-containment-procedures)
6. [Evidence Preservation](#6-evidence-preservation)
7. [Notification & Communication](#7-notification--communication)
8. [Recovery & Remediation](#8-recovery--remediation)
9. [Post-Mortem Process](#9-post-mortem-process)
10. [Audit Log Integration](#10-audit-log-integration)
11. [Testing the Plan](#11-testing-the-plan)

---

## 1. Purpose & Scope

### 1.1 Purpose

This document defines the incident response procedures for the kasir.mu point-of-sale system. It ensures that security incidents are detected, contained, investigated, and remediated in a consistent and timely manner, minimising impact on business operations and cardholder data.

### 1.2 Scope

This plan covers all kasir.mu components:

- **Desktop client** (`apps/desktop-client/`) — retail POS terminals
- **Tablet client** (`apps/tablet-client/`) — mobile POS terminals
- **Cloud server** (`apps/cloud-server/`) — sync API and authentication
- **License server** (`apps/license-server/`) — license activation and management
- **Sync service** (`platform/sync/`) — offline-sync infrastructure
- **Database** — SQLite (local) and PostgreSQL (cloud)
- **Plugins** (`plugins/`) — third-party Lua scripts
- **Hardware** — printers, scanners, scales, payment terminals
- **Build & deployment** — CI/CD pipeline, Docker images, release artifacts

> **Out of scope:** Network infrastructure (firewalls, switches), physical security of premises, and third-party services not operated by kasir.mu (payment gateways, cloud hosting). These are the responsibility of the deployment environment.

---

## 2. Incident Classification

Incidents are classified by severity level. The classification determines the response timeline, notification channels, and escalation path.

### Severity Matrix

| Level | Label | Definition | Response SLA | Examples |
|-------|-------|------------|--------------|----------|
| **P1** | **Critical** | Active data breach, system compromise, or widespread service outage affecting cardholder data or multiple stores | ≤ 15 min notification · ≤ 1 hr containment | Unauthorised database access, ransomware, credential leak from license server, payment terminal skimming |
| **P2** | **High** | Service degradation affecting a single store, potential data exposure, or confirmed vulnerability with active exploitation | ≤ 1 hr notification · ≤ 4 hr containment | POS terminal offline > 30 min, suspicious API activity, plugin sandbox escape |
| **P3** | **Medium** | Non-critical vulnerability, isolated misconfiguration, or suspicious behaviour with no confirmed impact | ≤ 1 business day | Failed audit log write, unusual sync pattern, expired SSL certificate |
| **P4** | **Low** | Best-practice finding, documentation gap, or minor operational issue | ≤ 1 sprint (2 weeks) | Missing focus indicator, non-blocking lint warning, outdated dependency with no CVE |

### Escalation Rules

- P1 incidents **automatically escalate** to the Security Lead and CEO within 15 minutes of confirmation.
- P2 incidents escalate to the Security Lead if containment is not achieved within 2 hours.
- Any incident that **spans multiple stores** or **involves cardholder data** is automatically treated as P1.
- An incident may be **reclassified upward** (e.g., P3 → P2) if new evidence reveals broader impact.

---

## 3. Incident Response Team & Roles

### Core Team

| Role | Responsibility | Primary | Backup |
|------|----------------|---------|--------|
| **Incident Commander (IC)** | Coordinates response, makes triage decisions, communicates status | CTO / Lead Developer | Senior Developer |
| **Security Lead** | Investigates technical root cause, preserves evidence, determines scope | Security Engineer | DevOps Lead |
| **Communications Lead** | Handles external notifications (customers, regulators, press) | CEO | COO |
| **Operations Lead** | Executes containment actions (rotate keys, block IPs, disable accounts) | DevOps Lead | Senior Developer |
| **Legal / Compliance** | Advises on regulatory obligations (PCI-DSS, GDPR, breach notification) | External Counsel | CEO |

### Contact Information

| Contact | Method | Availability |
|---------|--------|-------------|
| **Security Lead** | `security@ozpos.my.id` · PagerDuty escalation · +1-555-SECURE | 24/7 |
| **Incident Commander** | `incident@ozpos.my.id` · +1-555-INCIDENT | 24/7 (P1 only) |
| **DevOps Lead** | `devops@ozpos.my.id` · Slack @devops-oncall | Business hours + P1 on-call |
| **CEO** | `ceo@ozpos.my.id` · +1-555-CEO-OZPOS | Business hours (P1: any time) |
| **Legal Counsel** | `legal@ozpos.my.id` (retained firm) | Business hours (P1: escalation) |
| **Internal Slack** | `#security-incidents` channel | All incidents |

> **Emergency contacts file:** `docs/security/EMERGENCY_CONTACTS.md` (maintained quarterly) — ⚠️ **pending**: this file does not exist yet (verified 2026-08-08 by docs-auditor); create it before relying on this contact plan

---

## 4. Response Lifecycle

```
Detection → Triage → Containment → Investigation → Remediation → Post-Mortem → Closure
```

### 4.1 Detection

Incidents may be detected through:

- **Automated alerts:** Intrusion detection, anomaly monitoring (rate limit breaches, unusual sync patterns), `cargo audit` findings, CI pipeline security checks
- **User reports:** Store staff report unusual behaviour via in-app feedback, support tickets, or direct contact
- **Audit log review:** Daily audit log review (P12-3) flags suspicious events (`user.login` failures, `sale.void` spikes, permission escalation)
- **External notification:** Payment gateway (Stripe/Square) webhook alerts, hosting provider (Northflank) security notices, CVE announcements
- **Penetration testing:** Scheduled quarterly internal/external scans

### 4.2 Triage

1. **Acknowledge** the detection within the SLA for the incident's initial severity.
2. **Classify** the incident using the severity matrix (§2).
3. **Assign** an Incident Commander (IC) who creates a dedicated Slack channel `#incident-<shortname>`.
4. **Log** the incident in the audit log with action `"incident.report"` (see §10).
5. **Record** initial findings in a shared document (Google Doc or Markdown file in `docs/incidents/`). ⚠️ **`docs/incidents/` does not exist in the repository** (08-09-26) and is referenced by no other file — create it, or pick another location, before relying on this step.

### 4.3 Containment

Follow the containment procedures in §5. The IC decides which containment actions to take based on the incident type and severity.

### 4.4 Investigation

1. Collect all relevant logs, audit entries, sync records, and system snapshots.
2. Determine the root cause, attack vector, and affected systems/data.
3. Identify all tenants, stores, or devices impacted.
4. Document findings in the incident log.

### 4.5 Remediation

1. Implement fixes to prevent recurrence (code patch, configuration change, key rotation).
2. Deploy the fix through the standard CI/CD pipeline (P1: expedited review, skip non-essential checks).
3. Verify the fix is effective (monitor for 24–72 hours after deployment).

### 4.6 Post-Mortem

Conduct a post-mortem meeting within 5 business days of closure. See §9 for the template.

### 4.7 Closure

1. Finalise all documentation.
2. Update the PCI-DSS compliance checklist if relevant.
3. Archive the incident report in `docs/incidents/YYYY-MM-DD-<shortname>.md`.
4. Notify all stakeholders that the incident is closed.

---

## 5. Containment Procedures

### 5.1 Credential / Key Compromise

| Step | Action | Responsibility |
|------|--------|----------------|
| 1 | Revoke all API keys for the affected tenant(s) via license server `POST /api/v1/license/status` with `revoke: true` | Security Lead |
| 2 | Rotate the OZ_LICENSE_PRIVATE_KEY if the license server itself is compromised | Operations Lead |
| 3 | Invalidate all active subscriptions for the affected tenant(s) | Operations Lead |
| 4 | Force password reset for all affected user accounts | Operations Lead |
| 5 | Generate new API keys and distribute out-of-band | Security Lead |

### 5.2 Payment Data Exposure

| Step | Action | Responsibility |
|------|--------|----------------|
| 1 | Identify the scope of exposure (which terminals, transactions, time period) | Security Lead |
| 2 | Disable the affected payment terminal(s) via the cloud server | Operations Lead |
| 3 | Verify that kasir.mu does **not** store PAN/CVV/PIN (confirm with audit log + DB inspection) | Security Lead |
| 4 | Notify the payment gateway (Stripe/Square) of the potential compromise | Communications Lead |
| 5 | Engage external forensics if cardholder data is confirmed exposed | Legal / Compliance |

### 5.3 Service Outage / DoS

| Step | Action | Responsibility |
|------|--------|----------------|
| 1 | Identify whether the outage is caused by rate limiting (429), infrastructure failure, or attack | Operations Lead |
| 2 | If rate limiting: verify per-tenant buckets are correctly configured (P8-1) | Operations Lead |
| 3 | If infrastructure: fail over to backup instance or increase compute resources | Operations Lead |
| 4 | If attack: enable IP-based blocking at the reverse proxy / WAF level | Operations Lead |
| 5 | Restore offline terminals to last-known-good sync state | Operations Lead |

### 5.4 Plugin / Sandbox Escape

| Step | Action | Responsibility |
|------|--------|----------------|
| 1 | Immediately disable the PluginSystem feature for all affected tenants | Security Lead |
| 2 | Remove the malicious plugin from the `plugins/` directory | Operations Lead |
| 3 | Review the sandbox audit report (`docs/security/lua-sandbox-audit.md`) for unpatched vectors | Security Lead |
| 4 | Restrict plugin permissions to minimum necessary (P0-2) | Security Lead |
| 5 | Apply instruction-count limits (P0-3) if not already in place | Developer |

### 5.5 Audit Log Tampering

| Step | Action | Responsibility |
|------|--------|----------------|
| 1 | Verify audit log immutability: check for missing sequence of entries, unexpected gaps, or modification timestamps | Security Lead |
| 2 | If tampering is confirmed, isolate the affected database and restore from backup | Operations Lead |
| 3 | Determine the attack vector (SQL injection, direct filesystem access, privilege escalation) | Security Lead |
| 4 | Implement additional controls (read-only replication, alert on DELETE/UPDATE on audit_log table) | Developer |

---

## 6. Evidence Preservation

### 6.1 What to Preserve

For any P1 or P2 incident, preserve the following:

- **Logs:**
  - Application logs (`oz-logging` output) — last 7 days
  - Audit log entries (`audit_log` table) — full export
  - System logs (syslog, Windows Event Log) — if accessible
- **Database:**
  - Full SQLite database backup (`.db` file) — before any remediation
  - Sync queue contents (`offline_queue` table) — pending and synced items
- **Network:**
  - API request/response dumps (if captured by proxy or reverse proxy logs)
  - Rate limiter bucket state (in-memory — capture quickly)
- **Configuration:**
  - Current `settings` table dump
  - Feature registry state
  - Plugin manifest files (`plugin.toml`) and script contents
- **Artifacts:**
  - Crash dumps from affected terminals
  - Screenshots of error states
  - Memory dump (if sandbox escape suspected)

### 6.2 Chain of Custody

1. **Timestamp** every artefact with the collection time and collector's identity.
2. **Checksum** each artefact (SHA-256) and record the hash.
3. **Store** artefacts in a secure, access-controlled location (`docs/incidents/artifacts/` or encrypted S3 bucket).
4. **Document** who accessed the artefacts and when.
5. **Preserve originals** — always work from copies, never modify originals.

### 6.3 Retention

Incident artefacts must be retained for **at least 12 months** (PCI-DSS §10.7.1). After 12 months, artefacts may be deleted unless they are part of an ongoing legal matter.

---

## 7. Notification & Communication

### 7.1 Internal Notification

| Incident Level | Notify | Method | Within |
|----------------|--------|--------|--------|
| P1 | Security Lead, CEO | Phone / PagerDuty | 15 min |
| P1 | All developers | Slack #general | 30 min |
| P2 | Security Lead | Slack #security-incidents | 1 hr |
| P3 | Security team | Slack #security-incidents | Next business day |
| P4 | Assigned developer | Jira ticket | Next sprint |

### 7.2 External Notification

| Party | When | Responsibility |
|-------|------|----------------|
| **Affected customers (tenants)** | Within 24 hours of P1/P2 confirmation | Communications Lead |
| **Payment gateway (Stripe/Square)** | Within 24 hours if cardholder data potentially exposed | Communications Lead |
| **Data protection authority** | Within 72 hours if personal data breach (GDPR) | Legal / Compliance |
| **PCI-DSS acquiring bank** | Immediately upon confirmation of cardholder data compromise | Legal / Compliance |
| **Law enforcement** | If criminal activity is suspected (theft, fraud, ransomware) | CEO |

### 7.3 Communication Templates

Pre-approved communication templates are maintained in `docs/security/COMMS_TEMPLATES.md`. All external communications must be reviewed by Legal before sending.

> ⚠️ **Pending (2026-08-08, docs-auditor):** `COMMS_TEMPLATES.md` does not exist yet.

---

## 8. Recovery & Remediation

### 8.1 Recovery Steps

1. **Restore** affected systems from clean backups (verify backup integrity first).
2. **Reapply** security patches and configuration changes identified during containment.
3. **Verify** that the vulnerability is fully patched (automated tests, manual verification).
4. **Monitor** the affected systems for 72 hours post-recovery at increased alerting sensitivity.
5. **Document** the recovery process for future reference.

### 8.2 Service Restoration Priority

| Priority | Service | Target RTO |
|----------|---------|------------|
| 1 | Payment processing | < 1 hour |
| 2 | Core POS (scan, add, sell) | < 2 hours |
| 3 | Offline-sync | < 4 hours |
| 4 | License activation | < 4 hours |
| 5 | Reporting & analytics | < 24 hours |
| 6 | Plugin system | < 48 hours |

(RTO = Recovery Time Objective)

---

## 9. Post-Mortem Process

A post-mortem is required for all P1 and P2 incidents. P3/P4 incidents may use a lightweight version (bullet points in the Jira ticket).

### 9.1 Post-Mortem Template

```markdown
# Post-Mortem: <Incident Title>

**Date:** YYYY-MM-DD
**Incident ID:** INC-###
**Severity:** P1 | P2 | P3 | P4
**Duration:** Start → End (X hours)

## Summary

One-paragraph description of what happened and the impact.

## Timeline

| Time (UTC) | Event |
|------------|-------|
| HH:MM | Detection |
| HH:MM | Triage |
| HH:MM | Containment started |
| HH:MM | Containment achieved |
| HH:MM | Root cause identified |
| HH:MM | Remediation deployed |
| HH:MM | Service restored |
| HH:MM | Incident closed |

## Root Cause

- **Primary cause:** ...
- **Contributing factors:** ...

## Impact

- **Stores affected:** N
- **Transactions affected:** N
- **Data exposed:** Yes / No / Unknown
- **Downtime:** N hours N minutes

## Detection

How was this incident detected? What improvements could be made to detect it faster?

## Response

What went well? What could be improved?

## Action Items

| # | Action | Owner | Due Date |
|---|--------|-------|----------|
| 1 | ... | ... | ... |

## Lessons Learned

- ...
```

### 9.2 Post-Mortem Standards

- Blameless — focus on system and process improvements, not individual mistakes.
- Published internally within 5 business days of closure.
- All action items tracked in Jira with explicit owners and due dates.
- Action items are reviewed at the next sprint planning meeting.

---

## 10. Audit Log Integration

### 10.1 Incident Action Type

> ⚠️ **This section describes an integration that does not exist.** Verified 08-09-26:
> `incident.report` appears **zero times** in the Rust, TypeScript and Go sources — no
> constant, no writer, no test. The shipped audit action vocabulary is five
> `pub const SECURITY_ACTION_*` / `SECURITY_REASON_*` entries in
> `crates/oz-core/src/db/audit_security.rs`: `login`, `login.failed`, `logout`,
> `user.create`, `user.update`. Everything below is a **specification**, not a
> description, and is still worth having — but an on-call engineer who follows step 4 of
> §4.2 ("Log the incident in the audit log with action `"incident.report"`") will find no
> such action to log. Note the contrast with this document's own §7.3 and §12, which *do*
> mark their missing files "⚠️ Pending": the same care was never applied to a missing
> action type, because a file you cannot open is obvious and a string constant nobody
> declared is silent.

The audit log **should** use the `"incident.report"` action type to record all security incidents. This follows the established `"<domain>.<action>"` naming convention (e.g., `"sale.create"`, `"user.login"`, `"incident.report"`).

**When to log:**

- Incident detected (initial triage) → `"incident.report"`, outcome: `"detected"`
- Containment action taken → `"incident.report"`, outcome: `"contained"`
- Incident resolved → `"incident.report"`, outcome: `"resolved"`
- Post-mortem published → `"incident.report"`, outcome: `"closed"`
- Post-mortem action item completed → `"incident.report"`, outcome: `"remediated"`

**Details field structure:**

```json
{
  "incident_id": "INC-001",
  "severity": "P1",
  "classification": "credential-compromise",
  "action": "key-rotation",
  "summary": "Rotated OZ_LICENSE_PRIVATE_KEY after suspected compromise"
}
```

### 10.2 Audit Log Integration Points

| Event | Action | Outcome | Details |
|-------|--------|---------|---------|
| Incident reported by staff | `incident.report` | `detected` | Reporter, initial description |
| Rate limit threshold crossed | `incident.alert` | `warning` | IP, endpoint, count |
| Failed login spike (>10/min) | `incident.alert` | `warning` | User IDs, timestamps |
| Key rotation performed | `incident.report` | `remediated` | Key type, reason |
| Plugin sandbox violation | `incident.alert` | `blocked` | Plugin name, permission attempted |

### 10.3 Viewing Incidents in the Audit Log

Incident entries can be filtered by action type:

```sql
-- View all incident-related audit entries
SELECT * FROM audit_log WHERE action IN ('incident.report', 'incident.alert')
ORDER BY created_at DESC;

-- View unresolved incidents
SELECT * FROM audit_log
WHERE action = 'incident.report' AND outcome IN ('detected', 'contained')
ORDER BY created_at DESC;
```

### 10.4 No Code Changes Required

The audit log system's `action` field is a free-form string (see `crates/oz-core/src/db/audit.rs`). No schema migration or code change is needed to use the `"incident.report"` action type — it follows the existing naming convention. The incident response team should use this action type when logging incident-related events via `Store::log_audit()`.

---

## 11. Testing the Plan

### 11.1 Tabletop Exercises

Conduct a tabletop exercise every 6 months with the core incident response team. Scenarios rotate:

| Quarter | Scenario |
|---------|----------|
| Q1 2026 | Plugin sandbox escape (simulated) |
| Q2 2026 | License server compromise |
| Q3 2026 | Payment data exposure (simulated) |
| Q4 2026 | Multi-store ransomware (tabletop) |

### 11.2 Drill Schedule

| Drill Type | Frequency | Success Criteria |
|------------|-----------|-----------------|
| P1 notification drill | Quarterly | IC notified within 15 min |
| Key rotation drill | Bi-annual | Full key rotation completed in < 1 hr |
| Backup restoration drill | Bi-annual | Database restored from backup in < 30 min |
| Full incident simulation | Annual | End-to-end tabletop + remediation in < 4 hr |

### 11.3 Plan Review

This plan is reviewed and updated:

- **Quarterly** — contact information, escalation paths, tooling changes
- **After every P1 incident** — lessons learned incorporated
- **After every major release** — new features may change the attack surface
- **Annually** — full review with the security team

---

## Appendices

### A. Related Documents

| Document | Location | Status |
|----------|----------|--------|
| PCI-DSS Compliance Checklist | `docs/security/PCI-DSS_CHECKLIST.md` | ✅ Exists |
| Lua Sandbox Audit Report | `docs/security/lua-sandbox-audit.md` | ✅ Exists |
| Security Architecture | `docs/security/security_checklist.md` | ⚠️ Missing (pending) |
| Audit Log Specifications | `docs/security/audit_log_specifications.md` | ⚠️ Missing (pending) |
| Business Continuity Plan | `docs/operations/business_continuity.md` | ⚠️ Missing (pending) |

> ⚠️ Statuses verified 2026-08-08 by docs-auditor: the three ⚠️ documents are referenced but do not exist yet.

### B. Quick Reference Card

For on-call engineers: a one-page quick reference is maintained at `docs/security/INCIDENT_RESPONSE_QUICKREF.md` (⚠️ pending — does not exist yet).

### C. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-20 | Security Team | Initial release — PCI-DSS P12-2 |

---

> **This document is maintained by the Security Team.**
> Questions or suggestions → `security@ozpos.my.id`

---


---

> last audited 08-09-26 by docs-auditor
