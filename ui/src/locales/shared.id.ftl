-app-name = OZ-POS

save = Simpan
cancel = Batal
delete = Hapus
edit = Ubah
close = Tutup
search = Cari
toggle = Alih
filter = Saring
confirm = Konfirmasi
back = Kembali
next = Lanjut
skip = Lewati
done = Selesai
loading = Memuat…
error-occurred = Terjadi kesalahan
retry = Coba lagi
dismiss = Tutup
no-results = Tidak ada hasil
print = Cetak
export = Ekspor
download = Unduh

nav-pos = Terminal POS
app-sidebar-subtitle = Point of Sale
nav-dashboard = Dasbor
nav-sales = Riwayat Penjualan
nav-products = Produk
nav-categories = Kategori
nav-staff = Staf
nav-roles = Peran
nav-customers = Pelanggan
nav-inventory = Stok
nav-general = Umum
nav-settings = Pengaturan
nav-reports = Laporan
nav-design = Sistem Desain
nav-orders = Pesanan

error-boundary-title = Terjadi kesalahan
error-boundary-retry = Coba Lagi

# Status Bar
status-bar-connected = Backend terhubung
status-bar-disconnected = Backend terputus
# Sync connection status
status-bar-sync-connected = Sinkronisasi cloud terhubung
status-bar-sync-disconnected = Sinkronisasi cloud terputus
status-bar-sync-checking = Memeriksa koneksi sinkronisasi cloud…
# License status (login screen)
staff-login-license-active = Lisensi aktif
staff-login-license-inactive = Lisensi tidak aktif
# P1-3: Tooltip for conflict count badge in StatusBar
statusbar-conflict-count = { $count } konflik sinkronisasi terselesaikan
# SYNC-12: StatusBar visible labels + ARIA (localized at the render boundary)
statusbar-app-status-aria = Status aplikasi
statusbar-version = v0.0.37
statusbar-sync-name = Sinkronisasi
statusbar-gateway-name = Stripe
statusbar-license = Lisensi Proprietary
# Unified status area (activation screen): auth / sync / version icons
statusbar-group-aria = Status koneksi dan versi
statusbar-version-label = Versi
statusbar-checking-msg = { $name } · Memeriksa…
statusbar-offline-msg = { $name } · Luring
statusbar-latency-msg = { $name } · { $ms }ms
# Server tetap menjawab dan menyebut subsistem yang rusak. Beda dari "Luring":
# layanan yang terganggu masih melayani, jadi pesan ini tidak boleh terbaca
# sebagai mati. $cause adalah label subsistem dari server (mis. "database").
statusbar-degraded-msg = { $name } · Terganggu — { $cause }
statusbar-version-latest-msg = Versi terbaru
statusbar-version-update-msg = Pembaruan tersedia

# POS Cart Line Items
shared-loading = Memuat…
ds-title = Sistem Desain

# Badge
badge-info = Info

# Toast
toast-success = Operasi berhasil
toast-error = Terjadi kesalahan
toast-warning = Silakan periksa input Anda
toast-info = Ini adalah pesan informasional
toast-dismiss-aria = Tutup notifikasi
toast-notifications-aria = Notifikasi
toast-show-detail = Tampilkan detail
toast-hide-detail = Sembunyikan detail
toast-copy = Salin
toast-copied = Disalin!
toast-copy-aria = Salin detail kesalahan
app-error-global-title = Kesalahan tidak terduga
modal-close-aria = Tutup dialog

# Empty state
empty-state-title = Belum ada apa pun di sini

# Error state
error-state-retry = Coba Lagi

