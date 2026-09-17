---
title: Pembayaran & QRIS
description: Terima tunai dan QRIS di semua paket — QR statis dan QR dinamis, tanpa perangkat tambahan.
category: guides
order: 3
updated: "2026-09-17"
---

## Metode pembayaran

- **Tunai** — tersedia hari ini. Masukkan jumlah yang dibayarkan dan
  kembalian dihitung otomatis.
- **Debit** — segera hadir.
- **Kredit** — segera hadir.
- **QRIS** — tersedia di semua paket, termasuk Gratis. Dua cara pakai:
  - **QR dinamis** — kasir menampilkan kode QR dengan nominal transaksi
    (via Midtrans), pelanggan pindai, status settlement dipolling otomatis
    dan dicocokkan kembali ke transaksi.
  - **QR statis (manual)** — tampilkan stiker QR toko Anda sendiri
    (payload NMID tersimpan); kasir mencatat referensi yang ditegaskan
    kasir dan merekonsiliasi dari server untuk struk.
- **E-wallet** — segera hadir.

Debit, kredit, dan e-wallet mengikuti pola yang sama seperti QRIS: transaksi
dicatat segera dan direkonsiliasi saat gateway merespons, sehingga timeout
gateway tidak pernah memblokir kasir.

## Tagihan terbuka

**Tagihan Terbuka** adalah pilihan di layar pembayaran yang menyimpan
keranjang *tanpa* mengambil pembayaran, atas nama pelanggan — misalnya
`John Doe` atau nomor meja. Tagihan terbuka terdaftar terpisah dari pesanan
yang ditahan, tidak terikat pada shift, dan dapat dilanjutkan serta dibayar
nanti — seperti tab berjalan. Saat tagihan akhirnya dibayar, tagihan tersebut
dihapus dari daftar.

## Tahan pesanan

Kasir dapat menyimpan transaksi berjalan tanpa membayarnya. **Tahan** di panel
keranjang membuka prompt untuk memberi nama pesanan agar mudah ditemukan
nanti, dan transaksi keluar dari layar dengan penghitung yang menunjukkan
berapa banyak pesanan yang ditahan. Lanjutkan pesanan yang ditahan dari
daftar (atau tekan **F4**). Beberapa pesanan dapat ditahan sekaligus, dan
bertahan dari restart serta pembaruan aplikasi.

Menahan berguna di kasir yang sibuk: layani pelanggan, tahan transaksinya,
layani pelanggan berikutnya, lalu lanjutkan saat pelanggan pertama siap
membayar.

## Refund dan pembatalan

Refund memerlukan izin manajer dan menulis pergerakan stok yang berpasangan,
sehingga inventaris dan log audit tetap konsisten.
