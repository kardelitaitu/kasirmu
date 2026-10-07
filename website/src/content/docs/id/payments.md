---
title: Pembayaran & QRIS
description: Terima tunai dan QRIS di semua paket — QR statis dan QR dinamis, tanpa perangkat tambahan.
category: guides
order: 1
updated: "2026-10-01"
---
<!-- Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major finding) · Butir QRIS menyatakan "tersedia di semua paket, termasuk Gratis" dan menempatkan QR dinamis lebih dulu. Terverifikasi: hanya QR STATIS yang ada di semua paket; QR DINAMIS memerlukan entitlement Plus (SubscriptionTier::supports_qris(), crates/kasirmu-core/src/subscription/tier.rs:217-222; gate checkout di ui/src/features/sales/PaymentModal.tsx:1909). Butir kini memisahkan keduanya dan menyatakan pembagiannya. · Repaired against branch 0.0.41. -->

## Metode pembayaran

- **Tunai** — tersedia hari ini. Masukkan jumlah yang dibayarkan dan
  kembalian dihitung otomatis.
- **Kartu** — tersedia hari ini. Catat pembayaran kartu debit atau kredit
  secara manual, atau — bila terminal kartu (EDC) dikonfigurasi untuk
  lokasi — kirim total ke terminal yang tersambung dan biarkan pelanggan
  menempel atau memasukkan kartu di sana. Tombol terminal hanya muncul bila
  daftar rail situs menawarkannya; tanpanya, input kartu manual tetap
  berfungsi.
- **QRIS** — dua cara pakai, dan keduanya tidak ada di paket yang sama:
  - **QR statis (manual)** — tersedia di **semua paket, termasuk Gratis**. Tampilkan
    stiker QR toko Anda sendiri (payload NMID tersimpan); kasir mencatat referensi
    yang ditegaskan kasir dan merekonsiliasi dari server untuk struk.
  - **QR dinamis** — **Plus ke atas**. Kasir menampilkan kode QR dengan nominal
    transaksi (via Midtrans), pelanggan pindai, status settlement dipolling otomatis
    dan dicocokkan kembali ke transaksi. Pada paket Gratis kasir menampilkan prompt
    upgrade, bukan kode QR, karena entitlement membatasi rail ini.
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
