import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const StaffManagementScreen = lazy(() => import('./StaffManagementScreen'));
const RoleAuthoringScreen = lazy(() => import('./RoleAuthoringScreen'));

export function registerStaffFeature() {
  // Role authoring is gated on staff:manage_roles, not staff:read: the
  // screen writes the grant sets every other gate resolves through, so
  // read-only staff must not reach it. The route is registered lazily like
  // every other feature screen — a grep for an importer will not find one.
  registerPage({ route: 'staff', component: StaffManagementScreen, label: 'Staff', requiredRole: 'manager', requiredPermission: 'staff:read' });
  registerNavItem({
    route: 'staff',
    label: 'Staff',
    requiredRole: 'manager',
    requiredPermission: 'staff:read',
    i18nKey: 'nav-staff',
    section: 'tools',
    icon: icon('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', <circle cx="9" cy="7" r="4" />, <path d="M23 21v-2a4 4 0 0 0-3-3.87" />, <path d="M16 3.13a4 4 0 0 1 0 7.75" />),
  });
  registerPage({
    route: 'roles',
    component: RoleAuthoringScreen,
    label: 'Roles',
    requiredRole: 'manager',
    requiredPermission: 'staff:manage_roles',
  });
  registerNavItem({
    route: 'roles',
    label: 'Roles',
    requiredRole: 'manager',
    requiredPermission: 'staff:manage_roles',
    i18nKey: 'nav-roles',
    section: 'tools',
    icon: icon(
      'M12 2l7 4v6c0 5-3 8-7 10-4-2-7-5-7-10V6l7-4z',
      <path key="key" d="M15 9a3 3 0 1 1-3 3" />,
    ),
  });
}
