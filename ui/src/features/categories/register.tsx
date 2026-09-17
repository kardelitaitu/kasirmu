import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const CategoryManagementScreen = lazy(() => import('./CategoryManagementScreen'));

export function registerCategoriesFeature() {
  registerPage({ route: 'categories', component: CategoryManagementScreen, label: 'Categories', feature: 'categories-enabled', requiredRole: 'manager' });
  registerNavItem({
    route: 'categories',
    label: 'Categories',
    feature: 'categories-enabled',
    requiredRole: 'manager',
    i18nKey: 'nav-categories',
    section: 'products',
    icon: icon('M4 6h16M4 12h16M4 18h10'),
  });
}
