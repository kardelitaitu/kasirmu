/**
 * Pricing content is keyed on the REAL tier enum used by the schema and the
 * client (`free` / `plus` / `pro` / `premium` / `enterprise` — see
 * apps/license-server/pb_schema.json and crates/kasirmu-core/src/subscription.rs).
 * `plus` is the new entry paid tier (subscription-tiers.md §1/§2); the
 * license-server schema is the remaining gap there (pb_schema.json still
 * lists only free/pro/premium/enterprise).
 *
 * USD and IDR are independent market prices (subscription-tiers.md §2):
 * global customers pay the USD rate, Indonesian customers the lower IDR
 * rate. Paddle does not support IDR as a billing currency, so today both
 * locales charge the SAME USD price ids — `en` shows USD, `id` shows an Rp
 * display figure (the checkout bills in USD until the Midtrans phase lands).
 * On the server the price ids map to the tier_key via PADDLE_PRICE_TIERS
 * (see apps/license-server/paddle_webhook.go). `currency` documents the
 * display currency and can drive the future local-provider billing path.
 *
 * Yearly = 2 months free (10 months paid, 12 granted) and is the DEFAULT
 * billing period on the pricing page — always marketed as "2 months free" /
 * "2 bulan gratis", never as a percentage discount. Each paid tier carries a
 * Paddle price id per period; until the six real prices (Plus/Pro/Premium ×
 * monthly/yearly) are catalogued the ids are `pri_placeholder_…`, which
 * degrade to the mailto fallback (CheckoutButton.isPlaceholderPriceId).
 */
export type TierKey = 'free' | 'plus' | 'pro' | 'premium' | 'enterprise';

export type Currency = 'USD' | 'IDR';

export type BillingPeriod = 'monthly' | 'yearly';

export interface TierPrice {
  /** Display price for this period, e.g. '$9.99' or 'Rp 99.000'. */
  price: string;
  /** Display period suffix, e.g. '/month' / '/tahun' — empty for one-off/custom. */
  period: string;
  /**
   * Paddle v2 price id for this locale's currency (real `pri_…` when the
   * product is live; `pri_placeholder_…` otherwise — see
   * CheckoutButton.isPlaceholderPriceId). Absent = no checkout (free/custom).
   */
  priceId?: string;
  /**
   * C4.1 A/B test variant price id. When present and the `?ab=pro_price`
   * query param matches, this price id overrides the default `priceId`.
   * The variant price is for the same product at a different price point
   * (e.g. $7.99 vs $9.99 for Pro monthly).
   */
  variantPriceId?: string;
  /**
   * C4.1: Display price for the A/B variant. Shown when variant is active.
   */
  variantPrice?: string;
}

export interface PricingTier {
  id: string;
  tierKey: TierKey;
  name: string;
  /** Currency this locale displays (en → USD, id → IDR). */
  currency: Currency;
  description: string;
  cta: string;
  /** Featured card (Pro — "Most Popular"): accent styling + badge. */
  highlight?: boolean;
  /** Per-period price + checkout id. Yearly is the default selection. */
  prices: Record<BillingPeriod, TierPrice>;
  /**
   * Optional vertical-bundle option on this card (C3.2, subscription-tiers.md
   * §5 — Restaurant Starter). When present the card renders a toggle that
   * swaps the price + checkout to the bundle, which bills the tier PLUS the
   * bundle (the checkout carries `bundle: 'restaurant_starter'`, and the
   * price maps key the bundle amount). Placeholder price ids degrade to the
   * mailto fallback until the real catalog lands.
   */
  bundle?: {
    id: string;
    label: string;
    note: string;
    prices: Record<BillingPeriod, TierPrice>;
  };
  features: { label: string; included: boolean }[];
}

/** What the checkout/login flow actually needs from a tier (billing-resolved). */
export interface CheckoutTier {
  tierKey: TierKey;
  name: string;
  cta: string;
  /** Selected billing period — the ID checkout bills Midtrans by period. */
  period: BillingPeriod;
  priceId?: string;
  /**
   * Vertical-bundle id (C3.2) the buyer selected — "restaurant_starter".
   * The checkout carries it (Midtrans custom_field4 / Paddle
   * custom_data.bundle) so the webhook mints the bundle-widened quota block.
   */
  bundle?: string;
  /**
   * C4.1: A/B test variant identifier (e.g. "pro_price"). When present,
   * the checkout embeds it in custom_data.ab_variant for analytics
   * attribution. The server ignores it — it's purely for client-side
   * conversion tracking.
   */
  abVariant?: string;
}

export interface FeatureRow {
  label: string;
  values: Record<TierKey, boolean | string | number>;
}
