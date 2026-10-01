/**
 * Dev-mock tier model — the ONE place a preview's subscription tier lives.
 *
 * Before this module the preview served seven hardcoded tier literals across
 * three files and they already contradicted each other: `settings.ts` reported
 * `pro` while `system.ts` reported `premium` in four places and
 * `analytics.ts` a fifth. The caps block hand-wrote all fifteen quota fields as
 * "unlimited/true", which is Premium's answer and therefore wrong for every
 * other tier — so no gate below Premium was reachable in a browser at all.
 * `analytics.ts` even carried a comment instructing a developer to hand-edit
 * the file to see the Pro case. This module replaces that.
 *
 * ── The parity rule ────────────────────────────────────────────────────
 * The values below are TRANSCRIBED from Rust, which is the source of truth:
 *   crates/kasirmu-core/src/subscription.rs  (SubscriptionTier max_ / supports_ accessors)
 *   crates/kasirmu-core/src/downgrade.rs     (QuotaDimension::limit_for)
 * The mock has no Rust to call, so they must be copied — and a copy drifts.
 * `ui/src/__tests__/mockTierParity.test.ts` re-reads the Rust source and fails
 * the build when a transcribed row stops matching. Change the Rust, and that
 * test tells you which row of this table to change with it.
 *
 * ── Why a table and not a formula ──────────────────────────────────────
 * The Rust accessors are five hand-written `match` arms each, not a gradient:
 * `supports_regional_zones` is Enterprise-only, `supports_loyalty` is
 * Premium+, `supports_stripe` is Pro+, and `max_kds_screens` is 0 (not
 * unlimited) for Free/Plus. Deriving any of those from a "level" number would
 * invent a rule the backend does not have, which is the exact class of bug
 * this module exists to remove. The table IS the rules.
 *
 * The deprecated `OneTime` Rust variant is omitted: `tier_key()` reports it as
 * `free`, so it has no distinct preview state.
 */

/** The five subscription tiers, in ascending order. Mirrors `TierKey`. */
export const MOCK_TIER_KEYS = ['free', 'plus', 'pro', 'premium', 'enterprise'] as const;

/** One subscription tier key. */
export type MockTierKey = (typeof MOCK_TIER_KEYS)[number];

/** Human-readable tier names, matching `SubscriptionTier::name()`. */
export const MOCK_TIER_NAMES: Record<MockTierKey, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  premium: 'Premium',
  enterprise: 'Enterprise',
};

/**
 * The tier's caps, field-for-field with `SubscriptionCapabilities`'s quota and
 * feature block (`api/subscription.ts`). `null` means unlimited, exactly as
 * the wire type documents — never "absent".
 */
export interface MockTierCaps {
  /** `max_locations`: Free/Plus 1, Pro 2, Premium 5, Enterprise unlimited. */
  maxLocations: number | null;
  /** `max_pos_instances`: Free 1, Plus 2, Pro 5, Premium+ unlimited. */
  maxPosInstances: number | null;
  /** `max_warehouses`: ZERO below Premium (the warehouse workspace is a
   *  Premium+ feature by the owner's ruling of 2026-09-29 — the same zeros the
   *  website's pricing row publishes), Premium+ unlimited. */
  maxWarehouses: number | null;
  /** `max_kds_screens` — PER LOCATION, not a tenant budget. Free/Plus 0 (KDS
   *  is not merely capped, it is unavailable), Pro 2, Premium+ unlimited. */
  maxKdsScreens: number | null;
  /** `max_staff_users` (owner excluded): 1 / 5 / 20 / 50 / unlimited. */
  maxStaffUsers: number | null;
  /** `sales_history_days`: Free 90, Plus 365, Pro 1825, Premium+ unlimited. */
  salesHistoryDays: number | null;
  /** `supports_qris`: Plus and above. */
  supportsQris: boolean;
  /** `supports_analytics`: Pro and above. */
  supportsAnalytics: boolean;
  /** `supports_loyalty`: Premium and above (Pro sees a locked teaser). */
  supportsLoyalty: boolean;
  /** `supports_daily_dashboard`: Plus and above (Free shows a blurred teaser). */
  supportsDailyDashboard: boolean;
  /** `supports_cloud_sync`: Plus and above. */
  supportsCloudSync: boolean;
  /** `offline_grace_days`: 7 / 14 / 14 / 30 / 60. */
  offlineGraceDays: number;
  /** `supports_stripe`: Pro and above. Rides the caps DTO's feature map
   *  rather than its own boolean; kept here so the tier table is complete. */
  supportsStripe: boolean;
  /** `supports_lua_engine`: Premium and above. */
  supportsLuaEngine: boolean;
  /** `supports_regional_zones`: Enterprise only. */
  supportsRegionalZones: boolean;
  /** `audit_retention_days`. NOTE the deliberate inversion documented on the
   *  Rust accessor: here `null` means NO retention entitlement (Free retains
   *  nothing), not "unlimited" — no tier carries an unlimited audit window. */
  auditRetentionDays: number | null;
}

