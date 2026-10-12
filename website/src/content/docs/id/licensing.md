---
title: Lisensi & Paket
description: Paket, paket gratis selamanya, kedaluwarsa, dan masa tenggang.
category: reference
order: 1
updated: "2026-10-01"
---
<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 minor) · MINOR, fixed: the plan-matrix table's `| Skrip (Lua) |` row had been torn out of the table — it sat BELOW the footnote block (¹ QR statis/dinamis) and separated from the header, so it rendered as a stray paragraph instead of a table row. Moved up into the table directly after `Sinkron cloud`, footnote untouched. The SAME defect existed in en/licensing.md at the identical position, so both twins were repaired together and parity holds. VERIFIED cell by cell against crates/kasirmu-core/src/subscription/tier.rs: Lokasi 1/1/2/5/unlimited = max_locations (:96-104); Register/lokasi 1/2/5/unlimited = max_pos_instances (:106-112); Gudang tidak/tidak/tidak/unlimited = max_warehouses (:124-130, Some(0) below Premium); Staf 1/5/20/50/unlimited = max_staff_users (:132-144); Riwayat 3 bulan/1 tahun/5 tahun/unlimited = sales_history_days (:173-179 → 90/365/1825/None); QRIS Statis-saja on Gratis = supports_qris() (:217-222) with the footnote correctly splitting static (all plans) from dynamic (Plus+); Sinkron tidak/ya×4 = supports_cloud_sync() (:209-214); Skrip (Lua) tidak/tidak/tidak/ya/ya = supports_lua_engine() (:233-238). Prose grace periods 7/14/14/30/60 = offline_grace_days() (:279-286). Nav pointer 'Pengaturan → Lisensi & Langganan' = shared-ui/locales/settings.id.ftl:56. The five-tier list correctly omits the deprecated OneTime variant. · NOT re-measured: the live checkout/purchase flow and the pricing page's own figures. · Superseded stamp preserved verbatim below as quoted text: -->

> Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major finding) · Baris QRIS di matriks paket menyatakan "✓ (statis + dinamis)" pada kolom Gratis. Terverifikasi salah untuk bagian DINAMIS: SubscriptionTier::supports_qris() mengembalikan false pada Free/OneTime (crates/kasirmu-core/src/subscription/tier.rs:217-222) dan kasir membatasi rail ini di balik prompt upgrade (ui/src/features/sales/PaymentModal.tsx:1909, QrisTenderPanel.tsx). QR STATIS tidak memerlukan entitlement dan tersedia di semua paket. Baris kini berbunyi "Statis saja" pada Gratis dengan catatan kaki pemisah, dan subscription-tiers.md §3 dikoreksi untuk mencatat keputusan pemilik 2026-09-29 bahwa QRIS dinamis SEHARUSNYA ada di Gratis — keputusan yang belum ditegakkan aplikasi. Penunjuk navigasi juga diperbarui: "Pengaturan → Lisensi" menjadi "Lisensi & Langganan" (label terverifikasi di shared-ui/locales/settings.id.ftl:56). · Repaired against branch 0.0.41.

## Paket

kasir.mu memiliki lima paket: `free`, `plus`, `pro`, `premium`, dan
`enterprise`. Apa yang dibuka setiap paket — lokasi, register, gudang,
pembayaran QRIS, sinkron cloud, dan skrip — ditampilkan di
[halaman harga](../../pricing/).

| Kapabilitas         | Gratis | Plus | Pro | Premium | Enterprise |
| ------------------- | ------ | ---- | --- | ------- | ---------- |
| Lokasi                | 1      | 1    | 2   | 5       | Tanpa batas |
| Register / lokasi     | 1      | 2    | 5   | Tanpa batas | Tanpa batas |
| Gudang              | Tidak  | Tidak | Tidak | Tanpa batas | Tanpa batas |
| Staf pengguna       | 1      | 5    | 20  | 50      | Tanpa batas |
| Riwayat penjualan   | 3 bulan | 1 tahun | 5 tahun | Tanpa batas | Tanpa batas |
| Pembayaran QRIS     | Statis saja ¹ | ✓ (statis + dinamis) | ✓ | ✓ | ✓ |
| Sinkron cloud       | Tidak  | ✓    | ✓   | ✓       | ✓         |
| Skrip (Lua)         | Tidak  | Tidak | Tidak | ✓     | ✓         |

