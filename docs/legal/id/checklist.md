# Master Legal & Regulatory Checklist (Daftar Periksa Eksekusi Legal)

> **Status:** `[DECIDED]` & `[VERIFIED]` against prevailing Indonesian Corporate, Tax, Intellectual Property, and Telecommunications regulations.
> **Tujuan:** Panduan eksekusi langkah-demi-langkah pendirian usaha kasir.mu hingga siap beroperasi secara komersial penuh, minim pajak, dan bebas risiko hukum.

---

## Ringkasan Biaya Awal Minimum (Total Budget Capital Outlay)

| Komponen Perizinan / Legalitas | Biaya Resmi PNBP | Estimasi Waktu |
|---|---|---|
| **Voucher AHU PT Perorangan** | Rp50.000,- | 15 menit (online) |
| **NIB & NPWP Badan di OSS-RBA** | Rp0,- (Gratis) | 20 menit (online) |
| **Hak Cipta Software di DJKI (Tarif UMK)** | Rp200.000,- | 1 hari kerja (POP HC) |
| **Pendaftaran Merek Dagang DJKI (Kelas 09 & 42 @ Rp500rb)** | Rp1.000.000,- | 1 hari pengajuan (online) |
| **Pendaftaran TDPSE Kominfo di OSS** | Rp0,- (Gratis) | 1 hari kerja (online) |
| **Setoran Awal Buka Giro Bank (BCA/Mandiri/BRI)** | Rp500.000 s.d. Rp1.000.000,- | 1 hari kerja |
| **Meterai Tempel / e-Meterai (4 lembar @ Rp10.000)** | Rp40.000,- | Instan |
| **TOTAL ESTIMASI BIAYA LEGALITAS AWAL** | **± Rp1.790.000,- s.d. Rp2.290.000,-** | **1–3 Hari Kerja** |

---

## Fase 1 — Perlindungan Hak Kekayaan Intelektual & Brand

Tujuan: Mengunci kepemilikan aset perangkat lunak dan nama merek sebelum dipublikasikan secara komersial.

- [ ] **Persiapan Berkas Pendaftaran Hak Cipta**:
  - [ ] Scan KTP Founder (Pencipta).
  - [ ] Isi dan tandatangani Surat Pernyataan Hak Cipta format DJKI (bermeterai Rp10.000).
  - [ ] Isi dan tandatangani Surat Pernyataan Kriteria UMK — lihat [`templates/pnbp-umk-statement.md`](./templates/pnbp-umk-statement.md) (bermeterai Rp10.000).
  - [ ] Gabungkan PDF Contoh Ciptaan (25 halaman awal + 25 halaman akhir source code, ringkasan arsitektur, dan screenshot UI).
- [ ] **Pengajuan e-HakCipta (POP HC)**:
  - [ ] Buka `https://e-hakcipta.dgip.go.id`, ajukan Ciptaan Program Komputer.
  - [ ] Bayar billing SIMPADHU Rp200.000,- via mobile banking / virtual account.
  - [ ] Unduh dan arsipkan **Surat Pencatatan Ciptaan Elektronik** resmi Kemenkumham.
- [ ] **Pengecekan & Pengajuan Merek "Kasir.mu"**:
  - [ ] Cek ketersediaan di Pangkalan Data HKI (`https://pdki-indonesia.dgip.go.id`).
  - [ ] Ajukan pendaftaran merek secara online melalui `https://merek.dgip.go.id`:
    - [ ] Kelas 09 (Software POS yang dapat diunduh, aplikasi mobile, perangkat kasir).
    - [ ] Kelas 42 (Layanan komputasi awan / SaaS POS).

---

## Fase 2 — Pendirian Entitas & Perizinan Berusaha

Tujuan: Menerbitkan badan hukum PT Perorangan resmi, NIB (izin berusaha), dan NPWP Badan.