# AppError user-safe copy (ERR-05/ERR-06 — output normalizer terketik)
app-error-generic = Terjadi kesalahan. Silakan coba lagi.
app-error-validation = Periksa kembali informasi yang Anda masukkan, lalu coba lagi.
app-error-permission = Anda tidak memiliki izin untuk melakukan ini.
app-error-session = Sesi Anda telah berakhir. Silakan masuk kembali.
app-error-conflict = Catatan ini diubah oleh orang lain. Segarkan dan coba lagi.
app-error-not-found = Item yang diminta tidak ditemukan.
app-error-offline = Anda tampaknya luring. Periksa koneksi Anda dan coba lagi.
app-error-hardware = Perangkat keras tidak merespons. Periksa perangkat dan coba lagi.
app-error-subscription = Tindakan ini tidak termasuk dalam paket Anda saat ini.
app-error-global = Terjadi hal yang tidak terduga. Jika ini terus berlanjut, mulai ulang aplikasi.

# Theme toggle
theme-toggle-label = Aktifkan/nonaktifkan tema
theme-toggle-aria =
    .aria-label = Beralih ke mode { $mode ->
        [dark] gelap
       *[light] terang
    }

# Language selector
language-selector-label = Bahasa
language-selector-select-aria = Pilih bahasa
locale-en = English
locale-id = Bahasa Indonesia

# Permission denied
permission-denied-title = Akses Ditolak
permission-denied-desc = { $action } memerlukan peran { $requiredRole }.
permission-denied-perm-desc = Anda tidak memiliki izin untuk mengakses { $action }.
permission-denied-perm-key = (izin yang diperlukan: { $permission })
permission-denied-current = Anda masuk sebagai { $displayName } ({ $roleName }).
permission-denied-go-back = Kembali

# Store switcher
store-switcher-select = Pilih Toko
store-switcher-current-aria = Toko saat ini: { $name }. Klik untuk mengganti.
store-switcher-list-aria = Toko
store-switcher-primary = · Utama

# Gateway status
gateway-status-online-aria = { $name } daring
gateway-status-offline-aria = { $name } luring

# Role badge
role-badge-logged-in-aria = Masuk sebagai { $displayName }, { $roleName }
role-badge-logout-aria = Keluar dari { $displayName }
role-badge-logout-title = Keluar

# Update banner
update-banner-title = Pembaruan tersedia
update-banner-new-version = Versi baru
update-banner-install = Pasang
update-banner-installing = Memasang…
update-banner-install-aria = Unduh dan pasang pembaruan
update-banner-installing-aria = Memasang pembaruan…
update-banner-dismiss-aria = Tutup notifikasi pembaruan
update-banner-dismiss = Tutup
update-banner-backing-up = Mencadangkan…
update-banner-backing-up-aria = Mencadangkan basis data sebelum pembaruan
update-banner-backup-error = Cadangan gagal
update-banner-version-blocked-title = Pembaruan tidak tersedia
update-banner-version-blocked-desc = Versi Anda { $current } di bawah minimum { $minimum } yang diperlukan. Silakan instal ulang dari situs web.
update-banner-rollback-title = Pembaruan mungkin gagal
update-banner-rollback-desc = Versi sebelumnya { $version } tersedia untuk diunduh. Klik untuk memulihkan.
update-banner-rollback = Pulihkan Versi Sebelumnya
update-banner-rollback-aria = Unduh versi sebelumnya dari GitHub

# Memo Banner
memo-banner-open-aria = Baca memo lengkap: { $title }
memo-banner-open-aria-plain = Baca memo lengkap
memo-banner-acknowledge-aria = Konfirmasi memo ini

