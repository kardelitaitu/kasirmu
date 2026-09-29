// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * Both dictionaries as data, plus a flattener for them.
 *
 * The vocabulary pins below have to see PROSE — a landing page's FAQ answer, for
 * instance — not just the structured pricing content, or a spelling can be fixed
 * on the cards while a dictionary string keeps the old one. Parsed once here for
 * the whole file; the yearly-copy block reads the same object.
 */
const DICTS = {
  en: JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'en.json'), 'utf-8')),
  id: JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'id.json'), 'utf-8')),
};

/** Every string leaf of a nested dictionary, so a scan reaches prose and arrays. */
function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => stringLeaves(entry, out));
  else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((entry) => stringLeaves(entry, out));
  }
  return out;
}

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

  it('free plan advertises dynamic QRIS and keeps data local (card and table agree)', () => {
    // The home page Free card and the full pricing comparison table must
    // agree. Two claims are pinned, one per surface: the card carries the
    // dynamic-QRIS bullet, the table carries the gates, and cloud sync is the
    // paid-tier differentiator on both. Drift between the tier.features list and
    // featureRows previously showed ✓ on the home card while the table said ✗
    // (and vice versa), contradicting itself.
    //
    // WHAT IS NO LONGER HERE: the card used to be pinned as listing static
    // (printed) QRIS at the counter. That bullet was removed — it spent a row on
    // something every plan includes, and the dynamic-QRIS bullet below carries
    // the payment story. Static QRIS stays ungated (asserted at the end of this
    // test), so its absence from the CARD is a presentation choice now, not an
    // entitlement claim, and the one-directional assertion is the honest one.
    for (const locale of LOCALES) {
      const pricing = locale === 'en' ? enPricing : idPricing;
      const rows = featureRowsFor(locale);
      const cloudLabel = locale === 'en' ? 'Cloud sync' : 'Sinkron cloud';
      const staticQris = locale === 'en' ? 'Static QRIS at the counter' : 'QRIS statis di kasir';
      const dynamicQris = locale === 'en' ? 'Dynamic QRIS' : 'QRIS dinamis';
      const free = pricing.find((t) => t.tierKey === 'free')!;
      expect(
        free.features.find((f) => f.label === dynamicQris)?.included,
        `${locale} free card dynamic QRIS`,
      ).toBe(true);
      expect(
        free.features.find((f) => f.label === cloudLabel)!.included,
        `${locale} free card cloud sync`,
      ).toBe(false);
      expect(rows.find((r) => r.label === cloudLabel)!.values.free, `${locale} free table cloud sync`).toBe(false);
      // Static QRIS is deliberately NOT a gated row: subscription-tiers.md §3
      // "Payments" grants it on every plan, so a ✗ column for it would be a lie.
      expect(rows.some((r) => r.label === staticQris), `${locale} no gated static-QRIS row`).toBe(false);
    }
  });

  it('payment rails open where the recorded product decision says', () => {
    // Authority, in order: subscription-tiers.md §3 "Payments" (the published
    // matrix) and SubscriptionTier::supports_qris / supports_stripe in
    // crates/kasirmu-core/src/subscription/tier.rs (what the app enforces).
    // supports_stripe() is Pro+; the Midtrans wallet/card gateway is Plus+.
    //
    // Dynamic amount QRIS is the recorded EXCEPTION. The owner ruled it
    // available on Free on 2026-09-29, which is what the QRIS landing page
    // ("Both ship on every plan, including Free") and the docs' licensing
    // matrix ("QRIS: ✓ (static + dynamic)" on the Free column) already said —
    // the pricing table was the outlier. THE ENTITLEMENT LAYER HAS NOT MOVED:
    // `supports_qris()` is still false for Free/OneTime and the POS still gates
    // the QRIS tender behind an upgrade prompt, so this row and the app disagree
    // until that lands. The change was ordered website-first.
    //
    // That is why this asserts a DECISION rather than an enforcement: the two
    // stop being the same thing here, and a silent revert in either direction is
    // a product change, not a cleanup.
    const RAILS: Record<(typeof LOCALES)[number], { label: string; from: TierKey }[]> = {
      en: [
        { label: 'Dynamic amount QRIS*', from: 'free' },
        { label: 'Midtrans Gateway (e-wallet, debit/credit cards)*', from: 'plus' },
        { label: 'Stripe Gateway (WIP)*', from: 'pro' },
      ],
      id: [
        { label: 'QRIS nominal dinamis*', from: 'free' },
        { label: 'Gateway Midtrans (e-wallet, kartu debit/kredit)*', from: 'plus' },
        { label: 'Gateway Stripe (WIP)*', from: 'pro' },
      ],
    };
    const ORDER: TierKey[] = ['free', 'plus', 'pro', 'premium', 'enterprise'];
    for (const locale of LOCALES) {
      const rows = featureRowsFor(locale);
      for (const rail of RAILS[locale]) {
        const row = rows.find((r) => r.label === rail.label);
        expect(row, `${locale}: row "${rail.label}" exists`).toBeDefined();
        const opens = ORDER.indexOf(rail.from);
        for (const [i, tier] of ORDER.entries()) {
          expect(row!.values[tier], `${locale}: "${rail.label}" ${tier}`).toBe(i >= opens);
        }
      }
      // Every marked row has a legend: `*` is the only thing tying a row to its
      // note, and the rows' order is the only thing tying it to the right one.
      for (const rail of RAILS[locale]) {
        expect(rail.label.endsWith('*'), `${locale}: "${rail.label}" carries the marker`).toBe(true);
      }
      // Stripe is advertised at Pro+ but is not shippable yet; the label says so
      // rather than letting a ✓ read as "available today".
      expect(RAILS[locale][2].label, `${locale} Stripe row is flagged`).toContain('WIP');
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
    // The warehouse noun lives on the comparison row only now: the cards stopped
    // listing a warehouse bullet when the feature moved to Premium (2026-09-29),
    // so there is no "1 warehouse workspace" card label left to pin.
    expect(enLabels).toContain('Warehouse workspaces');
    expect(idLabels).toContain('1 lokasi');
    expect(idLabels).toContain('Lokasi');
    expect(idLabels).toContain('Ruang kerja gudang');
  });

  it('names the Indonesian tiers in the app\u2019s own vocabulary, not the English loanwords', () => {
    // The id tier copy said "workspace" and "Display Dapur" while the app and
    // the docs say "ruang kerja" (shared.id.ftl nav-switch-workspace, docs/id/
    // workspaces.md) and "Layar Dapur (KDS)" (docs/id/stores.md). One product
    // noun, one spelling — these are the terms, pinned positively, with the
    // borrowings that deliberately stay for evidence: "register" (the docs'
    // own word for a cashier terminal) and "Memo" (shared.id.ftl memos-title,
    // the product's own name for it in both languages).
    const idLabels = [
      ...idPricing.flatMap((tier) => tier.features.map((feature) => feature.label)),
      ...featureRowsFor('id').map((row) => row.label),
    ];
    expect(idLabels).toContain('Ruang kerja gudang');
    expect(idLabels).toContain('Layar Dapur (KDS)');
    expect(idLabels).toContain('Gateway Stripe');
    expect(idLabels).toContain('Memo');
    expect(idLabels).toContain('2 register');
    expect(idLabels.some((label) => /workspace/i.test(label))).toBe(false);
    expect(idLabels.some((label) => /display dapur/i.test(label))).toBe(false);
    expect(idLabels.some((label) => /^kartu stripe$/i.test(label))).toBe(false);
  });

  it('spells whitelabel the same way on every id surface', () => {
    // The Premium card said "Branding whitelabel" while the Enterprise card
    // said "Branding white-label" for the same feature, two rows apart.
    const idLabels = [
      ...idPricing.flatMap((tier) => tier.features.map((feature) => feature.label)),
      ...featureRowsFor('id').map((row) => row.label),
    ];
    const whitelabel = idLabels.filter((label) => /white-?label/i.test(label));
    expect(whitelabel.length).toBeGreaterThan(0);
    expect(whitelabel.every((label) => !label.includes('white-label'))).toBe(true);
  });

  it('spells e-wallet the hyphenated way on every surface, both locales', () => {
    // Same rule as whitelabel above, opposite winner, wider net: the pricing
    // table glossed the Midtrans row as "eWallet" while the plan cards, both
    // dictionaries' prose and the in-app docs all wrote "e-wallet". One token,
    // one spelling — the hyphenated form wins because it is the one readers meet
    // everywhere else; the table was the only holdout. The row label is also the
    // `*` legend's subject, so it is quoted word-for-word in the payment-rails
    // test above and in the note under the table: all three move together.
    //
    // What "surface" means: every plan-card bullet and comparison-row label in
    // BOTH locales, plus every string leaf of both dictionaries — prose, FAQ
    // answers and headings alike, so a heading's "E-Wallets" counts as the same
    // spelling (the match is case-insensitive). OUT OF SCOPE on purpose:
    // src/lib/search-index.ts carries "ewallet" as a query keyword rather than a
    // shipping label, and the admin bundle under public/ is a separate build.
    const surfaces = [
      ...[...enPricing, ...idPricing].flatMap((tier) => tier.features.map((feature) => feature.label)),
      ...[...featureRowsFor('en'), ...featureRowsFor('id')].map((row) => row.label),
      ...stringLeaves(DICTS.en),
      ...stringLeaves(DICTS.id),
    ];
    // Guard against a scan that quietly matches nothing (the whitelabel test's
    // shape): if the token leaves the site altogether, this pin is dead and
    // should be deleted rather than left green.
    const mentions = surfaces.filter((surface) => /e-?wallet/i.test(surface));
    expect(mentions.length).toBeGreaterThan(0);
    for (const mention of mentions) {
      expect(mention, `"${mention.slice(0, 60)}" is spelled with a hyphen everywhere else`).toMatch(/e-wallet/i);
    }
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

describe('yearly saving copy (subscription-tiers.md §2)', () => {
  // §2 markets the annual plan as "2 months free" (pay 10, get 12) and — in
  // as many words — "never as a percentage discount". The billing toggle used
  // to say "17% off" / "Hemat 17%" while the cards and the comparison table's
  // price row each said "2 months free": three surfaces, two different numbers
  // for one saving, and the percentage is also just wrong (10 of 12 is 16.7%,
  // not 17%). Pin the wording where the numbers live, and close the door on a
  // percentage creeping back into any pricing string.
  // The dictionaries are the module-level DICTS above — one parse for the file,
  // shared with the vocabulary pins.
  const FREE_MONTHS: Record<(typeof LOCALES)[number], string> = {
    en: '2 months free',
    id: '2 bulan gratis',
  };

  it('states the saving as free months wherever the yearly period is named', () => {
    for (const locale of LOCALES) {
      const page = DICTS[locale].pricingPage;
      expect(page.billing.yearlyNote, `${locale} billing chip`).toBe(FREE_MONTHS[locale]);
      expect(page.billing.billedYearly, `${locale} card sub-line`).toContain(FREE_MONTHS[locale]);
      expect(page.twoMonthsFree, `${locale} comparison-table price row`).toBe(FREE_MONTHS[locale]);
    }
  });

  it('quotes no percentage anywhere in the pricing copy', () => {
    for (const locale of LOCALES) {
      // Scoped to pricingPage: "100% offline" elsewhere on the site is a
      // different claim and must keep working.
      const flat = JSON.stringify(DICTS[locale].pricingPage);
      expect(flat, `${locale} pricingPage quotes a percentage`).not.toContain('%');
    }
  });
});

describe('numeric quota matrix (Phase 1 §E verification anchor)', () => {
  // Canonical values, in enforcement order:
  // - locations: tierQuotas() in apps/license-server/paddle_webhook.go
  //   (free 1, plus 1, pro 2, premium 5, enterprise 0=unlimited) mirrored by
  //   SubscriptionTier::max_locations() in
  //   crates/kasirmu-core/src/subscription/tier.rs.
  // - terminals/location: tierQuotas max_pos_instances ↔ max_pos_instances().
  // - warehouse workspaces: max_warehouses() is 0 below Premium and
  //   allows_workspace_type("warehouse") denies the type there (owner ruling
  //   2026-09-29); the Go tierQuotas `allowed_types` list and the doc matrices
  //   carry the same zeros. pricing-tier-parity.test.ts re-derives this row from
  //   the Rust accessors, so it cannot drift from them again.
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
    { label: 'Warehouse workspaces', values: { free: 0, plus: 0, pro: 0, premium: 'Unlimited', enterprise: 'Unlimited' } },
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
    { label: 'Ruang kerja gudang', values: { free: 0, plus: 0, pro: 0, premium: 'Tanpa batas', enterprise: 'Tanpa batas' } },
    { label: 'Layar Dapur (KDS)', values: { free: 0, plus: 0, pro: 2, premium: 'Tanpa batas', enterprise: 'Tanpa batas' } },
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
    // Warehouse workspaces used to sit here as a third pair. It cannot: the
    // feature moved to Premium on 2026-09-29, so Free has no such card bullet
    // and the row reads 0 — a bullet pinned against a zero would be the drift
    // this test exists to catch, not a regression in it.
    const cardQuota: { label: string; row: string; tier: TierKey }[] = [
      { label: '1 location', row: 'Locations', tier: 'free' },
      { label: '1 register', row: 'Terminals (registers) per location', tier: 'free' },
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