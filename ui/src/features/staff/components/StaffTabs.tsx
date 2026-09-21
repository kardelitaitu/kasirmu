/**
 * StaffTabs — the Staff / Roles tab strip in the middle of the page header, as
 * the staff page's binding of the shared segmented control.
 *
 * The strip itself is `SegmentedTabs` (components/SegmentedTabs.tsx): the
 * track, the sliding thumb and the button styling all live there now, together
 * with the equal-column layout the thumb's geometry depends on. What stays here
 * is everything specific to THIS page — the tab vocabulary and element ids
 * (`staffTabsModel`), the `data-testid`s the screen's tests click, the
 * `staff-tabs` class its stylesheet uses as a placement hook, and the strip's
 * accessible name.
 *
 * PRESENTATIONAL, and more so than before: it owns no state, calls no API, and
 * now measures nothing either. The active tab and its setter live in the shell,
 * because the shell resolves the tab from the route hash and swaps the header's
 * action button on it — one owner for one value.
 *
 * Whether the Roles tab exists at all is the shell's decision too, passed in as
 * `showRoles`: it is the same `staff:manage_roles` grant that gates the `roles`
 * route, and splitting that decision across two files is how a tab and a route
 * gate drift apart. It is also the thumb's segment count, for the same reason:
 * a Roles tab that is not rendered must not still be a column.
 */
import { Localized, useLocalization } from '@fluent/react';
import { SegmentedTabs, requiredLocalized, type SegmentedTabItem } from '@/components';
import { STAFF_TAB_IDS, type StaffTab } from './staffTabsModel';

export type { StaffTab };

export interface StaffTabsProps {
  /** Which tab is active — read for the selected segment, never written here. */
  activeTab: StaffTab;
  /** The shell's tab setter; it also keeps the route hash in step. */
  onSelectTab: (tab: StaffTab) => void;
  /** Render the Roles tab. False for a session without `staff:manage_roles`. */
  showRoles: boolean;
}

/** The Staff / Roles tab strip. */
export function StaffTabs({ activeTab, onSelectTab, showRoles }: StaffTabsProps) {
  const { l10n } = useLocalization();

  const items: SegmentedTabItem<StaffTab>[] = [
    {
      value: 'staff',
      label: <Localized id="nav-staff"><span>Staff</span></Localized>,
      tabId: STAFF_TAB_IDS.staff.tab,
      controls: STAFF_TAB_IDS.staff.panel,
      testId: 'staff-tab-account',
    },
    ...(showRoles
      ? [{
        value: 'roles' as StaffTab,
        label: <Localized id="nav-roles"><span>Roles</span></Localized>,
        tabId: STAFF_TAB_IDS.roles.tab,
        controls: STAFF_TAB_IDS.roles.panel,
        testId: 'staff-tab-roles',
      }]
      : []),
  ];

  return (
    <SegmentedTabs
      items={items}
      activeValue={activeTab}
      onSelect={onSelectTab}
      ariaLabel={requiredLocalized(l10n, 'staff-tabs-aria')}
      className="staff-tabs"
    />
  );
}
