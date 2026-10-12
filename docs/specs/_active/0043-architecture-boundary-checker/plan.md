<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (2 minor) · Fresh full audit; the 2026-09-29 stamp is merged at the bottom. · F1 (a stale evidence list presented as current, MINOR but load-bearing for anyone reconstructing the pilot): the §2 Evidence baseline named THREE production direct-`invoke()` offenders, and two of the three paths no longer exist — `ui/src/frontend/shell/UpdateBanner.tsx` (the `ui/src/frontend/` root is gone; the banner is `ui/src/app/UpdateBanner.tsx`) and `ui/src/hooks/useCloudSync.ts` (removed). Only `ui/src/hooks/useGatewayStatus.ts` still exists. Annotated in place with the re-derive command; the list is kept because it is the audit that MOTIVATED the pilot, not a claim about today. · F2 (a count that moved, as expected): §2 says the workspace "contains 29 members"; `cargo metadata --no-deps` on 2026-10-11 lists **40**. Annotated as a 2026-08-06 snapshot. · ALSO NOTED, not repaired as drift: the evidence sentence calls the core crate `oz-core` while the §2 anchor list on the same page correctly cites `crates/kasirmu-core/…` — `oz-core` is the pre-rebrand name, left as the name the 2026-08-06 audit recorded. And §6 says the initial baseline should hold the known findings; the SHIPPED baseline (`scripts/architecture-boundaries-baseline.json`) holds an empty `entries` array — zero — so those findings were fixed rather than parked, which the added note records without changing the policy. · VERIFIED AND LEFT ALONE (re-measured, not inherited): the checker exists with its test suite and a checked-in baseline (`scripts/verify-architecture-boundaries.py`, `scripts/__tests__/verify-architecture-boundaries.test.mjs`, `scripts/architecture-boundaries-baseline.json`); every CLI flag the §5 output contract lists is real (`--report-only`, `--strict`, `--json`, `--root`, `--metadata-file`); the gate is wired (`scripts/check.sh:178`, `.github/workflows/dev-ci.yml:1048` step "Architecture boundaries"); `ARCHITECTURE.md` Rules 2 and 3 exist at :62 and :82; `crates/kasirmu-core/Cargo.toml` and the cited source files resolve. LIVE RUN 2026-10-11, `--report-only`: 0 tracked transitional findings, 2 new blocking findings, over 40 crates / 586 edges / 620 UI files — exactly the shape the spec's output contract specifies. · NOT re-measured: the rule set's completeness, and the two new blocking findings it now reports (a code matter for their owners, `event-sink-seam` in both shells' `qris_listener.rs`). · Prior evidence retained verbatim below. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim:
<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It is a spec, one of the numbered series in this directory, and it proposes a read-only static checker that makes documented boundaries mechanically visible. · ITS DECISION FRAMING IS THE PART WORTH KEEPING, and it is better than most specs in this repository manage. The document asks for a checker that makes boundaries VISIBLE first, then adds a controlled strict mode, and it explicitly refuses to pretend that existing transitional debt is already resolved. That last clause is the whole design in one sentence: a boundary checker that fails on day one against a codebase mid-restructure gets disabled, and a boundary checker with a baseline gets adopted. · THE SUBSTRATE IS REAL, and this is the checkable part. The checker exists in the repository's script set with its own test suite and, crucially, with a CHECKED-IN BASELINE — the artefact that makes a boundary gate a ratchet rather than a moving target, and the same property this campaign verified as load-bearing when it checked the testid checker's baseline in an earlier round. The rule set the spec describes is also live: the platform-core boundary enforcement this campaign has met in several documents is the output of this spec, and the toolkit-purity rule that keeps the command bridge headless is one of its named boundaries. · A CROSS-DOCUMENT NOTE that gives the spec its context: the decision that made design rules enforceable rather than aspirational sits alongside it, and this campaign audited that decision two rounds ago. The spec and that decision together are the reason a claim like a crate may not depend on the UI toolkit is checkable at all, and a reader who wants the WHY should read both. · NOT re-measured: the rule set itself, the baseline's current debt count, or whether the checker passes today. Running it is the original work, and this stamp deliberately does not claim the gate is green. · No stamp existed; this is the first. -->
-->

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

- The Cargo workspace contains 29 members. *(2026-08-06 measurement. Re-measured
  2026-10-11 with `cargo metadata --no-deps`: **40** packages — the list has grown, as it
  was expected to; the count is a snapshot, not a target.)*
- `oz-core` has normal path dependencies on ten business modules and re-exports
  module-owned models from `crates/kasirmu-core/src/`. *(`oz-core` is the pre-rebrand
  name; the crate is `kasirmu-core` at `crates/kasirmu-core/` today. Left as the name
  the 2026-08-06 audit recorded.)*
- No broad runtime refactor should begin until dependency ownership is explicit.
- Production UI code calls `invoke()` directly outside `ui/src/api/` in:
  - `ui/src/frontend/shell/UpdateBanner.tsx`
  - `ui/src/hooks/useGatewayStatus.ts`
  - `ui/src/hooks/useCloudSync.ts`

  *(2026-10-11: two of these three paths are dead. `ui/src/frontend/` no longer exists —
  the banner is `ui/src/app/UpdateBanner.tsx` — and `ui/src/hooks/useCloudSync.ts` is
  gone. `ui/src/hooks/useGatewayStatus.ts` still exists. Re-derive the live set with
  `python3 scripts/verify-architecture-boundaries.py --report-only`; on 2026-10-11 it
  reports **0 tracked transitional findings** against an EMPTY baseline, so this
  pre-baseline evidence list was superseded by the checker's own output and is retained
  as the audit that motivated the pilot.)*
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
*(2026-10-11: the shipped baseline is `scripts/architecture-boundaries-baseline.json`
with `"entries": []` — zero entries — so those known findings were resolved rather
than parked. The policy below is unchanged; only the initial population is empty.)*

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

> last audited 11-10-26 by docs-auditor
