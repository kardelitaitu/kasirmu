# Intellectual Property (IP) & DJKI Registration Guide

> **Status:** `[DECIDED]` & `[VERIFIED]` against UU No. 28/2014 tentang Hak Cipta, PP No. 28/2019 tentang Jenis dan Tarif PNBP Kemenkumham, and Ditjen Kekayaan Intelektual (DJKI) guidelines.
> **Tujuan:** Mengamankan kepemilikan hukum atas aset kode sumber (*source code*) dan nama dagang *Kasir.mu* di Indonesia dengan biaya paling hemat dan kekuatan pembuktian tertinggi.

---

## 1. Hak Cipta Program Komputer (Software Copyright)

Berdasarkan **UU No. 28 Tahun 2014 tentang Hak Cipta**, Program Komputer adalah salah satu ciptaan yang dilindungi secara otomatis sejak pertama kali diwujudkan dalam bentuk nyata (*declarative system*). Namun, untuk keperluan hukum korporasi, pembukaan rekening perbankan, perlindungan dari pembajakan, dan perizinan usaha, **Surat Pencatatan Hak Cipta dari Ditjen Kekayaan Intelektual (DJKI)** adalah bukti kepemilikan otentik mutlak.

### 1.1 Parameter Permohonan Hak Cipta
* **Portal**: Sistem e-HakCipta DJKI (`https://e-hakcipta.dgip.go.id`).
* **Sistem Proses**: *Persetujuan Otomatis Pelayanan Hak Cipta (POP HC)* — Sertifikat elektronik terbit otomatis dalam hitungan menit setelah pembayaran PNBP terkonfirmasi.
* **Jenis Ciptaan**: **Program Komputer**
* **Sub-Jenis**: Program Komputer / Aplikasi Perangkat Lunak
* **Judul Ciptaan**: 
  > *"Kasir.mu — Cloud-Native Point of Sale (POS) Engine & Multi-Platform Client"*
* **Uraian Singkat Ciptaan**:
  > Perangkat lunak sistem titik penjualan (Point of Sale/POS) berbasis arsitektur Rust dan Tauri yang terintegrasi dengan cloud synchronization, manajemen inventori ritel, pelaporan keuangan, serta antarmuka pembayaran digital untuk pelaku Usaha Mikro, Kecil, dan Menengah (UMKM).
* **Tanggal Pertama Kali Diumumkan**: Tanggal rilis pertama atau tanggal draf awal repo.
* **Negara Tempat Pertama Kali Diumumkan**: Indonesia
* **Pencipta (Creator)**: Nama Lengkap Founder
* **Pemegang Hak Cipta (Copyright Holder)**:
  * *Jika Jalur Opsi A (Lisensi)*: Atas nama **Pribadi Founder** (kemudian dilisensikan ke PT).
  * *Jika Jalur Opsi B (Inbreng)*: Atas nama **PT [Nama PT Anda]** (sebagai penerima hak pengalihan modal).

---

## 2. Rincian Tarif PNBP & Dokumen Unggahan

### 2.1 Tarif PNBP Resmi (PP 28/2019)
| Kategori Pemohon | Biaya PNBP per Permohonan | Syarat Tambahan |
|------------------|---------------------------|-----------------|
| **Usaha Mikro & Kecil (UMK)** | **Rp200.000,-** | Wajib melampirkan Surat Keterangan / Pernyataan UMK bermeterai |
| **Umum / Non-UMK** | **Rp400.000,-** | Tanpa surat keterangan UMK |

### 2.2 Berkas yang Wajib Disiapkan (Format PDF)
1. **Scan KTP Pencipta dan Pemegang Hak Cipta**.
2. **Surat Pernyataan Hak Cipta**:
   * Format standar resmi DJKI bermeterai Rp10.000,- yang menyatakan bahwa ciptaan asli dibuat sendiri dan bukan hasil plagiasi.
3. **Surat Keterangan UMK**:
   * Template tersedia di [`templates/pnbp-umk-statement.md`](./templates/pnbp-umk-statement.md).
