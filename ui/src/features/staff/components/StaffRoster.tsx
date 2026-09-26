/**
 * StaffRoster — the Staff tab's main content: a stat row, a filter toolbar and
 * one card per member, replacing the seven-column table this screen used to
 * render.
 *
 * WHY CARDS, and not just "newer-looking": this screen is registered for BOTH
 * shells (desktop-tauri and mobile-tauri share `ui/`), and seven columns of
 * text — Role, Workspace, Name, Username, masked ID, Status, actions — is
 * unreadable on the tablet. The card states the identity once (avatar + name +
 * role + status pill) and drops the rest into a labelled meta grid, so the same
 * markup works from a phone to a desktop with no column-dropping tier.
 *
 * The avatar is `ProductThumb` — the same call the restaurant sidebar makes for
 * a user's photo, with the same `hueFromName` initials fallback when
 * `member.avatar` is null. The hash comes from the list payload
 * (`StaffMemberDto.avatar`), which the Rust DTO carries from the profile it
 * already loads per member.
 *
 * TOOLBAR: search, status filter and sort are local view state over the loaded
 * list — no IPC, no refetch. They exist because the roster is scanned by a
 * human looking for one person, which is what the table was worst at.
 *
 * Invariants:
 * - No data fetching and no confirmation UI here; the component renders what
 *   the parent loaded. Deactivation still confirms in the parent (STAFF-10).
 * - Every action keeps its stable `staff-<verb>-<id>` testid, so the suite and
 *   e2e locators never match a translated label.
 * - Styles live in `StaffManagementScreen.css` (imported by the composition
 *   root); this file owns no CSS.
 */
import { useMemo, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import type { StaffMemberDto } from '@/api/staff';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ProductThumb } from '@/components/ProductThumb';
import { RoleIcon } from '@/components/RoleIcon';
import { hueFromName } from '@/utils/color';

interface StaffRosterProps {
  /** Staff rows from `list_staff_scoped`. */
  staff: StaffMemberDto[];
  /** Roles in the loaded role list — the stat row's fourth number. */
  roleCount: number;
  /** Workspace key → display name for each card's assignment line. */
  workspaceNameMap: Map<string, string>;
  /** STAFF-08: workspace data failed to load — cards still render. */
  workspacesUnavailable: boolean;
  /** `operator:impersonate` grant gates the Impersonate action. */
  canImpersonate: boolean;
  /** Open the add/edit drawer for this member. */
  onEdit: (member: StaffMemberDto) => void;
  /** STAFF-10: deactivate (via confirm) or restore this member. */
  onToggleActive: (member: StaffMemberDto) => void;
  /**
   * Move an INACTIVE member to the trash (via confirm in the parent), or
   * undefined for a caller without `staff:delete`. Absent means the action is
   * not rendered at all — the backend also refuses an active member, so the
   * button only ever appears where it can succeed.
   */
  onDelete?: ((member: StaffMemberDto) => void) | undefined;
  /** Start an impersonation session for this member. */
  onImpersonate: (member: StaffMemberDto) => void;
}

/** Which slice of the roster is on screen. */
type StatusFilter = 'all' | 'active' | 'inactive';

/** Which field the roster is ordered by. */
type SortKey = 'role' | 'name';

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

// ── Icons ───────────────────────────────────────────────────────────
//
// Inline SVG on a 24x24 viewBox at stroke 2, coloured by currentColor — the
// shape the back button and the search fields already use, so no icon
// dependency is introduced for three glyphs.

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  width: 16,
  height: 16,
  'aria-hidden': true,
};

const SearchIcon = () => (
  <svg {...iconProps}>
    <circle cx="11" cy="11" r="7" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" />
  </svg>
);

