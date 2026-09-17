import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const TaxConfigurationScreen = lazy(() => import('./TaxConfigurationScreen'));

export function registerTaxFeature() {
  registerPage({ route: 'tax-config', component: TaxConfigurationScreen, label: 'Tax Rates', feature: 'tax-engine', requiredRole: 'manager' });
  registerNavItem({
    route: 'tax-config',
    label: 'Tax Rates',
    feature: 'tax-engine',
    requiredRole: 'manager',
    i18nKey: 'nav-tax-rates',
    section: 'finance',
    icon: icon('M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', <line x1="12" y1="1" x2="12" y2="23" />),
  });
}
