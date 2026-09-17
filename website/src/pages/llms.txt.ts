import type { APIRoute } from 'astro';
import id from '../i18n/id.json';
import { pricingFor } from '../content/pricing';
import type { PricingTier } from '../content/pricing/types';

export const prerender = true;

type Faq = { q: string; a: string };

function faqBlock(faq: Faq[]): string {
  return faq.map((f) => `- ${f.q}\n  ${f.a}`).join('\n');
}

export const GET: APIRoute = () => {
  const meta = (id as { meta: { description: string } }).meta.description;
  const support = (id as { support: { faq: Faq[] } }).support.faq;
  const landing = id as unknown as {
    landing: Record<'gratis' | 'murah' | 'android' | 'qris', { title: string; description: string }>;
  };
  const tiers = pricingFor('id')
    .map((t: PricingTier) => `- ${t.name}: ${t.prices.monthly.price} ${t.prices.monthly.period} — ${t.description}`)
    .join('\n');
  const body = `# kasir.mu
> ${meta}
> Juga ditulis kasirmu atau kasir mu.

## Aplikasi
- Beranda: https://kasir.mu/id/
- Fitur: https://kasir.mu/id/features
- Harga: https://kasir.mu/id/pricing
- Unduh: https://kasir.mu/id/download
- Kasir gratis: https://kasir.mu/id/kasir-gratis
- Kasir murah: https://kasir.mu/id/kasir-murah
- Kasir QRIS: https://kasir.mu/id/kasir-qris
- Kasir Android dan tablet: https://kasir.mu/id/aplikasi-kasir-android

## Bisnis
- Warung: https://kasir.mu/id/warung
- Kafe: https://kasir.mu/id/cafe
- Restoran: https://kasir.mu/id/restaurant
- Minimarket: https://kasir.mu/id/minimarket
- Gudang: https://kasir.mu/id/warehouse

## Halaman arahan
- ${landing.landing.gratis.title}: https://kasir.mu/id/kasir-gratis — ${landing.landing.gratis.description}
- ${landing.landing.murah.title}: https://kasir.mu/id/kasir-murah — ${landing.landing.murah.description}
- ${landing.landing.qris.title}: https://kasir.mu/id/kasir-qris — ${landing.landing.qris.description}
- ${landing.landing.android.title}: https://kasir.mu/id/aplikasi-kasir-android — ${landing.landing.android.description}

## Harga (IDR)
${tiers}

## Pertanyaan umum
${faqBlock(support)}

## Dokumentasi
- Panduan: https://kasir.mu/id/docs/
- Mulai: https://kasir.mu/id/docs/welcome
- Instalasi: https://kasir.mu/id/docs/installation
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};
