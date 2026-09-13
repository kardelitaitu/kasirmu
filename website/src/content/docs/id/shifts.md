---
title: Shift & Rekonsiliasi
description: Tutup shift kasir dengan rapi dan jejak audit lengkap.
category: guides
order: 4
updated: "2026-09-09"
---

<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · Indonesian counterpart of en/shifts.md, same findings repaired. Finding 1: "Hanya satu shift yang terbuka di satu register pada satu waktu" is wrong — the open-shift guard is per user (crates/oz-core/src/db/shifts.rs:68-78 "user already has an open shift"; schema has no terminal-scoped unique index, 20260813_init.pg.sql:965-971,1799-1803; contrast inventory_shifts unique per user+location :962-963). Reworded to one open shift per cashier. Finding 2: dialog-label drift fixed the other way — "Catat Penarikan" → "Catat Penarikan Tunai", the app's own shifts.id.ftl:33 title (EN page: "Record Payout" → "Record Cash Payout", shifts.ftl:39). · All other claims verified and left alone (evidence list in the en/shifts.md stamp): saldo awal opsional, jam berjalan berpatokan waktu pembukaan asli (PosScreen.tsx:573-586,1397), bawaan 'safe drop' (ShiftManagementScreen.tsx:177) dikurangkan dari perkiraan tunai (db/shifts.rs:179), Tutup Shift menerima jumlah dihitung + catatan, label Lebih/Kurang = shift-tag-over/short (shifts.id.ftl:19-20), penutupan ditolak selama keranjang tidak kosong (PosScreen.tsx:1095-1099), Laporan Akhir Hari dengan KPI/rekonsiliasi/rincian pembayaran/per jam, cetak + ekspor CSV (EodReportScreen.tsx:244,281-295,324-325). Dialog titles Buka Shift / Catat Penarikan Tunai / Tutup Shift are the app's own shifts.id.ftl:32-34 labels. · Replacement sentence composed from the page's own patterns; rest untouched. -->

## Membuka shift

Kasir membuka shift di register sebelum melayani pelanggan. Dialog **Buka
Shift** menerima **saldo awal** opsional — uang awal di laci, misalnya
`100.00`. Hanya transaksi kasir tersebut yang dihitung dalam shift, dan jam
berjalan menampilkan berapa lama shift telah berjalan — tetap berpatokan pada
waktu pembukaan asli, sehingga restart atau pembaruan aplikasi tidak pernah
meresetnya. Seorang kasir hanya memiliki satu shift terbuka pada satu waktu,
berapapun registernya.

## Penarikan tunai

Uang dapat keluar dari laci di tengah shift tanpa menutupnya — misalnya
penyetoran ke brankas. **Catat Penarikan Tunai** menerima jumlah dan alasan
(bawaan `safe drop`), dan penarikan dikurangkan dari perkiraan tunai sehingga
rekonsiliasi saat penutupan tetap akurat.

## Menutup dan merekonsiliasi

**Tutup Shift** menerima jumlah tunai yang **dihitung** di laci dan catatan
opsional. Layar menampilkan total yang diharapkan versus yang dihitung dan
menandai **selisih** — diberi label **Lebih** atau **Kurang** — sebelum
register menerima penutupan, sehingga selisih terlihat di kasir daripada di
akhir bulan. Penutupan ditolak selama masih ada transaksi berjalan; selesaikan
atau kosongkan keranjang terlebih dahulu. Ringkasan shift yang ditutup
langsung ditampilkan.

## Riwayat shift dan akhir hari

Layar manajemen shift menampilkan daftar semua shift dengan status, waktu
buka dan tutup, saldo awal dan jumlah dihitung, perkiraan tunai, selisih, dan
penjualan, serta membuka laporan lengkap per shift. **Laporan Akhir Hari**
merangkum shift hari ini: kartu KPI (total pendapatan, rata-rata penjualan,
void, diskon), rekonsiliasi tunai (total awal vs total dihitung vs total
diharapkan, dengan selisih bersih), rincian pembayaran, dan penjualan per jam
— dapat dicetak dan diekspor.

## Riwayat audit

Setiap transaksi, void, refund, penarikan, dan penyesuaian stok dicatat
dengan pengguna dan terminal yang melakukannya, sehingga setiap shift dapat
direkonsiliasi kembali ke jejak audit yang lengkap.

> last audited 09-09-26 by docs-auditor
