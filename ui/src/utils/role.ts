/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section H)
findings: clean canonical normalizer — five-role taxonomy (ADR #35 D4), retired cashier/kitchen unrecognized, unknown/legacy fail-closed to staff floor; {0} role name or id accepted
next: batch into the fix-order phase | perf: n/a (presentational)
*/
export type RoleVariant = 'owner' | 'admin' | 'manager' | 'staff' | 'auditor';

/**
 * Normalizes any role string into a known variant key.
 *
 * Five-role taxonomy (ADR #35 D4 / spec 0048): owner, admin, manager,
 * staff, auditor. The retired cashier/kitchen roles (0048 2c) no longer
 * exist and are not recognized — unknown/legacy strings resolve to 'staff'
 * so they never gate above the checkout-operations floor.
 */
export function normalizeRole(roleString?: string | null): RoleVariant {
  if (!roleString) return 'staff';
  const r = roleString.trim().toLowerCase();
  if (r === 'owner' || r === 'role-owner') return 'owner';
  if (r === 'admin' || r === 'role-admin') return 'admin';
  if (r === 'manager' || r === 'role-manager') return 'manager';
  if (r === 'auditor' || r === 'role-auditor') return 'auditor';
  return 'staff';
}

/**
 * Numeric ranks for the five-role taxonomy (ADR #35 D4 / spec 0048), keyed by
 * BOTH the bare role name and its `role-*` preset id, so a caller holding
 * either spelling can compare without normalizing first.
 *
 * There is exactly one such table. `features/workspaces/WorkspaceHome.tsx`
 * imports this export (`:13`) rather than inlining a copy of its own, so the
 * Tools-section gate there and every rank comparison made here read the same
 * ten keys — five presets in two spellings each. The duplication an earlier
 * revision of this comment called known-and-temporary is gone, not pending.
 */
export const ROLE_HIERARCHY: Record<string, number> = {
  owner: 5,
  'role-owner': 5,
  admin: 4,
  'role-admin': 4,
  manager: 3,
  'role-manager': 3,
  staff: 2,
  'role-staff': 2,
  auditor: 1,
  'role-auditor': 1,
};

/** Acceptable floors for {@link roleAtLeast}, weakest (`auditor`) to strongest (`owner`). */
export type RoleFloor = 'auditor' | 'staff' | 'manager' | 'admin' | 'owner';

/**
 * True when `roleName` ranks at or above `floor` in {@link ROLE_HIERARCHY}.
 *
 * Consumed by the settings page gate: the settings surface is owner/admin
 * only, and the copy shown to everyone else lives in `settings-locked-title`
 * / `settings-locked-desc`.
 *
 * Fails closed on both ends — a missing, blank, retired (`cashier`, `kitchen`)
 * or otherwise unrecognized role resolves to level `0` and clears no floor,
 * while an unrecognized floor demands `Number.MAX_SAFE_INTEGER` so nothing
 * clears it. No case-folding or trimming happens here (that is
 * {@link normalizeRole}'s job); the table carries the raw `role-*` preset ids
 * instead, which is exactly how WorkspaceHome reads the single shared table.
 *
 * @param roleName raw role name or preset id, e.g. `'admin'` or `'role-admin'`.
 * @param floor the minimum rank the caller requires.
 */
export function roleAtLeast(roleName: string | null | undefined, floor: RoleFloor): boolean {
  const level = ROLE_HIERARCHY[roleName ?? ''] ?? 0;
  const required = ROLE_HIERARCHY[floor] ?? Number.MAX_SAFE_INTEGER;
  return level >= required;
}
