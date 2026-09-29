---
num: 35
area: staff
title: ADR #35: RBAC — Role Assignments with Branch/Workspace Scopes and User Profile Data
status: Accepted (ratified 2026-08-11; implementation sequence in D9)
---
<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 257 lines, with no prior stamp, footer or marker. It is the decision behind the permission model that this campaign has met from several directions — the permission registry and the centralised gate that the API-spec series established, the scoped-command pattern, and the role model whose canonical builtin set this campaign verified in a recent round. So the decision has already been partly adjudicated from the implementation side, and this pass records the decision side properly. · THE TITLE'S PROMISE IS KEPT IN THE SCHEMA, VERIFIED COLUMN BY COLUMN, which is the checkable core and the result is unusually clean. The title says role assignments with BRANCH and WORKSPACE scopes; the shipped table carries a scope column constrained to a global-or-scoped choice, a branch-scope column constrained to all-or-list, and a workspace-scope column with the same pair, plus an expiry column. Every concept in the title is present with a constraint set that prevents the invalid states rather than merely permitting the valid ones. That is the difference between a decision that was implemented and one that was gestured at. · A DIVERGENCE WORTH NAMING PRECISELY, because a loose version of it has circulated in this campaign and is wrong. The table is named for assignments, not for role assignments. The earlier framing was that the decision had been implemented under a different name than it specified; reading the decision's own title shows the phrase was a concept and never a table name, so there is no divergence to report. A reader checking this should compare the decision's TITLE against the schema, not a guessed identifier against a guessed identifier. · THE CONTEXT SECTION IS ALSO WORTH CREDITING, because it names what the system could not do rather than only what it decided to do. It records the pre-existing model — a single global role per user, a JSON permissions column, family wildcard matching already present, and module manifests already declaring their own permission lists — and frames the decision as an answer to questions growth was already asking. A decision that acknowledges the machinery already in place is easier to implement and easier to review, and this one names four existing pieces that the new design reuses rather than discards. · A CONSEQUENCE A READER SHOULD NOTICE, because it is visible in the schema and easy to miss: the assignment table's primary key is the user alone, which encodes one role per user with scope carried as an attribute of that assignment rather than as a collection. That is a coherent design and it is also a real constraint — a user who must hold different roles in different branches needs a different model, and whether that requirement is met by the scope columns or is deferred is a question the decision answers and this stamp does not second-guess. · NOT re-measured: the enforcement path, whether the permission gate consults the scoped columns correctly, or the user-profile half of the title. Those are the implementation, and the automated drift check across the decision table reports no inconsistency. · No stamp existed; this is the first. -->
# ADR #35: RBAC — Role Assignments with Branch/Workspace Scopes and User Profile Data

Date: 2026-08-11

Status: Accepted (ratified 2026-08-11; implementation sequence in D9)

## Context

Today the system has six roles — `role-owner`, `role-manager`, `role-cashier`,
`role-kitchen`, `role-staff`, `role-custom` — stored in a single `roles` table
with a JSON `permissions` column, and users carry one global `role_id`
(`users` table, migration `007_customers.sql`). Enforcement is per-command
`require_permission_for_user(...)` against the global identity DB. Family
wildcard matching already exists in `rbac.rs::has_permission` (e.g. `"sales:*"`,
`"*"`), and module manifests (`modules/*/manifest.json`) already declare
per-module permission lists.

The current model cannot answer five questions that growth keeps raising:

1. **Stability.** Roles are enumerated flat lists. Adding a feature means
   editing every role that should have it — the opposite of a small, stable role
   set.
2. **Scopes.** A user's role is global. Multi-branch and multi-workspace
   assignments, explicit "all" semantics, and expiry are impossible.
3. **Sensitivity.** Nothing separates operational capabilities from irreversible
   or financial ones, so a future `sales:refund`-class key would be as
   wildcard-eligible as `reports:view`.
