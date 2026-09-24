# Tax Strategy & Optimization (Strategi Pajak & Efisiensi)

> **Status:** `[DECIDED]` & `[VERIFIED]` against UU PPh, UU Harmonisasi Peraturan Perpajakan (UU HPP No. 7/2021), PP No. 55/2022, and PMK No. 18/PMK.03/2021.
> **Tujuan:** Meminimalkan beban pajak badan dan pribadi secara 100% legal, mencegah risiko SP2DK dari KPP, serta memastikan dividen dan kas perseroan dapat ditarik secara efisien.

---

## 1. Ringkasan Eksekutif Rezim Pajak

| Komponen Pajak | Ketentuan / Fasilitas | Tarif Efektif | Keterangan & Rujukan |
|----------------|-----------------------|---------------|----------------------|
| **PPh Badan (Tahun 1–4)** | PP 55/2022 (Fasilitas UMKM) | **0.5% dari Omzet Bruto** | Berlaku maks. 4 tahun buku untuk PT Perorangan, selama omzet tahunan ≤ Rp4,8 Miliar. |
| **PPh Badan (Tahun 5+)** | Pasal 17 jo. Pasal 31E UU PPh | **11% dari Laba Bersih** | Diskon 50% dari tarif normal 22% untuk porsi Penghasilan Kena Pajak (PKP) hingga omzet Rp4,8 M (dari total omzet s.d. Rp50 M). |
| **Dividen ke Pemegang Saham** | UU Cipta Kerja / Pasal 4 (3) f UU PPh | **0% (Bebas Pajak)** | Syarat: Diinvestasikan kembali di wilayah NKRI minimal selama 3 tahun buku (PMK 18/2021). |
| **PPN (Pajak Pertambahan Nilai)** | Batasan Non-PKP (PMK 197/2013) | **0% (Tidak Wajib Pungut)** | Selama peredaran bruto belum melampaui Rp4,8 Miliar/tahun, perseroan tidak wajib menjadi PKP. |
| **PPh 21 Gaji Direktur** | Tarif Pasal 17 (Progresif OP) | 0% s.d. 35% | PTKP Rp54.000.000,-/tahun. Gaji dapat dibebankan sebagai biaya perseroan. |

---

## 2. Fase 1: Memaksimalkan PPh Final 0.5% (Tahun Pajak ke-1 s.d. ke-4)

### 2.1 Ketentuan PP 55/2022
Berdasarkan PP 55 Tahun 2022, Wajib Pajak Badan berbentuk Perseroan Terbatas Perorangan yang didirikan oleh 1 orang berhak memanfaatkan skema PPh Final UMKM sebesar **0.5% dari peredaran bruto (omzet)** dengan ketentuan:
1. **Jangka Waktu:** Paling lama **4 (empat) Tahun Pajak** sejak tahun pajak terdaftar.
2. **Batasan Omzet:** Peredaran bruto akumulatif tidak melebihi **Rp4.800.000.000,- (Empat Miliar Delapan Ratus Juta Rupiah)** dalam satu Tahun Pajak.
3. **Mekanisme Pembayaran:** 
   * Dihitung bulanan: `Pajak Terutang = 0.5% × Total Penerimaan Kas Kotor Bulan Tersebut`.
   * Disetorkan paling lambat tanggal **15 bulan berikutnya** menggunakan Surat Setoran Elektronik (SSE / e-Billing) dengan Kode Akun Pajak:
     * **KAP:** `411128` (PPh Final)
     * **KOS:** `420` (PPh Final Pasal 4 ayat (2) atas Penghasilan Usaha Wajib Pajak yang Memiliki Peredaran Bruto Tertentu).
   * Validasi NTPN pada bukti setor bank otomatis dianggap sebagai pelaporan SPT Masa (tidak perlu lapor SPT Masa PPh Final bulanan lagi).

### 2.2 Cara Mendapatkan Surat Keterangan (Suket) PP 55
Setelah NPWP Badan terbit:
1. Login ke portal **DJP Online** (`https://djponline.pajak.go.id`).
2. Masuk ke menu **Layanan** → **KPP / Info Konfirmasi Status Wajib Pajak (KSWP)**.
3. Pilih pengajuan **Surat Keterangan (PP 55/2022)**.
4. Sistem akan otomatis memvalidasi eligibilitas dan menerbitkan Suket PP 55 dalam format PDF dengan QR code resmi DJP.
5. Simpan Suket ini. Tunjukkan kepada klien B2B atau payment gateway jika mereka meminta bukti potong agar perseroan hanya dipotong 0.5% (atau tidak dipotong PPh 23 2%).

