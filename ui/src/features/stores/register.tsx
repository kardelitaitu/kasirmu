import { lazy } from 'react';
import { registerPage } from '@/platform/ui/page-registry';
import { registerNavItem } from '@/platform/ui/menu-registry';
import { icon } from '@/platform/ui/icon';
const MultiStoreDashboardScreen = lazy(() => import('./MultiStoreDashboardScreen'));

export function registerStoresFeature() {
  registerPage({ route: 'locations', component: MultiStoreDashboardScreen, label: 'Locations', feature: 'multi-store', requiredRole: 'manager' });
  registerNavItem({
    route: 'locations',
    label: 'Locations',
    feature: 'multi-store',
    requiredRole: 'manager',
    i18nKey: 'nav-locations',
    section: 'tools',
    icon: icon('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', <polyline points="9 22 9 12 15 12 15 22" />),
  });
}
