/**
 * One owner for "what the ⌘K quick search can find".
 *
 * Two sources, deliberately different:
 *
 *  - **Marketing pages** are curated here. Their value is the colloquial query
 *    a customer actually types ("murah", "qris", "offline", "gratis") which no
 *    single page field carries, so the keyword lists are hand-written.
 *  - **Docs** are built from the content collection, handed in by `Header.astro`
 *    at build time. This module never hardcodes a doc.
 *
 * That second rule is the point. This index used to live inside `SearchModal.tsx`
 * as a hand-maintained array that listed 9 of the site's 17 docs — a measured
 * playtest found `settings`, `terminals`, `stores`, `workspaces`, `user-roles`,
 * `licensing`, `offline-mode` and `docs-authoring` unfindable by search, and the
 * entries that *were* there had drifted from their real frontmatter titles
 * ("License & Terminal Activation" vs the page's actual "License Activation").
 * Deriving from the collection makes that class of drift impossible: a new doc
 * is searchable the moment it is written.
 *
 * Matching and ranking are pure functions so the query→expectation behaviour can
 * be tested directly (see `__tests__/search-index.test.ts`).
 */

export interface SearchItem {
  id: string;
  title: string;
  category: 'docs' | 'pages';
  url: string;
  keywords?: string;
}

/** A doc as handed in from the content collection — no localization here. */
export interface SearchDoc {
  slug: string;
  title: string;
  description?: string;
}

/** How many results the modal shows before the user types anything. */
export const INITIAL_RESULTS = 8;

/**
 * Curated synonyms per doc slug. Optional augmentation on top of the doc's own
 * title, slug and description: the symptom words a user searches for that never
 * appear on the page ("insufficient scope", "reconciliation", "float").
 *
 * Keys must be real docs — `search-index.test.ts` reads the corpus and fails on
 * a key with no page, so a deleted doc cannot leave dead keywords behind.
 */
export const DOC_KEYWORDS: Record<string, string> = {
  // gettingStarted
  welcome: 'getting started overview introduction architecture what is',
  installation: 'install install desktop windows linux macos build setup download',
  'first-sale': 'pos checkout sale cash card barcode print receipt ring up',
  activation: 'activate license key register machine offline token devices',
  'user-roles': 'roles permissions staff cashier manager admin supervisor access presets accounts',
  // guides
  'offline-mode': 'offline local first no internet connectivity queue sync later',
  'cloud-sync': 'cloud sync peer to peer local first backup across stores registers',
  payments: 'midtrans paddle qris qr card edc cash payments ewallet',
  shifts: 'shift cash in cash out cash drawer float reconciliation open close audit trail',
  inventory: 'stock items inventory variants low stock alert sku warehouse movement history',
  stores: 'store stores branch branches outlet outlets register registers warehouse topology multi store',
  terminals: 'terminal terminals device devices register configure machine onboarding',
  workspaces: 'workspace workspaces layout screen retail restaurant service kitchen back office modes',
  // reference
  licensing: 'license licensing plan plans tier expiry expired grace period trial billing free forever upgrade',
  settings: 'settings branding receipts receipt currency tax taxes locale local data backup restore',
  'api-read-tiers': 'jwt permissions read tier scoped token insufficient scope audit dashboard api get',
  'docs-authoring': 'docs documentation style guide callouts tables code charts authoring writing',
};

