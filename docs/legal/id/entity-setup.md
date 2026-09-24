# Entity Setup — PT Perorangan (Panduan Pendirian Entitas)

> **Status:** `[DECIDED]` & `[VERIFIED]` against UU No. 40/2007 jo. UU No. 6/2023 (UU Cipta Kerja), PP No. 8/2021, and PP No. 7/2021.
> **Tujuan:** Menetapkan badan hukum resmi Perseroan Terbatas Perorangan secara mandiri, cepat, berbiaya minimal, dan memiliki peta jalan permodalan bertahap (Pendirian Bersih Hari Ini ➔ Inbreng Menyusul Nanti).

---

## 1. Peta Jalan Permodalan 2 Tahap (The 2-Phase Capital Roadmap)

Untuk mendirikan badan hukum yang kuat tanpa membuang uang belasan juta rupiah untuk jasa penilai publik di awal, kasir.mu menerapkan **Strategi Permodalan 2 Tahap**:

```
[TAHAP 1: SEKARANG — PENDIRIAN AWAL BERSIH]
 ├── Modal Disetor: Rp50.000.000,- Tunai (100% Saham Pendiri Tunggal)
 ├── Status Usaha: Usaha Mikro (Kriteria Modal ≤ Rp1 Miliar)
 ├── Hak Cipta Software: Terdaftar atas nama Pribadi Founder (e-HakCipta Rp200.000)
 ├── Hubungan Software: Perjanjian Lisensi Eksklusif (Founder -> PT)
 └── HASIL: PT langsung sah 100%, NIB terbit, rekening giro buka, ZERO biaya KJPP.

                               │
                               ▼ (Setelah 1–2 Tahun: Omzet Rutin / Ada Investor)

[TAHAP 2: MASA DEPAN — INBRENG MENYUSUL (SUBSEQUENT INBRENG)]
 ├── Status: Peningkatan Modal Disetor via "Pernyataan Perubahan di AHU" (Voucher Rp50.000)
 ├── Metode Valuasi: Income Approach / DCF (Berdasarkan omzet langganan SaaS & jumlah merchant)
 ├── Pembiayaan KJPP: Dibayar resmi dari kas operasional PT (Bukan uang pribadi founder)
 └── HASIL: Valuasi software melesat ke angka Miliaran Rupiah secara sah & diakui DJP.
```

### Mengapa Skema Ini yang Terbaik?
1. **Tidak Membuang Uang Belasan Juta di Awal**: Biaya penilai publik (KJPP) sebesar Rp10–20 juta tidak perlu dikeluarkan saat belum ada pendapatan. Uang disimpan untuk operasional dan akuisisi merchant.
2. **Kecepatan Peluncuran Produk**: PT bisa beroperasi komersial minggu ini juga tanpa harus menunggu 2–3 minggu proses appraisal repo Git.
3. **Valuasi Jauh Lebih Tinggi di Masa Depan**: Menilai software yang sudah memiliki ratusan merchant berbayar (*Monthly Recurring Revenue*) menghasilkan angka valuasi yang jauh lebih tinggi dan defensif dibanding hanya menilai baris kode di Git.

---

## 2. Langkah 1: Pendaftaran Badan Hukum di AHU Kemenkumham

Biaya PNBP: **Rp50.000,-**  
Waktu: **±15 Menit** (Sistem Otomatis)

1. **Akses Portal AHU**:
   Buka portal resmi Kementerian Hukum dan HAM: `https://ahu.go.id` → Pilih menu **Perseroan Perorangan** (`https://ptp.ahu.go.id`).
2. **Registrasi Akun Pemohon**:
   Daftar menggunakan NIK (KTP), Nomor NPWP Pribadi, dan alamat email aktif.
3. **Pembelian Voucher PNBP**:
   * Masuk ke menu pemesanan voucher.
   * Pilih jenis PNBP: *Pernyataan Pendirian Perseroan Perorangan*.
   * Lakukan pembayaran voucher sebesar **Rp50.000,-** melalui kode billing SIMPADHU (bisa via Virtual Account, mobile banking, atau ATM).
4. **Pengecekan dan Pengisian Nama PT**:
   * Ketentuan Nama: Sesuai PP No. 43/2011, nama PT yang didirikan WNI wajib menggunakan **minimal 3 (tiga) kata dalam Bahasa Indonesia**, tidak bertentangan dengan ketertiban umum, dan belum digunakan perseroan lain.
   * Contoh nama yang sah:
     * *PT Solusi Kasir Pintar*
     * *PT Kasir Digital Nusantara*
     * *PT Inovasi Kasirmu Indonesia*
5. **Pengisian Data Domisili & Modal**:
   * Alamat domisili lengkap perseroan.
   * **Modal Dasar dan Modal Disetor**: Masukkan nominal **Rp50.000.000,-** (Lima Puluh Juta Rupiah).
   * Nilai nominal per lembar saham: Rp100.000,- (500 lembar saham dimiliki 100% oleh Pendiri).
6. **Input 5 Kode KBLI**:
   Masukkan 5 kode KBLI berikut (uraian detail di [`kbli-codes.md`](./kbli-codes.md)):
   * `62010` (Aktivitas Pemrograman Komputer)
   * `58290` (Penerbitan Perangkat Lunak Lainnya)
   * `63102` (Aktivitas Hosting dan Fasilitas Terkait)
   * `46511` (Perdagangan Besar Komputer, Perlengkapan Komputer dan Piranti Lunak)
   * `47401` (Perdagangan Eceran Komputer dan Perlengkapannya)
