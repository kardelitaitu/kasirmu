# Weekly Development Plan — kasir.mu `0.0.41`

> Generated: 2026-11-10. Branch locked at `0.0.41`. Never create or switch branches.
> Every item below was verified against the live tree before writing. Cross-references include
> exact file paths and commands so any reader can re-derive without reading this document first.

---

## Week of 2026-11-10 → 2026-11-16

### Status entering this week

| Area | Status |
|---|---|
| Last PR merged | #126 — offline sync resilience, RSA license validation, UI dispatch protection |
| CI on `main` | ✅ All dev-ci gates pass. Northflank deploy failed HTTP 401 (credential stale). |
| `docs/plans/_active/` | `website_carousel.md` (blocked on video assets), `owner-question-2026-09-28-r4-r6-r7.md` (answered), `notes.md` (Items 1–2 ✅ done). |
| Open security finding | **BRIDGE-7** — `print_kasbon_settlement_slip_scoped` discloses customer PII to any authenticated operator. OPEN, awaiting ruling. |

---

## Day 1–2 · Mon–Tue · Security & Permission Hardening (BRIDGE-7)

> Highest-priority item this week. `print_kasbon_settlement_slip_scoped` takes
> `customer_name`, `customer_phone`, `previous_balance`, `amount_paid`, `remaining_balance`
> and prints them with no permission check beyond session validity.
> Finding: `docs/decisions/2026-10-23-bridge7-hardware-permission-gap.md`

**Recommended: Option B — gate only the Kasbon settlement slip**

| Option | Cost |
|---|---|
| A. Gate all 11 hardware commands | Role migration; breaks cashier-print on upgrade |
| **B. Gate only `print_kasbon_settlement_slip_scoped`** | 1 key + 1 test — recommended |
| C. Leave as-is | PII disclosure stays open — not acceptable |

- [ ] Get owner ruling: Option A or B? If B, which key — `receivables:view` or `customers:view`?
- [ ] Add permission check to `print_kasbon_settlement_slip_scoped` in `crates/kasirmu-bridge/src/hardware.rs`
- [ ] Update `// ungated-ok:` comment on the other 10 to record why session-auth is sufficient (no PII)
- [ ] Add bridge test: session without `receivables:view` → `AuthError::InsufficientPermission`
- [ ] Update BRIDGE-7 doc status to `CLOSED` with ruling + commit hash
- [ ] Verify: `cargo check -p kasirmu-bridge && cargo test -p kasirmu-bridge hardware`
- [ ] Commit: `fix(bridge): gate kasbon settlement slip on receivables:view permission`

---

## Day 3 · Wed · Course Firing Architecture Decision

> `fireCourse` / `fireAllCourses` in `ui/src/features/sales/usePosState.ts:247,260`
> mutate local state only — they never reach the backend before checkout.
> `publish_course_fired_scoped` pipeline exists and is proven (6 bridge tests in `pos_tests.rs:2520-2610`),
> but the pre-checkout firing path has no backend route. Parked in `docs/plans/_active/notes.md`.

**Two mutually exclusive options — owner must decide:**

| Option | Shape |
|---|---|
| **1. Persist `coursing_status` on the cart** | Add field to cart serialization; server defines "half-fired cart" semantics |
| **2. `fireCourse` drives KDS release** | New `fire_course_scoped` command; `kds_line_items.item_status` becomes single source of truth |

- [ ] Present both options to owner — get a ruling before writing any code
- [ ] Draft ADR-68 capturing the ruling, rationale, and what it closes
- [ ] If Option 2: scaffold `fire_course_scoped` stub in `crates/kasirmu-bridge/src/pos/cart.rs` with `todo!()` + ADR-68 reference
- [ ] If Option 1: add `coursing_status: Vec<CourseStatus>` to cart serialization + document state machine
- [ ] Commit: `docs(decisions): add adr68-course-firing-architecture` (ADR only until ruling lands)

---

## Day 4 · Thu · Analytics Cards Visual Backlog (`notes.md`)

> `docs/plans/_active/notes.md` — 1,823-line visual-confirmation backlog.
> Items 1–2 were ✅ closed last week. Remaining ~19 "Still open" items require
> a human looking at the rendered app — cannot be settled from code alone.

- [ ] Start Vite dev server: `cd ui && npm run dev` → open `http://localhost:1420/#/analytics`
- [ ] Walk each "Still open" section in `notes.md` with the running app visible
- [ ] For each confirmed: change to `✅ Fixed — verified YYYY-MM-DD` with what was seen
- [ ] For each needing a code fix: implement the minimal targeted change (component / CSS)
- [ ] Run `npm run lint && npm run typecheck` after any code changes
- [ ] Commit: `chore(analytics): close visual-confirmation backlog items` — `notes.md` + any patches

