<!-- Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 finding) · Supersedes the marker below, kept verbatim. The Phase-2 hardware diagram instructed the reader to file the SDPPI certification "atas nama PT Kasirmu", the only organisation name in the set that was neither the placeholder "PT [Nama PT Anda]" nor a described entity form. Made uniform with every other template, since the PT is not yet registered. The KBLI codes themselves are external facts (OSS-RBA) and are NOT verified here; the prior marker's finding that the five codes agree across four documents still holds. · Repaired against branch 0.0.41. -->
<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It belongs to the Indonesian legal and regulatory set in this directory, whose audit scope this campaign states explicitly rather than leaving implicit, because the wrong scope produces either confident nonsense or a stamp that gets over-read. · THE SUBJECT IS EXTERNAL LAW, AND NO REPOSITORY CAN VERIFY IT. This set cites statutes, government portals, fee schedules and classification standards. Whether a tariff is current or a statute still reads as quoted is a question for someone with access to the source. What IS checkable — and what this pass checked — is what the documents assert about EACH OTHER and about this codebase: the identifiers they share, the cross-references between them, and the claims a reader would act on directly. Those are the parts that fail silently, and they are the parts that matter to anyone actually using this directory. · NOT re-measured: any regulatory, financial or procedural claim. The status this document carries about its own legal content is ITS claim, reproduced here without endorsement; a reader treating this stamp as a legal opinion would be misled, which is exactly why the paragraph is here. · THE ONE FILE IN THE SET WHOSE CONTENT IS MECHANICALLY CHECKABLE END TO END, because it is a table of identifiers rather than a statement about law, and this pass checked it that way. The README, the master checklist, the digital-compliance guide and the entity-setup guide all name the SAME FIVE business-classification codes, and all five are defined here with matching Indonesian titles — so the classification the company would register under is internally consistent across four independent documents, with no drift between the summary and the detail. That is the most valuable verification in this directory, because a classification mismatch is exactly the kind of error that is cheap to make and expensive to discover after filing. · The codes are also characterised by risk level, and that characterisation is consistent with how the compliance document treats the same codes. · What is NOT established is whether any of the five is the RIGHT code, or whether the set is complete for what the product actually does — that requires reading the current classification standard, which is outside this audit. What is established is that the documents agree with one another, which is a real and non-trivial result. · No stamp existed; this is the first. -->
# KBLI Codes & Hardware Compliance Strategy (Analisis KBLI & Regulasi Hardware)

> **Status:** `[DECIDED]` & `[VERIFIED]` against PP No. 5/2021 tentang Penyelenggaraan Perizinan Berusaha Berbasis Risiko (OSS-RBA), Permenkominfo No. 16/2018 (Sertifikasi Alat Telekomunikasi), and Permendag Tata Niaga Impor.
> **Tujuan:** Menetapkan payung hukum KBLI yang lengkap, menganalisis tingkat risiko izin, serta membedah regulasi pengadaan hardware kasir (impor vs distributor lokal).

---

## 1. Lima KBLI Terdaftar & Status Tingkat Risiko OSS-RBA

Seluruh KBLI yang dipilih untuk PT Perorangan memiliki klasifikasi **Tingkat Risiko Rendah (Low Risk)** dalam sistem OSS-RBA. Ini berarti:
* **NIB (Nomor Induk Berusaha)** berlaku langsung sebagai izin edar dan perizinan berusaha definitif untuk operasional komersial.
* **Tidak memerlukan verifikasi teknis lapangan**, survei lokasi fisik, atau audit inspeksi oleh dinas pemerintah daerah sebelum mulai beroperasi.

| Kode KBLI | Judul KBLI | Tingkat Risiko OSS | Ruang Lingkup Legalitas untuk Kasir.mu |
|---|---|---|---|
| **62010** | Aktivitas Pemrograman Komputer | **Rendah** | Pengembangan kode sumber (*source code*), API gateway, integrasi sistem pembayaran, perbaikan *bug*, dan rekayasa platform backend/frontend. |
| **58290** | Penerbitan Perangkat Lunak Lainnya | **Rendah** | Komersialisasi, distribusi lisensi perangkat lunak, penjualan paket langganan SaaS kasir ke merchant, dan penerbitan hak akses aplikasi. |
| **63102** | Aktivitas Hosting dan Fasilitas Terkait | **Rendah** | Penyediaan infrastruktur komputasi awan, penyimpanan basis data transaksi toko secara terpusat, sinkronisasi multi-perangkat kasir, dan backup cloud. *(Wajib TDPSE Kominfo)*. |
| **46511** | Perdagangan Besar Komputer, Perlengkapan Komputer dan Piranti Lunak | **Rendah** | Penjualan partai besar / B2B perangkat kasir (bundling hardware POS, laci kasir, thermal printer, barcode scanner) kepada mitra atau jaringan waralaba (*franchise*). |
| **47401** | Perdagangan Eceran Komputer dan Perlengkapannya | **Rendah** | Penjualan langsung unit hardware kasir satuan kepada merchant/toko ritel mandiri melalui toko resmi kasir.mu atau marketplace. |