¹ **QR statis** (stiker QR toko Anda sendiri, direkonsiliasi pada struk) tidak
memerlukan entitlement dan tersedia di semua paket. **QR dinamis** (kasir
membuat QR per transaksi melalui Midtrans) dibatasi pada paket Plus ke atas,
sesuai `SubscriptionTier::supports_qris()` — pada paket Gratis kasir
menampilkan prompt upgrade, bukan kode QR.

Paket tahunan = 2 bulan gratis (bayar 10 bulan, dapat 12).

## Paket Gratis

Paket Gratis bersifat **gratis selamanya** — satu lokasi, satu register, dan
riwayat penjualan 3 bulan. Tidak perlu kunci lisensi untuk
memulai: paket Gratis dimulai pada peluncuran pertama, dan Anda dapat naik
paket kapan saja tanpa menginstal ulang. Setelah 3 bulan, transaksi yang
lebih lama disembunyikan di balik ajakan naik paket — tidak ada yang
dihapus.

## Membeli dan mengaktifkan

Paket berbayar dibeli di checkout situs web. Pembayaran bersifat
register-first: checkout meminta Anda masuk dengan email (kode sekali pakai
atau kata sandi) sehingga langganan terhubung ke akun Anda. Kunci lisensi dan
tanda terima tiba melalui email, lalu Anda tempel kunci ke
**Pengaturan → Lisensi & Langganan** untuk mengaktifkan. Lihat
[Aktivasi Lisensi](../activation/) untuk perjalanan lengkap, dan
[halaman harga](../../pricing/) untuk harga terkini.

## Kedaluwarsa dan tenggang

Langganan memiliki tanggal kedaluwarsa dan masa tenggang. Saat langganan
berakhir, aplikasi memasuki masa tenggang dan tetap berfungsi — termasuk
offline — hingga tanggal tenggang. Lamanya tenggang tergantung paket: Free
dan One-Time 7 hari, Plus 14, Pro 14, Premium 30, Enterprise 60.

Setelah masa tenggang berakhir, register terkunci menjadi hanya-baca: tidak
ada penjualan baru, perubahan pesanan, atau antrean sinkronisasi — melihat,
ekspor data, dan keluar tetap tersedia. Fitur administratif (Analitik,
Laporan, Memo, dan sejenisnya) terkunci lebih awal, tepat pada tanggal
kedaluwarsa. Tidak ada yang dihapus; register terbuka kembali secara
otomatis begitu koneksi kembali dan langganan terverifikasi, serta
memperbarui paket akan memulihkan paket Anda.

## Batas perangkat

Setiap paket berbayar mengizinkan sejumlah register teraktivasi, dan perangkat
terikat ke perangkat keras — kunci lisensi mengaktifkan perangkat tertentu,
bukan siapa pun yang memegang kunci. Admin tenant dapat mencabut perangkat
dari jarak jauh, yang membebaskan slot dan menandatangani keluar perangkat.

## Melihat lisensi Anda

**Pengaturan → Lisensi & Langganan** menampilkan paket Anda, status, tanggal kedaluwarsa,
masa tenggang, maksimal lokasi dan instance POS, ID tenant, dan tipe ruang
kerja yang diizinkan. Halaman akun di situs web menampilkan hal yang sama
dari browser Anda, lengkap dengan manajemen perangkat. Lihat
[Aktivasi Lisensi](../activation/).

> last audited 11-10-26 by docs-auditor
