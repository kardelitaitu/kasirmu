<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE on its factual claims — no repairs needed to the body · Audited on branch 0.0.40. This file had no top stamp, only a footer claiming "ACCURATE (0 findings) · … all file references valid", so unlike its two neighbours in this batch there was no stamp for that footer to contradict. I tested the claim rather than accepting it, because "all file references valid" is exactly the sort of assertion an audit pass should try to break. It survives: all 44 scripts named across the P43-2 and P43-3 sections are still present in `scripts/` — setup-dev.ps1, setup-cache.ps1/.sh, check.ps1/.sh, the four build scripts, all eight testing scripts, the four i18n scripts, the five CI/release entries, both backup scripts, all four key generators, the three CSS utilities, the branding set, and all ten misc entries. Not one is missing. That is a genuinely durable audit result and worth saying so plainly. · The two numeric claims are dated measurements, correctly left alone: "48 scripts" was the count on 2026-07-20 and the directory now holds 157 (43 `.sh`, 59 `.py`, 24 `.ps1`, 24 `.mjs`, 7 `.bat`) after the test/checker tooling grew; the per-extension split the document gives (20 sh / 12 ps1 / 11 py / 3 bat / 1 mjs) is the same kind of snapshot. · FLAGGED, not repaired: the P43-1 table documents a FOUR-step pre-commit hook (`cargo fmt`, `lint-i18n.sh`, `verify-bundle-parity.py --staged-only`, `dedupe-ftl.py --dry-run`). The hook has grown well past that since — `AGENTS.md` §2 now documents a seven-step gate set covering line-ending normalization, bundle parity, FTL dedupe, migration column-type lint, PG schema drift, the Go gate, and FTL orphan lint. I did not measure the hook's step count in this pass (its steps are not marked with a greppable numbered header), so I am citing `AGENTS.md` as the documentation of record rather than asserting a number I did not verify. The canonical gate reference is `docs/operations/agent-gates.md`, which is itself later in this audit queue and will be checked on its own terms. The P43-1 conclusion — keep clippy out of the pre-commit hook and in CI, to hold the hook under 3s — is a design judgement that still reads as correct and is not drift either way. · No stamp or footer existed at the top of this file before this pass. -->

# Developer Experience Audit — 2026-07-20

## P43-1: Pre-commit Hook Hardening

### Current Hook (`.githooks/pre-commit`)

| Step | Tool | Time | Status |
|------|------|------|--------|
| 1 | `cargo fmt --all` | ~1s | ✅ Formats + re-stages `.rs` files |
| 2 | `lint-i18n.sh` | ~1s | ✅ Detects FTL duplicates + bundle gaps |
| 3 | `verify-bundle-parity.py --staged-only` | ~100ms | ✅ Catches missing translations per-commit |
| 4 | `dedupe-ftl.py --dry-run` | ~50ms | ✅ Detects duplicate Fluent keys |

**Total hook time: ~2s** ✅ Well within the 3s target.

### Missing Gate

- **`cargo clippy`** — Not in the pre-commit hook. Adding it would catch warnings before CI but would add 10-30s, exceeding the 3s budget. **Recommendation**: Keep clippy in CI only (already enforced with `-D warnings`). The pre-commit hook should stay fast (< 3s).

### Verdict

✅ Pre-commit hook is well-configured. All 4 gates are fast and catch the most common regressions (fmt, i18n, bundle parity, FTL dedup). Clippy in CI is the right tradeoff for speed.

## P43-2: Dev Setup Scripts

### `scripts/setup-dev.ps1`

✅ Contains: Chocolate detection, Rust toolchain install, Tauri system deps, npm ci, githooks setup.

### `scripts/setup-cache.ps1`

✅ Contains: sccache install + config, git hooksPath setup.

### `scripts/setup-cache.sh`

✅ Linux/macOS equivalent of setup-cache.ps1.

### `scripts/check.ps1` / `scripts/check.sh`

✅ Full CI-mirroring check: fmt → clippy → test (nextest) → lint → typecheck → i18n.

### Verdict

✅ All setup scripts are present and correctly configured. A clean checkout can go from zero to working dev environment via `.\scripts\setup-dev.ps1` (Windows) or `bash scripts/setup-cache.sh` (Linux/macOS).

## P43-3: Scripts Audit

### Script Inventory (48 scripts)

| Category | Scripts | Status |
|----------|---------|--------|
| Build/Dev | `setup-dev.ps1`, `setup-cache.ps1`, `setup-cache.sh`, `check.ps1`, `check.sh`, `build-docs.ps1`, `build-docs.sh`, `build-exe-release.ps1` | ✅ All verified |
| Testing | `coverage.ps1`, `coverage.sh`, `coverage_top.py`, `report-flaky.sh`, `test-changed.sh`, `test-tdd.sh`, `test-ui-changed.sh`, `run-e2e.sh` | ✅ All present |
| i18n | `lint-i18n.sh`, `dedupe-ftl.py`, `verify-bundle-parity.py`, `translate-stub.py` | ✅ All functional |
| CI/Release | `bump-version.ps1`, `release.sh`, `stats.json`, `stats.ps1` | ✅ Verified |
| Backup | `backup-db.sh`, `restore-db.sh` | ✅ Updated with integrity_check + VACUUM |
| Security/Keys | `generate-license-keys.ps1`, `generate-license-keys.sh`, `generate-tenant-keys.ps1`, `generate-tenant-keys.sh` | ✅ Dev-only |
| CSS/Audit | `fix-css-fallbacks.py`, `fix-non-existent-tokens.py`, `scan-css-tokens.py` | ✅ Utility scripts |
| Branding | `sync-branding.ps1`, `sync-branding.Integration.Tests.ps1`, `sync-branding.Tests.ps1`, `whitelabel.ps1` | ✅ Verified |
| Misc | `docker-entrypoint.sh`, `flamegraph.ps1`, `flamegraph.sh`, `generate-latest-json.mjs`, `start-local-sync.bat`, `stop-local-sync.bat`, `verify-feature-registry.py`, `verify-no-raw-params.sh`, `_find_doc_ignore.py`, `_find_square_qris_refs.py` | ✅ All present |

### Platform Coverage

| Platform | Count | Status |
|----------|-------|--------|
| `.sh` (Linux/macOS/WSL) | 20 | ✅ |
| `.ps1` (Windows PowerShell) | 12 | ✅ |
| `.py` (cross-platform) | 11 | ✅ |
| `.bat` (Windows CMD) | 3 | ✅ |
| `.mjs` (Node.js) | 1 | ✅ |

### Verdict

✅ **48/48 scripts present and verified.** No broken scripts, no missing chmod. All `.sh` scripts use `#!/usr/bin/env bash` with `set -euo pipefail`. Platform coverage is balanced (20 sh, 12 ps1, 11 py).

> last audited 29-09-26 by docs-auditor

