---
num: 47
area: authorization
title: ADR #47: Scoped Authorization — Role Assignments with Explicit Scopes
status: Accepted — ruled 2026-09-07 (all five recommendations adopted)
---
# ADR #47: Scoped Authorization — Role Assignments with Explicit Scopes

**Status:** Accepted — ruled 2026-09-07 by the sole maintainer; **all five
recommended answers adopted** (1A–5A). Implementation proceeds in slices per
§Consequences; the assignment model is built across slices (scope axis 94e8a100, scoped pairs via staff IPC 8c0ae0b4, staff UI 7f7d4ec4, choke-point gate 453c629f).
**Date:** 2026-09-07
**Author:** Supervisor draft, for sole-maintainer ruling
**Tags:** authorization, rbac, scope-assignments, tenancy, multi-location

---

## Context

The permission registry (ADR #35, single deny-by-default source of truth,
85 keys) and the per-command gate (`require_permission_for_session`, later
`require_permission_for_user_scoped`) answer *what may be done*. They do not
answer *where it may be done*: today a Manager preset grants effective
location-wide power regardless of which location the user is actually
assigned to. The P0 item in `todo-global-saas-1.md` ("Add scoped
authorization") requires the opposite: "A manager assigned to Location A
must not automatically manage Location B."

Some foundations exist and are trustworthy: the canonical hierarchy
(Organization/Tenant → Legal Entity → Location, workspaces scoped to
locations, terminals owned by the organization), `3233a99d` wiring
`require_permission_for_user_scoped` into topology write paths, and the
preset grants (Owner/Manager/Admin/Auditor/Staff) already flowing through
the full inventory contract. What does not exist is the *assignment model*:
where "who holds which role at which scope" is stored, how it is resolved,
and what happens to existing rows.

This ADR proposes the model so the maintainer can rule. It is deliberately a
brief, not an implementation plan.

## Decision (five questions, one recommended answer each)

> **Ruled 2026-09-07: adopted as recommended (1A–5A).** The five answers
> below are the ruling of record — one `role_assignments` table with
> organization/legal-entity/location scopes, a single
> `require_permission_scoped` choke point, downward-only inheritance,
> custom roles as named key-set rows in the same registry, and an
> org-wide backfill migration that changes no behavior until per-location
> assignments are deliberately created.

### 1. Scope model — recommended: assignments are rows, scopes are nullable

One table, `role_assignments`: `id, user_id, role, scope_type, scope_id,
assigned_by, created_at, tenant_id`. `scope_type` is one of
`organization | legal_entity | location` (nullable-pair semantics: NULL
scope = org-wide). Workspaces and terminals are NOT scope types — they sit
below locations and inherit (a location-scoped manager manages that
location's workspaces and its terminals; a terminal is never a boundary a
human role needs, per ADR #41's terminal model).

### 2. Enforcement shape — recommended: one scoped choke point

`require_permission_scoped(session, permission, scope_ref)` resolves the
caller's assignments for the *specific* resource being mutated and denies if
none match. Commands already declare what they touch (location id, branch
id); the gate takes it. No second vocabulary — the permission key set stays
exactly ADR #35's.

### 3. Inheritance — recommended: downward only

Org-wide covers everything. Legal-entity covers its locations. Location
covers its workspaces/terminals. No upward access, no sibling access, no
wildcards beyond the explicit org-wide row. The manager-of-A example then
fails closed for B with zero special cases.

### 4. Custom roles (Phase 3) — recommended: same table, same registry

Assignments reference registry keys only. A custom role is a named key-set
row (Phase 3's item); assignments do not care whether the role is preset or
custom. Unknown keys deny — already settled and tested.

### 5. Migration — recommended: backfill to org-wide, then narrow

Every existing staff/user role row becomes an org-wide assignment
(`scope_type = organization`), preserving today's behavior bit-for-bit. The
fail-closed posture only tightens when per-location assignments are actually
created — no surprise capability revocation mid-migration.

## Non-goals

- Per-workspace ACLs beyond hierarchy inheritance
- The assignment-editing UI (separate slice; needs its own UX pass)
- Any change to the registry vocabulary (ADR #35 remains the single source)
- Row-level enforcement changes (RLS stays the DB-level layer; this model is
  the application-level layer above it — the two are complementary, see
  `todo-global-saas-1.md` "Protect tenant isolation")

## Consequences

- Unblocks: §B entitlements beyond tiers, the audit baseline, Phase 3 custom
  roles and multi-org switching — all previously triaged as gated on this.
- The `*_scoped` IPC pattern already in place (`3233a99d`, memo commands)
  becomes the norm rather than the exception; `verify-ipc-parity.py` gates
  stay authoritative.
- Verification sketch: a parity-style gate asserting every command that
  mutates a scoped resource resolves `require_permission_scoped` with that
  resource; a test pinning manager-of-A cannot act on B at every layer
  (IPC, store, DB).

## Related decisions

- ADR #35 (RBAC role assignments — the registry this builds on)
- ADR #41 (app lifecycle; terminal ownership model)
- `todo-global-saas-1.md` — canonical hierarchy decision (2026-09-05) and
  the "Add scoped authorization" P0 item this ADR serves