---

## Day 5 · Fri · SEA Market Tax Rate Tables (ADR-59 Phase 2)

> `crates/kasirmu-core/src/regional.rs` already has `SEA_MARKET_PRESETS` for 6 markets
> and `regional_preset_for_country()` (shipped week prior, 53 tests passing).
> Phase 2 of ADR-59 needs per-country statutory tax *rate tables*, not just regime names.

- [ ] Read `regional.rs`: `RegionalMarketPreset`, `tax_regime()`, `validate_regional_axis_value`
- [ ] Add `TaxRateTable` struct: standard rate + reduced rate + exempt flag, keyed by `country_code`
- [ ] Populate statutory rates (published, not speculated):
  - `ID` → PPN 11%, PB1 10%
  - `SG` → GST 9%
  - `MY` → SST 8%
  - `TH` → VAT 7%
  - `PH` → VAT 12%
  - `VN` → VAT 10%
- [ ] Add `tax_rate_for_country(country_code, TaxCategory) -> TaxRate` function
- [ ] Add unit tests in `crates/kasirmu-core/src/regional_tests.rs`
- [ ] Verify: `cargo check -p kasirmu-core && cargo test -p kasirmu-core regional::`
- [ ] Commit: `feat(core): add statutory tax rate tables for SEA Phase 2 markets`

---

## Day 6 · Sat · Housekeeping & Docs

### 6a — Northflank Credential Rotation (HTTP 401)

> CI job `Deploy Backend (Northflank)` failed with HTTP 401 on the `main` merge run.
> See: `docs/decisions/deploy-northflank` skill for the rotation procedure.

- [ ] Rotate the Northflank API token in the Northflank dashboard
- [ ] Update GitHub Actions secret: `gh secret set KASIRMU_NORTHFLANK_API_TOKEN --body "<token>"`
- [ ] Re-trigger the deploy job and confirm it reaches the "Wait for build to conclude" step

### 6b — Plans Folder Housekeeping

- [ ] Archive `docs/plans/_active/owner-question-2026-09-28-r4-r6-r7.md` to `docs/plans/_done/done-owner-question-2026-09-28-r4-r6-r7.md` — all answers recorded 2026-09-29, file is now purely historical
- [ ] Run `python scripts/verify-doc-uniqueness.py && python scripts/verify-agents-mirrors.py`
- [ ] Commit: `docs(plans): archive answered owner-question r4-r6-r7`

### 6c — Website Carousel Video Asset Reminder

> Only remaining blocker: owner must supply 5 × 10 s calm UI screen recordings.
> Encode specs (VP9/H.264, 1280×720 desktop, 960×540 mobile, 15 fps) are in
> `docs/plans/_active/website_carousel.md` §6. Integration steps are in §7.

- [ ] Remind owner: drop clips into `website/public/videos/hero/` when ready

---

## Day 7 · Sun · Buffer + Stretch Goals

> Absorb any day 5–6 overflow, write next week's todo, or pick a stretch item.

### Stretch A — `Release Bridge Tests` Hardening

> Job failed on `main` push with exit code 100 (release-profile build). Passed on the PR.

- [ ] Run `cargo test -p kasirmu-bridge --profile release` locally
- [ ] Identify `opt-level = 3` / LTO mismatches that surface only in release profile
- [ ] Fix and add to the release-profile CI matrix

### Stretch B — ADR-67 Core Size Ratchet

> `docs/decisions/2026-10-24-adr67-core-size-ratchet-measurement.md` defines a size ceiling for `kasirmu-core`.

- [ ] Measure current `kasirmu-core` compiled size
- [ ] Confirm or add an enforcement script/gate if none exists

### Stretch C — Android APK Smoke Test

- [ ] `android-apk-build` skill → build debug APK
- [ ] Install on tablet over wireless ADB
- [ ] Confirm WebView serves POS screen at LAN IP

---

## Blocked / Carry-Forward

| Item | Blocker |
|---|---|
| Hero carousel video assets | Owner must supply 5 × 10 s clips |
| Course firing architecture (ADR-68) | Owner ruling: Option 1 (persist on cart) vs Option 2 (drive KDS) |
| BRIDGE-7 permission scope | Owner ruling: gate only Kasbon slip or all 11 commands |
| MIDTRANS sandbox credential (R6) | Owner declined; re-open only if credential arrives |
| Physical EDC terminal model (R7) | Owner "none yet"; loopback is the active implementation |
| Phase 3 India / Brazil expansion | ADR-59 Invariant 1: no code without a commercial sponsor |

