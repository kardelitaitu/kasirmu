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
| `docs/plans/_active/` | `website_carousel.md` (blocked on video assets), `notes.md` (Items 1–2 ✅ done). `owner-question-2026-09-28-r4-r6-r7.md` **archived 2026-11-11** → `_done/done-owner-question-2026-09-28-r4-r6-r7.md` (`00ca02d43`). |
| Open security finding | **BRIDGE-7** — `print_kasbon_settlement_slip_scoped` closed in `d46119269` (gated on `receivables:view`). |

---

## Day 1–2 · Mon–Tue · Security & Permission Hardening (BRIDGE-7) — ✅ COMPLETED 2026-11-10

> Highest-priority item this week. `print_kasbon_settlement_slip_scoped` takes
> `customer_name`, `customer_phone`, `previous_balance`, `amount_paid`, `remaining_balance`
> and prints them with no permission check beyond session validity.
> Finding: `docs/decisions/2026-10-23-bridge7-hardware-permission-gap.md`

**Adopted: Option B — gate only the Kasbon settlement slip**

- [x] Adopted Option B: gated `print_kasbon_settlement_slip_scoped` on `permissions::RECEIVABLES_VIEW`
- [x] Updated comments on the other 10 hardware commands to record why session-auth is sufficient (`// ungated-ok: session-auth sufficient...`)
- [x] Added bridge test `print_kasbon_settlement_slip_requires_receivables_view` in `crates/kasirmu-bridge/src/hardware_tests.rs`
- [x] Updated `docs/decisions/2026-10-23-bridge7-hardware-permission-gap.md` status to `CLOSED`
- [x] Verified: `cargo test -p kasirmu-bridge hardware` (45/45 passed), `verify-scoped-authorization.sh` (0 unreasoned)
- [x] Committed: `d46119269`

---

## Day 3 · Wed · Course Firing Architecture Decision — ✅ ADR-68 DRAFTED 2026-11-10

> `fireCourse` / `fireAllCourses` in `ui/src/features/sales/usePosState.ts:247,260`
> mutate local state only — they never reach the backend before checkout.
> `publish_course_fired_scoped` pipeline exists and is proven (6 bridge tests in `pos_tests.rs:2520-2610`),
> but the pre-checkout firing path has no backend route. Parked in `docs/plans/_active/notes.md`.

**Two mutually exclusive options — awaiting owner ruling between:**
1. **Persist `coursing_status` on the cart:** Cart-centric pre-checkout state machine.
2. **`fireCourse` drives KDS release:** Kitchen-centric real-time dispatch via `fire_course_scoped`.

- [x] Formulated both architectural options with trade-off comparison matrix
- [x] Drafted `docs/decisions/2026-11-10-adr68-course-firing-architecture.md` (ADR-68)
- [x] Updated `docs/decisions/README.md` and `docs/records/README.md` indices
- [x] Verified: `python .agents/skills/docs-auditor/scripts/check-adr-status.py` (0 drift, 0 unlisted)
- [x] Committed: `d434f8dae`

---

## Day 4 · Thu · Analytics Cards Visual Backlog (`notes.md`) — ✅ COMPLETED 2026-11-11 (`e2d536346`)

> `docs/plans/_active/notes.md` — audited remaining open items, verified `#/analytics`
> and `#/reports` in live Chromium, resolved code/CSS/i18n bugs, and pruned confirmed items.

- [x] Start Vite dev server: `cd ui && npm run dev` → open `http://localhost:1420/#/analytics` (and `#/reports`, 0 console errors/warnings)
- [x] Walk each "Still open" section in `notes.md` with the running app visible
- [x] For each confirmed: updated `notes.md` with verified findings and fixes
- [x] For each needing a code fix: fixed `.analytics-card-menu` portal token scoping, `.analytics-kpi-tiles` wrap, 7 chart `option` guards, `mountedRef` cleanup, `DashboardScreen` `GraphicComponent` & low-stock layout, `BundleManagementScreen` `toggleActive` error alert, `PromotionManagementScreen` local datetime round-trip, `pos-discount-default-label`, and `TaxConfigurationScreen` category aria-label
- [x] Run `npm run lint && npm run typecheck && npm run test` (`828` suites / `13,131` passed) + i18n/docs/parity gates
- [x] Commit on `0.0.41` at `e2d536346` (`fix(ui): resolve analytics portal/chart/layout issues and Day 4 notes backlog`)

