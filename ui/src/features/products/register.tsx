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
  // Replaced by WarehouseConsole (features/warehouse/), registered at
  // route 'warehouse'. Files kept in features/products/ for reference but no
  // longer registered as a navigable route.
  //
  // CORRECTED 2026-10-25 (round 162): this note and the banner in
  // ProductManagementScreen.tsx:2 both named `WarehouseScreen`, which DOES NOT
  // EXIST -- `git ls-files 'ui/src/features/**/WarehouseScreen*'` is empty. The
  // successor is WarehouseConsole.tsx, registered by warehouse/register.tsx:8.
  // A dead note pointing at a phantom file is worse than no note: it reads as a
  // resolved question.

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
