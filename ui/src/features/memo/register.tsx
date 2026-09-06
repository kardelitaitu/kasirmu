import { lazy } from 'react';
import { registerPage } from '@/platform/ui/page-registry';
import { registerNavItem } from '@/platform/ui/menu-registry';
import { icon } from '@/platform/ui/icon';
const MemosScreen = lazy(() => import('./MemosScreen'));

export function registerMemoFeature() {
  registerPage({
    route: 'memos',
    component: MemosScreen,
    label: 'Memos',
    requiredRole: 'manager',
    requiredPermission: 'memo:write',
  });
  registerNavItem({
    route: 'memos',
    label: 'Memos',
    requiredRole: 'manager',
    requiredPermission: 'memo:write',
    i18nKey: 'nav-memos',
    section: 'tools',
    icon: icon(
      'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
      <line x1="9" y1="9" x2="15" y2="9" />,
      <line x1="9" y1="13" x2="13" y2="13" />,
    ),
  });
}
