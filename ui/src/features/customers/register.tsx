import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const CustomerManagementScreen = lazy(() => import('./CustomerManagementScreen'));

export function registerCustomersFeature() {
  registerPage({ route: 'customers', component: CustomerManagementScreen, label: 'Customers', requiredRole: 'manager', requiredPermission: 'customers:view' });
  registerNavItem({
    route: 'customers',
    label: 'Customers',
    requiredRole: 'manager',
    requiredPermission: 'customers:view',
    i18nKey: 'nav-customers',
    section: 'customers',
    icon: icon('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', <circle cx="9" cy="7" r="4" />),
  });
}
