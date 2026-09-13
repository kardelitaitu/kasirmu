import { useEffect, useState } from 'react';
import { t } from '../i18n';
import type { CheckoutTier } from '../content/pricing/types';
import { hasSession, isPaddleConfigured, isPlaceholderPriceId, openPaddleCheckout, getSessionEmail } from './paddle';
import { openMidtransCheckout } from './midtrans';
import { getExplicitRegion } from '../lib/region';

/**
 * Pricing-page checkout button (website-plan.md §7). Payment is
 * register-first: without a session the button redirects to the login
 * page (which self-signs a new account on first OTP verify) instead of
 * opening checkout, so the webhook always finds a tenant. With a session
 * it opens the checkout overlay for the buyer's market (ADR #39 D1):
 * id-locale pages open the Midtrans Snap overlay (fixed Rp, QRIS/VA/
 * e-wallet); every other locale opens Paddle (USD cards).
 *
 * When the locale's checkout provider is unconfigured (PADDLE_CLIENT_TOKEN
 * unset / placeholder price id for Paddle markets, license API unset for
 * id) the button shows an error on click instead of the checkout overlay.
 *
 * ## Register-first custom_data contract (ADR #23 Deviation 2)
 *
 * The Paddle checkout embeds `custom_data` so the webhook
 * (`paddle_webhook.go`) can attach the subscription to the correct tenant
 * without a Paddle API key:
 *
 * - `custom_data.email` — the buyer's account email (lowercased/trimmed by
 *   the webhook's `resolvePaddleEmail`). **Required.** The webhook upserts
 *   the tenant by this value; without it, the webhook falls back to the
 *   Paddle API fetch (requires `PADDLE_API_KEY`).
 * - `custom_data.bundle` — optional C3.2 vertical bundle id
 *   (e.g. `"restaurant_starter"`). Cross-checked against the price map's
 *   bundle segment; never trusted alone — a bundle claim on a plain price
 *   is rejected.
 * - `custom_data.phone` — may be present when the Paddle checkout collects
 *   it; backfilled onto the tenant when non-empty.
 *
 * The signup vertical is **not** carried on Paddle purchases — trial
 * segmentation is a desktop-activation concern (`trial_vertical` in
 * `activate.go`), the same decision ADR #39 made for Midtrans.
 *
 * For Midtrans (id-locale), the equivalent contract is carried on
 * `custom_field1`–`custom_field4` in the Snap request (see `midtrans.ts`).
 */
interface Props {
  /** Billing-resolved tier (price id for the selected period — see PricingGrid). */
  tier: CheckoutTier;
  locale: string;
}

export default function CheckoutButton({ tier, locale }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Distinct from `error`: set when the tier's checkout is not purchasable
  // online yet (placeholder price id / unconfigured provider) — a different,
  // actionable message instead of the generic "try again".
  const [unavailable, setUnavailable] = useState(false);
  // SSR-safe label: hasSession() reads sessionStorage, which does not
  // exist during the Astro server render. Rendering it unconditionally
  // made the SSR HTML say "Sign in to subscribe" while hydration showed
  // the real CTA for signed-in users — the same flash class as the
  // login page. The label resolves only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const priceId = tier.priceId;
  // Region-based payment routing: Indonesia region uses Midtrans Snap
  // (fixed IDR, QRIS/VA/e-wallet — ADR #39 D1). Paddle stays for global.
  // When region is unset, fall back to locale (id → Midtrans).
  const [useMidtrans, setUseMidtrans] = useState(() => {
    const r = getExplicitRegion();
    return r === 'id' || (!r && locale === 'id');
  });
  useEffect(() => {
    const check = () => {
      const r = getExplicitRegion();
      setUseMidtrans(r === 'id' || (!r && locale === 'id'));
    };
    window.addEventListener('storage', check);
    return () => window.removeEventListener('storage', check);
  }, [locale]);

  // Round-trip back to this page after login; tier hints the next step.
  const loginHref = `/${locale}/login?next=/${locale}/pricing&tier=${encodeURIComponent(tier.tierKey)}`;

  const handleClick = async () => {
    if (!hasSession()) {
      // register-first: payment requires an account (website-plan.md §5)
      window.location.href = loginHref;
      return;
    }
    setLoading(true);
    setError(false);
    setUnavailable(false);
    try {
      if (useMidtrans) {
        // The snap token request is session-authed; the license server
        // reads the buyer email from the tenant record itself. The bundle
        // (C3.2) rides custom_field4 so the webhook mints the widened block.
        // C4.1: A/B variant is not carried to Midtrans (id-locale only bills
        // through IDR fixed prices, no Paddle variant). Analytics tracking
        // happens client-side via window.__ab_variant.
        if (tier.abVariant) window.__ab_variant = tier.abVariant;
        await openMidtransCheckout(tier.tierKey, tier.period, undefined, tier.bundle);
        return;
      }
      // Paddle path: the checkout can only open with a real price id and a
      // configured token. If either is missing (placeholder price / unset
      // PADDLE_CLIENT_TOKEN), surface the "not available to purchase yet"
      // message instead of opening a dead overlay or dropping the user into
      // a dead sign-in loop.
      if (!priceId || isPlaceholderPriceId(priceId) || !isPaddleConfigured()) {
        setUnavailable(true);
        return;
      }
      const email = await getSessionEmail();
      if (!email) {
        // Session token present but no email resolvable — back to login.
        window.location.href = loginHref;
        return;
      }
      // C4.1: Track A/B variant for analytics attribution.
      if (tier.abVariant) window.__ab_variant = tier.abVariant;
      await openPaddleCheckout(priceId!, email, undefined, tier.bundle);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className="block w-full rounded-md bg-accent px-4 py-2.5 text-center text-sm font-semibold text-on-primary whitespace-nowrap transition hover:opacity-90 disabled:opacity-60"
      >
        {loading ? '…' : mounted && hasSession() ? tier.cta : t(locale, 'checkout.signInToSubscribe')}
      </button>
      {unavailable && (
        <p className="text-xs text-link" role="alert">
          {t(locale, 'checkout.unavailable')}
        </p>
      )}
      {error && (
        <p className="text-xs text-link" role="alert">
          {t(locale, 'checkout.error')}
        </p>
      )}
    </div>
  );
}
