import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const InventoryAdjustmentScreen = lazy(() => import('./InventoryAdjustmentScreen'));
const StockCountsFlow = lazy(() => import('./StockCountsFlow'));
const InventoryThresholdsScreen = lazy(() =>
  import('./InventoryThresholdsScreen').then((m) => ({ default: m.InventoryThresholdsScreen })),
);
const InventoryLogScreen = lazy(() =>
  import('./InventoryLogScreen').then((m) => ({ default: m.InventoryLogScreen })),
);

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

  // Round 161: the per-location stock audit trail. Every command it uses is registered
  // on BOTH shells (desktop lib.rs:1541-1544, tablet lib.rs:1487-1490), so no shell
  // split is needed -- this was a missing route, not a shell asymmetry.
  registerPage({ route: 'inventory-log', component: InventoryLogScreen, label: 'Transaction Log', requiredRole: 'manager', requiredPermission: 'inventory:view' });
  registerNavItem({
    route: 'inventory-log',
    label: 'Transaction Log',
    requiredRole: 'manager',
    requiredPermission: 'inventory:view',
    i18nKey: 'nav-inventory-log',
    section: 'inventory',
    icon: icon('M4 6h16M4 12h16M4 18h10', <circle cx="18" cy="18" r="2" />),
  });

  // Round 168: per-product, per-location reorder points. All three commands are registered
  // on BOTH shells (desktop lib.rs:1545-1547, tablet lib.rs:1491-1493), so no shell split
  // is needed -- this was a missing route for a working feature.
  registerPage({ route: 'inventory-thresholds', component: InventoryThresholdsScreen, label: 'Low-Stock Thresholds', requiredRole: 'manager', requiredPermission: 'inventory:view' });
  registerNavItem({
    route: 'inventory-thresholds',
    label: 'Low-Stock Thresholds',
    requiredRole: 'manager',
    requiredPermission: 'inventory:view',
    i18nKey: 'nav-inventory-thresholds',
    section: 'inventory',
    icon: icon('M2 12h4l3-9 4 18 3-9h4', <path d="M2 12h4l3-9 4 18 3-9h4" />),
  });
}