---

## Day 5 · Fri · SEA Market Tax Rate Tables (ADR-59 Phase 2) — ✅ COMPLETED 2026-11-10

> `crates/kasirmu-core/src/regional.rs` already has `SEA_MARKET_PRESETS` for 6 markets
> and `regional_preset_for_country()` (shipped week prior, 53 tests passing).
> Phase 2 of ADR-59 needs per-country statutory tax *rate tables*, not just regime names.

- [x] Added `StatutoryTaxCategory` enum (`Standard`, `Reduced`, `ZeroRated`)
- [x] Populated statutory rates in basis points for 6 SEA markets (ID: 1100 standard / 1000 reduced, SG: 900, MY: 800, TH: 700, PH: 1200, VN: 1000)
- [x] Added `statutory_tax_rate_bps_for_country(country_code, category) -> Option<i64>`
- [x] Re-exported types in `crates/kasirmu-core/src/lib.rs`
- [x] Added comprehensive unit tests in `crates/kasirmu-core/src/regional_tests.rs`
- [x] Verified: `cargo check -p kasirmu-core && cargo test -p kasirmu-core regional::` (58/58 passed)
- [x] Committed: `67d563c04`

---

## Day 6 · Sat · Housekeeping & Docs

### 6a — Northflank Credential Rotation (HTTP 401)

> CI job `Deploy Backend (Northflank)` failed with HTTP 401 on the `main` merge run.
> See: `docs/decisions/deploy-northflank` skill for the rotation procedure.

- [ ] Rotate the Northflank API token in the Northflank dashboard
- [ ] Update GitHub Actions secret: `gh secret set KASIRMU_NORTHFLANK_API_TOKEN --body "<token>"`
- [ ] Re-trigger the deploy job and confirm it reaches the "Wait for build to conclude" step

### 6b — Plans Folder Housekeeping — ✅ COMPLETED 2026-11-11

- [x] Archive `docs/plans/_active/owner-question-2026-09-28-r4-r6-r7.md` to `docs/plans/_done/done-owner-question-2026-09-28-r4-r6-r7.md` — all answers recorded 2026-09-29, file is now purely historical. Moved with `git mv`; an ARCHIVED note naming the earning (all four questions answered, Q1 option (a) executed, Q2/R6 declined, Q3/R7 "none yet", Q4 recorded) was prepended so the `done-` prefix is earned rather than merely applied (AGENTS.md §7.4).
- [x] Ran `python scripts/verify-doc-uniqueness.py` → rc 0, "no duplicate authoritative documents"; `python scripts/verify-agents-mirrors.py` → rc 0, "every policed mirror (1) agrees with the repo"
- [x] Committed: `00ca02d43` — `docs(plans): archive answered owner-question r4-r6-r7` (1 file changed, 7 insertions, R095 rename)

### 6d — Ladder Campaign Census Correction — ✅ MEASURED 2026-11-11

> Every round since r265 closed with "Census N of 70". That denominator was a
> count of `scripts/*.py` taken before r265's own scope widening, and was never
> re-derived after the roster grew to include `website/scripts/` and
> `.agents/skills/docs-auditor/scripts/` plus the `.mjs`/`.sh` checkers.

- [x] Re-measured the real roster at HEAD: **102** checkers declare `--self-test`, of which **48** carry a ladder marker (38 in `scripts/`, 11 in `.agents/skills/docs-auditor/`, 5 in `website/scripts/`). Recorded as round 276 in `docs/records/findings/audit-open-findings.md`.
- [x] Committed with the round-277 batch: `d87bbd4e3`

### 6e — `verify-core-size` Ladder (round 277) — ✅ CONTRACTED & PROVEN 2026-11-11

> `scripts/verify-core-size.py` had 31 rule cases and no `shell_ladder()`. The
> rule cases grade helpers; none graded that `main()` grades the root it is
> handed — the exact defect r265–r275 found in five sibling checkers.

