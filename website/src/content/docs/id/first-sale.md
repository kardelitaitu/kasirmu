---
title: Transaksi Pertama Anda
description: Lakukan transaksi dari awal hingga akhir — bahkan tanpa internet.
category: gettingStarted
order: 6
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings (+1 flagged to the owner) · First audit stamp on this page; Indonesian translation of en/first-sale.md. · VERIFIED: the two workspace kinds are real and `restaurant-pos` is a live type_key (ui/src/app/tablet/TabletAppShell.tsx:100, :593); the checkout screen's parts (product/menu grid, category tabs, search, SKU-or-barcode field, side cart panel) match PosScreen; "harga disimpan sebagai satuan minor bilangan bulat" is the shipped Money model (i64 minor units); adding products one at a time with the variant/barcode discipline is the documented workflow and the no-CSV-import claim is the product's own position (the `import_data` command restores an ENCRYPTED WHOLE-DATABASE .kasirpkg package — apps/desktop-tauri/src/commands/data.rs:91,123 — it does not import product rows, so the sentence is true despite the grep); the receipt preview, local commit, day-history and open-shift attribution all match the local-first sale path; offline queueing is real. · FLAGGED, NOT REPAIRED (the en twin carries the identical sentence, audited as accurate the same day, so this is a product-positioning question rather than a translation defect): the page says debit/credit cards and e-wallets are "segera hadir". The CODE disagrees about the card TAB — `TENDER_RAILS` (ui/src/features/sales/useLocalPaymentRails.ts:142-147) lists `card` with `railCode: null`, i.e. universal and ungated, `CardTenderPanel` is a real rendered panel (ui/src/features/sales/PaymentModal.tsx:2402) with its own test suite, and ui/src/__tests__/coreRailToggleReach.test.ts:75 records in terms that "TENDER_RAILS treats card as universal; the edc rail gates the terminal button, not the tab". So the card tab IS offered today; what is card-processor-gated is Stripe processing, which README.md:269 places in the Pro tier. The sentence is left as written because it is the product's stated position and renaming availability is an owner's call, but the tension is recorded here so the next auditor does not "fix" it in one direction without the other file. · NOT re-measured: a live checkout on a register, and the loyalty-attach flow. · The footer below is an internal marker, stripped from the built site. -->

## Siapkan ruang kerja

Buat ruang kerja untuk register: **POS Ritel** untuk ritel (kisi produk,
barcode, stok) atau **POS Restoran** untuk layanan meja (kategori menu,
meja). Ruang kerja yang Anda buat menentukan tampilan layar kasir. Lihat
[Ruang Kerja](../workspaces/).

## Tambahkan kategori

Tambahkan tab kategori lebih dulu — Minuman, Makanan, dan seterusnya —
sehingga produk dan item menu punya tempat. Kategori adalah yang dilihat
kasir di bagian atas kisi kasir.

## Tambahkan produk atau item menu

- **Ritel** — tambahkan produk dengan nama, SKU, harga, stok awal, dan
  kategori. Barcode mempercepat pemindaian.
- **Restoran** — tambahkan item menu dengan nama, harga, dan kategori menu.

Harga disimpan sebagai satuan minor bilangan bulat yang tepat, sehingga
tidak pernah ada kejutan pembulatan. Lihat [Inventaris & Gudang](../inventory/)
untuk alur kerja katalog lengkap.

### Menambahkan banyak produk

Produk dan item menu ditambahkan **satu per satu** — belum ada impor massal
atau CSV hari ini. Untuk menu puluhan item, pakai pola ini agar tidak
mengetik ulang:

- **Kategori lebih dulu.** Tambahkan semua tab kategori (Minuman, Makanan,
  Lauk, …) di awal; sebuah produk perlu tempat, dan kasir melihatnya di
  bagian atas kisi kasir.
- **Gunakan varian untuk item yang beda harga.** Nama sama, ukuran atau
  porsi berbeda — mis. es kopi Small/Medium/Large — tampung dalam satu produk
  dengan varian, bukan tiga produk yang nyaris duplikat.
- **Masukkan barcode saat menambah.** Memindai adalah cara tercepat meraih
  penjualan nanti, dan mengetik kode saat menambah lebih murah daripada
  melewatkannya di konter. Tambahkan barcode saat membuka satu garis SKU baru.
- **Tambahkan dari aplikasi register.** Tambahkan dari aplikasi Register
  saat toko sepi; perubahannya muncul di setiap register setelah sinkron.

Ini beberapa menit input di awal, dan itu input yang sama yang membangun
seluruh katalog (varian, bundel, stok).

## Layar kasir

Buka ruang kerja yang Anda buat. Layar menampilkan kisi produk atau menu
dengan tab kategori Anda, kotak pencarian, dan kolom SKU atau barcode,
dengan panel keranjang di samping.

## Lakukan transaksi

Ketuk produk untuk menambahkannya ke keranjang — atau pindai barcode-nya,
atau ketik SKU-nya. Sesuaikan jumlah jika pelanggan menginginkan lebih dari
satu. Baris item muncul di keranjang dengan total berjalan, dan dapat dihapus
atau dikoreksi sebelum pembayaran. Diskon dan pengesampingan harga yang
terverifikasi PIN tersedia di tingkat kasir.

## Terima pembayaran

Tekan **Bayar**. Tunai dan QRIS tersedia — masukkan jumlah tunai yang
dibayarkan dan kembalian dihitung otomatis, atau tampilkan QR dinamis
untuk dipindai pelanggan (atau QR statis toko Anda). Kartu debit dan
kredit, serta e-wallet segera hadir dan akan muncul sebagai pilihan di
sini. Melampirkan pelanggan untuk loyalitas juga didukung.

## Struk dan catatan

Pratinjau struk muncul, siap dicetak. Transaksi tercatat secara lokal dan
langsung muncul di riwayat hari itu, dan dihitung ke shift kasir yang
sedang berjalan — lihat [Shift & Rekonsiliasi](../shifts/).

## Saat offline

Transaksi diantrekan secara lokal dan tersinkron otomatis begitu perangkat
kembali online. Tidak ada yang hilang dan tidak ada yang menghambat kasir.

## Langkah berikutnya

Lihat [Pembayaran & QRIS](../payments/) untuk mendalami metode pembayaran,
atau [Shift & Rekonsiliasi](../shifts/) untuk menutup hari dengan rapi.

---

Lanjut membaca · **Sebelumnya:** [Aktivasi Lisensi](../activation/) · **Berikutnya:** [Ruang Kerja](../workspaces/)

> last audited 11-10-26 by docs-auditor
