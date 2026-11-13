<!-- Audit stamp: 2026-11-13 · dev · status: ACCURATE · version lock: 0.0.41 -->
# v0.0.41 Code Freeze Declaration & Bug Triage Policy

This document formally declares the code and scope freeze for **kasir.mu v0.0.41** as required by `plan-next-30-days.md` §4.4, in preparation for merchant pilot deployments and January 2027 beta trials.

---

## 1. Scope Lock & Freeze Declaration

- **Freeze Timestamp:** `2026-11-13T12:00:00Z`
- **Target Release:** `v0.0.41`
- **Branch:** `0.0.41` (version locked)
- **Status:** **FROZEN** for feature development; open strictly for critical bug fixes, test hardening, and release automation.

### Invariants Under Freeze
1. **Schema Invariant:** Zero new SQLite migrations (`crates/kasirmu-core/migrations/`) or schema changes without explicit written owner authorization.
2. **Money Invariant:** All monetary operations strictly use `Money` (`i64` minor units). Floating point currency arithmetic is strictly prohibited.
3. **Database Write Invariant:** All SQLite database writes must execute inside an explicit `rusqlite` transaction.
4. **IPC Parity Invariant:** No unregistered or unverified commands allowed; `python scripts/verify-ipc-parity.py` must stay green.
5. **Contract Ladder Invariant:** All 70 gate checkers must maintain full contract parity (`self_test`, `shell_ladder`, `root_param`, `wired`).

---

## 2. Bug Triage & Severity Matrix

Every defect reported against v0.0.41 must be triaged according to this severity matrix:

| Severity | Definition | Examples | Triage Action / SLA |
|---|---|---|---|
| **P0 — Blocker** | Financial inaccuracy, ledger divergence, corruption, or unrecoverable crash | Money minor unit truncation, audit chain hash break (`is_valid: false`), silent database write failure, data loss on restart | **Stop-the-line**: Hotfix required before any binary artifact distribution. |
| **P1 — Critical** | Offline sync lockup, security privilege bypass, or terminal payment failure | Offline queue permanent retry loop, unauthorized access past RBAC gate, payment gateway deadlock | Resolve within 24 hours. |
| **P2 — Major** | Degraded feature with a manual workaround, or localized UI crash | Receipt printer driver fallback failing, non-critical screen error toast, layout overflow on specific tablet DPI | Resolve before beta cohort rollout. |
| **P3 — Minor** | Visual polish, cosmetic drift, minor documentation inaccuracy | 1px spacing mismatch, unlocalized non-critical label, cosmetic transition timing | Log in backlog; fix in next iteration. |

---

## 3. Bug-Triage Report Template

When logging defects during beta trials or QA verification, use this standard format (also provisioned at `.github/ISSUE_TEMPLATE/bug_report.md`):

```markdown
### Summary
A clear, 1-2 sentence description of the defect.

### Severity
- [ ] P0 — Blocker (Data loss / Money mismatch / Crash on boot)
- [ ] P1 — Critical (Sync failure / Security bypass / Payment terminal wedge)
- [ ] P2 — Major (Functional regression with workaround)
- [ ] P3 — Minor (Cosmetic / Documentation)

### Environment
- **Platform:** [Desktop Windows x64 / Tablet Android 13]
- **App Version:** 0.0.41
- **Mode:** [Online / Offline]
- **Store / Terminal ID:** `default` / `pos-term-1`

### Steps to Reproduce
1. Go to '...'
2. Click on '....'
3. Observe '....'

### Expected Behavior
What should have happened according to business and ledger specifications.

### Actual Behavior
What actually happened (quote exact error messages or unexpected ledger totals).

### Ledger & Audit State (if applicable)
- Stock before / after:
- Money minor units ($X.XX / N units):
- Audit chain valid: [Yes / No]
- Offline queue depth:

### Logs & Evidence
Attach relevant logs:
- Desktop: `%LOCALAPPDATA%\kasirmu\logs\app.log`
- SQLite integrity: `PRAGMA integrity_check`
- Screenshots or device dumps.
```

---

## 4. Known Exceptions & Owners

The following items are explicit known exceptions permitted under this freeze:

| Item | Description | Current Status | Owner |
|---|---|---|---|
| **PG-gated receipts** (§1.1) | PostgreSQL-gated receipt test runs | Gated on Docker Desktop daemon availability on host; SQLite source of truth is 100% verified. | DevOps / Platform |
| **Tablet 5-minute audit** (§3.1) | Onboarding timing on real Android hardware | Requires attached wireless ADB device (`23073RPBFG`); desktop flows are verified. | QA / Mobile |
| **Hero carousel video** (§6c) | 5 × 10 s screen recordings for website | Blocked on marketing asset capture from product owner. | Product / Media |
| **Northflank token rotation** (§6a) | Backend deploy token refresh (HTTP 401 on CI) | Requires credential refresh in Northflank console. | Infrastructure |
| **i18n cleanup debt** (`I18N-01`) | 55 Indonesian-only FTL keys | Deliberately preserved as permanent test fixtures; verified by `verify-bundle-parity.py`. | Localization |
