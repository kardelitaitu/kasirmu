import { lazy } from 'react';
import { registerPage } from '@/platform/ui/page-registry';
import { registerNavItem } from '@/platform/ui/menu-registry';
import { icon } from '@/platform/ui/icon';
const KdsScreen = lazy(() => import('./KdsScreen'));
const ExpoScreen = lazy(() => import('./ExpoScreen'));

export function registerKdsFeature() {
  registerPage({ route: 'kds', component: KdsScreen, label: 'KDS', feature: 'kitchen-display' });
  registerNavItem({
    route: 'kds',
    label: 'KDS',
    feature: 'kitchen-display',
    i18nKey: 'nav-kds',
    section: 'operations',
    icon: icon('M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6'),
  });
  // Expediter (Expo) pass view — aggregated bird's-eye over all stations
  // (todo-kds-agents-3). Same feature gate as the kitchen board.
  registerPage({ route: 'kds-expo', component: ExpoScreen, label: 'Expo', feature: 'kitchen-display' });
  registerNavItem({
    route: 'kds-expo',
    label: 'Expo',
    feature: 'kitchen-display',
    i18nKey: 'nav-kds-expo',
    section: 'operations',
    icon: icon('M9 12l2 2 4-4M7.835 17a9 9 0 1 0 8.33 0'),
  });
}
