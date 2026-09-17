import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const OfflineQueueScreen = lazy(() => import('./OfflineQueueScreen'));

export function registerOfflineFeature() {
  registerPage({ route: 'offline-queue', component: OfflineQueueScreen, label: 'Offline Queue', requiredRole: 'manager' });
  registerNavItem({
    route: 'offline-queue',
    label: 'Offline Queue',
    requiredRole: 'manager',
    i18nKey: 'nav-offline-queue',
    section: 'tools',
    icon: icon('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'),
  });
}