# Memos (authoring)
memos-title = Memo
memos-refresh = Segarkan
memos-new-heading = Memo baru
memos-label-title = Judul
memos-placeholder-title = mis. tutup laci pukul 22.00
memos-label-body = Pesan
memos-placeholder-body = Tulis pesan yang akan dilihat staf…
memos-label-scope = Penerima
memos-scope-hint = Biarkan semua lokasi tidak dicentang untuk menjangkau semuanya (Organisasi).
memos-scope-org = Organisasi
memos-label-duration = Durasi
memos-duration-12h = 12 jam
memos-duration-24h = 24 jam
memos-duration-3d = 3 hari
memos-duration-7d = 7 hari
memos-duration-30d = 30 hari
memos-create = Buat draf
memos-publish = Terbitkan
memos-stop = Hentikan
memos-revise-heading = Revisi memo
memos-revise-note = Koreksi menerbitkan revisi baru; durasi dan penerima tidak berubah.
memos-revise = Terbitkan revisi
memos-revise-cancel = Batal
memos-revise-row = Revisi
memos-col-title = Judul
memos-col-scope = Penerima
memos-col-status = Status
memos-col-duration = Durasi
memos-col-revision = Revisi
memos-col-created = Dibuat
memos-col-actions = Tindakan
memos-status-draft = Draf
memos-status-published = Terbit
memos-status-expired = Kedaluwarsa
memos-status-stopped = Dihentikan
memos-status-archived = Arsip
memos-table-aria = Daftar memo
memos-empty = Belum ada memo. Buat memo pertama Anda dengan formulir di atas.
memos-error-load = Gagal memuat memo
memos-error-action = Tindakan memo gagal. Silakan coba lagi.
memos-retry = Coba lagi

# Accessibility
a11y-skip-to-content = Lewati ke konten utama
# Shared right-click menu (see shared.ftl).
ctx-menu-aria = Menu konteks
ctx-menu-copy = Salin
ctx-menu-paste = Tempel

# Navigation section labels
nav-section-operations = Operasional
nav-section-sales = Penjualan
nav-section-products = Produk
nav-section-finance = Keuangan
nav-section-customers = Pelanggan
nav-section-reports = Laporan
nav-section-inventory = Persediaan
nav-section-tools = Alat
nav-section-settings = Pengaturan
nav-section-dev = Pengembang

# Navigation (remaining)
nav-pos-terminal = Terminal POS
nav-kds = KDS
nav-stock-adjust = Penyesuaian Stok
nav-custom-report = Laporan Kustom
nav-sales-history = Riwayat Penjualan
nav-eod-report = Laporan Akhir Hari
nav-tax-rates = Tarif Pajak
nav-exchange-rates = Nilai Tukar
nav-loyalty = Loyalitas
nav-gift-cards = Kartu Hadiah
nav-terminals = Terminal
nav-locations = Lokasi
nav-features = Fitur
nav-data = Data
nav-audit-log = Log Audit
nav-memos = Memo
nav-offline-queue = Antrian Offline
nav-shifts = Shift
nav-bundles = Bundel
nav-dashboard-report = Dasbor
nav-analytics = Analitik Staf
nav-sales-report = Laporan Penjualan
nav-inventory-report = Laporan Stok
nav-menu-engineering = Rekayasa Menu
nav-design-system = Sistem Desain
nav-kiosk = Kiosk
nav-tables = Meja
nav-promotions = Promosi
nav-tooltip-preview = Pratinjau Tooltip
nav-suppliers = Pemasok
nav-purchase-orders = Pesanan Pembelian
nav-stock-transfers = Transfer Stok
nav-stock-counts = Stok Opname
nav-stock = Stok
nav-sidebar-collapse = Tutup sidebar
nav-sidebar-expand = Buka sidebar
nav-switch-workspace = Ganti Ruang Kerja
nav-main-aria = Navigasi utama
nav-tablist-aria = Tab navigasi

# Audit Log
audit-log-title = Log Audit
audit-log-load-more = Muat Lebih Banyak
audit-log-error-load = Gagal memuat log audit
audit-log-mark-reviewed = Tandai Ditinjau
audit-log-reviewed-at = Ditinjau: { $date }
audit-log-unreviewed-title =
    { $count ->
        [one] { $count } kejadian belum ditinjau sejak tinjauan terakhir
       *[other] { $count } kejadian belum ditinjau sejak tinjauan terakhir
    }
