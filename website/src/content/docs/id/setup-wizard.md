---
title: Wizard Pengaturan
description: Apa yang ditanyakan layar provisi peluncuran pertama dan kapan tiap langkah penting.
category: gettingStarted
order: 4
updated: "2026-09-30"
---

## Kapan munculnya

Wizard berjalan saat peluncuran pertama pemasangan baru. Sampai selesai,
aplikasi menunggu di satu layar ini — tiga langkah mengisi bilah progres
**Akun**, **Toko**, **Owner** ("Langkah N dari 3"), masing-masing diberi
tanda cek saat selesai. Bagian di belakangnya tetap tersembunyi sampai
langkah sebelumnya selesai, kecuali pilihan jenis toko yang tetap terlihat
agar Anda selalu melihat pilihan yang dibuat.

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

Buat login owner: nama Anda, username login, dan PIN bernama empat digit
terisi dua kali. Peran owner memiliki seluruh izin dari awal — lihat
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

> last audited 30-09-26 by docs-auditor
