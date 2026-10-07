# Documentation-Code Audit — 2026-10-08

**Scope:** the live documentation surface across the repo - top-level docs, `docs/{guides,architecture,operations,security}`, the API reference, the customer-facing `website/src/content/` (docs, pricing, legal), and `docs/legal/` - plus a review of the doc-relevant checkers in `.agents/skills/docs-auditor/scripts/`.
**Method:** the docs-auditor skill's nine automated detectors, then every reported hit verified by hand against code. Independent parses were delegated to subagents and re-checked before any repair.
**Branch:** `0.0.41`. Three pathspec-scoped commits: `4a97bdcad`, `fab810e48`, `f54bbc432` (40 files, 427 insertions, 236 deletions).

---

## 1. Checker results (final snapshot)

| Checker | Result | Note |
|---|---|---|
| `check-dead-refs.py` | **0 unresolved** | 513 md scanned, 185 live / 328 historical |
| `check-orphans.py` | **0 findings** | one heading-level skip repaired |
| `check-audit-stamps.py` | **0 OLDER** | several footers bumped to their newest stamp |
| `check-nav-paths.py` | **0 drift** | after the Settings-path repairs below |
| `check-site-links.py` | **0 unresolved** | 46 content docs |
| `check-ci-claims.py` | **0 findings** | |
| `check-env-docs.py` | **0 undocumented (45/45)** | `OZ_ALLOW_INERT_RLS` documented |
| `check-adr-status.py` | **0 drift** | 59 hand-table rows |
| `check-api-surface.py` | **1 discrepancy - OPEN** | `print_edc_settlement_slip_scoped` registered in a peer uncommitted work; see section 4 |

