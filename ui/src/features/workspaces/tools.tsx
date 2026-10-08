// ── Home-screen Tools catalogue (.agents/archived/done-todo/done-todo-tools.md) ────────────────────
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
//
// `minimumRole` is the HOME front door, not the security gate. The route's own
// gate is authoritative: `registerPage` declares `requiredRole` +
// `requiredPermission`, and `passesGate` (registries/page-registry) consults the
// permission whenever the session carries granted keys. Home-stricter is the
// documented policy (.agents/archived/done-todo/done-todo-tools.md:733), so a
// card hidden here does NOT mean the
// route would refuse it — the two surfaces are meant to differ. Measured
// 2026-09-16, six of these 17 tools do differ: `staff` `shifts` `analytics`
// `reports` `audit` `settings`, and in five of the six the role that would gain
// the card is `auditor`, which holds the read keys but ranks below the home
// floor. RULED 2026-09-20 (`done-todo-owner-rulings.md` R20): the rank stays
// authoritative for the home grid, and 3a.2 is narrowed to the gates that
// have no route twin. The permission-vocabulary alternative was refused — it
// would have handed five admin-surface cards to a read-only role under a
// commit that reads as a refactor. The finding this paragraph was filed
// under is docs/records/audit-open-findings.md (2026-09-16).

import type { ReactNode } from 'react';
import { roleAtLeast } from '@/utils/role';
import type { SubscriptionUiState } from '@/contexts/SubscriptionContext';
import { tierSatisfies, type TierKey } from '@/utils/tierLevel';

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
  // Shifts tier policy is deliberately TBD (.agents/archived/done-todo/done-todo-tools.md matrix);
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
    access: { minimumRole: 'manager', minimumTier: 'free' },
    group: 'configuration',
    icon: (
      <svg {...svg} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: 'topology',
    route: 'topology',
    labelKey: 'workspace-home-topology-title',
    descKey: 'workspace-home-topology-desc',
    access: { minimumRole: 'manager', minimumTier: 'free' },
    group: 'configuration',
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
];

// ── The lock decision, extracted for testability (2026-10-08) ──────
//
// `toolLock` used to live inline in WorkspaceHome, untestable without
// mounting the whole shell. The decision is policy, so it belongs beside the
// catalogue it polices, where it can be pinned data-level like the matrix
// above.

export type ToolLockReason = 'tier' | 'subscription' | 'role';

export interface ToolGateContext {
  roleName: string;
  subscriptionState: SubscriptionUiState;
  capsTier: string | null | undefined;
  adminLocked: boolean;
}

export function resolveToolLock(
  tool: ToolItem,
  ctx: ToolGateContext,
): ToolLockReason | 'none' | 'hidden' {
  // Routed through `roleAtLeast` rather than an inline level comparison, so
  // this gate and every other role gate read ONE vocabulary with the same
  // default: an unrecognised role floor must DENY, not allow (ruled
  // fail-closed 2026-09-16; owner ruling R20 keeps the rank authoritative
  // for the home grid — see the catalogue header above).
  if (!roleAtLeast(ctx.roleName, tool.access.minimumRole)) {
    return tool.access.lockBelowRole ? 'role' : 'hidden';
  }
  // Role-only tools keep working through the signed grace window
  // (operational continuity); everything hard-locks once the subscription
  // is expired/canceled/paused or its data unreadable.
  const validityOpen =
    ctx.subscriptionState === 'active' ||
    ctx.subscriptionState === 'grace' ||
    ctx.subscriptionState === 'loading';
  if (!validityOpen) return 'subscription';
  // `loading` stays open through the ENTIRE gate, not just the validity
  // half. `caps` is still null during the first fetch, so the tier check
  // below would fail closed (`tierSatisfies(null, …)`) and useAdminGate
  // locks on anything but `active` — together they flash-locked every paid
  // tool on every cold start, the exact thing WorkspaceHome's comment
  // forbids. The route's own gate re-checks fail-closed, so a click landing
  // mid-fetch is still caught there; this only stops the COSMETIC flash.
  if (ctx.subscriptionState === 'loading') return 'none';
  if (tool.access.minimumTier !== 'free' && ctx.adminLocked) return 'subscription';
  if (!tierSatisfies(ctx.capsTier, tool.access.minimumTier)) return 'tier';
  return 'none';
}
