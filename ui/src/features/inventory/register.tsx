import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const InventoryAdjustmentScreen = lazy(() => import('./InventoryAdjustmentScreen'));
const StockCountsFlow = lazy(() => import('./StockCountsFlow'));

export function registerInventoryFeature() {
  registerPage({ route: 'inventory-adjustment', component: InventoryAdjustmentScreen, label: 'Stock Adjust', requiredRole: 'manager', requiredPermission: 'inventory:view' });
  registerNavItem({
    route: 'inventory-adjustment',
    label: 'Stock Adjust',
    requiredRole: 'manager',
    requiredPermission: 'inventory:view',
    i18nKey: 'nav-stock-adjust',
    section: 'products',
    icon: icon('M12 5v14M5 12h14', <line x1="12" y1="5" x2="12" y2="19" />, <line x1="5" y1="12" x2="19" y2="12" />),
  });

  registerPage({ route: 'stock-counts', component: StockCountsFlow, label: 'Stock Counts', feature: 'stock-counting', requiredRole: 'manager', requiredPermission: 'inventory:view' });
  registerNavItem({
    route: 'stock-counts',
    label: 'Stock Counts',
    feature: 'stock-counting',
    i18nKey: 'nav-stock-counts',
    section: 'inventory',
    icon: icon('M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2', <path d="M9 14l2 2 4-4" />),
  });
}
