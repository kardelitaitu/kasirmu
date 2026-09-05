import { useEffect, useRef, useState } from 'react';
import type { BillingPeriod, CheckoutTier, PricingTier } from '../content/pricing/types';
import { t } from '../i18n';
import { getExplicitRegion, type Region } from '../lib/region';
import CheckoutButton from './CheckoutButton';

/**
 * Pricing grid (pricing.astro). Renders the five tiers from
 * subscription-tiers.md (Free · Plus · Pro ⭐ · Premium · Enterprise) with a
 * monthly/yearly toggle.
 *
 * Annual is the DEFAULT selection (§2): yearly = 2 months free (pay 10
 * months, get 12), marketed as "2 months free" / "2 bulan gratis" — never as
 * a percentage discount — and users actively switch to monthly.
 *
 * Checkout is register-first (website-plan.md §5): paid cards go through
 * CheckoutButton (redirects to /login until a session exists); the Free
 * (free-forever) card links to the download page; Enterprise has no price id
 * and falls through to the mailto contact fallback inside CheckoutButton.
 */
interface Props {
  tiers: PricingTier[];
  /** Alternative pricing tiers for the other region (e.g., IDR when showing USD). */
  tiersAlt?: PricingTier[];
  locale: string;
  downloadHref: string;
  contactHref: string;
}