/**
 * The transcribed Rust truth table. Every row cites the accessor it copies.
 *
 * Reading order matches `subscription.rs` so a reviewer can diff the two files
 * side by side: max_locations, max_pos_instances, max_warehouses,
 * max_kds_screens, max_staff_users, max_products (not on the caps DTO),
 * sales_history_days, then the supports_* predicates.
 */
export const MOCK_TIER_CAPS: Record<MockTierKey, MockTierCaps> = {
  free: {
    maxLocations: 1,
    maxPosInstances: 1,
    maxWarehouses: 0,
    maxKdsScreens: 0,
    maxStaffUsers: 1,
    salesHistoryDays: 90,
    supportsQris: false,
    supportsAnalytics: false,
    supportsLoyalty: false,
    supportsDailyDashboard: false,
    supportsCloudSync: false,
    offlineGraceDays: 7,
    supportsStripe: false,
    supportsLuaEngine: false,
    supportsRegionalZones: false,
    auditRetentionDays: null,
  },
  plus: {
    maxLocations: 1,
    maxPosInstances: 2,
    maxWarehouses: 0,
    maxKdsScreens: 0,
    maxStaffUsers: 5,
    salesHistoryDays: 365,
    supportsQris: true,
    supportsAnalytics: false,
    supportsLoyalty: false,
    supportsDailyDashboard: true,
    supportsCloudSync: true,
    offlineGraceDays: 14,
    supportsStripe: false,
    supportsLuaEngine: false,
    supportsRegionalZones: false,
    auditRetentionDays: 90,
  },
  pro: {
    maxLocations: 2,
    maxPosInstances: 5,
    maxWarehouses: 0,
    maxKdsScreens: 2,
    maxStaffUsers: 20,
    salesHistoryDays: 1825,
    supportsQris: true,
    supportsAnalytics: true,
    supportsLoyalty: false,
    supportsDailyDashboard: true,
    supportsCloudSync: true,
    offlineGraceDays: 14,
    supportsStripe: true,
    supportsLuaEngine: false,
    supportsRegionalZones: false,
    auditRetentionDays: 180,
  },
  premium: {
    maxLocations: 5,
    maxPosInstances: null,
    maxWarehouses: null,
    maxKdsScreens: null,
    maxStaffUsers: 50,
    salesHistoryDays: null,
    supportsQris: true,
    supportsAnalytics: true,
    supportsLoyalty: true,
    supportsDailyDashboard: true,
    supportsCloudSync: true,
    offlineGraceDays: 30,
    supportsStripe: true,
    supportsLuaEngine: true,
    supportsRegionalZones: false,
    auditRetentionDays: 365,
  },
  enterprise: {
    maxLocations: null,
    maxPosInstances: null,
    maxWarehouses: null,
    maxKdsScreens: null,
    maxStaffUsers: null,
    salesHistoryDays: null,
    supportsQris: true,
    supportsAnalytics: true,
    supportsLoyalty: true,
    supportsDailyDashboard: true,
    supportsCloudSync: true,
    offlineGraceDays: 60,
    supportsStripe: true,
    supportsLuaEngine: true,
    supportsRegionalZones: true,
    auditRetentionDays: 1095,
  },
};

