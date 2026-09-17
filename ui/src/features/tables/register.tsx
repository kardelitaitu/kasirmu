import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const TableManagementScreen = lazy(() => import('./TableManagementScreen'));

export function registerTablesFeature() {
  registerPage({ route: 'tables', component: TableManagementScreen, label: 'Tables', feature: 'table-management' });
  registerNavItem({
    route: 'tables',
    label: 'Tables',
    feature: 'table-management',
    i18nKey: 'nav-tables',
    section: 'operations',
    icon: icon('M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z'),
  });
}
