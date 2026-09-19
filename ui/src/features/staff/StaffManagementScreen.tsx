/**
 * StaffManagementScreen — manage user accounts, roles, PIN codes, and
 * workspace assignments. Composition root after the Agent 3 decomposition
 * (work order todo-refactor-staff-auth-agents-3.md).
 *
 * Owns the list-level data (`list_staff_scoped` + `list_roles_scoped` + the
 * workspace name map for the table column), the row actions (edit → drawer,
 * deactivate/restore with the STAFF-10 confirm, impersonation) and the tier
 * cap banner. The heavy UI subtrees live in `components/`:
 * - `StaffListTable` — the staff table.
 * - `StaffDetailDrawer` — the add/edit modal: identity + PIN fields, the
 *   five-role taxonomy selector with permission chips, the ADR #35 D6
 *   profile fieldset, and the embedded `RoleAssignmentMatrix`.
 *
 * Invariants:
 * - STAFF-08: a failed staff/roles load shows a retryable error; a failed
 *   workspace load still renders staff rows with a notice.
 * - STAFF-09/10: edits never silently reactivate an account; deactivation
 *   requires explicit confirmation with the member's name.
 * - Styles live in `StaffManagementScreen.css` (global classes shared with
 *   the extracted components).
 */
import { useState, useCallback, useEffect, useContext, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  listStaffScoped,
  listRolesScoped,
  updateStaffScoped,
  impersonateUserScoped,
  type StaffMemberDto,
  type RoleDto,
} from '@/api/staff';
import { listAllWorkspacesScoped } from '@/api/workspaces';
import { listLocationsScoped } from '@/api/locations';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { openUpgradePricing as openUpgradePricingPage } from '@/utils/upgrade';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { requiredLocalized } from '@/components';
import { l10nErrorMessage } from '@/utils/app-error';
import { useToast } from '@/components/Toast';
import { hasGrantedPermission, passesGate } from '@/registries/page-registry';
import { EmptyState } from '@/components';
import { NoStaffIcon } from '@/components/EmptyStateIllustrations';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StaffListTable } from './components/StaffListTable';
import { StaffDetailDrawer } from './components/StaffDetailDrawer';
import { StaffManagementFooter } from './components/StaffManagementFooter';
import RoleAuthoringPanel, { type RoleAuthoringPanelHandle } from './components/RoleAuthoringPanel';
import { StaffTabs } from './components/StaffTabs';
import { STAFF_TAB_IDS, type StaffTab } from './components/staffTabsModel';
import './StaffManagementScreen.css';

// ── Component ───────────────────────────────────────────────────────

