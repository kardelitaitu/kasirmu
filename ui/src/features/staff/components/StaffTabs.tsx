/**
 * StaffTabs — the Staff / Roles tab track in the middle of the page header.
 *
 * Modelled on the KDS header tabs (`kds/components/KdsHeaderTabs.tsx`): a
 * `role="tablist"` of `role="tab"` buttons carrying `aria-selected` and
 * `aria-controls`, so each panel below is announced as its own region
 * instead of the two views reading as one long page.
 *
 * PRESENTATIONAL. It owns no state and calls no API. The active tab and its
 * setter live in the shell, because the shell resolves the tab from the route
 * hash and swaps the header's action button on it — one owner for one value.
 *
 * Whether the Roles tab exists at all is the shell's decision too, passed in
 * as `showRoles`: it is the same `staff:manage_roles` grant that gates the
 * `roles` route, and splitting that decision across two files is how a tab and
 * a route gate drift apart.
 */
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';
import { STAFF_TAB_IDS, type StaffTab } from './staffTabsModel';

export type { StaffTab };

export interface StaffTabsProps {
  /** Which tab is active — read for the class and `aria-selected`, never written here. */
  activeTab: StaffTab;
  /** The shell's tab setter; it also keeps the route hash in step. */
  onSelectTab: (tab: StaffTab) => void;
  /** Render the Roles tab. False for a session without `staff:manage_roles`. */
  showRoles: boolean;
}

/** The Staff / Roles tab bar. */
export function StaffTabs({ activeTab, onSelectTab, showRoles }: StaffTabsProps) {
  const { l10n } = useLocalization();

  return (
    <div
      className="staff-tabs"
      role="tablist"
      aria-label={requiredLocalized(l10n, 'staff-tabs-aria')}
    >
      <button
        type="button"
        id={STAFF_TAB_IDS.staff.tab}
        className={`staff-tab${activeTab === 'staff' ? ' staff-tab--active' : ''}`}
        onClick={() => onSelectTab('staff')}
        role="tab"
        aria-selected={activeTab === 'staff'}
        aria-controls={STAFF_TAB_IDS.staff.panel}
        data-testid="staff-tab-account"
      >
        <Localized id="nav-staff"><span>Staff</span></Localized>
      </button>
      {showRoles && (
        <button
          type="button"
          id={STAFF_TAB_IDS.roles.tab}
          className={`staff-tab${activeTab === 'roles' ? ' staff-tab--active' : ''}`}
          onClick={() => onSelectTab('roles')}
          role="tab"
          aria-selected={activeTab === 'roles'}
          aria-controls={STAFF_TAB_IDS.roles.panel}
          data-testid="staff-tab-roles"
        >
          <Localized id="nav-roles"><span>Roles</span></Localized>
        </button>
      )}
    </div>
  );
}
