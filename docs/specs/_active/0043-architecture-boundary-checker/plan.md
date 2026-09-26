# Architecture boundary checker v1

## 1. Decision requested

Build a read-only static checker that makes the most important documented
boundaries mechanically visible, then add a controlled strict mode that blocks
new violations without pretending that existing transitional debt is already
resolved.

The pilot is intentionally enforcement-oriented but does not change runtime
code. Existing architecture debt remains visible in reports and is tracked in
a time-bounded baseline allowlist.

## 2. Evidence baseline

The Phase 1/2 audit verified:

- The Cargo workspace contains 29 members.
- `oz-core` has normal path dependencies on ten business modules and re-exports
  module-owned models from `crates/kasirmu-core/src/`.
- No broad runtime refactor should begin until dependency ownership is explicit.
- Production UI code calls `invoke()` directly outside `ui/src/api/` in:
  - `ui/src/frontend/shell/UpdateBanner.tsx`
  - `ui/src/hooks/useGatewayStatus.ts`
  - `ui/src/hooks/useCloudSync.ts`
- The architecture documents state that module boundaries and the UI API
  boundary are enforced rules, but the current repository does not enforce
  them mechanically.

Relevant anchors:

- `Cargo.toml`
- `crates/kasirmu-core/Cargo.toml`
- `crates/kasirmu-core/src/product.rs`
- `crates/kasirmu-core/src/db/settings.rs`
- `ARCHITECTURE.md` Rule 2 and Rule 3
- `docs/ARCHITECTURE.md` UI API rule

## 3. Problem statement

Architecture rules currently depend on contributor discipline and grep-based
reviews. This permits new dependency edges and new direct IPC calls to enter
the codebase unnoticed. A future extraction of `oz-core`, or consolidation of
the desktop/tablet API, becomes harder every time a new edge is added.

The checker must distinguish:

1. Existing transitional debt that is known and tracked.
2. New boundary violations introduced by a change.
3. False positives caused by tests, comments, generated mocks, or approved
   compatibility surfaces.

## 4. Scope of v1

### 4.1 Cargo dependency direction

Inspect workspace path dependencies using `cargo metadata --no-deps
--format-version 1`.

Report these findings:

- `module-to-module`: a business module has a normal/production path
  dependency on another business module.
- `core-upward-dependency`: `oz-core` has a normal/production path dependency
  on a business module.
- `platform-to-business`: a platform crate other than `platform-startup`
  directly depends on a business module.

The checker must distinguish normal dependencies from dev-dependencies.
Dev-dependencies remain reportable as informational context but do not fail the
strict gate in v1.

Approved orchestration dependencies for `platform-startup` are not violations.
Application crates may depend on modules because they are composition roots.
Those exceptions must be encoded as policy, not silently ignored.

### 4.2 Frontend IPC boundary

Scan production TypeScript/TSX under `ui/src`, excluding tests and dev mocks.
Report direct imports or calls to Tauri `invoke()` outside approved API adapter
paths:

- `ui/src/api/**`
- explicitly documented infrastructure adapters, if any are added later

The checker must not flag the word `invoke()` in comments or test mocks.

## 5. Output contract

The script is `scripts/verify-architecture-boundaries.py` and supports:

```text
python3 scripts/verify-architecture-boundaries.py
python3 scripts/verify-architecture-boundaries.py --report-only
python3 scripts/verify-architecture-boundaries.py --strict
python3 scripts/verify-architecture-boundaries.py --json
python3 scripts/verify-architecture-boundaries.py --root <path>
python3 scripts/verify-architecture-boundaries.py --metadata-file <path>
```

Default output is a concise human-readable report grouped by finding type.
`--json` emits stable machine-readable output for CI and future dashboards.
Each finding includes:

- stable rule ID
- category (`cargo` or `ui`)
- severity (`P1` or `P2`)
- source path
- line number when available
- dependency/call target
- baseline status
- remediation hint

Exit behavior:

- `--report-only`: always exits 0 after producing the report.
- default mode: exits 0 when no un-baselined violations exist; exits 1 when
  new violations are found.
- `--strict`: same policy as default, with no downgrade for local developer
  invocation.
- malformed metadata or unreadable source exits 2 and is never treated as a
  clean result.

## 6. Transitional baseline policy

Create `scripts/architecture-boundaries-baseline.json` with individual,
reviewable entries for known existing findings. Each entry must contain:

- `rule`
- `path`
- `target` or a stable finding signature
- `reason`
- `owner`
- `introduced`
- `expires`

The baseline is not permission to add more debt. The checker must fail when:

- a new finding is not in the baseline,
- a baseline entry expires,
- a baseline entry points at a missing source,
- a finding changes target or signature unexpectedly.

The initial baseline should contain only the already verified `oz-core` upward
edges and the four production direct-`invoke()` locations. Do not baseline
hypothetical findings.

Because the baseline itself contains architecture debt, reports must show both:

- `tracked transitional findings`
- `new blocking findings`

## 7. Implementation plan

1. Add the Python checker using only the standard library and subprocess.
2. Add a metadata fixture option so tests do not need to compile or depend on
   the live workspace graph.
3. Add fixture source trees for positive and negative Cargo/UI cases.
4. Add `scripts/__tests__/verify-architecture-boundaries.test.mjs`, following
   the existing subprocess-based script test convention.
5. Generate the initial baseline from the Phase 1 evidence, reviewing every
   entry manually.
6. Run the checker in report-only mode and compare its output with the audit
   findings.
7. Add the checker as a required `architecture-boundaries` gate to:
   - `scripts/check.sh`
   - `scripts/check.ps1`
   - `scripts/gates.json`
   - the CI docs drift vocabulary/documentation
8. Keep existing violations non-blocking only through the explicit baseline.
9. Update the canonical architecture documentation to state that the checker
   enforces *new* violations while existing transitional edges remain tracked.

## 8. Security and correctness considerations

- Never execute source files discovered during scanning.
- Never use shell interpolation for paths or Cargo commands.
- Treat malformed Cargo metadata as a checker failure.
- Normalize Windows and POSIX path separators before comparing paths.
- Do not scan `target/`, `node_modules/`, generated UI output, or gitignored
  artifacts.
- Do not classify a test-only dependency as a production boundary violation.
- Do not infer runtime authorization from the static checker; IPC scoping is a
  separate security audit.

## 9. Non-goals

- Removing any existing dependency or compatibility edge.
- Moving models out of `oz-core`.
- Converting repositories to a new database abstraction.
- Refactoring the event bus.
- Changing sync conflict or replay behavior.
- Reconciling the desktop/tablet command surfaces.
- Automatically editing source files or documentation.

## 10. Rollback plan

The pilot is removable by deleting the checker, test, baseline, and gate
entries. It has no runtime or database impact. If the strict gate produces
false positives, temporarily run it report-only while correcting the parser or
policy; do not add broad wildcard baseline entries.
