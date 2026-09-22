import type { FeatureRow, PricingTier } from './types';

// Prices are per locale; this file is the Indonesian pricing (id locale).
//
// Tier lineup follows subscription-tiers.md (FINAL 2026-08-17): Gratis ·
// Plus · Pro ⭐ · Premium · Enterprise, with USD and IDR as independent
// market prices (IDR is the lower local-market rate). Yearly = 2 bulan
// gratis (bayar 10 bulan, dapat 12) and is the DEFAULT selection on the
// pricing page — marketed as "2 bulan gratis", never as a percentage.
//
// Indonesian tier copy uses the APP'S OWN vocabulary, not a fresh translation
// of the English words: "ruang kerja" for workspace (shared.id.ftl
// nav-switch-workspace = "Ganti Ruang Kerja", workspace-home-available =
// "{ $count } ruang kerja tersedia"; docs/id/workspaces.md is titled "Ruang
// Kerja"), "Layar Dapur (KDS)" for the kitchen display (docs/id/stores.md
// names the preset exactly that) and "perangkat keras" for hardware
// (docs/id/terminals.md). Two borrowings stay on purpose: "register" for a
// cashier terminal (docs/id/terminals.md writes "register kasir") and "Memo",
// which is the product's own noun in both languages — shared.id.ftl defines
// memos-title = "Memo" and the Indonesian docs list it under Alat. Naming one
// thing two ways is what made this list hard to read: it said "workspace" and
// "Display Dapur" while the app and the docs said "ruang kerja" and "Layar
// Dapur".
//
// NOTE: Paddle does not support IDR as a billing currency (their supported
// list has no IDR), so today the checkout charges the USD price id and the
// Rp figures on this page are the display price — the checkout shows the
// USD amount. True fixed-Rp billing needs the local provider phase
// (Midtrans — see subscription-tiers.md §2 Payment routing), not Paddle.
// The six real Paddle prices (Plus/Pro/Premium × monthly/yearly) are now
// catalogued from the Paddle dashboard. The IDs are shared by both locales
// (Paddle has no IDR billing currency — the id locale only differs in the
// displayed Rp amount). The bundle option (restaurant_starter) and the Pro
// A/B variant still use placeholder ids until those Paddle prices are
// created — checkout degrades to the mailto fallback for them.
export const pricing: PricingTier[] = [
  {
    id: 'free',
    tierKey: 'free',
    name: 'Gratis',
    currency: 'IDR',
    description: 'Gratis selamanya — jalankan satu lokasi, sepenuhnya offline.',
    cta: 'Unduh',
    prices: {
      monthly: { price: 'Rp 0', period: 'gratis selamanya' },
      yearly: { price: 'Rp 0', period: 'gratis selamanya' },
    },
    features: [
      { label: '1 lokasi', included: true },
      { label: '1 register', included: true },
      { label: '1 ruang kerja gudang', included: true },
      { label: 'Riwayat penjualan 3 bulan', included: true },
      { label: 'QRIS statis + dinamis', included: true },
      { label: 'Sinkron cloud', included: false },
    ],
  },
  {
    id: 'plus',
    tierKey: 'plus',
    name: 'Plus',
    currency: 'IDR',
    description: 'Paket awal untuk lokasi tunggal yang siap berkembang.',
    cta: 'Berlangganan',
    prices: {
      monthly: { price: 'Rp 49.000', period: '/bulan', priceId: 'pro_01m1amcb41qkbr7zzd1kxa3qnd' },
      yearly: { price: 'Rp 500.000', period: '/tahun', priceId: 'pro_01m1amdj2swb3q21r2mwcy3krh' },
    },
    bundle: {
      id: 'restaurant_starter',
      label: 'Paket Restaurant Starter',
      note: 'Hemat 10% dari harga eceran',
      prices: {
        monthly: { price: 'Rp 75.000', period: '/bulan', priceId: 'pri_placeholder_plus_bundle_monthly_usd' },
        yearly: { price: 'Rp 750.000', period: '/tahun', priceId: 'pri_placeholder_plus_bundle_yearly_usd' },
      },
    },
    features: [
      { label: '1 lokasi', included: true },
      { label: '2 register', included: true },
      { label: '2 ruang kerja gudang', included: true },
      { label: 'QRIS statis + dinamis', included: true },
      { label: 'Dasbor Penjualan Harian', included: true },
      { label: 'Sinkron cloud', included: true },
    ],
  },
  {
    id: 'pro',
    tierKey: 'pro',
    name: 'Pro',
    currency: 'IDR',
    description: 'Untuk bisnis berkembang — analitik, Layar Dapur (KDS), dan multi-terminal.',
    cta: 'Berlangganan',
    highlight: true,
    prices: {
      monthly: {
        price: 'Rp 99.000', period: '/bulan',
        priceId: 'pro_01m1amdwp700jp6183k9zjsgaz',
        // C4.1: A/B variant — Rp 79.000 vs Rp 99.000 (controlled by ?ab=pro_price).
        // The variant price is NOT created on Paddle yet — placeholder keeps
        // the variant checkout on the mailto fallback.
        variantPriceId: 'pri_pro_monthly_usd_variant_799',
        variantPrice: 'Rp 79.000',
      },
      yearly: { price: 'Rp 1.000.000', period: '/tahun', priceId: 'pro_01m1ame8ckw8vzjnf8y4q15mww' },
    },
    features: [
      { label: '2 lokasi', included: true },
      { label: '5 register per lokasi', included: true },
      { label: '2 Layar Dapur (KDS)', included: true },
      { label: 'Laporan & analitik', included: true },
      { label: 'Memo', included: true },
      { label: 'Kartu debit & kredit (Stripe)', included: true },
      { label: 'Sinkron cloud', included: true },
    ],
  },
  {
    id: 'premium',
    tierKey: 'premium',
    name: 'Premium',
    currency: 'IDR',
    description: 'Untuk jaringan multi-lokasi — whitelabel, loyalitas, dan otomatisasi.',
    cta: 'Berlangganan',
    prices: {
      monthly: { price: 'Rp 399.000', period: '/bulan', priceId: 'pro_01m1amema8yj6w5mfm8wx8jwhm' },
      yearly: { price: 'Rp 3.999.000', period: '/tahun', priceId: 'pro_01m1amf0vpbyfndg5rkvxvyqj4' },
    },
    features: [
      { label: '5 lokasi', included: true },
      { label: 'Register tanpa batas', included: true },
      { label: 'Branding whitelabel', included: true },
      { label: 'Program loyalitas', included: true },
      { label: 'Skrip Lua', included: true },
      { label: 'Dukungan prioritas (1 jam)', included: true },
    ],
  },
  {
    id: 'enterprise',
    tierKey: 'enterprise',
    name: 'Enterprise',
    currency: 'IDR',
    description: 'Perangkat keras khusus, SLA kustom, dan account manager khusus.',
    cta: 'Hubungi kami',
    prices: {
      monthly: { price: 'Kustom', period: '' },
      yearly: { price: 'Kustom', period: '' },
    },
    features: [
      { label: 'Lokasi tanpa batas', included: true },
      { label: 'Register tanpa batas', included: true },
      { label: 'Branding whitelabel', included: true },
      { label: 'Driver perangkat keras khusus (HAL)', included: true },
      { label: 'Account manager khusus', included: true },
      { label: 'SLA dukungan khusus', included: true },
    ],
  },
];