---

## 2. Bedah Regulasi: NIB sebagai API-U vs. Realitas Impor Hardware

### 2.1 Legalitas NIB sebagai API-U (Selesai & Sah)
Berdasarkan **PP No. 5 Tahun 2021 Pasal 175**:
* NIB yang diterbitkan oleh OSS secara otomatis berlaku sah sebagai **Angka Pengenal Importir Umum (API-U)** dan Hak Akses Kepabeanan.
* PT Perorangan Anda telah memiliki identitas hukum importir yang terhubung ke sistem Indonesia National Single Window (INSW) dan Ditjen Bea dan Cukai.

### 2.2 Hambatan Regulasi Hardware Nirkabel (LARTAS & SDPPI Kominfo)
Meskipun PT memiliki hak impor umum (API-U), mengimpor perangkat kasir (POS Terminal, EDC, Mobile POS) menghadapi regulasi ketat:

1. **Sertifikasi SDPPI / POSTEL (Ditjen SDPPI Kemenkominfo)**:
   * Sesuai UU Telekomunikasi jo. Permenkominfo No. 16/2018, setiap alat atau perangkat telekomunikasi yang memancarkan/menerima gelombang radio (**Wi-Fi 2.4/5 GHz, Bluetooth, 4G LTE/GSM, NFC**) **WAJIB** memiliki **Sertifikat Uji Tipe Perangkat Telekomunikasi (SDPPI)** sebelum dapat melewati kepabeanan Bea Cukai.
   * Uji tipe memerlukan pengujian sampel fisik di Balai Besar Pengujian Perangkat Telekomunikasi (BBPPT) di Bekasi atau laboratorium luar negeri yang diakui MRA.
   * **Biaya Pengujian**: Rp15.000.000,- s.d. Rp35.000.000,- per tipe/model perangkat, memakan waktu 30–60 hari kerja.
2. **Kewajiban Persetujuan Impor (PI) & Laporan Surveyor (LS)**:
   * Impor barang elektronik terkena aturan Larangan & Pembatasan (LARTAS) Kementerian Perdagangan, membutuhkan verifikasi surveyor di pelabuhan muat negara asal.
3. **Pusat Layanan Purna Jual & Garansi (Kemendag)**:
   * Penjual hardware elektronik wajib memiliki jaringan service center atau kerja sama purna jual serta kartu garansi berbahasa Indonesia (MKG).

---

## 3. Strategi Suplai Hardware 2 Fase (The 2-Phase Strategy)

Untuk menjaga fondasi bisnis tetap kokoh dan ramping (*lean*), strategi pengadaan perangkat keras kasir.mu dibagi menjadi 2 fase:

```
[FASE 1: Start-up & Growth (0 - 500 Unit/Bulan)]
  Prinsipal / Distributor Resmi Lokal di Indonesia (Sunmi / iMin / Epson / Panda / Kassen)
                            │
                            ▼
              Beli Putus / Dropship Grosir Lokal
              (Sudah Lolos Bea Cukai, Berizin SDPPI, Garansi Resmi 1 Tahun)
                            │
                            ▼
       Bundling dengan Software Kasir.mu (KBLI 47401 & 46511)
  ==> HASIL: Margin Bersih 15-25%, ZERO Risiko Regulasi Impor & Bebas Uji SDPPI

                            │
                            ▼ (Setelah Skala Penjualan > 500 Unit/Bulan)

[FASE 2: Scale-up & Custom OEM Branding]
  Pabrikan OEM Langsung (Shenzhen / Guangzhou) dengan Branding Eksklusif "Kasir.mu"
                            │
                            ▼
  Ajukan Pengujian & Sertifikasi SDPPI Resmi atas nama PT [Nama PT Anda] (Biaya ±Rp25jt/model)
                            │
                            ▼
  Impor Kontainer Mandiri Menggunakan NIB (API-U) + Jalur Hijau Bea Cukai
  ==> HASIL: Margin Maksimal 40-50%, Perangkat Custom Proprietary
```

### Rekomendasi Eksekusi Saat Ini:
* **Jalankan Fase 1**: Manfaatkan distributor resmi lokal di Jakarta/Surabaya. 
* KBLI `46511` dan `47401` tetap dicantumkan pada NIB sejak hari pertama pendirian PT agar perseroan memiliki payung hukum sah untuk menjual paket bundling kasir (Software + Thermal Printer + Scanner + Tablet) ke merchant.

> last audited 08-10-26 by docs-auditor
