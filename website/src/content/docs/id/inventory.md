---
title: Inventaris & Gudang
description: Pantau stok lintas gudang dengan riwayat pergerakan.
category: guides
order: 5
updated: "2026-09-09"
---

<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (1 finding) · Indonesian counterpart of en/inventory.md, same single finding repaired: the transaction-log enumeration was extended to all seven movement types the screen actually covers (TransactionLogScreen.tsx:173-179), using the app's own id labels from inventory.id.ftl:140-146 — Penjualan, Void, Refund, Transfer, PO Diterima, Stok Opname, Penyesuaian Manual. The log screen itself is registered nowhere in ui/src (unreachable from navigation) and the page now says so; flagged as app-side drift, not deleted. · All other claims verified and left alone (full evidence list in the en/inventory.md stamp): alasan penyesuaian persis inventory.id.ftl:54-59, shift stok dengan placeholder "e.g., Night shift count" (inventory.ftl:74-75), filter status opname (api/inventoryCounts.ts:9), ambang per lokasi dengan fallback Global (Semua Lokasi) dan aktif/nonaktif terpisah (ThresholdConfigScreen.tsx:152-155,203,279-280), audit transit dengan tanda terlambat (TransitAuditScreen.tsx:68-112), pembatalan transfer mengembalikan stok (stock_transfers.rs:666-679), Terima pesanan pembelian masuk stok otomatis (purchasing.id.ftl:74 po-action-receive = Terima; purchase_orders.rs:395-470), Laporan Stok = nav-inventory-report (shared.id.ftl:261) dengan kolom stok/ambang/harga/biaya/margin/nilai stok cetak+CSV (inventory.ftl:57-65). · Replacement sentence composed from the page's own patterns; rest untouched. -->

## Level stok

Stok dilacak per produk per lokasi (gudang atau register). Transaksi mengurangi
stok secara otomatis, dan setiap register melayani dari lokasi yang
ditetapkan. Pemilih lokasi mengganti tampilan saat ini, sehingga level selalu
terbaca sesuai konteks.

## Penyesuaian

Penyesuaian stok berjalan dalam dua langkah: pilih produk, lalu pilih alasan —
**Isi ulang** (pengiriman pemasok), **Koreksi stok opname**, **Retur
pelanggan**, **Rusak / kedaluwarsa**, **Penghapusan / kedaluwarsa**,
**Transfer ke lokasi lain**, atau alasan kustom — dan masukkan perubahannya.
Setiap penyesuaian menulis entri buku besar pergerakan, sehingga setiap
perubahan dapat ditelusuri kembali ke siapa, kapan, dan mengapa.

## Stok opname

Stok opname merekonsiliasi sistem dengan jumlah fisik di rak. Mulai **shift
stok** (misalnya `Night shift count`), hitung, dan koreksi tercatat terhadap
shift tersebut. Opname terdaftar dengan filter status, dan masing-masing
membuka tampilan detail dengan riwayatnya, sehingga selisih yang ditemukan
belakangan tetap dapat dijelaskan.

## Batas stok dan peringatan

Peringatan stok rendah menandai produk di bawah ambang batasnya. Batas
dikonfigurasi per lokasi, dengan fallback **Global (Semua Lokasi)** untuk
produk tanpa pengaturan khusus lokasi, dan setiap batas dapat diaktifkan atau
dinonaktifkan secara terpisah.

## Transfer dan transit

Stok berpindah antar lokasi sebagai transfer yang tercatat. Item dalam transit
diaudit dengan sumber, tujuan, jumlah, dan waktu kirimnya; transit yang
terlambat ditandai agar tidak ada yang hilang di antara rak. Transfer yang
keliru dapat **dibalik**, mengembalikan stok ke lokasi asalnya.

## Pesanan pembelian

Pengisian ulang melalui pemasok melewati pesanan pembelian: kelola pemasok,
buat pesanan dengan pemasok dan tanggal pesanan, lalu **Terima** saat
pengiriman tiba — jumlah yang diterima masuk ke stok secara otomatis.

## Laporan dan buku besar pergerakan

**Laporan Stok** menampilkan stok, batas, harga satuan dan biaya, margin,
serta nilai stok per produk, dan dapat dicetak atau diekspor sebagai CSV.
**Log Transaksi Stok** adalah buku besar di balik semuanya, mencakup
penjualan, void, refund, transfer, penerimaan pesanan pembelian (PO
Diterima), stok opname, dan penyesuaian manual — dari mana stok berasal dan
ke mana perginya.

> last audited 09-09-26 by docs-auditor (Layar log ini bagian dari aplikasi, meski saat ini belum
terhubung ke menu navigasi mana pun.)
