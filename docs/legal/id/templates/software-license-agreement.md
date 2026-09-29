<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It belongs to the Indonesian legal and regulatory set, whose audit scope this campaign states explicitly rather than leaving implicit. · THE SUBJECT IS EXTERNAL LAW AND NO REPOSITORY CAN VERIFY IT: statutes, portals, fee schedules and contract sufficiency are confirmed against their sources by someone who can reach them. What IS checkable — and what this pass checked — is what the documents assert about EACH OTHER and about this codebase: shared identifiers, cross-references, and the claims a reader would act on directly. · NOT re-measured: any regulatory, financial or contractual claim. The status this document carries about its own legal content is ITS claim, reproduced without endorsement. · A TEMPLATE IS AN INPUT, NOT A DESCRIPTION, so an error here reaches an executed instrument. The referential check holds: the template is named by the directory index, exists at the path named, and the set's internal links resolve. · This one earns a note of its own, and the title is why: it is a founder-to-company licence of the SOFTWARE ITSELF, which means it is the only instrument in the entire legal set whose subject is the asset this repository contains. Everything else here concerns the company's paperwork; this concerns ownership of the thing being built. That makes it the document where a legal defect would propagate furthest, and it is also the one a reader is most likely to skim. · A CORRESPONDENCE A FUTURE PASS SHOULD CHECK, named here because the audit that did not do it should say so: the company grants licences under this instrument, and the product enforces them through the licence-verification path — the per-device renewal refusal, the revoked state, and the lock behaviour that the licence audit and the tamper-resistance decision both rest on. A licence term the code does not enforce is a promise the product does not keep, and a refusal the code performs with no contractual basis is behaviour a user could not have anticipated. This document and the code describe the same relationship from two sides; NEITHER DIRECTION of that correspondence was checked here. · No stamp existed; this is the first. -->
# Template — Perjanjian Lisensi Eksklusif Perangkat Lunak (Founder ke PT)

> **Catatan Penggunaan:** Ini adalah dokumen inti untuk **Jalur A (Modal Tunai Bersih Rp50M–Rp100M + Lisensi Eksklusif)** yang sangat direkomendasikan.
> Dengan perjanjian ini:
> 1. Perseroan (**PT**) memiliki hak komersialisasi dan distribusi penuh untuk menjual langganan SaaS kasir.mu ke publik.
> 2. Hak Kekayaan Intelektual (HAKI) inti tetap aman di tangan **Pribadi Founder**, sehingga terlindung dari risiko gugatan pihak ketiga atau klaim pailit perseroan.
> 3. Zero risiko pajak inbreng, tidak butuh KJPP, dan bebas pertanyaan SP2DK.

---

## PERJANJIAN LISENSI EKSKLUSIF HAK CIPTA PERANGKAT LUNAK
### (*EXCLUSIVE SOFTWARE COPYRIGHT LICENSE AGREEMENT*)

Perjanjian Lisensi Eksklusif ini (selanjutnya disebut **"Perjanjian"**) dibuat dan ditandatangani pada hari ini, **[Hari]**, tanggal **[Tanggal]** bulan **[Bulan]** tahun **[Tahun]**, oleh dan antara:

1. **[Nama Lengkap Founder]**, Warga Negara Indonesia, pemegang Nomor Induk Kependudukan (NIK) **[Nomor KTP]**, bertempat tinggal di **[Alamat Sesuai KTP]**, dalam hal ini bertindak atas nama diri sendiri selaku Pencipta dan Pemegang Hak Cipta sah, selanjutnya disebut sebagai **"PEMBERI LISENSI"** (*Licensor*);
   
   dan

2. **PT [Nama PT Anda]**, suatu perseroan terbatas perorangan yang didirikan berdasarkan hukum Negara Republik Indonesia, beralamat kantor di **[Alamat Domisili PT]**, berdasar Sertifikat Pernyataan Pendirian Nomor **[Nomor AHU]** dan NIB **[Nomor NIB]**, dalam hal ini diwakili oleh **[Nama Lengkap Founder]** dalam jabatannya selaku Direktur Utama, selanjutnya disebut sebagai **"PENERIMA LISENSI"** (*Licensee*).

Pemberi Lisensi dan Penerima Lisensi secara bersama-sama disebut sebagai **"Para Pihak"**, dan masing-masing disebut sebagai **"Pihak"**.

---

### MENIMBANG:
A. Bahwa Pemberi Lisensi adalah pembuat, pemilik orisinal, dan pemegang tunggal seluruh Hak Cipta atas perangkat lunak sistem kasir titik penjualan (*Point of Sale*) bernama *"Kasir.mu"* beserta seluruh pustaka kode (*source code*), rancang bangun (*architecture*), algoritma, dan dokumentasinya;  
B. Bahwa Penerima Lisensi adalah badan usaha yang bergerak di bidang pemrograman komputer, penerbitan perangkat lunak, dan perdagangan perangkat kasir (KBLI 62010, 58290, 63102, 46511, 47401);  
C. Bahwa Pemberi Lisensi bermaksud memberikan hak eksklusif kepada Penerima Lisensi untuk mengomersialisasikan, mendistribusikan, menyewakan (SaaS), dan memonetisasi perangkat lunak tersebut di wilayah komersialnya.

MAKA, Para Pihak sepakat mengikatkan diri dalam ketentuan-ketentuan berikut:

---

### PASAL 1: DEFINISI & OBJEK LISENSI
1. **"Perangkat Lunak"** merujuk pada seluruh kode program, baik kode sumber (*source code*) maupun kode biner/terkompilasi (*binary*), modul backend (Rust/PostgreSQL/Cloudflare), antarmuka pengguna (React/Tauri Client), skrip migrasi basis data, dan dokumentasi terkait bernama *"Kasir.mu"*.
2. Objek lisensi tercatat pada Surat Pencatatan Hak Cipta Kementerian Hukum dan HAM RI Nomor: **[Nomor Registrasi DJKI / e-HakCipta]**.

