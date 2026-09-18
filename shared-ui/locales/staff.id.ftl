staff-login-title = Masuk Staf
staff-username = Nama Pengguna
staff-pin = PIN
staff-enter-pin = Masukkan PIN
staff-login-button = Masuk
staff-logout-button = Keluar
staff-role-owner = Pemilik
staff-role-manager = Manajer
staff-role-cashier = Kasir
staff-permission-denied = Anda tidak memiliki izin untuk mengakses halaman ini

staff-management-title = Manajemen Staf
staff-add = Tambah Staf
staff-edit = Ubah Staf
staff-name = Nama
staff-role = Peran
staff-active = Aktif
staff-inactive = Tidak Aktif
staff-deactivate = Nonaktifkan
staff-activate = Aktifkan

staff-login-submit = Masuk
staff-login-submitting = Memasuki sistem…

# Restaurant Menu
staff-login-error-connection = Tidak dapat memverifikasi nama pengguna. Periksa koneksi Anda.
staff-login-pin-min-length = PIN harus minimal 4 digit.
staff-login-back = ← Kembali
staff-login-copyright = © 2026 kasir.mu. Seluruh hak cipta dilindungi.
staff-login-attempts-remaining = ({ $count } percobaan tersisa)
staff-login-lockout = Terkunci. Coba lagi dalam { $seconds }d

# ── Product Bundles ──
staff-back-aria = Kembali ke ruang kerja
staff-tabs-aria = Staf dan peran
staff-footer-staff-count = { $count } anggota staf
staff-footer-active = { $count } aktif
staff-footer-roles = { $count } peran
staff-footer-updated = Diperbarui { $time }
staff-add-button = Tambah Staf
staff-empty = Belum ada anggota staf.
staff-empty-cta = Tambah anggota staf pertama
staff-col-name = Nama
staff-col-username = Nama Pengguna
staff-col-role = Peran
staff-col-status = Status
staff-col-workspace = Ruang Kerja
staff-col-actions =
    .aria-label = Tindakan
staff-status-active = Aktif
staff-status-inactive = Tidak Aktif
staff-edit-aria =
    .aria-label = Ubah { $name }
staff-deactivate-aria =
    .aria-label = Nonaktifkan { $name }
staff-restore = Aktifkan Kembali
staff-restore-aria =
    .aria-label = Aktifkan kembali { $name }
staff-modal-add-aria =
    .aria-label = Tambah anggota staf
staff-modal-edit-aria =
    .aria-label = Ubah anggota staf
staff-modal-add-title = Tambah Anggota Staf
staff-modal-edit-title = Ubah Anggota Staf
staff-modal-close =
    .aria-label = Tutup
staff-field-username-label = Nama Pengguna *
staff-username-placeholder =
    .placeholder = mis. jane
staff-field-name-label = Nama Tampilan *
staff-name-placeholder =
    .placeholder = mis. Jane Smith
staff-field-pin-edit-label = PIN Baru (biarkan kosong untuk tetap menggunakan saat ini)
staff-field-pin-label = PIN * (4+ karakter)
staff-pin-edit-placeholder =
    .placeholder = Biarkan kosong untuk tetap menggunakan saat ini
staff-pin-placeholder =
    .placeholder = Masukkan PIN
staff-field-role-label = Peran *
staff-role-permissions-label = Izin peran
staff-role-select-default = Pilih peran…
staff-btn-cancel = Batal
staff-btn-update = Perbarui
staff-btn-create = Buat
staff-error-username-required = Nama pengguna wajib diisi
staff-error-display-name-required = Nama tampilan wajib diisi
staff-error-role-required = Silakan pilih peran
staff-error-pin-length = PIN minimal 4 karakter
staff-error-save-failed = Gagal menyimpan anggota staf
# C1.1: batas jumlah staf per paket berlangganan tercapai (Free 1 / Plus 5 / Pro 20).
staff-error-quota-limit = Paket Anda hanya mengizinkan sejumlah staf tertentu. Tingkatkan paket untuk menambah anggota tim.
staff-upgrade-cta = Tingkatkan paket
staff-error-workspaces-failed = Gagal memuat pengaturan ruang kerja
staff-table-aria = Anggota staf
staff-field-username-aria = Nama Pengguna
staff-field-name-aria = Nama Tampilan
staff-field-pin-aria = PIN
staff-error-load = Gagal memuat data staf
staff-retry = Coba lagi

