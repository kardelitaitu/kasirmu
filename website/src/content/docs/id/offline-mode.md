---
title: Mode Offline-First
description: Bagaimana kasir.mu tetap berjalan tanpa koneksi sama sekali.
category: guides
order: 1
updated: "2026-08-16"
---

## Cara kerjanya

<svg class="docs-flow" role="img" aria-label="Alur offline: transaksi ditulis ke database lokal lebih dulu; saat online tersinkron ke cloud, saat offline menunggu di antrean dan mengalir ke cloud saat koneksi kembali; semua register lalu diperbarui." viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)"/>
    </marker>
  </defs>
  <rect x="8" y="32" width="130" height="56" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="73" y="54" text-anchor="middle" font-size="13" fill="var(--color-ink)"><tspan x="73" dy="0">Transaksi</tspan><tspan x="73" dy="15">atau perubahan</tspan></text>
  <line x1="138" y1="60" x2="160" y2="60" stroke="var(--color-accent)" stroke-width="1.5" marker-end="url(#flow-arrow)"/>
  <rect x="160" y="32" width="145" height="56" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="232.5" y="65" text-anchor="middle" font-size="13" fill="var(--color-ink)">Database lokal dulu</text>
  <line x1="305" y1="60" x2="338" y2="60" stroke="var(--color-accent)" stroke-width="1.5" marker-end="url(#flow-arrow)"/>
  <polygon points="338,60 390,28 442,60 390,92" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="390" y="65" text-anchor="middle" font-size="13" fill="var(--color-ink)">Online?</text>
  <line x1="442" y1="60" x2="492" y2="60" stroke="var(--color-accent)" stroke-width="1.5" marker-end="url(#flow-arrow)"/>
  <text x="467" y="50" text-anchor="middle" font-size="12" fill="var(--color-muted)">ya</text>
  <rect x="492" y="32" width="115" height="56" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="549.5" y="65" text-anchor="middle" font-size="13" fill="var(--color-ink)">Kirim ke cloud</text>
  <line x1="607" y1="60" x2="632" y2="60" stroke="var(--color-accent)" stroke-width="1.5" marker-end="url(#flow-arrow)"/>
  <rect x="632" y="32" width="125" height="56" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="694.5" y="54" text-anchor="middle" font-size="13" fill="var(--color-ink)"><tspan x="694.5" dy="0">Semua register</tspan><tspan x="694.5" dy="15">sinkron</tspan></text>
  <line x1="390" y1="92" x2="390" y2="158" stroke="var(--color-accent)" stroke-width="1.5" marker-end="url(#flow-arrow)"/>
  <text x="398" y="128" font-size="12" fill="var(--color-muted)">tidak</text>
  <rect x="325" y="158" width="130" height="44" rx="8" fill="var(--color-surface)" stroke="var(--color-accent)" stroke-width="1.5"/>
  <text x="390" y="185" text-anchor="middle" font-size="13" fill="var(--color-ink)">Antrean offline</text>
  <line x1="455" y1="180" x2="530" y2="92" stroke="var(--color-accent)" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#flow-arrow)"/>
  <text x="472" y="142" font-size="12" fill="var(--color-muted)">koneksi kembali</text>
</svg>

Setiap perubahan ditulis ke database lokal perangkat lebih dulu. Saat offline
perubahan menunggu dalam antrean; begitu terhubung, antrean mengalir sesuai
urutan dan cloud mengonfirmasi setiap item.

## Tidak ada yang berhenti di kasir

Transaksi, shift, pergerakan stok, dan perubahan pengaturan semuanya ditulis
ke database lokal terlebih dahulu. Koneksi yang hilang tidak pernah
memblokir transaksi.

## Antrean offline

Setiap perubahan — transaksi, event shift, pergerakan stok, pembaruan
pengaturan — ditambahkan ke antrean keluar. Saat koneksi kembali, antrean
mengalir sesuai urutan dan server mengonfirmasi setiap item. Setiap item
dilacak sebagai pending, synced, atau failed, sehingga tidak ada yang hilang
secara diam-diam.

## Memeriksa antrean

Layar Antrean Offline (manajer) menampilkan berapa item yang tertunda,
tersinkron, dan gagal, plus konflik apa pun, sinkron terakhir yang berhasil,
dan berapa lama item tertua yang tertunda. Gunakan **Sinkron Semua** untuk
mengalirkan segera, tarik untuk menyegarkan, atau hapus item yang macet.
Item dari server yang berulang kali gagal diterapkan dikarantina dan dapat
diantrekan ulang setelah penyebabnya diperbaiki.

## Konflik

Karena setiap register bekerja dengan data lokalnya sendiri dan penggabungan
berbasis urutan, konflik jarang terjadi dan terselesaikan secara
deterministik — perubahan terbaru yang menang untuk setiap catatan. Konflik
yang terselesaikan muncul sebagai jumlah di layar antrean, agar Anda tahu itu
telah terjadi.

## Sinkron cloud dan paket

Sinkron cloud memindahkan antrean antar register dan merupakan bagian dari
paket berbayar. Pada paket tanpa sinkron, antrean offline tetap bekerja
persis sama — transaksi aman secara lokal dan mengalir begitu Anda
meningkatkan paket. Lihat [Sinkron Cloud](../cloud-sync/) untuk apa saja yang
tersinkron dan cara memeriksa statusnya.
