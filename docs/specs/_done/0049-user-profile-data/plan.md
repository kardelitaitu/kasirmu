<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (crate/path renames) — 0 behavioural findings · Audited on branch 0.0.40. Every `cargo` package this file names was renamed when the workspace was restructured, and that was proven by execution rather than by reading a manifest: `cargo pkgid -p oz-core` and `cargo pkgid -p oz-pos-app` both return "did not match any packages", and `cargo metadata --no-deps` lists 40 packages, none of them under the old `oz-*` names. The current mapping, read from each manifest path: `oz-core` -> `kasirmu-core` (`crates/kasirmu-core/Cargo.toml`), `oz-pos-app` -> `kasirmu-app` (`apps/desktop-tauri/Cargo.toml`), `oz-pos-tablet` -> `kasirmu-mobile` (`apps/mobile-tauri/Cargo.toml`), `oz-security` -> `kasirmu-security` (`crates/kasirmu-security/Cargo.toml`). The old client directories moved with them: `apps/desktop-client/` -> `apps/desktop-tauri/` and `apps/tablet-client/` -> `apps/mobile-tauri/`. All of these were repaired in place. The numbered migration series this file cites is likewise gone: migrations are date-stamped and the tables are folded into `crates/kasirmu-core/migrations/20260813_init.sql`. Every mechanism this plan commits to was located in the current tree, which matters here because the plan's own Known-deviations section predicted the implementation would sit somewhere other than where the plan assumed. The profile API is `crates/kasirmu-core/src/db/profile.rs:92` (`is_complete`) and `:348` (`mask_last4`), with the writers at `crates/kasirmu-core/src/db/profile/user.rs:76` (`create_user_with_profile`), `:366` (`get_user_profile_viewed_by`), `:454` (`require_role_assignable`) and `:487` (`assign_role_guarded`). The three sensitive keys are registered exactly as named, at `platform/core/src/permission_registry.rs:202`, `:208` and `:214`. The encryption deviation recorded in the plan is still accurate AND now has a more precise location than the plan could give: the plan says `oz_core::crypto`, which is still true, but `crates/kasirmu-core/src/crypto.rs` is a 14-line re-export shim for the `kasirmu-crypto` crate, where `encrypt_profile_field` is at `crates/kasirmu-crypto/src/lib.rs:641`, `decrypt_profile_field` at `:651`, with a `profile_field_roundtrip` test at `crates/kasirmu-crypto/src/lib_tests.rs:49`. The deviation rationale (oz-security depends on kasirmu-core, so the direction is impossible) still holds and the `masks in core for the same reason` reasoning is unchanged. `get_staff_profile_scoped` is registered on both clients at `apps/desktop-tauri/src/commands/staff.rs:95` and `apps/mobile-tauri/src/commands/staff.rs:106`. · The original plan text is preserved as approved; only the identifiers that stopped resolving were changed, no design claim was rewritten. · No stamp or footer existed on this file before this pass. -->
# User profile data contract with sensitive-field handling

> **Status: IMPLEMENTED — 2026-08-11.** Shipped in seven commits
> (`6b76d3e0` schema+validation, `d9990925` sensitive keys,
> `abc7949e` at-rest security, `ecae8b52` backend IPC, `57e98628` staff
> screen, `0a909c4b` + `f194eca2` docs); moved to `_done/`. See §10 for the
> completion record. The sections below are the original plan as approved.

## 1. Decision requested

Implement ADR #35 D6 end to end: the 9 mandatory-at-creation profile fields
plus the optional set, the incomplete-profile state, the sensitive-field
handling (explicit grants via the 0046 registry, at-rest encryption, read
audit, last-4 masking, cloud-sync/export residency, compliance retention).
This is D9 step 6 and depends on 0046–0048.

## 2. Evidence baseline

- `users` today: `id`, `username UNIQUE`, `pin_hash` (argon2), `display_name`,
  `role_id`, `is_active`, timestamps (migration `007_customers.sql`).
- Money convention: i64 minor units (`total_spent_minor`, `opening_balance_minor`);
  `customers.notes` is `TEXT NOT NULL DEFAULT ''`.
- `kasirmu-security` provides keyring-backed encryption (license-API-key precedent:
  `apps/desktop-tauri/src/commands/license.rs` encrypts the API key) and
  `mask.rs` (truncation/masking, PAN precedent).
- Shift data exists for the analytics follow-up (migration `021_shifts.sql`:
  user_id, terminal_id, opening/closing/expected/cash_difference/total_sales).
- Audit-log infrastructure exists; the registry keys `staff:read_identity`,
  `staff:read_payroll`, `staff:edit_notes` are decided in ADR #35 D2.

## 3. Problem statement

