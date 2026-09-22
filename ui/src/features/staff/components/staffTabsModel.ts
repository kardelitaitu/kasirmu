/**
 * The Staff / Roles tab vocabulary, shared by the tab strip and the page shell
 * that owns the panels.
 *
 * Its own module rather than part of `StaffTabs.tsx` for two reasons: the
 * shell needs the same element ids the tabs point at, and a component file
 * that also exports a runtime constant breaks React Fast Refresh
 * (`react-refresh/only-export-components`) — the props type may be re-exported
 * from there because it is erased, the id map may not.
 */

/** The two views the staff page hosts. Also the two route names it registers under. */
export type StaffTab = 'staff' | 'roles';

/**
 * Tab/panel element ids, in one place because the tablist writes them
 * (`aria-controls`) and the panels read them (`aria-labelledby`): two files
 * deriving the same ids independently is how `aria-controls` ends up pointing
 * at nothing.
 */
export const STAFF_TAB_IDS: Record<StaffTab, { tab: string; panel: string }> = {
  staff: { tab: 'staff-tab-account', panel: 'staff-panel-account' },
  roles: { tab: 'staff-tab-roles', panel: 'staff-panel-roles' },
};

/**
 * The two tabs in strip order, left to right. The strip builds its segments in
 * this order, so it is also the direction the thumb travels — and the panel
 * slide reads its own direction from the same order, which is why it lives here
 * rather than being inferred twice.
 */
export const STAFF_TAB_ORDER: readonly StaffTab[] = ['staff', 'roles'];
