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
  Ajukan Pengujian & Sertifikasi SDPPI Resmi atas nama PT Kasirmu (Biaya ±Rp25jt/model)
                            │
                            ▼
  Impor Kontainer Mandiri Menggunakan NIB (API-U) + Jalur Hijau Bea Cukai
  ==> HASIL: Margin Maksimal 40-50%, Perangkat Custom Proprietary
```

### Rekomendasi Eksekusi Saat Ini:
* **Jalankan Fase 1**: Manfaatkan distributor resmi lokal di Jakarta/Surabaya. 
* KBLI `46511` dan `47401` tetap dicantumkan pada NIB sejak hari pertama pendirian PT agar perseroan memiliki payung hukum sah untuk menjual paket bundling kasir (Software + Thermal Printer + Scanner + Tablet) ke merchant.
