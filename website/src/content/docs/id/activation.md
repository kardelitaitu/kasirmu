---
title: Aktivasi Lisensi
description: Dapatkan kunci lisensi, aktifkan di aplikasi, dan kelola perangkat Anda.
category: gettingStarted
order: 4
updated: "2026-08-30"
---

## Dapatkan kunci lisensi

Paket berbayar dibeli di situs web: buka [halaman harga](../../pricing/),
pilih paket, lalu bayar lewat checkout Paddle. Pembayaran bersifat
register-first — checkout meminta Anda masuk dengan email (kode sekali pakai
atau kata sandi), sehingga langganan terhubung ke akun Anda. Kunci lisensi
dan tanda terima dikirim otomatis ke email Anda.

Paket Gratis tidak memerlukan kunci; dimulai saat peluncuran pertama.
Aktivasi untuk berpindah ke paket berbayar.

## Masukkan kunci di aplikasi

Buka Pengaturan → Lisensi, tempel kunci lisensi Anda (contoh
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
