# Digital Compliance & Financial Regulatory Framework

> **Status:** `[DECIDED]` & `[VERIFIED]` against Permenkominfo No. 5/2020 jo. 10/2021, UU Perlindungan Data Pribadi (UU PDP No. 27/2022), and Peraturan Bank Indonesia (PBI No. 23/6/PBI/2021).
> **Tujuan:** Memastikan operasional platform cloud SaaS kasir.mu 100% patuh regulasi digital Indonesia, mencegah risiko pemblokiran domain/sistem oleh Kominfo, dan mematuhi regulasi perbankan/pembayaran digital.

---

## 1. Pendaftaran PSE Lingkup Privat Domestik (Kemenkominfo)

### 1.1 Dasar Hukum & Kewajiban
Berdasarkan **Peraturan Menteri Komunikasi dan Informatika No. 5 Tahun 2020** jo. **Permenkominfo No. 10 Tahun 2021**:
* Setiap badan usaha yang mengoperasikan portal, situs, atau aplikasi jaringan digital untuk:
  1. Menyediakan, mengelola, dan/atau mengoperasikan penawaran dan/atau perdagangan barang dan/atau jasa;
  2. Menyediakan layanan transaksi keuangan;
  3. Memproses Data Pribadi untuk kegiatan operasional yang melayani masyarakat di wilayah Indonesia;
  **WAJIB** mendaftarkan diri sebagai **Penyelenggara Sistem Elektronik (PSE) Lingkup Privat Domestik** sebelum sistem mulai digunakan oleh publik.

> [!WARNING]
> Platform yang tidak terdaftar dikenai sanksi administratif berupa surat peringatan tertulis, denda, hingga **pemutusan akses (pemblokiran situs, domain `kasir.mu`, dan API endpoint)** oleh Ditjen Aptika Kominfo.

### 1.2 Prosedur Pendaftaran via OSS-RBA (Gratis)
Pendaftaran PSE dilakukan secara digital tanpa dipungut biaya melalui integrasi OSS:
1. Login ke portal OSS (`https://oss.go.id`) menggunakan akun PT Perorangan.
2. Masuk ke menu **PB-UMKU (Perizinan Berusaha Untuk Menunjang Kegiatan Usaha)**.
3. Pilih KBLI terkait (`62010` atau `58290`), lalu cari perizinan: **Tanda Daftar Penyelenggara Sistem Elektronik (TDPSE) Domestik**.
4. Lengkapi formulir pendaftaran sistem elektronik:
   * **Nama Sistem Elektronik**: `Kasir.mu - Cloud POS & Merchant OS`
   * **Bentuk Sistem**: Web Application, Desktop Tauri Client, & Mobile Application
   * **Domain / URL**: `kasir.mu`, `api.kasir.mu`
   * **Kategori Sistem**: Layanan Perdagangan & Pengolahan Data Transaksi
   * **Deskripsi Singkat**: Aplikasi kasir berbasis cloud multi-platform untuk manajemen transaksi penjualan, inventori stok, dan laporan keuangan UMKM.
   * **Profil Pengelolaan Data Pribadi**: Memproses data nama, nomor telepon, dan email merchant.
   * **Lokasi Data Center / Cloud Provider**:
     * Primary Edge / API Routing: Cloudflare (Global / Anycast)
     * Backend Sync & Database: Northflank / Managed PostgreSQL (Region Asia / Singapore / Jakarta).
5. OSS menerbitkan **Tanda Daftar PSE (TDPSE)** yang dilengkapi QR Code dan nomor pendaftaran resmi Kominfo.
6. Nama perseroan dan sistem akan tercatat di situs publik resmi Kominfo: `https://pse.kominfo.go.id/tdpse-domestik`.

---

## 2. Kepatuhan UU Perlindungan Data Pribadi (UU PDP No. 27/2022)

Kasir.mu memproses data pemilik bisnis (merchant) dan data pelanggan akhir (pelanggan toko). Sesuai UU No. 27/2022 tentang Perlindungan Data Pribadi:

### 2.1 Pembedaan Peran Hukum Kasir.mu
1. **Sebagai Pengendali Data Pribadi (*Data Controller*)**:
   * **Objek**: Data akun merchant (Nama lengkap pemilik, email, nomor WhatsApp, nomor KTP/NPWP jika ada verifikasi akun, alamat toko).
   * **Kewajiban**: Wajib memperoleh persetujuan tegas (*explicit consent*) melalui Syarat & Ketentuan serta Kebijakan Privasi saat registrasi akun.
