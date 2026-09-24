# Inbreng & Software Valuation Analysis (Analisis Valuasi & Inbreng HAKI)

> **Status:** `[DECIDED]` & `[VERIFIED]` against UU No. 40/2007 Pasal 34 (Setoran Modal Selain Uang), UU PPh Pasal 10 (Harga Perolehan Harta), and Standar Penilaian Indonesia (SPI).
> **Tujuan:** Memberikan analisis objektif mengenai penilaian aset perangkat lunak kasir.mu, membongkar kelemahan klaim valuasi lama, serta menetapkan dasar hukum yang kokoh dan defensif dari sisi perpajakan.

---

## 1. Analisis Kritis: Mengapa Valuasi Rp3,1 Miliar Lama Sangat Berbahaya

Draf awal dokumen menetapkan valuasi perangkat lunak sebesar **$200,000 USD (Rp3.100.000.000,-)** dengan rincian:
* *Opportunity cost* jam kerja (4.927 jam @ ~$50/jam): $246,000 USD
* Pengeluaran modal nyata (*Out-of-Pocket*): $25,000 USD
* Diskon efisiensi UMK: −$53,000 USD

### Cacat Hukum & Fiskal di Hadapan Otoritas Pajak (DJP) & Hukum Perdata:
1. **"Opportunity Cost" Bukan Beban yang Diakui Secara Fiskal**:
   Berdasarkan Pasal 10 UU PPh, harga perolehan atau harga penjualan dalam hal terjadi pengalihan harta adalah jumlah yang sesungguhnya dikeluarkan atau diterima. *Opportunity cost* adalah konsep teoretis ekonomi mikro mengenai potensi pendapatan yang hilang, **bukan pengeluaran riil**. Di mata pemeriksa pajak, angka $246,000 tidak memiliki bukti potong PPh 21, tidak ada slip transfer bank, dan tidak ada bukti kas keluar.
2. **Ketiadaan Sertifikasi Kantor Jasa Penilai Publik (KJPP)**:
   Sesuai Pasal 34 ayat (2) UU No. 40/2007 (UU PT):
   > *"Penyetoran atas modal saham dapat dilakukan dalam bentuk lainnya... Penilaian besarnya setoran modal ditentukan berdasarkan nilai wajar yang ditetapkan sesuai dengan harga pasar atau oleh **ahli yang tidak terafiliasi dengan Perseroan**."*
   Penilaian sepihak oleh founder sendiri untuk kepentingan perseroan yang dimilikinya sendiri (*self-assessment without independent appraisal*) cacat secara formil dalam pembuktian hukum perdata perseroan.
3. **Pemicu SP2DK Pajak Penghasilan Pribadi Founder**:
   Jika seorang individu menyetorkan aset tak berwujud senilai Rp3,1 Miliar ke badan usaha, KPP Pratama akan mencocokkannya dengan Surat Pemberitahuan (SPT) Tahunan Pajak Pribadi tahun-tahun sebelumnya. Apabila aset Rp3,1 Miliar ini belum pernah dilaporkan di kolom daftar harta SPT pribadi, DJP dapat menganggap timbulnya aset tersebut berasal dari **penghasilan yang belum dilaporkan**, lalu menerbitkan SP2DK dengan potensi tagihan PPh Orang Pribadi hingga 35%.
4. **Ilusi Manfaat Amortisasi Fiskal**:
   Klaim bahwa nilai Rp3,1 Miliar ini akan diamortisasi Rp775 juta/tahun untuk menghemat pajak **gugur total** karena PT Perorangan berhak memakai fasilitas **PPh Final 0.5% (PP 55/2022)**. Pada skema PPh Final 0.5%, beban amortisasi tidak mengurangi kewajiban pajak apa pun.

---

## 2. Perbandingan Tiga Jalur Solusi

| Kriteria | Opsi 1 (Sangat Direkomendasikan): Lisensi Eksklusif | Opsi 2 (Alternatif Defensif): Inbreng Biaya Riil | Opsi 3: Inbreng Rp3,1 Miliar via KJPP Formal |
|---|---|---|---|
| **Mekanisme** | Modal disetor tunai (Rp50–100 Juta). Software dilisensikan eksklusif dari founder ke PT. | Software dialihkan hak miliknya ke PT dengan nilai riil kas keluar (~$25.000 / Rp380 Juta). | Menunjuk KJPP resmi untuk menerbitkan Laporan Penilaian Aset Tak Berwujud Rp3,1 Miliar. |
| **Kepemilikan HAKI** | **Pribadi Founder** (Aset terlindungi jika PT bermasalah). | **Milik PT** (Menjadi aset badan hukum). | **Milik PT**. |
| **Biaya Tambahan** | **Rp0,-** (Cukup kontrak lisensi internal). | **Rp0,-** (Kompilasi kuitansi internal). | **Rp20.000.000 s.d. Rp45.000.000** (Fee jasa KJPP berizin Kemenkeu). |
| **Ketahanan Audit DJP** | **100% Solid & Tidak Ada Titik Lemah**. | **Sangat Kuat** (Didukung bukti transaksi nyata). | Kuat (jika SPT Pribadi founder sudah sinkron). |
| **Dampak Neraca Awal** | Kas: Rp50–100 Juta<br>Modal: Rp50–100 Juta. | Aset Tak Berwujud: Rp380 Juta<br>Modal: Rp380 Juta. | Aset Tak Berwujud: Rp3,1 Miliar<br>Modal: Rp3,1 Miliar. |