const ClearIcon = () => (
  <svg {...iconProps} width={12} height={12}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const EditIcon = () => (
  <svg {...iconProps}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const PowerIcon = () => (
  <svg {...iconProps}>
    <path d="M12 3v9" />
    <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
  </svg>
);

const TrashIcon = () => (
  <svg {...iconProps}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

const ImpersonateIcon = () => (
  <svg {...iconProps}>
    <path d="M16 3h5v5" />
    <path d="M21 3 13 11" />
    <path d="M8 21H3v-5" />
    <path d="M3 21l8-8" />
  </svg>
);

const WorkspaceIcon = () => (
  <svg {...iconProps} width={13} height={13}>
    <path d="M3 21h18" />
    <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
    <path d="M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1" />
  </svg>
);

const PhoneIcon = () => (
  <svg {...iconProps} width={13} height={13}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

/** The Staff tab's main content. */
export function StaffRoster({
  staff,
  roleCount,
  workspaceNameMap,
  workspacesUnavailable,
  canImpersonate,
  onEdit,
  onToggleActive,
  onDelete,
  onImpersonate,
}: StaffRosterProps) {
  const { l10n } = useLocalization();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('role');

  const activeCount = useMemo(() => staff.filter((m) => m.is_active).length, [staff]);

  /**
   * The visible slice: filtered by the status chip and the search box, then
   * ordered. Search covers the three fields a manager actually has in hand —
   * name, username and the masked ID — matched case-insensitively.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = staff.filter((member) => {
      if (status !== 'all' && member.is_active !== (status === 'active')) return false;
      if (needle === '') return true;
      return (
        member.display_name.toLowerCase().includes(needle) ||
        member.username.toLowerCase().includes(needle) ||
        member.national_id_masked.toLowerCase().includes(needle)
      );
    });
    // Name is the tiebreak inside the role order, so the roster is stable
    // rather than depending on the backend's row order.
    return [...matches].sort((a, b) =>
      sort === 'name'
        ? a.display_name.localeCompare(b.display_name)
        : a.role_name.localeCompare(b.role_name) || a.display_name.localeCompare(b.display_name),
    );
  }, [staff, query, status, sort]);

  const filters: {
    id: StatusFilter;
    label: React.ReactNode;
    count: number;
    statTestId: string;
  }[] = [
    {
      id: 'all',
      label: <Localized id="staff-filter-all"><span>All</span></Localized>,
      count: staff.length,
      statTestId: 'staff-stat-total',
    },
    {
      id: 'active',
      label: <Localized id="staff-status-active"><span>Active</span></Localized>,
      count: activeCount,
      statTestId: 'staff-stat-active',
    },
    {
      id: 'inactive',
      label: <Localized id="staff-status-inactive"><span>Inactive</span></Localized>,
      count: staff.length - activeCount,
      statTestId: 'staff-stat-inactive',
    },
  ];

  const filterIndex = Math.max(0, filters.findIndex((f) => f.id === status));

  return (
    <div className="staff-mgmt-roster">
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

      {/* Unified Toolbar: Integrated Counter Badges + Filter Tabs + Search & Sort */}
      <div className="staff-mgmt-toolbar" data-testid="staff-mgmt-toolbar">
        <div className="staff-mgmt-toolbar-left">
          <div
            className="staff-mgmt-filters"
            role="tablist"
            style={{
              '--segmented-tab-count': filters.length,
              '--segmented-tab-index': filterIndex,
            } as React.CSSProperties}
          >
            <span className="staff-mgmt-filter-indicator" aria-hidden="true" />
            {filters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                role="tab"
                aria-selected={status === filter.id}
                aria-pressed={status === filter.id}
                className={`staff-mgmt-chip${status === filter.id ? ' staff-mgmt-chip--on' : ''}`}
                onClick={() => setStatus(filter.id)}
                data-testid={`staff-filter-${filter.id}`}
              >
                <span className="staff-mgmt-chip-label">{filter.label}</span>
                <span className="staff-mgmt-chip-count" data-testid={filter.statTestId}>
                  {filter.count}
                </span>
              </button>
            ))}
          </div>

          <span className="staff-mgmt-toolbar-sep" aria-hidden="true" />

          <div className="staff-mgmt-role-stat" data-testid="staff-role-stat">
            <RoleIcon role="admin" size={16} className="staff-mgmt-role-stat-icon" />
            <span className="staff-mgmt-role-stat-label">
              <Localized id="nav-roles"><span>Roles</span></Localized>
            </span>
            <span className="staff-mgmt-chip-count" data-testid="staff-stat-roles">
              {roleCount}
            </span>
          </div>
        </div>

        <div className="staff-mgmt-toolbar-right">
          <div className="staff-mgmt-search-field">
            <SearchIcon />
            <Localized id="staff-search" attrs={{ 'aria-label': true, placeholder: true }}>
              <input
                type="search"
                className="staff-mgmt-search-input"
                aria-label="Search staff"
                placeholder="Search name, username or ID"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                data-testid="staff-search"
              />
            </Localized>
            <button
              type="button"
              className={`staff-mgmt-search-clear${query ? ' staff-mgmt-search-clear--visible' : ''}`}
              onClick={() => setQuery('')}
              aria-label={l10n.getString('clear-aria')}
              tabIndex={query ? 0 : -1}
              aria-hidden={!query}
            >
              <ClearIcon />
            </button>
          </div>

          <Localized id="staff-sort" attrs={{ 'aria-label': true }}>
            <select
              className="staff-mgmt-sort"
              aria-label="Sort staff by"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              data-testid="staff-sort"
            >
              <option value="role">{l10n.getString('staff-col-role')}</option>
              <option value="name">{l10n.getString('staff-col-name')}</option>
            </select>
          </Localized>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="staff-mgmt-no-matches" role="status">
          <Localized id="staff-no-matches">
            <span>No staff match your search</span>
          </Localized>
        </p>
      ) : (
        <ul className="staff-mgmt-grid" aria-label={l10n.getString('staff-table-aria')}>
          {visible.map((member) => {
            const assignedAll =
              member.assignment.scope_mode === 'global' || member.assignment.workspaces_all;
            const workspaceLabel = assignedAll
              ? l10n.getString('staff-assignment-all-workspaces-short')
              : member.assignment.workspace_keys
                  .map((key) => workspaceNameMap.get(key) ?? key)
                  .join(', ') || '—';
            return (
              <li
                key={member.id}
                className={`staff-mgmt-card${member.is_active ? '' : ' staff-mgmt-card--inactive'}`}
                data-testid={`staff-card-${member.id}`}
              >
                {/* 1. Header: Avatar + Identity + Status */}
                <div className="staff-mgmt-card-header">
                  <div className="staff-mgmt-card-identity">
                    <div className="staff-mgmt-avatar-wrap">
                      <ProductThumb
                        className="staff-mgmt-avatar"
                        hash={member.avatar ?? null}
                        name={member.display_name}
                        size={42}
                        shape="circle"
                        lazy={false}
                        hue={hueFromName(member.display_name)}
                      />
                    </div>
                    <div className="staff-mgmt-card-who">
                      <span className="staff-mgmt-card-name">{member.display_name}</span>
                      <div className="staff-mgmt-card-sub-row">
                        <span className="staff-mgmt-card-username">
                          <span className="staff-mgmt-card-at" aria-hidden="true">@</span>
                          <span className="staff-mgmt-card-username-val">{member.username}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <span
                    className={`staff-mgmt-status-pill ${member.is_active ? 'staff-mgmt-status-pill--active' : 'staff-mgmt-status-pill--inactive'}`}
                    role="img"
                    aria-label={l10n.getString(member.is_active ? 'staff-status-active' : 'staff-status-inactive')}
                  >
                    <span
                      className={`staff-mgmt-status-dot ${member.is_active ? 'staff-mgmt-status-dot--on' : 'staff-mgmt-status-dot--off'}`}
                      aria-hidden="true"
                    />
                    <span className="staff-mgmt-status-text">
                      {l10n.getString(member.is_active ? 'staff-status-active' : 'staff-status-inactive')}
                    </span>
                  </span>
                </div>

                {/* 2. Metadata: Workspace & Phone */}
                <div className="staff-mgmt-card-meta">
                  <div className={`staff-mgmt-meta-item${assignedAll ? '' : ' staff-mgmt-meta-item--wide'}`}>
                    <div className="staff-mgmt-meta-header">
                      <WorkspaceIcon />
                      <span className="staff-mgmt-meta-label">
                        <Localized id="staff-col-workspace"><span>Workspace</span></Localized>
                      </span>
                    </div>
                    <span className="staff-mgmt-meta-val">{workspaceLabel}</span>
                  </div>
                  <div className="staff-mgmt-meta-item">
                    <div className="staff-mgmt-meta-header">
                      <PhoneIcon />
                      <span className="staff-mgmt-meta-label">
                        <Localized id="staff-col-phone"><span>Phone</span></Localized>
                      </span>
                    </div>
                    <span className={`staff-mgmt-meta-val${member.phone ? ' staff-mgmt-mono' : ' staff-mgmt-meta-val--empty'}`}>
                      {member.phone ?? '—'}
                    </span>
                  </div>
                </div>

                {/* 3. Footer: Role Badge on Left, Action Group on Right */}
                <div className="staff-mgmt-card-footer">
                  <div className="staff-mgmt-card-footer-left">
                    <Badge variant={roleVariant(member.role_name)}>
                      <span className="staff-mgmt-role-badge-content">
                        <RoleIcon role={member.role_name} size={14} className="staff-mgmt-role-icon" />
                        <span>{member.role_name}</span>
                      </span>
                    </Badge>
                  </div>

                  <div className="staff-mgmt-card-actions">
                    <Localized id="staff-edit-aria" attrs={{ 'aria-label': true }} vars={{ name: member.display_name }}>
                      <Button
                        unstyled
                        className="staff-mgmt-icon-btn"
                        onClick={() => onEdit(member)}
                        data-testid={`staff-edit-${member.id}`}
                      >
                        <EditIcon />
                      </Button>
                    </Localized>
                    <Localized id={member.is_active ? 'staff-deactivate-aria' : 'staff-restore-aria'} attrs={{ 'aria-label': true }} vars={{ name: member.display_name }}>
                      <Button
                        unstyled
                        className={`staff-mgmt-icon-btn ${member.is_active ? 'staff-mgmt-icon-btn--warn' : 'staff-mgmt-icon-btn--restore'}`}
                        onClick={() => onToggleActive(member)}
                        data-testid={`staff-toggle-active-${member.id}`}
                      >
                        <PowerIcon />
                      </Button>
                    </Localized>
                    {onDelete && !member.is_active && (
                      <Localized id="staff-delete-aria" attrs={{ 'aria-label': true }} vars={{ name: member.display_name }}>
                        <Button
                          unstyled
                          className="staff-mgmt-icon-btn staff-mgmt-icon-btn--warn"
                          onClick={() => onDelete(member)}
                          data-testid={`staff-delete-${member.id}`}
                        >
                          <TrashIcon />
                        </Button>
                      </Localized>
                    )}
                    {canImpersonate && (
                      <Localized id="staff-impersonate-aria" attrs={{ 'aria-label': true }} vars={{ name: member.display_name }}>
                        <Button
                          unstyled
                          className="staff-mgmt-icon-btn"
                          onClick={() => onImpersonate(member)}
                          data-testid={`staff-impersonate-${member.id}`}
                        >
                          <ImpersonateIcon />
                        </Button>
                      </Localized>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
