import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';

const WarehouseConsole = lazy(() => import('./WarehouseConsole'));

export function registerWarehouseFeature() {
  registerPage({
    route: 'warehouse',
    component: WarehouseConsole,
    label: 'Warehouse',
    requiredRole: 'manager',
    requiredPermission: 'inventory:view',
  });
}
