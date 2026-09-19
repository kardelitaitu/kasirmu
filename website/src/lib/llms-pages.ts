/**
 * Public marketing pages advertised in `/llms.txt`, in reading order.
 *
 * Data rather than a filesystem walk, deliberately. A Vite glob import would
 * enumerate these automatically — and an earlier revision of this file did
 * exactly that — but `scripts/verify-website-assets.py` treats ANY dynamic
 * resolver under `website/src` as grounds to disable its asset-orphan rule for
 * the entire tree (see its "KNOWN LIMIT" docstring: the rule is only safe to
 * enforce "while the reference style is provably static"). A glob here would
 * therefore silently switch off a gate that is currently active.
 *
 * The detector's regex is line-based and does NOT strip comments, so the glob
 * call must not appear literally in this file — not even in prose like this.
 * Describing it in words is enough.
 *
 * The rot guard lives in `src/__tests__/llms-txt-coverage.test.ts` instead: it
 * fails if this list and the pages on disk disagree, in either direction. That
 * is a louder guard than the glob was, and it costs no gate.
 *
 * Docs pages are NOT listed here — `llms.txt.ts` derives those from the `docs`
 * content collection, which cannot rot.
 */

/** Locale this list describes. */
export const LLMS_LOCALE = 'id';

/**
 * Pages that exist on disk but must not be advertised. Kept identical to the
 * sitemap's own exclusion list in `astro.config.mjs`, so the two surfaces
 * describe the same public site.
 */
export const NON_PUBLIC_PAGES = ['account', 'login', 'enterprise-trial'];

/** Ordered slugs. `''` is the locale home (`src/pages/[locale]/index.astro`). */
export const LLMS_PAGE_SLUGS = [
  '',
  'features',
  'pricing',
  'download',
  'support',
  'cara',
  'perbandingan',
  'warung',
  'cafe',
  'restaurant',
  'minimarket',
  'warehouse',
  'kasir-gratis',
  'kasir-murah',
  'kasir-qris',
  'aplikasi-kasir-android',
  'signup',
  'legal/privacy',
  'legal/terms',
];

/**
 * Short labels for the pages that are not verticals or landings. A slug with no
 * entry falls back to a humanized leaf, so a newly added page still reads
 * sensibly instead of rendering an empty link.
 */
export const PAGE_LABELS: Record<string, string> = {
  '': 'Beranda',
  features: 'Fitur',
  pricing: 'Harga',
  download: 'Unduh',
  support: 'Dukungan',
  cara: 'Cara Pakai',
  perbandingan: 'Perbandingan',
  signup: 'Daftar',
  'legal/privacy': 'Kebijakan Privasi',
  'legal/terms': 'Syarat & Ketentuan',
};

/** Vertical page slug → key in `id.json.vertical`. The two do not always match. */
export const VERTICAL_BY_SLUG: Record<string, string> = {
  cafe: 'kafe',
  restaurant: 'restoran',
  warung: 'warung',
  minimarket: 'minimarket',
  warehouse: 'warehouse',
};

/** Landing page slug → key in `id.json.landing`. */
export const LANDING_BY_SLUG: Record<string, 'gratis' | 'murah' | 'qris' | 'android'> = {
  'kasir-gratis': 'gratis',
  'kasir-murah': 'murah',
  'kasir-qris': 'qris',
  'aplikasi-kasir-android': 'android',
};
