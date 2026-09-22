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

const ImpersonateIcon = () => (
  <svg {...iconProps}>
    <path d="M16 3h5v5" />
    <path d="M21 3 13 11" />
    <path d="M8 21H3v-5" />
    <path d="M3 21l8-8" />
  </svg>
);

/** One stat tile: the number is the hero, the label names it. */
function Stat({ value, label, testId, className }: {
  value: number;
  label: React.ReactNode;
  testId: string;
  /** The tone modifier, spelled out at the call site — screenExtraction's
   *  dead-class walk reads literals, and `--${tone}` is invisible to it. */
  className: string;
}) {
  return (
    <div className={`staff-mgmt-stat ${className}`} data-testid={testId}>
      <span className="staff-mgmt-stat-value">{value}</span>
      <span className="staff-mgmt-stat-label">{label}</span>
    </div>
  );
}

/** The Staff tab's main content. */
export function StaffRoster({
  staff,
  roleCount,
  workspaceNameMap,
  workspacesUnavailable,
  canImpersonate,
  onEdit,
  onToggleActive,
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

  const filters: { id: StatusFilter; label: React.ReactNode }[] = [
    { id: 'all', label: <Localized id="staff-filter-all"><span>All</span></Localized> },
    { id: 'active', label: <Localized id="staff-status-active"><span>Active</span></Localized> },
    { id: 'inactive', label: <Localized id="staff-status-inactive"><span>Inactive</span></Localized> },
  ];

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

      <div className="staff-mgmt-stats">
        <Stat className="staff-mgmt-stat--neutral" value={staff.length} testId="staff-stat-total"
          label={<Localized id="staff-stat-total"><span>Total</span></Localized>} />
        <Stat className="staff-mgmt-stat--success" value={activeCount} testId="staff-stat-active"
          label={<Localized id="staff-status-active"><span>Active</span></Localized>} />
        <Stat className="staff-mgmt-stat--muted" value={staff.length - activeCount} testId="staff-stat-inactive"
          label={<Localized id="staff-status-inactive"><span>Inactive</span></Localized>} />
        <Stat className="staff-mgmt-stat--accent" value={roleCount} testId="staff-stat-roles"
          label={<Localized id="nav-roles"><span>Roles</span></Localized>} />
      </div>

      <div className="staff-mgmt-toolbar">
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
        </div>
        <div className="staff-mgmt-filters">
          {filters.map((filter) => (
            <Button
              key={filter.id}
              unstyled
              className={`staff-mgmt-chip${status === filter.id ? ' staff-mgmt-chip--on' : ''}`}
              aria-pressed={status === filter.id}
              onClick={() => setStatus(filter.id)}
              data-testid={`staff-filter-${filter.id}`}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        {/* Attribute-only message: delivered by <Localized>, never getString. */}
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
                <div className="staff-mgmt-card-top">
                  <ProductThumb
                    className="staff-mgmt-avatar"
                    hash={member.avatar ?? null}
                    name={member.display_name}
                    size={40}
                    shape="circle"
                    lazy={false}
                    hue={hueFromName(member.display_name)}
                  />
                  <div className="staff-mgmt-card-who">
                    <span className="staff-mgmt-card-name">{member.display_name}</span>
                    <Badge variant={roleVariant(member.role_name)}>
                      <span className="staff-mgmt-role-badge-content">
                        <RoleIcon role={member.role_name} size={16} className="staff-mgmt-role-icon" />
                        <span>{member.role_name}</span>
                      </span>
                    </Badge>
                    {!member.is_profile_complete && (
                      <Badge variant="warning" className="staff-mgmt-incomplete-badge">
                        <Localized id="staff-profile-incomplete">
                          <span>Profile incomplete</span>
                        </Localized>
                      </Badge>
                    )}
                  </div>
                  {/* Status is a dot in the corner, and the word is its accessible
                      name — so the state is announced rather than carried by
                      colour alone. No `title`: native tooltips are gated off
                      (nativeTooltipCompliance), and the filled-vs-hollow shape
                      is what separates the two states for everyone else. */}
                  <span
                    className={`staff-mgmt-status-dot ${member.is_active ? 'staff-mgmt-status-dot--on' : 'staff-mgmt-status-dot--off'}`}
                    role="img"
                    aria-label={l10n.getString(member.is_active ? 'staff-status-active' : 'staff-status-inactive')}
                  />
                </div>

                <dl className="staff-mgmt-meta">
                  <div className="staff-mgmt-meta-item">
                    <Localized id="staff-col-username"><dt>Username</dt></Localized>
                    <dd className="staff-mgmt-mono">{member.username}</dd>
                  </div>
                  <div className="staff-mgmt-meta-item">
                    <Localized id="staff-col-phone"><dt>Phone</dt></Localized>
                    <dd className="staff-mgmt-mono">{member.phone ?? '—'}</dd>
                  </div>
                  {/* Workspace spans the row: a scoped member lists every key. */}
                  <div className="staff-mgmt-meta-item staff-mgmt-meta-item--wide">
                    <Localized id="staff-col-workspace"><dt>Workspace</dt></Localized>
                    <dd>{workspaceLabel}</dd>
                  </div>
                </dl>

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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
