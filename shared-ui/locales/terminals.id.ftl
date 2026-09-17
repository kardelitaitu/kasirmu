terminal-management-title = Manajemen Terminal
terminal-management-empty = Belum ada terminal terdaftar. Daftarkan terminal pertama untuk memulai.
terminal-management-error = Gagal memuat terminal. Silakan coba lagi.
terminal-management-retry = Coba Lagi
terminal-register = Daftarkan Terminal
terminal-register-title = Daftarkan Terminal Baru
terminal-edit-title = Ubah Terminal
terminal-delete-title = Hapus Terminal
terminal-delete-confirm = Apakah Anda yakin ingin menghapus terminal "{ $name }"? Tindakan ini tidak dapat dibatalkan.
terminal-name = Nama
terminal-name-label = Nama terminal
terminal-name-placeholder =
    .placeholder = mis. Kasir Depan
terminal-device-id = ID Perangkat
terminal-device-id-label = ID perangkat
terminal-device-id-placeholder =
    .placeholder = mis. nama host atau alamat MAC
terminal-secret-label = Rahasia bersama opsional untuk otentikasi sinkronisasi
terminal-metadata-label = Metadata JSON opsional
# Save-handler validation (see terminals.ftl).
terminal-error-name-required = Nama terminal wajib diisi
terminal-error-device-id-required = ID perangkat wajib diisi
terminal-is-active = Aktif
terminal-is-inactive = Tidak Aktif
terminal-status = Status
terminal-last-seen = Terakhir Terlihat
terminal-created = Dibuat
terminal-never = Tidak Pernah
terminal-cancel = Batal
terminal-save = Simpan
terminal-delete = Hapus
terminal-register-action = Daftarkan
terminal-edit-action =
    .aria-label = Ubah { $name }
terminal-delete-action =
    .aria-label = Hapus { $name }
terminal-error-load = Gagal memuat terminal
terminal-error-overrides-load = Gagal memuat penimpaan fitur
terminal-error-override-update = Gagal memperbarui penimpaan fitur
terminal-error-override-reset = Gagal mengatur ulang penimpaan
terminal-error-save = Gagal menyimpan terminal
terminal-field-name-aria = Nama terminal
terminal-field-device-id-aria = ID perangkat
terminal-field-secret-aria = Rahasia bersama
terminal-field-metadata-aria = Metadata JSON
terminal-feature-overrides = Penimpaan Fitur
terminal-overridden = ditimpa
terminal-override-aria = Timpa { $feature }
terminal-reset-overrides = Setel ulang semua penimpaan
terminal-col-actions =
    .aria-label = Tindakan
terminal-table-label = Terminal

# Terminal Status Panel
terminal-status-title = Status Terminal
terminal-status-online-count = { $online } / { $total } daring
terminal-status-empty = Belum ada terminal terdaftar.
terminal-status-list-aria = Status terminal
terminal-status-online = Daring
terminal-status-offline = Luring
terminal-status-never = Tidak Pernah
terminal-status-just-now = Baru saja
terminal-status-minutes-ago = { $n }m lalu
terminal-status-hours-ago = { $n }j lalu
terminal-status-error-load = Gagal memuat terminal

# Device binding (ADR #4 Phase 3)
terminal-binding-title = Pengikatan Perangkat
terminal-binding-bound-store = Terikat ke toko:
terminal-binding-signature = Tanda tangan
terminal-binding-valid = Valid
terminal-binding-invalid = Tidak Valid / Dirusak
terminal-binding-store-label = Toko
terminal-binding-instance-label = Instance Ruang Kerja
# Conjunction following middot in binding info paragraph (lowercase).
terminal-binding-instance-conjunction = instance:
terminal-binding-select-store = -- Pilih toko --
terminal-binding-select-instance = -- Pilih instance --
terminal-binding-primary = (Utama)
terminal-binding-update = Perbarui Pengikatan
terminal-binding-bind = Ikat Terminal
terminal-binding-clear = Hapus Pengikatan
# Failure copy for the three binding mutations (see terminals.ftl).
terminal-error-binding-load = Gagal memuat pengikatan terminal.
terminal-error-binding-save = Gagal menyimpan pengikatan terminal.
terminal-error-binding-clear = Gagal menghapus pengikatan terminal.

# Feature override counts
terminal-overrides-count = { $count ->
    [one] { $count } penimpaan
   *[other] { $count } penimpaan
}

# C2.2: banner batas terminal (pemicu Plus→Pro).
terminal-limit-reached = Anda telah mencapai batas { $limit } register untuk paket Anda. Tingkatkan ke Pro hingga 5 register per toko.
terminal-limit-upgrade-cta = Tingkatkan ke Pro

# ── Promotions ──
