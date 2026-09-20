---
title: Peran Pengguna
description: Lima preset izin menentukan apa yang bisa dilakukan dan dilihat setiap akun staf.
category: gettingStarted
order: 5
updated: "2026-09-19"
---

<!-- Audit stamp: 2026-09-19 · DSH · status: ACCURATE AFTER REPAIR (3 findings) · 2026-09-19 RE-AUDIT: Staff management dan pembuatan peran kini menjadi halaman layar penuh tersendiri — ui/src/features/staff/register.tsx:20-33 mendaftarkan kedua rute dengan fullscreen: true dan tidak lagi memanggil registerNavItem, sehingga AppShell merendernya tanpa AppLayout dan bilah sisi tidak memuat keduanya. Kedua penunjuk "di bagian Alat pada bilah sisi" di halaman ini karena itu salah dan dialihkan ke kartu Staff Management di kisi Tools pemilih ruang kerja dan ke tombol Roles di halaman Staf. Diverifikasi pada aplikasi yang berjalan: seksi Tools di bilah sisi memuat Terminal, Fitur, Data, Log Audit, Security Trail, Antrian Offline, Shift, Memo — tanpa Staf maupun Peran. · 2026-09-08 · DSH · status: PARTIALLY REPAIRED - UNREVIEWED TRANSLATION (2 findings) · Indonesian counterpart of en/user-roles.md, first audit evidence. · Two corrections applied, both factual pointers rather than prose: Pengaturan -> Staf was wrong (Staff is registered in ui/src/features/staff/register.tsx with section: tools, label nav-section-tools = Alat; ui/src/features/settings/ contains no route reference to staff at all), and the Custom bullet read as though custom roles did not exist yet. Role authoring is shipped and routed - route roles, label Peran, gated manager AND staff:manage_roles. Both replacement sentences use the app's own localized labels from shared.id.ftl (Alat, Staf, Peran) rather than invented terms. · CAVEAT, deliberately not hidden: the two replacement sentences are Indonesian I composed from the surrounding text's patterns, NOT a translation by a native speaker or the product's copywriter. The rest of this page is untouched. If a reviewer disagrees with the phrasing, correct the wording - the underlying facts (where Staff lives, that role authoring exists and is gated on staff:manage_roles) are verified against the code and should not be reverted. · NOT ported from the English page: the new Authoring custom roles section (grant registry, the two delete guards, role holders). That is real copywriting and belongs to whoever owns this locale. Page parity is otherwise intact: 17 en, 17 id. -->

## Apa itu peran

Setiap akun staf memiliki peran — preset izin yang menentukan apa yang bisa
dilakukan dan dilihat akun tersebut. Peran berasal dari taksonomi tetap lima
preset, yang ditampilkan saat Anda mengubah akun di layar **Staf** — halaman
layar penuh tersendiri yang Anda buka dari kartu **Staff Management** di kisi Tools
pemilih ruang kerja, bukan entri bilah sisi. Tabel bawaan sebenarnya memuat enam preset;
yang ditawarkan di pemilih staf ada lima, dan yang keenam dijelaskan di bawah.

## Lima peran

| Area akses                         | Staf | Manajer | Auditor | Admin | Pemilik |
| ---------------------------------- | ---- | ------- | ------- | ----- | ------- |
| Penjualan & kasir                  | ✓    | ✓       | —       | ✓     | ✓       |
| Void & refund                      | —    | ✓       | —       | ✓     | ✓       |
| Pembayaran (tunai, kartu, setelmen) | ✓   | ✓       | —       | ✓     | ✓       |
| Diskon (terapkan)                  | ✓    | ✓       | —       | ✓     | ✓       |
| Lampirkan pelanggan & loyalitas di kasir | ✓ | ✓ | —    | ✓     | ✓       |
| Shift (buka, tutup)                | ✓    | ✓       | lihat   | ✓     | ✓       |
| Produk & katalog                   | —    | ✓       | baca    | ✓     | ✓       |
| Ubah biaya produk                  | —    | ✓       | —       | ✓     | ✓       |
| Inventaris (sesuaikan, transfer, opname) | — | ✓ | baca | ✓   | ✓       |
| Pelanggan & loyalitas (kelola)     | —    | ✓       | baca    | ✓     | ✓       |
| Promosi (kelola)                   | —    | ✓       | —       | ✓     | ✓       |
| Akun staf (buat, ubah)             | —    | ✓       | baca    | ✓     | ✓       |
| Kelola peran                       | —    | —       | —       | ✓     | ✓       |
| Hapus staf                         | —    | —       | —       | —     | ✓       |
| Pengaturan                         | —    | ✓       | baca    | ✓     | ✓       |
| Laporan & analitik                 | —    | ✓       | lihat   | ✓     | ✓       |
| Log audit                          | —    | ✓       | lihat   | ✓     | ✓       |
| Tampilan Dapur (lihat, perbarui)   | ✓    | ✓       | lihat   | ✓     | ✓       |
| Terminal (daftarkan, ubah, hapus)  | —    | ✓       | —       | ✓     | ✓       |
| Akses ruang kerja                  | sesuai penugasan | ✓ | ✓ | ✓ | ✓ |