4. **Contoh Ciptaan (Deposit Program Komputer)**:
   Sesuai pedoman DJKI, deposit program komputer tidak perlu mengunggah seluruh ratusan ribu baris kode rahasia, melainkan:
   * **Potongan Kode Sumber (Source Code Extract)**: Sekitar 25 halaman pertama dan 25 halaman terakhir dari kode sumber inti (*core module*).
   * **Deskripsi Arsitektur Teknis**: Ringkasan arsitektur (komponen Tauri frontend, Rust core backend, SQLite local database, PostgreSQL cloud bridge).
   * **Screenshot Antarmuka Pengguna (UI)**: 4–8 gambar layar aplikasi (Halaman Login, Layar Kasir / POS Grid, Keranjang Belanja, Pengaturan Toko, Laporan Harian).
   * Seluruhnya digabung dalam **1 file PDF (maksimum 20 MB)**.

---

## 3. Alur Langkah Pendaftaran Hak Cipta (Selesai dalam 1 Hari)

```
[Buka e-hakcipta.dgip.go.id]
      │
      ▼
[Buat Akun Pemohon & Login]
      │
      ▼
[Pilih: Permohonan Baru -> Jenis Ciptaan: Program Komputer]
      │
      ▼
[Input Data Pencipta, Pemegang Hak Cipta, dan Judul Ciptaan]
      │
      ▼
[Upload 4 Dokumen: KTP, Surat Pernyataan DJKI, Surat UMK, PDF Contoh Ciptaan]
      │
      ▼
[Submit Permohonan -> Sistem menerbitkan Kode Billing SIMPADHU]
      │
      ▼
[Bayar Billing PNBP Rp200.000 via m-Banking / Virtual Account]
      │
      ▼
[POP HC Memverifikasi Pembayaran Otomatis]
      │
      ▼
[Download Sertifikat Pencatatan Hak Cipta Elektronik ber-QR Code Resmi Kemenkumham]
```

---

## 4. Perlindungan Merek Dagang (Trademark Strategy)

Hak Cipta melindungi kode program dari penjiplakan, namun **Hak Merek** melindungi nama brand dan identitas komersial *"Kasir.mu"* agar tidak dibajak kompetitor.

### 4.1 Kelas Merek Nizza yang Wajib Didaftarkan
Untuk bisnis SaaS POS terintegrasi hardware:
* **Kelas 09**: 
  * Perangkat lunak komputer kasir yang dapat diunduh; aplikasi sistem kasir bergerak (mobile app); komputer tablet kasir; mesin kasir elektronik; pemindai kode batang (barcode scanner); pencetak struk kasir termal.
* **Kelas 42**: 
  * Perangkat Lunak sebagai Layanan (*Software as a Service — SaaS*) untuk operasional kasir; penyediaan perangkat lunak komputasi awan yang tidak dapat diunduh untuk manajemen toko ritel dan inventori; pemeliharaan dan pembaruan sistem perangkat lunak.

### 4.2 Biaya PNBP Merek (Per Kelas)
* **Tarif Usaha Mikro & Kecil (UMK)**: **Rp500.000,- per kelas** (membutuhkan Surat Keterangan UMK dari Dinas Koperasi/OSS).
* **Tarif Umum**: **Rp1.800.000,- per kelas**.
* *Rekomendasi Awal*: Daftarkan Kelas 09 dan Kelas 42 secara bertahap atau sekaligus menggunakan tarif UMK.

### 4.3 Pengecekan Awal Pangkalan Data (PDKI)
Sebelum mengajukan merek:
1. Buka Pangkalan Data Kekayaan Intelektual (`https://pdki-indonesia.dgip.go.id`).
2. Cari kata kunci: `"Kasirmu"`, `"Kasir.mu"`, dan kata serapan yang berpotensi memiliki persamaan bunyi.
3. Pastikan tidak ada merek terdaftar aktif pada Kelas 09 atau 42 yang berpotensi ditolak karena kemiripan substansial.
