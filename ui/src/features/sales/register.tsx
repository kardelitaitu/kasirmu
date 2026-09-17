import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
import { registerSalesWidgets } from './widgets';
const PosScreen = lazy(() => import('./PosScreen'));
const SalesHistoryScreen = lazy(() => import('./SalesHistoryScreen'));
const SalesDashboardScreen = lazy(() => import('./SalesDashboardScreen'));
const EodReportScreen = lazy(() => import('./EodReportScreen'));
const VoidOrdersScreen = lazy(() => import('./VoidOrdersScreen'));

export function registerSalesFeature() {
  registerSalesWidgets();

  registerPage({ route: 'sales', component: PosScreen, label: 'POS Terminal', feature: 'simple-retail' });
  registerPage({ route: 'pos', component: PosScreen, label: 'POS Terminal', feature: 'simple-retail' });
  registerNavItem({
    route: 'sales',
    label: 'POS Terminal',
    feature: 'simple-retail',
    i18nKey: 'nav-pos-terminal',
    section: 'operations',
    icon: icon('M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', <polyline points="3.29 7 12 12 20.71 7" />),
  });

  registerPage({ route: 'sales-history', component: SalesHistoryScreen, label: 'Sales History', feature: 'simple-retail', requiredRole: 'manager' });
  registerNavItem({
    route: 'sales-history',
    label: 'Sales History',
    feature: 'simple-retail',
    requiredRole: 'manager',
    i18nKey: 'nav-sales-history',
    section: 'sales',
    icon: icon('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', <polyline points="14 2 14 8 20 8" />, <line x1="16" y1="13" x2="8" y2="13" />, <line x1="16" y1="17" x2="8" y2="17" />),
  });

  registerPage({ route: 'sales-dashboard', component: SalesDashboardScreen, label: 'Dashboard', feature: 'simple-retail', requiredRole: 'manager' });
  registerNavItem({
    route: 'sales-dashboard',
    label: 'Dashboard',
    feature: 'simple-retail',
    requiredRole: 'manager',
    i18nKey: 'nav-dashboard',
    section: 'sales',
    icon: icon('M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z'),
  });

  registerPage({ route: 'eod-report', component: EodReportScreen, label: 'EOD Report', requiredRole: 'manager', requiredPermission: 'reports:view' });
  registerNavItem({
    route: 'eod-report',
    label: 'EOD Report',
    requiredRole: 'manager',
    requiredPermission: 'reports:view',
    i18nKey: 'nav-eod-report',
    section: 'sales',
    icon: icon('M21.21 15.89A10 10 0 1 1 8 2.83', <path d="M22 12A10 10 0 0 0 12 2v10z" />),
  });

  registerPage({ route: 'orders', component: VoidOrdersScreen, label: 'Orders', feature: 'simple-retail', requiredRole: 'manager' });
  registerNavItem({
    route: 'orders',
    label: 'Orders',
    feature: 'simple-retail',
    requiredRole: 'manager',
    i18nKey: 'nav-orders',
    section: 'sales',
    icon: icon('M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2', <rect x="9" y="3" width="6" height="4" rx="1" />, <path d="M9 14l2 2 4-4" />),
  });
}