There is no identity, payroll, or emergency-contact data in the system at all,
and no contract for mandatory/optional/sensitive/collectible. ADR #35 D6
defines the contract; this slice implements it with the privacy rules — the
sensitive fields must not ride wildcards, must be encrypted at rest, must be
masked in display, must be read-audited, must not leave the device in sync or
export payloads, and must never be auto-deleted.

## 4. Scope of the slice

### 4.1 Schema

New migration adding to `users`: `date_of_birth`, `phone`, `national_id_type`,
`national_id` (UNIQUE when present), `email` (UNIQUE), `monthly_take_home_minor`,
`emergency_contact_name`, `emergency_contact_phone` (all nullable), plus
optionals `job_title`, `notes`, `address`, `language`, `avatar`,
`tax_id`, `national_id_expires_at`, `emergency_contact_relationship`,
`hire_date`. A `profile_complete` view/state derived from the required set.

### 4.2 Validation (creation)

Field-specific errors: `national_id` per type (ssn 9 / nik 16 digits), email
format, phone E.164, DOB not in the future, `monthly_take_home_minor > 0`.
Creation requires the 9 fields; legacy rows enter the incomplete-profile state.

### 4.3 Sensitive handling

- Grants: `staff:read_identity` / `staff:read_payroll` / `staff:edit_notes`
  enforced on the profile command surface; Auditor excluded (via the 0046/0047
  stack).
- Encryption: `national_id` + `monthly_take_home_minor` encrypted at rest via
  `kasirmu-security` keyring.
- Masking: `national_id` displays last-4 by default; full value only via the
  explicit grant, masked in export/log surfaces.
- Read audit: every read of the three sensitive fields emits an audit event
  (key, user, timestamp); the audit records access, not values.
- Residency: sensitive fields excluded from cloud sync and bulk exports.
- Retention: deactivation never deletes sensitive fields; deletion is an
  explicit compliance decision.

### 4.4 Incomplete-profile semantics

Checkout login works; the user is flagged in staff management; management-role
assignment and sensitive grants require a complete profile.

### 4.5 Front-end (ui/src)

- The staff create/edit form collects the 9 required + optional fields with
  field-level, localized validation errors; the required set is enforced in
  the form before submission.
- Staff list and detail views render national_id masked to last-4; full values
  appear only via the explicit sensitive grant.
- Incomplete-profile users carry a visible flag; management-role and
  assignment controls are disabled until the profile is complete.
- The IPC contract is extended and pinned: `CreateStaffScopedArgs` /
  `UpdateStaffScopedArgs` gain the profile fields, `ui/src/api/staff.ts` is
  updated, and a new `api-staff-contract.test.ts` pins the wire shape (no
  staff contract test exists today).
- New strings land in both `staff.ftl` bundles (en + id) for parity.

## 5. Implementation plan

1. Write the Red tests first: validation matrix, incomplete-profile semantics,
   encryption round-trip, masking, read-audit, residency (sync/export
   exclusion), retention.
2. Add the migration + runner registration (Green for schema tests).
3. Implement validation + incomplete-profile state in the staff command
   surface (both clients).
4. Wire the sensitive grants through the 0046/0047 stack.
5. Add encryption (kasirmu-security keyring), masking, read-audit, and residency
   exclusions in the profile read/export/sync paths.
6. Update the staff form, list, and detail UI (fields, masking, incomplete
   badge); extend the staff IPC args and pin them with the contract test.
7. Run area tests: `test-tdd.sh -p crates/kasirmu-core`, `cargo test -p kasirmu-app
   --lib`, `cargo test -p kasirmu-mobile --lib`, fmt, clippy, drift guard,
   plus the UI checks from validation.md.

## 6. Test plan

### Existing tests to modify

- `create_staff` / `create_staff_scoped` tests
  (`apps/desktop-tauri/src/commands/staff.rs` ~692–820, tablet `staff.rs`):
  arg fixtures gain the 9 required fields;
  `create_staff_args_deserialize` / `_debug` pin the new wire shape.
- UI `StaffManagementScreen.test.tsx` create-form fixtures gain the required
  fields; `StaffLoginScreen.test.tsx` / `StaffLoginKeyboard.test.tsx` are
  checked for affected login-path assertions.
- Direct-SQL `users` INSERT fixtures (the
  `('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, ...)` rows) keep
  working — columns are nullable — but any command-path call with minimal
  args must add the required fields.

### New tests (Red first)

- Validation matrix: each required field missing or malformed (national ID
  per type, email format, phone E.164, DOB in the future, non-positive
  `monthly_take_home_minor`) → field-specific error.
- Uniqueness: `national_id` (when present) and `email` reject duplicates.
- Incomplete-profile semantics: checkout login works; flagged in staff
  management; management-role assignment and sensitive grants denied.
- Encryption round-trip via `kasirmu-security` keyring; fail-closed when the key
  is missing.
- Masking: `national_id` renders last-4 by default; full value only via the
  explicit grant.
