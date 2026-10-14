---
title: Ruang Kerja
description: Pilih fungsi setiap layar — kasir ritel, layanan restoran, dapur, atau back office.
category: gettingStarted
order: 7
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 2 minor) · Re-audit of the Indonesian Workspaces page, repaired in step with the English twin. MAJOR (carried by the English page and mirrored here): the workspace table named the retail workspace "POS Ritel" for key `store-pos`, but the seed labels `store-pos` **"Store POS"** and a SIXTH type `retail-pos` is the one named **"Retail POS"** (20260813_init.sql:1465-1471; DEFAULT_WORKSPACE_TYPES, ui/src/api/workspaces.ts:228-265). The table now lists all six seeded types. MINOR 1: Admin was shown as an ordinary card, but the picker filters it out — its features live in the Tools section instead (WorkspaceHome.tsx:377-379); added as a callout. MINOR 2: §Ruang kerja yang direncanakan claimed placeholder cards marked "Segera hadir" for Loyalitas / Pemasaran / Pesanan Online; no such card exists (the seed holds six types and "Coming soon" appears nowhere in ui/src outside tests). Rewritten to say they are roadmap items. · VERIFIED: every workspace label and description against the seed and DEFAULT_WORKSPACE_TYPES; the per-workspace settings cards (POS Toko / POS Restoran / Tampilan Dapur); the Staff Management pointer in the Tools grid. · NOT re-measured: a live picker render and pin persistence. · Superseded 2026-09-19 and 2026-09-08 stamps preserved below as plain te

STAMP MERGED INTO THIS ONE — superseded stamp(s) kept verbatim as plain text (delimiters stripped so they cannot nest):

Audit stamp: 2026-09-19 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · 2026-09-19 RE-AUDIT: penunjuk Staf menjadi basi lagi karena sebab yang berbeda dari temuan 2026-09-08. Manajemen staf kini halaman layar penuh tersendiri — ui/src/features/staff/register.tsx:20-33 mendaftarkan rute staff dengan fullscreen: true tanpa registerNavItem — sehingga AppShell merendernya tanpa AppLayout dan tidak ada entri bilah sisi. "Di bagian Alat pada bilah sisi" karena itu tidak lagi dapat dicapai; kalimatnya kini menunjuk kartu Staff Management di kisi Tools pemilih ruang kerja. Diverifikasi pada aplikasi yang berjalan: seksi Tools memuat Terminal, Fitur, Data, Log Audit, Security Trail, Antrian Offline, Shift, Memo — tanpa Staf maupun Peran. · 2026-09-08 · DSH · status: PARTIALLY REPAIRED - UNREVIEWED TRANSLATION (1 finding) · Indonesian counterpart of en/workspaces.md; first audit evidence. One navigation pointer corrected, and it is the same defect the English page had: Pengaturan -> Staf. Staff is registered in ui/src/features/staff/register.tsx with section: tools, and nothing under ui/src/features/settings/ references the staff route. The replacement uses the app's own localized labels from shared.id.ftl (nav-staff = Staf, nav-section-tools = Alat) rather than invented terms. CAVEAT: the Indonesian wording is mine, composed from this page's surrounding patterns, NOT reviewed by a native speaker or the locale owner - if the phrasing is wrong, reword it; the fact (Staff lives under Alat, not Pengaturan) is verified against the code and should survive. Found by .agents/skills/docs-auditor/scripts/check-nav-paths.py, which sweeps every bolded nav path in both locales against the nav registry. -->

## Pemilih ruang kerja

Setelah masuk, staf melihat kisi kartu ruang kerja. Setiap ruang kerja adalah
peran untuk layar di depan Anda — apa yang bisa dilakukan, bukan di mana
Anda berada:

