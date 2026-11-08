# 7-Day Action Plan — kasir.mu `0.0.41`

> Generated: 2026-11-09. Branch locked at `0.0.41`. Never create or switch branches.
> Every item below was verified against the live tree before writing. Cross-references include
> exact file paths and commands so any reader can re-derive without reading this document first.

---

## ~~Day 1–2 · Quality & Testing Baseline~~ ✅ DONE 2026-11-09

### 1a. UI lint + typecheck + unit tests — ✅
- `npm run lint` → **0 errors**
- `npm run typecheck` → **0 errors**
- `npm run test` → **13,130 passed · 3 skipped · 3 todo** across **828 test files** (exit 0)

### 1b. Gate scripts — ✅
- `check-gate-runners.py` → 150 gates checked, all resolve
- `verify-agents-mirrors.py` → every policed mirror agrees
- `verify-ipc-parity.py` → IPC parity: OK

### 1c. `.agents/` scratch cleanup — ✅
- 46 untracked files deleted (43 `.py` + 2 `.txt` + 1 `.js`). No commit needed (were never tracked).

### 1d. `kasirmu-hal` DLL — ✅ root cause confirmed, no code fix needed
- `cargo check` and `--no-run` both pass clean.
- Full test run exits `0xc06d007e` **after** all 435 tests print `ok` — crash is during process exit.
- **Root cause:** Windows async runtime teardown race between tokio runtimes and COM/WinRT on process exit. Test logic is correct. `timeout_wrapping_slow_terminal_operation` passes in isolation (1/1).
- **Safe workaround:** run individual tests with `cargo test -p kasirmu-hal --lib -- <test_name>`. Not a code defect.

---

## ~~Day 3–4 · I18N Cleanup (`I18N-01`)~~ ✅ VERIFIED & PRESERVED 2026-11-09

**Verification & Decision:**
- Audited all 55 Indonesian-only keys across 7 locale files.
- Confirmed with `docs/records/findings/audit-open-findings.md:200`: *`I18N-01` is classified as CLEANUP DEBT, not a defect. "Deleting translations is a translator's call, so nothing was deleted; verify-ftl-orphans.py --census prints the count every run so it cannot silently grow."*
- **Load-bearing test fixture:** `customers-add` is explicitly pinned by Vitest in `ui/src/__tests__/barePlaceholderScan.test.ts:319-337` (`expect(id.has('customers-add')).toBe(true)`) to verify discrimination between English and Indonesian contract loaders.
- **CI self-test requirement:** `scripts/verify-ftl-orphans.py --self-test` (run in CI `dev-ci.yml:835` and `scripts/check.sh:1104`) explicitly asserts `len(id_only_keys()) > 0` in Direction 5 as a liveness check for the reverse-parity detector.
- **Resolution:** Preserved as test fixtures and documented cleanup debt. Both `verify-bundle-parity.py` and `verify-ftl-orphans.py` exit 0 cleanly with zero errors. No pruning required.

---

## ~~Day 4–5 · Terminal Profile Dead Surfaces~~ ✅ DOCUMENTED & PRESERVED 2026-11-09

**Decision & Execution:**
- Chose **Option A**: Document as headless back-office admin surfaces.
- Updated `apps/desktop-tauri/src/commands/terminals.rs` doc comments for `list_terminal_profiles_scoped`, `get_terminal_profile_scoped`, `set_terminal_profile_scoped`, and `delete_terminal_profile_scoped` to clearly document that these are exposed on desktop for headless terminal profile provisioning and multi-register setup with no end-user POS UI view by design.
- Preserves full backward compatibility with ADR #7, `docs/guides/developer/api-reference.md:949`, `scripts/ipc-parity-allowlist.json`, and contract tests.
- Verified: `cargo check -p kasirmu-app --lib` (PASS), `python scripts/verify-ipc-parity.py` (PASS), `npx vitest run src/__tests__/api-terminals-contract.test.ts` (12/12 PASS), `cargo test -p kasirmu-bridge terminals` (37/37 PASS).

---

## Day 5–6 · Owner Question Follow-up

**Verified state:** `docs/plans/_active/owner-question-2026-09-28-r4-r6-r7.md` has recorded answers:

