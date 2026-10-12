<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE (0 findings) · Fresh audit; the 2026-09-29 stamp is merged below. No repair needed — every acceptance criterion still describes code that exists. · VERIFIED: the single fail-closed authorizer is real (`Store::require_permission`, `crates/kasirmu-core/src/db/staff.rs:320`); `apps/desktop-tauri/tests/gate_audit.rs` exists and is the pinned census the criterion names; both clients' command modules the executed-checks table lists resolve 2/2; `kds.rs` present in both. · LEFT AS WRITTEN: the executed-checks table (50/50, 56/56, 55/55, 3/3) is a dated record of the 2026-08-11 run — those counts belong to that tree, and restating them as current is the drift this pass removes. The `test-changed.sh` blocked-by-running-binaries note is a dated environment observation. · NOT re-measured: the test suites themselves. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim:

> Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (crate/path renames) — 0 behavioural findings · Audited on branch 0.0.40. Every `cargo` package this file names was renamed when the workspace was restructured, and that was proven by execution rather than by reading a manifest: `cargo pkgid -p oz-core` and `cargo pkgid -p oz-pos-app` both return "did not match any packages", and `cargo metadata --no-deps` lists 40 packages, none of them under the old `oz-*` names. The current mapping, read from each manifest path: `oz-core` -> `kasirmu-core` (`crates/kasirmu-core/Cargo.toml`), `oz-pos-app` -> `kasirmu-app` (`apps/desktop-tauri/Cargo.toml`), `oz-pos-tablet` -> `kasirmu-mobile` (`apps/mobile-tauri/Cargo.toml`), `oz-security` -> `kasirmu-security` (`crates/kasirmu-security/Cargo.toml`). The old client directories moved with them: `apps/desktop-client/` -> `apps/desktop-tauri/` and `apps/tablet-client/` -> `apps/mobile-tauri/`. All of these were repaired in place. The numbered migration series this file cites is likewise gone: migrations are date-stamped and the tables are folded into `crates/kasirmu-core/migrations/20260813_init.sql`. Dated executed-checks table left as run. The acceptance criteria survive in code: the four deny-by-default cases the criteria enumerate all assert `CoreError::PermissionDenied` through the same `Store::require_permission` path still present at `apps/desktop-tauri/src/commands/authz.rs` and `apps/mobile-tauri/src/commands/authz.rs`, and the census that produced the recorded drift message (`kds.rs gate-call count drifted: pin says 14, source has 15`) is the live `apps/desktop-tauri/tests/gate_audit.rs`. Worth flagging for whoever re-runs this slice: that pin set has since been bumped again for staff (0048 bumped it 5->6 for 0049's `get_staff_profile_scoped`, per the 0048 validation record), so the specific numbers in this table are historical even though the mechanism is not. · The original plan text is preserved as approved; only the identifiers that stopped resolving were changed, no design claim was rewritten. · No stamp or footer existed on this file before this pass.
-->

# Validation — 0047 centralized fail-closed enforcement gate

**Status: IMPLEMENTED — 2026-08-11.** All focused checks executed; all
acceptance criteria met. See plan §10 for the completion record.

## Executed checks

| Check | Command | Result |
|---|---|---|
| Formatting | `cargo fmt --all -- --check` | ✅ clean |
| Gate behavior (kasirmu-core) | `cargo test -p kasirmu-core --lib -- db::staff` | ✅ 50/50 (gate 8/8) |
| Desktop migration contract | `cargo test -p kasirmu-app --lib -- commands::authz commands::customers commands::exchange_rates` | ✅ 56/56 |
| Tablet migration contract | `cargo test -p kasirmu-mobile --lib -- commands::authz commands::customers commands::exchange_rates` | ✅ 55/55 |
| Pinned gated-command census | `cargo test -p kasirmu-app --test gate_audit` | ✅ 3/3 |
| Lint | `cargo clippy -p kasirmu-core -- -D warnings` | ✅ clean |
| Lint | `cargo clippy -p kasirmu-app --lib -- -D warnings` | ✅ clean |
| Lint | `cargo clippy -p kasirmu-mobile --lib -- -D warnings` | ✅ clean |
| Drift guard | `bash .agents/skills/skill-drift-guard/scripts/detect.sh` | ✅ no drift |

Note: `test-changed.sh` could not run — the app binaries are held open by
running processes (`kasirmu-app` via another agent's `cargo run`,
`kasirmu-mobile` via `tauri dev`) and were left alone per the shared-tree
rule. The area-scoped suites above and a direct execution of the built
`gate_audit` harness against current sources cover the changed area.

## Acceptance criteria

- ✅ **Every permission-sensitive command passes through the centralized
  `require_permission(permission)` gate; the pinned gated-command set test
  fails for a command that skips it.** `gate_audit.rs` pins the full census
  of both clients bidirectionally; its Red run (deliberately corrupted pin)
  failed with `kds.rs gate-call count drifted: pin says 14, source has 15`,
  proving drift detection, then went green 3/3 with the true pin. An
  enforcement sweep found zero `.authorize()`/`has_permission()` callers in
  `apps/` or `modules/` outside the gate.
- ✅ **An unregistered permission key or unresolvable role denies by
  default.** `gate_denies_unregistered_permission_even_for_owner` (typo key
  denies the `*` Owner grant), `gate_denies_unknown_user`,
  `gate_denies_inactive_user`, and `gate_denies_user_with_unresolvable_role`
  (FKs off, role row deleted) all assert `CoreError::PermissionDenied`.
- ✅ **Round-172 (customers:view) and round-174 (exchange-rate validation)
  tests stay green — the gate migrates the checks, never weakens them.**
  Desktop `customers`/`exchange_rates` suites 56/56, tablet 55/55 — including
  the round-172/174 denial and validation tests, unmodified.
- ✅ **Frontend role gating is presentation only; no backend pass depends on
  it.** The gate resolves the caller's role from the database
  (`Store::require_permission`), never from frontend-supplied input; the
  client wrappers map only the denial error to the existing `permissionDenied`
  wire shape.

> last audited 11-10-26 by docs-auditor
