/**
 * Add-on Marketplace (C4.3) — browse and purchase add-ons that extend
 * tier capabilities. Add-ons are additive to the base tier quotas.
 *
 * The marketplace shows available add-ons filtered by the tenant's
 * current tier, marks already-purchased add-ons, and opens Paddle
 * checkout for new purchases.
 */

import { useCallback, useContext } from 'react';
import { Localized } from '@fluent/react';
import { Button } from '@/components/Button';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import {
  getAddonsForTier,
  tenantHasAddon,
  type AddonDefinition,
} from '@/api/addons';
import { WEBSITE_ORIGIN, openExternalUrl } from '@/api/browser';
import './AddonsMarketplace.css';

/**
 * Website pricing URL for one add-on.
 *
 * Copied in SHAPE from `upgradePricingUrl` (utils/upgrade.ts:12), whose two
 * differences from the old inline string were both load-bearing:
 *
 *  - **the locale prefix.** Every marketing page lives at `/[locale]/…`
 *    (astro.config.mjs:72 sets `prefixDefaultLocale: true`), so `/pricing/`
 *    has no page to resolve to. A live fetch on 2026-10-25 answered 404 for
 *    /pricing/, /en/pricing/ and /id/pricing/ alike, but it served a stale
 *    build (no target has an id yet), so the prefix is argued from the
 *    routing config and from `upgradePricingUrl`, whose CTAs work — not from
 *    that fetch.
 *  - **the fragment.** `#addon-<id>` has no target: pricing.astro renders
 *    PricingGrid, whose only ids are the tier keys. Kept because it states
 *    the intent and costs nothing, but the operator lands on the pricing
 *    table, not on the add-on.
 */
function addonPricingUrl(locale: string, addonId: string): string {
  return `${WEBSITE_ORIGIN}/${locale}/pricing/#addon-${addonId}`;
}

interface AddonCardProps {
  addon: AddonDefinition;
  owned: boolean;
  onPurchase: (addon: AddonDefinition) => void;
}

/** A single add-on card in the marketplace grid. */
function AddonCard({ addon, owned, onPurchase }: AddonCardProps) {
  return (
    <div className={`addon-card ${owned ? 'addon-card--owned' : ''}`}>
      <div className="addon-card-icon">{addon.icon}</div>
      <div className="addon-card-body">
        <h3 className="addon-card-name">
          <Localized id={addon.nameKey}>
            <span>{addon.id}</span>
          </Localized>
        </h3>
        <p className="addon-card-desc">
          <Localized id={addon.descriptionKey}>
            <span>{addon.id}</span>
          </Localized>
        </p>
        <div className="addon-card-footer">
          <span className="addon-card-price">
            ${addon.priceUsd.toFixed(2)}/mo
          </span>
          {owned ? (
            <span className="addon-card-badge">
              <Localized id="addon-owned-badge">
                <span>Active</span>
              </Localized>
            </span>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onPurchase(addon)}
            >
              <Localized id="addon-purchase-button">
                <span>Add</span>
              </Localized>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * True when the catalog entry's Paddle price is still a placeholder rather
 * than a live Paddle price id.
 *
 * The prefix is the WEBSITE's convention, not this file's: pricing content
 * carries `pri_placeholder_plus_bundle_monthly` until the real Paddle catalog
 * lands, and website/src/components/paddle.ts:101 refuses to open a checkout
 * for exactly that prefix. Copying the test rather than the ids is the point —
 * the check used to name `pri_placeholder_` while the catalog this file reads
 * carried four `pri_addon_*_monthly` ids, so it never matched and
 * `handlePurchase` handed the operator to a URL instead of refusing.
 *
 * NOT the same test as "not a real price id": a non-placeholder id that Paddle
 * does not know still reaches the browser, which is the best available
 * behaviour for a value only the operator sets.
 */
function isPlaceholderPriceId(priceId: string): boolean {
  return priceId.startsWith('pri_placeholder_');
}

/**
 * Add-on Marketplace — renders a grid of available add-ons for the
 * tenant's current tier. Owned add-ons are shown as "Active" badges.
 * Purchase opens Paddle checkout via the existing `openPaddleCheckout` helper.
 */
export default function AddonsMarketplace() {
  const { caps } = useSubscription();
  // Same locale source as every other pricing CTA (TierLockedFeature.tsx:35).
  const locale = useContext(LocaleContext)?.locale ?? 'en';

  const tier = caps?.tier ?? 'free';
  const ownedAddons = caps?.addons ?? [];

  // Filter catalog to add-ons relevant for this tier
  const relevantAddons = getAddonsForTier(tier);

  const handlePurchase = useCallback(
    (addon: AddonDefinition) => {
      // Open Paddle checkout for the addon price ID.
      // In production, the email should come from the session/account.
      // For now, open the Paddle checkout URL directly.
      if (isPlaceholderPriceId(addon.paddlePriceId)) {
        // Placeholder — not yet configured in Paddle
        console.warn(`Addon ${addon.id} Paddle price not configured yet`);
        return;
      }
      // The actual Paddle checkout will be handled by the website's
      // paddle.ts openPaddleCheckout helper. For the POS app, we
      // open the pricing page with the addon anchor.
      //
      // Absolute, and through `openExternalUrl`: a relative path resolves
      // against the app's own `https://tauri.localhost` origin (a 404), and
      // `window.open` is discarded by the Android WebView. The locale prefix
      // and the fragment's missing target are documented on
      // `addonPricingUrl` above.
      void openExternalUrl(addonPricingUrl(locale, addon.id));
    },
    [locale],
  );

  if (relevantAddons.length === 0) {
    return (
      <div className="addons-marketplace addons-marketplace--empty">
        <p className="addons-marketplace-empty">
          <Localized id="addon-marketplace-empty">
            <span>No add-ons available for your current plan.</span>
          </Localized>
        </p>
      </div>
    );
  }

  return (
    <div className="addons-marketplace">
      <div className="addons-marketplace-header">
        <h2 className="addons-marketplace-title">
          <Localized id="addon-marketplace-title">
            <span>Add-ons</span>
          </Localized>
        </h2>
        <p className="addons-marketplace-subtitle">
          <Localized id="addon-marketplace-subtitle">
            <span>Extend your plan with additional features</span>
          </Localized>
        </p>
      </div>
      <div className="addons-marketplace-grid">
        {relevantAddons.map((addon) => (
          <AddonCard
            key={addon.id}
            addon={addon}
            owned={tenantHasAddon(ownedAddons, addon.id)}
            onPurchase={handlePurchase}
          />
        ))}
      </div>
    </div>
  );
}
