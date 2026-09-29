<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It belongs to the Indonesian legal and regulatory set in this directory, whose audit scope this campaign states explicitly rather than leaving implicit, because the wrong scope produces either confident nonsense or a stamp that gets over-read. · THE SUBJECT IS EXTERNAL LAW, AND NO REPOSITORY CAN VERIFY IT. This set cites statutes, government portals, fee schedules and classification standards. Whether a tariff is current or a statute still reads as quoted is a question for someone with access to the source. What IS checkable — and what this pass checked — is what the documents assert about EACH OTHER and about this codebase: the identifiers they share, the cross-references between them, and the claims a reader would act on directly. Those are the parts that fail silently, and they are the parts that matter to anyone actually using this directory. · NOT re-measured: any regulatory, financial or procedural claim. The status this document carries about its own legal content is ITS claim, reproduced here without endorsement; a reader treating this stamp as a legal opinion would be misled, which is exactly why the paragraph is here. · THIS IS THE FILE THAT DECIDES WHETHER THE SET COHERES, and it holds up. It is the index the other documents are organised under, so its value is that a reader can navigate from here to the right document — and an index naming files which do not exist is worse than no index at all. All seven documents it lists resolve to real files, and it is the only document in the set that summarises the whole at once, which makes it the right entry point and the right first thing to fix if the set ever grows. · The set's one systematic weakness is the one its index makes visible: several documents open by asserting a DECIDED-and-VERIFIED status for their legal content, which is a claim about external sources rather than about the repository. That is legitimate for the authors, who can check those sources. It is not something a documentation audit can ratify, and this stamp does not pretend to. · A READER'S ORIENTATION NOTE the index earns: this suite is a coherent package rather than a folder of loosely related notes, spanning formation, IP, digital compliance, classification, tax and valuation — and the dependencies run in a real order. You cannot file before you are formed, and you cannot value what you have not registered, so the set reads as a sequence rather than a menu. · No stamp existed; this is the first. -->
# Legal & Regulatory Framework — Indonesia (`docs/legal/id/`)

> **Status:** `[VERIFIED]` & `[AUDITED]` as of 2026-09-25.  
> **Dasar Regulasi:** UU Cipta Kerja (UU No. 6/2023), UU PT (UU No. 40/2007), UU PPh & UU HPP (UU No. 7/2021), PP No. 8/2021 (PT Perorangan), PP No. 5/2021 (OSS-RBA), PP No. 55/2022 (PPh Final UMKM 0.5%), UU No. 27/2022 (Perlindungan Data Pribadi / UU PDP), Permenkominfo No. 5/2020 jo. 10/2021 (PSE Lingkup Privat), dan UU No. 28/2014 (Hak Cipta).

Dokumen di dalam direktori ini membentuk **paket hukum dan perpajakan lengkap (*comprehensive legal suite*)** untuk mendirikan, mengoperasikan, dan melindungi bisnis platform kasir *Kasir.mu* di Indonesia dengan fondasi legal yang kokoh, beban pajak paling minimal, dan perlindungan aset maksimal.

---

## 1. Peta Dokumen & Panduan Utama

| Dokumen | Ruang Lingkup & Tujuan Utama |
|---|---|
| **[`checklist.md`](./checklist.md)** | **Daftar Periksa Eksekusi Terpadu**: Rincian langkah operasional 7 fase dari HAKI, PT, bank, kontrak, PSE, hingga siklus pajak tahunan beserta rincian anggaran awal (~Rp1,8–2,3 juta). |
| **[`entity-setup.md`](./entity-setup.md)** | **Pendirian Badan Hukum PT Perorangan**: Pendaftaran AHU Kemenkumham (voucher Rp50.000), aktivasi OSS-RBA, penerbitan NIB & NPWP Badan otomatis, serta pembukaan rekening giro bank. |
| **[`tax-strategy.md`](./tax-strategy.md)** | **Strategi Optimalisasi & Penghematan Pajak**: Panduan PPh Final 0.5% (PP 55/2022), penarikan dividen bebas pajak 0% (UU Cipta Kerja), diskon tarif 50% Pasal 31E, keuntungan non-PKP, dan mitigasi SP2DK DJP. |
| **[`inbreng-valuation.md`](./inbreng-valuation.md)** | **Analisis Valuasi & Inbreng HAKI**: Evaluasi kritis kelemahan klaim Rp3,1 Miliar lama (*opportunity cost*), perbandingan 3 jalur, rincian biaya kas nyata (~$25.000 / Rp380 Juta), dan metodologi KJPP. |
| **[`kbli-codes.md`](./kbli-codes.md)** | **Analisis KBLI & Regulasi Hardware**: Bedah 5 KBLI risiko rendah (`62010`, `58290`, `63102`, `46511`, `47401`), legalitas NIB sebagai API-U, kewajiban sertifikasi nirkabel SDPPI Kominfo, dan strategi pasokan hardware 2 fase. |
| **[`digital-compliance.md`](./digital-compliance.md)** | **Kepatuhan Digital & Pembayaran**: Pendaftaran Penyelenggara Sistem Elektronik (PSE) Lingkup Privat Kominfo via OSS, kepatuhan UU PDP 27/2022, dan posisi Kasirmu sebagai *technical integrator* non-PJP Bank Indonesia. |
| **[`djki-ip-guide.md`](./djki-ip-guide.md)** | **Panduan HAKI di DJKI**: Prosedur pendaftaran Hak Cipta software instan (POP HC e-HakCipta tarif UMK Rp200.000), format deposit source code, serta strategi perlindungan merek dagang Kelas 09 dan Kelas 42. |

