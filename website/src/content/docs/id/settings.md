---
title: Pengaturan & Data
description: Branding, struk, mata uang, dan data lokal.
category: reference
order: 2
updated: "2026-09-09"
---

<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · Indonesian counterpart of en/settings.md, same two findings, repaired with the app's own localized labels (settings.id.ftl:41-49,856-858,909; shared.id.ftl:245-246,249-256,266-271; nav-section-tools = Alat, nav-section-finance = Keuangan). Finding 1: the 18-screen "settings sidebar" list was wrong — SettingsNavTree.tsx:18-171 + CATEGORIES:186-190 hold exactly 13 children (Bisnis: Umum, Tampilan; Operasional: Nota, Sinkronisasi Cloud, Laporan Email, POS Toko, POS Restoran, Inventaris; Sistem: Tentang, Lisensi, Diagnostik, Topologi, API Lokal); Fitur/Data/Staf/Peran/Terminal/Lokasi/Log Audit/Antrian Offline/Shift/Tarif Pajak/Nilai Tukar/Promosi are main-nav Tools/Finance items (settings/register.tsx:27,37; shifts/register.tsx:15; terminals/register.tsx:14; staff/register.tsx:20,36; audit/register.tsx:15; offline/register.tsx:14; locations/register.tsx:15 — EN label "Locations"; tax/currency/promotions register.tsx:15,14,14). List rewritten; one sentence added pointing the rest at Alat/Keuangan. Finding 2: "terverifikasi PIN" for void/refund overclaims — only price overrides are PIN-verified (PriceOverrideModal.tsx:65); voids/refunds are permission-gated (void.rs:49, refunds.rs:84). Reworded. · Also fixed: "Antrean Offline" → "Antrian Offline" (shared.id.ftl:255, the app's own spelling). · Replacement sentences mirror the page's own sentence patterns (composed, not machine-translated); underlying facts verified against code. Rest of the prose untouched. -->

## Bilah samping pengaturan

Pengaturan adalah bilah samping berisi layar fokus yang dikelompokkan menjadi
tiga kategori: **Bisnis** (Umum, Tampilan), **Operasional** (Nota,
Sinkronisasi Cloud, Laporan Email, POS Toko, POS Restoran, Inventaris), dan
**Sistem** (Tentang, Lisensi, Diagnostik, Topologi, API Lokal). Sematkan layar
yang sering dipakai agar tetap di bagian atas. Layar lain dengan tugas yang
berkaitan — Fitur, Data, Staf, Peran, Terminal, Lokasi, Log Audit, Antrian
Offline, Shift, Tarif Pajak, Nilai Tukar, dan Promosi — bukan anak
Pengaturan; semuanya berada di bagian Alat dan Keuangan pada navigasi utama.

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

> last audited 09-09-26 by docs-auditor