---

## Reference — Gate Commands Cheatsheet

```powershell
# UI gates (always from ui/)
cd ui && npm run lint && npm run typecheck
cd ui && npm run test

# Rust per-crate (iteration)
cargo check -p kasirmu-bridge
cargo test -p kasirmu-bridge

# Gate scripts
python scripts/verify-agents-mirrors.py       # AGENTS.md mirrors
python scripts/verify-ipc-parity.py           # IPC allowlist
python scripts/verify-doc-uniqueness.py       # plan uniqueness
python scripts/verify-ftl-orphans.py --census # i18n orphan count

# Docs portal
mdbook build docs

# Commit form (ALWAYS explicit pathspec)
git commit -m "type(area): subject" -- path/one path/two
git show --stat
```

> **Never** `git push` without explicit user order.
> **Never** modify version numbers (`0.0.41` locked).
> **Never** `git clean -x...` (would delete `.env` — 82 files at risk).
> **Never** `git commit -a` or bare `git add` except for new-file staging.
> **Always** commit with explicit pathspec.

---

## Completed — Week of 2026-11-02 → 2026-11-09

<details>
<summary>13 completed items — click to expand</summary>

### 1. UI lint + typecheck + unit tests — ✅ 2026-11-09
- `npm run lint` → 0 errors · `npm run typecheck` → 0 errors
- `npm run test` → 13,130 passed · 3 skipped · 3 todo across 828 test files

### 2. Gate scripts — ✅ 2026-11-09
- `check-gate-runners.py` → 150 gates checked, all resolve
- `verify-agents-mirrors.py` → every policed mirror agrees
- `verify-ipc-parity.py` → IPC parity: OK

### 3. I18N Cleanup (`I18N-01`) — ✅ PRESERVED 2026-11-09
- 55 Indonesian-only keys confirmed as load-bearing test fixtures and documented cleanup debt.
- `verify-bundle-parity.py` and `verify-ftl-orphans.py` exit 0 cleanly.

### 4. Terminal Profile Dead Surfaces — ✅ DOCUMENTED 2026-11-09
- Chose Option A: document as headless back-office admin surfaces.
- Updated doc comments in `apps/desktop-tauri/src/commands/terminals.rs`.
- `verify-ipc-parity.py` PASS · `api-terminals-contract.test.ts` 12/12 · bridge terminals 37/37.

### 5. Owner Question Follow-up (R4/R6/R7) — ✅ VERIFIED 2026-11-09
- R4 (EDC binding): shipped as `terminal_id: Option<String>` with loopback fallback.
- R6 (MIDTRANS credential): declined; wiremock offline tests run cleanly.
- R7 (EDC terminal model): "none yet"; loopback simulator is the active implementation.

### 6. Website Carousel §7.0 Mount-Box Decision — ✅ RESOLVED 2026-11-09
- Adopted Option B (`object-fit: cover`), standard 16:9 recordings with 15px safe margin.
- Updated `docs/plans/_active/website_carousel.md`. Only video assets remain blocked.

### 7. Documentation Portal Health — ✅ VERIFIED 2026-11-09
- `mdbook build docs` → exit 0, HTML book written.

### 8. Payment Methods Plan Archival — ✅ 2026-11-09
- 83 passing tests across UI, Rust core, and bridge suites.
- Moved to `docs/plans/_done/done-payment-methods-plan.md`. All cross-references updated.

### 9. Subscription Tier Enforcement Verification — ✅ 2026-11-09
- Go license server: PASS (305.5s) · Core: 138 passed · Bridge: 35 passed · UI: 91 passed.

### 10. Android Mobile Build & Hardware Preflight — ✅ 2026-11-09
- `android-preflight.sh` verified via Git Bash. adb daemon operational.

### 11. Feature Flag Test Enumeration (BR-D1) — ✅ 2026-11-09
- All 39 feature variants reconciled in `features_tests.rs`. Committed `828a954fd`.

### 12. Gate-Integrity Checker Audit (GI-1–GI-7) — ✅ 2026-11-09
- 150 gates · 104/106 self-tests wired · 101 self-tests executed · all scripts clean.

### 13. SEA Market Expansion Presets (ADR-59 Phase 2) — ✅ 2026-11-09
- `SEA_MARKET_PRESETS` for 6 markets + `regional_preset_for_country()` in `regional.rs`.
- 53/53 tests passing. Committed `54c474ddd`.

</details>
