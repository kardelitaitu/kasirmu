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
  /** Location quota — wire field keeps the historical `maxLocations` name (1g wire rename pending). */
  maxLocations: number | null;
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

/** A feature the availability resolver can explain (the wire keys, snake_case). */
export type AvailabilityFeatureKey =
  | 'supports_qris'
  | 'supports_analytics'
  | 'supports_loyalty'
  | 'supports_daily_dashboard'
  | 'supports_cloud_sync'
  | 'sales_history_days'
  | 'locations'
  | 'staff_users'
  | 'pos_instances'
  | 'warehouses';

/**
 * Why a feature is unavailable. `null` exactly when the feature is available.
 * Mirrors the Rust `AvailabilityReason` wire codes.
 */
export type FeatureVerdictReason =
  | 'server_policy'
  | 'lifecycle'
  | 'tier'
  | 'quota'
  | 'role'
  | 'scope'
  | null;

/**
 * Renderable detail fields the UI surfaces directly, so it never re-derives a
 * message from the `reason` code. Every field is advisory — the verdict is
 * `available` plus `reason`, never a re-read of these.
 */
export interface VerdictDetail {
  /** Tier key: `free` | `plus` | `pro` | `premium` | `enterprise`. */
  tier: string;
  /** Lifecycle-state wire name. */
  state: string;
  /** Tier's limit for this feature; `null` = unlimited / not applicable. */
  limit: number | null;
  /** Current usage against `limit`. */
  usage: number | null;
  /** Permission key the gate consults, when one applies. */
  permission: string | null;
  /** Scope axis answer for the caller's own context (ADR #47 v1
   * ruling, current-location): true = the caller's assignment covers the
   * session location/context, false = it excludes them, null = no
   * assignment row (legacy users are not scope-restricted). */
  scopeGranted: boolean | null;
  /** Signed-row expiry, verbatim. */
  expiresAt: string | null;
  /** Grace-window end, verbatim. */
  graceUntil: string | null;
}

/**
 * The verdict for one feature — whether it is available and, if not, the
 * highest-precedence reason why. Mirrors the Rust `FeatureVerdict`
 * (`#[serde(rename_all = "camelCase")]`).
 */
export interface FeatureVerdict {
  /** Wire key this verdict is about. */
  feature: AvailabilityFeatureKey;
  /** Whether the feature is available on these facts. */
  available: boolean;
  /** Highest-precedence denial; `null` exactly when `available`. */
  reason: FeatureVerdictReason;
  /** Renderable fields the UI surfaces directly. */
  detail: VerdictDetail;
}

/**
 * Explain why a feature is (un)available for the session. Session-gated on
 * `permissions::SETTINGS_READ`; returns an error for an unknown feature key.
 */
export const explainFeatureAvailability = (
  sessionToken: string,
  feature: AvailabilityFeatureKey,
): Promise<FeatureVerdict> =>
  loggedInvoke<FeatureVerdict>('explain_feature_availability_scoped', {
    sessionToken,
    feature,
  });

// ── Over-quota report (§J downgrade remediation) ──────────────────────

/** One quota dimension's usage row (mirrors Rust `QuotaUsage`).
 *  `limit: null` = unlimited; over is strictly current > limit. */
export interface QuotaUsageRow {
  /** Machine dimension key (`locations`, `pos_registers`, ...). */
  dimension: string;
  /** Tier cap for this dimension; `null` = unlimited. */
  limit: number | null;
  /** Current count (the same `count_*` the creation gates consult). */
  current: number;
}

/** The tenant-level over-quota assessment (mirrors Rust
 *  `OverQuotaReport`, serde snake_case rows). */
export interface OverQuotaReport {
  /** Machine tier key the assessment ran against (the effective tier). */
  tierKey: string;
  /** Human-readable tier name. */
  tierName: string;
  /** Per-dimension usage rows, in the resolver's canonical order. */
  usages: QuotaUsageRow[];
}

/** Whether a usage row is strictly over its cap (needs remediation). */
export const isOverQuota = (row: QuotaUsageRow): boolean =>
  row.limit !== null && row.current > row.limit;

/** Resources to archive (or the upgrade delta) for one dimension. */
export const excessOf = (row: QuotaUsageRow): number =>
  row.limit !== null && row.current > row.limit ? row.current - row.limit : 0;

/**
 * The owner-facing over-quota assessment (§J remediation view): which
 * resources exceed the effective tier's quota and by how much.
 * Read-only; session-gated on `permissions::SETTINGS_READ`.
 */
export const getOverQuotaReport = (sessionToken: string): Promise<OverQuotaReport> =>
  loggedInvoke<OverQuotaReport>('get_over_quota_report', { sessionToken });