/** The curated marketing pages. Moved verbatim from SearchModal's hardcoded list. */
function pageItems(locale: string): SearchItem[] {
  const id = locale === 'id';
  return [
    { id: 'home', title: id ? 'Beranda' : 'Home', category: 'pages', url: `/${locale}` },
    { id: 'pricing', title: id ? 'Harga & Paket' : 'Pricing & Plans', category: 'pages', url: `/${locale}/pricing`, keywords: 'plans subscription pro plus free enterprise cost gratis murah harga' },
    { id: 'download', title: id ? 'Unduh Aplikasi' : 'Download Application', category: 'pages', url: `/${locale}/download`, keywords: 'windows macos linux android ios tablet pos terminal installer hp gampang mudah gratis ringan' },
    { id: 'features', title: id ? 'Fitur Lengkap' : 'Features & Architecture', category: 'pages', url: `/${locale}/features`, keywords: 'offline kds multi store shifts inventory payments kasir mudah ringan gampang' },
    { id: 'account', title: id ? 'Dashboard Akun & Lisensi' : 'Account & License Dashboard', category: 'pages', url: `/${locale}/account`, keywords: 'profile subscription license terminals' },
    { id: 'support', title: id ? 'Bantuan & Kontak' : 'Support & Contact', category: 'pages', url: `/${locale}/support`, keywords: 'faq contact discord email help' },
    { id: 'cara', title: id ? 'Cara Pakai kasir.mu' : 'How to Use kasir.mu', category: 'pages', url: `/${locale}/cara`, keywords: 'cara pakai install jualan qris stok offline shift how to guide tutorial' },
    { id: 'perbandingan', title: id ? 'Perbandingan kasir.mu vs Lainnya' : 'kasir.mu vs Others Compared', category: 'pages', url: `/${locale}/perbandingan`, keywords: 'perbandingan vs moka majoo olsera qasir pawoon compare alternatif murah' },

    // Vertical solutions
    { id: 'kasir-gratis', title: id ? 'Kasir Gratis Selamanya' : 'Free POS Forever', category: 'pages', url: `/${locale}/kasir-gratis`, keywords: 'kasir gratis free umkm warung murah mudah ringan offline' },
    { id: 'kasir-murah', title: id ? 'Kasir Murah Tanpa Biaya Tersembunyi' : 'Cheap POS With No Hidden Fees', category: 'pages', url: `/${locale}/kasir-murah`, keywords: 'kasir murah harga price cheap affordable plus pro gratis' },
    { id: 'kasir-qris', title: id ? 'Kasir QRIS Statis + Dinamis' : 'Static + Dynamic QRIS POS', category: 'pages', url: `/${locale}/kasir-qris`, keywords: 'kasir qris qr statis dinamis midtrans ewallet dompet digital scan barcode' },
    { id: 'kasir-android', title: id ? 'Kasir Android & Tablet' : 'Android & Tablet POS', category: 'pages', url: `/${locale}/aplikasi-kasir-android`, keywords: 'kasir android tablet hp ringan mudah offline apk' },
    { id: 'cafe', title: id ? 'Solusi untuk Kafe & Kedai Kopi' : 'Solutions for Cafes & Coffee Shops', category: 'pages', url: `/${locale}/cafe`, keywords: 'cafe coffee table orders kds modifiers kasir kafe' },
    { id: 'restaurant', title: id ? 'Solusi untuk Restoran & F&B' : 'Solutions for Restaurants', category: 'pages', url: `/${locale}/restaurant`, keywords: 'restaurant kitchen display split bill service charge kasir restoran' },
    { id: 'minimarket', title: id ? 'Solusi untuk Minimarket & Ritel' : 'Solutions for Minimarkets & Retail', category: 'pages', url: `/${locale}/minimarket`, keywords: 'barcode scanning sku inventory fast retail kasir toko' },
    { id: 'warung', title: id ? 'Solusi untuk Warung & UMKM' : 'Solutions for Warung & Small Business', category: 'pages', url: `/${locale}/warung`, keywords: 'umkm warung simple affordable fast cash qris kasir murah gratis mudah gampang ringan' },
    { id: 'warehouse', title: id ? 'Solusi Manajemen & Sinkronisasi Gudang' : 'Solutions for Warehouse Sync & Stock Management', category: 'pages', url: `/${locale}/warehouse`, keywords: 'warehouse stock inventory 3pl transfer logistics offline' },
  ];
}

/**
 * Turn collection entries into search items. Every field the page carries is
 * searchable — title, slug words and the frontmatter description — so no doc
 * depends on having a curated keyword entry to be findable.
 */
export function docItems(docs: SearchDoc[], locale: string): SearchItem[] {
  return docs.map((doc) => ({
    id: `doc-${doc.slug}`,
    title: doc.title,
    category: 'docs' as const,
    url: `/${locale}/docs/${doc.slug}`,
    keywords: [doc.slug.replace(/-/g, ' '), DOC_KEYWORDS[doc.slug], doc.description ?? '']
      .filter(Boolean)
      .join(' '),
  }));
}

export function buildSearchIndex(locale: string, docs: SearchDoc[]): SearchItem[] {
  return [...pageItems(locale), ...docItems(docs, locale)];
}

/** Split into lowercase word tokens so a query can match at a word boundary. */
function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Relevance of one item for one query, higher is better. Exact and prefix title
 * matches outrank a keyword hit, so searching "settings" surfaces the Settings
 * page above a marketing page that merely lists the word in its keywords.
 */
export function scoreItem(item: SearchItem, query: string): number {
  const q = query.toLowerCase();
  const title = item.title.toLowerCase();
  const url = item.url.toLowerCase();
  const keywords = (item.keywords ?? '').toLowerCase();

  if (title === q) return 100;
  if (title.startsWith(q)) return 90;
  if (words(title).some((w) => w.startsWith(q))) return 80;
  if (title.includes(q)) return 70;
  if (words(url).some((w) => w.startsWith(q))) return 60;
  if (url.includes(q)) return 50;
  if (words(keywords).some((w) => w.startsWith(q))) return 40;
  if (keywords.includes(q)) return 30;
  return 0;
}

/**
 * Filter and rank. Ordering is deterministic: score descending, then the item's
 * original position, so equal-relevance results keep their curated/collection
 * order rather than an arbitrary engine order. An empty query shows the first
 * {@link INITIAL_RESULTS} items, which is what the modal opens with.
 */
export function filterSearch(items: SearchItem[], query: string): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, INITIAL_RESULTS);

  return items
    .map((item, index) => ({ item, index, score: scoreItem(item, q) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
