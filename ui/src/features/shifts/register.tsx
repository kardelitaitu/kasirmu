import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const ShiftManagementScreen = lazy(() => import('./ShiftManagementScreen'));

export function registerShiftsFeature() {
  registerPage({ route: 'shifts', component: ShiftManagementScreen, label: 'Shifts', requiredRole: 'manager', requiredPermission: 'shifts:view_any' });
  registerNavItem({
    route: 'shifts',
    label: 'Shifts',
    requiredRole: 'manager',
    requiredPermission: 'shifts:view_any',
    i18nKey: 'nav-shifts',
    section: 'tools',
    icon: icon('M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', <line x1="12" y1="1" x2="12" y2="23" />),
  });
}