- [ ] **Pendaftaran AHU Kemenkumham**:
  - [ ] Beli voucher AHU Rp50.000,- di `https://ptp.ahu.go.id`.
  - [ ] Tentukan nama PT (minimal 3 kata Bahasa Indonesia, misal: *PT Solusi Kasir Pintar*).
  - [ ] Tentukan nominal modal:
    - [ ] **Jalur A (Direkomendasikan)**: Modal tunai Rp50.000.000,- s.d. Rp100.000.000,-.
    - [ ] **Jalur B (Alternatif Inbreng)**: Modal non-tunai Rp380.000.000,- berbasis bukti kas riil.
  - [ ] Masukkan 5 kode KBLI: `62010`, `58290`, `63102`, `46511`, `47401` — lihat [`kbli-codes.md`](./kbli-codes.md).
  - [ ] Unduh dan cetak **Sertifikat Pernyataan Pendirian Perseroan Perorangan** resmi.
- [ ] **Aktivasi OSS-RBA (NIB & NPWP Badan)**:
  - [ ] Login ke `https://oss.go.id` kategori UMK → Perseroan Perorangan.
  - [ ] Masukkan data nomor AHU; data PT dan NPWP Badan akan sinkron otomatis.
  - [ ] Konfirmasi 5 kegiatan usaha KBLI, PKKPR (Tata Ruang) otomatis, dan SPPL (Lingkungan) otomatis.
  - [ ] Unduh dan arsipkan dokumen **Nomor Induk Berusaha (NIB)**.

---

## Fase 3 — Fondasi Pajak & Perbankan Perusahaan

Tujuan: Mengamankan tarif pajak PPh Final 0.5% dan rekening operasional perusahaan.

- [ ] **Surat Keterangan PP 55/2022 (PPh Final 0.5%)**:
  - [ ] Login ke DJP Online (`https://djponline.pajak.go.id`) menggunakan NPWP Badan.
  - [ ] Buka menu Layanan → KSWP → ajukan **Surat Keterangan PP 55/2022**.
  - [ ] Unduh PDF Suket PP 55 dengan QR code resmi DJP — lihat [`tax-strategy.md`](./tax-strategy.md).
- [ ] **Pembukaan Rekening Giro PT**:
  - [ ] Datang ke kantor cabang bank (BCA / Mandiri / BRI / Bank Jatim).
  - [ ] Bawa: Asli Sertifikat AHU, Dokumen NIB, NPWP PT, KTP & NPWP Direktur Utama, setoran awal giro.
  - [ ] Aktifkan fasilitas internet banking bisnis (KlikBCA Bisnis / MCM).
- [ ] **Penyetoran Modal Awal**:
  - [ ] Transfer dana modal disetor dari rekening pribadi founder ke rekening giro PT (misal: Rp50.000.000,-).
  - [ ] Simpan bukti transfer dan mutasi rekening koran di folder arsip perseroan.

---

## Fase 4 — Dokumentasi Kontrak & Perlindungan Konsumen

Tujuan: Menjamin pemisahan aset, mitigasi liabilitas, dan kepatuhan perlindungan konsumen.

- [ ] **Perjanjian Pemisahan Aset & Hak Cipta**:
  - [ ] *Jika Jalur A (Direkomendasikan)*: Tandatangani **Perjanjian Lisensi Eksklusif Perangkat Lunak** bermeterai Rp10.000 — lihat [`templates/software-license-agreement.md`](./templates/software-license-agreement.md).
  - [ ] *Jika Jalur B*: Tandatangani **Surat Pernyataan Inbreng Berbasis Biaya Riil** bermeterai Rp10.000 — lihat [`templates/inbreng-declaration.md`](./templates/inbreng-declaration.md).
- [ ] **Publikasi Syarat & Ketentuan Layanan (ToS)**:
  - [ ] Muat naskah Syarat dan Ketentuan di situs web `kasir.mu/terms` — lihat [`templates/terms-of-service.md`](./templates/terms-of-service.md).
  - [ ] Pasang checkbox persetujuan ToS pada formulir pendaftaran merchant baru.
- [ ] **Publikasi Kebijakan Privasi (Privacy Policy - UU PDP 27/2022)**:
  - [ ] Muat naskah Kebijakan Privasi di situs web `kasir.mu/privacy` — lihat [`templates/privacy-policy.md`](./templates/privacy-policy.md).
  - [ ] Tentukan email narahubung privasi (`privacy@kasir.mu`).

