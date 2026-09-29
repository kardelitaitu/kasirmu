<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It belongs to the Indonesian legal and regulatory set, whose audit scope this campaign states explicitly rather than leaving implicit. · THE SUBJECT IS EXTERNAL LAW AND NO REPOSITORY CAN VERIFY IT: statutes, portals, fee schedules and contract sufficiency are confirmed against their sources by someone who can reach them. What IS checkable — and what this pass checked — is what the documents assert about EACH OTHER and about this codebase: shared identifiers, cross-references, and the claims a reader would act on directly. · NOT re-measured: any regulatory, financial or contractual claim. The status this document carries about its own legal content is ITS claim, reproduced without endorsement. · A TEMPLATE IS AN INPUT, NOT A DESCRIPTION, so its failure mode is propagation: an error here reaches a published document rather than misinforming a colleague, and a privacy policy is the instrument most likely to be read by someone other than the team. That asymmetry is why the check performed was the referential one — this template is named by the directory index, exists at the path named, and the set's internal links resolve. Whether the clauses discharge the regime its own title cites is a question for counsel and is explicitly not adjudicated here. · A CROSS-DOCUMENT CHECK WORTH NAMING, because it is the kind of thing that drifts silently: the Indonesian set's digital-compliance document builds its data obligations on a personal-data statute, and this template is the instrument meant to discharge them. The title naming that statute explicitly is a real coherence between the two, and it is the kind of cross-reference that rots quietly if either document is revised alone. · The one thing a future reader should pair this with is the set's own settings-ingest story, which is engineering rather than legal but bears on the same data: the sealed ingest policy that refuses credential and device keys from untrusted lanes is the mechanism that keeps personal and device data from leaving a terminal, and a privacy policy is a promise about exactly that. THIS AUDIT DID NOT CHECK the correspondence between the two, which spans law and code and belongs with counsel. · No stamp existed; this is the first. -->
# Template — Kebijakan Privasi Kasir.mu (Privacy Policy compliant with UU PDP 27/2022)

> **Catatan Penggunaan:** Template ini disusun sesuai kepatuhan **UU No. 27 Tahun 2022 tentang Perlindungan Data Pribadi (UU PDP)** dan regulasi Kominfo.
> Wajib dipublikasikan pada situs web `kasir.mu/privacy` dan aplikasi mobile/desktop kasir.

---

## KEBIJAKAN PRIVASI KASIR.MU
**Terakhir Diperbarui: [Tanggal Bulan Tahun]**

**PT [Nama PT Anda]** (selanjutnya disebut **"Kasir.mu"**, **"Kami"**, atau **"Perusahaan"**) berkomitmen penuh untuk melindungi dan menghormati hak privasi serta Data Pribadi dari seluruh pengguna, pemilik toko (*Merchant*), kasir, dan pelanggan akhir (*Customer*) sesuai dengan ketentuan **Undang-Undang Republik Indonesia Nomor 27 Tahun 2022 tentang Perlindungan Data Pribadi (UU PDP)**.

Kebijakan Privasi ini menjelaskan bagaimana Kami mengumpulkan, menggunakan, menyimpan, memproses, dan melindungi Data Pribadi yang diperoleh melalui ekosistem aplikasi kasir (desktop, mobile, tablet) dan layanan komputasi awan (*cloud*) Kasir.mu.

---

### 1. DATA PRIBADI YANG KAMI KUMPULKAN
Kami mengumpulkan kategori data berikut sehubungan dengan penggunaan layanan:

1. **Data Identitas Merchant (Pemilik Usaha)**:
   * Nama lengkap pemilik toko / penanggung jawab badan usaha;
   * Alamat surat elektronik (*email*) aktif;
   * Nomor telepon seluler / WhatsApp aktif;
   * Nama dan alamat fisik lokasi gerai toko / gerai usaha;
   * Nomor Induk Kependudukan (NIK) atau Nomor Pokok Wajib Pajak (NPWP) jika diperlukan untuk verifikasi identitas akun bisnis atau kepatuhan faktur pajak.
2. **Data Operasional Transaksi Kasir**:
   * Katalog produk, rincian harga, jumlah stok barang;
   * Riwayat pencatatan transaksi penjualan kasir;
   * Metode pembayaran yang dipilih konsumen (Tunai, QRIS, Kartu Debit/Kredit).
3. **Data Pelanggan Akhir Toko (*End-Customer*)**:
   * Nomor telepon seluler atau nama pelanggan yang diinput oleh petugas kasir semata-mata atas permintaan/persetujuan pelanggan untuk keperluan pengiriman **struk nota digital via WhatsApp / SMS / Email**.
4. **Data Teknis dan Perangkat Kasir**:
   * Alamat Protokol Internet (IP Address), tipe perangkat keras (hardware kasir/tablet), versi sistem operasi, dan log kegagalan sistem (*crash/error logs*) untuk keperluan pemeliharaan stabilitas sistem.

