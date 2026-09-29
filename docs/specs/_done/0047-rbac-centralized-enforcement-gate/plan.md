<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (crate/path renames) — 0 behavioural findings · Audited on branch 0.0.40. Every `cargo` package this file names was renamed when the workspace was restructured, and that was proven by execution rather than by reading a manifest: `cargo pkgid -p oz-core` and `cargo pkgid -p oz-pos-app` both return "did not match any packages", and `cargo metadata --no-deps` lists 40 packages, none of them under the old `oz-*` names. The current mapping, read from each manifest path: `oz-core` -> `kasirmu-core` (`crates/kasirmu-core/Cargo.toml`), `oz-pos-app` -> `kasirmu-app` (`apps/desktop-tauri/Cargo.toml`), `oz-pos-tablet` -> `kasirmu-mobile` (`apps/mobile-tauri/Cargo.toml`), `oz-security` -> `kasirmu-security` (`crates/kasirmu-security/Cargo.toml`). The old client directories moved with them: `apps/desktop-client/` -> `apps/desktop-tauri/` and `apps/tablet-client/` -> `apps/mobile-tauri/`. All of these were repaired in place. The numbered migration series this file cites is likewise gone: migrations are date-stamped and the tables are folded into `crates/kasirmu-core/migrations/20260813_init.sql`. The gate itself is real and is still the single authorizer this plan set out to build: `require_permission` is defined and called from `apps/desktop-tauri/src/commands/authz.rs`, `apps/mobile-tauri/src/commands/authz.rs` and `crates/kasirmu-bridge/src/ctx.rs`, and the pinned census test this plan's §4.3 promised survives as `apps/desktop-tauri/tests/gate_audit.rs` — its path was the one place the restructure moved the test itself rather than just the crate, and it is now cited by two other modules in their own doc comments (`apps/desktop-tauri/src/commands/registration_gate_tests.rs:30` and the mobile twin), which is independent evidence that the file is load-bearing and not orphaned. The Deviations section's admission that the census pins at module granularity — so a new ungated command inside an already-pinned module still needs review — is the kind of limitation that is usually quietly dropped from a shipped spec, and it is still written down here. That is accurate, not stale. · The original plan text is preserved as approved; only the identifiers that stopped resolving were changed, no design claim was rewritten. · No stamp or footer existed on this file before this pass. -->
# RBAC centralized fail-closed enforcement gate

> **Status: IMPLEMENTED — 2026-08-11.** Shipped in two commits
> (`47fcf6a5`, `ef0707e1`); moved to `_done/`. See §10 for the completion
> record. The sections below are the original plan as approved.

## 1. Decision requested

Introduce the single backend `require_permission(permission)` gate that ADR
#35 D3 requires, migrate every permission-sensitive command onto it, and pin
the set of gated commands with a test so a new command that skips the gate is
caught by the suite. This is D9 step 2 and depends on the 0046 registry.

## 2. Evidence baseline

- Enforcement today is per-command `require_permission_for_user(store,
  user/role, permission)` — e.g. `apps/desktop-tauri/src/commands/authz.rs`,
  `customers.rs`, `exchange_rates.rs`, `loyalty.rs` (desktop and tablet).
- Rounds 172 and 174 found real gaps of exactly this class: `list_customers_scoped`
  resolved the session but skipped the `customers:view` gate (CRM-02), and
  `create_exchange_rate` skipped field validation entirely (CUR-05). The fixes
  landed per-command; the class of "command forgot its gate" is not prevented.
- Frontend gating exists in places and is presentation only.

## 3. Problem statement

A permission model is only as strong as its weakest command. With per-command
gates, "did every command gate itself?" is answered by review and by audit —
both of which missed instances. A single gate plus a pinned gated-command set
turns the question into a compile/test-time guarantee and gives ADR #35's
fail-closed rule one place to live.

## 4. Scope of the slice

### 4.1 The gate

`require_permission(permission)` on the backend resolves the caller's role
through the 0046 registry (family wildcards, sensitive keys, `"*"`), and denies
by default: an unregistered permission or an unresolvable role fails closed.

### 4.2 Command migration

Every existing `require_permission_for_user` call site moves onto the gate.
No command behavior changes; only the enforcement channel does.

### 4.3 Pinned gated-command set

A test enumerates the permission-sensitive commands and asserts each passes
through the gate. The list is explicit and reviewed — a new command must be
added to it, which is the review signal.

## 5. Implementation plan