---

## Fase 5 — Kepatuhan Digital & Saluran Pembayaran

Tujuan: Menghindari sanksi pemblokiran Kominfo dan mengaktifkan QRIS/Virtual Account untuk merchant.

- [ ] **Pendaftaran PSE Lingkup Privat Domestik**:
  - [ ] Login ke OSS-RBA → menu PB-UMKU → pilih KBLI `62010` / `58290` → **TDPSE Domestik Kominfo** — lihat [`digital-compliance.md`](./digital-compliance.md).
  - [ ] Masukkan URL domain `kasir.mu` dan deskripsi sistem cloud POS.
  - [ ] Unduh **Tanda Daftar Penyelenggara Sistem Elektronik (TDPSE)** resmi Kominfo.
- [ ] **Onboarding Mitra Payment Gateway**:
  - [ ] Daftarkan akun korporat PT pada platform aggregator pembayaran (Midtrans / Xendit).
  - [ ] Unggah NIB, NPWP Badan, Suket PP 55, KTP Direktur, dan rekening giro PT.
  - [ ] Konfigurasi skema penerimaan pembayaran langganan SaaS dan fitur QRIS Dinamis merchant.

---

## Fase 6 — Pengadaan Hardware & Rantai Pasok

Tujuan: Menyediakan bundling perangkat kasir ke merchant dengan margin bersih tanpa risiko bea cukai.

- [ ] **Kemitraan Distributor Hardware Lokal (Fase 1 - Zero Risk)**:
  - [ ] Jalin kerja sama pasokan grosir dengan distributor resmi perangkat POS lokal di Indonesia (misal: Sunmi Indonesia, iMin, Epson, Kassen) — lihat [`kbli-codes.md`](./kbli-codes.md).
  - [ ] Pastikan seluruh unit yang dibeli telah memiliki sertifikat SDPPI Kominfo dan garansi resmi lokal 1 tahun.
  - [ ] Susun paket penjualan bundling kasir (Software Kasir.mu + Thermal Printer + Barcode Scanner) menggunakan KBLI `47401` / `46511`.
- [ ] *(Fase 2 - Opsional di Masa Depan)*: Pengujian mandiri SDPPI di BBPPT Kominfo hanya jika volume impor mandiri telah mencapai >500 unit/bulan.

---

## Fase 7 — Rutinitas Kepatuhan Pajak & Pembukuan Berkala

Tujuan: Memastikan operasional perseroan berjalan bersih dan mempertahankan status kepatuhan perpajakan.

- [ ] **Kepatuhan Pajak Bulanan (PPh Final 0.5%)**:
  - [ ] Rekonsiliasi mutasi kas masuk rekening giro PT setiap akhir bulan.
  - [ ] Hitung pajak: `Pajak = 0.5% × Total Kas Masuk Kotor (Omzet)`.
  - [ ] Buat kode billing e-Billing KAP `411128` KOS `420` dan bayarkan sebelum tanggal 15 bulan berikutnya.
- [ ] **Kepatuhan Pajak Tahunan**:
  - [ ] Laporkan SPT Tahunan Badan 1771 sebelum tanggal 30 April tahun berikutnya.
  - [ ] Laporkan SPT Tahunan Orang Pribadi Founder (cantumkan kepemilikan saham PT pada daftar harta kode 031).
- [ ] **Penarikan Keuntungan Bebas Pajak (Dividen 0%)**:
  - [ ] Susun Keputusan Pemegang Saham Tunggal tentang Pembagian Dividen dari Laba Ditahan.
  - [ ] Transfer dividen ke rekening pribadi founder (tanpa dipotong PPh 0%).
  - [ ] Lakukan reinvestasi di instrumen domestik (deposito / SBN / saham BEI / sektor riil) selama minimal 3 tahun.
  - [ ] Laporkan e-Reporting Realisasi Investasi Dividen via DJP Online setahun sekali.