# ── Workspace Data Unavailable (STAFF-08) ────────────────────────────────
staff-workspaces-unavailable = Data ruang kerja tidak tersedia
staff-workspaces-unavailable-hint = Gagal memuat penugasan ruang kerja. Data staf di bawah masih terbaru.

# ── Deactivate Confirmation (STAFF-10) ───────────────────────────────────
staff-deactivate-confirm-title = Nonaktifkan anggota staf?
staff-deactivate-confirm-body = Ini akan segera mencabut akses { $name } ke semua toko. Akun dapat diaktifkan kembali nanti. Lanjutkan?
staff-deactivate-confirm-confirm = Nonaktifkan
staff-deactivate-confirm-cancel = Batal

# ── Toast Notifications ───────────────────────────────────────────────────
staff-toast-created = { $name } berhasil dibuat
staff-toast-updated = { $name } berhasil diperbarui
staff-toast-deactivated = { $name } dinonaktifkan
staff-toast-restored = { $name } diaktifkan kembali

# ── Staff Login (remaining) ──
staff-login-step-username = Masukkan nama pengguna Anda
staff-login-progress-aria = Kemajuan login
staff-login-username-placeholder =
    .placeholder = Nama Pengguna
staff-login-username-aria =
    .aria-label = Nama Pengguna
staff-login-next = Lanjut
staff-login-pin-section-aria = Entri PIN — ketik digit di keyboard atau gunakan papan tombol di layar
staff-login-pin-aria = Entri PIN: { $length } dari { $max } digit
staff-login-keypad-aria = Papan tombol numerik
staff-login-clear = Hapus
staff-login-clear-aria =
    .aria-label = Hapus
staff-login-backspace-aria =
    .aria-label = Hapus
staff-login-digit-aria =
    .aria-label = { $digit }

# ── Assignment Access (ADR #35 D5 / spec 0048) ──
staff-assignment-section-label = Akses Penugasan
staff-assignment-global = Semua cabang & ruang kerja
staff-assignment-scoped = Batasi berdasarkan cabang atau ruang kerja
staff-assignment-branches-label = Cabang
staff-assignment-workspaces-label = Ruang Kerja
staff-assignment-all-branches = Semua cabang
staff-assignment-all-workspaces = Semua ruang kerja
staff-assignment-all-workspaces-short = Semua

# ── Assignment Resource Scope (ADR #47 ruling 1A) ──
staff-assignment-resource-label = Cakupan sumber daya
staff-assignment-resource-organization = Seluruh organisasi (semua lokasi)
staff-assignment-resource-legal-entity = Badan hukum
staff-assignment-resource-location = Lokasi
staff-assignment-resource-location-select = Pilih lokasi
staff-assignment-resource-entity-select = Pilih badan hukum
staff-assignment-resource-empty-hint = Tidak ada sumber daya yang tersedia.
staff-assignment-resource-required-hint = Pilih sumber daya untuk membatasi penugasan ini.

# ── Fast User Switching (ADR #6) ──────────────────────────────────────────

staff-login-close-aria = Tutup
staff-login-last-login-title = Waktu login terakhir pada perangkat ini
staff-login-last-login = Login terakhir: { $time }
staff-login-next-aria = Lanjut

fastpin-switch-user = Ganti Pengguna
fastpin-active-user = Aktif: { $name }
fastpin-enter-pin = Masukkan PIN untuk { $user }

# ── Session Lock Screen (i18n parity fix) ────────────────────────────────
session-lock-expired = Sesi telah berakhir. Silakan login kembali.
session-lock-invalid-pin = PIN tidak valid
session-lock-pin-aria = PIN: { $length } dari { $max } digit dimasukkan
session-lock-pad-aria = Papan PIN
session-lock-lockout = Tunggu { $seconds } dtk.

