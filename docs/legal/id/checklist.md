<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It is part of the Indonesian legal and regulatory set in this directory, and that class of document needs its audit scope stated before anything else, because the wrong scope produces confident nonsense. · THE SUBJECT IS EXTERNAL LAW, AND NO REPOSITORY CAN VERIFY IT. This set cites specific regulations, specific government portals, specific fee schedules and specific registration procedures. Whether a tariff is still current, whether a regulation number still reads as quoted, or whether an online procedure still works is a question for someone with access to the source, and an audit that re-derived those answers would be inventing them. What IS checkable, and is what this pass checked, is everything the documents assert about THIS codebase and about each other: the product and domain names they register, the cross-references between them, and the internal claims that a reader would act on. · THOSE CHECK OUT, and the set is in better shape than most of the tree. Every one of the thirteen relative links across the five documents resolves, including the template references into the local template directory, which exists. And every one of the ten files names the current product domain — the previous domain appears in NONE of them, which makes this the cleanest rebrand position of any document class audited in this campaign and is worth recording as a positive. The administrative and commercial identity of the company is the one thing these documents must get exactly right, and they do. · WHAT IS DELIBERATELY NOT DONE, and the stamp should be read as saying so: no legal content was reviewed, no fee was checked, no regulation number was validated, and the `[DECIDED] & [VERIFIED]` status these documents carry for their legal content is THEIR claim, reproduced here without endorsement. A reader who treats an audit stamp as a legal opinion would be badly misled, which is exactly why this paragraph is in the stamp rather than left implicit. · This particular document is the set's index and anchor: it is the checklist the other documents elaborate, and its internal correctness matters more than any other file here because it is the one a reader starts from. Its nine relative links all resolve, and the templates it points at exist, so the execution path a reader would follow is intact at the level this audit can establish. · NOT re-measured: any regulatory, financial or procedural claim. · No stamp existed; this is the first. -->
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

---

## Fase 8 — Inbreng Menyusul di Tahun ke-2: Peningkatan Modal Software (Rp3–4 Miliar)

Tujuan: Mengonversi lisensi software menjadi modal inbreng resmi senilai **Rp3.000.000.000,- s.d. Rp4.000.000.000,-** setelah perseroan membuktikan traksi pasar komersial stabil, menaikkan kelas perseroan ke **Usaha Kecil** dan tetap sah berstatus **PT Perorangan**.

- [ ] **Persiapan Valuasi Berbasis Traksi Pasar (Income Approach + Software Valuation)**:
  - [ ] Dokumentasikan metrik bisnis 24 bulan: Jumlah merchant aktif, stabilitas *Monthly Recurring Revenue* (MRR), retensi pelanggan, dan valuasi arsitektur software *proprietary* kasir.mu.
  - [ ] Tunjuk Kantor Jasa Penilai Publik (KJPP) berizin Penilaian Bisnis dari Kemenkeu.
  - [ ] Bayar fee jasa KJPP menggunakan kas operasional PT (dibukukan sebagai beban usaha PT yang sah).
  - [ ] Dapatkan Buku Laporan Penilaian Resmi berstempel basah KJPP yang menetapkan nilai wajar software di kisaran Rp3–4 Miliar.
- [ ] **Pendaftaran Peningkatan Modal di AHU Kemenkumham (Voucher Rp50.000)**:
  - [ ] Buat Keputusan Pemegang Saham Tunggal tentang Penyetoran Modal Non-Tunai dan Peningkatan Modal Disetor.
  - [ ] Beli voucher PNBP *Pernyataan Perubahan Perseroan Perorangan* (Rp50.000,-) di `ptp.ahu.go.id`.
  - [ ] Input penambahan modal inbreng software sesuai angka laporan KJPP (misal: Rp3.500.000.000,-).
  - [ ] Unduh Sertifikat Pernyataan Perubahan Perseroan Perorangan resmi Kemenkumham.
- [ ] **Sinkronisasi Pasca-Perubahan Modal**:
  - [ ] Lakukan sinkronisasi data modal baru pada portal OSS-RBA (skala usaha otomatis naik dari Usaha Mikro menjadi Usaha Kecil).
  - [ ] Konfirmasi keabsahan: Bentuk badan hukum **tetap PT Perorangan** karena total modal (Rp3,05–4,05 Miliar) masih di bawah batas maksimal Rp5 Miliar sesuai PP 8/2021.
  - [ ] Perbarui data modal perseroan di bank tempat rekening giro berada.
  - [ ] Catat di neraca PT: Debit Aset Tak Berwujud (Software) Rp3,5 Miliar, Kredit Tambahan Modal Disetor Rp3,5 Miliar (bebas pajak pengalihan modal sesuai Pasal 4 ayat 3 huruf c UU PPh).

> last audited 29-09-26 by docs-auditor