2. **Sebagai Prosesor Data Pribadi (*Data Processor*)**:
   * **Objek**: Data pelanggan akhir merchant (Nomor telepon pembeli untuk kirim struk WhatsApp, nama pembeli pada nota pemesanan).
   * **Kewajiban**: Kasir.mu hanya memproses data tersebut semata-mata atas instruksi merchant untuk pengiriman struk/nota. Kasir.mu **DILARANG KERAS** menjual, menyewakan, atau memanfaatkan data pelanggan akhir merchant untuk keperluan periklanan pihak ketiga tanpa persetujuan.

### 2.2 Hak-Hak Subjek Data yang Wajib Didukung Sistem
Sistem kasir.mu wajib menyediakan fitur teknis yang memungkinkan pemenuhan hak subjek data:
* **Hak Akses & Portabilitas**: Merchant dapat mengekspor seluruh data penjualan dan transaksinya dalam format standar (CSV / JSON / Excel).
* **Hak Koreksi**: Merchant dapat memperbarui profil bisnis dan informasi kasir kapan saja.
* **Hak Penghapusan (*Right to Erasure*)**: Merchant dapat mengajukan penutupan akun dan penghapusan data toko dari cloud kasir.mu.
* **Retensi Data**: Dokumen kebijakan retensi data (data logging & audit trail) diatur minimal 5 tahun untuk kepatuhan perpajakan pembukuan sesuai UU KUP.

### 2.3 Standar Keamanan Minimum (Security Baseline)
* Enkripsi seluruh lalu lintas data menggunakan TLS 1.3 / HTTPS.
* Hashing kredensial akun menggunakan algoritma kuat (Argon2id / PBKDF2 / bcrypt dengan salt acak).
* Database write isolation dan role-based access control (RBAC: Owner, Supervisor, Cashier).
* Mekanisme pelaporan insiden kebocoran data (*data breach notification*) paling lambat $3 \times 24$ jam kepada otoritas PDP dan subjek data terkait jika terjadi kegagalan keamanan sistem.

---

## 3. Regulasi Sistem Pembayaran (Bank Indonesia - PBI 23/6/PBI/2021)

Kasir.mu menyediakan integrasi pembayaran QRIS dan EDC/kartu. Di Indonesia, industri pembayaran diatur secara ketat oleh Bank Indonesia melalui Peraturan Bank Indonesia No. 23/6/PBI/2021 tentang Penyelenggara Jasa Pembayaran (PBI PJP).

### 3.1 Posisi Hukum Kasir.mu: Non-PJP (Merchant Enabler / Technical Integrator)
* **Kewajiban Izin PJP**: Badan usaha yang menampung dana pihak ketiga (e-wallet/escrow) atau bertindak sebagai *payment gateway* pemroses transfer wajib memiliki Izin PJP Kategori 1 atau Kategori 2 dari Bank Indonesia dengan modal disetor minimum puluhan miliar rupiah.
* **Strategi Aman Kasir.mu**:
  * Kasir.mu beroperasi murni sebagai **Penyedia Platform Teknologi Kasir (*Point of Sale Software Provider / Merchant Enabler*)**.
  * Kasir.mu **TIDAK PERNAH** menampung, mengendapkan, atau mengelola dana hasil penjualan merchant (*No Fund Pooling / No Escrow*).
  * Seluruh pemrosesan pembayaran nontunai (QRIS Dinamis, Kartu Debit/Kredit) diintegrasikan langsung dengan mitra PJP berizin resmi dari Bank Indonesia (misal: **Midtrans / PT Midtrans**, **Xendit / PT Sinar Digital Terdepan**, atau Bank Penerbit).
  * **Alur Dana Langsung**:
    $$\text{Konsumen} \xrightarrow{\text{Bayar via QRIS/EDC}} \text{Mitra PJP Berizin BI} \xrightarrow{\text{Settlement Langsung}} \text{Rekening Bank Merchant}$$
  * Kasir.mu hanya menerima panggilan API (*webhook notification*) bahwa pembayaran berhasil untuk menandai nota kasir lunas.
* **Keuntungan Hukum**: Kasir.mu bebas dari kewajiban perizinan PJP Bank Indonesia yang berbelit, audit kepatuhan PBI, dan persyaratan modal raksasa.
