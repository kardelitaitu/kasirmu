import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const ProductLookupScreen = lazy(() => import('./ProductLookupScreen'));
const BundleManagementScreen = lazy(() => import('./BundleManagementScreen'));

export function registerProductsFeature() {
  registerPage({ route: 'products', component: ProductLookupScreen, label: 'Products' });
  registerNavItem({
    route: 'products',
    label: 'Products',
    i18nKey: 'nav-products',
    section: 'products',
    icon: icon('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'),
  });

  // ── ARCHIVED: 'inventory' route ────────────────────────────────
  // ProductManagementScreen was the old global inventory page.
  // Replaced by WarehouseScreen (features/warehouse/) which provides
  // location-scoped stock management. Files kept in features/products/
  // for reference but no longer registered as a navigable route.

  registerPage({ route: 'bundles', component: BundleManagementScreen, label: 'Bundles', requiredRole: 'manager' });
  registerNavItem({
    route: 'bundles',
    label: 'Bundles',
    requiredRole: 'manager',
    i18nKey: 'nav-bundles',
    section: 'products',
    icon: icon('M16 11V7a4 4 0 0 0-8 0v4M5 9h14l1 12H4L5 9z'),
  });
}