### 2.3 Konsekuensi Strategis: Amortisasi Tidak Mengurangi Pajak
> [!IMPORTANT]
> Selama berada di bawah skema PPh Final 0.5%, **seluruh biaya operasional, penyusutan aset, dan amortisasi HAKI/software TIDAK MEMPENGARUHI jumlah pajak yang dibayar**. Pajak dihitung murni dari omzet.
> 
> Inilah alasan mengapa memaksakan valuasi inbreng Rp3,1 Miliar demi "amortisasi pajak" di awal adalah langkah keliru yang hanya mengundang risiko audit tanpa memberikan penghematan pajak sepeser pun.

---

## 3. Fase 2: Transisi ke PPh Badan Normal (Tahun Pajak ke-5 atau Omzet > Rp4,8 M)

Setelah 4 tahun berakhir atau omzet melampaui Rp4,8 Miliar, perseroan wajib menyelenggarakan pembukuan penuh dan menggunakan tarif umum PPh Badan.

### 3.1 Insentif Pasal 31E UU PPh (Fasilitas Pengurangan Tarif 50%)
Sesuai Pasal 31E UU PPh:
* Wajib Pajak Badan dalam negeri dengan peredaran bruto sampai dengan Rp50 Miliar mendapat fasilitas pengurangan tarif sebesar **50%** dari tarif umum (22%).
* Artinya, atas Penghasilan Kena Pajak yang menjadi bagian dari peredaran bruto hingga Rp4,8 Miliar dikenai tarif efektif **11%**.

$$\text{Pajak Terutang} = 50\% \times 22\% \times \text{Penghasilan Kena Pajak} = 11\% \times \text{Penghasilan Kena Pajak}$$

### 3.2 Strategi Beban Pengurang (Deductible Expenses)
Pada fase pembukuan normal, pajak dihitung dari **Laba Bersih Fiskal** (Pendapatan dikurangi Biaya Operasional yang diperbolehkan). Di fase ini, beban-beban berikut sah mengurangi laba kena pajak:
* Biaya server cloud (Cloudflare, Northflank, AWS, GCP).
* Biaya langganan API AI & developer tooling.
* Penyusutan aset hardware dan inventaris kantor (Golongan 1: masa manfaat 4 tahun, tarif 25% garis lurus).
* Beban gaji dan tunjangan BPJS Ketenagakerjaan/Kesehatan.
* Biaya perizinan, legal, sertifikasi SDPPI, dan audit.

---

## 4. Ekstraksi Kas & Keuntungan (Founder Remuneration Blueprint)

Bagaimana cara memindahkan uang dari rekening perseroan ke rekening pribadi founder dengan beban pajak paling minimal?

### Jalur 1: Dividen Bebas Pajak (0% PPh) — *Paling Efisien*
Sejak berlakunya UU Cipta Kerja yang dipertegas dalam UU HPP dan PMK 18/PMK.03/2021:
* Dividen yang dibagikan oleh badan usaha domestik kepada Wajib Pajak Orang Pribadi dalam negeri **DIKECUALIKAN DARI OBJEK PPh (0% Pajak)**.
* **Syarat Utama**: Dividen tersebut harus diinvestasikan di wilayah NKRI paling lambat akhir bulan ke-3 setelah tahun pajak pembagian dividen berakhir, dan dipertahankan minimal **3 (tiga) Tahun Pajak**.
* **Instrumen Investasi yang Memenuhi Syarat**:
  * Tabungan atau Deposito pada bank umum di Indonesia.
  * Surat Berharga Negara (SBN, ORI, Sukuk).
  * Saham/Reksadana yang diperdagangkan di Bursa Efek Indonesia (BEI).
  * Investasi langsung pada sektor riil / penyertaan modal pada usaha lain di Indonesia.
  * Pembelian properti/tanah yang bukan bagian dari aset perseroan.
* **Pelaporan**: Cukup dilaporkan pada Laporan Realisasi Investasi melalui menu e-Reporting di DJP Online setahun sekali sampai periode 3 tahun selesai.

### Jalur 2: Gaji Direktur Utama (Optimalisasi Batas PTKP)
* PT Perorangan memiliki struktur di mana founder adalah Direktur Utama sekaligus Pemegang Saham Tunggal.
* Gaji direktur yang dibayarkan merupakan biaya pengurang (deductible) bagi PT jika menggunakan pembukuan normal.
* Bagi pribadi, terdapat batasan **Penghasilan Tidak Kena Pajak (PTKP)** sebesar:
  * Rp54.000.000,-/tahun (TK/0 - Lajang tanpa tanggungan) atau Rp58.500.000,-/tahun (K/0 - Menikah tanpa tanggungan).
