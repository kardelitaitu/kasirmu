// ── Upgrade CTA helpers (C2.2 in-app upgrade triggers) ───────────────

import { WEBSITE_ORIGIN, openExternalUrl } from '@/api/browser';

/**
 * Pricing-page anchor for each tier's upgrade target. The in-app gates
 * deep-link to the matching card on the website pricing page.
 */
export type UpgradeTarget = 'plus' | 'pro' | 'premium';

/** Website pricing URL for the given locale + tier anchor. */
export function upgradePricingUrl(locale: string, target: UpgradeTarget): string {
  return `${WEBSITE_ORIGIN}/${locale}/pricing/#${target}`;
}

/**
 * Open the pricing page for an upgrade target in the OS browser.
 *
 * Routes through `openExternalUrl`, not `window.open` — see the note there.
 * These CTAs sit on the tablet's payment panel (`QrisTenderPanel`), where
 * `window.open` is silently discarded by the WebView.
 */
export function openUpgradePricing(locale: string, target: UpgradeTarget): void {
  void openExternalUrl(upgradePricingUrl(locale, target));
}