7. **Penerbitan Sertifikat Pendirian**:
   Setelah konfirmasi, sistem langsung menerbitkan **Sertifikat Pernyataan Pendirian Perseroan Perorangan** yang ditandatangani secara elektronik oleh Menteri Hukum dan HAM RI lengkap dengan nomor registrasi (AHU-xxxx.AH.xx.xx.Tahun). Unduh dan cetak dokumen ini.

---

## 3. Langkah 2: Aktivasi NIB & NPWP Badan di OSS-RBA

Biaya: **Gratis (Rp0,-)**  
Waktu: **±20 Menit** (Persetujuan Otomatis)

1. **Akses Portal OSS**:
   Buka portal resmi Kementerian Investasi/BKPM: `https://oss.go.id`.
2. **Pendaftaran Hak Akses**:
   * Pilih jenis pelaku usaha: **Usaha Mikro dan Kecil (UMK)**.
   * Pilih bentuk badan usaha: **Perseroan Perorangan**.
   * Masukkan NIK founder dan nomor pendaftaran AHU dari Sertifikat Pendirian Kemenkumham. Data perseroan akan tersinkronisasi otomatis.
3. **Penerbitan NPWP Badan Otomatis**:
   Sistem OSS terintegrasi secara *real-time* dengan database Direktorat Jenderal Pajak (DJP). NPWP Badan perseroan (format 16 digit baru dan 15 digit lama) langsung diterbitkan secara otomatis di layar OSS tanpa perlu datang ke KPP.
4. **Perekaman Kegiatan Usaha (5 KBLI)**:
   Tambahkan 5 kegiatan usaha sesuai KBLI yang didaftarkan di AHU.
   * **Deskripsi Usaha Standar**:
     > *"Menyediakan platform Point of Sale (POS) berbasis komputasi awan (cloud) untuk manajemen penjualan kasir, inventori stok ritel, dan integrasi pembayaran nontunai, serta menyediakan perangkat kasir pendukung untuk pelaku usaha mikro, kecil, dan menengah."*
   * **Persetujuan Tata Ruang (KKPR)**: Untuk skala UMK, Konfirmasi Kesesuaian Kegiatan Pemanfaatan Ruang (KKPR) disetujui otomatis oleh sistem.
   * **Komitmen Lingkungan (SPPL)**: Sistem OSS secara otomatis menerbitkan Surat Pernyataan Kesanggupan Pengelolaan dan Pemantauan Lingkungan Hidup (SPPL) otomatis untuk skala risiko rendah.
5. **Penerbitan Nomor Induk Berusaha (NIB)**:
   OSS menerbitkan dokumen legalitas tunggal: **Nomor Induk Berusaha (NIB)** yang juga berlaku sebagai API-U (Angka Pengenal Importir Umum) dan Akses Kepabeanan Bea Cukai.

---

## 4. Langkah 3: Pembukaan Rekening Giro Bank & Penyetoran Modal

Setelah Sertifikat AHU dan NIB terbit, perseroan membuka rekening giro bank atas nama PT.

### 4.1 Dokumen Pembukaan Rekening ke Bank (BCA / Mandiri / BRI)
1. Cetak Asli Sertifikat Pernyataan Pendirian Perseroan Perorangan dari AHU Kemenkumham.
2. Cetak Dokumen NIB ber-QR Code dari OSS.
3. Cetak Surat Keterangan Terdaftar (SKT) & Kartu NPWP Badan dari DJP.
4. KTP dan Kartu NPWP Asli milik Direktur Utama.
5. Setoran awal tunai pembukaan giro (umumnya Rp500.000 s.d. Rp1.000.000,- tergantung bank).

### 4.2 Pelaksanaan Setoran Modal Tunai
Setelah rekening giro atas nama PT aktif:
1. Transfer dana modal disetor dari rekening pribadi founder ke rekening giro PT sebesar **Rp50.000.000,-**.
2. Berita transfer: *"Setoran Modal Awal Perseroan PT [Nama PT]"*.
3. Simpan mutasi rekening koran tersebut di dalam arsip permanen hukum perseroan sebagai bukti materil bahwa modal telah disetor 100%. Uang Rp50 juta ini tetap milik Anda dan digunakan untuk kas operasional perusahaan.

---

## 5. Prosedur Inbreng Menyusul di Masa Depan (Tahap 2)

Ketika kasir.mu sudah berjalan 1–2 tahun, memiliki omzet stabil, atau bersiap menerima suntikan dana investor:

1. **Penugasan KJPP**:
   * Direksi PT menunjuk KJPP resmi berizin Penilaian Bisnis dari Kemenkeu.
   * Biaya jasa appraisal dibayarkan langsung dari rekening giro PT dan dibukukan sebagai beban operasional PT.
   * KJPP menerbitkan Laporan Penilaian Resmi berbasis *Income Approach / Relief from Royalty* (misal menilai software sebesar Rp3 Miliar).
2. **Pengajuan Perubahan di AHU Online**:
   * Login ke `https://ptp.ahu.go.id`.
   * Beli voucher PNBP: *Pernyataan Perubahan Perseroan Perorangan* (**Rp50.000,-**).
   * Pilih menu **Perubahan Modal Disetor** ➔ Masukkan penambahan modal inbreng sebesar angka laporan KJPP.
   * Sistem AHU menerbitkan **Sertifikat Pernyataan Perubahan Perseroan Perorangan**.
3. **Sinkronisasi OSS & Perbankan**:
   * Buka OSS, lakukan sinkronisasi data modal usaha terbaru.
   * Serahkan salinan sertifikat perubahan ke bank tempat rekening giro berada.
4. **Pencatatan Akuntansi**:
   * Di neraca PT dibukukan: Debit Aset Tak Berwujud (Software) Rp3 Miliar, Kredit Tambahan Modal Disetor Rp3 Miliar.
