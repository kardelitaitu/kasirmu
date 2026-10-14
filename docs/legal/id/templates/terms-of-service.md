<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · Re-audit. ONE MINOR FINDING, corrected in place and marked in the merged text below: the 2026-10-08 stamp and its operator note both said legal@kasir.mu AND support@kasir.mu "appear nowhere in the codebase". That is true of legal@kasir.mu but FALSE of support@kasir.mu, which is a shipped constant (website/src/components/ContactForm.tsx:29, asserted by contact-form.test.tsx at :178/:451/:477) and is published in the site i18n (website/src/i18n/{en,id}.json:61,88). The distinction matters because the note's advice — provision both before publishing — is wrong for a mailbox that already exists: the unused one is legal@ alone. Re-derived this pass and holding: the counterparty placeholder is used consistently (the 2026-10-08 repair is intact — no live "PT Kasirmu" remains outside the stamps themselves); the set's 35 internal links across 14 files all resolve; this template is named by docs/legal/id/checklist.md; and the payment-partner names it cites (§5.1 QRIS/Midtrans/Xendit/EDC) match the tree, where qris_auto.rs, local_payment.rs and the payment-infra migrations implement them. NOT re-measured: contract sufficiency, the jurisdiction/limitation clauses, and the refund policy in §4 — all the operator's, and counsel's, call. · MERGED 2026-10-08 STAMP, delimiters stripped: Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (2 findings) · Supersedes the marker below, kept verbatim. (1) The document named the counterparty "PT Kasirmu" in its preamble and its jurisdiction clause, while every other template in the set uses the placeholder "PT [Nama PT Anda]" — and the entity is not yet registered (docs/legal/id/checklist.md Fase 2 is "Pendirian Entitas"). Asserting a specific PT name in a governing-law clause before incorporation is a commitment the set cannot yet make, so both sites now use the same placeholder as its siblings. (2) §9 named legal@kasir.mu / support@kasir.mu; NEITHER IS A SERVER-SIDE SENDER (the software's only @kasir.mu mail sender is no-reply@kasir.mu, apps/license-server/smtp_mail.go:146) — an operator note records that they must be provisioned before publishing. Legal content itself is not reviewed. · Repaired against branch 0.0.41. · ⚠️ CORRECTED 2026-10-11 (docs-auditor): the original sentence said both mailboxes "appear nowhere in the codebase", which is true of legal@kasir.mu but FALSE of support@kasir.mu — that address is a shipped constant (website/src/components/ContactForm.tsx:29, asserted by contact-form.test.tsx at :178/:451/:477) and is published in the site's i18n as the support contact (website/src/i18n/{en,id}.json:61,88). It is a real, live support address, just not a mail SENDER configured on any server; the distinction matters because provisioning advice for a mailbox that already exists would be wrong. · · MERGED 2026-09-29 STAMP, delimiters stripped: Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It belongs to the Indonesian legal and regulatory set, whose audit scope this campaign states explicitly rather than leaving implicit. · THE SUBJECT IS EXTERNAL LAW AND NO REPOSITORY CAN VERIFY IT: statutes, portals, fee schedules and contract sufficiency are confirmed against their sources by someone who can reach them. What IS checkable — and what this pass checked — is what the documents assert about EACH OTHER and about this codebase: shared identifiers, cross-references, and the claims a reader would act on directly. · NOT re-measured: any regulatory, financial or contractual claim. The status this document carries about its own legal content is ITS claim, reproduced without endorsement. · A TEMPLATE IS AN INPUT, NOT A DESCRIPTION, so an error here reaches a published instrument rather than misinforming a reader. The referential check holds: the template is named by the directory index, exists at the path named, and the set's internal links resolve. · The substantive content is contract drafting — who may use the service, on what terms, and what is disclaimed — and none of it is reviewed here. A terms document is one of the few artefacts in this repository that is simultaneously a legal instrument, a product decision and a promise made to strangers; auditing it as documentation would be a category error. What a reader should take from this stamp is narrower and still useful: the file is present, reachable from the index, and internally consistent with the rest of the set. · A CROSS-DOCUMENT PROPERTY THE AUDIT CANNOT SETTLE, recorded for whoever assembles the suite: this directory now contains paired instruments — merchant terms, a privacy policy, a founder-to-company software licence, and two government-facing declarations — which read as one exercise, and a reader needs to know they came from the same understanding. Nothing in a documentation audit verifies that, and the directory index is the right place for it to be recorded. · No stamp existed; this is the first. -->
# Template — Syarat & Ketentuan Layanan Kasir.mu (Merchant Terms of Service)

> **Catatan Penggunaan:** Template ini digunakan sebagai perjanjian standar (*standard merchant agreement*) antara PT [Nama PT Anda] dengan para pemilik toko/merchant yang menggunakan software kasir.mu.
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
2. Setiap perselisihan atau sengketa yang timbul akan diselesaikan secara musyawarah untuk mencapai mufakat. Apabila musyawarah tidak mencapai mufakat dalam waktu 30 (tiga puluh) hari kalender, maka sengketa akan diselesaikan melalui yurisdiksi Pengadilan Negeri di domisili hukum PT [Nama PT Anda].

---

### 9. KONTAK RESMI KAMI
Pertanyaan atau permohonan klarifikasi mengenai Syarat dan Ketentuan ini dapat dikirimkan ke:
* **Email Dukungan**: `legal@kasir.mu` / `support@kasir.mu`
* **Alamat Kantor**: PT [Nama PT Anda], [Alamat Lengkap Perusahaan]

<!-- docs-auditor 2026-10-11 — OPERATOR NOTE (corrected): `support@kasir.mu` is a REAL,
     shipped address — it is a constant at website/src/components/ContactForm.tsx:29,
     asserted by its test suite, and published in website/src/i18n/{en,id}.json — so the
     support half of this line is legitimate as written. `legal@kasir.mu` is the unused
     one: it appears in no code, no i18n file and no server config, and the only
     `@kasir.mu` mail SENDER the software configures is `no-reply@kasir.mu`
     (apps/license-server/smtp_mail.go:146, plus the activate, paddle_webhook and
     password_rotation senders). Provision `legal@` (or edit this line) before
     publishing — an address the operator never created is a promise the contact
     section cannot keep. -->

> last audited 11-10-26 by docs-auditor
