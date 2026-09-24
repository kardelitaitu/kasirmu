---
title: "Aplikasi Kasir Offline: Tetap Jualan Saat Internet Mati"
description: "Aplikasi kasir offline menyimpan transaksi di perangkat lalu mengirimnya saat koneksi kembali. Ini yang perlu Anda cek sebelum memilih."
target: "aplikasi kasir offline"
commercialParent: "kasir-gratis"
pair: "offline-pos-app"
updated: "2026-09-24"
order: 1
---

Warung, toko kelontong, dan kafe kecil jarang punya koneksi internet yang bisa
diandalkan. Hujan deras, kuota habis, router restart, atau jaringan yang melambat
di jam sibuk — semuanya terjadi di hari yang sama dengan hari Anda sedang ramai.
Pertanyaannya bukan apakah aplikasi kasir Anda *bisa* offline, melainkan apa yang
terjadi pada uang dan data Anda selama koneksi itu putus.

## "Bisa offline" dipakai untuk dua hal yang berbeda

Banyak aplikasi mengklaim mendukung mode offline, tetapi yang mereka maksud
berbeda-beda. Satu jenis hanya membuka aplikasi tanpa login ulang; transaksi
tetap gagal saat koneksi terputus. Jenis yang benar-benar offline menyimpan
transaksi **di perangkat** — di penyimpanan lokal HP, tablet, atau komputer —
dan mengirimnya ke server nanti, tanpa menunggu jaringan.

Perbedaan ini baru terasa saat koneksi putus, dan saat itu sudah terlambat untuk
memeriksa. Jadi jangan bertanya "apakah bisa offline", tanyakan "apa yang terjadi
kalau saya menekan tombol Bayar saat tidak ada sinyal".

## Yang harus tetap jalan tanpa internet

Ada empat hal yang tidak boleh berhenti hanya karena koneksi hilang:

1. **Mencatat transaksi.** Pembeli tidak peduli dengan status jaringan Anda.
   Struk tetap harus tercetak atau terkirim, kembalian tetap harus dihitung.
2. **Mengurangi stok.** Kalau stok baru berkurang setelah sinkronisasi besok,
   Anda akan menjual barang yang sudah habis hari ini.
3. **Menghitung uang kasir.** Penjualan hari ini harus bisa ditutup dan
   direkonsiliasi malam ini juga, bukan setelah server menerima datanya.
4. **Menyimpan riwayat.** Transaksi yang sudah terjadi tidak boleh hilang
   karena aplikasi ditutup, perangkat mati, atau baterai habis.

Kalau salah satu dari empat ini bergantung pada koneksi, aplikasi itu bukan
aplikasi kasir offline — hanya aplikasi online yang kebetulan bisa dibuka.

## Di mana data Anda berada selama itu

Skema yang umum dan aman: setiap transaksi ditulis ke penyimpanan lokal
perangkat segera setelah dibayar, lalu ditandai "belum terkirim". Aplikasi
mengirimnya ke server begitu koneksi tersedia, dan menghapus tanda itu setelah
server mengonfirmasi. Selama belum dikonfirmasi, transaksi itu tetap aman di
perangkat.

Dua konsekuensi yang perlu Anda pahami sebelum memilih:

- **Perangkat adalah penyimpanan utama sementara.** Kalau HP hilang atau rusak
  sebelum sinkronisasi, data yang belum terkirim ikut hilang. Karena itu, jangan
  membiarkan antrean menumpuk berminggu-minggu.
- **Satu perangkat bisa menjadi sumber kebenaran yang terlambat.** Di toko dengan
  dua kasir, dua perangkat bisa mencatat penjualan barang yang sama secara
  terpisah. Stok baru benar-benar akurat setelah keduanya terkirim.

## Cara mengujinya sendiri, lima menit

Jangan percaya halaman fitur — termasuk halaman kami. Uji langsung:

1. **Aktifkan mode pesawat**, lalu lakukan satu transaksi nyata. Selesaikan
   sampai struk keluar. Kalau aplikasi menolak atau macet, itu bukan mode offline.
2. **Lihat laporan penjualan harian** dalam keadaan masih offline. Angka tadi
   harus sudah muncul.
3. **Matikan aplikasi dan hidupkan lagi** tanpa koneksi. Transaksi tadi harus
   masih ada. Riwayat yang hilang berarti data hanya disimpan di memori.
4. **Matikan koneksi internet, hidupkan kembali**, dan tunggu. Transaksi harus
   terkirim sendiri tanpa Anda menekan apa pun.
5. **Cek di perangkat lain** (HP Anda, atau komputer di rumah). Setelah
   sinkronisasi, penjualan tadi muncul di sana.

Empat langkah pertama memisahkan aplikasi kasir offline dari aplikasi online
yang meminta maaf. Langkah kelima memastikan sinkronisasi benar-benar bekerja,
bukan hanya mengklaim selesai.

## Yang sering ditanyakan

**Apakah QRIS tetap bisa dipakai?** Pembayaran QRIS memang butuh koneksi, karena
notifikasinya datang dari server bank atau payment gateway. Jadi transaksi QRIS
tidak bisa diselesaikan saat offline. Yang bisa Anda lakukan: catat transaksi
secara offline dan konfirmasi pembayarannya nanti, atau sediakan opsi tunai untuk
keadaan darurat. Ini batasan semua aplikasi, bukan batasan satu merek.

**Berapa lama data bisa ditahan?** Tergantung kapasitas penyimpanan perangkat,
dan hampir selalu lebih lama daripada yang Anda butuhkan. Yang penting adalah
kebiasaan: biasakan tersambung ke internet sekali sehari agar antrean tidak
menumpuk.

**Apakah laporan pajak atau rekap bulanan tetap akurat?** Ya, selama semua
perangkat sempat sinkron sebelum Anda menutup buku. Karena itu, tutup periode
hanya setelah antrean kosong — bukan sekadar setelah tanggal berganti.

## Mulai dari yang gratis dulu

Anda tidak perlu membayar dulu untuk menguji semua ini. Pasang, aktifkan mode
pesawat, dan lakukan lima tes di atas — [kasir.mu bisa dipakai gratis untuk
warung dan toko kecil](/id/kasir-gratis/), dan mode offline-nya aktif tanpa
pengaturan tambahan. Kalau hasilnya tidak meyakinkan, Anda tahu itu dalam lima
menit, bukan setelah setahun berlangganan.