audit-log-user-system = sistem
audit-log-loading = Memuat…
audit-log-refresh = Segarkan
audit-log-retry = Coba Lagi
# ERR-09: Status yang dapat diakses saat muat ulang sedang berlangsung dengan baris terlihat
audit-log-refreshing = Menyegarkan…
audit-log-filter-all = Semua
audit-log-filter-success = Berhasil
audit-log-filter-failure = Gagal
audit-log-loading-text = Memuat log audit…
audit-log-empty-filtered = Tidak ada entri audit yang cocok dengan filter saat ini.
audit-log-empty-none = Belum ada entri audit. Entri muncul saat penjualan selesai, dibatalkan, atau tindakan staf terjadi.
audit-log-col-date = Tanggal
audit-log-col-action = Tindakan
audit-log-col-target = Target
audit-log-col-user = ID Pengguna
audit-log-col-outcome = Hasil
audit-log-col-details = Detail
audit-log-count-of = { $shown } dari { $total } entri
audit-log-export = Ekspor CSV
audit-log-export-error = Ekspor gagal. Silakan coba lagi.
audit-log-export-progress = Mengekspor log audit…
audit-log-table-label = Entri log audit
audit-log-search-placeholder = Cari tindakan, target, atau pengguna…
audit-log-search-label = Cari log audit
audit-log-filter-label = Saring berdasarkan hasil

# Audit action labels
audit-action-sale-void = Batalkan Penjualan
audit-action-sale-complete = Selesaikan Penjualan
audit-action-sale-refund = Pengembalian Dana
audit-action-login = Masuk Staf
audit-action-login-failed = Login Gagal
audit-action-user-create = Staf Dibuat
audit-action-user-update = Staf Diperbarui
audit-action-product-create = Produk Dibuat
audit-action-product-update = Produk Diperbarui
audit-action-product-delete = Produk Dihapus
audit-action-stock-adjust = Stok Disesuaikan
audit-action-setting-change = Pengaturan Diubah
audit-action-system-backup = Cadangan Dibuat
audit-action-system-export = Ekspor Data
audit-action-system-import = Impor Data
audit-action-system-restore = Pulihkan
audit-action-audit-review = Audit Ditinjau
audit-action-sale-create = Penjualan Dibuat
audit-action-bulk-import = Impor Massal
audit-action-inventory-sync = Stok Disinkronkan
audit-action-unknown = Tindakan Tidak Diketahui
audit-log-outcome-success = Berhasil
audit-log-outcome-failure = Gagal
audit-log-outcome-unknown = Tidak Diketahui

# ── Setup Wizard ──
spinner-label = Memuat…

# ── Workspace Home ──
workspace-home-fullscreen-aria = Aktifkan/nonaktifkan layar penuh
workspace-home-fullscreen-hint = F11
fullscreen-enabled = Mode layar penuh aktif
fullscreen-disabled = Mode layar penuh nonaktif
workspace-home-user-aria = Masuk sebagai { $name }
workspace-home-loading = Memuat ruang kerja…
workspace-home-sr-error = Kesalahan koneksi
workspace-home-available = { $count } ruang kerja tersedia
workspace-home-coming-soon = Segera hadir
workspace-card-active-aria = Ruang kerja aktif
workspace-home-empty = Tidak ada ruang kerja tersedia
workspace-home-empty-desc = Anda belum memiliki akses ke ruang kerja apa pun. Hubungi administrator.
workspace-home-staff-empty = Tidak ada ruang kerja tersedia
workspace-home-staff-empty-desc = Hubungi Administrator
workspace-home-logout = Keluar
workspace-home-logout-confirm-title = Keluar?
workspace-home-logout-confirm-desc = Anda akan kembali ke layar masuk. Semua pekerjaan yang belum disimpan akan hilang.
workspace-home-logout-confirm-cancel = Batal
workspace-home-logout-confirm-confirm = Keluar
workspace-home-shortcut-hint = Tekan { $key } untuk membuka
workspace-card-open-aria = Buka ruang kerja { $name }
workspace-card-no-access-aria = { $name } — tidak tersedia untuk peran Anda
workspace-card-no-access-badge = Tidak tersedia
workspace-home-error-title = Galat Koneksi
workspace-home-error-desc = Tidak dapat memuat ruang kerja. Periksa koneksi Anda dan coba lagi.
workspace-home-retry = Coba Lagi
workspace-home-retry-btn = Muat Ulang
workspace-card-pin-aria = Sematkan { $name } ke atas
workspace-card-unpin-aria = Lepas sematan { $name }