# ── Connection Status (shared between StaffLoginScreen + SessionLockScreen) ──
staff-login-connection-checking = Memeriksa…
staff-login-connection-connected = Terhubung
staff-login-connection-disconnected = Terputus
staff-login-connection-auth = Auth
staff-login-connection-sync = Sinkron

# ── Product Management ──

# ── ADR #35 D6 profil pengguna (spec 0049) ─────────────────────────────

staff-col-id = ID
staff-id-masked-aria = Nomor identitas (disamarkan)
staff-profile-incomplete = Profil belum lengkap
staff-profile-incomplete-edit-hint = Lengkapi profil anggota ini untuk membuka penetapan peran dan workspace.
staff-profile-section-label = Profil
staff-field-dob-label = Tanggal Lahir *
staff-field-dob-aria = Tanggal lahir (wajib)
staff-field-phone-label = Telepon *
staff-field-phone-aria = Nomor telepon (wajib)
staff-field-national-id-type-label = Jenis Nomor Identitas *
staff-field-national-id-type-aria = Jenis nomor identitas (wajib)
staff-national-id-type-select = Pilih jenis
staff-national-id-type-ssn = SSN (AS)
staff-national-id-type-nik = NIK / KTP (Indonesia)
staff-field-national-id-label = Nomor Identitas *
staff-field-national-id-aria = Nomor identitas (wajib)
staff-field-email-label = Email *
staff-field-email-aria = Alamat email (wajib)
staff-field-pay-label = Gaji Bersih Bulanan *
staff-field-pay-aria = Gaji bersih bulanan (wajib)
staff-field-emergency-name-label = Kontak Darurat *
staff-field-emergency-name-aria = Nama kontak darurat (wajib)
staff-field-emergency-phone-label = Telepon Kontak Darurat *
staff-field-emergency-phone-aria = Telepon kontak darurat (wajib)
staff-field-job-title-label = Jabatan
staff-field-job-title-aria = Jabatan
staff-field-notes-label = Catatan
staff-field-notes-aria = Catatan
staff-field-address-label = Alamat
staff-field-address-aria = Alamat
staff-field-tax-id-label = NPWP
staff-field-tax-id-aria = NPWP
staff-field-hire-date-label = Tanggal Bergabung
staff-field-hire-date-aria = Tanggal bergabung

# Error validasi per bidang (dilokalkan, tampil di bawah bidang)
staff-error-dob-required = Tanggal lahir wajib diisi.
staff-error-phone-required = Nomor telepon wajib diisi.
staff-error-national-id-type-required = Jenis nomor identitas wajib diisi.
staff-error-national-id-required = Nomor identitas wajib diisi.
staff-error-email-required = Alamat email wajib diisi.
staff-error-pay-required = Gaji bersih bulanan wajib diisi.
staff-error-emergency-name-required = Nama kontak darurat wajib diisi.
staff-error-emergency-phone-required = Telepon kontak darurat wajib diisi.
staff-error-email-invalid = Masukkan alamat email yang valid.
staff-error-phone-invalid = Telepon harus dalam format +kode negara nomor.
staff-error-national-id-invalid = Nomor identitas harus 9 digit (SSN) atau 16 digit (NIK).
staff-error-pay-invalid = Masukkan jumlah positif.
staff-error-dob-invalid = Gunakan format YYYY-MM-DD.

# C2.2: Pro→Premium approaching-limit banner (16+ staf, batas 20).
staff-limit-approaching-premium = Anda hampir mencapai batas 20 staf paket Pro. Tingkatkan ke Premium untuk hingga 50 staf.
staff-limit-approaching-premium-cta = Tingkatkan ke Premium

# ── Pembuatan peran (ADR #47 putusan 4) ──────────────────────────────
# Peran kustom adalah baris kumpulan izin bernama. Daftarnya diisi dari
# registri izin, jadi tidak ada nama kunci yang ditulis tetap di UI.
role-authoring-subtitle = Peran bawaan adalah default; peran kustom adalah kumpulan izin yang Anda susun sendiri.
role-create = Tambah Peran Baru
role-list-aria = Semua peran
role-empty-title = Belum ada peran
role-badge-builtin = Bawaan
role-badge-custom = Kustom
role-grant-count = { $count ->
    [one] 1 izin
   *[other] { $count } izin
  }
