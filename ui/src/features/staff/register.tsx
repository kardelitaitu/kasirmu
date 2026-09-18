import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
const StaffManagementScreen = lazy(() => import('./StaffManagementScreen'));
const RoleAuthoringScreen = lazy(() => import('./RoleAuthoringScreen'));

export function registerStaffFeature() {
  // Both routes register `fullscreen`, so AppShell renders them without the
  // AppLayout wrapper — no sidebar, no app topbar. They are dedicated
  // settings pages, not workspace tools: neither carries a `registerNavItem`
  // entry, and the two reach each other through the links in their own
  // headers (Staff ↔ Roles) plus the back button to the workspace picker.
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
    component: RoleAuthoringScreen,
    label: 'Roles',
    requiredRole: 'manager',
    requiredPermission: 'staff:manage_roles',
    fullscreen: true,
  });
}
