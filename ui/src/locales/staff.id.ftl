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
staff-login-copyright = © 2026 OZ-POS. Seluruh hak cipta dilindungi.
staff-login-attempts-remaining = ({ $count } percobaan tersisa)
staff-login-lockout = Terkunci. Coba lagi dalam { $seconds }d

# ── Product Bundles ──
staff-title = Staf
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
