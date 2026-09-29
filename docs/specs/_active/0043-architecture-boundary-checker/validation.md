<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE (0 major, 2 minor — both repaired here) · Audited on branch 0.0.40. Every anchor re-measured, not quoted: all three referenced paths exist AND are tracked (`scripts/verify-architecture-boundaries.py`, `scripts/__tests__/verify-architecture-boundaries.test.mjs`, `scripts/verify-ci-docs-drift.py`); `--report-only`/`--strict`/`--json` are real argparse flags at `scripts/verify-architecture-boundaries.py:1023-1025`; `node --test scripts/__tests__/verify-architecture-boundaries.test.mjs` → 32 tests / 32 pass / 0 fail, and the suite names map one-to-one onto all 14 "Required tests" scenarios below (1-5, 6-8, 9, 10, 11, 12, 13+14) with 18 more added since for later rules; `--report-only` → exit 0, `--json` → exit 0. Repaired 1: the JSON criterion named a `status` field that does not exist — the emitted key is `baseline_status` (`scripts/verify-architecture-boundaries.py:790`, `:933`), alongside rule/category/severity/path/line/target/remediation. Repaired 2: the "if the checker is added to the repository gate" conditional is now false — it is in the gate (`.github/workflows/dev-ci.yml:918` static-gates step "Architecture boundaries", plus `scripts/check.sh:152`, `scripts/check.ps1:102`, `scripts/run-pre-push.py:253`). · NOT re-measured: criterion "existing findings are shown as tracked transitional debt" is currently vacuous — `scripts/architecture-boundaries-baseline.json` now holds `entries: []` (0 entries) and the live run reports 0 tracked / 0 new-expired blocking / 0 stale across 40 crates and 584 dependency edges. The mechanism is still tested ("suppresses a known finding but keeps it visible as tracked debt"), so the criterion is satisfiable, not broken. The unchecked boxes are deliberately left alone: this file is a validation plan in `_active/`, and whether the spec is done is the owner's call, not a doc-accuracy finding. · Left deliberately, matching the recorded finding in `manager-codebase-review-checklist.md`: `--strict` is parsed and never read, so the `--strict` invocation below is a no-op flag on an otherwise-correct command. Removing it is a gate-surface change across three CI lanes, not a doc correction. -->

# Validation plan

## Acceptance criteria

- [ ] The checker runs from the repository root on Windows and POSIX shells.
- [ ] The checker obtains the real Cargo graph through `cargo metadata` when no
      fixture is supplied.
- [ ] A metadata fixture can be supplied for deterministic tests.
- [ ] Normal production module-to-module dependencies are reported.
- [ ] `oz-core` production dependencies on business modules are reported.
- [ ] `platform-startup` composition dependencies are allowed by explicit rule.
- [ ] Dev-only dependencies do not fail the strict gate.
- [ ] Direct production UI `invoke()` calls outside `ui/src/api/` are reported.
- [ ] API-layer calls, comments, tests, and dev mocks do not create findings.
- [ ] Existing findings are shown as tracked transitional debt.
- [ ] A new finding not present in the baseline exits non-zero.
- [ ] An expired or stale baseline entry exits non-zero.
- [ ] `--report-only` exits zero while still showing findings.
- [ ] `--json` output is stable and contains rule, path, line, target, and
      `baseline_status` (the emitted key name; values `new`, `tracked`, `stale`).
- [ ] Malformed metadata exits with a distinct non-zero error code.
- [ ] No runtime Rust, database, Tauri, or UI behavior changes.

## Required tests

The script test suite must cover:

1. clean fixture;
2. module-to-module production dependency;
3. `oz-core` upward dependency;
4. allowed `platform-startup` composition dependency;
5. dev-dependency exclusion;
6. direct UI invoke outside API;
7. allowed API-layer invoke;
8. comments/test/dev-mock exclusion;
9. baseline suppression with report visibility;
10. new violation failure;
11. expired baseline failure;
12. malformed metadata failure;
13. Windows path normalization;
14. JSON output schema basics.

## Commands

Focused tests:

```bash
node --test scripts/__tests__/verify-architecture-boundaries.test.mjs
python3 scripts/verify-architecture-boundaries.py --report-only
python3 scripts/verify-architecture-boundaries.py --json
```

Static validation after implementation:

```bash
python3 scripts/verify-architecture-boundaries.py --strict
cargo fmt --all -- --check
```

The checker is wired into the repository gate
(`.github/workflows/dev-ci.yml:918`, static-gates step "Architecture
boundaries"), so validate the gate vocabulary too:

```bash
python3 scripts/verify-ci-docs-drift.py
```

The full workspace test/clippy gates are not required to validate the first
static-only pilot unless the implementation changes Rust source or manifests.

> last audited 29-09-26 by docs-auditor