# Auth / License Activation
auth-activate-title = Aktifkan Lisensi
auth-activate-subtitle = Masukkan informasi Anda di bawah ini
auth-email-label = Alamat Email
auth-email-placeholder = toko@example.com
auth-phone-label = Nomor Telepon
auth-phone-placeholder = 08123456789
auth-license-label = Kunci Lisensi
auth-license-placeholder = OZ-PRO-XXXX-XXXX-XXXX
# Accessible names for the icon-only clear (×) buttons on each field of the
# license activation form (see shared.ftl).
auth-clear-email = Hapus alamat email
auth-clear-phone = Hapus nomor telepon
auth-clear-key = Hapus kunci lisensi
auth-activate-button = Aktifkan Lisensi
auth-activating = Mengaktifkan...
auth-activation-success = Lisensi berhasil diaktifkan!
auth-activation-failed = Gagal mengaktifkan lisensi.
auth-activation-error = Terjadi kesalahan saat aktivasi.
auth-trial-hint-pro = Anda datang dari halaman kafe/restoran — kunci trial Anda membuka trial Pro 14 hari.
auth-trial-hint-enterprise = Kunci trial referensi Anda membuka trial Pro 30 hari.
auth-validation-required = Kunci lisensi dan Email wajib diisi.
auth-validation-invalid-email = Format email tidak valid.
auth-validation-phone-required = Nomor telepon wajib diisi.
auth-validation-invalid-phone = Format nomor telepon tidak valid. Masukkan minimal 7 digit.
auth-paste = Tempel
auth-version = Versi { $version }
auth-ip-address = Alamat IP : { $ip }
auth-ip-detecting = Mendeteksi...
auth-ip-unknown = Tidak diketahui
auth-copyright = OZ-POS © { $year } Hak Cipta Dilindungi.
auth-clipboard-error = Kesalahan papan klip: { $message }
auth-error-title = Kesalahan

## Create Owner PIN (first-run setup)
auth-create-pin-title = Buat PIN Pemilik
auth-create-pin-desc = Siapkan akun pemilik pertama untuk mengelola POS Anda
auth-create-pin-display-name-label = Nama Tampilan
auth-create-pin-display-name-placeholder =
    .placeholder = Pemilik Toko
auth-create-pin-username-label = Nama Pengguna
auth-create-pin-username-placeholder =
    .placeholder = pemilik
auth-create-pin-pin-label = PIN
auth-create-pin-pin-placeholder =
    .placeholder = Minimal 4 digit
auth-create-pin-confirm-label = Konfirmasi PIN
auth-create-pin-confirm-placeholder =
    .placeholder = Masukkan ulang PIN
auth-create-pin-creating = Membuat...
auth-create-pin-create = Buat Akun Pemilik
# Common aria-label attributes (Indonesian)
clear-aria = Hapus
backspace-aria = Hapus
username-aria = Nama Pengguna
actions-aria = Aksi
collapse-aria = Tutup bilah sisi
notifications-aria = Notifikasi
settings-aria = Pengaturan
export-csv-aria = Ekspor CSV
search-aria = Cari
workspaces-aria = Ruang Kerja
developer-tools-aria = Alat Pengembang
theme-selector-aria = Pemilih Tema
cancel-refund-aria = Batalkan pengembalian
decrease-qty-aria = Kurangi jumlah
increase-qty-aria = Tambah jumlah
filter-sales-aria = Filter penjualan
filter-status-aria = Filter berdasarkan status
from-date-aria = Dari tanggal
to-date-aria = Sampai tanggal
filter-cashier-aria = Filter berdasarkan kasir
sales-history-aria = Riwayat penjualan
pagination-aria = Halaman
badge-tooltip-aria = Lencana dengan keterangan

