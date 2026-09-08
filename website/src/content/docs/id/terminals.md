---
title: Terminal
description: Daftarkan dan konfigurasikan perangkat yang menjalankan OZ-POS.
category: guides
order: 8
updated: "2026-09-09"
---

<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (1 finding) · Indonesian counterpart of en/terminals.md, same single finding repaired: "Buka layar Terminal" — Terminal berada di bagian Alat navigasi utama, bukan di Pengaturan (ui/src/features/terminals/register.tsx:8-16, section: 'tools'; nav-terminals = Terminal shared.id.ftl:249; nav-section-tools = Alat shared.id.ftl:234). · All other claims verified and left alone (full evidence list in the en/terminals.md stamp): pengenal perangkat hostname/MAC (terminals.ftl:18-19), peran manajer (register.tsx:8), kunci rahasia bersama opsional (terminals.ftl:20), metadata JSON, nonaktif/dihapus permanen (isActive, deleteTerminalScoped), pewarisan fitur paket + Setel ulang semua pengesampingan (TerminalManagementScreen.tsx:403,835-837), lima kelompok pengesampingan persis (FEATURE_GROUPS :38-96), preferensi volume suara/mode gelap/nolkan otomatis timbangan (api/settings.ts:110,116-118), binding ke toko + instance ruang kerja dengan kembali ke pemilih, dasbor multi-toko Terminal Aktif/Daring/Total (multi-store-stat-* multi-location.id.ftl:4-6), tampil di editor topologi dan tersinkron saat terhubung kembali. Label Terima for receiving (purchasing.id.ftl:74) and POS Toko / Tampilan Dapur for bindings use the app's own id labels. · Replacement sentence mirrors the page's own patterns; rest untouched. -->

## Apa itu terminal

Terminal — register yang Anda lihat di topologi — adalah perangkat yang
menjalankan OZ-POS: register kasir, tablet, atau layar dapur. Setiap terminal
punya nama dan pengenal perangkat (hostname atau alamat MAC) yang dilaporkan
otomatis oleh aplikasi. Mengelola terminal memerlukan peran manajer.

## Mendaftarkan terminal

Buka layar Terminal dari bagian Alat pada navigasi utama, lalu daftarkan
perangkat. Beri nama yang mudah dibaca
("Kasir Depan") dan pengenal perangkat, serta opsional kunci rahasia bersama
untuk autentikasi sinkron dan metadata JSON. Terminal dapat dinonaktifkan
atau dihapus kemudian; penghapusan bersifat permanen.

## Pengesampingan fitur

Secara bawaan, terminal mewarisi semua fitur yang diaktifkan paket Anda.
Pengesampingan memaksa fitur aktif atau nonaktif hanya untuk satu perangkat.
Pengesampingan dikelompokkan sesuai cara aplikasi mengaturnya:

- **Penjualan** — ritel, restoran, mesin diskon dan pajak, promosi, bundel
  produk, loyalitas, layar dapur, dan manajemen meja
- **Pembayaran** — tunai, kartu, dan multi-mata uang
- **Inventaris & Produk** — pelacakan inventaris, varian produk, kategori,
  dan pemindaian barcode
- **Perangkat Keras** — pencetakan struk, laci kas, tampilan pelanggan, dan
  pembaca NFC
- **Staf & Keamanan** dan **Sistem**

Contoh penggunaan: nonaktifkan pembayaran kartu di kiosk layanan mandiri,
atau nyalakan layar dapur untuk satu layar. Setel ulang semua pengesampingan
untuk mengembalikan terminal ke bawaan paket.

## Preferensi terminal

Setiap terminal menyimpan preferensinya sendiri: **volume suara**, **mode
gelap**, dan **nolkan otomatis timbangan saat boot**. Ini mengikuti
perangkat, bukan pengguna yang masuk, sehingga kasir dan layar dapur masing-
masing berperilaku sesuai kebutuhan lokasinya.

## Binding perangkat

Ikat terminal ke toko dan instance ruang kerja agar perangkat langsung membuka
layar itu alih-alih pemilih — layar dapur yang selalu Tampilan Dapur, kasir
yang selalu POS Toko. Menghapus binding mengembalikan perangkat ke pemilih
ruang kerja.

## Status terminal

Dasbor multi-toko melacak terminal **aktif**, **daring**, dan **total** serta
menampilkan status terminal per toko, sehingga Anda dapat melihat sekilas
perangkat mana yang aktif dan bekerja. Perangkat melapor saat terhubung
kembali, dan terminal yang lama offline terlihat di sini sebelum menyebabkan
kejutan di kasir.

## Terminal dalam topologi

Terminal muncul di editor topologi bersama toko dan gudang, dan tata letak
tersinkron ke setiap perangkat saat terhubung kembali. Lihat
[Toko & Topologi](../stores/) dan [Ruang Kerja](../workspaces/).

> last audited 09-09-26 by docs-auditor
