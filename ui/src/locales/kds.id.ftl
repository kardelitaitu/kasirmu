kds-title = Tampilan Dapur
kds-screen-title = Tampilan Dapur
kds-screen-aria = Sistem Tampilan Dapur
kds-pending = Tertunda
kds-preparing = Disiapkan
kds-ready = Siap
kds-served = Tersaji
kds-order-number = Pesanan #
kds-items = { $count } item
kds-notes = Catatan
kds-tap-to-advance = Ketuk untuk lanjut
kds-no-orders = Belum ada pesanan
kds-no-orders-filtered = Tidak ada pesanan pada status ini

# ── New i18n migration IDs ──

# Staff Login
kds-cancelled = Dibatalkan
kds-item-status-pending = Tertunda
kds-item-status-preparing = Disiapkan
kds-item-status-ready = Siap
kds-item-status-served = Tersaji
kds-item-status-cancelled = Dibatalkan
kds-tap-to-advance-label = Pesanan { $number }, ketuk untuk lanjut
kds-order-count = { $count } pesanan
kds-column-count = { $count } pesanan
kds-time-ago-now = sekarang
kds-time-ago = { $minutes }m
kds-urgent-badge = URGENT
kds-pull-to-refresh = Tarik ke bawah untuk memperbarui
kds-release-to-refresh = Lepaskan untuk memperbarui

# Layout switcher
kds-layout-label = Tampilan
kds-layout-display-label = Opsi
kds-layout-options-aria = Opsi tampilan
kds-layout-popover-aria = Opsi tampilan dan tata letak KDS
kds-layout-order-id = ID Pesanan
kds-layout-table-number = Nomor Meja
kds-layout-kanban = Kanban
kds-layout-focus = Fokus
kds-layout-metro = Metro

# Settings panel
kds-settings-aria = Pengaturan KDS
kds-settings-sound = Suara
kds-settings-yellow = Kuning
kds-settings-yellow-aria = Ambang eskalasi kuning dalam menit
kds-settings-red = Merah
kds-settings-red-aria = Ambang eskalasi merah dalam menit
kds-slider-value-min = { $min } menit
kds-settings-auto-ack = Konfirmasi otomatis
kds-settings-density = Kolom
kds-settings-density-comfortable = 1
kds-settings-density-compact = 2

# ── 3a: Zone switching ──
kds-zone-filter-aria = Filter berdasarkan zona dapur
kds-zone-all = Semua

# ── 2c: Priority/rush flag ──
kds-rush-badge = PRIORITAS

# ── 2b: History/recall view ──
kds-loading = Memuat pesanan…
kds-history-toggle-aria = Tampilkan riwayat pesanan
kds-history-toggle-title = Riwayat pesanan
kds-history-filter-aria = Filter berdasarkan status
kds-history-loading = Memuat riwayat...
kds-history-error = Gagal memuat riwayat pesanan
kds-history-empty = Belum ada pesanan selesai
kds-history-received = Diterima
kds-history-served = Selesai

# ── 3f: Ticket editing ──
kds-edit-items-btn = Edit Item
kds-edit-items-btn-aria = Edit item tiket
kds-edit-items-aria = Edit item
kds-edit-count-label = Jumlah
kds-edit-count-aria = Jumlah item
kds-edit-save = Simpan
kds-edit-save-aria = Simpan item
kds-edit-cancel = Batal
kds-edit-cancel-aria = Batal edit

# ── 3b: Offline resilience ──
kds-offline-label = Luring — menampilkan pesanan tersimpan
kds-offline-queued = { $count } pembaruan antri — luring
kds-offline-queued-update = Pembaruan antri — akan sinkron saat online
# OFF-05: aksi yang kehabisan percobaan dan butuh perhatian operator
kds-offline-dead-letter = { $count } pembaruan tidak dapat disinkronkan setelah beberapa percobaan. Ketuk Coba Lagi untuk mengantre ulang atau hapus untuk menutup.
kds-offline-dead-letter-aria = Pembaruan gagal menunggu perhatian operator
kds-offline-dead-letter-clear-aria = Hapus pembaruan gagal
# OFF-08: penyimpanan lokal tidak tersedia — aksi antre tidak permanen
kds-offline-storage-unavailable = Penyimpanan luring lokal tidak tersedia. Pembaruan yang antre akan hilang saat memuat ulang.
kds-offline-retry = Coba Lagi
kds-offline-retry-aria = Coba lagi pembaruan tertunda
kds-offline-dismiss-aria = Tutup banner luring

# ── 3d: Voice callout ──
kds-order-up-tts = Pesanan
kds-ready-tts = siap

# ── 2a: Course names (Phase 2) ──
kds-course-appetizer = PEMBUKA
kds-course-main = UTAMA
kds-course-side = PELENGKAP
kds-course-dessert = PENCUCI MULUT
kds-course-beverage = MINUMAN
kds-course-none = Tanpa
kds-course-other = LAINNYA
kds-course-loading = Memuat item...
kds-course-modifier-separator =: 

