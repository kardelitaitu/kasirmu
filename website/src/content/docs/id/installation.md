---
title: Instalasi
description: Pasang kasir.mu di Windows, macOS, atau Linux.
category: gettingStarted
order: 3
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · First audit stamp on this page; Indonesian translation of en/installation.md, audited the same day. · THE SUPPORT TABLE, CHECKED AGAINST A CONTRADICTION THAT LOOKS REAL AND IS NOT, exactly as the en twin records it: .github/workflows/release.yml builds and publishes macOS and Linux installers — the matrix includes desktop-linux (AppImage+deb), desktop-windows (NSIS+MSI) and desktop-macos (dmg) — and a release job hard-fails if any of the three expected artefacts is missing. The table is nonetheless CORRECT because it states SUPPORT, not build output, and the product's own stance is identical: README.md:329 says Windows is "the only working production-ready build" and lists Linux builds as in development. Preview installers exist; supported platforms are narrower. Left as written, and recorded so a future `.dmg` grep does not "correct" a correct table. · VERIFIED: the Windows requirement (WebView2 available on Windows 10/11) matches the shell's own startup note (apps/desktop-tauri/src/lib.rs:71, `WebView2Loader.dll` at startup); the installer name shape `kasir.mu_<versi>_x64-setup.exe` / `.msi` matches the NSIS+MSI bundle targets; "Pengaturan → Diagnostik Sistem → Periksa Pembaruan" resolves — the nav label is `settings-nav-system-diagnostics` = "Diagnostik Sistem" in shared-ui/locales/settings.id.ftl:71 and the update check lives on that page; "no rollback button" matches the signature-verified single-direction updater; the first-run wizard and the free-tier-starts-on-first-launch flow match activation.md and setup-wizard. · NOT re-measured: a real install on macOS/Linux, and the updater handshake against a published release. · The footer below is an internal marker, stripped from the built site by rehype-strip-audit-footer.mjs. -->

## Persyaratan sistem

Inti offline-first yang sama berjalan di semua platform:

| Platform                              | Status        |
| ------------------------------------- | ------------- |
| Windows 10 / 11 (64-bit)              | Siap          |
| macOS 12 atau lebih baru              | Segera hadir  |
| Linux (x86_64, glibc 2.31+ — Ubuntu 20.04 dan lebih baru) | Segera hadir |
| Android (tablet & ponsel)             | Segera hadir  |
| iOS (tablet & ponsel)                 | Segera hadir  |

RAM 4 GB dan ruang disk kosong 1 GB disarankan. Windows memakai runtime
WebView2 yang sudah tersedia di Windows 10 dan 11.

> **Catatan:** Windows satu-satunya platform yang tersedia saat ini. macOS,
> Linux, Android, dan iOS sedang dalam pengerjaan dan akan muncul di sini
> saat penginstalnya mulai dipublikasikan.

## Unduh dan pasang

Unduh dari [halaman unduh](../../download/) — tidak diperlukan akun.
Penginstalnya sendiri dipublikasikan di
[GitHub Releases](https://github.com/kardelitaitu/kasirmu/releases).

**Windows** — jalankan `kasir.mu_<versi>_x64-setup.exe` (atau `.msi`) dan ikuti
petunjuknya. Terpasang ke akun pengguna Anda dan menambahkan entri kasir.mu ke
menu Mulai.

## Peluncuran pertama

Wizard pengaturan menanyakan akun (atau pengaturan tanpa akun), jenis toko,
dan login owner — lihat [Wizard Pengaturan](../setup-wizard/). Paket gratis
dimulai pada peluncuran pertama; Anda dapat naik paket kapan saja dari
Pengaturan → Lisensi & Langganan.

## Pembaruan

kasir.mu memeriksa pembaruan saat dimulai, dan Anda dapat memeriksanya kapan
saja dari Pengaturan → Diagnostik Sistem → Periksa Pembaruan. Pembaruan diverifikasi
tanda tangannya dan dipasang lewat penginstal platform, jadi tidak ada yang
diterapkan tanpa konfirmasi Anda. Tidak ada tombol rollback — versi
sebelumnya dapat dipasang ulang secara manual dari halaman rilis.

## Langkah berikutnya

[Transaksi pertama Anda](../first-sale/), atau lihat [aktivasi](../activation/)
saat siap membuka lebih banyak lokasi, pembayaran QRIS, dan sinkron cloud.

---

Lanjut membaca · **Sebelumnya:** [Mulai Cepat](../quickstart/) · **Berikutnya:** [Wizard Pengaturan](../setup-wizard/)

> last audited 11-10-26 by docs-auditor
