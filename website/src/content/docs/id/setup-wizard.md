---
title: Wizard Pengaturan
description: Apa yang ditanyakan layar provisi peluncuran pertama dan kapan tiap langkah penting.
category: gettingStarted
order: 4
updated: "2026-09-30"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 1 minor) · Indonesian counterpart, audited at HEAD in the same pass as the en page. · MAJOR: the "Kapan munculnya" paragraph reproduced the same stale behaviour as its en sibling — it said later sections stay hidden until earlier steps complete "kecuali pilihan jenis toko yang tetap terlihat" (except the shop-type choice, which stays visible). At HEAD the wizard renders ONE step at a time (each panel gated on `{activeStep === N && …}`, ProvisioningFlow.tsx:695/:1076/:1153; the component's comment at :534-544 records why), so a later section is not rendered rather than hidden, and the shop-type choice lives inside the Step 2 panel and is not always visible. Rewritten. · MINOR: a copy typo, "PIN bernama empat digit" ("a PIN named four digits"), corrected to "PIN minimal 4 digit (dimasukkan dua kali)", which is what the code enforces (ProvisioningFlow.tsx:410 pinTooShort, :411 pinMismatch, :1204 "PIN (at least 4 digits)"). · VERIFIED AND LEFT ALONE: front matter parity with en/setup-wizard.md is exact (category/order/updated all agree); all six relative links resolve; the field-by-field content matches the en page section for section. · NOT reviewed: the Indonesian prose as copywriting — only the two defects above were touched. -->

## Kapan munculnya

Wizard berjalan saat peluncuran pertama pemasangan baru. Sampai selesai,
aplikasi menunggu di satu layar ini — tiga langkah mengisi bilah progres
**Akun**, **Toko**, **Owner** ("Langkah N dari 3"), masing-masing diberi
tanda cek saat selesai. Wizard menampilkan **satu langkah pada satu waktu**:
hanya langkah yang sedang Anda kerjakan yang tampil, dan berpindah mundur
atau maju tetap menyimpan apa pun yang sudah Anda isi. Bilah progres itulah
cara Anda melihat keseluruhan alurnya — di mana Anda berada, apa yang sudah
selesai, dan apa yang tersisa.

## Langkah 1 — Akun

Dua cara memulai:

- **Tautkan akun** — daftar/masuk email di perangkat ini. Internet hanya
  diperlukan *pada langkah ini*: membuat atau menautkan akun tidak bisa
  dilakukan offline.
- **Offline saja** — pengaturan tanpa akun. Terminal diprovisi secara
  lokal tanpa tenant, dan akun bisa ditautkan nanti dari Pengaturan.

## Langkah 2 — Toko

Pilih jenis toko; pilihan ini menentukan ruang kerja pertama yang dibuat
dan bentuk layar kasirnya:

| Pilihan | Dibuat untuk | Ruang kerja pertama |
|---|---|---|
| 🛒 **Toko** (ritel sederhana) | kisi produk, barcode, stok | POS Ritel |
| 🍽️ **Restoran atau kafe** | kategori menu dan meja | POS Restoran |

Lalu beri nama toko. Nama menjadi lokasi tempat ruang kerja dan perangkat
terikat — lihat [Lokasi & Topologi](../location/).

## Langkah 3 — Owner

Buat login owner: nama Anda, username login, dan PIN minimal 4 digit (dimasukkan dua kali). Peran owner memiliki seluruh izin dari awal — lihat
[Peran Pengguna](../user-roles/) untuk peran lain yang bisa ditambahkan
nanti.

## Bawaan lokal

Provisi menetapkan **IDR** dan zona waktu **Asia/Jakarta**; wizard
menyebutkannya dan mencatat keduanya bisa diubah nanti di Pengaturan. Saat
akun ditautkan melalui cloud, mata uang dan zona waktu yang sama ikut
dikirim.

## Apa yang terjadi setelahnya

Wizard membuka ruang kerja yang dibuatnya (POS Ritel atau POS Restoran
sesuai jenis toko). Dari sana jalur yang disarankan adalah menambah
kategori dan beberapa produk, lalu transaksi uji —
[Transaksi Pertama Anda](../first-sale/) melanjutkan persis di titik itu,
dan menjadi bagian dari rute [Mulai Cepat](../quickstart/).

Lanjut membaca · **Sebelumnya:** [Instalasi](../installation/) · **Berikutnya:** [Aktivasi Lisensi](../activation/)

> last audited 11-10-26 by docs-auditor