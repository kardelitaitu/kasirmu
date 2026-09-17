import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const SuppliersScreen = lazy(() => import('./SuppliersScreen'));
const PurchaseOrdersScreen = lazy(() => import('./PurchaseOrdersScreen'));

export function registerPurchasingFeature() {
  registerPage({ route: 'suppliers', component: SuppliersScreen, label: 'Suppliers', feature: 'purchase-orders' });
  registerNavItem({
    route: 'suppliers',
    label: 'Suppliers',
    feature: 'purchase-orders',
    i18nKey: 'nav-suppliers',
    section: 'inventory',
    icon: icon('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', <circle cx="9" cy="7" r="4" />, <path d="M22 21v-2a4 4 0 0 0-3-3.87" />, <path d="M16 3.13a4 4 0 0 1 0 7.75" />),
  });

  registerPage({ route: 'purchase-orders', component: PurchaseOrdersScreen, label: 'Purchase Orders', feature: 'purchase-orders' });
  registerNavItem({
    route: 'purchase-orders',
    label: 'Purchase Orders',
    feature: 'purchase-orders',
    i18nKey: 'nav-purchase-orders',
    section: 'inventory',
    icon: icon('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', <polyline points="14 2 14 8 20 8" />, <line x1="16" y1="13" x2="8" y2="13" />, <line x1="16" y1="17" x2="8" y2="17" />, <polyline points="10 9 9 9 8 9" />),
  });
}
