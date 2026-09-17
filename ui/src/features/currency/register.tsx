import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const ExchangeRateScreen = lazy(() => import('./ExchangeRateScreen'));

export function registerCurrencyFeature() {
  registerPage({ route: 'exchange-rates', component: ExchangeRateScreen, label: 'Exchange Rates', requiredRole: 'manager' });
  registerNavItem({
    route: 'exchange-rates',
    label: 'Exchange Rates',
    requiredRole: 'manager',
    i18nKey: 'nav-exchange-rates',
    section: 'finance',
    icon: icon('M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', <line x1="12" y1="1" x2="12" y2="23" />),
  });
}
