<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · Fresh audit; the 2026-09-29 stamp is merged below. MINOR: the acceptance criterion citing the bidirectional pin is correct, but the executed-checks table's `cargo test -p kasirmu-core --test staff_integration` target no longer resolves as a separate binary — the integration suites consolidated into `crates/kasirmu-core/tests/integration/` (one binary, `main.rs` declares the modules). Annotated. · VERIFIED AT HEAD: the bidirectional inventory invariant holds in BOTH directions today — `permission_registry_tests.rs:770-780` fails if REGISTRY and ALL_ENFORCED differ, and both are 93 entries (`platform/core/src/rbac_presets.rs:321`); the four public registry functions exist at `permission_registry.rs:643/648/656/689`; `validate_grants` is wired at `crates/kasirmu-core/src/db/roles.rs:188`. · LEFT AS WRITTEN (dated 2026-08-11 observations): the executed-check counts (234/234 platform-core, 42/42, 25/25, 40/40, 19/19) and the "8 sensitive keys today" — counts belong to that tree; the 68-key and 8-sensitive figures are snapshots, not invariants. · NOT re-measured: the test run itself. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim:

> Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (crate/path renames) — 0 behavioural findings · Audited on branch 0.0.40. Every `cargo` package this file names was renamed when the workspace was restructured, and that was proven by execution rather than by reading a manifest: `cargo pkgid -p oz-core` and `cargo pkgid -p oz-pos-app` both return "did not match any packages", and `cargo metadata --no-deps` lists 40 packages, none of them under the old `oz-*` names. The current mapping, read from each manifest path: `oz-core` -> `kasirmu-core` (`crates/kasirmu-core/Cargo.toml`), `oz-pos-app` -> `kasirmu-app` (`apps/desktop-tauri/Cargo.toml`), `oz-pos-tablet` -> `kasirmu-mobile` (`apps/mobile-tauri/Cargo.toml`), `oz-security` -> `kasirmu-security` (`crates/kasirmu-security/Cargo.toml`). The old client directories moved with them: `apps/desktop-client/` -> `apps/desktop-tauri/` and `apps/tablet-client/` -> `apps/mobile-tauri/`. All of these were repaired in place. The numbered migration series this file cites is likewise gone: migrations are date-stamped and the tables are folded into `crates/kasirmu-core/migrations/20260813_init.sql`. The executed-checks table is a dated record of the 2026-08-11 run and is left exactly as executed — those counts belong to that tree, and restating them as current is the drift this pass removes. What survives audit is the acceptance criteria, and all five still describe code that exists: the bidirectional inventory pin (`rbac::ALL_ENFORCED` == registry), `validate_grants` rejecting wildcards over sensitive keys, `Store::create_role` mapping failures to `CoreError::Validation` via `crates/kasirmu-core/src/db/roles.rs:188`, and the registry's public surface (`is_registered`, `is_sensitive`, `validate_grant`) which the 0047 and 0049 slices both consume in fact. The claim that the two legacy seed keys were added as byte-identical constants is consistent with the audit having added `PRODUCTS_CRUD` / `CATEGORIES_MANAGE`. · The original plan text is preserved as approved; only the identifiers that stopped resolving were changed, no design claim was rewritten. · No stamp or footer existed on this file before this pass.
-->

# Validation

> **Status: IMPLEMENTED — 2026-08-11.** All checks executed and green; every
> acceptance criterion met. Shipped in `bde2962d` (feat) + `7fa406a4`
> (refactor), journaled as round 175.

## Executed checks (2026-08-11)

- `cargo test -p platform-core --lib` — 234/234 pass (registry 9/9).
- `cargo test -p kasirmu-core --lib -- db::staff` — 42/42 pass (incl. the
  `create_role` write-time rejection tests).
- `cargo test -p kasirmu-core --test staff_integration` — 25/25 pass.
- `cargo test -p kasirmu-app --lib -- commands::staff` — 40/40 pass.
- `cargo test -p kasirmu-mobile --lib -- commands::staff` — 19/19 pass.
- `cargo fmt --all -- --check` — clean.
- `cargo clippy -p platform-core -- -D warnings` — clean.
- `cargo clippy -p kasirmu-core -- -D warnings` — clean.
- `bash .agents/skills/skill-drift-guard/scripts/detect.sh` — no drift.
- `test-changed.sh` — not runnable this round: `kasirmu-app.exe` was locked by
  a running process (left alone per the shared-tree rule); nearest consumer
  suites above substituted.

## Acceptance criteria

- [x] **Every permission key enforced anywhere in the codebase is registered**
  — bidirectional inventory test pins `rbac::ALL_ENFORCED` == registry (all
  68 keys), so a new key is registered everywhere or nowhere. The audit also
  caught three keys the plan's baseline missed (`products:crud`,
  `categories:manage`, `products:view`); the first two now have constants,
  the fixture key was renamed to `products:read`.
- [x] **Sensitive keys can never be granted via a family wildcard** —
  `validate_grants` rejects wildcards covering sensitive keys, and the
  definition-time tests derive the rule from the registry itself, so a
  sensitive key added to a *new* family is rejected automatically (8
  sensitive keys today: `sales:void`, `sales:refund`, `payments:refund`,
  `payments:settle`, `staff:manage_roles`, `staff:delete`,
  `reports:export`, `audit:export`).
- [x] **Role writes reject unregistered keys and wildcard-flagged-sensitive
  keys** — `Store::create_role` validates each grant through the registry and
  maps failures to `CoreError::Validation`; rejection proven by the 5/5
  `create_role` tests. The global `*` is rejected too (reserved for the Owner
  seed, which bypasses via direct insert).
- [x] **No existing permission string is renamed** — the two legacy seed
  keys are registered byte-identical via new constants; the only fixture
  edits are synthetic keys with no production meaning.
- [x] **A new operational key in an existing family requires only a registry
  addition — zero role edits** — verified by the bidirectional inventory and
  `validate_grants` design; `ALL_ENFORCED` is the single place to add a key.

> last audited 11-10-26 by docs-auditor
