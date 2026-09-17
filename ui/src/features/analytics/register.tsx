import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const AnalyticsScreen = lazy(() => import('./AnalyticsScreen'));

export function registerAnalyticsFeature() {
  // analytics:view — owner/admin/manager only (0046 registry + 0048 scope,
  // aligned to the manager+ plan). The permission key is authoritative when
  // the session carries granted keys; requiredRole is the fallback for
  // environments without them.
  registerPage({ route: 'analytics', component: AnalyticsScreen, label: 'Analytics', requiredRole: 'manager', requiredPermission: 'analytics:view', fullscreen: true });
  registerNavItem({
    route: 'analytics',
    label: 'Analytics',
    requiredRole: 'manager',
    requiredPermission: 'analytics:view',
    i18nKey: 'nav-analytics',
    section: 'reports',
    icon: icon('M3 3v18h18', <path d="M7 15l4-6 3 3 5-8" />),
  });
}
