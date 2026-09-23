import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';

// ONE lazy component, registered at BOTH routes on purpose. React reconciles
// by element type, so moving between `staff` and `roles` re-renders this
// component instead of remounting it — which is what lets the Staff/Roles tabs
// swap views without dropping the loaded lists or flashing a skeleton. Two
// distinct components here would make every tab click a full remount.
const StaffManagementScreen = lazy(() => import('./StaffManagementScreen'));

export function registerStaffFeature() {
  // Both routes register `fullscreen`, so AppShell renders them without the
  // AppLayout wrapper — no sidebar, no app topbar. They are dedicated
  // settings pages, not workspace tools: neither carries a `registerNavItem`
  // entry. The two views are tabs inside the one page, and the routes differ
  // only in which tab they open on — plus their gate, which stays per-route
  // so a deep link cannot reach role authoring on a lesser grant.
  //
  // Role authoring is gated on staff:manage_roles, not staff:read: the
  // screen writes the grant sets every other gate resolves through, so
  // read-only staff must not reach it. The routes are registered lazily like
  // every other feature screen — a grep for an importer will not find one.
  registerPage({
    route: 'staff',
    component: StaffManagementScreen,
    label: 'Staff',
    requiredRole: 'manager',
    requiredPermission: 'staff:read',
    fullscreen: true,
  });
  registerPage({
    route: 'roles',
    component: StaffManagementScreen,
    label: 'Roles',
    requiredRole: 'manager',
    requiredPermission: 'staff:manage_roles',
    fullscreen: true,
  });
  // The trash is a third tab on the same page and the same component, gated on
  // the key its commands enforce. Deleted identities stay readable here, so the
  // gate is staff:delete (owner-only by preset) rather than staff:read: a
  // manager who cannot delete anyone has no business reading who was deleted.
  registerPage({
    route: 'trash',
    component: StaffManagementScreen,
    label: 'Trash',
    requiredRole: 'manager',
    requiredPermission: 'staff:delete',
    fullscreen: true,
  });
}
