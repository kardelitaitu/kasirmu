<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · Clean pass — this is the one file in this batch that a prior pass had already re-anchored, and doing it well is what makes it a useful control against the two benchmark files audited alongside it. Every crate name in the threshold table is current: `kasirmu-core`, `kasirmu-hal`, `kasirmu-payment`, `kasirmu-lua`, `kasirmu-security`, `kasirmu-reporting`, `kasirmu-api`, `kasirmu-cli` and `kasirmu-plugin` all exist as tracked crates, and `platform/sync` is listed by path rather than by a stale package name. The 2026-08-08 inline note that corrected the report locations is also right — reports live under `coverage/{rust,ui}/index.html` per `scripts/coverage.sh`, which exists, so `docs/coverage/rust` is correctly identified as not a real output location. · The honesty of the table is worth noting: the ⚠️ rows (`kasirmu-lua` "narrow surface", `kasirmu-api` "Thin API wrapper", `kasirmu-cli` "CLI entry points") and the note that the numbers are `#[test]`/`#[tokio::test]` MARKERS rather than coverage percentages are exactly the caveat that stops a reader treating 1,669 tests as a coverage figure. The percentages in the Target column are targets, not measurements, and the file does not pretend otherwise. · NOT re-measured: the test counts (1,669 / 232 / 122 / 62 / 262) and the UI thresholds, all refreshed 2026-08-08 and all point-in-time against a tree that has since gained the RBAC, profile, topology and popularity work this campaign has been auditing. · The existing `> last audited 29-09-26 by docs-auditor` footer is bumped rather than stacked. -->
<!-- dead-ref-prefix-ok: docs/coverage/rust -->
<!-- Named in the note below precisely to say it is NOT a real output location. -->

# Coverage Report — kasir.mu

> Generated: 2026-07-20

## Rust — Workspace Coverage

Run with:
```bash
cargo llvm-cov --workspace --html --output-dir coverage/rust
```

Or with tarpaulin:
```bash
cargo tarpaulin --workspace --out Html --output-dir coverage/rust
```

> Updated 2026-08-08 by docs-auditor: reports live under `coverage/{rust,ui}/index.html` per the project convention (`scripts/coverage.sh`); `docs/coverage/rust` is not a real output location.

### Target Thresholds

> Test counts refreshed 2026-08-08 by docs-auditor (counts below are `#[test]`/`#[tokio::test]` markers, not coverage percentages).

| Crate | Target | Status |
|-------|--------|--------|
| `kasirmu-core` | ≥ 70% | ✅ 1,669 tests, high coverage |
| `kasirmu-hal` | ≥ 60% | ✅ 232 tests |
| `kasirmu-payment` | ≥ 60% | ✅ 122 tests |
| `kasirmu-lua` | ≥ 50% | ⚠️ 62 tests, narrow surface |
| `kasirmu-security` | ≥ 50% | ⚠️ Keyring + rotation tests |
| `kasirmu-reporting` | ≥ 50% | ⚠️ Menu engineering + metrics |
| `kasirmu-api` | ≥ 40% | ⚠️ Thin API wrapper |
| `kasirmu-cli` | ≥ 40% | ⚠️ CLI entry points |
| `kasirmu-plugin` | ≥ 40% | ⚠️ Manifest parsing |
| `platform/sync` | ≥ 60% | ✅ 262 tests |
| `workspace` | ≥ 50% | Target for CI gate |

## UI — Vitest Coverage

Run with:
```bash
cd ui && npm run test:coverage
```

Report location: `coverage/ui/index.html`

### Target Thresholds

| Metric | Target |
|--------|--------|
| Lines | ≥ 50% |
| Branches | ≥ 40% |
| Functions | ≥ 50% |

### Known Gaps

- E2E-only flows (login, payments, shifts) — covered by Playwright, not vitest
- Tauri IPC wrappers — thin pass-through, tested via E2E
- Fluent locale bundles — type-only modules, excluded from coverage

---

> last audited 29-09-26 by docs-auditor
