import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const SettingsPage = lazy(() => import('./SettingsPage'));
const FeatureToggleScreen = lazy(() => import('./FeatureToggleScreen'));
const DataManagementScreen = lazy(() => import('./DataManagementScreen'));

export function registerSettingsFeature() {
  registerPage({ route: 'settings', component: SettingsPage, label: 'General', requiredRole: 'manager', requiredPermission: 'settings:read', fullscreen: true });
  registerNavItem({
    route: 'settings',
    label: 'General',
    requiredRole: 'manager',
    requiredPermission: 'settings:read',
    i18nKey: 'nav-general',
    section: 'settings',
    icon: icon('M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42'),
  });

  registerPage({ route: 'features', component: FeatureToggleScreen, label: 'Features', requiredRole: 'owner' });
  registerNavItem({
    route: 'features',
    label: 'Features',
    requiredRole: 'owner',
    i18nKey: 'nav-features',
    section: 'tools',
    icon: icon('M13 2 3 14h9l-1 8 10-12h-9z'),
  });

  registerPage({ route: 'data-management', component: DataManagementScreen, label: 'Data', requiredRole: 'owner' });
  registerNavItem({
    route: 'data-management',
    label: 'Data',
    requiredRole: 'owner',
    i18nKey: 'nav-data',
    section: 'tools',
    icon: icon('M12 5c-5 0-9 1.34-9 3s4 3 9 3 9-1.34 9-3-4-3-9-3z', <ellipse cx="12" cy="5" rx="9" ry="3" />, <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />, <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />),
  });
}
