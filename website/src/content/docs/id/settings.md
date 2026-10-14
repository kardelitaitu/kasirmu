---
title: Pengaturan & Data
description: Branding, struk, mata uang, dan data lokal.
category: reference
order: 2
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major) · MAJOR, fixed: the §Bilah samping pengaturan section still described the OLD three-category sidebar (Bisnis / Operasional / Sistem, naming Umum, Tampilan, Nota, Sinkronisasi Cloud, Laporan Email, POS Toko, POS Restoran, Inventaris, Tentang, Lisensi, Diagnostik, Topologi, API Lokal). That IA no longer exists. Verified: ui/src/features/settings/SettingsNavTree.tsx declares ONE FLAT list — its own comments at :13 and :36 say the category accordion is gone and there are 13 pages, and NAV_ITEMS (:41-202) holds 14 entries: General, License & Subscription, Devices & Connectivity, Business Defaults, Features & Modules, Security & Account, Data Sync, Data Management, Sync Status, Sync Conflicts, Offline Queue, Tax Configuration, Exchange Rates, System Diagnostics. There is no About page, no Appearance page, no Topology page, no Local API page. Section rewritten to the flat 14-page list using the app's OWN Indonesian labels (shared-ui/locales/settings.id.ftl:49,56,60(devices),65(business-defaults),69? — resolved from NAV_L10N_KEYS at SettingsNavTree.tsx:207-222, e.g. Umum / Lisensi & Langganan / Perangkat & Konektivitas / Default Bisnis / Fitur & Modul / Keamanan & Akun / Data & Sinkronisasi / Manajemen Data / Status Sinkronisasi / Konflik Sinkronisasi / Antrean Offline / Konfigurasi Pajak / Kurs Valuta Asing / Diagnostik Sistem). WHY THIS WAS MISSED: the EN twin (en/settings.md) was repaired to the flat list on 2026-10-08, but the id twin was never updated — a parity gap, not an independent error. The Staff/Roles note (they are full-screen pages reached from the Tools grid, not settings children) was re-verified and kept. VERIFIED left alone: five role presets pemilik/admin/manajer/staf/auditor, PIN-verified price overrides vs role-gated voids/refunds, audit log immutability, encrypted .ozpkg export with no passwords, per-device sound/theme. · AMBIGUOUS, left as written: the page uses 'Antrian Offline' for the queue where settings.id.ftl:68 says 'Antrean Offline' — but shared-ui/locales/shared.id.ftl:292 (main nav) and offline.id.ftl:1 (page title) both say 'Antrian Offline', so the app itself ships both spellings and the page is not wrong. · NOT re-measured: the live settings screens' rendered copy. · Superseded stamp preserved verbatim below as quoted text: -->

> Audit stamp: 2026-09-19 · DSH · status: ACCURATE AFTER REPAIR (3 findings) · 2026-09-19 RE-AUDIT: enumerasi Temuan 1 menyebut Staf dan Peran sebagai layar yang "berada di bagian Alat dan Keuangan pada navigasi utama". Keduanya kini tidak berada di navigasi utama sama sekali — ui/src/features/staff/register.tsx:20-33 mendaftarkan kedua rute dengan fullscreen: true tanpa registerNavItem, sehingga AppShell merendernya tanpa AppLayout dan bilah sisi tidak memuat keduanya. Kalimatnya kini memisahkan keduanya dari layar yang benar-benar ada di seksi Alat dan menunjuk kisi Tools pemilih ruang kerja. Diverifikasi pada aplikasi yang berjalan: seksi Tools memuat Terminal, Fitur, Data, Log Audit, Security Trail, Antrian Offline, Shift, Memo. · 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · Indonesian counterpart of en/settings.md, same two findings, repaired with the app's own localized labels (settings.id.ftl:41-49,856-858,909; shared.id.ftl:245-246,249-256,266-271; nav-section-tools = Alat, nav-section-finance = Keuangan). Finding 1: the 18-screen "settings sidebar" list was wrong — SettingsNavTree.tsx:18-171 + CATEGORIES:186-190 hold exactly 13 children (Bisnis: Umum, Tampilan; Operasional: Nota, Sinkronisasi Cloud, Laporan Email, POS Toko, POS Restoran, Inventaris; Sistem: Tentang, Lisensi, Diagnostik, Topologi, API Lokal); Fitur/Data/Staf/Peran/Terminal/Lokasi/Log Audit/Antrian Offline/Shift/Tarif Pajak/Nilai Tukar/Promosi are main-nav Tools/Finance items (settings/register.tsx:27,37; shifts/register.tsx:15; terminals/register.tsx:14; staff/register.tsx:20,36; audit/register.tsx:15; offline/register.tsx:14; locations/register.tsx:15 — EN label "Locations"; tax/currency/promotions register.tsx:15,14,14). List rewritten; one sentence added pointing the rest at Alat/Keuangan. Finding 2: "terverifikasi PIN" for void/refund overclaims — only price overrides are PIN-verified (PriceOverrideModal.tsx:65); voids/refunds are permission-gated (void.rs:49, refunds.rs:84). Reworded. · Also fixed: "Antrean Offline" → "Antrian Offline" (shared.id.ftl:255, the app's own spelling). · Replacement sentences mirror the page's own sentence patterns (composed, not machine-translated); underlying facts verified against code. Rest of the prose untouched.