// Mirrors the quota & feature matrix in subscription-tiers.md §3.
export const featureRows: FeatureRow[] = [
  { label: 'Lokasi', values: { free: 1, plus: 1, pro: 2, premium: 5, enterprise: 'Tanpa batas' } },
  { label: 'Terminal (register) per lokasi', values: { free: 1, plus: 2, pro: 5, premium: 'Tanpa batas', enterprise: 'Tanpa batas' } },
  { label: 'Ruang kerja gudang', values: { free: 1, plus: 2, pro: 3, premium: 'Tanpa batas', enterprise: 'Tanpa batas' } },
  { label: 'Layar Dapur (KDS)', values: { free: 0, plus: 0, pro: 2, premium: 'Tanpa batas', enterprise: 'Tanpa batas' } },
  { label: 'Max produk/menu', values: { free: 200, plus: 500, pro: 1000, premium: 10000, enterprise: 'Tanpa batas' } },
  { label: 'Staf pengguna', values: { free: 1, plus: 5, pro: 20, premium: 50, enterprise: 'Tanpa batas' } },
  { label: 'Riwayat penjualan', values: { free: '3 bulan', plus: '1 tahun', pro: '5 tahun', premium: 'Tanpa batas', enterprise: 'Tanpa batas' } },
  { label: 'QRIS statis + dinamis', values: { free: true, plus: true, pro: true, premium: true, enterprise: true } },
  { label: 'Kartu debit & kredit (Stripe)', values: { free: false, plus: false, pro: true, premium: true, enterprise: true } },
  { label: 'Sinkron cloud', values: { free: false, plus: true, pro: true, premium: true, enterprise: true } },
  { label: 'Dasbor Penjualan Harian', values: { free: false, plus: true, pro: true, premium: true, enterprise: true } },
  { label: 'Laporan & analitik', values: { free: false, plus: false, pro: true, premium: true, enterprise: true } },
  { label: 'Memo', values: { free: false, plus: false, pro: true, premium: true, enterprise: true } },
  { label: 'Log audit lengkap', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Retensi log audit', values: { free: 'Tidak ada', plus: '90 hari', pro: '180 hari', premium: '1 tahun', enterprise: '3 tahun' } },
  { label: 'Branding whitelabel', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Email laporan terjadwal', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Program loyalitas', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Skrip Lua', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Dukungan prioritas', values: { free: false, plus: false, pro: false, premium: true, enterprise: true } },
  { label: 'Masa tenggang offline', values: { free: '7 hari', plus: '14 hari', pro: '14 hari', premium: '30 hari', enterprise: '60 hari' } },
];
