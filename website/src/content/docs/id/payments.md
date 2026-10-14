---
title: Pembayaran & QRIS
description: Terima tunai dan QRIS di semua paket — QR statis dan QR dinamis, tanpa perangkat tambahan.
category: guides
order: 1
updated: "2026-10-01"
---
<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · Re-audit; the 2026-10-08 repair (QRIS static-vs-dynamic split) is confirmed still correct at the source. VERIFIED: the VISIBLE tender tabs are exactly cash/card/qris/credit (ui/src/features/sales/useLocalPaymentRails.ts:119 TenderMethod, :142-147 TENDER_RAILS), so the page's 'E-wallet — segera hadir: kasir belum memiliki tender e-wallet' is CORRECT even though `ewallet` exists as a PaymentMethod in the type union and as a mapped label (PaymentModal.tsx:81) — the union is wider than the strip, which is precisely what the TENDER_RAILS comment warns about. Dynamic QR stays Plus+ (supports_qris(), tier.rs:217-222; checkout gate PaymentModal.tsx:1909) and static QR rides every plan. Cash, card (manual + optional EDC terminal button gated by the site's rail list), credit sale against a required named customer, split tender, multi-currency, and asynchronous QRIS settlement that never blocks the counter are all as written. Open Bill (saves the cart without payment, separate from held orders, not shift-bound, removed once paid) and held orders with the F4 resume (retailShortcuts.ts:42, RetailPosScreen.tsx:1519) match the modal. Refund needs manager permission and writes a matching stock movement. · NOT re-measured: a live Midtrans settlement round-trip and the EDC hardware path. · Superseded stamp preserved verbatim below as quoted text: -->

> Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major finding) · Butir QRIS menyatakan "tersedia di semua paket, termasuk Gratis" dan menempatkan QR dinamis lebih dulu. Terverifikasi: hanya QR STATIS yang ada di semua paket; QR DINAMIS memerlukan entitlement Plus (SubscriptionTier::supports_qris(), crates/kasirmu-core/src/subscription/tier.rs:217-222; gate checkout di ui/src/features/sales/PaymentModal.tsx:1909). Butir kini memisahkan keduanya dan menyatakan pembagiannya. · Repaired against branch 0.0.41.

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

**Tagihan terbuka adalah fitur POS Restoran.** Backend menolak tagihan terbuka
di luar ruang kerja itu, jadi tender ini hanya ditawarkan di **POS Restoran**
dan hanya bila rail `open_bill` aktif untuk situs tersebut
(`ui/src/features/sales/PaymentModal.tsx` — kapabilitas dan flag rail merchant
adalah dua gerbang terpisah dan keduanya harus terpenuhi).

## Tahan pesanan

Kasir dapat menyimpan transaksi berjalan tanpa membayarnya. **Tahan** di panel
keranjang membuka prompt untuk memberi nama pesanan agar mudah ditemukan
nanti, dan transaksi keluar dari layar dengan penghitung yang menunjukkan
berapa banyak pesanan yang ditahan. Lanjutkan pesanan yang ditahan dari
daftar. Di **POS Retail** bilah fungsi juga memetakan **F4** ke tahan/lanjutkan
(`ui/src/features/retail/retailShortcuts.ts` — aksi `hold-resume`); POS
restoran punya gaya sendiri, jadi anggap daftar sebagai jalur portabel. Beberapa
pesanan dapat ditahan sekaligus, dan bertahan dari restart serta pembaruan
aplikasi.

Menahan berguna di kasir yang sibuk: layani pelanggan, tahan transaksinya,
layani pelanggan berikutnya, lalu lanjutkan saat pelanggan pertama siap
membayar.

## Refund dan pembatalan

Refund memerlukan izin manajer dan menulis pergerakan stok yang berpasangan,
sehingga inventaris dan log audit tetap konsisten.

> last audited 11-10-26 by docs-auditor