4. **User profile.** The `users` table has only username, display name, PIN
   hash, and role. There is no identity, payroll, or emergency-contact data, and
   no rule for what is mandatory, sensitive, or collectible at all.
5. **Read-only visibility.** There is no Auditor role; read-only "roles" are
   expressed as UI gating in places — and rounds 172/174 demonstrated that
   frontend gating is not a security boundary.

This ADR is the authoritative record of these decisions; it supersedes the
working plan (`roles.md`) it ratifies.

## Decision

### D1 — Permission-first, role-light

Authorization is expressed through permission keys, never hard-coded role names.
Today's `{resource}:{action}` strings (underscore actions: `sales:process`,
`customers:view`, `kds:update`) are ratified and **never renamed for style** —
renames churn every enforcement call site for zero user value. Dotted suffixes
are allowed for new nested capabilities (e.g. `sales:discount.approve`).

### D2 — Family grants (operational) + explicit grants (sensitive)

- Roles grant at **family granularity** for operational capabilities
  (`sales:*`, `reports:*`, `customers:*`). A new key inside an existing
  operational family is automatically granted to every wildcard holder — zero
  role edits. Wildcard matching already exists in `rbac.rs`; the work is
  classification, not a new engine.
- Irreversible or financial capabilities — voids, refunds, billing, ownership
  transfer, role management, bulk export, staff identity/payroll/notes — are
  **never wildcarded**. Each sensitive key is enumerated explicitly on the roles
  that deserve it; that one grant line per role is the deliberate cost of
  preventing privilege creep.

### D3 — Code-resident permission registry, centralized fail-closed gate

- The registry (`key → family, sensitive, description`) lives in **code** —
  `rbac.rs` permission consts plus module manifests — not a database table, so
  it cannot be tampered with via a DB edit and authorization fails closed at
  compile time. Role grants (DB rows) are validated against the registry at
  write time.
- Enforcement is centralized in one backend `require_permission(permission)`
  gate that every permission-sensitive command must pass, deny-by-default.
  The frontend only hides or disables unavailable UI. This replaces today's
  per-command `require_permission_for_user` pattern.

### D4 — Role taxonomy: five system roles, cashier/kitchen are not roles

- **Owner** — global scope, cannot be narrowed; everything including billing and
  ownership.
- **Admin** — global scope, cannot be narrowed (same mechanism as Owner);
  everything except ownership transfer, billing, and irreversible org actions by
  default.
- **Manager** — scoped to assigned branches and workspaces; operational
  management within scope.
- **Staff** — the single operational role, scoped to assigned branches and
  workspaces. **Cashier and kitchen are not roles**: a staff user assigned to
  `retail-pos` is the cashier-like operator, one assigned to `kds` is the
  kitchen-like operator. The username (`cashier-1`) and the optional `job_title`
  field are human labels only — the backend never authorizes from names.
- **Auditor** — global, read-only; implemented as a permission set, never a
  frontend flag; **never sees sensitive profile fields** (national ID, payroll,
  notes, emergency contact).

`role-staff` survives; `role-cashier`/`role-kitchen` are retired via the
assignment migration (D5) with behavior preserved by mapping them to Staff plus
the corresponding workspace scope. Custom roles are supported without schema
changes. **Role inheritance is permanently out of scope**: flat roles with
family grants are easier to reason about and audit, and hierarchies are what
force role edits as the system grows.

### D5 — Assignment model with explicit-all scopes

- `assignments` (`user_id`, `role_id`, `scope_mode` `global` | `scoped`,
  `expires_at` deferred), `assignment_branches`, `assignment_workspaces`.
- Global mode = org-level roles (Owner, Admin, Auditor); scope is ignored.
  Scoped mode carries a branch dimension and a workspace dimension, each
  independently an explicit `all` or a list — "all branches, only `retail-pos`"
  is expressible, and empty lists never mean "all".
- `users.role_id` migrates to a **default global-mode assignment** so existing
  databases are unchanged in behavior.