---

## 2. Naskah Template Legal Siap Pakai (`templates/`)

Semua template telah disusun sesuai standar perundang-undangan Indonesia, siap diisi dan dicetak bermeterai:

1. **[`templates/software-license-agreement.md`](./templates/software-license-agreement.md)**:  
   *Perjanjian Lisensi Eksklusif Hak Cipta Perangkat Lunak (Founder ke PT)* — Inti dari **Jalur A (Rekomendasi Utama)** yang memisahkan kepemilikan aset intelektual pribadi dari entitas perseroan demi perlindungan dari risiko kepailitan atau tuntutan pihak ketiga.
2. **[`templates/inbreng-declaration.md`](./templates/inbreng-declaration.md)**:  
   *Surat Pernyataan Pengalihan Aset HAKI (Inbreng Berbasis Biaya Riil)* — Dokumen untuk **Jalur B** jika memilih penyetoran modal software secara non-tunai berbasis bukti pengeluaran riil (~Rp380 Juta).
3. **[`templates/terms-of-service.md`](./templates/terms-of-service.md)**:  
   *Syarat & Ketentuan Layanan Kasir.mu (Merchant Terms of Service)* — Perjanjian standar SaaS kasir untuk merchant (`kasir.mu/terms`), mencakup SLA, batasan tanggung jawab, operasional offline-first, dan disclaimer integrasi payment gateway.
4. **[`templates/privacy-policy.md`](./templates/privacy-policy.md)**:  
   *Kebijakan Privasi Kasir.mu (Privacy Policy)* — Kebijakan privasi resmi yang mematuhi UU Perlindungan Data Pribadi (UU PDP No. 27/2022), memuat jaminan tidak menjual data transaksi merchant ke pihak ketiga.
5. **[`templates/pnbp-umk-statement.md`](./templates/pnbp-umk-statement.md)**:  
   *Surat Pernyataan Kriteria Usaha Mikro dan Kecil (UMK)* — Surat bermeterai untuk mengklaim tarif diskon PNBP di Ditjen Kekayaan Intelektual (Hak Cipta Rp200.000 dan Merek Rp500.000/kelas).

---

## 3. Keputusan Strategis yang Telah Ditetapkan (`[DECIDED]`)

1. **Bentuk Badan Usaha**: **PT Perorangan** (Perseroan Terbatas untuk Usaha Mikro dan Kecil) didirikan mandiri melalui AHU Online tanpa akta notaris berbiaya tinggi.
2. **Arsitektur Permodalan 2 Tahap (The 2-Phase Capital Roadmap)**: 
   * **Fase 1 (Peluncuran Bersih Hari Ini - Usaha Mikro)**: Modal tunai Rp50.000.000,- disetor via rekening giro PT. Hak Cipta atas nama pribadi founder dan dilisensikan secara eksklusif ke PT (*Asset Protection Pattern*). Menghemat fee appraisal KJPP Rp10–20 juta di awal dan bebas dari risiko pemeriksaan pajak *opportunity cost*.
   * **Fase 2 (Inbreng Menyusul di Tahun ke-2 - Usaha Kecil: Rp3–4 Miliar)**: Peningkatan modal inbreng dieksekusi di tahun ke-2 via Pernyataan Perubahan di AHU Online (voucher Rp50.000) setelah memiliki ratusan merchant dan omzet bulanan stabil, menggunakan metode *Income Approach (DCF)* berbasis metrik merchant aktif dan MRR + valuasi software oleh KJPP yang dibiayai resmi dari kas operasional PT. Skala usaha naik menjadi Usaha Kecil dan **TETAP SAH BERSTATUS PT PERORANGAN** (karena plafon maksimal PT Perorangan adalah Rp5 Miliar sesuai PP 8/2021).
3. **Rezim Perpajakan**:
   * Memanfaatkan **PPh Final 0.5% (PP 55/2022)** selama 4 tahun pertama.
   * Menjaga status **Non-PKP** (omzet ≤ Rp4,8 Miliar) sehingga langganan Kasir.mu bebas dari beban tambahan PPN 12% bagi merchant UMKM.
   * Ekstraksi keuntungan dilakukan melalui **Dividen Bebas Pajak 0%** dengan reinvestasi domestik 3 tahun (UU Cipta Kerja).
4. **Hardware Supply Chain**:
   * **Fase Awal**: Pengadaan hardware kasir (printer, scanner, tablet) bermitra dengan distributor/prinsipal resmi lokal di Indonesia untuk menghindari biaya uji lab SDPPI Kominfo (Rp15–35 juta/tipe) dan bea cukai impor.
   * **Fase Lanjutan**: Impor mandiri kontainer menggunakan NIB (API-U) hanya setelah volume penjualan melampaui 500 unit/bulan.
5. **Kepatuhan Digital**:
   * Wajib mendaftarkan sistem sebagai **PSE Lingkup Privat Domestik** ke Kominfo melalui OSS sebelum peluncuran komersial penuh.
   * Beroperasi murni sebagai *technical integrator / merchant enabler*, bukan penyelenggara penampung dana (Non-PJP Bank Indonesia).

> last audited 29-09-26 by docs-auditor