export default function PricingGrid({ tiers, locale, downloadHref, contactHref }: Props) {
  const [billing, setBilling] = useState<BillingPeriod>('yearly');
  const activeTiers = tiers;
  const trackRef = useRef<HTMLDivElement>(null);
  const monthlyBtnRef = useRef<HTMLButtonElement>(null);
  const yearlyBtnRef = useRef<HTMLButtonElement>(null);
  // C4.1: A/B test — ?ab=pro_price activates the $7.99 variant for Pro monthly
  const [abVariant, setAbVariant] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ab = params.get('ab');
    if (ab) setAbVariant(ab);
  }, []);

  // Measure pill position based on active button
  const [pillStyle, setPillStyle] = useState<{ left: string; width: string }>({ left: '3px', width: 'calc(50% - 3px)' });

  useEffect(() => {
    const track = trackRef.current;
    const btn = billing === 'monthly' ? monthlyBtnRef.current : yearlyBtnRef.current;
    if (!track || !btn) return;

    const trackRect = track.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setPillStyle({
      left: `${btnRect.left - trackRect.left - 3}px`,
      width: `${btnRect.width + 6}px`,
    });
  }, [billing]);

  const buttonDefs = [
    { key: 'monthly' as BillingPeriod, label: t(locale, 'pricingPage.billing.monthly'), ref: monthlyBtnRef },
    { key: 'yearly' as BillingPeriod, label: t(locale, 'pricingPage.billing.yearly'), note: t(locale, 'pricingPage.billing.yearlyNote'), ref: yearlyBtnRef },
  ];

  return (
    <>
      <div className="mt-12 flex justify-center">
        <div
          role="group"
          aria-label={t(locale, 'pricingPage.billing.label')}
          ref={trackRef}
          className="billing-toggle relative inline-flex items-center rounded-lg bg-ghost-bg p-[3px] text-sm"
        >
          {/* Sliding pill indicator — design-language.md: ms-indicator */}
          <div
            className="absolute top-[3px] bottom-[3px] rounded-lg bg-primary transition-all duration-[280ms] ease-[cubic-bezier(0.33,1,0.68,1)]"
            style={pillStyle}
            aria-hidden="true"
          />
          {buttonDefs.map((btn) => (
            <button
              key={btn.key}
              type="button"
              ref={btn.ref}
              onClick={() => setBilling(btn.key)}
              aria-pressed={billing === btn.key}
              className={[
                'relative z-10 flex-1 rounded-lg px-4 py-[5px] font-semibold transition-opacity duration-200 text-center whitespace-nowrap',
                billing === btn.key ? 'text-on-primary opacity-100' : 'text-muted opacity-50 hover:opacity-100',
              ].join(' ')}
            >
              {btn.label}
              {'note' in btn && btn.note && (
                <span
                  className={[
                    'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap',
                    billing === 'yearly' ? 'bg-white/20 text-on-primary' : 'bg-accent/15 text-link',
                  ].join(' ')}
                >
                  {btn.note}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 items-stretch">
        {activeTiers.map((tier) => {
          const isFree = tier.tierKey === 'free';
          const isEnterprise = tier.tierKey === 'enterprise';
          let price = tier.prices[billing];
          // C4.1: A/B test override — when ?ab=pro_price is set and this tier
          // has a variantPriceId, swap the price + priceId for the variant.
          let abActive = false;
          if (abVariant === 'pro_price' && price.variantPriceId && billing === 'monthly') {
            price = { ...price, priceId: price.variantPriceId, price: price.variantPrice ?? price.price };
            abActive = true;
          }
          const checkoutTier: CheckoutTier = {
            tierKey: tier.tierKey,
            name: tier.name,
            cta: tier.cta,
            period: billing,
            priceId: price.priceId,
            abVariant: abActive && abVariant ? abVariant : undefined,
          };
          return (
            <article
              key={tier.id}
              id={tier.id}
              className={[
                'relative flex scroll-mt-24 flex-col rounded-2xl p-6 h-full transition-all duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:shadow-lg',
                tier.highlight
                  ? 'border-2 border-primary bg-surface shadow-md popular-glow-border scale-[1.02] z-10'
                  : 'border border-ink/10 bg-surface/50 hover:border-ink/20',
              ].join(' ')}
            >
              {tier.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center rounded-full bg-primary px-3 py-0.5 text-[11px] font-bold text-on-primary shadow-sm uppercase tracking-wider">
                  {t(locale, 'pricingPage.mostPopular')}
                </span>
              )}
              {/* Row 1: Title */}
              <h3 className="text-lg font-semibold">{tier.name}</h3>
              {/* Row 2: Price */}
              <div className="mt-4 min-h-[58px] flex flex-col justify-start">
                <p className="text-2xl font-bold whitespace-nowrap">
                  {isEnterprise ? 'Custom' : price.price}
                  {!isEnterprise && price.period && <span className="text-xs font-normal text-muted"> {price.period}</span>}
                </p>
                {billing === 'yearly' && !isFree && !isEnterprise ? (
                  <p className="mt-1 text-xs text-muted leading-tight">{t(locale, 'pricingPage.billing.billedYearly')}</p>
                ) : (
                  <span className="mt-1 block h-4" aria-hidden="true" />
                )}
              </div>
              {/* Row 3: Description */}
              <div className="mt-4 min-h-[64px] flex items-start">
                <p className="text-sm text-muted leading-relaxed">{tier.description}</p>
              </div>
              {/* Row 4: Features — fills remaining space */}
              <ul className="mt-6 flex-1 space-y-2 text-sm">
                {tier.features.map((f) => (
                  <li key={f.label} className={['flex items-center gap-2', f.included ? '' : 'text-muted'].join(' ')}>
                    <span aria-hidden="true" className={f.included ? 'text-link' : 'text-muted/50'}>
                      {f.included ? '✓' : '✗'}
                    </span>
                    {f.label}
                  </li>
                ))}
              </ul>
              {/* Row 5: Button — pinned to bottom */}
              <div className="mt-6">
                {isFree ? (
                  <a
                    href={downloadHref}
                    className="block w-full rounded-md bg-accent px-4 py-2.5 text-center text-sm font-semibold text-on-primary whitespace-nowrap transition hover:opacity-90"
                  >
                    {tier.cta}
                  </a>
                ) : isEnterprise ? (
                  <a
                    href={contactHref}
                    className="block w-full rounded-md bg-accent px-4 py-2.5 text-center text-sm font-semibold text-on-primary whitespace-nowrap transition hover:opacity-90"
                  >
                    {tier.cta}
                  </a>
                ) : (
                  <CheckoutButton tier={checkoutTier} locale={locale} />
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
