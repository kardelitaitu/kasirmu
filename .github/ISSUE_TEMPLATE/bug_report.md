---
name: Bug Report
about: Report a defect or regression in kasir.mu v0.0.41
title: '[BUG]: '
labels: ['bug', 'triage']
assignees: ''
---

### Summary
<!-- A clear, 1-2 sentence description of the defect. -->

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
<!-- What should have happened according to business and ledger specifications. -->

### Actual Behavior
<!-- What actually happened (quote exact error messages or unexpected ledger totals). -->

### Ledger & Audit State (if applicable)
- **Stock Before / After:**
- **Money Minor Units:** (e.g. $15.00 = 1,500 minor units)
- **Audit Chain Valid:** [Yes / No]
- **Offline Queue Depth:**

### Logs & Evidence
<!-- Attach relevant logs or screenshots -->
- Desktop logs: `%LOCALAPPDATA%\kasirmu\logs\app.log`
- SQLite PRAGMA check: `PRAGMA integrity_check;`