Legenda: **✓** akses penuh · **baca** hanya lihat · **sesuai penugasan**
hanya ruang kerja yang ditugaskan ke akun · **—** tidak ada akses.

## Model yang direncanakan

Matriks ini adalah target untuk basis kode:

- **Staf adalah peran operasional kasir.** Ia mempertahankan tindakan di
  register — memproses penjualan, pembayaran, diskon di keranjang,
  melampirkan pelanggan dan loyalitas, membuka dan menutup shift — plus
  ruang kerja yang ditugaskan. Setiap permukaan manajemen (produk,
  inventaris, pelanggan, promosi, staf, pengaturan, laporan, audit,
  terminal) membutuhkan **manajer ke atas**, dan void, refund, serta
  tindakan sensitif harga juga manajer ke atas.
- **Pemilik** disemai dengan wildcard global. **Admin** bersifat global
  kecuali transfer kepemilikan, penagihan, dan tindakan tak dapat
  dibatalkan seperti penghapusan staf. **Auditor** bersifat global dan
  hanya-baca: melihat data operasional dan log audit, tidak pernah
  mengelola, tidak pernah mengekspor, dan tidak pernah melihat kolom profil
  sensitif.
- **Kustom** adalah preset keenam — tanpa izin sendiri; admin memilih setiap
  izin secara manual. Sengaja tidak muncul di dropdown staf, dan tidak perlu: peran kustom
  dibuat dan dikelola di layar **Peran** tersendiri, yang dibuka lewat tombol
  **Peran** di halaman Staf.

## Status implementasi

Empat celah dalam rencana telah ditutup:

- **Preset `Staff` kini hanya kasir** (`platform/core/src/rbac.rs`):
  mempertahankan pemrosesan penjualan, pembayaran, diskon di keranjang,
  lampiran pelanggan dan loyalitas, buka/tutup shift, operasi layanan meja,
  KDS, dan perpindahan ruang kerja — dan tidak yang lain. `sales:void`,
  `sales:refund`, `payments:refund`, `products:*`, `staff:*`, `reports:*`,
  `audit:*`, `terminals:*`, `inventory:*`, dan `promotions:*` dihapus,
  dengan tes terkunci yang diperbarui ke model baru.
- **Semua layar manajemen dibatasi eksplisit.** Pelanggan, Riwayat
  Penjualan, dan kedua layar Dasbor kini menyatakan `requiredRole:
  'manager'`, dan pintu `'manager'` tidak lagi menerima Staf di mana pun.
- **Auditor mencapai layar hanya-bacanya.** Routing menghormati
  `requiredPermission` (mencerminkan `has_permission` backend): `audit:view`
  di log audit, `reports:view` / `inventory:view` di layar laporan,
  `products:read`, `customers:view`, `staff:read`, `settings:read`,
  `shifts:view_any`, dan `loyalty:view` di layar manajemen yang sesuai.
- **Analitik selaras.** Layar Analitik kini menyatakan `requiredRole:
  'manager'` dengan `analytics:view` sebagai kunci izin yang otoritatif.
- **Tombol aksi di dalam layar peka-izin.** Pintu tingkat manajemen
  (`isManager`) tidak lagi menerima Staf, sehingga tombol Void, Refund,
  override harga, tandai-diteliti/ekspor audit, dan kartu pengaturan penuh
  disembunyikan untuk Staf alih-alih menampilkan penolakan backend.
  Dev-mock (`ui/src/dev-mock/tauri-api.ts`) menjalankan model lima peran
  yang nyata — Kasir/Dapur yang pensiun sudah hilang di mana pun, termasuk
  lencana peran, ikon, dan pemilih ruang kerja.

> last audited 19-09-26 by docs-auditor