auth-create-pin-success = Akun pemilik berhasil dibuat!
auth-create-pin-error-fields = Semua bidang wajib diisi.
auth-create-pin-error-pin-length = PIN minimal harus 4 karakter.
auth-create-pin-error-pin-mismatch = PIN tidak cocok.
auth-create-pin-error-generic = Terjadi kesalahan saat membuat akun pemilik.

# Additional common aria-label attributes (Indonesian)
close-aria = Tutup
search-customers-aria = Cari pelanggan
search-products-aria = Cari produk
barcode-input-aria = Input kode batang
submit-barcode-aria = Kirim kode batang
select-course-aria = Pilih kursus
revert-changes-aria = Kembalikan perubahan
add-sample-line-aria = Tambah contoh baris
previous-page-aria = Halaman sebelumnya
next-page-aria = Halaman berikutnya
results-per-page-aria = Hasil per halaman
void-order-aria = Batalkan pesanan
close-void-aria = Tutup dialog pembatalan
void-reason-aria = Alasan pembatalan
sale-detail-aria = Detail penjualan
sale-line-items-aria = Item baris penjualan
refund-line-items-aria = Item baris pengembalian
orders-aria = Pesanan
back-to-orders-aria = Kembali ke daftar pesanan
order-line-items-aria = Item baris pesanan
decrease-card-size-aria = Kurangi ukuran kartu
increase-card-size-aria = Tambah ukuran kartu
decrease-font-size-aria = Kurangi ukuran font
increase-font-size-aria = Tambah ukuran font
primary-colour-picker-aria = Pemilih warna utama
colour-hex-aria = Nilai heksadesimal warna
reset-colour-aria = Kembalikan warna ke awal
pick-logo-aria = Pilih file logo
reset-appearance-aria = Kembalikan semua pengaturan tampilan
save-appearance-aria = Simpan tampilan

# Stock alert bell (global header)
stock-alert-bell-empty-aria = Tidak ada peringatan stok
stock-alert-bell-count-aria = { $count ->
    [one] { $count } peringatan stok aktif
   *[other] { $count } peringatan stok aktif
}

