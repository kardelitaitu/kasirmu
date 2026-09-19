import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import id from '../i18n/id.json';
import { pricingFor } from '../content/pricing';
import type { PricingTier } from '../content/pricing/types';
import {
  LANDING_BY_SLUG,
  LLMS_LOCALE,
  LLMS_PAGE_SLUGS,
  PAGE_LABELS,
  VERTICAL_BY_SLUG,
} from '../lib/llms-pages';

export const prerender = true;

type Faq = { q: string; a: string };

type IdJson = {
  meta: { description: string };
  support: { faq: Faq[] };
  pageDesc: Record<string, string>;
  landing: Record<'gratis' | 'murah' | 'qris' | 'android', { title: string; description: string }>;
  vertical: Record<string, { label: string; tagline: string }>;
};

const SITE = 'https://kasir.mu';

function faqBlock(faq: Faq[]): string {
  return faq.map((f) => `- ${f.q}\n  ${f.a}`).join('\n');
}

/** `kasir-gratis` → `Kasir Gratis`. Fallback so an unlabelled page still reads. */
function humanize(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Canonical URL, always with the trailing slash (the 307 target). */
function urlFor(slug: string): string {
  return slug === '' ? `${SITE}/${LLMS_LOCALE}/` : `${SITE}/${LLMS_LOCALE}/${slug}/`;
}

export const GET: APIRoute = async () => {
  const t = id as unknown as IdJson;

  const labelFor = (slug: string): string => {
    const landingKey = LANDING_BY_SLUG[slug];
    if (landingKey) return t.landing[landingKey].title;
    const verticalKey = VERTICAL_BY_SLUG[slug];
    if (verticalKey && t.vertical[verticalKey]) return t.vertical[verticalKey].label;
    // Nested pages are keyed by leaf in i18n (`legal/privacy` → `privacy`).
    const leaf = slug.split('/').pop() ?? slug;
    return PAGE_LABELS[slug] ?? PAGE_LABELS[leaf] ?? humanize(leaf);
  };

  const noteFor = (slug: string): string => {
    const landingKey = LANDING_BY_SLUG[slug];
    if (landingKey) return t.landing[landingKey].description;
    const verticalKey = VERTICAL_BY_SLUG[slug];
    if (verticalKey && t.vertical[verticalKey]) return t.vertical[verticalKey].tagline;
    const leaf = slug.split('/').pop() ?? slug;
    return t.pageDesc[slug] ?? t.pageDesc[leaf] ?? '';
  };

  const pages = LLMS_PAGE_SLUGS.map((slug) => {
    const note = noteFor(slug);
    return `- [${labelFor(slug)}](${urlFor(slug)})${note ? `: ${note}` : ''}`;
  }).join('\n');

  // Docs come from the content collection, so the list cannot drift from the
  // pages that actually exist. Order mirrors the on-site sidebar
  // ([locale]/docs/[...slug].astro): category, then frontmatter `order`.
  const docs = (await getCollection('docs')).filter((d) => d.id.startsWith(`${LLMS_LOCALE}/`));
  const categoryOrder = ['gettingStarted', 'guides', 'reference'] as const;
  const docsList = categoryOrder
    .flatMap((category) =>
      docs.filter((d) => d.data.category === category).sort((a, b) => a.data.order - b.data.order),
    )
    .map((d) => {
      const slug = d.id.slice(LLMS_LOCALE.length + 1);
      const desc = d.data.description ? `: ${d.data.description}` : '';
      return `- [${d.data.title}](${SITE}/${LLMS_LOCALE}/docs/${slug}/)${desc}`;
    })
    .join('\n');

  const tiers = pricingFor('id')
    .map((p: PricingTier) => `- ${p.name}: ${p.prices.monthly.price} ${p.prices.monthly.period} — ${p.description}`)
    .join('\n');

  const body = `# kasir.mu
> ${t.meta.description}
> Juga ditulis kasirmu atau kasir mu.

## Halaman
${pages}

## Harga (IDR)
${tiers}

## Pertanyaan umum
${faqBlock(t.support.faq)}

## Dokumentasi
- [Panduan](${SITE}/${LLMS_LOCALE}/docs/)
${docsList}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