- Read-audit: every read of the three sensitive fields emits an event with
  no values.
- Residency: sensitive fields absent from sync and bulk-export payloads.
- Retention: deactivation never deletes sensitive fields.

### UI tests (new)

- Staff form UX: submission is blocked with field-level, localized errors for
  each missing or malformed required field.
- Masking render: national_id shows last-4 in list and detail; the full value
  is never in the DOM without the explicit grant.
- Incomplete-profile UI: badge visible; management-role and assignment
  controls disabled until complete.
- `api-staff-contract.test.ts` (new): pins the profile fields on the staff IPC
  wire shape.

## 7. Security and correctness considerations

- Encryption failures fail closed: a missing key never yields plaintext.
- Masked values and audit events never contain the full `national_id`.
- Residency is enforced at the sync/export boundary, not by convention.
- Money stays in i64 minor units, store currency; no floats anywhere.

## 8. Non-goals

- Invitations and org-tenant layer (ADR #35 D7).
- A second PIN/password credential.
- The staff analytics page (ADR #35 D8).
- Bank account, gender/religion/marital status/ethnicity/blood type (the
  D6 not-collected list).
- SQLCipher full-database at rest (open spec C-5).

## 9. Rollback plan

The columns are nullable, so the migration is reversible; the incomplete-
profile state means no legacy row is ever blocked. Each privacy rule ships
with its own test, so a rule that proves operationally wrong (e.g. masking
frustrating a workflow) can be adjusted independently without reverting the
schema.

## 10. Completion record

Status: **IMPLEMENTED** — all three cycles shipped and verified; the
acceptance criteria are met (see validation.md). Moved to `_done/` on
2026-08-11.

### Cycle 1 — schema + validation + incomplete state (`6b76d3e0`)

- Migration `130_user_profiles.sql`: the 17 profile columns on `users`
  (nullable — "mandatory" is enforced at creation) plus unique email and
  national-id indexes; the D6 not-collected fields are pinned absent by the
  migration test.
- `db::profile::UserProfile` with `is_complete()` and `validate()`
  (ssn=9/nik=16, E.164 phone, non-future DOB, positive pay, field-level
  errors); `create_user_with_profile` is transactional.

### Cycle 2a — sensitive keys (`d9990925`)

- `staff:read_identity`, `staff:read_payroll`, `staff:edit_notes` registered
  as sensitive (never wildcard-eligible), granted to Manager/Admin/Staff
  presets, withheld from Auditor; pinned by the registry test.

### Cycle 2b — sensitive handling (`abc7949e`)

- `national_id` + `monthly_take_home_minor` encrypted at rest
  (`crypto::encrypt_profile_field` / `decrypt_profile_field`); migration 131
  adds `national_id_hash` + unique index so the unique-when-present invariant
  survives nonce-randomised ciphertext.
- `get_user_profile_viewed_by` → `ProfileView`: full values only with the
  explicit grants, national id always last-4 masked (`mask_last4`), every
  sensitive read audited (access, never values), corrupt ciphertext fails
  closed.
- `assign_role_guarded` / `require_role_assignable`: management-role
  assignment gated on a complete profile (fires only on actual role change).
- Retention (`deactivation_preserves_profile`) and residency
  (`SnapshotUser` wire-format pin) tests.

### Cycle 3 — IPC + UI (this commit)

- `CreateStaffScopedArgs`/`UpdateStaffScopedArgs` gain the 17 profile
  fields in both clients; `create_staff_scoped` → `create_user_with_profile`;
  `update_staff_scoped` runs the role gate + profile write atomically inside
  its existing transaction and restores the profile on workspace-assignment
  rollback.
- New `get_staff_profile_scoped` command returns the viewer-gated
  `ProfileViewDto` (masked/withheld per grants, reads audited); registered on
  both clients.
- `StaffMemberDto` gains `national_id_masked` + `is_profile_complete`; the
  list renders the masked id and the incomplete badge.
- Staff screen: 17-field profile form with localized per-field validation of
  the 9 mandatory fields, masked ID column, incomplete badge, and disabled
  role/workspace controls for incomplete members; i18n keys in both
  `staff.ftl` bundles (parity verified).
- `api-staff-contract.test.ts` pins the new wire shape.

### Known deviations

- Encryption uses `oz_core::crypto` (domain-separated AES-GCM, static key)
  rather than the kasirmu-security keyring — kasirmu-security depends on kasirmu-core, so
  the dependency direction the spec implies is impossible; the static key
  follows the `encrypt_smtp_at_rest` precedent (readable after a DB restore
  on another machine). Masking lives in kasirmu-core for the same reason.
- `cargo clippy -D warnings` reports 2 pre-existing errors in
  `topology.rs` (untouched by 0049); the changed area is clean.

> last audited 29-09-26 by docs-auditor
