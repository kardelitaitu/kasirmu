import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const MultiStoreDashboardScreen = lazy(() => import('./MultiStoreDashboardScreen'));
const TopologyScreen = lazy(() => import('./TopologyScreen'));

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

  registerPage({
    route: 'topology',
    component: TopologyScreen,
    label: 'Topology',
    feature: 'multi-store',
    requiredRole: 'manager',
    fullscreen: true,
  });
  registerNavItem({
    route: 'topology',
    label: 'Topology',
    feature: 'multi-store',
    requiredRole: 'manager',
    i18nKey: 'nav-topology',
    section: 'tools',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width={20} height={20} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
    ),
  });
}
