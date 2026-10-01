---
title: Selamat Datang di kasir.mu
description: Apa itu kasir.mu dan bagaimana dokumentasi ini disusun.
category: gettingStarted
order: 1
updated: "2026-08-30"
---

## Apa itu kasir.mu?

kasir.mu adalah platform kasir (POS) offline-first untuk kafe, restoran, dan
ritel. Semua fitur tetap berjalan tanpa koneksi internet — transaksi, shift,
stok, dan pengaturan ditulis ke database lokal lebih dulu, lalu tersinkron ke
cloud begitu koneksi kembali.

Tersedia untuk Windows saat ini, dengan macOS, Linux, Android, dan iOS dalam
perjalanan, dan langsung mendukung bahasa Inggris dan Bahasa Indonesia.

## Apa yang membuatnya berbeda

- **Offline-first** — koneksi yang hilang tidak pernah memblokir transaksi.
  Tetap bekerja tanpa koneksi sama sekali, dan semuanya menyusul saat Anda
  kembali online.
- **Native QRIS** — terima pembayaran QR Indonesia secara native, dengan
  kartu dan e-wallet dalam perjalanan, disesuaikan untuk pasar Indonesia.
- **Ruang Kerja** — satu aplikasi, banyak peran: kasir untuk ritel atau
  layanan meja, layar dapur, inventaris, dan admin dalam satu instalasi.
- **Sinkron cloud** — semua register melihat produk, harga, dan stok yang
  sama, dengan tenant yang terisolasi per akun.

## Yang bisa Anda lakukan

- **Menjual** — transaksi ritel atau layanan meja, terima tunai dan
  pembayaran QRIS, dan bagi hari menjadi shift kasir dengan jejak audit
  lengkap.
- **Mengelola stok** — inventaris dengan gudang, transfer, stok opname, dan
  pesanan pembelian.
- **Menjalankan tim** — peran staf dari pemilik hingga auditor, rekonsiliasi
  shift, dan log audit.
- **Memutuskan dengan data** — dasbor penjualan harian, laporan penjualan,
  menu engineering, dan analitik.
- **Berkembang** — loyalitas, kartu hadiah, promosi, kiosk layanan mandiri,
  dan topologi multi-lokasi.

## Perangkat keras & perangkat

kasir.mu bekerja dengan perangkat keras yang sudah ada di kasir: pemindai
barcode, printer struk, laci kas, layar pelanggan, dan pembaca NFC. Perangkat
dikelola sebagai terminal — daftarkan, ikat ke lokasi dan ruang kerja, lalu
sesuaikan fitur per perangkat. Lihat [Terminal](../terminals/) dan
[Lokasi & Topologi](../location/).

## Paket & harga

kasir.mu **gratis selamanya** untuk memulai — satu lokasi, satu register, dan
riwayat penjualan 3 bulan. Paket berbayar menambahkan lebih banyak lokasi dan
register, plus pembayaran QRIS, sinkron cloud, dan otomasi; ruang kerja gudang
mulai paket Premium. Lihat [Lisensi & Paket](../licensing/).

## Pilih titik awal Anda

Wizard pengaturan dan pemilih ruang kerja dibangun di sekitar beberapa bentuk
toko. Pilih milik Anda dan dokumentasi sejajar dengan layar yang benar-benar
akan Anda lihat:

- **Toko ritel atau warung** — kisi produk, barcode, stok. Provisi sebagai
  🛒 **Toko**; bekerja di **POS Ritel**. Mulai dari
  [Transaksi Pertama Anda](../first-sale/) dan
  [Inventaris & Gudang](../inventory/).
- **Restoran atau kafe** — kategori menu, meja, dapur. Provisi sebagai
  🍽️ **Restoran atau kafe**; bekerja di **POS Restoran**, dan tambahkan
  **Layar Dapur** saat juru masak butuh antrean tiket. Mulai dari
  [Transaksi Pertama Anda](../first-sale/) dan [Ruang Kerja](../workspaces/).
- **Gudang atau back office** — stok masuk/keluar dan laporan. Ruang kerja
  **Gudang** mencakup produk, level stok, bundel, dan laporan inventaris;
  manajer bekerja dari **Admin**. Mulai dari
  [Inventaris & Gudang](../inventory/).

Tidak yakin? Jalur [Mulai Cepat](../quickstart/) berlaku untuk semua bentuk
— jalur ini memprovisi salah satu di atas, menambah produk uji, dan menghitung
transaksi uji terlepas dari pilihan Anda.

### Hanya mencoba-coba?

Mengunduh untuk mencoba, tanpa konter sungguhan untuk dipakai — itulah jalur
[Mulai Cepat](../quickstart/), dan jalur ini tidak mengikat apa pun: paket
gratis dimulai saat peluncuran tanpa akun, tanpa kartu, dan tanpa pengaturan
yang tidak bisa Anda bersihkan nanti. Pilih **Offline saja** di wizard,
tambahkan dua produk uji, hitung satu transaksi uji, dan Anda sudah melihat
seluruh putarannya — penjualan, struk, dan penghitungan shift semuanya
berjalan seperti sungguhan. Saat siap, [Aktivasi](../activation/) dan
sinkron cloud mengubahnya menjadi register yang hidup.

## Mulai dari sini

Terburu-buru? [Mulai Cepat](../quickstart/) membawa Anda dari unduhan ke
kasir yang siap dihitung dalam sekitar 15 menit.

1. [Pasang kasir.mu](../installation/) di Windows — paket gratis dimulai saat
   peluncuran pertama, tanpa perlu akun. Platform lain segera hadir.
2. Jalankan [Wizard Pengaturan](../setup-wizard/) — akun (atau offline
   saja), jenis toko, login owner.
3. [Aktifkan kunci lisensi](../activation/) saat siap membuka lebih banyak
   lokasi, pembayaran QRIS, dan sinkron cloud.
4. [Transaksi pertama Anda](../first-sale/) dari ruang kerja yang Anda
   butuhkan — [Ruang Kerja](../workspaces/) mencakup POS Ritel, POS
   Restoran, Layar Dapur, dan Gudang — bahkan tanpa internet.

Akan buka hari ini? Daftar periksa [Hari Pertama Beroperasi](../first-day/)
mencakup verifikasi perangkat, pembukaan shift, dan penyerahan konter
kepada staf.

## Instal ulang atau terkunci?

Register baru, disk direset, atau aplikasi meminta **kode pemulihan**? Itu
normal dan aman: mengaktifkan ulang dengan email + kunci lisensi tetap
menjalankan POS, dan kode 6 digit dari email Anda memulihkan manajemen
lisensi. Setiap rotasi kunci juga mengirim pemberitahuan email, maksimal
sekali per 24 jam. Lihat [Instal ulang atau pemulihan lisensi](../activation/#instal-ulang-atau-pemulihan-lisensi).

## Cara dokumentasi disusun

- **Memulai** — instal, aktivasi, transaksi pertama Anda, dan pilih ruang
  kerja tempat Anda bekerja.
- **Panduan** — alur kerja harian: pembayaran, shift, inventaris, lokasi,
  terminal, dan cara mode offline serta sinkron cloud menjaga Anda tetap
  berjalan.
- **Referensi** — lisensi, paket, dan pengaturan.

## Mendapatkan bantuan

Buntu? Halaman [dukungan](../../support/) menghubungkan Anda ke tim, dan
dokumentasi lainnya mencakup aktivasi, pembayaran, sinkron, dan lainnya.

---

Lanjut membaca · **Berikutnya:** [Mulai Cepat](../quickstart/) — jalur 15 menit menuju konter siap pakai.
