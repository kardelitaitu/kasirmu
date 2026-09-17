import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const DashboardScreen = lazy(() => import('./DashboardScreen'));
const SalesReportScreen = lazy(() => import('./SalesReportScreen'));
const InventoryReportScreen = lazy(() => import('./InventoryReportScreen'));
const MenuEngineeringScreen = lazy(() => import('./MenuEngineeringScreen'));
const CustomReportScreen = lazy(() => import('./CustomReportScreen'));

export function registerReportsFeature() {
  registerPage({ route: 'dashboard', component: DashboardScreen, label: 'Dashboard', requiredRole: 'manager', requiredPermission: 'reports:view', fullscreen: true });
  registerNavItem({
    route: 'dashboard',
    label: 'Dashboard',
    requiredRole: 'manager',
    requiredPermission: 'reports:view',
    i18nKey: 'nav-dashboard-report',
    section: 'reports',
    icon: icon('M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z'),
  });

  registerPage({ route: 'reports', component: SalesReportScreen, label: 'Sales Report', requiredRole: 'manager', requiredPermission: 'reports:view' });
  registerNavItem({
    route: 'reports',
    label: 'Sales Report',
    requiredRole: 'manager',
    requiredPermission: 'reports:view',
    i18nKey: 'nav-sales-report',
    section: 'reports',
    icon: icon('M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z'),
  });

  registerPage({ route: 'inventory-report', component: InventoryReportScreen, label: 'Inventory Report', requiredRole: 'manager', requiredPermission: 'inventory:view' });
  registerNavItem({
    route: 'inventory-report',
    label: 'Inventory Report',
    requiredRole: 'manager',
    requiredPermission: 'inventory:view',
    i18nKey: 'nav-inventory-report',
    section: 'reports',
    icon: icon('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'),
  });

  registerPage({ route: 'menu-engineering', component: MenuEngineeringScreen, label: 'Menu Engineering', feature: 'restaurant', requiredRole: 'manager', requiredPermission: 'reports:view' });
  registerNavItem({
    route: 'menu-engineering',
    label: 'Menu Engineering',
    feature: 'restaurant',
    requiredRole: 'manager',
    requiredPermission: 'reports:view',
    i18nKey: 'nav-menu-engineering',
    section: 'reports',
    icon: icon('M16 18l6-6-4-4M8 6l-6 6 4 4', <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />),
  });

  registerPage({ route: 'custom-report', component: CustomReportScreen, label: 'Custom Report', requiredRole: 'manager', requiredPermission: 'reports:view' });
  registerNavItem({
    route: 'custom-report',
    label: 'Custom Report',
    requiredRole: 'manager',
    requiredPermission: 'reports:view',
    i18nKey: 'nav-custom-report',
    section: 'reports',
    icon: icon('M12 20h9', <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />),
  });
}
