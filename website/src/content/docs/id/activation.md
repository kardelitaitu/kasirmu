---
title: Aktivasi Lisensi
description: Dapatkan kunci lisensi, aktifkan di aplikasi, dan kelola perangkat Anda.
category: gettingStarted
order: 4
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · First audit stamp on this page; it is the Indonesian translation of en/activation.md, audited the same day. Every technical anchor re-verified against the code, not against the en twin: the key placeholder `OZ-PRO-ABCD-EFGH` matches the app's own `auth-license-placeholder = OZ-PRO-XXXX-XXXX-XXXX` (shared-ui/locales/shared.ftl:517, mirrored in shared.id.ftl:475) — the Indonesian page shows a four-group shape, which is the same shape; the six-digit recovery code is real (apps/license-server/activate.go:56 documents `RecoveryCode` as "the 6-digit code emailed to the tenant", main.go:332, and license_recover_test.go:121 asserts it); the 24-hour rotation throttle is exact — `window: 24 * time.Hour` at apps/license-server/activate.go:73 with the cooldown comment at :66-70; the offline grace-then-degrade path is real at crates/kasirmu-core/src/availability.rs ("Grace-aware effective tier" :266, "Grace-window end" :341). · THE TWO ROUTE-ONLY LINKS are correct as written: `../../pricing/`, `../../login/` and `../../support/` are Astro ROUTES, not content slugs — they resolve in the site route table, and check-site-links.py confirms all 46 content docs link only to routes that exist. · NOT re-measured: a live activation handshake against the license server, and the actual delivery of the recovery-code email. · The footer below is an internal marker; website/src/plugins/rehype-strip-audit-footer.mjs strips it from the built site, so it never reaches a reader. -->

## Dapatkan kunci lisensi

Paket berbayar dibeli di situs web: buka [halaman harga](../../pricing/),
pilih paket, lalu bayar lewat checkout Paddle. Pembayaran bersifat
register-first — checkout meminta Anda masuk dengan email (kode sekali pakai
atau kata sandi), sehingga langganan terhubung ke akun Anda. Kunci lisensi
dan tanda terima dikirim otomatis ke email Anda.

Paket Gratis tidak memerlukan kunci; dimulai saat peluncuran pertama.
Aktivasi untuk berpindah ke paket berbayar.

## Masukkan kunci di aplikasi

Buka Pengaturan → Lisensi & Langganan, tempel kunci lisensi Anda (contoh
`OZ-PRO-ABCD-EFGH`), lalu aktifkan. Kunci diverifikasi terhadap server
lisensi dan langganan bertanda tangan disimpan di perangkat.

## Pengikatan perangkat

Aktivasi mengikat lisensi ke perangkat keras. Kunci yang sama dapat
diaktifkan di register sebanyak yang diizinkan paket Anda, dan admin tenant
dapat mencabut perangkat dari jarak jauh.

## Instal ulang atau pemulihan lisensi

Pindah ke register baru, atau instal ulang setelah disk direset? Masukkan
email dan kunci lisensi yang sama — aplikasi akan mengaktifkan ulang,
mengembalikan langganan Anda yang sudah ada, dan POS tetap berfungsi.
Paket, perangkat, dan data Anda tidak terpengaruh.

Aplikasi juga menyimpan **kunci manajemen lisensi** di latar belakang. Kunci
inilah yang memungkinkan aplikasi memperpanjang langganan dan memeriksa
status lisensi, dan terpisah dari kunci lisensi yang Anda ketik. Jika
instalasi baru tidak memilikinya (disk direset, register baru), aplikasi
akan meminta Anda **memulihkannya**:

1. Di aplikasi, pilih **Pulihkan lisensi** (atau coba perpanjang — aplikasi
   akan memandu Anda).
2. kasir.mu mengirim **kode pemulihan 6 digit** ke alamat email akun Anda.
3. Masukkan kode tersebut di aplikasi. Kunci manajemen Anda dipulihkan dan
   kunci lama berhenti bekerja.

Dua pengaman melindungi Anda di sini:

- Kunci manajemen hanya dirotasi **maksimal sekali per 24 jam**. Jika ada
  yang meminta lagi sebelumnya, permintaan ditolak — coba lagi nanti atau
  hubungi dukungan.
- **Setiap rotasi mengirimkan pemberitahuan email.** Jika Anda menerima
  pemberitahuan rotasi atau kode pemulihan yang tidak Anda minta, ada yang
  mungkin mencoba menggunakan kunci lisensi Anda: masuk di
  [halaman login](../../login/), tinjau dan cabut perangkat yang tidak
  dikenal di akun Anda, dan [hubungi dukungan](../../support/).

## Akun Anda di situs web

Masuk di [halaman login](../../login/) situs web dengan email dan kode
sekali pakai atau kata sandi Anda. Halaman akun menampilkan kunci lisensi,
paket, dan tanggal kedaluwarsa, dan merupakan tempat Anda mengelola
perangkat.

## Offline dan masa tenggang

Setelah aktif, payload bertanda tangan menjaga aplikasi tetap berfungsi
offline hingga tanggal kedaluwarsa ditambah masa tenggang, lalu menurun ke
paket gratis. Lihat [Lisensi & Paket](../licensing/).

---

Lanjut membaca · **Sebelumnya:** [Wizard Pengaturan](../setup-wizard/) · **Berikutnya:** [Transaksi Pertama Anda](../first-sale/)

> last audited 11-10-26 by docs-auditor