# ── 3f: Add items button + product picker (TODO 3f) ──
kds-add-items-btn = Tambah Item
kds-add-items-btn-aria = Tambah item ke pesanan
kds-picker-title = Tambah Item ke Pesanan
kds-picker-close-aria = Tutup pemilih
kds-picker-search-placeholder = Cari produk...
kds-picker-search-aria = Cari produk
kds-picker-loading = Memuat produk...
kds-picker-error = Gagal memuat produk
kds-picker-no-products = Produk tidak ditemukan
kds-picker-clear-search = Hapus pencarian
kds-picker-selected = Dipilih
kds-picker-picked-empty = Klik produk untuk menambahkannya
kds-picker-course-aria = Kursus
kds-picker-qty-decrease = Kurangi jumlah
kds-picker-qty-increase = Tambah jumlah
kds-picker-remove-aria = Hapus { $name }
kds-picker-cancel = Batal
kds-picker-add-btn = Tambah { $count } item
kds-picker-added-label = ditambahkan

# ── UX audit: keyboard shortcuts + error retry ──
kds-shortcuts-aria = Pintasan keyboard
kds-shortcuts-label = Pintasan keyboard
kds-shortcut-select = Pilih tiket berdasarkan posisi
kds-shortcut-advance = Lanjutkan tiket yang dipilih
kds-shortcut-navigate = Navigasi tiket
kds-shortcut-deselect = Batalkan pilihan / tutup
kds-error-retry-aria = Coba Lagi
kds-error-dismiss-aria = Tutup
kds-error-update-failed = Gagal memperbarui pesanan — coba lagi
kds-enrollment-failed = Pendaftaran perangkat gagal — periksa koneksi dan coba lagi

# ── KDS Device Enrollment ──
kds-enrollment-title = Daftarkan Perangkat KDS
kds-enrollment-close-aria = Tutup pendaftaran
kds-enrollment-name-label = Nama Perangkat
kds-enrollment-name-placeholder = contoh: Tampilan Grill, Layar Expo
kds-enrollment-name-aria = Nama tampilan perangkat KDS
kds-enrollment-stations-label = Penugasan Stasiun (opsional)
kds-enrollment-stations-placeholder = Ketik nama stasiun dan tekan Enter
kds-enrollment-stations-aria = Tambahkan penugasan stasiun
kds-enrollment-stations-hint = Masukkan ID stasiun topologi yang harus ditampilkan perangkat ini. Kosongkan untuk mode broadcast (semua pesanan).
kds-enrollment-station-remove-aria = Hapus stasiun { $station }
kds-enrollment-generating = Membuat token pendaftaran…
kds-enrollment-success = Perangkat berhasil didaftarkan!
kds-enrollment-expiry-note = Token pendaftaran kedaluwarsa dalam 5 menit. Pindai kode QR dengan perangkat KDS untuk menyelesaikan pengaturan.
kds-enrollment-cancel = Batal
kds-enrollment-create-btn = Buat Perangkat
kds-enrollment-done = Selesai
kds-enrollment-error = Gagal mendaftarkan perangkat
kds-enrollment-scan-instruction = Pindai kode QR ini dengan perangkat KDS untuk menyelesaikan pemasangan.
kds-enrollment-qr-aria = Kode QR untuk mendaftarkan { $name }
kds-enrollment-countdown = Token kedaluwarsa dalam { $seconds }d
kds-enrollment-expired = Token telah kedaluwarsa — tutup dan daftar ulang untuk membuat yang baru

# ── KDS Device Status ──
kds-device-status-connected = Terhubung
kds-device-status-disconnected = Terputus
kds-device-status-stale = Usang
kds-device-status-aria = Perangkat KDS: { $connected } dari { $total } terhubung
kds-device-list-aria = Daftar perangkat KDS
kds-device-enroll = Daftarkan perangkat
kds-device-enroll-aria = Buka dialog pendaftaran perangkat KDS

# ── Hamburger settings panel ──
kds-settings-theme = Tema
kds-settings-theme-toggle-aria = Alihkan tema terang atau gelap
kds-layout-order-id-caption = Tampilkan nomor pesanan di kartu
kds-layout-table-number-caption = Tampilkan nomor meja di kartu
kds-settings-sound-caption = Dering saat pesanan masuk
kds-settings-auto-ack-caption = Pesanan baru muncul tanpa mengetuk Terima

# ── Topbar tabs + back ──
kds-back-aria = Kembali ke ruang kerja
kds-tablist-aria = Lihat pesanan
kds-tab-open = Terbuka
kds-tab-completed = Selesai

# ── Ticket card footer actions ──
kds-advance-start = Mulai
kds-advance-ready = Tandai Siap
kds-advance-serve = Sajikan
kds-toggle-card-aria = Buka/tutup detail pesanan { $number }
kds-toggle-card-aria-collapsed =
    { kds-toggle-card-aria } (tertutup)
kds-new-orders-announced = { $count } pesanan baru

# ── Topbar filter dropdown ──
kds-filter-aria = Filter pesanan
kds-filter-all = Semua Kategori
kds-filter-prepared = Siap
kds-filter-selected = { $count } dipilih
kds-filter-completed-all = Semua
kds-filter-dinein = Makan di tempat
kds-filter-takeaway = Bawa pulang