/**
 * `max_products`, which the caps DTO does not carry but the over-quota report
 * does (`analytics.ts` lists a `products` usage row). Separate from
 * {@link MockTierCaps} so its absence from the DTO stays visible.
 */
export const MOCK_TIER_MAX_PRODUCTS: Record<MockTierKey, number | null> = {
  free: 200,
  plus: 500,
  pro: 1000,
  premium: 10000,
  enterprise: null,
};

/** True when `key` is a tier this module knows. */
export function isMockTierKey(key: string | null | undefined): key is MockTierKey {
  return key != null && (MOCK_TIER_KEYS as readonly string[]).includes(key);
}

/**
 * The tier a preview starts on when nothing overrides it.
 *
 * `premium` because that is what the preview hardcoded before this module
 * existed — the default is deliberately the OLD behaviour, so introducing the
 * switcher changes no existing screenshot or test until someone picks a tier.
 */
export const DEFAULT_MOCK_TIER: MockTierKey = 'premium';

const STORAGE_KEY = 'kasirmu-dev-tier';

/**
 * In-memory tier, module-scoped so the DevToolbar (a React component) and the
 * mock handlers (plain objects) share one value without a provider. The same
 * shape as `MOCK_TRASH_STAFF` in `handlers/staff.ts`.
 */
let currentTier: MockTierKey | null = null;

/** Read the persisted tier, tolerating a disabled or unavailable localStorage. */
function readStoredTier(): MockTierKey | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isMockTierKey(raw) ? raw : null;
  } catch {
    // Private-mode Safari and jsdom both throw here. A missing store is not a
    // reason to lose the default.
    return null;
  }
}

/** Persist the tier, tolerating a disabled or unavailable localStorage. */
function writeStoredTier(tier: MockTierKey): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, tier);
  } catch {
    // See readStoredTier: persistence is a convenience, never a requirement.
  }
}

/**
 * The `?tier=` override, read at CALL time.
 *
 * Kept alongside the toolbar toggle because the four pre-existing scenario
 * seams (`?license=`, `?revoked=`, `?nousers=`, `?unprovisioned=`) are all query
 * params, and E2E specs need a tier a toolbar click cannot reach. Guarded
 * because the handlers also run under jsdom, where `search` may be empty.
 *
 * A query param is read fresh every call but is NOT written back to storage:
 * choosing a tier in the toolbar must not be silently overridden by a stale
 * `?tier=` left in a bookmark. The param wins for as long as it is present,
 * which is what a deep link means.
 */
function readTierParam(): MockTierKey | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('tier');
    return isMockTierKey(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The tier this preview is currently serving, resolved in precedence order:
 * `?tier=` → the toolbar's persisted choice → {@link DEFAULT_MOCK_TIER}.
 */
export function getMockTier(): MockTierKey {
  const fromParam = readTierParam();
  if (fromParam) return fromParam;
  if (currentTier) return currentTier;
  currentTier = readStoredTier() ?? DEFAULT_MOCK_TIER;
  return currentTier;
}

/**
 * Switch the tier and persist it.
 *
 * Writes through to storage so the choice survives a reload — the same
 * expectation the theme toggle sets, and the reason a developer does not have
 * to re-pick the tier after every hot reload while testing a gate.
 */
export function setMockTier(tier: MockTierKey): void {
  currentTier = tier;
  writeStoredTier(tier);
}

/** Reset to {@link DEFAULT_MOCK_TIER}, clearing the persisted choice. */
export function resetMockTier(): void {
  currentTier = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See writeStoredTier.
  }
}

/** The caps for the tier currently being served. */
export function getMockTierCaps(): MockTierCaps {
  return MOCK_TIER_CAPS[getMockTier()];
}