`verify-ci-docs-drift.py` and `verify-agents-mirrors.py` (the repo's own gates) both pass.

---

## 2. What drifted, and the three patterns behind it

Grouped by CAUSE rather than by file, because the causes are what recur.

### Pattern A - commands register faster than the docs that describe them

The largest defect class. A feature that adds a command to `generate_handler!` does not touch the reference page, so the page falls behind while its own audit stamp keeps claiming completeness.

- `docs/guides/developer/api-reference.md`, 64 discrepancies (commit `4a97bdcad`): **54 rows carried the wrong availability marker** - every one said `[D]` for a command registered in BOTH shells - and **10 registered commands had no row at all**, including the three Android updater commands, which got the page first `commands::updater` section. Root cause traced to `6fe57ba17` (tablet-parity registration), which added tablet registrations and no doc rows. One row prose was stale too: `get_active_market_profile_scoped` said "Desktop-only ... not in the tablet shell" while `apps/mobile-tauri/src/lib.rs:1250` registers it.
- Final state: `registered desktop=493 tablet=413 distinct=511`, `documented 511`, all four buckets 0 - re-derived independently by a second parser before the repair was trusted.
### Pattern B - counts rot wherever nothing re-derives them

Numbers asserted in prose with no script behind them. Checkable ones were corrected; un-derivable ones were FLAGGED rather than replaced with a guess.

- `README.md`: codebase size contradicted its own cited `stats.json` (1,334,821/5,954 vs actual 1,250,487/5,730); the per-language table was regenerated so its rows sum exactly to the stats totals; test counts 9,026/623 to 9,378 `#[test]` (11,078 with `#[tokio::test]`)/654.
- `ARCHITECTURE.md`: ADRs 74 to **79**; migrations 69 to **74**; the `platform/core` tree gained the two files it omitted.
- `docs/operations/ci-pipeline.md`: body said `dev-ci.yml` "defines fourteen" while its own stamp said eighteen; measured **18 jobs**, deploy `needs:` 13.
- `docs/security/PCI-DSS_CHECKLIST.md`: migration count 67 to 74.
- `docs/guides/developer/QUICKSTART.md` and `README-technical.md`: both claimed no live workflow runs Clippy; `dev-ci.yml#cargo-clippy` does (`:326`). `scripts/gates.json`'s `rust-clippy` note is ALSO stale and is flagged as a config-registry item, not edited.
- **Flagged, not replaced** (no deriving artifact exists): `README.md`'s ">508,000 lines of test code" and `docs/operations/agent-lanes.md`'s "9,922-test suite" - both annotated in place with the measurable bases.

### Pattern C - docs asserting software mechanisms that do not exist

- `docs/guides/developer/server_performance_analysis.md` + `.env.example`: `OZ_DB_POOL_SIZE` documented as 20 in six places; code default is **8** (`apps/cloud-server/src/config.rs:226`). The doc own prior stamp had FLAGGED this; this pass fixed it rather than carrying the flag.
- `docs/guides/developer/dev-checklist.md` sections 2c/2d: listed a screen `SetupWizard.tsx` that does not exist, quoted `PaymentModal`'s gate as its own inverse, and named a quota check no production screen performs.
- `docs/legal/**`: privacy policy described **bcrypt** (code uses **Argon2id**), export formats incl. **Excel** (no writer exists), **PBKDF2** (unused), a **5-year retention** presented as a mechanism (the code prunes sync data at 90 days), and mailboxes `privacy@`/`legal@`/`support@` that appear nowhere. Entity name was inconsistent (`PT Kasirmu` vs the placeholder `PT [Nama PT Anda]`) inside an unregistered entity governing-law clause.
- `website/src/content/legal/{en,id}/privacy.md`: same bcrypt error, customer-facing.

### The QRIS case - a DECISION, not drift

Recorded separately because it is the one finding that could NOT be repaired by matching code. Three surfaces disagreed on **dynamic QRIS on the Free plan**:

- code (`SubscriptionTier::supports_qris()`, `crates/kasirmu-core/src/subscription/tier.rs:217-222`) and `subscription-tiers.md:285`: **not on Free**
- `website/src/content/pricing/en.ts:181` and the website licensing pages: **yes on Free**

The website side is an **owner ruling of 2026-09-29**, ordered website-first and pinned by `website/src/components/__tests__/pricing-content-invariants.test.ts`, whose comment states a silent revert in either direction is a product change. The ENFORCEMENT has not moved while the DECISION has. The repair therefore went to the source-of-truth doc - `subscription-tiers.md` now records the decision AND that it is not yet enforced - and NOT to the pricing data. The website customer-visible claim was narrowed to the truth (static QR on all plans; dynamic needs Plus) with the decision recorded.
---

## 3. Checker review (disposition of Option A)

The hypothesis that `check-dead-refs.py` under-covers because it grades only "13 live docs" was tested and **refuted**.

- The tool scans **513 markdown files**, of which **185 are live** and 328 historical. The "13" in its summary line is the count of live docs **WITH FINDINGS** - the `live` list is built only from docs that had hits (`main()`, lines 1245-1246) - not the count examined. The initial reading confused the two.
- Verified by injection, not inspection: a dead path planted in `website/src/content/docs/en/quickstart.md` was reported as `1 live with hits` naming the exact path, then reverted. A green that cannot be made red is not evidence, so the green was re-earned this way.
- **No change made to the checker.** Its scope rule is sound, and the `HIST_DIR_PREFIXES` exemption is deliberate and documented in-file.

One gap remains un-actioned by design: dead-ref coverage excludes prose and fenced-code references, which the tool docstring lists as known limitations.

---

## 4. Outstanding

- **`check-api-surface.py` reports 1 discrepancy: `print_edc_settlement_slip_scoped`.** The command is registered in a peer **uncommitted** working tree (`apps/*/src/lib.rs` modified, absent from HEAD), so no doc row was added - a row for in-flight work goes stale the moment its owner revises it. It needs a row in `docs/guides/developer/api-reference.md` when that change lands. This is the ONLY red detector.
- `website/src/content/docs/en/user-roles.md` has an internal contradiction (a "## The planned model" section vs a later line saying the four gaps are closed). Reported, not repaired - the section may be deliberate history.
- `scripts/gates.json`'s `rust-clippy` `_note` still asserts no live workflow runs Clippy. Config registry, not documentation; flagged for its owner.
- `docs/records/**`, `docs/decisions/**` and `docs/specs/**` were left alone: dated records are exempt by convention, and editing one falsifies it.

> last audited 08-10-26 by docs-auditor