- [x] Added `shell_ladder()`: 7 rungs / 15 assertions. Rung 1 kills on a VERDICT (fixture one line over its ceiling → correct main exits 1 naming the fixture's delta; root-blind main grades this checkout, which sits at its own ceiling, and exits 0). Rung 2 is the positive floor. Rungs 3–7 cover the fixture's own ceiling, the db/ budget message, the modularity budget, a missing baseline, and `--emit-baseline`.
- [x] Fixed `scripts/prove-ladder-kills.py`: `applicable()` normalized its match while `run_mutant()` spliced raw, so a no-op `str.replace()` built an unmutated copy and reported it as SURVIVED. Added `_spliceable_occurrences()` (raw count over comment-stripped source), an EXEC refusal in `run_mutant()`, and a "conditional root ignores root" row for the two-line binding.
- [x] Verified: `python scripts/verify-core-size.py --self-test` → 31/31 rule cases + 15/15 rungs, rc 0; live run rc 0 (measured 40900 = ceiling 40900, headroom 0)
- [x] Verified the kill: `python scripts/prove-ladder-kills.py scripts/verify-core-size.py` → "every applicable mutation killed (1)", "conditional root ignores root KILLED rc=1"
- [x] Verified no regression: full sweep of the 44 laddered checkers → 36 KILLED-ALL, 0 EXEC, 0 SURVIVED, 8 NO APPLICABLE (rc 2, honest "cannot reach that shape"); the six checkers contracted in r270–r275 re-run individually, all still fully killed
- [x] Committed: `d87bbd4e3` — `test(gates): contract verify-core-size with a seven-rung ladder` (3 files, 375 insertions)

### 6c — Website Carousel Video Asset Reminder

> Only remaining blocker: owner must supply 5 × 10 s calm UI screen recordings.
> Encode specs (VP9/H.264, 1280×720 desktop, 960×540 mobile, 15 fps) are in
> `docs/plans/_active/website_carousel.md` §6. Integration steps are in §7.

- [ ] Remind owner: drop clips into `website/public/videos/hero/` when ready

---

## Day 7 · Sun · Buffer + Stretch Goals

> Absorb any day 5–6 overflow, write next week's todo, or pick a stretch item.

### Stretch A — `Release Bridge Tests` Hardening — ✅ FIXED 2026-11-10

> Job failed on `main` push with exit code 100 (`create_location_profile_refuses_when_the_store_db_cannot_be_created`).
> Root cause: in release profile without a paid tier, the subscription quota gate refuses with `SubscriptionLimitExceeded`
> before store database creation, because debug's bootstrap Premium upgrade shim does not run in release.

- [x] Diagnosed failure: test asserted `BridgeError::Internal(_)` while release profile legitimately returns `SubscriptionLimitExceeded`
- [x] Added `if !seeded_row_reaches_a_paid_tier()` branch in `crates/kasirmu-bridge/src/locations_tests.rs`
- [x] Verified debug pass and release expectation alignment
- [x] Committed: `48ea38f5a`

### Stretch B — ADR-67 Core Size Ratchet — ✅ MEASURED & ALIGNED 2026-11-10

> `docs/decisions/2026-10-24-adr67-core-size-ratchet-measurement.md` defines a size ceiling for `kasirmu-core`.

- [x] Measured `kasirmu-core` compiled production lines via `scripts/verify-core-size.py` (measured 40900)
- [x] Updated `scripts/core-size-baseline.json` ceiling (non-db 13203 -> 13230) with exact attribution for SEA statutory tax tables (+27 lines)
- [x] Verified: `python scripts/verify-core-size.py` passes cleanly (exit 0, headroom 0)
- [x] Committed: `scripts/core-size-baseline.json`

### Stretch C — Android APK Smoke Test

- [ ] `android-apk-build` skill → build debug APK *(blocked in non-Win32k agent shell: `tsc -b` + `dist-mobile` Vite bundle succeeded and `23073RPBFG` connected over wireless ADB, but `cargo tauri android build` build scripts failed with `0xc0000142` / `STATUS_DLL_INIT_FAILED` on `USER32.dll`/`win32u.dll`; run APK build from host terminal)*
- [ ] Install on tablet over wireless ADB
- [ ] Confirm WebView serves POS screen at LAN IP

---

## Blocked / Carry-Forward

| Item | Blocker |
|---|---|
| Hero carousel video assets | Owner must supply 5 × 10 s clips |
| Course firing architecture (ADR-68) | Owner ruling: Option 1 (persist on cart) vs Option 2 (drive KDS) |
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