---

### 2. DASAR HUKUM DAN TUJUAN PEMROSESAN DATA
Sesuai Pasal 20 UU PDP, Kami memproses Data Pribadi berdasarkan persetujuan sah yang eksplisit, pelaksanaan kewajiban perjanjian (*contractual necessity*), dan pemenuhan kewajiban hukum.

Tujuan pemrosesan mencakup:
1. Menyediakan fungsi inti aplikasi kasir, sinkronisasi basis data antar-perangkat, dan pencadangan data cloud;
2. Mengautentikasi hak akses masuk (*login*) pengguna dan mencegah akses tidak sah;
3. Mengirimkan notifikasi tagihan langganan, pembaruan versi perangkat lunak, dan bantuan teknis layanan pelanggan;
4. Menyalurkan data pemrosesan pembayaran secara aman ke mitra Penyelenggara Jasa Pembayaran (PJP) berizin Bank Indonesia;
5. Memenuhi kewajiban penyimpanan data pembukuan dan perpajakan sesuai peraturan perundang-undangan Republik Indonesia.

---

### 3. JAMINAN TIDAK MENJUAL DATA PRIBADI
> [!IMPORTANT]
> **Komitmen Mutlak Kasir.mu**:
> Kami **TIDAK PERNAH dan TIDAK AKAN PERNAH** menjual, menyewakan, memperdagangkan, atau memindahtangankan Data Pribadi Merchant maupun data konsumen toko Merchant kepada pihak ketiga mana pun untuk tujuan periklanan, pemasaran pihak ketiga, atau monetisasi data tanpa persetujuan tegas Anda.

---

### 4. PENYIMPANAN DAN KEAMANAN DATA
1. **Standar Keamanan Teknis**:
   * Seluruh pengiriman data antara aplikasi kasir lokal dan server komputasi awan dienkripsi menggunakan protokol **Transport Layer Security (TLS 1.3 / HTTPS)**.
   * Kata sandi akun dienkripsi menggunakan algoritma pengacakan satu arah yang kuat (*cryptographic hash with salt*).
   * Akses ke basis data produksi dibatasi secara ketat berdasarkan prinsip hak akses minimum (*Principle of Least Privilege*).
2. **Lokasi Penyimpanan Data (*Data Residency*)**:
   Data transaksi dan identitas pengguna disimpan pada infrastruktur cloud berstandar industri dengan pusat data regional yang mematuhi standar perlindungan data nasional Indonesia.
3. **Periode Retensi Data**:
   Kami menyimpan data transaksi selama akun Merchant berstatus aktif dan sekurang-kurangnya selama 5 (lima) tahun setelah penutupan akun guna memenuhi ketentuan retensi dokumen pembukuan perpajakan sesuai UU Ketentuan Umum dan Tata Cara Perpajakan (UU KUP).

---

### 5. HAK-HAK SUBJEK DATA PRIBADI (SESUAI UU PDP)
Sebagai pemilik Data Pribadi, Anda memiliki hak-hak yang dijamin oleh hukum:
1. **Hak Akses dan Salinan**: Hak untuk meminta konfirmasi dan salinan data pribadi yang Kami kelola melalui fitur ekspor data mandiri pada aplikasi.
2. **Hak Koreksi**: Hak untuk melengkapi atau memperbaiki ketidakakuratan data pribadi akun Anda kapan saja.
3. **Hak Penghapusan (*Right to Erasure*)**: Hak untuk meminta penghapusan akun dan data pribadi dari server cloud Kami apabila Anda memutuskan berhenti berlangganan, sepanjang tidak bertentangan dengan kewajiban retensi hukum perundang-undangan.
4. **Hak Penarikan Persetujuan**: Hak untuk mencabut persetujuan pemrosesan data pribadi yang sebelumnya telah diberikan.

---

### 6. PEMBERITAHUAN KEGAGALAN PERLINDUNGAN DATA (DATA BREACH)
Dalam hal terjadi insiden kegagalan perlindungan data pribadi atau kebocoran data pada sistem Kami, Kasir.mu berkomitmen menyampaikan pemberitahuan tertulis paling lambat dalam waktu **$3 \times 24$ jam** kepada Subjek Data terkait dan Lembaga Otoritas Perlindungan Data Pribadi sesuai amanat Pasal 46 UU PDP.

---

### 7. NARAHUBUNG DAN PEJABAT PERLINDUNGAN DATA
Apabila Anda memiliki pertanyaan, keberatan, atau ingin melaksanakan hak-hak subjek data Anda, silakan hubungi Tim Kepatuhan Privasi Kami melalui:

* **Petugas Perlindungan Data / Kontak Privasi**: `privacy@kasir.mu`
* **Alamat Kantor**: PT [Nama PT Anda], [Alamat Lengkap Perusahaan]

> last audited 29-09-26 by docs-auditor
