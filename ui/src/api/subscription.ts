// ── Subscription capabilities (C2.2 in-app upgrade triggers) ─────────

import { loggedInvoke } from '@/utils/logged-invoke';

/**
 * Lifecycle state of the tenant subscription (todo-global-saas-1.md §B —
 * the one normalized contract across license server, Rust, and UI).
 * `loading` is the UI's own fetch phase; the backend never reports it.
 * `unavailable` means missing/tampered/unreadable data — entitlements are
 * Free-tier and every tier gate locks.
 */
export type SubscriptionLifecycleState =
  | 'active'
  | 'grace'
  | 'expired'
  | 'canceled'
  | 'paused'
  | 'unavailable';

/**
 * The tenant's tier quotas, feature flags, and current usage (C2.2).
 * Mirrors the Rust `SubscriptionCapabilitiesDto` in both clients —
 * a single local read that drives every in-app tier gate.
 */
export interface SubscriptionCapabilities {
  /** Tier key: `free` | `plus` | `pro` | `premium` | `enterprise`. */
  tier: string;
  /** Lifecycle state — anything other than `active`/`grace` means the
   *  capability flags below are the Free-tier (fail-closed) values. */
  state: SubscriptionLifecycleState;
  // ── Quota limits (`null` = unlimited) ─────────────────────
  /** Location quota — wire field keeps the historical `maxStores` name (1g wire rename pending). */
  maxStores: number | null;
  maxPosInstances: number | null;
  maxWarehouses: number | null;
  maxStaffUsers: number | null;
  /** Free = 3 months; Plus = 1 year; Pro = 5 years; Premium/Enterprise = unlimited (`null`). */
  salesHistoryDays: number | null;
  // ── Feature flags ─────────────────────────────────────────
  supportsQris: boolean;
  supportsAnalytics: boolean;
  supportsLoyalty: boolean;
  supportsDailyDashboard: boolean;
  supportsCloudSync: boolean;
  offlineGraceDays: number;
  // ── Current usage (for approaching-limit banners) ──────────
  locationCount: number;
  staffCount: number;
  terminalCount: number;
  // ── C4.3: Add-on identifiers ───────────────────────────────
  addons: string[];
}

/** Read the tenant's subscription capabilities (local, no network). */
export const getSubscriptionCapabilities = (): Promise<SubscriptionCapabilities> =>
  loggedInvoke<SubscriptionCapabilities>('get_subscription_capabilities');