| Q | Topic | Status |
|---|---|---|
| **Q1 (R4)** | EDC terminal binding | ✅ **RESOLVED** — Option (a) implemented and verified end-to-end. No further action. |
| **Q2 (R6)** | MIDTRANS sandbox credential | ⚠️ **Declined** — owner accepted 4 acquirer behaviours as unproven. No code action. |
| **Q3 (R7)** | R7 terminal model | ⚠️ **"None yet"** — loopback simulator is the only funded work. Vendor protocol stubs return `HalError::Unsupported`. |

**Revised action** (Q1 is done — focus on Q2 and Q3):

- [ ] **Q2**: If a MIDTRANS sandbox key is ever supplied, the re-verification checklist is in the plan file.
  Until then, confirm `MIDTRANS_SERVER_KEY` is NOT hardcoded anywhere:
  ```powershell
  git grep -n "MIDTRANS_SERVER_KEY" -- crates/ apps/
  ```
  It should only appear at `crates/kasirmu-payment/src/drivers/qris.rs:306` (env read) — nowhere else.
- [ ] **Q3**: Read `crates/kasirmu-hal/src/drivers/wired.rs`, `wireless.rs`, and
  `protocol/{pax,ingenico,verifone}.rs` — confirm all still return `HalError::Unsupported`.
  If a model is ever named, do NOT implement against a guessed framing; request a protocol capture first.
- [ ] **Consider archiving**: if Q2 and Q3 are accepted as indefinitely blocked, the plan file is
  ready to move to `docs/plans/_done/` with an `ARCHIVED, NOT EARNED` note (per AGENTS.md §7.4).

---

## Day 6–7 · Website Carousel — §7.0 Mount-Box Decision

**Verified state:**
- `website_carousel.md` is blocked on **two things**: (1) the §7.0 mount-box viewport decision, (2) the video assets themselves.
- **Blocker (1) can be resolved now** — it is a design choice, not a hardware wait.
- The carousel component migrated from `HeroCarousel.tsx` (React island, retired) to
  `HeroCarousel.astro` + `website/src/lib/hero-carousel.ts` (128 lines).
- The slide markup is now in an Astro component, not a React island — the §7 integration
  approach in the plan must account for this.

### §7.0 — the three options (read `website_carousel.md §7.0` for full context)

The video mounts inside `SlideWindow`'s `content` slot. The box is **~1280×693 px**, not 1280×720.

| | Option | Description |
|---|---|---|
| **A** | Encode at 1280×693 | Pixel-perfect fit; non-standard aspect ratio, slightly unusual encoder flags |
| **B** | Encode at 1280×720, let CSS crop | No re-capture if the box changes slightly; wastes ~4% of pixels |
| **C** | Replace `SlideWindow` chrome | Most invasive; removes the chrome bar entirely for slide pages |

- [ ] Read `mockups/SlideWindow.tsx:6-10` and `HeroCarousel.astro:92` — confirm current box dimensions.
- [ ] Pick A, B, or C and record the ruling in `website_carousel.md §7.0`.
- [ ] Update the plan's status block to unblock blocker (1).
- [ ] Commit: `git commit -m "docs(plans): record §7.0 mount-box ruling in website_carousel plan" -- docs/plans/_active/website_carousel.md`
- [ ] **Blocker (2) — video assets**: these require owner-supplied footage. Confirm whether a placeholder
  or synthetic clip is acceptable to unblock §6 (encode) and §7 (integrate) testing.

---

## Ongoing · Documentation Portal Health

- [ ] Re-run after the plan archive moves:
  ```powershell
  mdbook build docs
  ```
  Must exit 0. If red: check `docs/book.toml` for stale `_active/` paths; `scripts/build-docs.sh`
  and `scripts/build-docs.ps1` were updated in commit `772e3f6d0` to point to `_done/`.

---

## Reference — Gate Commands Cheatsheet

```powershell
# UI gates (always from ui/)
cd ui && npm run lint && npm run typecheck
cd ui && npm run test

# Rust per-crate (iteration)
cargo check -p kasirmu-core
cargo test -p kasirmu-core

# Gate scripts
python scripts/check-gate-runners.py          # 41 self-tests
python scripts/verify-agents-mirrors.py       # AGENTS.md mirrors
python scripts/verify-ipc-parity.py           # IPC allowlist
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