* **Taktik**: Menetapkan gaji resmi direktur setara PTKP (±Rp4.500.000,-/bulan). 
  * PPh 21 pribadi = **Rp0,-**.
  * Founder memiliki bukti slip gaji dan bukti potong formulir 1721-A1 resmi (sangat berguna untuk riwayat kredit perbankan, visa, dll.).
  * Sisa surplus keuntungan diambil melalui jalur Dividen Bebas Pajak.

### Jalur 3: Pinjaman dari Pemegang Saham (Shareholder Loan)
Bila founder ingin menyuntikkan dana tunai tambahan ke perseroan tanpa mengubah modal dasar:
* Diatur dalam PP No. 94/2010 Pasal 12: Pinjaman tanpa bunga dari pemegang saham diperbolehkan dan tidak dianggap sebagai dividen terselubung, asalkan:
  1. Pinjaman berasal dari dana milik pemegang saham itu sendiri (bukan dari pihak ketiga).
  2. Modal yang seharusnya disetor oleh pemegang saham telah disetor seluruhnya.
  3. Pemegang saham tidak dalam keadaan merugi.
  4. Perseroan sedang mengalami kesulitan keuangan untuk kelangsungan usahanya.
* Pengembalian pokok pinjaman dari perseroan ke rekening pribadi founder **bukan objek pajak**.

---

## 5. Pajak Pertambahan Nilai (PPN) — Strategi Non-PKP

1. **Ambang Batas Pengusaha Kena Pajak (PKP)**:
   * Sesuai PMK 197/PMK.03/2013, ambang batas kewajiban menjadi PKP adalah peredaran bruto di atas **Rp4.800.000.000,- per tahun**.
2. **Keuntungan Tetap Non-PKP untuk Kasirmu**:
   * Target pasar kasir.mu adalah UMKM, toko ritel, dan F&B independen. Sebagian besar dari mereka adalah entitas non-PKP yang sensitif harga.
   * Dengan tetap menjadi Non-PKP:
     * Kasirmu **tidak perlu memungut PPN 12%** ke merchant, membuat harga langganan software kasirmu 12% lebih kompetitif dibandingkan kompetitor korporat besar (seperti Moka/Pawoon yang memungut PPN).
     * Terbebas dari kewajiban administrasi e-Faktur bulanan yang rumit.
3. **Kapan Wajib Mengajukan PKP?**:
   * Wajib lapor pengukuhan PKP paling lambat akhir bulan berikutnya setelah bulan di mana akumulasi omzet dalam tahun berjalan menembus Rp4,8 Miliar.

---

## 6. Audit-Proofing: Mitigasi Risiko SP2DK & Pemeriksaan DJP

Untuk memastikan tidak pernah menerima Surat Permintaan Penjelasan atas Data dan/atau Keterangan (SP2DK) dari KPP Pratama:

1. **Sinkronisasi SPT Tahunan Pribadi & Profil Modal**:
   * Nilai modal disetor yang dimasukkan ke PT Perorangan (misalnya Rp50.000.000,- atau Rp100.000.000,-) **wajib tercatat di kolom Daftar Harta (Kode Harta: 031 - Saham Non-Bursa)** pada SPT Tahunan Pribadi 1770/1770S milik founder.
   * Uang tunai yang disetorkan harus konsisten dengan profil penghasilan yang telah dilaporkan.
2. **Pemisahan Total Rekening Bank**:
   * Jangan pernah mencampuradukkan penerimaan langganan merchant atau pembayaran hardware ke rekening pribadi.
   * Seluruh transaksi bisnis wajib masuk ke Rekening Giro atas nama PT.
3. **Penyimpanan Bukti Potong PPh 23**:
   * Jika ada merchant korporat (B2B besar) yang memotong PPh 23 atas langganan software, berikan Suket PP 55 agar mereka memotong tarif 0.5% (bukan 2%). Simpan bukti potong unifikasi yang mereka terbitkan untuk lampiran SPT Tahunan 1771.
4. **Kepatuhan Pembukuan Sederhana**:
   * Simpan mutasi bank dan pencatatan kas/bank secara rapi bulanan.
   * Rekonsiliasikan mutasi kredit rekening koran bank dengan laporan omzet bulanan. Selisih antara mutasi masuk bank dan omzet yang dilaporkan adalah pemicu nomor satu SP2DK DJP.
