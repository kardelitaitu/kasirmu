---
title: Ruang Kerja
description: Pilih fungsi setiap layar — kasir ritel, layanan restoran, dapur, atau back office.
category: guides
order: 7
updated: "2026-09-19"
---

<!-- Audit stamp: 2026-09-19 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · 2026-09-19 RE-AUDIT: penunjuk Staf menjadi basi lagi karena sebab yang berbeda dari temuan 2026-09-08. Manajemen staf kini halaman layar penuh tersendiri — ui/src/features/staff/register.tsx:20-33 mendaftarkan rute staff dengan fullscreen: true tanpa registerNavItem — sehingga AppShell merendernya tanpa AppLayout dan tidak ada entri bilah sisi. "Di bagian Alat pada bilah sisi" karena itu tidak lagi dapat dicapai; kalimatnya kini menunjuk kartu Staff Management di kisi Tools pemilih ruang kerja. Diverifikasi pada aplikasi yang berjalan: seksi Tools memuat Terminal, Fitur, Data, Log Audit, Security Trail, Antrian Offline, Shift, Memo — tanpa Staf maupun Peran. · 2026-09-08 · DSH · status: PARTIALLY REPAIRED - UNREVIEWED TRANSLATION (1 finding) · Indonesian counterpart of en/workspaces.md; first audit evidence. One navigation pointer corrected, and it is the same defect the English page had: Pengaturan -> Staf. Staff is registered in ui/src/features/staff/register.tsx with section: tools, and nothing under ui/src/features/settings/ references the staff route. The replacement uses the app's own localized labels from shared.id.ftl (nav-staff = Staf, nav-section-tools = Alat) rather than invented terms. CAVEAT: the Indonesian wording is mine, composed from this page's surrounding patterns, NOT reviewed by a native speaker or the locale owner - if the phrasing is wrong, reword it; the fact (Staff lives under Alat, not Pengaturan) is verified against the code and should survive. Found by .agents/skills/docs-auditor/scripts/check-nav-paths.py, which sweeps every bolded nav path in both locales against the nav registry. -->

## Pemilih ruang kerja

Setelah masuk, staf melihat kisi kartu ruang kerja. Setiap ruang kerja adalah
peran untuk layar di depan Anda — apa yang bisa dilakukan, bukan di mana
Anda berada:

| Ruang Kerja     | Fungsinya                                                                  | Status       |
| --------------- | -------------------------------------------------------------------------- | ------------ |
| POS Toko        | Kasir ritel — pencarian produk, pelanggan, dan loyalitas                   | Siap         |
| POS Restoran    | Kasir layanan meja — kategori menu dan manajemen meja                      | Siap         |
| Tampilan Dapur  | Antrean pesanan untuk dapur — ketuk tiket untuk memajukan statusnya        | Siap         |
| Gudang          | Produk, tingkat stok, bundel, kategori, dan laporan inventaris             | Siap         |
| Admin           | Pengaturan, staf, laporan, log audit, dan konfigurasi                      | Siap         |

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
berbeda tergantung perannya. POS Toko mengatur tata letak struk, lebar
kertas, tampilan mata uang dan pajak, serta pemindai barcode. POS Restoran
mengatur tata letak meja, pengiriman kursus, dan printer dapur. Tampilan
Dapur mengatur eskalasi SLA dan suara pesanan baru. Lihat [Pengaturan](../settings/)
untuk daftar lengkap.

## Ruang kerja milik sebuah toko

Setiap instance ruang kerja terikat ke toko. Saat mulai, perangkat
menyelesaikan tokonya — dari binding terminal bila ada, jika tidak toko
utama — lalu menampilkan ruang kerja toko tersebut. Lihat
[Toko & Topologi](../stores/) dan [Terminal](../terminals/).

## Ruang kerja yang direncanakan

Pemilih menampilkan kartu tempat untuk ruang kerja yang masih ada di peta
jalan — **Loyalitas**, **Pemasaran**, dan **Pesanan Online**. Ketiganya
ditandai **Segera hadir** dan akan menjadi ruang kerja siap pakai begitu
diluncurkan.

**Kiosk** bukan ruang kerja — melainkan mode kasir layanan mandiri yang
dikunci untuk layar tanpa pengawas. **Laporan** juga bukan ruang kerja:
dasbor penjualan dan analitik berada di dalam ruang kerja Admin, pada layar
**Laporan**.

> last audited 19-09-26 by docs-auditor
