// ── Tier badge artwork for the locked home-tool cards ─────────────────
//
// The five subscription-tier badges are GENERATED artwork, not hand-drawn
// icons: `scripts/generate-tier-badges.ps1` emits
// `assets/tier-badges/svg/tier-<key>.svg` together with the `manifest.json`
// that describes each one.
//
// They are deliberately NOT copied into `ui/`. `assets/tier-badges/` is that
// generator's output directory and therefore the single source of truth, so a
// re-run with a new palette cannot leave a stale duplicate behind — the failure
// `assets/branding/README.md` states as its one rule. The `@tier-badges/` alias
// (`vite.config.ts` / `vite.mobile.config.ts`) is what reaches them, exactly as
// `@/locales/` reaches `shared-ui/locales/`.
//
// Widths are the badges' own intrinsic sizes, read from that manifest. The
// artwork is a rounded rectangle whose width grows with the length of the tier
// name — 78px for PRO, 162px for ENTERPRISE — so there is no single aspect
// ratio to hardcode. Rendering at each badge's own ratio is what keeps the
// letterforms undistorted; the CSS then scales the whole badge by height alone.
//
// Measured 2026-10-03 against assets/tier-badges/manifest.json (generated
// 2026-09-24 by `scripts/generate-tier-badges.ps1`).

import type { TierKey } from './tierLevel';

import freeSrc from '@tier-badges/tier-free.svg';
import plusSrc from '@tier-badges/tier-plus.svg';
import proSrc from '@tier-badges/tier-pro.svg';
import premiumSrc from '@tier-badges/tier-premium.svg';
import enterpriseSrc from '@tier-badges/tier-enterprise.svg';

export interface TierBadgeArt {
  /** Resolved URL for the badge SVG. A hashed asset path or an inlined data
   *  URI, depending on Vite's inline threshold — both are self-contained
   *  inside the bundle, which is what an offline-first POS needs. */
  src: string;
  /** Intrinsic width in px, from the generator's manifest. */
  width: number;
  /** Intrinsic height in px — 40 for every tier. */
  height: number;
}

/** Badge artwork per tier. Total over `TierKey`, so adding a tier to
 *  `TIER_LEVEL` cannot compile without deciding what its badge looks like. */
export const TIER_BADGE: Record<TierKey, TierBadgeArt> = {
  free: { src: freeSrc, width: 86, height: 40 },
  plus: { src: plusSrc, width: 90, height: 40 },
  pro: { src: proSrc, width: 78, height: 40 },
  premium: { src: premiumSrc, width: 134, height: 40 },
  enterprise: { src: enterpriseSrc, width: 162, height: 40 },
};
