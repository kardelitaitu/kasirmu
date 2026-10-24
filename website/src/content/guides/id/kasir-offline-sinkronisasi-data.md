---
title: "Data Penjualan Saat Listrik & Internet Padam"
description: "Saat listrik padam atau baterai kasir habis mendadak, data transaksi Anda harus tetap aman. Ini cara kerja sinkronisasi kasir offline."
target: "kasir offline sinkronisasi data"
commercialParent: "features"
pair: "pos-data-sync-power-outage"
updated: "2026-10-24"
order: 3
---

Bagi pengelola toko ritel, kafe, dan warung makan, pemadaman listrik mendadak adalah salah satu mimpi buruk operasional terbesar. Lampu toko padam, pendingin udara mati, dan layar tablet kasir mendadak gelap karena kehabisan daya baterai cadangan. Di tengah kepanikan tersebut, pertanyaan paling krusial yang muncul di benak pemilik toko adalah: *Apakah transaksi yang baru saja diselesaikan hilang? Apakah pembukuan kasir hari ini akan mengalami selisih fatal?*

Jika kasir Anda berbasis peramban web biasa yang mengandalkan server jarak jauh, pemadaman mendadak di tengah transaksi sering kali berujung pada data menggantung: uang tunai sudah diterima dari pelanggan, namun server belum sempat mencatatnya.

Memahami bagaimana aplikasi kasir modern mengamankan data transaksi saat terjadi pemadaman listrik atau putusnya jaringan internet akan membantu Anda memilih teknologi yang benar-benar melindungi kelangsungan bisnis Anda.

## Risiko Dirty Shutdown pada Perangkat Kasir

Dalam istilah rekayasa perangkat lunak, mati listrik secara tiba-tiba saat sistem sedang memproses data disebut sebagai *dirty shutdown*. Pada sistem penyimpanan yang rapuh, dirty shutdown dapat menyebabkan:

1. **Kerusakan File Database (Database Corruption):** File database yang sedang ditulis terpotong di tengah jalan sehingga struktur indeks internalnya rusak dan tidak bisa dibuka kembali saat komputer dinyalakan.
2. **Transaksi Setengah Jadi (Partial Writes):** Barang belanjaan sudah berkurang dari stok gudang, namun nominal pembayaran tunai belum sempat tercatat di laporan harian.
3. **Data Hilang Permanen:** Transaksi yang dilakukan selama jam sibuk mendadak lenyap karena hanya tersimpan di memori sementara (RAM) tanpa sempat ditulis ke penyimpanan permanen.

Aplikasi kasir yang andal dirancang sejak awal untuk menganggap pemadaman listrik sebagai peristiwa normal yang pasti terjadi, bukan anomali yang mengejutkan.

## Prinsip Ketahanan Data: SQLite WAL dan Jaminan ACID

Aplikasi kasir local-first yang tangguh memanfaatkan mesin database berstandar industri dengan jaminan ACID (*Atomicity, Consistency, Isolation, Durability*) menggunakan mekanisme **WAL (Write-Ahead Logging)**:

- **Atomis (Semua atau Tidak Sama Sekali):** Sebuah transaksi checkout melibatkan beberapa pembaruan sekaligus: pengurangan stok produk, penambahan uang di laci kasir, pencetakan nomor urut struk, dan pencatatan audit log kasir. Melalui prinsip atomis, seluruh langkah ini dieksekusi sebagai satu paket utuh di dalam sebuah transaksi database. Jika listrik padam tepat sebelum transaksi tuntas, sistem membatalkan seluruh perubahan parsial sehingga database tetap bersih.
- **Jurnal Terlebih Dahulu (Write-Ahead Log):** Sebelum data transaksi dimasukkan ke file database utama, perubahan dicatat terlebih dahulu secara sekuensial ke dalam file jurnal khusus (*WAL file*). Penulisan jurnal ini berlangsung hanya dalam hitungan milidetik.
- **Pemulihan Otomatis Tanpa Teknisi:** Saat listrik menyala kembali dan aplikasi kasir dibuka, mesin database secara otomatis memeriksa jurnal WAL. Jika ada transaksi yang telah berhasil dicatat sebelum listrik padam, data tersebut langsung dipulihkan secara instan tanpa perlu campur tangan pemilik toko atau teknisi IT.