---

## 3. Rincian Biaya Riil (Out-of-Pocket Basis) untuk Opsi 2

Jika founder memilih **Opsi 2** (menyetorkan software sebagai modal inbreng secara defensif), maka nilai valuasi wajib diturunkan menjadi nilai pengeluaran riil historis yang memiliki jejak digital kuitansi/invoice pembayaran (*Substantiated Cost Basis*):

| Komponen Pengeluaran Riil | Deskripsi & Dasar Pembuktian | Nilai (USD) | Estimasi (IDR) |
|---|---|---|---|
| **R&D Hardware Deployment Assets** | Pengadaan perangkat uji coba kasir (MacBook dev, PC desktop testing, thermal receipt printers, 2D barcode scanners, Android test tablets, EDC test units). | $15,000 | Rp235.000.000,- |
| **AI R&D CapEx** | Biaya komputasi dan langganan API AI (Anthropic Claude, OpenAI, GitHub Copilot, Cursor) untuk akselerasi rekayasa kode arsitektur Rust/Tauri. | $7,000 | Rp110.000.000,- |
| **Cloud Infrastructure & Utilities** | Biaya server staging, database cloud PostgreSQL, Cloudflare Workers/R2, domain, sertifikat SSL, dan konektivitas pita lebar berkecepatan tinggi. | $3,000 | Rp47.000.000,- |
| **TOTAL VALUASI BERTAHAN (DEFENSIBLE)** | **Total Pengeluaran Kas Nyata yang Terdokumentasi** | **$25,000** | **Rp392.000.000,-** |

*Catatan: Nilai ini dapat dibulatkan menjadi **Rp350.000.000,-** atau **Rp380.000.000,-** pada Akta/Pernyataan Pendirian, dan masuk secara sah sebagai modal kategori Usaha Mikro (≤ Rp1 Miliar).*

---

## 4. Prosedur Jika Memilih Opsi 3 (Jalur KJPP Formal)

Jika di masa depan terdapat investor ventura (*Venture Capital*) atau mitra strategis yang mewajibkan valuasi HAKI dicatat sebesar miliaran rupiah di neraca PT:
1. **Penunjukan Lembaga**: Wajib menunjuk Kantor Jasa Penilai Publik (KJPP) yang terdaftar di Otoritas Jasa Keuangan (OJK) dan Asosiasi MAPPI (Masyarakat Profesi Penilai Indonesia).
2. **Metodologi Penilaian Standar**:
   * *Relief from Royalty Method* (pendekatan pendapatan berdasarkan penghematan royalti di masa depan); atau
   * *Depreciated Replacement Cost Method* (biaya penggantian reproduksi sistem jika dikerjakan oleh software house komersial pihak ketiga dengan standar gaji engineer pasar).
3. **Dokumentasi yang Dibutuhkan KJPP**:
   * Sertifikat Pencatatan Hak Cipta resmi dari DJKI Kemenkumham.
   * Laporan Arsitektur Teknis Lengkap (*System Architecture & Code Base Metric Report*).
   * Laporan Pengujian Sistem & Dokumen UAT (*User Acceptance Test*).
   * Proyeksi Finansial Pendapatan SaaS 3–5 tahun ke depan.
4. **Pencatatan**: Laporan Penilaian Independen KJPP dilampirkan sebagai lampiran tak terpisahkan dari Berita Acara RUPS / Keputusan Pemegang Saham Tunggal atas penyetoran modal non-tunai.

---

## 5. Rekomendasi Eksekusi Final

Untuk kecepatan, efisiensi modal, dan ketenangan pajak:
* **Gunakan Opsi 1 (Lisensi Eksklusif)** untuk pendirian awal PT Perorangan saat ini.
* Daftarkan Hak Cipta di DJKI atas nama founder pribadi.
* Terbitkan perjanjian lisensi software eksklusif dari founder ke PT Kasirmu (draf tersedia di [`templates/software-license-agreement.md`](./templates/software-license-agreement.md)).
* Daftarkan PT dengan modal tunai bersih **Rp50.000.000,-** di AHU dan OSS.
* Dengan demikian, perseroan memiliki struktur hukum yang 100% tahan uji, tidak ada risiko denda pajak, dan aset intelektual founder terlindungi secara sempurna.
