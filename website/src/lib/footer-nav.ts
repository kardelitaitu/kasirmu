/**
 * The footer sitemap as data: four columns, each a heading key plus its links.
 *
 * Data rather than markup because two consumers need the same list and cannot
 * read each other's copy: `Footer.astro` renders it, and the tests assert over
 * it (every slug has a page, every label key exists in both dictionaries).
 * Before this module both were hand-kept lists — the markup carried the slugs
 * and the labels, and the tests re-typed all sixteen slugs — so a column added
 * to one and not the other drifted silently.
 *
 * `label` is an i18n key, never copy. That is the fix for the bug this file
 * exists to make impossible: the footer's link text used to be hard-coded
 * Indonesian ("Fitur", "Harga", "Unduh", "Warung", …) with no locale
 * conditional at all, so every English page shipped an Indonesian sitemap
 * under English column headings. A key cannot do that — `t()` resolves against
 * the page's locale, so an untranslated label is a missing key the i18n audit
 * fails on rather than a language the reader cannot parse.
 *
 * Keys are REUSED wherever the site already names the destination: the five
 * primary links resolve through `nav.*` (the header's own labels), so the two
 * navigations cannot call the same page different things — they did, and the
 * footer said "Docs"/"Support" while the header said "Dokumentasi"/"Dukungan"
 * on the same Indonesian page. The five business-vertical links likewise reuse
 * `vertical.<key>.label` from the vertical landings. Only destinations no other
 * navigation links to need a `footer.link.*` key of their own.
 *
 * One consequence worth knowing: keys reached through `link.label` are
 * invisible to `scripts/audit-i18n.mjs`, which collects literals inside `t(…)`
 * calls — so the shared dictionary keys appear in its informational UNUSED list
 * with the other dynamic-key false positives. The guard for this module is
 * `src/components/__tests__/footer-links.test.ts` (every label resolves in both
 * locales) and the `locale copy` check in `scripts/check-seo.mjs` (the rendered
 * footer matches the page's locale).
 *
 * Consumed by: src/components/Footer.astro (render), and
 * src/components/__tests__/footer-links.test.ts (structure + i18n + targets).
 */

/** One footer link: the `[locale]` route slug and its label's i18n key. */
export interface FooterLink {
  /** Route slug handed to `getRelativeLocaleUrl`, e.g. `legal/privacy` is not used here. */
  slug: string;
  /** i18n key for the link text — resolved with the page's locale by the renderer. */
  label: string;
}

/** One sitemap column: its heading's i18n key and the links below it. */
export interface FooterColumn {
  /** i18n key for the column heading. */
  heading: string;
  links: FooterLink[];
}

/**
 * Left-to-right column order in the footer. Reading order is deliberate:
 * product first (what the visitor came for), then the two cross-cutting
 * groupings, then help.
 */
export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: 'footer.col.product',
    links: [
      { slug: 'features', label: 'nav.features' },
      { slug: 'pricing', label: 'nav.pricing' },
      { slug: 'download', label: 'nav.download' },
    ],
  },
  {
    heading: 'footer.col.solutions',
    links: [
      { slug: 'kasir-gratis', label: 'footer.link.kasirGratis' },
      { slug: 'kasir-murah', label: 'footer.link.kasirMurah' },
      { slug: 'kasir-qris', label: 'footer.link.kasirQris' },
      { slug: 'aplikasi-kasir-android', label: 'footer.link.kasirAndroid' },
    ],
  },
  {
    heading: 'footer.col.business',
    links: [
      { slug: 'warung', label: 'vertical.warung.label' },
      { slug: 'cafe', label: 'vertical.kafe.label' },
      { slug: 'restaurant', label: 'vertical.restoran.label' },
      { slug: 'minimarket', label: 'vertical.minimarket.label' },
      { slug: 'warehouse', label: 'vertical.warehouse.label' },
    ],
  },
  {
    heading: 'footer.col.help',
    links: [
      { slug: 'docs', label: 'nav.docs' },
      { slug: 'support', label: 'nav.support' },
      { slug: 'cara', label: 'footer.link.cara' },
      { slug: 'perbandingan', label: 'footer.link.perbandingan' },
    ],
  },
];

/** Flat view of the same list, in the order the footer renders it. */
export const FOOTER_LINKS: FooterLink[] = FOOTER_COLUMNS.flatMap((column) => column.links);
