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