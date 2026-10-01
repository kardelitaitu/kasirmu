<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It belongs to the Indonesian legal and regulatory set, whose audit scope this campaign states explicitly rather than leaving implicit. · THE SUBJECT IS EXTERNAL LAW AND NO REPOSITORY CAN VERIFY IT: statutes, portals, fee schedules and contract sufficiency are confirmed against their sources by someone who can reach them. What IS checkable — and what this pass checked — is what the documents assert about EACH OTHER and about this codebase: shared identifiers, cross-references, and the claims a reader would act on directly. · NOT re-measured: any regulatory, financial or contractual claim. The status this document carries about its own legal content is ITS claim, reproduced without endorsement. · A TEMPLATE IS AN INPUT, NOT A DESCRIPTION, so an error here reaches a published instrument rather than misinforming a reader. The referential check holds: the template is named by the directory index, exists at the path named, and the set's internal links resolve. · The substantive content is contract drafting — who may use the service, on what terms, and what is disclaimed — and none of it is reviewed here. A terms document is one of the few artefacts in this repository that is simultaneously a legal instrument, a product decision and a promise made to strangers; auditing it as documentation would be a category error. What a reader should take from this stamp is narrower and still useful: the file is present, reachable from the index, and internally consistent with the rest of the set. · A CROSS-DOCUMENT PROPERTY THE AUDIT CANNOT SETTLE, recorded for whoever assembles the suite: this directory now contains paired instruments — merchant terms, a privacy policy, a founder-to-company software licence, and two government-facing declarations — which read as one exercise, and a reader needs to know they came from the same understanding. Nothing in a documentation audit verifies that, and the directory index is the right place for it to be recorded. · No stamp existed; this is the first. -->
# Template — Syarat & Ketentuan Layanan Kasir.mu (Merchant Terms of Service)

> **Catatan Penggunaan:** Template ini digunakan sebagai perjanjian standar (*standard merchant agreement*) antara PT Kasirmu dengan para pemilik toko/merchant yang menggunakan software kasir.mu.
> Dokumen ini wajib dimuat pada halaman pendaftaran situs web `kasir.mu/terms` dan disetujui melalui tombol *"Saya Menyetujui Syarat & Ketentuan"* saat pendaftaran akun toko.

---

## SYARAT DAN KETENTUAN LAYANAN KASIR.MU
**Terakhir Diperbarui: [Tanggal Bulan Tahun]**

Selamat datang di **Kasir.mu**. Layanan ini dioperasikan oleh **PT [Nama PT Anda]** (selanjutnya disebut **"Kasir.mu"**, **"Kami"**, atau **"Perusahaan"**).

Dengan mendaftar, mengakses, mengunduh, atau menggunakan aplikasi kasir (desktop, web, maupun mobile) serta layanan komputasi awan Kasir.mu, Anda (selanjutnya disebut **"Pengguna"** atau **"Merchant"**) menyatakan telah membaca, memahami, dan menyetujui untuk terikat secara hukum oleh Syarat dan Ketentuan ini.

---

### 1. DEFINISI
1. **"Platform Kasir.mu"** adalah ekosistem perangkat lunak kasir (*Point of Sale*) terintegrasi yang mencakup aplikasi lokal (berbasis desktop/tablet/mobile) dan layanan cloud sinkronisasi data transaksi, manajemen inventori, dan laporan keuangan toko.
2. **"Merchant"** adalah badan usaha, perorangan, pemilik toko ritel, kafe, restoran, atau pelaku UMKM yang membuka akun di Platform Kasir.mu untuk menunjang aktivitas kasir tokonya.
3. **"Data Merchant"** adalah seluruh data transaksi penjualan, katalog produk, daftar harga, riwayat stok, dan laporan keuangan yang dimasukkan oleh Merchant ke dalam sistem.

---

### 2. KETENTUAN AKUN & KEAMANAN
1. Merchant wajib memberikan data yang akurat, sah, dan terkini saat pendaftaran akun.
2. Merchant bertanggung jawab penuh atas kerahasiaan kata sandi (*password*) akun serta hak akses staf kasir (*cashier pin/role permissions*).
3. Segala aktivitas transaksi yang dilakukan melalui akun Merchant dianggap sebagai tindakan yang sah dari Merchant yang bersangkutan.

---

### 3. LISENSI PENGGUNAAN PERANGKAT LUNAK (SaaS)
1. Kasir.mu memberikan kepada Merchant lisensi yang bersifat non-eksklusif, tidak dapat dialihkan, dan dapat dibatalkan, semata-mata untuk mengoperasikan sistem kasir internal toko Merchant selama periode langganan aktif.
2. Merchant **DILARANG**:
   * Melakukan rekayasa balik (*reverse engineering*), dekompilasi, atau membongkar kode biner aplikasi kasir.mu;
   * Menyewakan kembali, menjual kembali lisensi akun, atau mendistribusikan ulang perangkat lunak kasir.mu kepada pihak ketiga tanpa persetujuan tertulis;
   * Menggunakan platform untuk aktivitas transaksi barang/jasa ilegal yang dilarang oleh hukum Negara Republik Indonesia.