# Workspace home — Insights section (owner/admin only)
workspace-home-insights-section = Wawasan
workspace-home-analytics-title = Analitik
workspace-home-analytics-desc = Performa staf, tren penjualan, dan metrik shift
workspace-home-analytics-aria = Buka Analitik
workspace-home-reports-title = Laporan
workspace-home-reports-desc = Dasbor laporan penjualan, inventaris, dan kustom
workspace-home-staff-title = Manajemen Staf
workspace-home-staff-desc = Kelola staf, peran, dan izin
workspace-home-settings-title = Pengaturan
workspace-home-settings-desc = Konfigurasi sistem dan preferensi
# Mirrors setup-feature-cloud-sync / -desc above, the established Indonesian wording.
workspace-home-cloud-sync-title = Sinkronisasi Cloud
workspace-home-cloud-sync-desc = Sinkronkan data ke PostgreSQL cloud dengan cadangan
workspace-home-audit-title = Log Audit
workspace-home-audit-desc = Lihat aktivitas sistem dan riwayat perubahan
workspace-home-terminals-title = Terminal
workspace-home-terminals-desc = Kelola terminal dan perangkat POS
workspace-home-locations-title = Lokasi
workspace-home-locations-desc = Kelola lokasi fisik dan cabang
workspace-home-shifts-title = Shift
workspace-home-shifts-desc = Kelola shift dan jadwal staf
workspace-home-tax-config-title = Tarif Pajak
workspace-home-tax-config-desc = Konfigurasi tarif dan aturan pajak
workspace-home-exchange-rates-title = Nilai Tukar
workspace-home-exchange-rates-desc = Konfigurasi nilai tukar mata uang
workspace-home-promotions-title = Promosi
workspace-home-promotions-desc = Buat dan kelola promosi
workspace-home-offline-queue-title = Antrean Offline
workspace-home-offline-queue-desc = Lihat item sinkronisasi offline yang tertunda
workspace-home-features-title = Fitur
workspace-home-features-desc = Aktifkan atau nonaktifkan fitur
workspace-home-data-management-title = Data
workspace-home-data-management-desc = Cadangkan, ekspor, dan impor data
workspace-home-workspaces-section = Workspace
workspace-home-tools-section = Alat
# Header grup Tools — arsitektur informasi yang disepakati
# (todo-tools.md): Operasional / Wawasan / Konfigurasi.
workspace-home-tools-group-operations = Operasional
workspace-home-tools-group-insights = Wawasan
workspace-home-tools-group-configuration = Konfigurasi
# Kartu tool terkunci: kartu di bawah tier minimum tetap terlihat
# (redup, tidak dapat diklik) dengan badge tier minimum; kartu dengan
# langganan tidak aktif atau di bawah peran minimum punya alasan sendiri.
workspace-home-tools-requires-tier-plus = Perlu paket Plus
workspace-home-tools-requires-tier-pro = Perlu paket Pro
workspace-home-tools-requires-tier-premium = Perlu paket Premium
workspace-home-tools-requires-tier-enterprise = Perlu paket Enterprise
workspace-home-tools-subscription-inactive = Langganan tidak aktif
workspace-home-tools-requires-role = Butuh akses Admin
workspace-home-topology-title = Editor Topologi
workspace-home-topology-desc = Rancang lokasi, workspace, dan tautan perangkat
workspace-home-memo-title = Memo
workspace-home-memo-desc = Tulis pemberitahuan untuk terminal dan lokasi
workspace-home-add-workspace = Tambah Workspace
workspace-home-add-workspace-desc = Konfigurasi workspace di editor topologi
workspace-home-add-workspace-aria = Tambah workspace melalui editor topologi
workspace-home-reports-aria = Buka Laporan
workspace-home-shortcut-open = Buka

# Warehouse workspace
warehouse-title = Inventaris Gudang
warehouse-location = Lokasi
warehouse-no-location-title = Tidak ada lokasi gudang
warehouse-no-location-desc = Workspace ini tidak terikat ke lokasi gudang. Konfigurasi di editor topologi.
warehouse-empty-title = Tidak ada produk
warehouse-empty-desc = Tidak ada produk inventaris yang ditemukan di lokasi ini.
warehouse-load-error = Gagal memuat inventaris gudang.
warehouse-adjust-error = Gagal menyesuaikan stok.
warehouse-col-sku = SKU
warehouse-col-name = Nama
warehouse-col-category = Kategori
warehouse-col-qty = Stok
warehouse-col-cost = Harga
warehouse-col-actions = Aksi
warehouse-products-count = produk
warehouse-low-stock-alerts = peringatan stok rendah
warehouse-search-placeholder = Cari berdasarkan nama atau SKU…
warehouse-search-aria = Cari produk
warehouse-filter-category = Filter berdasarkan kategori
warehouse-filter-stock = Filter berdasarkan status stok
warehouse-all-categories = Semua kategori
warehouse-stock-all = Semua stok
warehouse-stock-in = Ada stok
warehouse-stock-out = Habis
warehouse-stock-low = Stok rendah
warehouse-no-results = Tidak ada produk yang cocok dengan pencarian Anda.
warehouse-stat-total = Total
warehouse-stat-out-of-stock = Habis stok
warehouse-stat-low-stock = Stok rendah
warehouse-btn-adjust = Sesuaikan
warehouse-adjust-title = Sesuaikan Stok
warehouse-adjust-current = Stok saat ini
warehouse-adjust-delta-label = Perubahan jumlah (gunakan + untuk menambah, − untuk mengurangi)
warehouse-adjust-reason-label = Alasan
warehouse-adjust-reason-placeholder = contoh: hitung stok, kerusakan, pengembalian
warehouse-adjust-confirm = Konfirmasi
warehouse-adjust-cancel = Batal
warehouse-mode-tabs-aria = Mode gudang

