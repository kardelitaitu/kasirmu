// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pricingFor, featureRowsFor } from '../../content/pricing';
import { pricing as enPricing } from '../../content/pricing/en';
import { pricing as idPricing } from '../../content/pricing/id';
import type { TierKey, BillingPeriod } from '../../content/pricing/types';

/**
 * Pricing-content invariants. These pin the data contract the pricing page
 * and the account dashboard subscribe section both consume — if the content
 * drifts (a tier dropped, a price id missing, an IDR tier without its USD
 * sibling), the checkout flow breaks silently. Property-style: assert the
 * invariant over the whole set, not one example.
 */

const LOCALES = ['en', 'id'] as const;
const PERIODS: BillingPeriod[] = ['monthly', 'yearly'];
const PAID_TIERS: TierKey[] = ['plus', 'pro', 'premium'];

describe('pricingFor selector', () => {
  it('maps en → USD content and id → IDR content', () => {
    expect(pricingFor('en')).toBe(enPricing);
    expect(pricingFor('id')).toBe(idPricing);
    expect(enPricing).not.toBe(idPricing);
  });

  it('returns the same tier lineup in both locales', () => {
    const enKeys = enPricing.map((t) => t.tierKey);
    const idKeys = idPricing.map((t) => t.tierKey);
    expect(idKeys).toEqual(enKeys);
    // The documented lineup: Free · Plus · Pro · Premium · Enterprise.
    expect(enKeys).toEqual(['free', 'plus', 'pro', 'premium', 'enterprise']);
  });
});