## Pola Antrean Transaksional (Transactional Outbox)

Setelah data penjualan berhasil ditulis secara aman di perangkat lokal, bagaimana data tersebut bisa sampai ke server cloud tanpa risiko dobel?

Aplikasi kasir modern menggunakan pola **Transactional Outbox**. Di dalam transaksi lokal yang sama dengan pencatatan penjualan, sistem juga menulis satu baris data ke dalam tabel antrean keluar (`outbox`). 

Ketika jaringan internet terputus:
- Penjualan tetap berjalan normal dan struk belanja tetap tercetak ke printer thermal lokal.
- Baris-baris transaksi baru terus bertambah di dalam tabel antrean lokal dengan status `pending`.
- Kasir dapat terus melayani ratusan pelanggan tanpa hambatan.

Ketika koneksi internet pulih:
- Layanan sinkronisasi latar belakang (*background sync daemon*) mendeteksi kehadiran sinyal internet.
- Antrean transaksi dikirimkan satu per satu secara berurutan (*monotonic sequential queue*) ke cloud server.
- Setelah cloud server mengonfirmasi penerimaan data, status antrean lokal diubah menjadi `synced`.

## Proteksi Transaksi Dobel dengan Idempotency

Koneksi internet seluler di lapangan sering kali mengalami gangguan di tengah jalan: perangkat kasir berhasil mengirimkan transaksi ke server, namun sinyal terputus tepat sebelum server sempat mengirimkan konfirmasi balik ke perangkat kasir.

Tanpa penanganan khusus, aplikasi kasir yang mencoba mengirim ulang data berisiko mencatat satu transaksi yang sama sebanyak dua kali di server pusat, yang mengakibatkan laporan keuangan melonjak palsu.

Untuk mencegah hal ini, setiap transaksi kasir diberi identitas unik berbasis waktu universal (UUIDv7) yang berfungsi sebagai **Idempotency Key**. Ketika kasir mengirim ulang antrean yang sama setelah koneksi pulih, server memeriksa kunci idempoten tersebut. Jika server mengenali bahwa transaksi tersebut sudah pernah disimpan sebelumnya, server langsung mengembalikan respons sukses tanpa membuat baris transaksi ganda.

## Panduan Kasir Saat Terjadi Pemadaman Listrik

Jika toko Anda mengalami pemadaman listrik mendadak di tengah jam kerja, ikuti langkah praktis berikut:

1. **Gunakan Perangkat Kasir Baterai:** Pastikan tablet kasir memiliki kapasitas baterai yang cukup untuk beroperasi 4–8 jam tanpa sambungan listrik PLN.
2. **Gunakan Printer Thermal Bluetooth:** Printer kasir portabel bertenaga baterai memungkinkan Anda tetap menyerahkan bukti pembayaran fisik kepada pembeli.
3. **Tetap Layani Pembayaran Tunai:** Lanjutkan transaksi seperti biasa. Jangan ragu mencatat penjualan di kasir offline karena seluruh perhitungan harga dan riwayat tetap tersimpan utuh di memori lokal.
4. **Hindari Mematikan Paksa Berulang Kali:** Jika layar perangkat mati mendadak karena kehabisan baterai, sambungkan ke powerbank atau genset toko sebelum menyalakannya kembali.

## Lindungi Pembukuan Bisnis Anda

Kehilangan data transaksi berarti kehilangan kendali atas uang dan stok toko Anda. Memilih sistem kasir dengan [fitur lengkap kasir offline](/id/features/) memberikan jaminan bahwa pembukuan usaha Anda tetap utuh, akurat, dan terus berjalan meski listrik padam dan koneksi internet terputus total.