---

### 4. BIAYA LANGGANAN & PEMBAYARAN
1. Layanan komputasi awan Kasir.mu disediakan dengan skema berlangganan (bulanan atau tahunan) sesuai paket harga yang dipilih Merchant.
2. Pembayaran biaya langganan dilakukan di muka (*prepaid*) melalui kanal pembayaran resmi yang disediakan di platform.
3. Seluruh pembayaran biaya langganan bersifat final dan **tidak dapat dikembalikan (*non-refundable*)**.

---

### 5. INTEGRASI PEMBAYARAN DIGITAL (DISCLAIMER PIHAK KETIGA)
1. Kasir.mu menyediakan antarmuka teknis (*technical integration*) yang menghubungkan aplikasi kasir dengan mitra Penyelenggara Jasa Pembayaran (PJP) berizin Bank Indonesia (seperti QRIS Dinamis, Midtrans, Xendit, atau EDC bank mitra).
2. **Kasir.mu bukan merupakan bank atau lembaga keuangan penampung dana**. Kasir.mu tidak pernah mengendapkan atau menampung dana hasil transaksi penjualan Merchant.
3. Seluruh proses penagihan, *settlement* pencairan dana ke rekening bank toko Merchant, perselisihan transaksi (*chargeback*), atau gangguan jaringan perbankan tunduk sepenuhnya pada syarat dan perjanjian antara Merchant dengan mitra PJP terkait.

---

### 6. OPERASIONAL OFFLINE-FIRST & TANGGUNG JAWAB DATA
1. Platform Kasir.mu didesain dengan arsitektur *offline-first*. Aplikasi kasir lokal dapat mencatat transaksi penjualan meskipun koneksi internet terputus, dan akan melakukan sinkronisasi otomatis (*cloud sync*) saat internet kembali terhubung.
2. Merchant bertanggung jawab untuk memastikan perangkat kasir terhubung ke internet secara berkala guna mencadangkan data ke cloud.
3. Kasir.mu menerapkan standar enkripsi dan keamanan data industri terbaik. Namun demikian, Kasir.mu tidak bertanggung jawab atas kehilangan data lokal yang diakibatkan oleh kerusakan fisik perangkat kasir Merchant, serangan malware pada komputer kasir, atau penghapusan manual oleh staf toko.

---

### 7. BATASAN TANGGUNG JAWAB (LIMITATION OF LIABILITY)
1. Sejauh diizinkan oleh hukum yang berlaku di Indonesia, Layanan Kasir.mu disediakan berdasarkan kondisi *"SEBAGAIMANA ADANYA"* (*AS IS*) dan *"SEBAGAIMANA TERSEDIA"* (*AS AVAILABLE*).
2. Kasir.mu tidak bertanggung jawab atas kerugian tidak langsung, kerugian keuntungan usaha (*loss of profits*), atau gangguan usaha yang timbul akibat:
   * Kegagalan jaringan telekomunikasi seluler / internet penyedia layanan lokal Merchant;
   * Kesalahan input harga atau data stok oleh petugas kasir Merchant;
   * Pemadaman listrik di toko Merchant;
   * Keadaan Kahar (*Force Majeure*) seperti bencana alam, kebakaran, kerusuhan, atau kebijakan pemblokiran darurat dari otoritas pemerintah.
3. Dalam kondisi apa pun, batas tanggung jawab ganti rugi maksimal Kasir.mu kepada Merchant dibatasi sebesar total biaya langganan yang sesungguhnya telah dibayarkan oleh Merchant kepada Kasir.mu dalam jangka waktu 3 (tiga) bulan terakhir.

---

### 8. HUKUM YANG BERLAKU & PENYELESAIAN SENGKETA
1. Syarat dan Ketentuan ini diatur dan ditafsirkan sesuai dengan hukum Negara Republik Indonesia.
2. Setiap perselisihan atau sengketa yang timbul akan diselesaikan secara musyawarah untuk mencapai mufakat. Apabila musyawarah tidak mencapai mufakat dalam waktu 30 (tiga puluh) hari kalender, maka sengketa akan diselesaikan melalui yurisdiksi Pengadilan Negeri di domisili hukum PT Kasirmu.

---

### 9. KONTAK RESMI KAMI
Pertanyaan atau permohonan klarifikasi mengenai Syarat dan Ketentuan ini dapat dikirimkan ke:
* **Email Dukungan**: `legal@kasir.mu` / `support@kasir.mu`
* **Alamat Kantor**: PT [Nama PT Anda], [Alamat Lengkap Perusahaan]

> last audited 29-09-26 by docs-auditor
