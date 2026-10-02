---
title: Pembayaran & QRIS
description: Terima tunai dan QRIS di semua paket — QR statis dan QR dinamis, tanpa perangkat tambahan.
category: guides
order: 1
updated: "2026-10-01"
---

## Metode pembayaran

- **Tunai** — tersedia hari ini. Masukkan jumlah yang dibayarkan dan
  kembalian dihitung otomatis.
- **Kartu** — tersedia hari ini. Catat pembayaran kartu debit atau kredit
  secara manual, atau — bila terminal kartu (EDC) dikonfigurasi untuk
  lokasi — kirim total ke terminal yang tersambung dan biarkan pelanggan
  menempel atau memasukkan kartu di sana. Tombol terminal hanya muncul bila
  daftar rail situs menawarkannya; tanpanya, input kartu manual tetap
  berfungsi.
- **QRIS** — tersedia di semua paket, termasuk Gratis. Dua cara pakai:
  - **QR dinamis** — kasir menampilkan kode QR dengan nominal transaksi
    (via Midtrans), pelanggan pindai, status settlement dipolling otomatis
    dan dicocokkan kembali ke transaksi.
  - **QR statis (manual)** — tampilkan stiker QR toko Anda sendiri
    (payload NMID tersimpan); kasir mencatat referensi yang ditegaskan
    kasir dan merekonsiliasi dari server untuk struk.
- **Kredit** — tersedia hari ini. **Penjualan Kredit** tidak mengambil
  pembayaran di konter: transaksi dicatat atas nama pelanggan (wajib) dan
  muncul di daftar kredit dengan pengingat serta saldo yang masih
  terutang.
- **E-wallet** — segera hadir: kasir belum memiliki tender e-wallet.

QRIS menyelesaikan secara asinkron — transaksi dicatat segera dan
direkonsiliasi saat gateway merespons, sehingga timeout gateway tidak
pernah memblokir kasir. Modal pembayaran juga mendukung **pembayaran
terbagi** (bayar satu keranjang lintas beberapa metode) dan pembayaran
**multi-mata uang**.

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