### PASAL 2: PEMBERIAN HAK LISENSI EKSKLUSIF
1. Pemberi Lisensi dengan ini memberikan kepada Penerima Lisensi, dan Penerima Lisensi menerima hak lisensi yang bersifat:
   * **Eksklusif**: Pemberi Lisensi tidak akan memberikan lisensi komersialisasi serupa kepada badan usaha lain yang menjadi kompetitor langsung di wilayah yang disepakati.
   * **Mencakup Seluruh Dunia (*Worldwide*)**: Berlaku untuk pendistribusian lokal maupun lintas negara.
   * **Dapat Dilisensikan Lanjut (*Sub-licensable*)**: Penerima Lisensi berhak menerbitkan hak sub-lisensi akses (*user license / end-user software subscription*) kepada merchant/pelanggan kasir.mu.
2. Pemberian lisensi ini memberikan hak penuh kepada Penerima Lisensi untuk:
   * Memungut biaya langganan perangkat lunak (*software subscription fee / SaaS charges*);
   * Menjual paket bundling perangkat lunak bersama perangkat keras kasir pendukung;
   * Menghubungkan sistem dengan saluran pembayaran pihak ketiga (Payment Gateway / QRIS / EDC).

### PASAL 3: KEPEMILIKAN HAK CIPTA & PERLINDUNGAN ASET
1. **Kepemilikan Moral & HAKI**: Para Pihak menegaskan bahwa hak moral (*moral rights*) dan hak kepemilikan ciptaan (*ownership rights*) atas Perangkat Lunak tetap melekat dan menjadi milik sah PEMBERI LISENSI secara mutlak.
2. **Perlindungan Terhadap Klaim Pihak Ketiga**:
   Perangkat Lunak **bukan merupakan aset kepemilikan perseroan (Penerima Lisensi)**, melainkan hak guna usaha yang dilisensikan. 
   Apabila di kemudian hari Penerima Lisensi mengalami sengketa utang piutang, tuntutan ganti rugi perdata, proses hukum kepailitan, atau likuidasi perseroan, **Perangkat Lunak tidak dapat dimasukkan ke dalam boedel pailit** maupun disita oleh pihak ketiga mana pun.

### PASAL 4: IMBALAN LISENSI (ROYALTI)
1. Selama masa inkubasi dan pengembangan awal perseroan (Tahun ke-1 sampai dengan Tahun ke-3), Para Pihak sepakat bahwa lisensi komersialisasi ini diberikan atas dasar **Bebas Royalti (*Royalty-Free Incubation Scheme*)**, guna memaksimalkan reinvestasi arus kas perseroan untuk ekspansi operasional.
2. Setelah tahun ke-3 atau apabila perseroan telah mencatatkan peredaran bruto melampaui batas tertentu, Para Pihak dapat menetapkan adendum tersendiri mengenai pembagian royalti yang wajar secara komersial.

### PASAL 5: OPSI KONVERSI INBRENG MENYUSUL (SUBSEQUENT INBRENG OPTION)
1. Para Pihak sepakat bahwa di masa depan, Pemberi Lisensi memiliki hak opsi tunggal untuk mengonversikan status lisensi eksklusif ini menjadi pengalihan hak kepemilikan mutlak (*transfer of ownership / inbreng*) sebagai bentuk penyetoran modal tambahan perseroan.
2. Pelaksanaan inbreng menyusul tersebut akan dituangkan dalam Keputusan Pemegang Saham dan didaftarkan melalui Pernyataan Perubahan Perseroan Perorangan pada sistem AHU Kementerian Hukum dan HAM RI.
3. Penetapan nilai valuasi inbreng menyusul akan didasarkan pada Laporan Penilaian Resmi dari Kantor Jasa Penilai Publik (KJPP) independen terdaftar, dengan seluruh biaya appraisal menjadi beban perseroan (Penerima Lisensi).

### PASAL 6: JANGKA WAKTU & PENGAKHIRAN
1. Perjanjian ini berlaku terhitung sejak tanggal penandatanganan untuk jangka waktu **5 (lima) tahun**, dan akan diperpanjang secara otomatis untuk periode yang sama kecuali disepakati lain oleh Para Pihak secara tertulis atau telah dikonversikan menjadi inbreng modal penuh sesuai Pasal 5.
2. Perjanjian ini dapat diakhiri sewaktu-waktu atas kesepakatan tertulis Para Pihak atau apabila Penerima Lisensi dibubarkan secara hukum.

### PASAL 7: HUKUM YANG BERLAKU & PENYELESAIAN SENGKETA
Perjanjian ini diatur dan ditafsirkan berdasarkan hukum Negara Republik Indonesia. Segala perselisihan yang timbul dari pelaksanaan Perjanjian ini akan diselesaikan secara musyawarah mufakat.

---

Demikian Perjanjian ini dibuat dalam rangkap 2 (dua) bermeterai cukup, masing-masing mempunyai kekuatan hukum yang sama.

\
**PEMBERI LISENSI (*Licensor*)**  
*(Atas Nama Pribadi Pencipta)*  

*(Meterai Rp10.000,-)*  

\
\
**([Nama Lengkap Founder])**  
Pencipta & Pemegang Hak Cipta  

\
\
**PENERIMA LISENSI (*Licensee*)**  
**PT [Nama PT Anda]**  

\
\
**([Nama Lengkap Founder])**  
Direktur Utama  

> last audited 29-09-26 by docs-auditor