# ── Warehouse POS console (v2) ────────────────────────────────
warehouse-mode-receive = Terima
warehouse-mode-send = Kirim
warehouse-mode-count = Hitung
warehouse-mode-stock = Stok
warehouse-mode-receive-desc = Terima barang masuk
warehouse-mode-send-desc = Kirim barang keluar
warehouse-mode-count-desc = Hitung stok
warehouse-mode-stock-desc = Lihat stok

warehouse-scan-placeholder = Pindai barcode atau ketik SKU…
warehouse-scan-aria = Pindai barcode atau ketik SKU
warehouse-scan-add = Tambah
warehouse-scan-no-match = Tidak ada produk yang cocok dengan barcode itu
warehouse-bin = Rak: { $bin }

warehouse-session-empty = Sesi kosong — pindai atau pilih produk
warehouse-session-items = { $count } item{ $count ->
  [one] 
 *[other] s
}
warehouse-session-line-qty = Jumlah
warehouse-session-line-picked = Dipetik
warehouse-session-complete-receive = Selesaikan Terima
warehouse-session-complete-send = Selesaikan Kirim
warehouse-session-print = Cetak
warehouse-session-clear = Kosongkan

warehouse-fn-receive = Terima
warehouse-fn-send = Kirim
warehouse-fn-count = Hitung
warehouse-fn-stock = Stok
warehouse-fn-print = Cetak
warehouse-fn-reserved = { $key }
warehouse-fn-fullscreen = Layar penuh
warehouse-fn-bar-aria = Tombol fungsi
warehouse-shortcut-list = Daftar pintasan
warehouse-shortcut-close = Tutup

warehouse-popup-receive-title = Sesi masuk
warehouse-popup-send-title = Sesi keluar
warehouse-popup-count-title = Sesi hitung
warehouse-popup-close = Tutup

warehouse-send-destination = Kirim ke…
warehouse-send-destination-aria = Pilih tujuan
warehouse-send-confirmed = Terkirim! { $number } — { $count } item ke { $destination }
warehouse-send-verify-hint = Pindai setiap item untuk memverifikasi pemetikan
warehouse-send-unpicked = { $count } baris belum dipetik

warehouse-receive-source-po = Terima dari pesanan pembelian
warehouse-receive-source-transfer = Terima dari transfer
warehouse-receive-no-transfers = Tidak ada transfer dalam perjalanan
warehouse-receive-no-pos = Tidak ada pesanan pembelian yang disetujui
warehouse-receive-confirmed = Diterima! { $number } — { $count } item
warehouse-receive-expected = Diharapkan
warehouse-receive-received = Diterima
warehouse-receive-damaged = Rusak
warehouse-receive-short = Kurang

warehouse-count-create = Mulai Hitung
warehouse-count-type = Tipe hitung
warehouse-count-notes = Catatan
warehouse-count-start = Mulai
warehouse-count-open = Hitungan terbuka
warehouse-count-history = Riwayat
warehouse-count-lines = baris
warehouse-count-empty = Belum ada baris — pindai barcode untuk mulai menghitung
warehouse-count-back = Kembali
warehouse-count-complete = Selesaikan Hitung
warehouse-count-complete-success = Hitung selesai — { $count } penyesuaian diposting
warehouse-count-error = Hitung gagal
