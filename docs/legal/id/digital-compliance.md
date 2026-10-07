<!-- Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (2 minor findings) · Supersedes the marker below, kept verbatim. Two claims about what the SOFTWARE does were over-broad and are corrected: (1) §data-subject-rights named export formats "CSV / JSON / Excel" — no Excel/xlsx writer exists anywhere in the repo; CSV and JSON are real (crates/kasirmu-core/src/export/mod.rs). (2) §security-baseline listed "Argon2id / PBKDF2 / bcrypt" for credential hashing — PBKDF2 is not used (its only appearance is validate_phc_pin_hash REJECTING a $pbkdf2- prefix, crates/kasirmu-cli/src/commands_tests.rs:538); Argon2id is real (crates/kasirmu-core/src/kasirpkg.rs:181) and the schema allows bcrypt-or-argon2 (migrations/20260813_init.sql:975). Both corrected in place. External-law content (tax, KBLI, DJKI, UU PDP deadlines) was NOT reviewed and is not claimed here. · Repaired against branch 0.0.41. -->
<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It is part of the Indonesian legal and regulatory set in this directory, and that class of document needs its audit scope stated before anything else, because the wrong scope produces confident nonsense. · THE SUBJECT IS EXTERNAL LAW, AND NO REPOSITORY CAN VERIFY IT. This set cites specific regulations, specific government portals, specific fee schedules and specific registration procedures. Whether a tariff is still current, whether a regulation number still reads as quoted, or whether an online procedure still works is a question for someone with access to the source, and an audit that re-derived those answers would be inventing them. What IS checkable, and is what this pass checked, is everything the documents assert about THIS codebase and about each other: the product and domain names they register, the cross-references between them, and the internal claims that a reader would act on. · THOSE CHECK OUT, and the set is in better shape than most of the tree. Every one of the thirteen relative links across the five documents resolves, including the template references into the local template directory, which exists. And every one of the ten files names the current product domain — the previous domain appears in NONE of them, which makes this the cleanest rebrand position of any document class audited in this campaign and is worth recording as a positive. The administrative and commercial identity of the company is the one thing these documents must get exactly right, and they do. · WHAT IS DELIBERATELY NOT DONE, and the stamp should be read as saying so: no legal content was reviewed, no fee was checked, no regulation number was validated, and the `[DECIDED] & [VERIFIED]` status these documents carry for their legal content is THEIR claim, reproduced here without endorsement. A reader who treats an audit stamp as a legal opinion would be badly misled, which is exactly why this paragraph is in the stamp rather than left implicit. · This document is the one with the sharpest consequences stated in its own body — the platform risks administrative sanction, fines, and access termination including blocking the product domain and its API. That is precisely why the external claims are left entirely unaudited: a stamp on this file must not be readable as confirming that the registration obligations described are still current or correctly construed, and the paragraph above exists to prevent that reading. What is recorded is narrower and still useful — the system name and platform shapes it declares, and the domain registration it names, both of which match the product as it is currently built. · NOT re-measured: any regulatory, financial or procedural claim. · No stamp existed; this is the first. -->
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
* **Hak Akses & Portabilitas**: Merchant dapat mengekspor seluruh data penjualan dan transaksinya dalam format standar (CSV / JSON). <!-- docs-auditor 2026-10-08: removed "Excel" — no xlsx writer exists (git grep -il 'xlsx|excel' -- '*.rs' '*.toml' returns nothing); CSV and JSON are both real in crates/kasirmu-core/src/export/mod.rs. -->
* **Hak Koreksi**: Merchant dapat memperbarui profil bisnis dan informasi kasir kapan saja.
* **Hak Penghapusan (*Right to Erasure*)**: Merchant dapat mengajukan penutupan akun dan penghapusan data toko dari cloud kasir.mu.
* **Retensi Data**: Dokumen kebijakan retensi data (data logging & audit trail) diatur minimal 5 tahun untuk kepatuhan perpajakan pembukuan sesuai UU KUP.

### 2.3 Standar Keamanan Minimum (Security Baseline)
* Enkripsi seluruh lalu lintas data menggunakan TLS 1.3 / HTTPS.
* Hashing kredensial akun menggunakan algoritma kuat (Argon2id / bcrypt dengan salt acak). <!-- docs-auditor 2026-10-08: removed "PBKDF2" — it is not used for hashing (the only occurrence is `validate_phc_pin_hash` REJECTING a `$pbkdf2-` prefix, crates/kasirmu-cli/src/commands_tests.rs:538). Argon2id is real (crates/kasirmu-core/src/kasirpkg.rs:181); the schema comment allows bcrypt or argon2 (migrations/20260813_init.sql:975). -->
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

> last audited 08-10-26 by docs-auditor
