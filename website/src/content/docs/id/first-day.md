---
title: Hari Pertama Beroperasi
description: Daftar periksa go-live — perangkat terverifikasi, shift dibuka, staf menerima konter.
category: gettingStarted
order: 8
updated: "2026-09-30"
---

Semua halaman sebelumnya masih latihan. Ini periksaan terakhir sebelum
pelanggan sungguhan berdiri di konter Anda. Kebanyakan masing-masing hanya
butuh satu menit.

## Daftar periksa

- [ ] Perangkat keras terikat dan merespons — printer, laci kas, pemindai.
      Lihat di bawah.
- [ ] Pembayaran terverifikasi — satu potongan QRIS sungguhan (atau uang
      masuk, uang keluar).
- [ ] Shift dibuka dengan float yang benar.
- [ ] Staf dibuat, PIN diketahui, ruang kerja ditugaskan.
- [ ] Uji coba offline sudah dilakukan sekali, agar tidak panik nanti.

## Verifikasi perangkat keras

1. Daftarkan perangkat sebagai terminal dari **bagian Tools** navigasi
   utama — peran manajer diperlukan: [Terminal](../terminals/).
2. **Printer struk** — dari pengaturan POS Restoran, layar struk memilki
   tombol **uji cetak**. Perhatikan: ujinya memakai pengaturan yang *terakhir
   disimpan*, jadi simpan draf tata letak Anda dulu atau uji memakai tata
   lama. Tata cetak ritel dikonfigurasi per ruang kerja di Pengaturan.
3. **Laci kas** — terbuka saat pratinjau struk tunai; pastikan laci
   meletup saat pembayaran tunai.
4. **Pemindai barcode** — pemindai terdeteksi sebagai input HID: pindai
   salah satu produk uji ke kolom SKU kasir.

## Verifikasi satu pembayaran

Ambil satu potongan sungguhan sebelum buka: tunai sederhana — terima
pembayaran, cetak struk, dan pastikan hitungan kembalian cocok. QRIS
menampilkan kode QR dinamis untuk pelanggan (atau QR statis toko Anda);
pastikan potongan itu muncul di riwayat aplikasi. Kartu dan e-wallet masih
dalam pengembangan. Lihat [Pembayaran](../payments/).

## Buka hari dengan benar

Kasir membuka shift dari layar **Shift** sebelum melayani. Dialog
**Buka Shift** menerima **saldo awal** yang opsional — float di dalam laci
(misalnya `100.000`) agar penutupan bisa direkonsiliasi terhadapnya. Hanya
penjualan kasir itu yang dihitung di shift mereka. Lihat
[Shift & Rekonsiliasi](../shifts/).

## Serahkan konter

Buat setiap staf dari kartu **Manajemen Staf** di grid Tools pemilih ruang
kerja: nama, login, PIN, dan ruang kerja yang boleh dibuka — staf kasir
biasanya mendapat POS Ritel atau POS Restoran, dan dapur Layar Dapur. Kartu
yang tidak bisa dibuka hanya tampil tidak aktif. Lihat
[Peran Pengguna](../user-roles/) dan [Ruang Kerja](../workspaces/).

## Uji coba satu kali offline

Cabut kabel internet (atau matikan Wi-Fi) dan hitung satu transaksi.
Harusnya selesai seperti biasa, masuk antrean lokal, dan tersinkron saat
koneksi kembali. Sekali dengan Anda di depan layar itu berlimat lipat
nilainya dibanding esei-dokumentasi — [Mode Offline](../offline-mode/)
menjelaskan apa yang ditampilkan antrean.

> last audited 30-09-26 by docs-auditor
