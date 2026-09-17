import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';
import { registerNavItem } from '@/registries/menu-registry';
import { icon } from '@/registries/icon';
const AuditLogScreen = lazy(() => import('./AuditLogScreen'));
const SecurityTrailScreen = lazy(() => import('./SecurityTrailScreen'));

export function registerAuditFeature() {
  registerPage({ route: 'audit-log', component: AuditLogScreen, label: 'Audit Log', requiredRole: 'manager', requiredPermission: 'audit:view' });
  // A separate route, not a tab: this page reads the global identity database
  // while audit-log reads the session's store, so the two answer different
  // questions and a merged view would imply one scope where there are two. Same
  // permission and role as the sibling — the backend gates both on the audit
  // tier, so registering the trail with a looser gate would advertise access the
  // command then refuses.
  registerPage({ route: 'security-trail', component: SecurityTrailScreen, label: 'Security Trail', requiredRole: 'manager', requiredPermission: 'audit:view' });
  registerNavItem({
    route: 'audit-log',
    label: 'Audit Log',
    requiredRole: 'manager',
    requiredPermission: 'audit:view',
    i18nKey: 'nav-audit-log',
    section: 'tools',
    icon: icon('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', <polyline points="14 2 14 8 20 8" />, <line x1="16" y1="13" x2="8" y2="13" />, <line x1="16" y1="17" x2="8" y2="17" />),
  });
  registerNavItem({
    route: 'security-trail',
    label: 'Security Trail',
    requiredRole: 'manager',
    requiredPermission: 'audit:view',
    i18nKey: 'nav-security-trail',
    section: 'tools',
    icon: icon('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'),
  });
}