# ── Screen footer status bar ──
kds-footer-aria = Status terminal
kds-footer-last-sync = Sinkron terakhir: { $time }
kds-footer-never = tidak pernah
kds-footer-seconds = { $count }d yang lalu
kds-footer-minutes = { $count }m yang lalu
kds-footer-hours = { $count }j yang lalu

# ── Completed tab (bucket columns) ──
kds-completed-aria = Pesanan selesai
kds-completed-load-failed = Gagal memuat pesanan selesai
kds-completed-retry-aria = Coba muat ulang pesanan selesai
kds-completed-today = Hari Ini
kds-completed-yesterday = Kemarin
kds-completed-this-week = Minggu Ini
kds-completed-older = Lebih Lama
kds-completed-today-empty = Tidak ada pesanan
kds-completed-yesterday-empty = Tidak ada pesanan
kds-completed-this-week-empty = Tidak ada pesanan
kds-completed-older-empty = Tidak ada pesanan
kds-completed-status = Selesai
kds-completed-reopen = Buka Lagi
kds-completed-reopen-aria = Buka lagi pesanan { $number }

# ── Shift ──
kds-shift-start = Mulai Shift
kds-shift-end = Akhiri Shift
kds-shift-end-title = Akhiri Shift?
kds-shift-end-msg = Apakah Anda yakin ingin mengakhiri shift dapur saat ini?

# ── Confirm modal ──
kds-confirm-cancel = Batal
kds-confirm-ok = Konfirmasi

# ── Display settings ──
kds-settings-display-scale = Skala tampilan
kds-settings-columns = Kolom

# ── Colours ──
kds-settings-card-colours = Warna
kds-settings-color-dinein = Makan di tempat
kds-settings-color-takeaway = Bawa pulang
kds-settings-color-rush = Mendesak
kds-settings-color-pending = Menunggu
kds-settings-color-preparing = Memasak
kds-settings-color-ready = Siap
kds-settings-color-complete = Selesai
kds-settings-reset-colours = Atur ulang warna

# ── Card Animations ──
kds-settings-card-animations = Animasi kartu
kds-settings-card-animations-caption = Efek muncul dan susun ulang

# ── Hardware Acceleration ──
kds-settings-hw-accel = Akselerasi perangkat keras
kds-settings-hw-accel-caption = Efek blur dan GPU

# ── Hamburger panel (lihat kds.ftl) ──
kds-panel-section-settings = Pengaturan
kds-panel-section-behaviour = Perilaku
kds-theme-dark-aria = Tema gelap
kds-theme-light-aria = Tema terang
kds-zoom-out-aria = Perkecil
kds-zoom-in-aria = Perbesar
kds-zoom-reset-title = Setel ulang ke 100%
kds-zoom-reset-aria = Setel ulang zoom ke 100%
kds-cols-decrease-aria = Lebih sedikit kolom
kds-cols-increase-aria = Lebih banyak kolom
kds-cols-reset-title = Setel ulang ke otomatis
kds-cols-reset-aria = Setel ulang kolom ke otomatis
kds-cols-auto = Otomatis
kds-color-picker-aria = Pemilih warna { $name }

# ── Kiosk (remaining) ──

# ── Expo (Expediter) screen — todo-kds-agents-3 ──
nav-kds-expo = Ekspo
kds-expo-title = Ekspo
kds-expo-screen-aria = Layanan ekspedisi
kds-expo-board-aria = Pesanan per stasiun
kds-expo-no-station = Tanpa stasiun
kds-expo-ready-banner =
    { $count ->
        [one]  1 pesanan siap disajikan
       *[other] { $count } pesanan siap disajikan
    }
kds-expo-ready-ratio-aria = { $ready } dari { $total } pesanan naik di stasiun ini
kds-expo-recall = Tarik Ulang
kds-expo-recall-aria = Buka riwayat penarikan
kds-expo-recall-count-aria = Buka riwayat penarikan, { $count } pesanan dapat ditarik ulang
kds-expo-recall-title = Baru disajikan
kds-expo-recall-hint = Pesanan yang disajikan dalam { $minutes } menit terakhir dapat dikembalikan ke meja saji.
kds-expo-recall-empty = Belum ada pesanan yang baru disajikan
kds-expo-recall-restore = Kembalikan
kds-expo-recall-restore-aria = Kembalikan pesanan { $number } ke status siap
kds-expo-recall-close-aria = Tutup dialog penarikan
kds-expo-recall-failed = Gagal menarik kembali pesanan — coba lagi
kds-expo-load-failed = Gagal memuat pesanan ekspo

# ── Station selector modal (Expo) — todo-kds-agents-3 ──
kds-expo-station-all = Semua stasiun
kds-expo-station-button-aria = Pilih stasiun
kds-station-title = Pilih stasiun
kds-station-aria = Pilihan stasiun
kds-station-all-label = Semua stasiun
kds-station-all-aria = Tampilkan pesanan dari semua stasiun
kds-station-option-aria = Tampilkan hanya pesanan dari stasiun { $zone }
kds-station-close-aria = Tutup pemilih stasiun
kds-station-empty = Belum ada stasiun di papan
