import type { FeatureRow, PricingTier } from './types';

// Prices are per locale; this file is the global/USD pricing (en locale).
//
// Tier lineup follows subscription-tiers.md (FINAL 2026-08-17): Free · Plus ·
// Pro ⭐ · Premium · Enterprise, with USD and IDR as independent market
// prices. Yearly = 2 months free (10 months paid, 12 granted) and is the
// DEFAULT selection on the pricing page — marketed as "2 months free", never
// as a percentage discount.
//
// Paddle: the six real prices (Plus/Pro/Premium × monthly/yearly) are now
// catalogued from the Paddle dashboard. The IDs are shared by both locales
// (Paddle has no IDR billing currency — the id locale only differs in the
// displayed Rp amount). The bundle option (restaurant_starter) and the Pro
// A/B variant still use placeholder ids until those Paddle prices are
// created — checkout degrades to the mailto fallback for them.
export const pricing: PricingTier[] = [
  {
    id: 'free',
    tierKey: 'free',
    name: 'Free',
    currency: 'USD',
    description: 'Free forever — run one location, fully offline.',
    cta: 'Download',
    prices: {
      monthly: { price: '$0', period: 'free forever' },
      yearly: { price: '$0', period: 'free forever' },
    },
    features: [
      { label: '1 location', included: true },
      { label: '1 register', included: true },
      { label: '1 warehouse workspace', included: true },
      { label: '3-month sales history', included: true },
      { label: 'QRIS payments', included: true },
      { label: 'Cloud sync', included: false },
    ],
  },
  {
    id: 'plus',
    tierKey: 'plus',
    name: 'Plus',
    currency: 'USD',
    description: 'The entry plan for single-location shops ready to grow.',
    cta: 'Subscribe',
    prices: {
      monthly: { price: '$4.99', period: '/month', priceId: 'pro_01m1amcb41qkbr7zzd1kxa3qnd' },
      yearly: { price: '$49.99', period: '/year', priceId: 'pro_01m1amdj2swb3q21r2mwcy3krh' },
    },
    bundle: {
      id: 'restaurant_starter',
      label: 'Restaurant Starter bundle',
      note: '10% off à la carte',
      prices: {
        monthly: { price: '$7.99', period: '/month', priceId: 'pri_placeholder_plus_bundle_monthly' },
        yearly: { price: '$74.99', period: '/year', priceId: 'pri_placeholder_plus_bundle_yearly' },
      },
    },
    features: [
      { label: '1 location', included: true },
      { label: '2 registers', included: true },
      { label: '2 warehouse workspaces', included: true },
      { label: 'QRIS payments', included: true },
      { label: 'Daily Sales Dashboard', included: true },
      { label: 'Cloud sync', included: true },
    ],
  },
  {
    id: 'pro',
    tierKey: 'pro',
    name: 'Pro',
    currency: 'USD',
    description: 'For growing businesses — analytics, Kitchen Display, and multi-terminal.',
    cta: 'Subscribe',
    highlight: true,
    prices: {
      monthly: {
        price: '$9.99', period: '/month',
        priceId: 'pro_01m1amdwp700jp6183k9zjsgaz',
        // C4.1: A/B variant — $7.99 vs $9.99 (controlled by ?ab=pro_price + env).
        // The variant price is NOT created on Paddle yet — placeholder keeps
        // the variant checkout on the mailto fallback.
        variantPriceId: 'pri_pro_monthly_usd_variant_799',
        variantPrice: '$7.99',
      },
      yearly: { price: '$99.99', period: '/year', priceId: 'pro_01m1ame8ckw8vzjnf8y4q15mww' },
    },
    features: [
      { label: '2 locations', included: true },
      { label: '5 registers per location', included: true },
      { label: '2 Kitchen Display', included: true },
      { label: 'Reports & analytics', included: true },
      { label: 'Memo', included: true },
      { label: 'Stripe cards', included: true },
      { label: 'Cloud sync', included: true },
    ],
  },
  {
    id: 'premium',
    tierKey: 'premium',
    name: 'Premium',
    currency: 'USD',
    description: 'For multi-location chains — whitelabel, loyalty, and automation.',
    cta: 'Subscribe',
    prices: {
      monthly: { price: '$39.99', period: '/month', priceId: 'pro_01m1amema8yj6w5mfm8wx8jwhm' },
      yearly: { price: '$399.99', period: '/year', priceId: 'pro_01m1amf0vpbyfndg5rkvxvyqj4' },
    },
    features: [
      { label: '5 locations', included: true },
      { label: 'Unlimited registers', included: true },
      { label: 'Whitelabel branding', included: true },
      { label: 'Loyalty program', included: true },
      { label: 'Lua scripting', included: true },
      { label: 'Priority support (1h)', included: true },
    ],
  },
  {
    id: 'enterprise',
    tierKey: 'enterprise',
    name: 'Enterprise',
    currency: 'USD',
    description: 'Custom hardware, custom SLA, and a dedicated account manager.',
    cta: 'Contact us',
    prices: {
      monthly: { price: 'Custom', period: '' },
      yearly: { price: 'Custom', period: '' },
    },
    features: [
      { label: 'Unlimited locations', included: true },
      { label: 'Unlimited registers', included: true },
      { label: 'White-label branding', included: true },
      { label: 'Custom HAL drivers', included: true },
      { label: 'Dedicated account manager', included: true },
      { label: 'Custom support SLA', included: true },
    ],
  },
];

// Mirrors the quota & feature matrix in subscription-tiers.md §3.
export const featureRows: FeatureRow[] = [
  { label: 'Locations', values: { free: 1, plus: 1, pro: 2, premium: 5, enterprise: 'Unlimited' } },
  { label: 'Terminals (registers) per location', values: { free: 1, plus: 2, pro: 5, premium: 'Unlimited', enterprise: 'Unlimited' } },
  { label: 'Warehouse workspaces', values: { free: 1, plus: 2, pro: 3, premium: 'Unlimited', enterprise: 'Unlimited' } },
  { label: 'Kitchen Display screens', values: { free: 0, plus: 0, pro: 2, premium: 'Unlimited', enterprise: 'Unlimited' } },
  { label: 'Max products/menu', values: { free: 200, plus: 500, pro: 1000, premium: 10000, enterprise: 'Unlimited' } },
  { label: 'Staff users', values: { free: 1, plus: 5, pro: 20, premium: 50, enterprise: 'Unlimited' } },
  { label: 'Sales history', values: { free: '3 months', plus: '1 year', pro: '5 years', premium: 'Unlimited', enterprise: 'Unlimited' } },
  { label: 'QRIS payments', values: { free: true, plus: true, pro: true, premium: true, enterprise: true } },
  { label: 'Stripe cards', values: { free: false, plus: false, pro: true, premium: true, enterprise: true } },
  { label: 'Cloud sync', values: { free: false, plus: true, pro: true, premium: true, enterprise: true } },
  { label: 'Daily Sales Dashboard', values: { free: false, plus: true, pro: true, premium: true, enterprise: true } },
  { label: 'Reports & analytics', values: { free: false, plus: false, pro: true, premium: true, enterprise: true } },
  { label: 'Memo', values: { free: false, plus: false, pro: true, premium: true, enterprise: true } },
  { label: 'Full audit logging', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Audit log retention', values: { free: 'None', plus: '90 days', pro: '180 days', premium: '1 year', enterprise: '3 years' } },
  { label: 'Whitelabel branding', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Scheduled report emails', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Loyalty program', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Lua scripting', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Priority support', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Offline grace period', values: { free: '7 days', plus: '14 days', pro: '14 days', premium: '30 days', enterprise: '60 days' } },
];
