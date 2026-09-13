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
  /** Raw subscription status (`active`, `canceled`, `paused`, etc.) from
   *  the local signed row, or `unavailable` when fail-closed. */
  status: string;
  /** Lifecycle state — anything other than `active`/`grace` means the
   *  capability flags below are the Free-tier (fail-closed) values. */
  state: SubscriptionLifecycleState;
  /** Whether the signed payload marks this period as a trial. Orthogonal
   *  to `tier` on purpose: a trial resolves to Free (the quota answer)
   *  and this flag is the fact that collapse loses. `false` when
   *  fail-closed - unreadable data is never reported as a trial.
   *  HARD-REQUIRED (W7-C residual): the Rust DTO emits `is_trial: bool`
   *  unconditionally, so every backend payload carries the key - the
   *  interface no longer tolerates its absence. */
  isTrial: boolean;
  /** When the trial ends (RFC3339, from the signed payload); `null`
   *  when this is not a trial or the date is absent/unparseable.
   *  Null-when-absent semantics: no default is invented client-side.
   *  HARD-REQUIRED (W7-C residual): the key is always emitted
   *  (`trial_ends_at: Option<String>` serializes `null`, never absent). */
  trialEndsAt: string | null;
  /** The signed payload's explicit per-feature instructions (Phase D1):
   *  the server's `features` map keyed by the canonical
   *  `AvailabilityFeature` wire names (e.g. `supports_analytics`).
   *  Empty when the payload has no opinion - no default grant is ever
   *  invented here. HARD-REQUIRED (W7-C residual): the map is always
   *  emitted; an empty map means the tier's own answer stands. */
  features: Record<string, boolean>;
  // ── Quota limits (`null` = unlimited) ─────────────────────
  /** Location quota — wire field keeps the historical `maxLocations` name (1g wire rename pending). */
  maxLocations: number | null;
  maxPosInstances: number | null;
  maxWarehouses: number | null;
  /** Per-location KDS screen cap; `null` = unlimited. NOT a tenant-wide budget —
   *  it governs each location separately, which is why the over-quota report
   *  shows it as per-location rows instead of a usage row (§J B3). */
  maxKdsScreens: number | null;
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
  /** When the subscription expires (RFC 3339, from the local signed row);
   *  `null` for the bootstrap Free row or when unreadable. */
  expiresAt: string | null;
  /** End of the offline grace window (RFC 3339). Only present when in
   *  `grace` state and `expiresAt` is parseable; `null` otherwise. */
  graceUntil: string | null;
  /** Whether the subscription is expired (past expiry AND past grace). */
  isExpired: boolean;
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

/** Severity of an over-quota marker (mirrors Rust `OverQuotaSeverity`,
 *  serde snake_case). `over` = current strictly exceeds the cap (must
 *  remediate); `at` = current equals the cap (no new resource may be
 *  created until something is freed). */
export type OverQuotaSeverity = 'over' | 'at';

/** One persisted over-quota marker (mirrors Rust `OverQuotaMarker`,
 *  serde snake_case).
 *
 *  Two shapes share this row type, told apart by `resourceType`:
 *  - a **tenant-global** marker, where `resourceType` equals `dimension` and
 *    `resourceId` is the tenant id (the five tracked dimensions); and
 *  - a **per-location** marker (section J B3), where `resourceType` is a
 *    resource kind (`kds_screen`, `warehouse`, `topology_node`) and
 *    `resourceId` is the **store id**, so the row carries the target its own
 *    remediation action needs.
 *
 *  Per-location rows are computed at read time by visiting each store
 *  database; only the tenant-global ones are persisted. Use
 *  `isPerLocationMarker` rather than comparing `resourceId` to a tenant id. */
export interface OverQuotaMarkerRow {
  /** Tenant-global resource id for tenant-global dimensions (the tenant id). */
  resourceId: string;
  /** Resource type discriminator (mirrors `resource_type`; equals the
   *  dimension key for the tenant-global dimensions). */
  resourceType: string;
  /** Machine dimension key (`locations`, `pos_registers`, ...). */
  dimension: string;
  /** `over` | `at` (see `OverQuotaSeverity`). */
  severity: OverQuotaSeverity;
  /** Tier cap that triggered the marker; `null` = unlimited (never flagged). */
  limit: number | null;
  /** Count at the moment the marker was refreshed. */
  current: number;
  /** RFC3339 timestamp the marker row was written. */
  markedAt: string;
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
  /** Persisted over-quota markers (Slice C §J). Optional for
   *  backward-compatibility with older desktop builds; the card degrades
   *  gracefully when absent. */
  markers?: OverQuotaMarkerRow[];
}

/** Resource kinds that are capped per location rather than per tenant (section J
 *  B3). Anything else in `markers` is a tenant-global dimension marker. */
const PER_LOCATION_RESOURCE_TYPES: readonly string[] = [
  'kds_screen',
  'warehouse',
  // The per-store aggregate row (marker S3): non-archived instances against
  // the SUM of the per-location caps, over when ≥1 instance was
  // quota-suspended. Read-computed by the desktop fan-out, never persisted.
  'topology_node',
];

/** Whether a marker row describes one location rather than the whole tenant. */
export function isPerLocationMarker(row: OverQuotaMarkerRow): boolean {
  return PER_LOCATION_RESOURCE_TYPES.includes(row.resourceType);
}

/** The per-location marker rows of a report, in the order the fan-out produced
 *  them (by store, then dimension). Empty when no location is over or at a cap —
 *  which is a real answer, not a failure to measure: the fan-out visits every
 *  store database that exists and skips only those that do not. */
export function perLocationMarkers(report: OverQuotaReport | null): OverQuotaMarkerRow[] {
  if (!report?.markers) return [];
  return report.markers.filter(isPerLocationMarker);
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
 *
 * W6-C: calls the SCOPED variant — the same session token resolves the
 * tenant's store server-side and the backend re-checks SETTINGS_READ
 * fail-closed (ADR #7), instead of trusting the client to hit the right
 * tenant on the unscoped path. DTO is byte-identical (the scoped command
 * returns the same OverQuotaReport serde as b81ac5356-era).
 */
export const getOverQuotaReport = (sessionToken: string): Promise<OverQuotaReport> =>
  loggedInvoke<OverQuotaReport>('get_over_quota_report_scoped', { sessionToken });