describe('tier shape invariants', () => {
  it('every tier has a currency matching its locale', () => {
    for (const t of enPricing) expect(t.currency).toBe('USD');
    for (const t of idPricing) expect(t.currency).toBe('IDR');
  });

  it('every tier has both billing periods with a display price', () => {
    for (const locale of LOCALES) {
      const pricing = locale === 'en' ? enPricing : idPricing;
      for (const tier of pricing) {
        for (const period of PERIODS) {
          expect(tier.prices[period], `${locale} ${tier.tierKey} ${period}`).toBeDefined();
          expect(tier.prices[period].price).toBeTruthy();
        }
      }
    }
  });

  it('the free tier has no price id (no checkout)', () => {
    for (const locale of LOCALES) {
      const free = (locale === 'en' ? enPricing : idPricing).find((t) => t.tierKey === 'free');
      expect(free?.prices.monthly.priceId).toBeUndefined();
      expect(free?.prices.yearly.priceId).toBeUndefined();
    }
  });

  it('every paid tier has a price id for the yearly period (checkout requires it)', () => {
    for (const locale of LOCALES) {
      const pricing = locale === 'en' ? enPricing : idPricing;
      for (const tier of pricing) {
        if (PAID_TIERS.includes(tier.tierKey)) {
          expect(tier.prices.yearly.priceId, `${locale} ${tier.tierKey} yearly`).toBeTruthy();
        }
      }
    }
  });

  it('the six main paid prices use real Paddle ids — no placeholders, no legacy sandbox ids', () => {
    // The catalogued Paddle prices (2026-08-31) replace the pri_placeholder_*
    // ids on the main Plus/Pro/Premium × monthly/yearly grid. A placeholder
    // or legacy (pri_01m05…) id here would either degrade checkout to the
    // mailto fallback or charge the superseded $19/$49 amounts.
    const LEGACY_IDS = ['pri_01m05gdnqp30xze6db73qcracp', 'pri_01m05gdpk4hmnm0k8e6vxm8cec'];
    for (const tierKey of PAID_TIERS) {
      for (const period of PERIODS) {
        const en = enPricing.find((t) => t.tierKey === tierKey)!;
        const id = idPricing.find((t) => t.tierKey === tierKey)!;
        for (const tier of [en, id]) {
          const pid = tier.prices[period].priceId;
          expect(pid, `${tierKey} ${period} price id present`).toBeTruthy();
          expect(pid!.startsWith('pri_placeholder_'), `${tierKey} ${period} not placeholder`).toBe(false);
          expect(LEGACY_IDS.includes(pid!), `${tierKey} ${period} not a legacy sandbox id`).toBe(false);
          // Real Paddle ids share the `pro_` prefix in this catalog.
          expect(pid!.startsWith('pro_'), `${tierKey} ${period} uses the pro_ prefix`).toBe(true);
        }
      }
    }
  });

  it('enterprise has no price id (contact-sales only)', () => {
    for (const locale of LOCALES) {
      const ent = (locale === 'en' ? enPricing : idPricing).find((t) => t.tierKey === 'enterprise');
      expect(ent?.prices.yearly.priceId).toBeUndefined();
      expect(ent?.prices.monthly.priceId).toBeUndefined();
    }
  });

  it('exactly one tier is highlighted (Most Popular)', () => {
    for (const locale of LOCALES) {
      const highlighted = (locale === 'en' ? enPricing : idPricing).filter((t) => t.highlight);
      expect(highlighted).toHaveLength(1);
      expect(highlighted[0].tierKey).toBe('pro');
    }
  });

  it('free plan includes QRIS payments but no cloud sync (both card and comparison table)', () => {
    // The home page Free card and the full pricing comparison table must
    // agree: Free = QRIS at the counter (no extra hardware) but data stays
    // local — cloud sync is a paid-tier differentiator. Drift between the
    // tier.features list and featureRows previously showed ✓ on the home
    // card while the table said ✗ (and vice versa), contradicting itself.
    const LABEL_EN = { card: 'QRIS payments', table: 'QRIS payments' };
    const LABEL_ID = { card: 'Pembayaran QRIS', table: 'Pembayaran QRIS' };
    for (const locale of LOCALES) {
      const pricing = locale === 'en' ? enPricing : idPricing;
      const rows = featureRowsFor(locale);
      const labels = locale === 'en' ? LABEL_EN : LABEL_ID;
      const free = pricing.find((t) => t.tierKey === 'free')!;
      const qris = free.features.find((f) => f.label === labels.card)!;
      const cloud = free.features.find((f) => f.label === (locale === 'en' ? 'Cloud sync' : 'Sinkron cloud'))!;
      expect(qris.included, `${locale} free card QRIS`).toBe(true);
      expect(cloud.included, `${locale} free card cloud sync`).toBe(false);
      const qrisRow = rows.find((r) => r.label === labels.table)!;
      const cloudRow = rows.find((r) => r.label === (locale === 'en' ? 'Cloud sync' : 'Sinkron cloud'))!;
      expect(qrisRow.values.free, `${locale} free table QRIS`).toBe(true);
      expect(cloudRow.values.free, `${locale} free table cloud sync`).toBe(false);
    }
  });

  it('uses Location terminology for site-unit quota labels in both locales', () => {
    const enLabels = [
      ...enPricing.flatMap((tier) => tier.features.map((feature) => feature.label)),
      ...featureRowsFor('en').map((row) => row.label),
    ];
    const idLabels = [
      ...idPricing.flatMap((tier) => tier.features.map((feature) => feature.label)),
      ...featureRowsFor('id').map((row) => row.label),
    ];

    expect(enLabels.some((label) => /\bstore(s)?\b/i.test(label))).toBe(false);
    expect(idLabels.some((label) => /\btoko\b/i.test(label))).toBe(false);
    expect(enLabels).toContain('1 location');
    expect(enLabels).toContain('Locations');
    expect(enLabels).toContain('1 warehouse workspace');
    expect(enLabels).toContain('Warehouse workspaces');
    expect(idLabels).toContain('1 lokasi');
    expect(idLabels).toContain('Lokasi');
    expect(idLabels).toContain('1 workspace gudang');
    expect(idLabels).toContain('Workspace gudang');
  });

  it('Memo is Pro+ (card and comparison table agree, both locales)', () => {
    // todo-global-saas.md §14: Memo authoring is Pro+. Free/Plus must not
    // advertise it on any surface, the Pro card must list it, and the table
    // row must open exactly at Pro. Same card-vs-table agreement rule as the
    // QRIS invariant above.
    for (const locale of LOCALES) {
      const pricing = locale === 'en' ? enPricing : idPricing;
      const rows = featureRowsFor(locale);
      const label = 'Memo'; // same word in both locales
      const row = rows.find((r) => r.label === label);
      expect(row, `${locale} table has a Memo row`).toBeDefined();
      expect(row!.values.free, `${locale} table Memo free`).toBe(false);
      expect(row!.values.plus, `${locale} table Memo plus`).toBe(false);
      expect(row!.values.pro, `${locale} table Memo pro`).toBe(true);
      expect(row!.values.premium, `${locale} table Memo premium`).toBe(true);
      expect(row!.values.enterprise, `${locale} table Memo enterprise`).toBe(true);
      const pro = pricing.find((t) => t.tierKey === 'pro')!;
      const proMemo = pro.features.find((f) => f.label === label);
      expect(proMemo, `${locale} pro card lists Memo`).toBeDefined();
      expect(proMemo!.included, `${locale} pro card Memo included`).toBe(true);
      for (const key of ['free', 'plus'] as const) {
        const tier = pricing.find((t) => t.tierKey === key)!;
        const memo = tier.features.find((f) => f.label === label);
        expect(
          memo === undefined || memo.included === false,
          `${locale} ${key} card must not include Memo`,
        ).toBe(true);
      }
    }
  });
});

