// ── Home-screen Tools catalogue (todo-tools.md) ────────────────────
//
// Declarative access policy per the agreed role/tier matrix: each tool
// declares `access.minimumRole` (hierarchical — owner inherits admin
// inherits manager) and `access.minimumTier`. `minimumTier: 'free'`
// means role-only, which still requires a valid, non-expired
// subscription — it never bypasses entitlement validity.
//
// Groups follow the agreed information architecture: Operations,
// Insights, Configuration. Rendering rules (WorkspaceHome):
//   • role below minimum → hidden, EXCEPT `lockBelowRole` tools which
//     render a locked card (Settings is the hub — managers must see
//     that it exists);
//   • tier-ineligible or subscription-invalid → locked card: visible,
//     greyed out, non-clickable, localized badge.
//
// `settings/topology` and `settings/sync` are deep links into kept
// sections of the Settings hub, not standalone page routes.

import type { ReactNode } from 'react';
import type { TierKey } from '@/utils/tierLevel';

export type { TierKey };

export type ToolRole = 'owner' | 'admin' | 'manager';

export interface ToolAccess {
  /** Minimum role required; higher roles inherit access. */
  minimumRole: ToolRole;
  /** Minimum plan tier; `'free'` = role-only (valid subscription still required). */
  minimumTier: TierKey;
  /** Render a locked card to roles below `minimumRole` instead of hiding. */
  lockBelowRole?: boolean;
}

export type ToolGroupId = 'operations' | 'insights' | 'configuration';

export interface ToolItem {
  id: string;
  route: string;
  labelKey: string;
  descKey: string;
  access: ToolAccess;
  group: ToolGroupId;
  icon: ReactNode;
}

export const TOOL_GROUP_ORDER: ToolGroupId[] = [
  'operations',
  'insights',
  'configuration',
];

const svg = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  width: 20,
  height: 20,
  'aria-hidden': true,
} as const;

export const TOOLS: ToolItem[] = [
  // ── Operations ────────────────────────────────────────────────
  {
    id: 'topology-editor',
    route: 'settings/topology',
    labelKey: 'workspace-home-topology-title',
    descKey: 'workspace-home-topology-desc',
    access: { minimumRole: 'admin', minimumTier: 'free' },
    group: 'operations',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
    ),
  },
  {
    id: 'staff',
    route: 'staff',
    labelKey: 'workspace-home-staff-title',
    descKey: 'workspace-home-staff-desc',
    access: { minimumRole: 'manager', minimumTier: 'free' },
    group: 'operations',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'locations',
    route: 'locations',
    labelKey: 'workspace-home-locations-title',
    descKey: 'workspace-home-locations-desc',
    access: { minimumRole: 'manager', minimumTier: 'free' },
    group: 'operations',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: 'terminals',
    route: 'terminals',
    labelKey: 'workspace-home-terminals-title',
    descKey: 'workspace-home-terminals-desc',
    access: { minimumRole: 'manager', minimumTier: 'free' },
    group: 'operations',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <path d="M7 7l3 3-3 3" />
      </svg>
    ),
  },
  // Shifts tier policy is deliberately TBD (todo-tools.md matrix);
  // retained role-only in Operations until it is confirmed.
  {
    id: 'shifts',
    route: 'shifts',
    labelKey: 'workspace-home-shifts-title',
    descKey: 'workspace-home-shifts-desc',
    access: { minimumRole: 'manager', minimumTier: 'free' },
    group: 'operations',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    id: 'memo',
    route: 'memos',
    labelKey: 'workspace-home-memo-title',
    descKey: 'workspace-home-memo-desc',
    access: { minimumRole: 'manager', minimumTier: 'pro' },
    group: 'operations',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'promotions',
    route: 'promotions',
    labelKey: 'workspace-home-promotions-title',
    descKey: 'workspace-home-promotions-desc',
    access: { minimumRole: 'manager', minimumTier: 'premium' },
    group: 'operations',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
        <circle cx="7.5" cy="7.5" r="0.5" />
      </svg>
    ),
  },

  // ── Insights ──────────────────────────────────────────────────
  {
    id: 'analytics',
    route: 'analytics',
    labelKey: 'workspace-home-analytics-title',
    descKey: 'workspace-home-analytics-desc',
    access: { minimumRole: 'admin', minimumTier: 'pro' },
    group: 'insights',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <path d="M18 20V10" />
        <path d="M12 20V4" />
        <path d="M6 20v-6" />
      </svg>
    ),
  },
  {
    id: 'reports',
    route: 'dashboard',
    labelKey: 'workspace-home-reports-title',
    descKey: 'workspace-home-reports-desc',
    access: { minimumRole: 'manager', minimumTier: 'pro' },
    group: 'insights',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
        <path d="M22 12A10 10 0 0 0 12 2v10z" />
      </svg>
    ),
  },
  {
    id: 'audit',
    route: 'audit-log',
    labelKey: 'workspace-home-audit-title',
    descKey: 'workspace-home-audit-desc',
    access: { minimumRole: 'manager', minimumTier: 'premium' },
    group: 'insights',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },

  // ── Configuration ─────────────────────────────────────────────
  {
    id: 'settings',
    route: 'settings',
    labelKey: 'workspace-home-settings-title',
    descKey: 'workspace-home-settings-desc',
    access: { minimumRole: 'admin', minimumTier: 'free', lockBelowRole: true },
    group: 'configuration',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: 'cloud-sync',
    route: 'settings/sync',
    labelKey: 'workspace-home-cloud-sync-title',
    descKey: 'workspace-home-cloud-sync-desc',
    access: { minimumRole: 'admin', minimumTier: 'plus' },
    group: 'configuration',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    id: 'tax-config',
    route: 'tax-config',
    labelKey: 'workspace-home-tax-config-title',
    descKey: 'workspace-home-tax-config-desc',
    access: { minimumRole: 'manager', minimumTier: 'free' },
    group: 'configuration',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <line x1="19" y1="5" x2="5" y2="19" />
        <circle cx="6.5" cy="6.5" r="2.5" />
        <circle cx="17.5" cy="17.5" r="2.5" />
      </svg>
    ),
  },
  {
    id: 'exchange-rates',
    route: 'exchange-rates',
    labelKey: 'workspace-home-exchange-rates-title',
    descKey: 'workspace-home-exchange-rates-desc',
    access: { minimumRole: 'manager', minimumTier: 'free' },
    group: 'configuration',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <path d="M17 1l4 4-4 4" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <path d="M7 23l-4-4 4-4" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
  },
  // Basic Offline Queue visibility is available to all active tiers
  // (todo-tools.md §IA ownership boundaries); advanced conflict tools
  // are Plus+ and are gated inside the page itself.
  {
    id: 'offline-queue',
    route: 'offline-queue',
    labelKey: 'workspace-home-offline-queue-title',
    descKey: 'workspace-home-offline-queue-desc',
    access: { minimumRole: 'manager', minimumTier: 'free' },
    group: 'configuration',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M8 12l3 3 5-6" />
      </svg>
    ),
  },
  {
    id: 'features',
    route: 'features',
    labelKey: 'workspace-home-features-title',
    descKey: 'workspace-home-features-desc',
    access: { minimumRole: 'owner', minimumTier: 'free' },
    group: 'configuration',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
      </svg>
    ),
  },
  {
    id: 'data-management',
    route: 'data-management',
    labelKey: 'workspace-home-data-management-title',
    descKey: 'workspace-home-data-management-desc',
    access: { minimumRole: 'owner', minimumTier: 'plus' },
    group: 'configuration',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
];
