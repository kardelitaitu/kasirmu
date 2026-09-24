# Entity Setup — PT Perorangan (Panduan Pendirian Entitas)

> **Status:** `[DECIDED]` & `[VERIFIED]` against UU No. 40/2007 jo. UU No. 6/2023 (UU Cipta Kerja), PP No. 8/2021, and PP No. 7/2021.
> **Tujuan:** Menetapkan badan hukum resmi Perseroan Terbatas Perorangan secara mandiri, cepat, berbiaya minimal, dan memiliki fondasi legal yang kokoh.

---

## 1. Penentuan Arsitektur Modal (Capital Architecture)

Sebelum mengisi formulir pendaftaran di Kemenkumham, founder harus memilih salah satu dari dua jalur struktur modal berikut:

| Parameter | Jalur A (Direkomendasikan): Clean Cash + Lisensi | Jalur B: Inbreng Biaya Riil (Out-of-Pocket) |
|---|---|---|
| **Modal Disetor** | **Rp50.000.000,- s.d. Rp100.000.000,-** | **Rp350.000.000,- s.d. Rp400.000.000,-** (~$25,000) |
| **Bentuk Setoran** | 100% Tunai via transfer bank saat rekening PT buka | Non-tunai (Inbreng aset software berbasis bukti kas keluar) |
| **Status Skala Usaha** | **Usaha Mikro** (Modal ≤ Rp1 Miliar) | **Usaha Mikro** (Modal ≤ Rp1 Miliar) |
| **Status Hak Cipta** | Tetap atas nama pribadi founder; dilisensikan eksklusif ke PT | Dialihkan hak kepemilikannya menjadi aset perseroan |
| **Beban KJPP** | **Nol (Tidak perlu penilai publik)** | Rendah / Defensif (didukung bukti kuitansi riil) |
| **Risiko Audit DJP** | **Nol / Paling Aman** | Rendah (karena berbasis bukti kas keluar riil) |

> [!IMPORTANT]
> **Mengapa Rencana Awal Rp3,1 Miliar Ditinggalkan:**
> 1. Angka Rp3,1 Miliar didominasi klaim "opportunity cost" jam kerja sebesar $246,000 yang **secara mutlak ditolak oleh Ditjen Pajak** sebagai biaya perolehan aset.
> 2. Menetapkan modal Rp3,1 Miliar tanpa laporan resmi dari Kantor Jasa Penilai Publik (KJPP) akan memicu surat cinta SP2DK dari KPP Pratama dan potensi tuduhan pelaporan harta fiktif pada SPT Pribadi.
> 3. Di bawah rezim PPh Final 0.5% (PP 55/2022), amortisasi aset software Rp3,1 Miliar **tidak dapat dipakai untuk mengurangi pajak**.
> 
> **Pilihan Terbaik:** Gunakan **Jalur A** (Rp50–100 Juta Tunai) dengan perjanjian lisensi software eksklusif dari founder ke perseroan.

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
   * Modal Dasar dan Modal Disetor:
     * Jika Jalur A: Masukkan nominal misal **Rp50.000.000,-** (Lima Puluh Juta Rupiah).
     * Jika Jalur B: Masukkan nominal misal **Rp350.000.000,-** (Tiga Ratus Lima Puluh Juta Rupiah).
6. **Input 5 Kode KBLI**:
   Masukkan 5 kode KBLI berikut (uraian detail di [`kbli-codes.md`](./kbli-codes.md)):
   * `62010` (Aktivitas Pemrograman Komputer)
   * `58290` (Penerbitan Perangkat Lunak Lainnya)
   * `63102` (Aktivitas Hosting dan Fasilitas Terkait)
   * `46511` (Perdagangan Besar Komputer, Perlengkapan Komputer dan Piranti Lunak)
   * `47401` (Perdagangan Eceran Komputer dan Perlengkapannya)
7. **Penerbitan Sertifikat Pendirian**:
   Setelah konfirmasi, sistem langsung menerbitkan **Sertifikat Pernyataan Pendirian Perseroan Perorangan** yang ditandatangani secara elektronik oleh Menteri Hukum dan HAM RI lengkap dengan nomor registrasi (AHU-xxxx.AH.xx.xx.Tahun). Download dan cetak dokumen ini.

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
   OSS menerbitkan dokumen legalitas tunggal: **Nomor Induk Berusaha (NIB)**.

---

## 4. Kepastian Hukum: Fungsi NIB sebagai API-U (Hak Impor)

> [!NOTE]
> **Jawaban Resmi atas Pertanyaan Impor:**
> Berdasarkan **Pasal 175 PP No. 5 Tahun 2021** jo. **Permendag No. 75 Tahun 2018**:
> * **NIB secara otomatis berlaku sebagai Angka Pengenal Importir Umum (API-U)** dan Hak Akses Kepabeanan ke Ditjen Bea dan Cukai.
> * Anda **TIDAK PERLU** mengajukan izin API terpisah ke instansi bea cukai.
> * *Namun*, untuk memasukkan perangkat kasir berkoneksi nirkabel (Wi-Fi/Bluetooth/4G), tetap berlaku kewajiban sertifikasi tipe dari Ditjen SDPPI Kominfo sebelum barang dapat dirilis dari pelabuhan (lihat [`kbli-codes.md`](./kbli-codes.md)).

---

## 5. Langkah 3: Pembukaan Rekening Giro Perusahaan (Corporate Bank Account)

Setelah Sertifikat AHU dan NIB terbit, perseroan wajib memiliki rekening bank terpisah atas nama PT untuk menyetorkan modal dan menampung omzet usaha.

### 5.1 Pilihan Bank Rekomendasi
* **BCA**: Fasilitas KlikBCA Bisnis sangat stabil untuk integrasi payment gateway.
* **Bank Mandiri**: MCM (Mandiri Cash Management) ramah untuk korporasi baru.
* **BRI / Bank Jatim**: Biaya administrasi ringan dan akses luas ke UMKM.

### 5.2 Berkas Persyaratan ke Kantor Cabang Bank
1. Cetak Asli Sertifikat Pernyataan Pendirian Perseroan Perorangan dari AHU Kemenkumham.
2. Cetak Dokumen NIB ber-QR Code dari OSS.
3. Cetak Surat Keterangan Terdaftar (SKT) & Kartu NPWP Badan dari DJP.
4. KTP dan Kartu NPWP Asli milik Direktur Utama.
5. Nomor Induk Berusaha (NIB) lampiran KBLI.
6. Setoran awal tunai pembukaan giro (umumnya Rp500.000 s.d. Rp1.000.000 tergantung bank).

### 5.3 Pelaksanaan Setoran Modal
Setelah rekening giro atas nama perseroan resmi aktif:
1. Lakukan transfer dari rekening pribadi founder ke rekening giro PT sebesar nilai modal disetor yang tercantum di AHU (misal: Rp50.000.000,-).
2. Tulis berita transfer: *"Setoran Modal Awal Perseroan PT [Nama PT]"*.
3. Simpan mutasi rekening koran bulan pertama tersebut di dalam arsip permanen hukum perseroan sebagai bukti materil bahwa kewajiban penyetoran modal telah terpenuhi 100%.
