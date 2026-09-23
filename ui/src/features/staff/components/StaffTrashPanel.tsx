/**
 * StaffTrashPanel — the Trash tab: soft-deleted staff and custom roles, each
 * with the days left in its retention window and a Restore action.
 *
 * The backend owns the clock. Deletion stamps `deleted_at`; the trash reads run
 * the purge sweep before they answer, and a row past its window is never handed
 * back as restorable. `TRASH_RETENTION_DAYS` here therefore mirrors
 * `kasirmu_core::db::staff::TRASH_RETENTION_DAYS` for display only — nothing on
 * this screen decides that a row has expired, so a drift between the two shows
 * a wrong number and can never hold a row alive or let one go early.
 *
 * Reads its own data rather than taking it from the shell: the two lists are
 * only needed while this tab is showing, and the shell already owns the live
 * roster. Mounted while active (never kept), for the same reason — a trash list
 * is only worth showing fresh, and reopening the tab is what re-runs the sweep.
 *
 * Invariants:
 * - Restoring a member returns them INACTIVE, so `onRestored` reloads the live
 *   lists and the roster shows them as inactive rather than claiming access.
 * - Roles appear only for a caller holding `staff:manage_roles`.
 * - Styles live in `StaffManagementScreen.css`; this file owns no CSS.
 */
import { useCallback, useEffect, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  listRoleTrashScoped,
  listStaffTrashScoped,
  restoreRoleScoped,
  restoreStaffScoped,
  type RoleDto,
  type StaffMemberDto,
} from '@/api/staff';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components';
import { NoStaffIcon } from '@/components/EmptyStateIllustrations';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { l10nErrorMessage } from '@/utils/app-error';

/** The retention window in days; see the module note on why this is display-only. */
const TRASH_RETENTION_DAYS = 90;

/** Whole days left before a row deleted at `deletedAt` is purged, floored at 0. */
function daysLeft(deletedAt: string | null | undefined, now: number): number {
  if (!deletedAt) return 0;
  const deleted = Date.parse(deletedAt);
  if (Number.isNaN(deleted)) return 0;
  return Math.max(0, TRASH_RETENTION_DAYS - Math.floor((now - deleted) / 86_400_000));
}

interface StaffTrashPanelProps {
  /** Render the role half. False for a session without `staff:manage_roles`. */
  canManageRoles: boolean;
  /** Fired after a successful restore, so the shell reloads its live lists. */
  onRestored: () => void;
}