1. Add the gate on top of the 0046 registry with deny-by-default semantics.
2. Write the failing test: a command that skips the gate is detected (Red).
3. Migrate the command call sites (Green), keeping round-172/174 tests green.
4. Add the pinned gated-command enumeration test.
5. Run area tests: `cargo test -p kasirmu-app --lib`, `cargo test -p kasirmu-mobile
   --lib`, `test-changed.sh`, fmt, clippy on both clients.

## 6. Test plan

### Existing tests (migration contract — must stay green unmodified)

- Round-172 `customers.rs` tests (desktop + tablet) and round-174
  `exchange_rates.rs` tests (desktop + tablet): they assert observable command
  behavior, so re-pointing the enforcement channel must not touch them.
- `commands::authz` unit tests — re-pointed at the gate if any assert on
  `require_permission_for_user` directly (implementation detail).

### New tests (Red first)

- Deny-by-default: an unregistered permission key denies; an unresolvable
  role denies.
- Pinned gated-command set: a test enumerates every permission-sensitive
  command and fails for one that skips the gate — a new ungated command is
  caught by the suite.
- The gate resolves family wildcards and sensitive keys through the 0046
  registry.

## 7. Security and correctness considerations

- The gate must be the only authorizer: a frontend role check never gates a
  backend pass, and no second parallel enforcement path is introduced.
- Resolution errors deny, never allow.
- Session resolution stays where it is today; this slice only centralizes the
  permission check (assignment scopes arrive in 0048).

## 8. Non-goals

- Branch/workspace assignment scopes (0048).
- Profile fields (0049) and caching (ADR #35 D7).
- UI redesign beyond removing frontend-only gating that exists.

## 9. Rollback plan

The gate wraps the existing checks; reverting it restores the per-command
pattern without data or schema impact. The pinned command-set test is the
canary — if it flags false positives (a gated command that was already
internal), the list is corrected deliberately, not broadened silently.

## 10. Completion record (2026-08-11)

**What shipped.**

- `Store::require_permission(user_id, required)` in `kasirmu-core` is the single
  fail-closed authorizer (ADR #35 D3): the 0046 registry is the only
  vocabulary (unregistered key denies even the `*` Owner grant), and an
  unknown/inactive user or unresolvable role denies as
  `CoreError::PermissionDenied` (role-missing is a denial, never `Internal`).
- Both clients' `authz.rs` became thin wrappers mapping
  `CoreError::PermissionDenied` to the existing `AppError::PermissionDenied`
  wire shape — `kind: "permissionDenied"` unchanged, no UI contract change.
- The tablet's dead role-based `require_permission` (zero callers, a second
  parallel enforcement path) was removed per §7's "the gate must be the only
  authorizer".
- New `apps/desktop-tauri/tests/gate_audit.rs` pins the full gated-command
  census of both clients: every command module with its gate-call count and
  permission keys, bidirectionally. A new command module, a dropped gate
  call, or a changed key surface fails the suite and forces a deliberate,
  reviewed pin update. Every gated key resolves through its real constant to
  `is_registered` (renaming a constant breaks the match arm); raw
  string-literal permissions at gate call sites are pinned out of existence.

**Deviations from the plan.**

- The census pins at *module* granularity (gate-call count + key surface per
  file), not per command function: a new command inside an already-pinned
  module that adds a gate call changes the count and is caught, but one that
  silently skips the gate has no intent signal for the suite to detect —
  that remains review's job, documented in the test's module docs.
- The Red for the census was demonstrated with deliberately corrupted pins
  (wrong count, missing module), both caught; the registry-linkage assertion
  was initially written comparing constant names to registry values and
  self-corrected to resolve names through the real constants.
- Runnable verification was partially blocked by running app binaries
  (`kasirmu-app` via another agent's `cargo run`, `kasirmu-mobile` via
  `tauri dev`); area-scoped `--lib` suites ran normally, and the audit test
  was executed by running its built harness directly against current
  sources.

**Verify evidence.** Gate 8/8 (kasirmu-core `db::staff` 50/50) · desktop
`authz`/`customers`/`exchange_rates` 56/56 · tablet 55/55 · `gate_audit`
3/3 · `cargo fmt --check` clean · clippy `-D warnings` clean on kasirmu-core,
kasirmu-app, kasirmu-mobile · drift guard clean · enforcement sweep: zero
`.authorize()`/`has_permission()` callers in `apps/` and `modules/` outside
the gate.

**Commits.** `47fcf6a5` (feat: centralized gate + client wrappers),
`ef0707e1` (test: pinned gated-command census), `34464e79` (docs: spec
moved to `_done`).

> last audited 29-09-26 by docs-auditor
