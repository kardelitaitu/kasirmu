<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It is part of the Indonesian legal and regulatory set in this directory, whose audit scope this campaign states explicitly because the wrong scope produces confident nonsense. · THE SUBJECT IS EXTERNAL LAW AND FINANCE, AND NO REPOSITORY CAN VERIFY IT. This set cites specific statutes, specific government portals, specific fee schedules and specific valuation standards. Whether a tariff is current, whether a statute still reads as quoted, and whether a valuation method is the accepted one are questions for someone with access to the sources. What IS checkable is what the documents assert about THIS codebase and about each other — the product and domain names they register, the cross-references between them, and the internal claims a reader would act on. · THOSE CHECK OUT. All thirteen relative links across the five legal documents resolve, the local template directory exists, and every one of the ten files in the directory names the current product domain; the previous domain appears in none of them. That is the cleanest rebrand position of any document class in the repository, and it matters more here than elsewhere — a legal file naming the wrong domain is not a stale path, it is a registration error waiting to happen. · WHAT IS DELIBERATELY NOT DONE, and this paragraph is the reason the stamp exists on this file in particular: no legal or financial content was reviewed, no fee checked, no statute validated, and NO VALUATION FIGURE OR METHOD IS ENDORSED. A stamp sitting beside a number is exactly the thing a future reader will over-read, and a valuation document is where that over-reading would be most expensive. The DECIDED and VERIFIED status this document carries is ITS claim about ITS legal content, reproduced here without endorsement. · NOT re-measured: any regulatory, financial, valuation or procedural claim. · No stamp existed; this is the first. -->
# Inbreng & Software Valuation Analysis (Analisis Valuasi & Inbreng HAKI)

> **Status:** `[DECIDED]` & `[VERIFIED]` against UU No. 40/2007 Pasal 34 (Setoran Modal Selain Uang), UU PPh Pasal 10 (Harga Perolehan Harta), and Standar Penilaian Indonesia (SPI).
> **Tujuan:** Menetapkan posisi hukum dan strategi valuasi perangkat lunak kasir.mu, membongkar kelemahan valuasi dini yang boros biaya, serta memandu pelaksanaan inbreng menyusul di masa depan secara objektif dan defensif.

---

## 1. Analisis Kritis: Mengapa Melakukan Inbreng Hari Ini adalah Pemborosan

Draf awal pendirian sempat merencanakan penyetoran modal non-tunai (*inbreng*) langsung pada hari pertama pendirian PT dengan valuasi $200,000 USD (Rp3,1 Miliar). 

Ketika diteliti secara hukum dan bisnis, melakukan inbreng langsung saat ini menghadapi **dua kendala fatal**:

1. **Jebakan Valuasi Repo Git & Biaya KJPP (Rp10–20 Juta)**:
   * Jika dinilai hari ini sebelum ada omzet komersial, yang ada hanyalah baris kode di repo Git.
   * Kantor Jasa Penilai Publik (KJPP) hanya bisa menggunakan **Metode Biaya Penggantian (*Cost Approach*)**, yaitu menghitung jam kerja developer (misal: gaji pasar engineer Rp50jt × 12 bulan = Rp600 juta).
   * Untuk sekadar mengesahkan angka tersebut, founder harus membayar fee KJPP sebesar **Rp10.000.000,- s.d. Rp20.000.000,- dari kantong pribadi**. Ini adalah pemborosan modal tunai awal yang sangat tidak efisien.
2. **Klaim "Opportunity Cost" Ditolak DJP**:
   * Jika tidak menggunakan KJPP dan founder mengklaim sendiri jam kerjanya senilai ratusan juta rupiah, Ditjen Pajak (DJP) akan menolak biaya tersebut berdasarkan Pasal 10 UU PPh karena tidak ada bukti potong PPh 21 dan tidak ada bukti kas keluar riil. Ini memicu potensi surat teguran SP2DK pada SPT Pajak Pribadi founder.

---

## 2. Strategi Juara: Inbreng Menyusul (*Subsequent Inbreng Strategy*)

Solusi terbaik yang digunakan startup teknologi terkemuka adalah **memisahkan antara waktu pendirian PT dengan waktu pelaksanaan inbreng**.

```
HARI INI (FASE PELUNCURAN)                       MASA DEPAN (FASE SCALE-UP: TAHUN KE-2)
┌──────────────────────────────────────┐          ┌──────────────────────────────────────────────┐
│  PT Berdiri: Modal Tunai Rp50 Juta   │          │  Peningkatan Modal Inbreng di AHU            │
│  Hak Cipta: Milik Pribadi Founder    │          │  Nilai: Rp3 Miliar s.d. Rp4 Miliar           │
│  Hubungan: Lisensi Eksklusif         │ ───────> │  Metode: Income Approach (MRR + Valuasi SW)  │
│  Biaya KJPP: Rp0,- (Hemat Maksimal!) │          │  Biaya KJPP: Dibayar Kas PT                  │
│  Status Pajak: PPh Final 0.5% Aman   │          │  Kekuatan: Mutlak Diakui Pasar & DJP         │
└──────────────────────────────────────┘          └──────────────────────────────────────────────┘
```

### Mengapa Inbreng Menyusul Jauh Lebih Unggul?