describe('locale parity invariants', () => {
  it('paid tiers carry the same price id suffix shape in both locales (both bill Paddle USD)', () => {
    // Per types.ts: both locales charge the same Paddle price ids today
    // (Paddle has no IDR billing currency) — the id locale only differs in
    // the displayed Rp amount.
    for (const tierKey of PAID_TIERS) {
      const en = enPricing.find((t) => t.tierKey === tierKey)!;
      const id = idPricing.find((t) => t.tierKey === tierKey)!;
      expect(id.prices.yearly.priceId).toBe(en.prices.yearly.priceId);
      expect(id.prices.monthly.priceId).toBe(en.prices.monthly.priceId);
    }
  });

  it('the bundle option, when present, exists in both locales', () => {
    for (const tierKey of PAID_TIERS) {
      const en = enPricing.find((t) => t.tierKey === tierKey)!;
      const id = idPricing.find((t) => t.tierKey === tierKey)!;
      expect(Boolean(id.bundle)).toBe(Boolean(en.bundle));
    }
  });
});

describe('featureRowsFor', () => {
  it('returns a rows array for both locales', () => {
    for (const locale of LOCALES) {
      const rows = featureRowsFor(locale);
      expect(rows.length).toBeGreaterThan(0);
    }
  });
});

describe('numeric quota matrix (Phase 1 §E verification anchor)', () => {
  // Canonical values, in enforcement order:
  // - locations: tierQuotas() in apps/license-server/paddle_webhook.go
  //   (free 1, plus 1, pro 2, premium 5, enterprise 0=unlimited) mirrored by
  //   SubscriptionTier::max_locations() in crates/oz-core/src/subscription.rs.
  // - terminals/location: tierQuotas max_pos_instances ↔ max_pos_instances().
  // - warehouse workspaces: max_warehouses() (client-side per the Go comment).
  // - KDS screens: max_kds_screens() + the kds branch of
  //   enforce_instance_quota (Pro capped at 2; a C3.2 bundle-widened kds
  //   gets the same 2-screen budget); type-gating via allows_workspace_type.
  // - products: max_products() + enforce_product_quota, wired into both
  //   shells' create-product commands and the REST create_product.
  // - staff: max_staff_users() + enforce_staff_quota.
  // - sales history: sales_history_days(), enforced in both shells' history.rs.
  // - grace: todo-global-saas-1.md §B (Free/OneTime 7, Plus 14, Pro 14,
  //   Premium 30, Enterprise 60 standard with signed contract overrides).
  // - audit retention: todo-global-saas-2.md audit baseline (Free none,
  //   Plus 90d, Pro 180d, Premium 1y, Enterprise 3y).
  const TIERS: TierKey[] = ['free', 'plus', 'pro', 'premium', 'enterprise'];
  const MATRIX_EN: { label: string; values: Record<TierKey, string | number> }[] = [
    { label: 'Locations', values: { free: 1, plus: 1, pro: 2, premium: 5, enterprise: 'Unlimited' } },
    { label: 'Terminals (registers) per location', values: { free: 1, plus: 2, pro: 5, premium: 'Unlimited', enterprise: 'Unlimited' } },
    { label: 'Warehouse workspaces', values: { free: 1, plus: 2, pro: 3, premium: 'Unlimited', enterprise: 'Unlimited' } },
    { label: 'Kitchen Display screens', values: { free: 0, plus: 0, pro: 2, premium: 'Unlimited', enterprise: 'Unlimited' } },
    { label: 'Max products/menu', values: { free: 200, plus: 500, pro: 1000, premium: 10000, enterprise: 'Unlimited' } },
    { label: 'Staff users', values: { free: 1, plus: 5, pro: 20, premium: 50, enterprise: 'Unlimited' } },
    { label: 'Sales history', values: { free: '3 months', plus: '1 year', pro: '5 years', premium: 'Unlimited', enterprise: 'Unlimited' } },
    { label: 'Offline grace period', values: { free: '7 days', plus: '14 days', pro: '14 days', premium: '30 days', enterprise: '60 days' } },
    { label: 'Audit log retention', values: { free: 'None', plus: '90 days', pro: '180 days', premium: '1 year', enterprise: '3 years' } },
  ];
  const MATRIX_ID: { label: string; values: Record<TierKey, string | number> }[] = [
    { label: 'Lokasi', values: { free: 1, plus: 1, pro: 2, premium: 5, enterprise: 'Tanpa batas' } },
    { label: 'Terminal (register) per lokasi', values: { free: 1, plus: 2, pro: 5, premium: 'Tanpa batas', enterprise: 'Tanpa batas' } },
    { label: 'Workspace gudang', values: { free: 1, plus: 2, pro: 3, premium: 'Tanpa batas', enterprise: 'Tanpa batas' } },
    { label: 'Layar Display Dapur', values: { free: 0, plus: 0, pro: 2, premium: 'Tanpa batas', enterprise: 'Tanpa batas' } },
    { label: 'Max produk/menu', values: { free: 200, plus: 500, pro: 1000, premium: 10000, enterprise: 'Tanpa batas' } },
    { label: 'Staf pengguna', values: { free: 1, plus: 5, pro: 20, premium: 50, enterprise: 'Tanpa batas' } },
    { label: 'Riwayat penjualan', values: { free: '3 bulan', plus: '1 tahun', pro: '5 tahun', premium: 'Tanpa batas', enterprise: 'Tanpa batas' } },
    { label: 'Masa tenggang offline', values: { free: '7 hari', plus: '14 hari', pro: '14 hari', premium: '30 hari', enterprise: '60 hari' } },
    { label: 'Retensi log audit', values: { free: 'Tidak ada', plus: '90 hari', pro: '180 hari', premium: '1 tahun', enterprise: '3 tahun' } },
  ];

  it.each([['en', MATRIX_EN], ['id', MATRIX_ID]] as const)(
    '%s comparison table matches the canonical quota contract',
    (locale, matrix) => {
      const rows = featureRowsFor(locale);
      for (const expected of matrix) {
        const row = rows.find((r) => r.label === expected.label);
        expect(row, `${locale}: row "${expected.label}" exists`).toBeDefined();
        for (const tier of TIERS) {
          expect(row!.values[tier], `${locale}: "${expected.label}" ${tier}`).toBe(expected.values[tier]);
        }
      }
    },
  );

  it('the free card and the comparison table agree on the headline quotas', () => {
    // The card bullets are prose ("1 location", "2 registers") while the
    // table carries the structured values; drift between the two is the
    // QRIS-class bug the card/table invariant above exists for. Pin the
    // numeric bullets to the table too.
    const cardQuota: { label: string; row: string; tier: TierKey }[] = [
      { label: '1 location', row: 'Locations', tier: 'free' },
      { label: '1 register', row: 'Terminals (registers) per location', tier: 'free' },
      { label: '1 warehouse workspace', row: 'Warehouse workspaces', tier: 'free' },
    ];
    const rows = featureRowsFor('en');
    const free = enPricing.find((t) => t.tierKey === 'free')!;
    for (const q of cardQuota) {
      expect(free.features.some((f) => f.label === q.label && f.included), `free card lists "${q.label}"`).toBe(true);
      const tableRow = rows.find((r) => r.label === q.row)!;
      expect(tableRow.values[q.tier], `table "${q.row}" free = 1`).toBe(1);
    }
  });
});