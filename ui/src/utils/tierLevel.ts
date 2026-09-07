// ── Canonical subscription-tier ordering (todo-tools.md #4) ────────
//
// One centrally owned ordering + comparison for every UI tier gate,
// so two gates can never disagree about e.g. pro-vs-premium. Keys
// mirror the server's plan keys (`free`, `plus`, `pro`, `premium`,
// `enterprise` — see `SubscriptionCapabilities.tier`).

export type TierKey = 'free' | 'plus' | 'pro' | 'premium' | 'enterprise';

/** Canonical ordering — a higher level includes every lower tier. */
export const TIER_LEVEL: Record<TierKey, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  premium: 3,
  enterprise: 4,
};

/**
 * True when `current` meets or exceeds the `minimum` tier.
 *
 * A `free` minimum trivially passes (role-only tools still enforce
 * subscription validity separately). An unknown or absent current
 * tier fails every non-free minimum — fail-closed, matching the §B
 * entitlement contract (a missing subscription never grants tiered
 * access).
 */
export function tierSatisfies(
  current: string | null | undefined,
  minimum: TierKey,
): boolean {
  if (minimum === 'free') return true;
  if (!current) return false;
  const level = TIER_LEVEL[current as TierKey];
  return level !== undefined && level >= TIER_LEVEL[minimum];
}