/** Staff management screen — manage user accounts, roles, PIN codes, and workspace assignments. */
export default function StaffManagementScreen() {
  const { l10n } = useLocalization();
  // C1.1 upgrade link needs the active locale for the pricing URL; tests
  // render without LocaleContext, so default to English there.
  const locale = useContext(LocaleContext)?.locale ?? 'en';
  // C2.2: Pro→Premium trigger — at 16+ staff (Pro caps at 20), nudge the
  // owner toward Premium before they hit the hard limit.
  const { caps } = useSubscription();
  const atProStaffCap = caps?.tier === 'pro' && (caps.staffCount ?? 0) >= 16;
  const { sessionToken } = useWorkspace();
  const { goToWorkspacePicker } = useWorkspaceNav();
  const { session } = useAuth();
  const { addToast } = useToast();
  const { start: startImpersonation } = useImpersonation();
  const canImpersonate = hasGrantedPermission(session?.permissions, 'operator:impersonate');
  /**
   * The Roles tab, and the header's "Add New Role" action with it, is shown
   * under exactly the gate `#/roles` itself carries — `passesGate` with the
   * same role and permission the page registration declares. Testing the raw
   * permission instead would hide the tab for a session that carries no
   * granted keys while the route still admits it by role, which is a tab and
   * a route disagreeing about who may author roles.
   */
  const canManageRoles = passesGate(
    'manager',
    'staff:manage_roles',
    session?.role_name,
    session?.permissions,
  );
  const [staff, setStaff] = useState<StaffMemberDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  /**
   * When the current `staff`/`roles` lists landed, or null when no successful
   * load has completed. The status footer uses it both as the freshness read-out
   * and as the signal that there is a snapshot to report at all — without it a
   * failed load would print `0 staff members`, which is a claim, not a gap.
   */
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [workspaceNameMap, setWorkspaceNameMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  /** STAFF-08: primary staff/roles load failed — show error + retry. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** STAFF-08: workspace data failed to load — staff rows still render. */
  const [workspacesUnavailable, setWorkspacesUnavailable] = useState(false);
  /** STAFF-10: member awaiting deactivation confirmation. */
  const [confirmTarget, setConfirmTarget] = useState<StaffMemberDto | null>(null);
  /** STAFF-10: true while the confirmed deactivation request is in flight. */
  const [deactivating, setDeactivating] = useState(false);
  const [showModal, setShowModal] = useState(false);
  /** The member the drawer edits; `null` while it creates. */
  const [editingMember, setEditingMember] = useState<StaffMemberDto | null>(null);

  // ── Load data

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (!sessionToken) {
        return;
      }
      const [staffData, rolesData] = await Promise.all([
        listStaffScoped(sessionToken),
        listRolesScoped(sessionToken),
      ]);
      setStaff(staffData);
      setRoles(rolesData);
      setLoadedAt(Date.now());

      // Load the workspace names for the table column. STAFF-08: a
      // workspace failure must NOT hide staff rows — show an explicit
      // "workspace data unavailable" notice instead. The workspace column
      // derives from the DTO assignment (spec 0048), so it only needs the
      // name map, not per-user lookups. The locations fetch rides the same
      // availability gate; the drawer refetches branches/workspaces/entities
      // for the assignment editor when it opens.
      try {
        const [workspaces] = await Promise.all([
          listAllWorkspacesScoped(sessionToken),
          listLocationsScoped(sessionToken),
        ]);
        const nameMap = new Map<string, string>();
        for (const w of workspaces) {
          nameMap.set(w.key, w.name);
        }
        setWorkspaceNameMap(nameMap);
        setWorkspacesUnavailable(false);
      } catch {
        setWorkspacesUnavailable(true);
      }
    } catch (err) {
      // STAFF-08: surface a retryable error instead of swallowing it. The
      // snapshot timestamp goes with the rows it described — the footer must
      // not keep reporting a list this screen just dropped.
      setLoadError(l10nErrorMessage(err, l10n, 'staff-error-load'));
      setStaff([]);
      setRoles([]);
      setLoadedAt(null);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, l10n]);

  useEffect(() => { load(); }, [load]);

  // ── Tabs (Staff / Roles) ───────────────────────────────────────
  //
  // The tab is the route. This component is registered at BOTH `staff` and
  // `roles`, and React reconciles by element type — so a tab click swaps the
  // route without remounting, and the two panels keep their loaded data
  // instead of flashing a skeleton on every switch.
  const [activeTab, setActiveTab] = useState<StaffTab>(() => {
    // `#/roles…` opens on Roles; anything else (a cleared hash, an unrelated
    // deep link) opens on Staff. The query is stripped because a route hash
    // may carry one — AppShell does the same before matching a page.
    const route = window.location.hash.replace(/^#\//, '').split('?')[0];
    return route === 'roles' ? 'roles' : 'staff';
  });

  const selectTab = useCallback((tab: StaffTab) => {
    setActiveTab(tab);
    // Keep the URL honest so each tab stays deep-linkable and the browser's
    // back button moves between them. AppShell's own hashchange listener
    // resolves the route from this hash, finding the same component.
    window.location.hash = `#/${tab}`;
  }, []);

  // Back/forward and external deep links land here: AppShell maps the route,
  // this keeps the tab in step with it.
  useEffect(() => {
    const syncTabFromHash = () => {
      const route = window.location.hash.replace(/^#\//, '').split('?')[0];
      if (route === 'staff' || route === 'roles') setActiveTab(route);
    };
    window.addEventListener('hashchange', syncTabFromHash);
    return () => window.removeEventListener('hashchange', syncTabFromHash);
  }, []);

  // The roles panel is mounted on first visit and then kept: it fetches the
  // role list, the permission-key registry and per-row holders, and re-issuing
  // those on every tab click is work the user did not ask for. Gated on the
  // same grant as the tab, so a staff-only manager never pays for it.
  const [rolesPanelMounted, setRolesPanelMounted] = useState(canManageRoles && activeTab === 'roles');
  useEffect(() => {
    if (canManageRoles && activeTab === 'roles') setRolesPanelMounted(true);
  }, [canManageRoles, activeTab]);

  // Header → panel. The "Add New Role" button lives in this component while
  // the editor's state lives in the panel; see RoleAuthoringPanelProps.handleRef.
  const rolesPanelRef = useRef<RoleAuthoringPanelHandle>(null);

  // ── Drawer open/close
  //
  // The drawer re-seeds its form (identity + current assignment, then the
  // profile fetch) whenever it opens with a member; these handlers only gate
  // the request.

  const openCreate = useCallback(() => {
    setEditingMember(null);
    setShowModal(true);
  }, []);

  const openEdit = useCallback((member: StaffMemberDto) => {
    setEditingMember(member);
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
  }, []);

  // ── Deactivate / Reactivate ────────────────────────────────────

  const performActivate = useCallback(async (member: StaffMemberDto) => {
    try {
      if (!sessionToken) {
        addToast({ message: l10n.getString('staff-error-save-failed'), type: 'error' });
        return;
      }
      await updateStaffScoped(sessionToken, {
        id: member.id,
        username: member.username,
        display_name: member.display_name,
        role_id: member.role_id,
        is_active: !member.is_active,
      });
      addToast({
        type: 'success',
        message: member.is_active
          ? l10n.getString('staff-toast-deactivated', { name: member.display_name })
          : l10n.getString('staff-toast-restored', { name: member.display_name }),
      });
      await load();
    } catch {
      addToast({ message: l10n.getString('staff-error-save-failed'), type: 'error' });
    }
  }, [load, sessionToken, addToast, l10n]);

  // STAFF-10: deactivating an account is high-impact — require an explicit
  // confirmation with the staff member's name before sending the request.
  // Reactivating (restoring) an inactive account needs no confirmation.
  const toggleActive = useCallback((member: StaffMemberDto) => {
    if (member.is_active) {
      setConfirmTarget(member);
    } else {
      void performActivate(member);
    }
  }, [performActivate]);

  // ── Impersonation (operator:impersonate) ────────────────────────
  const handleImpersonate = useCallback(async (member: StaffMemberDto) => {
    if (!sessionToken) {
      addToast({ message: l10n.getString('staff-impersonate-failed'), type: 'error' });
      return;
    }
    try {
      const result = await impersonateUserScoped(sessionToken, member.id);
      startImpersonation(result.session_token, member.id, member.display_name);
      addToast({
        type: 'success',
        message: l10n.getString('staff-impersonate-started', { name: member.display_name }),
      });
    } catch {
      addToast({ message: l10n.getString('staff-impersonate-failed'), type: 'error' });
    }
  }, [sessionToken, addToast, l10n, startImpersonation]);

  const confirmDeactivate = useCallback(async () => {
    if (!confirmTarget) return;
    setDeactivating(true);
    try {
      await performActivate(confirmTarget);
      setConfirmTarget(null);
    } finally {
      setDeactivating(false);
    }
  }, [confirmTarget, performActivate]);

  const cancelDeactivate = useCallback(() => {
    if (deactivating) return;
    setConfirmTarget(null);
  }, [deactivating]);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="staff-mgmt" onContextMenu={(e) => e.preventDefault()}>
      <div className="staff-mgmt-header">
        <div className="staff-mgmt-header-lead">
          {/* This screen is registered `fullscreen`, so AppLayout — and with it
              the sidebar and topbar — never renders around it. The back
              button is the only in-page route to the workspace picker, and it
              sits outside every load branch below so a failed or slow staff
              load can never strand the operator on a sidebar-less page. */}
          <button
            type="button"
            className="staff-mgmt-back-btn"
            onClick={goToWorkspacePicker}
            aria-label={l10n.getString('staff-back-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        </div>

        {/* Centre column, KDS-header style. No h1: the tab names the view, and
            a heading repeating the active tab is noise — the panel is
            announced through aria-labelledby instead. */}
        <StaffTabs activeTab={activeTab} onSelectTab={selectTab} showRoles={canManageRoles} />

        <div className="staff-mgmt-header-actions">
          {/* One action slot, two jobs: the create affordance belongs to
              whichever tab is showing. Roles is gated on the grant that gates
              its route, so a staff-only manager never sees the button. */}
          {activeTab === 'roles' && canManageRoles ? (
            <Localized id="role-create">
              <Button onClick={() => rolesPanelRef.current?.openCreate()}>Add New Role</Button>
            </Localized>
          ) : (
            <Localized id="staff-add-button">
              <Button onClick={openCreate}>Add Staff</Button>
            </Localized>
          )}
        </div>
      </div>

      {/* ── Main ──────────────────────────────────────────────────────
          The page root is a flex column that never scrolls: header and
          status footer are pinned, and THIS is the single scrolling region.
          That is what keeps the footer's status visible while a long roster
          is scrolled, and it is the shape KdsScreen uses. Everything below
          stays outside the header so a failed load cannot take the back
          button with it. */}
      <div className="staff-mgmt-main">
        <div
          className="staff-mgmt-tabpanel"
          id={STAFF_TAB_IDS.staff.panel}
          role="tabpanel"
          aria-labelledby={STAFF_TAB_IDS.staff.tab}
          hidden={activeTab !== 'staff'}
        >
          {/* C2.2: Pro tier near its 20-staff cap — upgrade nudge. */}
          {atProStaffCap && (
            <div className="staff-mgmt-approaching-banner" role="note">
              <span>{l10n.getString('staff-limit-approaching-premium')}</span>
              <Button variant="primary" size="sm" onClick={() => openUpgradePricingPage(locale, 'premium')}>
                {l10n.getString('staff-limit-approaching-premium-cta')}
              </Button>
            </div>
          )}

          {loadError ? (
            <Card shadow="sm">
              <div className="staff-mgmt-load-error" role="alert">
                <p className="staff-mgmt-load-error-message">{loadError}</p>
                <Button onClick={() => load()} variant="secondary">
                  <Localized id="staff-retry"><span>Retry</span></Localized>
                </Button>
              </div>
            </Card>
          ) : loading ? (
            <div className="staff-mgmt-loading-skeleton" aria-hidden="true">
              {/* No header mimic here: the real header is rendered above for
                  every branch, so a second one would duplicate the tab strip
                  and the actions while the list loads. */}
              <div className="staff-mgmt-table-wrap">
                <table className="staff-mgmt-table">
                  <thead>
                    <tr>
                      {['Role', 'Workspace', 'Name', 'Username', 'Status', ''].map((_, i) => (
                        <th key={i}><Skeleton variant="text" width="4rem" /></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{Array.from({ length: 4 }).map((_, r) => (
                      <tr key={r}>
                        <td><Skeleton variant="block" width="5rem" height="1.25rem" style={{ borderRadius: 'var(--radius-full)' }} /></td>
                        <td><Skeleton variant="text" width="6rem" /></td>
                        <td><Skeleton variant="text" width="7rem" /></td>
                        <td><Skeleton variant="text" width="4rem" /></td>
                        <td><Skeleton variant="text" width="3.5rem" /></td>
                        <td><Skeleton variant="block" width="5rem" height="1.5rem" /></td>
                      </tr>
                    ))}
</tbody>
                </table>
              </div>
            </div>
          ) : staff.length === 0 ? (
            <Card shadow="sm">
              <div className="staff-mgmt-empty">
                <EmptyState
                  icon={<NoStaffIcon />}
                  title={requiredLocalized(l10n, 'staff-empty')}
                  action={{ label: requiredLocalized(l10n, 'staff-empty-cta'), onClick: openCreate }}
                />
              </div>
            </Card>
          ) : (
            <StaffListTable
              staff={staff}
              workspaceNameMap={workspaceNameMap}
              workspacesUnavailable={workspacesUnavailable}
              canImpersonate={canImpersonate}
              onEdit={openEdit}
              onToggleActive={toggleActive}
              onImpersonate={handleImpersonate}
            />
          )}
        </div>

        {/* Rendered whenever its tab exists, so the tab's aria-controls always
            resolves; the PANEL inside mounts on first visit and is then kept
            (see rolesPanelMounted). */}
        {canManageRoles && (
          <div
            className="staff-mgmt-tabpanel"
            id={STAFF_TAB_IDS.roles.panel}
            role="tabpanel"
            aria-labelledby={STAFF_TAB_IDS.roles.tab}
            hidden={activeTab !== 'roles'}
          >
            {(rolesPanelMounted || activeTab === 'roles') && (
              <RoleAuthoringPanel active={activeTab === 'roles'} handleRef={rolesPanelRef} />
            )}
          </div>
        )}
      </div>

      {/* ── Status footer ───────────────────────────────────────────
          Fullscreen routes lose the app's own StatusBar (AppLayout mounts
          it), so the page carries its own. */}
      <StaffManagementFooter
        totalCount={staff.length}
        activeCount={staff.filter((member) => member.is_active).length}
        roleCount={roles.length}
        loadedAt={loadedAt}
      />

      {/* ── Add/Edit Drawer ─────────────────────────────────────── */}
      <StaffDetailDrawer
        open={showModal}
        member={editingMember}
        roles={roles}
        onClose={closeModal}
        onSaved={load}
      />

      {/* ── Deactivate Confirmation (STAFF-10) ─────────────────── */}
      <ConfirmDialog
        open={confirmTarget !== null}
        onCancel={cancelDeactivate}
        onConfirm={() => void confirmDeactivate()}
        title={l10n.getString('staff-deactivate-confirm-title')}
        message={l10n.getString('staff-deactivate-confirm-body', { name: confirmTarget?.display_name ?? '' })}
        variant="danger"
        loading={deactivating}
        confirmLabel={l10n.getString('staff-deactivate-confirm-confirm')}
        cancelLabel={l10n.getString('staff-deactivate-confirm-cancel')}
      />
    </div>
  );
}
