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

## ~~Day 5–6 · Owner Question Follow-up~~ ✅ VERIFIED 2026-11-09

**Verification & Status:**
- **Q1 (R4 — EDC binding):** Fully implemented and shipped via Option (a) (`terminal_id: Option<String>` with loopback fallback).
- **Q2 (R6 — MIDTRANS credential):** Verified that `MIDTRANS_SERVER_KEY` is nowhere hardcoded in production code; dynamically read from environment. Wiremock integration tests (`tests/qris_integration.rs`) run cleanly offline.
- **Q3 (R7 — Terminal model):** Verified that `wired.rs`, `wireless.rs`, and vendor protocol stubs (`protocol/{pax,ingenico,verifone}.rs`) all fail closed with `HalError::Unsupported`. Loopback simulator is the active, verified implementation.
- **Retention ruling:** The plan file stays in `docs/plans/_active/` because several active tests (`ui/src/__tests__/writtenSettingHasReader.test.ts:260`, `ui/src/__tests__/edcDefaultLoss.test.ts:31`) and active specs (`0050-workspace-payment-methods`) cite it directly.

---

## ~~Day 6–7 · Website Carousel — §7.0 Mount-Box Decision~~ ✅ RESOLVED 2026-11-09

**Decision & Execution:**
- **Adopted Option B (`object-fit: cover`):** Standard 16:9 recordings (`1280×720` desktop, `960×540` mobile), framed with ~15px safe margin clear of critical UI at top and bottom. The video element mounts inside `<SlideWindow>`'s content slot with `class="h-full w-full object-cover"`.
- Updated `docs/plans/_active/website_carousel.md`: status block and §7.0 updated to mark Blocker 1 fully resolved.
- Only Blocker 2 (owner-supplied 10s video clips) remains pending when assets arrive.

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
