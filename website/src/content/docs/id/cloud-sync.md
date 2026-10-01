---
title: Sinkron Cloud
description: Sinkron lintas lokasi dan register melalui cloud.
category: guides
order: 8
updated: "2026-10-01"
---

## Cara kerja sinkron

<svg class="docs-flow" role="img" aria-label="Alur sinkron: setiap register menyimpan salinan lokal dan mengirim serta menarik perubahan melalui server cloud bersama." viewBox="0 0 760 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)"/>
    </marker>
  </defs>
  <rect x="20" y="70" width="150" height="60" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="95" y="92" text-anchor="middle" font-size="13" fill="var(--color-ink)"><tspan x="95" dy="0">Register 1</tspan><tspan x="95" dy="15">salinan lokal</tspan></text>
  <line x1="170" y1="100" x2="305" y2="100" stroke="var(--color-accent)" stroke-width="1.5" marker-start="url(#flow-arrow)" marker-end="url(#flow-arrow)"/>
  <text x="237.5" y="88" text-anchor="middle" font-size="12" fill="var(--color-muted)">kirim &amp; tarik</text>
  <rect x="305" y="70" width="150" height="60" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="380" y="102" text-anchor="middle" font-size="13" fill="var(--color-ink)">Cloud</text>
  <line x1="455" y1="100" x2="590" y2="100" stroke="var(--color-accent)" stroke-width="1.5" marker-start="url(#flow-arrow)" marker-end="url(#flow-arrow)"/>
  <text x="522.5" y="88" text-anchor="middle" font-size="12" fill="var(--color-muted)">kirim &amp; tarik</text>
  <rect x="590" y="70" width="150" height="60" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="665" y="92" text-anchor="middle" font-size="13" fill="var(--color-ink)"><tspan x="665" dy="0">Register 2</tspan><tspan x="665" dy="15">salinan lokal</tspan></text>
</svg>

Setiap perangkat menyimpan salinan lokal dari semua yang dibutuhkannya.
Perubahan dikirim ke server cloud dan ditarik oleh semua perangkat lain,
sehingga semua register melihat produk, harga, dan stok yang sama.

## Status sinkron

Layar status menampilkan kedalaman antrean, sinkron terakhir yang berhasil,
dan item yang tertunda. Antrean yang sehat mengalir dalam hitungan detik
setelah terhubung kembali.

## Yang tersinkron

Transaksi, pergerakan stok, shift, staf, produk, dan perubahan topologi semua
tersinkron. Tenant diisolasi per akun, sehingga data tidak pernah tercampur
antar usaha.
