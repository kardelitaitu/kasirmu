import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const PromotionManagementScreen = lazy(() => import('./PromotionManagementScreen'));

export function registerPromotionsFeature() {
  registerPage({ route: 'promotions', component: PromotionManagementScreen, label: 'Promotions', requiredRole: 'manager' });
  registerNavItem({
    route: 'promotions',
    label: 'Promotions',
    requiredRole: 'manager',
    i18nKey: 'nav-promotions',
    section: 'finance',
    icon: icon('M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'),
  });
}