## Bilah samping pengaturan

Pengaturan adalah satu bilah samping datar berisi 14 layar fokus, dalam urutan
ini: Umum, Lisensi & Langganan, Perangkat & Konektivitas, Default Bisnis,
Fitur & Modul, Keamanan & Akun, Data & Sinkronisasi, Manajemen Data, Status
Sinkronisasi, Konflik Sinkronisasi, Antrean Offline, Konfigurasi Pajak, Kurs
Valuta Asing, dan Diagnostik Sistem. Tidak ada kategori — setiap layar adalah
satu entri dalam daftar yang sama. **Perangkat & Konektivitas** mencakup
perangkat keras, nota, dan terminal; **Default Bisnis** mencakup bawaan toko,
nota, dan regional. Sematkan layar yang sering dipakai agar tetap di bagian
atas.

Dua dari empat belas layar adalah layar paket berbayar dan membawa lencana
tier di bawah paketnya — **Manajemen Data** dan **Status Sinkronisasi**
memerlukan Plus atau lebih tinggi (`minimumTier: 'plus'` di
`ui/src/features/settings/SettingsNavTree.tsx`). Dua belas lainnya ada di
setiap paket, termasuk Gratis. Layar lain dengan tugas yang berkaitan — Fitur, Data, Terminal, Lokasi,
Log Audit, Shift, Tarif Pajak, Nilai Tukar, dan Promosi — bukan anak
Pengaturan; semuanya berada di bagian Alat dan Keuangan pada navigasi utama.
**Staf** dan **Peran** bukan keduanya: keduanya halaman layar penuh
tersendiri yang Anda buka dari kartu **Staff Management** di kisi Tools pemilih
ruang kerja, dan halaman Staf menautkan ke Peran.

## Pengaturan toko

Nama usaha, mata uang, tata letak struk, dan bawaan perangkat keras
dikonfigurasi di sini dan tersinkron ke setiap register. **Tarif Pajak** dan
**Nilai Tukar** menambahkan tarif yang dipakai kasir dan laporan. Pengaturan
nota mengontrol lebar kertas, tampilan mata uang dan pajak, pembulatan,
footer, serta printer — per ruang kerja, sehingga setiap layar mencetak
dengan caranya sendiri.

## Tampilan & perangkat

**Tampilan** mengatur tema (mode gelap) yang dipakai perangkat saat boot.
Preferensi per perangkat seperti volume suara ada di terminal; lihat
[Terminal](../terminals/) untuk apa yang mengikuti perangkat alih-alih
pengguna.

## Staf & keamanan

Staf masuk dengan PIN atau kata sandi, dan setiap akun memiliki peran — salah
satu dari lima preset (**pemilik**, **admin**, **manajer**, **staf**, atau
**auditor**) — yang menentukan ruang kerja dan tindakan yang diizinkan.
Pengesampingan harga terverifikasi PIN, void dan refund memerlukan izin peran
manajer, dan **Log Audit** menyimpan catatan yang tidak dapat diubah. Lihat
[Peran Pengguna](../user-roles/) untuk matriks lengkapnya, dan
[Shift & Rekonsiliasi](../shifts/) untuk bagaimana jejak yang sama
merekonsiliasi kas.

## Manajemen data

Layar **Data** mengekspor, mengimpor, dan mencadangkan data Anda. Ekspor
adalah wizard: pilih jenis data (produk, kategori, penjualan, pelanggan,
pengguna, pengaturan) dan rentang tanggal, lalu hasilnya ditulis sebagai
file `.ozpkg` terenkripsi. Ekspor tidak pernah menyertakan kata sandi, dan
impor divalidasi sebelum apa pun diganti. Cadangan database lokal adalah
salinan pemulihan bencana — lihat [Mode Offline-First](../offline-mode/)
untuk bagaimana data hidup di perangkat.

## Sinkron, offline & lisensi

**Sinkronisasi Cloud** dan **Antrian Offline** menampilkan status sinkron dan
apa yang menunggu untuk mencapai cloud — lihat [Sinkron Cloud](../cloud-sync/)
dan [Mode Offline-First](../offline-mode/). **Lisensi** menampilkan paket,
kedaluwarsa, masa tenggang, dan batas Anda — lihat
[Lisensi & Paket](../licensing/).

> last audited 11-10-26 by docs-auditor