- Roles, assignments, and user profiles stay in the **global identity DB**;
  store data remains in per-store DBs (ADR #4). The store the session resolves
  to remains the enforcement boundary for store-scoped data.

### D6 — User profile data contract

- **Mandatory at creation (9):** username, full name, date of birth, phone,
  `national_id_type` + `national_id` (the "SSN or KTP if Indonesian"
  discriminator; per-type validation — SSN 9 digits, NIK 16; `national_id`
  UNIQUE when present as the duplicate-enrollment detector), email (UNIQUE,
  login identifier for management roles + invitation target), monthly take-home
  pay (i64 minor units, store currency, strictly positive), emergency contact
  name, emergency contact phone.
- Columns are **nullable in SQL**; "mandatory" is enforced at creation with
  field-specific errors. Existing rows are not forced to fabricate values — a
  user with missing required data is in an **incomplete-profile state**:
  checkout login works, the user is flagged in staff management, and
  management-role assignment plus sensitive-field grants require a complete
  profile.
- **Optional:** `job_title` (presentation only), `notes` (free text,
  `TEXT NOT NULL DEFAULT ''` like `customers.notes`), `address`, `language`,
  `avatar` (deferrable), `tax_id` (NPWP), `national_id_expires_at`,
  `emergency_contact_relationship`, `hire_date`.
- **Deliberately not collected:** gender, religion, marital status, ethnicity,
  blood type (zero authorization value, legally/ethically sensitive); bank
  account until direct deposit is a real feature; shift/availability belongs to
  a scheduling feature.
- **Sensitivity:** `national_id`, DOB, monthly pay, `tax_id` require the
  explicit `staff:read_identity` / `staff:read_payroll` grants — never family
  wildcards, never Auditor. `notes` reads ride `staff:read`, edit requires the
  explicit `staff:edit_notes`. `national_id` and monthly pay are **encrypted at
  rest via `oz-security`** (keyring-backed), consistent with the license-API-key
  encryption precedent. Emergency contact data is third-party PII: out of
  Auditor scope and out of exports by default.
- **Read audit and masking:** every read of `national_id`, monthly pay, or
  `tax_id` is an auditable event (key, user, timestamp) — the explicit grants
  give each sensitive field exactly one read path, so the audit is cheap.
  `national_id` is displayed as last-4 by default (`oz-security::mask`, the
  PAN-masking precedent); the audit records access, not values, and the full
  value requires the explicit grant and is masked in any other surface
  (export, logs).
- **Data residency:** sensitive profile fields (`national_id`,
  `monthly_take_home_minor`, `tax_id`, emergency contact, `notes`) are
  **excluded from cloud sync and bulk exports by default** — the store-first
  model keeps them on the device; any future inclusion is a separate,
  explicitly-audited decision.
- **Login semantics:** username + PIN remain the checkout credential (today's
  argon2 PIN flow). Email is a unique *identifier*, not a second PIN/password
  credential in phase 1.
- **Retention:** deactivation does not delete identity, payroll, or emergency
  contact data — local labor/tax law typically requires payroll records kept for
  years, so retention is the compliance default; deletion is an explicit
  compliance decision, never automatic.
- **Storage:** sensitive columns stay on `users` with app-level gating + field
  encryption — a separate `user_profiles` table (or encrypted column family) is
  the future path if storage-level access control is ever needed.

### D7 — Deferred (explicitly)

Organization/tenant layer (`org_id`, invitations), permission caching, and
assignment expiry are deferred until multi-tenant deployment or scale demands
them. Invitations and org-scoped tables are deliberately not built yet.

### D8 — Related future work: staff analytics

A staff analytics page (shift and activity review for Owner/Admin/Manager) is a
planned follow-up. Its prerequisites are established here: the profile data
(D6), the assignment model (D5), the existing shift tables, and the audit trail
of permission-sensitive actions. Access is gated by the `staff:*` and
`reports:*` registry keys from D2/D3 — including the sensitive sub-keys, so
payroll fields never leak into a shift review by default. The read-audit and
data-residency rules from D6 carry into the analytics surfaces: sensitive
fields stay masked and on-device, and every access is traceable.

### D9 — Implementation sequence

1. Define the permission registry in code (D3): classify every current key into
   a family and mark it operational (wildcardable) or sensitive (explicit-only),
   keeping today's `{resource}:{action}` strings.
2. Centralize enforcement: one fail-closed backend `require_permission` gate
   every permission-sensitive command passes through (replacing
   `require_permission_for_user`).
3. Add the assignment model (D5); migrate `users.role_id` to a default
   global-mode assignment so existing databases are unchanged in behavior.
4. Align the role taxonomy (D4): seed Owner, Admin, and Auditor alongside the
   existing Manager and Staff (`role-staff` survives); fold cashier/kitchen
   into Staff + workspace assignments; retire `role-cashier`/`role-kitchen` via
   the step-3 migration.
5. Add custom roles, UI/API integration, and focused authorization tests across
   branch and workspace combinations.
6. Add the user profile fields (D6) with the incomplete-profile state; encrypt
   `national_id` and `monthly_take_home_minor` at rest via `oz-security`;
   register `staff:read_identity`, `staff:read_payroll`, and `staff:edit_notes`
   as sensitive keys.
7. Deferred (D7): org-tenant layer, invitations, permission caching, assignment
   expiry.

## Consequences

- Growing the system means growing the permission registry, **never editing
  roles** — validated by the acceptance test: a brand-new workspace must ship
  end-to-end (registry, grants, enforcement) with zero edits to existing role
  definitions.
- Multi-branch and multi-workspace assignments become possible; cashier/kitchen
  semantics are preserved as Staff + workspace scope, and job flavor moves to
  the username/`job_title` label instead of the authorization path.
- Sensitive PII gets explicit grants, at-rest encryption, and Auditor exclusion
  instead of riding a wildcard.
- Sensitive profile data stays on the device: excluded from cloud sync and bulk
  exports, masked in display, and read-audited — the store-first boundary (ADR
  #4) now protects HR data, not just transactions.
- Existing databases upgrade without behavior change (default global-mode
  assignment; nullable profile columns; `role-staff` survives).

## Tradeoffs / risks

- **Retiring `role-cashier`/`role-kitchen` is a breaking change** for seeded
  DBs. Mitigation: the migration maps them to Staff + the workspace scope their
  current permission set implies, so behavior is unchanged; the retire step is
  sequenced after the assignment migration.
- **Code-resident registry** means adding a key requires a release, not a config
  edit. That is the point (fail-closed at compile time), but it rules out
  runtime-added keys by design.
- **Admin is global-mode** like Owner. Orgs that want a branch-limited admin
  must use a custom scoped role or wait; recorded as a deliberate
  simplification, not an oversight.
- **National ID is mandatory** wherever the type list covers the jurisdiction.
  Jurisdictions outside US/Indonesia need a type addition before onboarding
  (NRIC, TFN, …) — the per-country growth path is explicit.
- **Payroll/identity data in the identity DB** is acceptable for the store-first
  model but raises the DB's sensitivity; field-level encryption via `oz-security`
  is the mitigation, with full SQLCipher at rest remaining an open spec (C-5).
  Read-audit and last-4 masking (D6) mitigate the display and query channels;
  retention defaults to compliance retention, never auto-delete.

## Verification

Each step of the implementation sequence (D9) ships with focused tests: role
permissions, family wildcards, sensitive exclusions, branch scopes, workspace
scopes, high-risk actions, profile field validation, sensitive-field read
audit, masking, residency (sync/export exclusion), and migration round-trips
(default assignment, role retirement, incomplete-profile state). The
registry/gate work replaces the per-command `require_permission_for_user` call
sites from rounds 172–174, whose tests stay green as the migration contract.

> last audited 29-09-26 by docs-auditor