/** The Trash tab's main content. */
export function StaffTrashPanel({ canManageRoles, onRestored }: StaffTrashPanelProps) {
  const { l10n } = useLocalization();
  const { sessionToken } = useWorkspace();
  const { addToast } = useToast();
  const [staff, setStaff] = useState<StaffMemberDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The row whose restore is in flight, `<kind>:<id>`, or null. */
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    setError(null);
    try {
      const [trashedStaff, trashedRoles] = await Promise.all([
        listStaffTrashScoped(sessionToken),
        canManageRoles ? listRoleTrashScoped(sessionToken) : Promise.resolve([] as RoleDto[]),
      ]);
      setStaff(trashedStaff);
      setRoles(trashedRoles);
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'staff-trash-error'));
      setStaff([]);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, canManageRoles, l10n]);

  useEffect(() => { void load(); }, [load]);

  const restoreStaff = useCallback(async (member: StaffMemberDto) => {
    if (!sessionToken) return;
    setBusy(`staff:${member.id}`);
    try {
      await restoreStaffScoped(sessionToken, member.id);
      addToast({
        type: 'success',
        message: l10n.getString('staff-toast-restored', { name: member.display_name }),
      });
      onRestored();
      await load();
    } catch {
      addToast({ type: 'error', message: l10n.getString('staff-trash-restore-failed') });
    } finally {
      setBusy(null);
    }
  }, [sessionToken, addToast, l10n, onRestored, load]);

  const restoreRole = useCallback(async (role: RoleDto) => {
    if (!sessionToken) return;
    setBusy(`role:${role.id}`);
    try {
      await restoreRoleScoped(sessionToken, role.id);
      addToast({
        type: 'success',
        message: l10n.getString('role-restored', { name: role.name }),
      });
      // A restored role is live again, so the shell's role list (and the
      // "Roles" stat tile that reads it) is stale until it reloads. The staff
      // half already does this via `onRestored`; the role half is the same
      // fact and needs the same call.
      onRestored();
      await load();
    } catch {
      addToast({ type: 'error', message: l10n.getString('staff-trash-restore-failed') });
    } finally {
      setBusy(null);
    }
  }, [sessionToken, addToast, l10n, onRestored, load]);

  // One clock reading per render, so every row on screen counts from the same
  // instant instead of drifting apart by a few milliseconds each.
  const now = Date.now();
  const empty = staff.length === 0 && roles.length === 0;

  return (
    <div className="staff-mgmt-trash">
      <p className="staff-mgmt-trash-intro">
        <Localized id="staff-trash-intro">
          <span>Deleted staff and roles stay here for 90 days before permanent deletion.</span>
        </Localized>
      </p>

      {error ? (
        <Card shadow="sm">
          <div className="staff-mgmt-load-error" role="alert">
            <p className="staff-mgmt-load-error-message">{error}</p>
            <Button onClick={() => void load()} variant="secondary" data-testid="staff-trash-retry-btn">
              <Localized id="staff-retry"><span>Retry</span></Localized>
            </Button>
          </div>
        </Card>
      ) : loading ? (
        <div className="staff-mgmt-trash-loading" aria-hidden="true">
          <Skeleton variant="block" width="100%" height="3.5rem" style={{ borderRadius: 'var(--radius-lg)' }} />
          <Skeleton variant="block" width="100%" height="3.5rem" style={{ borderRadius: 'var(--radius-lg)' }} />
        </div>
      ) : empty ? (
        <Card shadow="sm">
          <div className="staff-mgmt-empty" data-testid="staff-trash-empty">
            <EmptyState
              icon={<NoStaffIcon />}
              title={l10n.getString('staff-trash-empty')}
            />
          </div>
        </Card>
      ) : (
        <>
          {staff.length > 0 && (
            <section className="staff-mgmt-trash-section" aria-labelledby="staff-trash-staff-heading">
              <h2 className="staff-mgmt-trash-section-title" id="staff-trash-staff-heading">
                <Localized id="staff-trash-staff-section"><span>Deleted staff</span></Localized>
              </h2>
              <ul className="staff-mgmt-trash-list" data-testid="staff-trash-staff-list">
                {staff.map((member) => (
                  <li key={member.id} className="staff-mgmt-trash-row" data-testid={`staff-trash-${member.id}`}>
                    <div className="staff-mgmt-trash-who">
                      <span className="staff-mgmt-trash-name">{member.display_name}</span>
                      <span className="staff-mgmt-trash-sub">{member.username}</span>
                    </div>
                    <Badge variant="info" className="staff-mgmt-trash-days">
                      <Localized id="staff-trash-days-left" vars={{ days: daysLeft(member.deleted_at, now) }}>
                        <span>{daysLeft(member.deleted_at, now)} days before permanent deletion</span>
                      </Localized>
                    </Badge>
                    <Localized id="staff-trash-restore-staff-aria" attrs={{ 'aria-label': true }} vars={{ name: member.display_name }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void restoreStaff(member)}
                        loading={busy === `staff:${member.id}`}
                        data-testid={`staff-trash-restore-${member.id}`}
                      >
                        <Localized id="staff-trash-restore"><span>Restore</span></Localized>
                      </Button>
                    </Localized>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {roles.length > 0 && (
            <section className="staff-mgmt-trash-section" aria-labelledby="staff-trash-roles-heading">
              <h2 className="staff-mgmt-trash-section-title" id="staff-trash-roles-heading">
                <Localized id="staff-trash-roles-section"><span>Deleted roles</span></Localized>
              </h2>
              <ul className="staff-mgmt-trash-list" data-testid="staff-trash-role-list">
                {roles.map((role) => (
                  <li key={role.id} className="staff-mgmt-trash-row" data-testid={`staff-trash-${role.id}`}>
                    <div className="staff-mgmt-trash-who">
                      <span className="staff-mgmt-trash-name">{role.name}</span>
                      <span className="staff-mgmt-trash-sub">{role.description}</span>
                    </div>
                    <Badge variant="info" className="staff-mgmt-trash-days">
                      <Localized id="staff-trash-days-left" vars={{ days: daysLeft(role.deleted_at, now) }}>
                        <span>{daysLeft(role.deleted_at, now)} days before permanent deletion</span>
                      </Localized>
                    </Badge>
                    <Localized id="staff-trash-restore-role-aria" attrs={{ 'aria-label': true }} vars={{ name: role.name }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void restoreRole(role)}
                        loading={busy === `role:${role.id}`}
                        data-testid={`staff-trash-restore-${role.id}`}
                      >
                        <Localized id="staff-trash-restore"><span>Restore</span></Localized>
                      </Button>
                    </Localized>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
