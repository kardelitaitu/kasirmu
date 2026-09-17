import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const StockTransfersScreen = lazy(() => import('./StockTransfersScreen'));

export function registerStockTransfersFeature() {
  registerPage({ route: 'stock-transfers', component: StockTransfersScreen, label: 'Stock Transfers', feature: 'stock-transfers' });
  registerNavItem({
    route: 'stock-transfers',
    label: 'Stock Transfers',
    feature: 'stock-transfers',
    i18nKey: 'nav-stock-transfers',
    section: 'inventory',
    icon: icon('M5 12h14M12 5l7 7-7 7'),
  });
}
