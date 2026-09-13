/**
 * StaffListTable — the staff table of the Staff management screen.
 *
 * Presentational list extracted verbatim from StaffManagementScreen: one row
 * per member with role badge, workspace-assignment summary (derived from the
 * DTO per spec 0048), display name + incomplete badge, username, masked
 * national id, active status, and the row actions (Edit / Deactivate-Restore
 * / Impersonate).
 *
 * Key props:
 * - `staff` — rows from `list_staff_scoped`; `workspaceNameMap` keys the
 *   workspace column's name lookups.
 * - `onEdit` / `onToggleActive` / `onImpersonate` — wired to the parent's
 *   handlers; the parent owns the STAFF-10 deactivation confirm dialog.
 *
 * Invariants:
 * - No data fetching and no confirmation UI here; the component renders what
 *   the parent loaded.
 * - Styles come from `StaffManagementScreen.css` (global classes imported by
 *   the composition root) — this file owns no CSS.
 */
import { Localized, useLocalization } from '@fluent/react';
import type { StaffMemberDto } from '@/api/staff';
import { Badge } from '@/components/Badge';
import { RoleIcon } from '@/components/RoleIcon';

interface StaffListTableProps {
  /** Staff rows from `list_staff_scoped`. */
  staff: StaffMemberDto[];
  /** Workspace key → display name for the assignment column. */
  workspaceNameMap: Map<string, string>;
  /** STAFF-08: workspace data failed to load — rows still render. */
  workspacesUnavailable: boolean;
  /** `operator:impersonate` grant gates the Impersonate action. */
  canImpersonate: boolean;
  /** Open the add/edit drawer for this member. */
  onEdit: (member: StaffMemberDto) => void;
  /** STAFF-10: deactivate (via confirm) or restore this member. */
  onToggleActive: (member: StaffMemberDto) => void;
  /** Start an impersonation session for this member. */
  onImpersonate: (member: StaffMemberDto) => void;
}

/** Badge colour per role name (both bare and `role-*` id spellings). */
const roleVariant = (roleName: string): 'warning' | 'info' | 'default' | 'success' => {
  switch (roleName.toLowerCase()) {
    case 'owner':
    case 'role-owner':
    case 'admin':
    case 'role-admin':   return 'warning';
    case 'manager':
    case 'role-manager': return 'info';
    case 'staff':
    case 'role-staff':  return 'default';
    case 'auditor':
    case 'role-auditor': return 'success';
    case 'custom':
    case 'role-custom': return 'default';
    default:             return 'default';
  }
};

/** The staff table — role, workspace, name, username, ID, status, actions. */
export function StaffListTable({
  staff,
  workspaceNameMap,
  workspacesUnavailable,
  canImpersonate,
  onEdit,
  onToggleActive,
  onImpersonate,
}: StaffListTableProps) {
  const { l10n } = useLocalization();

  return (
    <div className="staff-mgmt-table-wrap">
      {workspacesUnavailable && (
        <div className="staff-mgmt-ws-unavailable" role="status">
          <Localized id="staff-workspaces-unavailable">
            <strong>Workspace data unavailable</strong>
          </Localized>
          <Localized id="staff-workspaces-unavailable-hint">
            <span>Could not load workspace assignments. Staff data below is still current.</span>
          </Localized>
        </div>
      )}
      <table className="staff-mgmt-table" aria-label={l10n.getString('staff-table-aria')}>
        <thead>
          <tr>
            <Localized id="staff-col-role"><th>Role</th></Localized>
            <Localized id="staff-col-workspace"><th>Workspace</th></Localized>
            <Localized id="staff-col-name"><th>Name</th></Localized>
            <Localized id="staff-col-username"><th>Username</th></Localized>
            <Localized id="staff-col-id"><th>ID</th></Localized>
            <Localized id="staff-col-status"><th>Status</th></Localized>
            <Localized id="staff-col-actions" attrs={{ "aria-label": true }}>
              <th aria-label={l10n.getString('actions-aria')}> </th>
            </Localized>
          </tr>
        </thead>
        <tbody>{staff.map((member) => (
            <tr key={member.id} className={!member.is_active ? 'staff-mgmt-row--inactive' : ''}>
              <td>
                <Badge variant={roleVariant(member.role_name)}>
                  <span className="staff-mgmt-role-badge-content">
                    <RoleIcon role={member.role_name} size={16} className="staff-mgmt-role-icon" />
                    <span>{member.role_name}</span>
                  </span>
                </Badge>
              </td>
              <td className="staff-mgmt-cell-username">
                {member.assignment.scope_mode === 'global' || member.assignment.workspaces_all ? (
                  <Localized id="staff-assignment-all-workspaces-short">
                    <span>All</span>
                  </Localized>
                ) : (
                  member.assignment.workspace_keys
                    .map((k) => workspaceNameMap.get(k) ?? k)
                    .join(', ') || '—'
                )}
              </td>
              <td>
                <span>{member.display_name}</span>
                {!member.is_profile_complete && (
                  <Badge variant="warning" className="staff-mgmt-incomplete-badge">
                    <Localized id="staff-profile-incomplete">
                      <span>Profile incomplete</span>
                    </Localized>
                  </Badge>
                )}
              </td>
              <td className="staff-mgmt-cell-username">{member.username}</td>
              <td className="staff-mgmt-cell-username">
                <span aria-label={l10n.getString('staff-id-masked-aria')}>
                  {member.national_id_masked}
                </span>
              </td>
              <td>
                {member.is_active ? (
                  <Localized id="staff-status-active">
                    <span className="staff-mgmt-status-active">Active</span>
                  </Localized>
                ) : (
                  <Localized id="staff-status-inactive">
                    <span className="staff-mgmt-status-inactive">Inactive</span>
                  </Localized>
                )}
              </td>
              <td>
                <div className="staff-mgmt-cell-actions">
                <Localized id="staff-edit-aria" attrs={{ "aria-label": true }} vars={{ name: member.display_name }}>
                  <button
                    type="button"
                    className="staff-mgmt-action-btn"
                    onClick={() => onEdit(member)}

                  >
                    <Localized id="staff-edit"><span>Edit</span></Localized>
                  </button>
                </Localized>
                <Localized id={member.is_active ? 'staff-deactivate-aria' : 'staff-restore-aria'} attrs={{ "aria-label": true }} vars={{ name: member.display_name }}>
                  <button
                    type="button"
                    className={`staff-mgmt-action-btn ${member.is_active ? 'staff-mgmt-action-btn--warn' : 'staff-mgmt-action-btn--restore'}`}
                    onClick={() => onToggleActive(member)}

                  >
                    <Localized id={member.is_active ? 'staff-deactivate' : 'staff-restore'}>
                      <span>{member.is_active ? 'Deactivate' : 'Restore'}</span>
                    </Localized>
                  </button>
                </Localized>
                {canImpersonate && (
                  <Localized id="staff-impersonate-aria" attrs={{ "aria-label": true }} vars={{ name: member.display_name }}>
                    <button
                      type="button"
                      className="staff-mgmt-action-btn"
                      onClick={() => onImpersonate(member)}
                    >
                      <Localized id="staff-impersonate-action"><span>Impersonate</span></Localized>
                    </button>
                  </Localized>
                )}
                </div>
              </td>
            </tr>
          ))}
</tbody>
      </table>
    </div>
  );
}