| Ruang Kerja     | Fungsinya                                                                  | Muncul sebagai kartu |
| --------------- | -------------------------------------------------------------------------- | ------------ |
| Store POS       | Kasir ritel — pencarian produk, pelanggan, dan loyalitas                   | Siap         |
| Retail POS      | Kasir ritel (jenis ritel kedua yang di-seed)                               | Siap         |
| POS Restoran    | Kasir layanan meja — kategori menu dan manajemen meja                      | Siap         |
| Tampilan Dapur  | Antrean pesanan untuk dapur — ketuk tiket untuk memajukan statusnya        | Siap         |
| Gudang          | Produk, tingkat stok, bundel, kategori, dan laporan inventaris             | Siap         |
| Admin           | Pengaturan, staf, laporan, log audit, dan konfigurasi                      | **Tidak di kisi beranda** — lihat di bawah |

> **Admin bukan salah satu kartu di layar beranda.** Pemilih menyaringnya
> dengan sengaja: fiturnya (pengaturan, analitik, laporan) dicapai dari bagian
> **Alat** di layar yang sama, jadi Admin adalah ruang kerja yang Anda masuki,
> bukan yang Anda pilih dari kisi. (`WorkspaceHome.tsx:377-379`.)

## Akses berdasarkan penugasan

Setiap anggota staf hanya dapat membuka ruang kerja yang ditugaskan padanya —
staf kasir biasanya ditugaskan ruang kerja POS, staf dapur Tampilan Dapur.
Kartu yang tidak bisa Anda buka ditampilkan nonaktif, dan manajer ke atas
tidak dibatasi penugasan. Penugasan diatur di layar **Staf** — buka dari kartu
**Staff Management** di kisi Tools pemilih ruang kerja; layar ini halaman
layar penuh tersendiri, bukan entri bilah sisi. Lihat
[Peran Pengguna](../user-roles/).

## Sematkan & peluncuran cepat

Bintangi ruang kerja untuk menyematkannya ke depan kisi, dan ruang kerja
yang paling sering dipakai muncul berikutnya. Tombol angka 1–9 meluncurkan
ruang kerja secara langsung.

## Pengaturan ruang kerja

Setiap ruang kerja memiliki pengaturannya sendiri, sehingga layar berperilaku
berbeda tergantung perannya. POS Ritel mengatur tata letak struk, lebar
kertas, tampilan mata uang dan pajak, serta pemindai barcode. POS Restoran
mengatur tata letak meja, pengiriman kursus, dan printer dapur. Tampilan
Dapur mengatur eskalasi SLA dan suara pesanan baru. Lihat [Pengaturan](../settings/)
untuk daftar lengkap.

## Ruang kerja milik sebuah lokasi

Setiap instance ruang kerja terikat ke lokasi. Saat mulai, perangkat
menyelesaikan lokasinya — dari binding terminal bila ada, jika tidak lokasi
utama — lalu menampilkan ruang kerja lokasi tersebut. Lihat
[Lokasi & Topologi](../location/) dan [Terminal](../terminals/).

## Ruang kerja yang direncanakan

Saat ini **tidak ada kartu "segera hadir" di pemilih**: jenis ruang kerja yang
di-seed persis enam seperti tabel di atas, dan tidak ada yang merender kartu
peta jalan di layar beranda. **Loyalitas**, **Pemasaran**, dan **Pesanan
Online** adalah item peta jalan, bukan ruang kerja yang sudah dikirim maupun
kartu tempat — jika Anda melihat kartunya, itu berasal dari jenis ruang kerja
toko Anda sendiri, bukan dari aplikasi.

**Kiosk** bukan ruang kerja — melainkan mode kasir layanan mandiri yang
dikunci untuk layar tanpa pengawas. **Laporan** juga bukan ruang kerja:
dasbor penjualan dan analitik berada di dalam ruang kerja Admin, pada layar
**Laporan**.

Lanjut membaca · **Sebelumnya:** [Transaksi Pertama Anda](../first-sale/) · **Berikutnya:** [Hari Pertama Beroperasi](../first-day/)

> last audited 11-10-26 by docs-auditor
