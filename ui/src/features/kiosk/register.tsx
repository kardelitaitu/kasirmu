import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const KioskScreen = lazy(() => import('./KioskScreen'));

export function registerKioskFeature() {
  registerPage({ route: 'kiosk', component: KioskScreen, label: 'Kiosk', feature: 'self-service-kiosk', fullscreen: true });
  registerNavItem({
    route: 'kiosk',
    label: 'Kiosk',
    feature: 'self-service-kiosk',
    i18nKey: 'nav-kiosk',
    section: 'operations',
    icon: icon('M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'),
  });
}