| Dimensi Evaluasi | Inbreng Hari Ini (Baru Ada Kode Git) | Inbreng Menyusul (Sudah Ada Merchant & Omzet) |
|---|---|---|
| **Metode Penilaian KJPP** | *Cost Approach* (Menghitung jam kerja & baris kode). | **Income Approach / DCF** (MRR + Valuasi Software Proprietary). |
| **Plafon Valuasi yang Diakui** | Terbatas di kisaran **Rp500–700 Juta**. | Melesat ke kisaran **Rp3 Miliar s.d. Rp4 Miliar**. |
| **Sumber Biaya Appraisal** | Keluar dari **kantong pribadi founder** (Rp10–20jt). | Dibayar resmi dari **kas operasional PT** (beban perseroan). |
| **Dampak ke Jadwal Rilis** | Tertunda 2–3 minggu menunggu laporan KJPP. | **Rilis instan hari ini**, PT langsung jalan. |
| **Perlindungan Aset** | Software langsung jadi milik PT (rentan disita jika rugi). | Software aman di tangan pribadi selama masa inkubasi. |

---

## 3. Landasan Hukum & Prosedur Inbreng Menyusul

Di bawah payung hukum Indonesia (UU No. 40/2007 Pasal 41–43 jo. PP No. 8/2021 tentang PT Perorangan), penambahan modal disetor melalui inbreng di kemudian hari diatur sebagai berikut:

### 3.1 Prosedur Eksekusi di AHU Kemenkumham (Target Tahun ke-2: Rp3–4 Miliar)
1. **Target Valuasi Realistis (Income Approach + Software Asset Valuation)**:
   Setelah kasir.mu beroperasi 24 bulan dan membuktikan metrik operasional nyata (basis ratusan merchant aktif, retensi langganan, dan *Monthly Recurring Revenue / MRR* yang stabil) yang dikombinasikan dengan penilaian keandalan arsitektur perangkat lunak *proprietary* (Rust Core Engine, Tauri Desktop, SQLite offline-first, PostgreSQL cloud sync), KJPP akan menilai software pada rentang target realistis **Rp3.000.000.000,- s.d. Rp4.000.000.000,- (Tiga hingga Empat Miliar Rupiah)** menggunakan metode *Income Approach (Discounted Cash Flow / Relief from Royalty)*.
2. **Kesesuaian dengan Kriteria PT Perorangan**:
   Dengan penambahan modal inbreng ini, total modal perseroan menjadi **Rp3,05 Miliar s.d. Rp4,05 Miliar**. Berdasarkan PP No. 7/2021, skala usaha perseroan resmi naik kelas dari *Usaha Mikro* menjadi **Usaha Kecil** (kategori modal > Rp1 Miliar s.d. Rp5 Miliar). **PT TETAP SAH 100% BERSTATUS PT PERORANGAN** dengan 1 orang pemegang saham tunggal dan tanpa kewajiban mengubah badan usaha atau menambah pemegang saham baru, karena batas atas modal PT Perorangan adalah Rp5 Miliar.
3. **Keputusan Pemegang Saham Tunggal**:
   Founder membuat Keputusan Pemegang Saham Tunggal tentang Penyetoran Modal Non-Tunai dan Peningkatan Modal Disetor Perseroan.
4. **Pendaftaran Perubahan di AHU Online**:
   * Akses `https://ptp.ahu.go.id`.
   * Beli voucher PNBP: *Pernyataan Perubahan Perseroan Perorangan* (**Rp50.000,-**).
   * Masukkan nilai penambahan modal disetor non-tunai sesuai nilai laporan KJPP (misal: Rp3.500.000.000,-).
   * Sertifikat Pernyataan Perubahan terbit otomatis.
5. **Bebas Pajak Pengalihan Modal**:
   Sesuai ketentuan **Pasal 4 ayat (3) huruf c UU PPh**, harta yang diterima oleh badan sebagai pengganti modal disetor bukan merupakan objek Pajak Penghasilan bagi perseroan. PT tidak dikenai pajak tambahan atas masuknya aset software Rp3–4 Miliar tersebut.

### 3.2 Jembatan Hukum Selama Masa Tunggu
Selama periode sebelum inbreng menyusul dieksekusi:
* Gunakan **Perjanjian Lisensi Eksklusif Hak Cipta Perangkat Lunak** ([`templates/software-license-agreement.md`](./templates/software-license-agreement.md)).
* Perjanjian ini memberikan hak komersial 100% kepada PT untuk menjual langganan kasir.mu ke merchant tanpa perlu mengalihkan kepemilikan aset terlebih dahulu.
* Pada Pasal 5 perjanjian lisensi, telah dicantumkan klausul konversi otomatis menjadi inbreng ketika perseroan memutuskan melakukan peningkatan modal resmi di AHU.

---

## 4. Kesimpulan Keputusan Eksekutif

1. **Hari Ini**: Batalkan inbreng dini Rp3,1 Miliar dan tolak pengeluaran fee KJPP Rp10–20 juta di muka. Daftarkan PT dengan modal tunai bersih **Rp50.000.000,-** dan tandatangani Perjanjian Lisensi Eksklusif.
2. **Masa Depan**: Lakukan inbreng menyusul saat kasir.mu telah memiliki traksi pasar yang solid dan valuasi komersial yang dapat dinilai miliaran rupiah secara objektif oleh KJPP dengan pembiayaan dari kas PT.

> last audited 29-09-26 by docs-auditor
