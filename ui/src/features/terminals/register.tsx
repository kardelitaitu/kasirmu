import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const TerminalManagementScreen = lazy(() => import('./TerminalManagementScreen'));

export function registerTerminalsFeature() {
  registerPage({ route: 'terminals', component: TerminalManagementScreen, label: 'Terminals', requiredRole: 'manager' });
  registerNavItem({
    route: 'terminals',
    label: 'Terminals',
    requiredRole: 'manager',
    i18nKey: 'nav-terminals',
    section: 'tools',
    icon: icon('M2 3h20v14H2z', <line x1="8" y1="21" x2="16" y2="21" />, <line x1="12" y1="17" x2="12" y2="21" />, <path d="M7 7l3 3-3 3" />),
  });
}
