<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (crate/path renames) — 0 behavioural findings · Audited on branch 0.0.40. Every `cargo` package this file names was renamed when the workspace was restructured, and that was proven by execution rather than by reading a manifest: `cargo pkgid -p oz-core` and `cargo pkgid -p oz-pos-app` both return "did not match any packages", and `cargo metadata --no-deps` lists 40 packages, none of them under the old `oz-*` names. The current mapping, read from each manifest path: `oz-core` -> `kasirmu-core` (`crates/kasirmu-core/Cargo.toml`), `oz-pos-app` -> `kasirmu-app` (`apps/desktop-tauri/Cargo.toml`), `oz-pos-tablet` -> `kasirmu-mobile` (`apps/mobile-tauri/Cargo.toml`), `oz-security` -> `kasirmu-security` (`crates/kasirmu-security/Cargo.toml`). The old client directories moved with them: `apps/desktop-client/` -> `apps/desktop-tauri/` and `apps/tablet-client/` -> `apps/mobile-tauri/`. All of these were repaired in place. The numbered migration series this file cites is likewise gone: migrations are date-stamped and the tables are folded into `crates/kasirmu-core/migrations/20260813_init.sql`. Dated executed-checks table left as run. The acceptance criteria survive, and the residency criterion — the one most likely to rot silently, since nothing fails if a profile column quietly joins a sync payload — is still pinned: `SnapshotUser` is defined and enforced in `crates/kasirmu-core/src/sync_pull.rs` with its test in `crates/kasirmu-core/src/sync_client_tests.rs`. The encryption criterion correctly carries a warning marker rather than a tick, and its stated reason (a dependency cycle that made the keyring route impossible) is still true; the implementation now resolves through `crates/kasirmu-crypto` behind the `kasirmu-core` crypto shim as described in the sibling plan's stamp. The masking and read-audit criterion maps to the live `mask_last4` and `get_user_profile_viewed_by` pair, and all four cited UI test files exist (`StaffManagementScreen.test.tsx`, `api-staff-contract.test.ts`, `StaffLoginScreen.test.tsx`, `StaffLoginKeyboard.test.tsx`). · The bare `cargo clippy` note about 2 pre-existing errors in `topology.rs` is a 2026-08-11 observation and is left as the record of that run. · The original plan text is preserved as approved; only the identifiers that stopped resolving were changed, no design claim was rewritten. · No stamp or footer existed on this file before this pass. -->
# Validation

## Focused checks

- `cargo fmt --all -- --check`
- `bash scripts/test-tdd.sh -p crates/kasirmu-core`
- `cargo test -p kasirmu-core migrations::tests -- --nocapture`
- `cargo test -p kasirmu-app --lib -- commands::staff -- --nocapture`
- `cargo test -p kasirmu-mobile --lib -- commands::staff -- --nocapture`
- `cargo test -p kasirmu-security -- --nocapture`
- `cargo clippy -p kasirmu-core -p kasirmu-app -p kasirmu-mobile -p kasirmu-security -- -D warnings`
- `cd ui && npx vitest run src/__tests__/StaffManagementScreen.test.tsx src/__tests__/api-staff-contract.test.ts`
- `cd ui && npx tsc --noEmit`
- `bash .agents/skills/skill-drift-guard/scripts/detect.sh`

## Executed results

| Check | Result |
|---|---|
| `cargo fmt --all -- --check` | ✅ clean |
| `cargo test -p kasirmu-core --lib` | ✅ 1727/1727 (profile 17/17 incl. encryption-at-rest, mask, read-audit, fail-closed, assign_role_guarded; crypto 3 new; migrations 130 + 131) |
| `cargo test -p kasirmu-core --test staff_integration` | ✅ 25/25 |
| `cargo test -p platform-core --lib` | ✅ 237/237 (incl. profile sensitive-key registry test) |
| `cargo test -p platform-sync --lib` | ✅ 276/276 (incl. snapshot-user residency pin) |
| `cargo test -p kasirmu-app --lib` | ✅ 890/890 (staff 40/40) |
| `cargo test -p kasirmu-mobile --lib` | ✅ 428/428 (staff 19/19) |
| `cargo clippy -p kasirmu-core -p platform-core -p platform-sync -p kasirmu-app -p kasirmu-mobile --lib --tests -- -D warnings` | ✅ clean on the changed area (2 pre-existing errors in `topology.rs`, untouched by 0049) |
| `cd ui && npx vitest run src/__tests__/StaffManagementScreen.test.tsx src/__tests__/api-staff-contract.test.ts` | ✅ 17/17 + 4/4 |
| `cd ui && npx tsc --noEmit` | ✅ clean |
| `cd ui && npm run lint` | ✅ 0 errors (8 pre-existing warnings in other files) |
| `python scripts/verify-bundle-parity.py` | ✅ 0 missing keys (en + id) |
| `bash .agents/skills/skill-drift-guard/scripts/detect.sh` | ✅ no drift |

## Acceptance criteria

- ✅ Creation requires the 9 mandatory fields with field-specific validation
  (national ID per type + UNIQUE when present, email format + UNIQUE, phone
  E.164, DOB not in the future, monthly take-home pay > 0 minor units) —
  `UserProfile::validate` matrix test + `create_user_with_profile` rejects
  incomplete; uniqueness via email index + national-id hash index.
- ✅ Legacy rows enter the incomplete-profile state: checkout login works
  (`legacy_create_user_leaves_incomplete_profile`), user flagged in staff
  management (`is_profile_complete` DTO + badge test), management-role
  assignment and sensitive grants gated (`assign_role_guarded` /
  `require_role_assignable` test; UI disables role + workspace controls).
- ⚠️ `national_id` and `monthly_take_home_minor` encrypt at rest and decrypt
  on explicit grant; failures fail closed — implemented in `oz_core::crypto`
  (domain-separated AES-GCM) rather than the kasirmu-security keyring because
  kasirmu-security depends on kasirmu-core (cycle is impossible); deviation recorded in
  JOURNAL.md round 179.
- ✅ `national_id` displays as last-4 by default; full value only via the
  explicit grant (`get_user_profile_viewed_by` + `mask_last4` test; UI
  renders the masked value only); audit events record access, never values
  (`view_with_grants_returns_full_values_and_audits`).
- ✅ Sensitive fields never appear in cloud sync or bulk export payloads —
  `SnapshotUser` wire-format pin test; the sync upsert touches no profile
  columns.
- ✅ Deactivation never deletes identity, payroll, or emergency contact data
  (`deactivation_preserves_profile`).
- ✅ The staff form enforces the 9 required fields with localized per-field
  errors (`validateProfileForm` + inline field-error test); national_id
  renders last-4 in list (`renders the national id masked to last-4` test);
  incomplete-profile users are flagged with management controls disabled
  (`flags incomplete-profile users` + `disables role and workspace
  assignment` tests).
- ✅ The staff IPC wire shape including the profile fields is pinned by
  `api-staff-contract.test.ts` (4/4).

> last audited 29-09-26 by docs-auditor