role-edit = Ubah
role-edit-aria = Ubah peran { $name }
role-delete = Hapus
role-delete-aria = Hapus peran { $name }
# Tiga label untuk dua hal yang berbeda, karena angka yang boleh menghalangi
# Penghapusan bukan angka yang menghitung orang. Penjelasan lengkap ada di
# staff.ftl: jumlah akun harus datang dari holder_count (predikat resolusi,
# bukan penjumlahan baris), sedangkan grant_count adalah konfigurasi workspace
# yang menghalangi penghapusan tanpa ada akun yang memegangnya.
role-in-use-accounts = { $count ->
    [one] Dipakai 1 akun
   *[other] Dipakai { $count } akun
  }
role-in-use-grants = { $count ->
    [one] dan 1 grant workspace
   *[other] dan { $count } grant workspace
  }
role-in-use-grants-only = { $count ->
    [one] Memuat 1 grant workspace
   *[other] Memuat { $count } grant workspace
  }
role-editor-edit-title = Ubah peran
role-field-name = Nama peran
role-field-description = Deskripsi peran
role-field-permissions = Izin
role-perm-sensitive = Sensitif
role-cancel = Batal
role-save = Simpan peran
role-saved = Peran { $name } tersimpan.
role-deleted = Peran { $name } dihapus.
role-delete-confirm-title = Hapus peran ini?
role-delete-confirm-body = Akun yang memegang { $name } akan kehilangan izinnya. Tindakan ini tidak bisa dibatalkan.

# Pemegang peran, per akun. Baris yang tertutup sudah menyebut total yang
# sama lewat role-in-use-accounts, dan keduanya membaca holder_count yang
# dihitung core dari SATU klausul WHERE yang sama — jadi angka di baris dan
# daftar di bawahnya tidak bisa berbeda. reference_count tetap menghalangi
# Penghapusan: ia menghitung baris foreign key, dan itu memang yang
# menghalangi penghapusan.
role-holders-toggle = Pemegang
role-holders-aria = Tampilkan akun yang memegang peran { $name }
role-holders-list-aria = Akun yang memegang peran { $name }
role-holders-count = { $count ->
    [one] 1 akun
   *[other] { $count } akun
  }
role-holders-loading = Memuat daftar pemegang…
role-holders-error = Gagal memuat daftar pemegang.
role-holders-none = Tidak ada akun yang memegang peran ini.
role-holders-more = { $count ->
    [one] dan 1 lainnya
   *[other] dan { $count } lainnya
  }
role-holders-inactive = nonaktif
role-holders-scope-legacy = Tanpa catatan penugasan
role-holders-scope-organization = Seluruh organisasi
role-holders-scope-legal-entity = Entitas hukum { $id }
role-holders-scope-location = Lokasi { $id }
role-holders-dims-all = semua cabang dan workspace
role-holders-dims-branches = { $count ->
    [one] 1 cabang
   *[other] { $count } cabang
  }
role-holders-dims-workspaces = { $count ->
    [one] 1 workspace
   *[other] { $count } workspace
  }
role-holders-dims-both-lists = { $branches } cabang, { $workspaces } workspace

# ── Impersonation (operator:impersonate) ───────────────────────────
staff-impersonate-action = Impersonasi
staff-impersonate-aria =
    .aria-label = Impersonasi { $name }
staff-impersonating-banner = Meniru { $name }
staff-impersonating-stop = Berhenti
staff-impersonating-stop-aria = Hentikan impersonasi
staff-impersonate-started = Sekarang meniru { $name }
staff-impersonate-failed = Tidak dapat memulai impersonasi

# ── Multi-Organization switching (SaaS-3 L194) ────────────────────
org-switcher-default = Organisasi
org-switcher-trigger = Ganti organisasi
org-switcher-list = Pilih organisasi
org-switcher-pin-title = Ganti organisasi
org-switcher-pin = PIN Organisasi
org-switcher-invalid-pin = PIN salah atau tidak ditugaskan ke organisasi ini
org-switcher-cancel = Batal
org-switcher-confirm = Ganti
org-selector-default = Organisasi default
org-selector-label = Organisasi
