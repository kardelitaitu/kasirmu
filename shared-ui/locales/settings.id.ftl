settings-title = Pengaturan

# ── Sidebar navigation labels ──
# ── Lisensi: remediasi kuota (§J) ──
settings-license-quota-title = Status kuota
settings-license-quota-intro = Sumber daya diukur terhadap kuota paket { $tier } — angka yang sama yang diterapkan gerbang pembuatan.
settings-license-quota-ok = Semua masih dalam batas kuota.
settings-license-quota-over-aria = Sumber daya melebihi kuota
settings-license-quota-over-heading = Melebihi kuota — arsipkan atau tingkatkan paket
settings-license-quota-over-line = { $current } dari { $limit } — { $excess } berlebih
settings-license-quota-guidance = Arsipkan sumber daya yang tidak terpakai di layar terkait, atau tingkatkan paket untuk menaikkan batas. Tidak ada yang dihapus otomatis.
settings-license-quota-load-failed = Tidak dapat memuat penilaian kuota.
settings-license-quota-refresh = Segarkan
settings-license-quota-dim-locations = Lokasi
settings-license-quota-dim-pos-registers = Terminal POS
settings-license-quota-dim-warehouses = Titik stok gudang
settings-license-quota-dim-staff = Akun staf
settings-license-quota-dim-products = Produk
# §J B3 — cap KDS per lokasi. Tidak ada baris pemakaian tingkat tenant untuk
# ini, jadi labelnya tetap diperlukan meski dimensinya bukan kuota tenant.
settings-license-quota-dim-kds-screens = Layar KDS (lokasi ini)
# Marker S4 — agregat node topologi per toko: satu baris per toko yang
# menghitung instance non-arsip terhadap JUMLAH batas per lokasi, berlebih
# sejak ≥1 instance harus ditangguhkan kuota. Dihitung saat dibaca, tidak
# pernah disimpan.
settings-license-quota-dim-topology-nodes = Node topologi (toko ini)
# §J B3 — baris yang dibatasi per lokasi, bukan per tenant.
settings-license-quota-loc-aria = Batas kuota per lokasi
settings-license-quota-loc-title = Batas per lokasi
# Baris kegagalan generik B1 diberi slot alasan, karena id toko yang ditolak dan
# koneksi yang putus butuh jawaban berbeda. Alasannya adalah pesan hasil pemetaan
# KIND menurut ERR-05/06, bukan kalimat backend itu sendiri — baris mana yang
# dimaksud dibaca dari id toko yang dicetak kartu di samping baris ini.
settings-license-quota-remedy-failed-detail = Aksi tersebut gagal: { $reason }. Angka kuota di atas tidak berubah.
# §J B1 — dua aksi perbaikan register workspace pada kartu melebihi kuota.
# remedy-hint menyebut nama toko karena kartu ini terbaca sebagai tingkat tenant
# sementara kedua aksinya terikat satu toko; teksnya tidak boleh menimbulkan
# kesan lain.
settings-license-quota-remedy-aria = Perbaikan register workspace
settings-license-quota-remedy-title = Register workspace
settings-license-quota-remedy-hint = Suspensi register surplus milik { $store }, atau pulihkan yang sempat disuspensi oleh penurunan paket sebelumnya. Hanya toko ini yang terpengaruh.
settings-license-quota-remedy-suspend = Suspensi surplus
settings-license-quota-remedy-recover = Pulihkan yang disuspensi
settings-license-quota-remedy-suspended = { $count } register surplus disuspensi. Dinonaktifkan, bukan dihapus.
settings-license-quota-remedy-recovered = { $count } register yang disuspensi telah dipulihkan.
settings-license-quota-remedy-none = Tidak ada yang berubah — tidak ada register toko ini yang melebihi batas atau sedang disuspensi.
settings-nav-general = Umum
settings-nav-sync = Sinkronisasi Cloud
settings-nav-license = Lisensi
settings-nav-topology = Topologi

# ── Kerangka layar Setelan (penataan ulang) ──
# Satu label navigasi untuk tiap layar kosong di features/settings/screens/.
# Scaffold General memakai settings-nav-general di atas; dua belas kunci berikut
# berpasangan satu-lawan-satu dengan file sisanya, dalam urutan yang sama.
settings-nav-license-subscription = Lisensi & Langganan
settings-nav-devices-connectivity = Perangkat & Konektivitas
settings-nav-business-defaults = Default Bisnis
settings-nav-features-modules = Fitur & Modul
settings-nav-security-account = Keamanan & Akun
settings-nav-data-sync = Data & Sinkronisasi
settings-nav-data-management = Manajemen Data
settings-nav-sync-status = Status Sinkronisasi
settings-nav-sync-conflicts = Konflik Sinkronisasi
settings-nav-offline-queue = Antrean Offline
settings-nav-tax-configuration = Konfigurasi Pajak
settings-nav-exchange-rates = Kurs Valuta Asing
settings-nav-system-diagnostics = Diagnostik Sistem
settings-screen-placeholder = Halaman ini sedang dibangun ulang.
settings-screen-migrating = Konten setelan yang ada akan dipindahkan ke sini secara selektif.
# Gerbang lantai halaman Setelan: roleAtLeast (utils/role.ts) menampilkan teks ini
# untuk peran di bawah lantai admin.
# Lencana Plus di bilah sisi: dibaca oleh item navigasi datar yang halamannya
# digerbangi paket Plus. Masuk bersama markup lencana yang mereferensikannya
# (gerbang orphan: kunci harus direferensikan oleh commitnya sendiri).
settings-nav-plus-badge-aria = Memerlukan paket Plus
settings-locked-title = Setelan dibatasi
settings-locked-desc = Setelan hanya tersedia untuk pemilik dan administrator.
settings-sidebar-nav-aria = Navigasi pengaturan
settings-sidebar-expand-aria = Buka bilah sisi pengaturan
settings-sidebar-collapse-aria = Tutup bilah sisi pengaturan
settings-back-aria = Kembali
settings-sidebar-search-aria = Cari pengaturan
settings-sidebar-search-clear-aria = Hapus pencarian
# Bertahan pada IA datar: tanpa kategori, "tutup semua" melipat semua halaman
# ke bilah ikon, artinya menutup bilah sisi.
settings-sidebar-collapse-all-aria = Tutup semua halaman
settings-search-placeholder = Cari
settings-shortcut-btn-aria = Pintasan keyboard
settings-shortcuts-title = Pintasan keyboard
settings-sidebar-pinned-group-aria = Bagian yang disematkan
settings-sidebar-resize-aria = Ubah ukuran bilah sisi
settings-nav-pin-aria = Sematkan { $name }
settings-nav-unpin-aria = Lepas sematan { $name }
settings-nav-pin-title = Sematkan
settings-nav-unpin-title = Lepas sematan
settings-sidebar-no-results = Tidak ada bagian yang cocok
settings-sidebar-clear-results = Hapus pencarian

# ── Live-region announcements (localized via Fluent vars, P60-4e) ──
settings-announce-section-opened = Setelan { $section } dibuka
settings-announce-search-none = Tidak ada pengaturan yang cocok dengan pencarian
settings-announce-search-count =
    { $count ->
        [one] { $count } hasil ditemukan
       *[other] { $count } hasil ditemukan
    }
settings-announce-search-cleared = Pencarian dihapus

# ── Keyboard shortcut descriptions (popover) ──
settings-shortcuts-desc-navigate = Navigasi item
settings-shortcuts-desc-firstlast = Item pertama / terakhir
settings-shortcuts-desc-close = Tutup bilah sisi seluler

settings-theme-toggle-dark-aria = Beralih ke mode gelap
settings-theme-toggle-light-aria = Beralih ke mode terang
settings-store-name = Nama Toko
settings-tax-id = NPWP
settings-theme = Tema
settings-save = Simpan Pengaturan

appearance-preview-btn-label = Tombol Utama
appearance-preview-btn-outline-label = Sekunder
appearance-preview-badge-label = Aktif

# ── Product Lookup ──
setup-logo = kasir.mu
setup-tagline = Point of Sale — Sederhana

### First-run provisioning (ADR #56 §2.3).
setup-provision-title = Siapkan terminal ini
setup-provision-desc = Masuk untuk menautkan akun kasir.mu gratis Anda, lalu Anda bisa mulai berjualan.
setup-provision-account-section = Akun kasir.mu
setup-provision-account-hint = Hubungkan perangkat Anda ke akun gratis untuk mengaktifkan sinkronisasi otomatis dan perlindungan lisensi.
setup-provision-offline-warn = Koneksi internet diperlukan untuk membuat atau menautkan akun Anda.
setup-provision-mode-section = Mode Penyiapan
setup-mode-local-title = Mandiri (Offline)
setup-mode-local-desc = Tanpa akun. Siapkan dan langsung berjualan 100% offline.
setup-mode-linked-title = Tautkan Akun kasir.mu (Gratis)
setup-mode-linked-desc = Hubungkan ke akun cloud untuk sinkronisasi, backup cloud, dan langganan Gratis.
setup-tab-pair = Pasangkan QR
setup-tab-email = Kode Email
setup-provision-store-type = Jenis usaha apa ini?
setup-provision-location-label = Nama toko
setup-provision-owner-name-label = Nama Anda
setup-provision-owner-username-label = Nama masuk
setup-provision-pin-label = PIN (minimal 4 angka)
setup-provision-pin-confirm-label = Konfirmasi PIN
setup-provision-submit = Selesaikan penyiapan
setup-provision-success = Terminal ini siap.
setup-provision-error = Tidak dapat menyelesaikan penyiapan terminal ini. Silakan coba lagi.
setup-provision-account-required = Harap tautkan akun kasir.mu Anda sebelum menyelesaikan penyiapan.
setup-step-store-type = Tipe Toko
setup-step-payments = Pembayaran
setup-step-products = Produk
setup-step-staff = Staf
setup-step-hardware = Perangkat Keras
setup-step-business-rules = Aturan Bisnis
setup-step-data-cloud = Data & Cloud
setup-step-account = Akun
setup-step-review = Tinjauan
setup-step-aria = Langkah { $number }: { $label }

setup-account-title = Akun Anda
setup-account-desc = Opsional. Tautkan POS ini ke akun kasir.mu Anda agar bisa masuk di web dengan Google.
setup-account-google = Lanjutkan dengan Google
setup-account-waiting = Menunggu browser Anda…
setup-account-linked = Tertaut ke { $email }.
setup-account-failed = Tidak dapat menautkan perangkat ini. Coba lagi, atau lanjutkan tanpa menautkan.
setup-account-optional = Anda bisa melewati ini. Kunci lisensi Anda tetap menjalankan POS.
setup-account-tablet = Gunakan kode yang dikirim ke email akun Anda untuk menautkan perangkat ini.
setup-account-email = Email akun
setup-account-send = Kirim kode ke email
setup-account-sent = Kode terkirim. Kedaluwarsa dalam 15 menit.
setup-account-code = Kode 6 digit
setup-account-verify = Verifikasi
# Status saat proses (tablet). `setup-account-waiting` di atas menyebut browser dan tetap
# dipakai kontrol Google, yang memang membuka browser.
setup-account-sending = Mengirim kode…
setup-account-verifying = Memeriksa kode…
setup-progress-aria = Kemajuan setup
setup-preset-question = Toko seperti apa yang Anda jalankan?
setup-preset-desc = Pilih preset untuk memulai dengan cepat, atau sesuaikan setiap fitur nanti.
setup-preset-group-aria = Preset toko
setup-feature-toggle-aria = Alihkan { $name }
setup-preset-simple-retail = Ritel Sederhana
setup-preset-simple-retail-desc = Pindai barcode, keranjang, tunai/kartu/QR, PIN staf, printer nota
setup-preset-restaurant = Restoran
setup-preset-restaurant-desc = Meja, KDS, bagi tagihan, QRIS, pendapatan per shift
setup-preset-full-store = Toko Lengkap
setup-preset-full-store-desc = Semuanya kecuali sinkronisasi cloud dan loyalitas
setup-preset-custom = Kustom
setup-preset-custom-desc = Mulai dari awal — aktifkan sesuai kebutuhan

setup-preset-cafe = Kafe / Toko Roti
setup-preset-cafe-desc = Layanan cepat dengan layar dapur, tunai+kartu, diskon
setup-preset-franchise = Waralaba
setup-preset-franchise-desc = Multi-toko, multi-terminal, restoran + tumpukan admin lengkap
setup-features-title = { $title }
setup-features-desc = Aktifkan fitur yang Anda butuhkan. Anda dapat mengubahnya nanti.
setup-features-group-aria = { $title }
setup-features-toggle-aria =
    .aria-label = Aktifkan/nonaktifkan { $label }
setup-features-section-payments = Metode Pembayaran

# Gerbang setup QRIS (pemicu Free→Plus C1 — onboarding)
setup-qris-label = QRIS (Midtrans)
setup-qris-available = Terima pembayaran QRIS — sudah termasuk paket Anda.
setup-qris-included = Termasuk
setup-qris-upgrade-required = Pembayaran QRIS adalah fitur Plus. Tingkatkan ke Plus untuk menerima QRIS.
setup-qris-upgrade-cta = Tingkatkan ke Plus

setup-features-section-products = Produk & Stok
setup-features-section-staff = Manajemen Staf
setup-features-section-hardware = Perangkat Keras & Peripheral
setup-features-section-business-rules = Aturan Bisnis
setup-features-section-data-cloud = Data, Pelaporan & Cloud
setup-feature-cash-payment = Tunai
setup-feature-card-payment = Kartu
setup-feature-multi-currency = Multi-Mata Uang
setup-feature-inventory-tracking = Stok
setup-feature-product-variants = Varian
setup-feature-categories-enabled = Kategori
setup-feature-staff-login = Login Staf
setup-feature-staff-roles = Peran Staf
setup-feature-shift-management = Shift
setup-feature-audit-log = Log Audit
setup-feature-barcode-scanning = Barcode
setup-feature-receipt-printing = Nota
setup-feature-cash-drawer = Laci Uang
setup-feature-customer-display = Tampilan Pelanggan
setup-feature-nfc-reader = NFC
setup-feature-discount-engine = Diskon
setup-feature-tax-engine = Pajak
setup-feature-loyalty-program = Loyalitas
setup-feature-promotions-engine = Promosi
setup-feature-product-bundles = Bundel
setup-feature-reporting = Laporan
setup-feature-analytics = Analitik
setup-feature-export-import = Ekspor/Impor
setup-feature-cloud-sync = Sinkronisasi Cloud
setup-feature-multi-store = Multi-Toko
setup-feature-multi-terminal = Multi-Terminal
setup-feature-plugin-system = Plugin
setup-feature-inventory-tracking-label = Pelacakan Stok
setup-feature-product-variants-label = Varian Produk
setup-feature-shift-management-label = Manajemen Shift
setup-feature-barcode-scanning-label = Pemindai Barcode
setup-feature-receipt-printing-label = Pencetak Nota
setup-feature-nfc-reader-label = Pembaca NFC
setup-feature-tax-engine-label = Mesin Pajak
setup-feature-loyalty-program-label = Program Loyalitas
setup-feature-product-bundles-label = Bundel Produk
setup-feature-reporting-label = Pelaporan
setup-feature-export-import-label = Ekspor & Impor
setup-feature-plugin-system-label = Sistem Plugin
setup-feature-analytics-label = Analitik
setup-feature-audit-log-label = Log Audit
setup-feature-card-payment-label = Kartu
setup-feature-cash-drawer-label = Laci Kas
setup-feature-cash-payment-label = Tunai
setup-feature-categories-enabled-label = Kategori
setup-feature-cloud-sync-label = Sinkronisasi Cloud
setup-feature-customer-display-label = Layar Pelanggan
setup-feature-discount-engine-label = Diskon
setup-feature-multi-currency-label = Multi-Mata Uang
setup-feature-multi-store-label = Multi-Toko
setup-feature-multi-terminal-label = Multi-Terminal
setup-feature-promotions-engine-label = Promosi
setup-feature-staff-login-label = Login Staf
setup-feature-staff-roles-label = Peran Staf
setup-feature-cash-payment-desc = Terima pembayaran tunai dan lacak laci uang
setup-feature-card-payment-desc = Terima pembayaran debit dan kartu kredit
setup-feature-multi-currency-desc = Dukung berbagai mata uang dengan nilai tukar
setup-feature-inventory-tracking-desc = Lacak tingkat stok per produk dengan peringatan
setup-feature-product-variants-desc = Varian ukuran, warna, rasa per produk
setup-feature-categories-enabled-desc = Kelompokkan produk berdasarkan kategori dengan kode warna
setup-feature-staff-login-desc = Login PIN atau kata sandi untuk kasir
setup-feature-staff-roles-desc = Tingkat izin pemilik, manajer, kasir
setup-feature-shift-management-desc = Buka/tutup shift dengan rekonsiliasi tunai
setup-feature-audit-log-desc = Log tindakan sensitif yang tidak dapat diubah
setup-feature-barcode-scanning-desc = Pemindaian barcode USB, serial, atau Bluetooth
setup-feature-receipt-printing-desc = Pencetakan nota USB, serial, atau jaringan
setup-feature-cash-drawer-desc = Laci uang otomatis melalui GPIO printer
setup-feature-customer-display-desc = Layar kedua menghadap pelanggan
setup-feature-nfc-reader-desc = Pembayaran nirsentuh dan pembacaan kartu loyalitas
setup-feature-discount-engine-desc = Diskon persentase dan jumlah tetap pada item atau keranjang
setup-feature-tax-engine-desc = Pajak inklusif/eksklusif dengan tarif yang dapat dikonfigurasi
setup-feature-loyalty-program-desc = Poin pelanggan, tingkatan, dan hadiah
setup-feature-promotions-engine-desc = Beli-X-dapat-Y, penawaran terbatas waktu, bundel
setup-feature-product-bundles-desc = Jual beberapa SKU bersama sebagai satu item
setup-feature-reporting-desc = Laporan penjualan, stok, dan shift
setup-feature-analytics-desc = Grafik, produk terlaris, peta panas per jam, ekspor CSV
setup-feature-export-import-desc = Ekspor dan impor data terenkripsi (.ozpkg)
setup-feature-cloud-sync-desc = Sinkronkan data ke PostgreSQL cloud dengan cadangan
setup-feature-multi-store-desc = Kelola beberapa lokasi toko
setup-feature-multi-terminal-desc = Beberapa terminal POS per toko
setup-feature-plugin-system-desc = Plugin pihak ketiga dan driver kustom
setup-review-title = Tinjau Pengaturan Anda
setup-review-desc = Berikut ringkasan konfigurasi Anda. Anda dapat mengubah apa pun nanti.
setup-review-preset = Preset: { $name }
setup-review-enabled = Fitur Diaktifkan ({ $count })
setup-review-disabled = Fitur Dinonaktifkan ({ $count })
setup-review-none = Tidak Ada
setup-review-all-on = Semuanya aktif!
setup-review-more = +{ $count } lagi
setup-default-currency-label = Mata Uang Default

setup-complete-title = Siap!
setup-complete-desc = { $preset } POS Anda telah dikonfigurasi dan siap digunakan. Anda dapat menyesuaikan pengaturan kapan saja.
setup-launch = Luncurkan kasir.mu
setup-complete-features = { $count } { $count ->
    [one] fitur diaktifkan
    *[other] fitur diaktifkan
}
setup-back = Kembali
setup-skip = Lewati
setup-finish = Selesaikan Setup
setup-next = Lanjut

# Live Setup Preview
lsp-title = Pratinjau Fitur
lsp-subtitle =
  Sidebar akan menampilkan { $count } rute yang diaktifkan oleh pilihan Anda
lsp-section-workspaces = Ruang Kerja
lsp-section-nav = Item Navigasi
lsp-workspaces-aria = Pratinjau ruang kerja
lsp-nav-aria = Pratinjau navigasi
lsp-nav-empty = Belum ada item navigasi yang terbuka
lsp-nav-count = { $count } / { $total } item terbuka
lsp-ws-status-active = { $name } — aktif
lsp-ws-status-inactive = { $name } — nonaktif

ws-preview-name-restaurant-pos = POS Restoran
ws-preview-name-store-pos = POS Toko
ws-preview-name-kds = Tampilan Dapur
ws-preview-name-warehouse = Gudang
ws-preview-name-admin = Admin

# ── Settings Page (remaining) ──
settings-page-title = Pengaturan
settings-loading = Memuat pengaturan…
settings-section-loading = Memuat…
settings-load-partial = Sebagian pengaturan gagal dimuat. Coba lagi.
settings-section-store = Toko
settings-section-currency = Mata Uang
settings-currency-loading = Memuat mata uang…
settings-section-display = Tampilan
settings-section-receipt = Nota
settings-field-store-name = Nama toko
settings-field-address = Alamat
settings-field-branch = Cabang
settings-field-tax-id = NPWP
settings-field-default-currency = Mata uang default
settings-field-decimal-separator = Pemisah desimal
settings-field-paper-width = Lebar kertas
settings-field-footer = Kaki nota

# ── Tampilan ──
settings-field-card-size = Ukuran Kartu Menu
settings-field-font-size = Ukuran Font
settings-card-size-decrease-aria =
    .aria-label = Kurangi ukuran kartu
settings-card-size-increase-aria =
    .aria-label = Tambah ukuran kartu
settings-font-size-decrease-aria =
    .aria-label = Kurangi ukuran font
settings-font-size-increase-aria =
    .aria-label = Tambah ukuran font
settings-field-font-smoothing = Penghalusan Font
settings-toggle-show-currency = Tampilkan simbol mata uang
settings-toggle-show-tax = Tampilkan baris pajak di nota
settings-toggle-show-table-number = Tampilkan nomor meja di keranjang dan nota
settings-btn-save = Simpan
settings-close-unsaved-title = Keluar dengan perubahan yang belum disimpan?
settings-close-unsaved-msg = Perubahan pengaturan Anda belum disimpan. Menutup sekarang akan membuangnya.
settings-close-unsaved-discard = Buang & tutup
settings-close-unsaved-keep = Lanjut mengedit
settings-btn-revert = Kembalikan

settings-btn-revert-aria =
    .aria-label = Kembalikan pengaturan ke keadaan tersimpan terakhir

settings-saved = Tersimpan!
settings-section-sync = Sinkronisasi Cloud
settings-sync-server-url = URL Server
settings-sync-resolved-origin = Server yang dipakai: { $origin } ({ $source })
settings-sync-api-key = Kunci API
settings-sync-enabled = Aktifkan Sinkronisasi Cloud
settings-sync-enabled-aria = Aktifkan/nonaktifkan sinkronisasi cloud
settings-sync-sync-now = Sinkron Sekarang
settings-sync-syncing = Menyinkronkan…
settings-sync-test-connection = Tes Koneksi
settings-sync-testing = Menguji…
settings-sync-test-failed = Tes koneksi gagal
settings-sync-token-request-failed = Permintaan token gagal — periksa URL server
settings-sync-request-token = Minta Token
settings-sync-requesting = Meminta…
settings-sync-error = Sinkronisasi gagal
settings-sync-plan-required = Sinkronisasi cloud membutuhkan paket berbayar
settings-sync-plan-required-hint = Penjualan lokal tetap berjalan — tingkatkan paket untuk menyinkronkannya ke cloud.

# ── Token expiry badge ──────────────────────────────────
settings-sync-expiry-expired = Kedaluwarsa
settings-sync-expiry-in-days = { $count ->
    [one] Kedaluwarsa dalam 1 hari
   *[other] Kedaluwarsa dalam { $count } hari
}
settings-sync-expiry-in-hours = { $count ->
    [one] Kedaluwarsa dalam 1 jam
   *[other] Kedaluwarsa dalam { $count } jam
}
settings-sync-expiry-in-minutes = { $count ->
    [one] Kedaluwarsa dalam 1 menit
   *[other] Kedaluwarsa dalam { $count } menit
}
settings-sync-expiry-less-than-minute = Kedaluwarsa dalam kurang dari 1 menit
settings-sync-expiry-fallback = Kedaluwarsa { $iso }
settings-sync-result = Sinkronisasi terakhir: { $synced } tersinkron, { $failed } gagal
settings-sync-success = Sinkronisasi selesai: { $synced } tersinkron, { $failed } gagal
settings-sync-nothing = Tidak ada yang perlu disinkronkan
settings-store-name-placeholder =
    .placeholder = Toko kasir.mu
settings-address-placeholder =
    .placeholder = Jl. Contoh No. 123
settings-tax-id-placeholder =
    .placeholder = 12-345-678-9-000
settings-branch-placeholder =
    .placeholder = Cabang Utama
settings-footer-placeholder =
    .placeholder = Terima kasih telah berbelanja!
settings-server-url-placeholder =
    .placeholder = https://api.example.com
settings-api-key-placeholder = Masukkan kunci API
settings-api-key-masked = ••••••••
settings-api-key-show-aria = Tampilkan kunci API
settings-api-key-hide-aria = Sembunyikan kunci API
settings-btn-save-aria =
    .aria-label = { $state ->
        [saved] Tersimpan!
       *[save] Simpan pengaturan
    }
settings-save-error = Gagal menyimpan pengaturan. Silakan coba lagi.
settings-save-partial = Sebagian pengaturan gagal disimpan. Coba lagi.
settings-load-failed = Gagal memuat pengaturan
settings-retry = Coba Lagi
settings-sync-not-configured = Sinkronisasi belum dikonfigurasi. Masukkan URL server dan aktifkan sinkronisasi.
# Pil sinkronisasi di bilah status: perangkat belum punya URL server sama
# sekali — celah konfigurasi, bukan gangguan jaringan. Sengaja bukan "Luring".
statusbar-sync-unconfigured-msg = { $name } · Belum dikonfigurasi
settings-sync-status-idle = Siap
settings-sync-status-ok = Terhubung
settings-sync-pending-count = { $count } tertunda
settings-sync-summary-pending = tertunda
settings-sync-summary-synced = tersinkron
settings-sync-summary-failed = gagal
settings-sync-summary-conflicts = konflik
settings-sync-plan-label = Paket
settings-sync-plan-free = Gratis
settings-sync-plan-pro = Pro
settings-sync-plan-upgrade-hint = Tingkatkan paket untuk sinkronisasi cloud
settings-sync-last-synced = Sinkronisasi terakhir { $time }
settings-sync-last-synced-never = Belum pernah tersinkron
settings-sync-oldest-pending = Tertunda terlama { $time }
settings-sync-oldest-pending-none = Antrean kosong
settings-sync-time-just-now = baru saja
settings-sync-time-minutes-ago = { $count } mnt lalu
settings-sync-time-hours-ago = { $count } jam lalu
settings-sync-time-days-ago = { $count } hari lalu
settings-sync-pull = Tarik dari Server
settings-sync-pulling = Menarik…
settings-sync-pull-empty = Server mengembalikan snapshot kosong
settings-sync-pull-result = Tarik terakhir: { $products } produk, { $tax_rates } tarif pajak, { $users } pengguna
appearance-primary-colour = Warna Utama
appearance-primary-colour-picker-aria =
    .aria-label = Pemilih warna utama
appearance-colour-hex-aria =
    .aria-label = Nilai hex warna
appearance-reset-colour-aria =
    .aria-label = Atur ulang warna ke default
appearance-reset-colour = Atur ulang ke default
appearance-follow-theme-aria = Mengikuti warna tema
    .aria-label = Mengikuti warna tema — pilih warna untuk mengganti
appearance-follow-theme = Mengikuti warna tema
appearance-logo = Logo Toko
appearance-logo-alt =
    .alt = Logo toko
appearance-choose-logo = Pilih Logo
appearance-choose-logo-aria =
    .aria-label = Pilih file logo
appearance-store-name = Nama Toko Tampilan
appearance-interface-zoom = Perbesaran Antarmuka
appearance-zoom-auto = Otomatis (Sesuaikan dengan layar)
appearance-zoom-100 = 100% (Default)
appearance-zoom-125 = 125%
appearance-zoom-150 = 150%
appearance-zoom-200 = 200%
appearance-branding = Merek
appearance-interface = Antarmuka
appearance-preview-heading = Pratinjau
appearance-store-name-fallback = kasir.mu
appearance-hw-accel = Akselerasi Perangkat Keras
appearance-hw-accel-aria =
    .aria-label = Aktifkan/nonaktifkan akselerasi perangkat keras
appearance-hw-accel-hint = Nonaktifkan jika animasi UI terasa lambat di perangkat rendah. Mulai ulang aplikasi agar perubahan diterapkan sepenuhnya.
appearance-preview = Pratinjau
appearance-reset-all-aria =
    .aria-label = Atur ulang semua ke default
appearance-reset-all = Atur ulang semua ke default
appearance-reset-all-confirm-title = Atur Ulang Tampilan
appearance-reset-all-confirm = Atur ulang semua pengaturan tampilan ke default? Tindakan ini tidak dapat dibatalkan.
appearance-reset-all-success = Pengaturan tampilan diatur ulang ke default
appearance-reset-all-failed = Gagal mengatur ulang pengaturan tampilan
appearance-save-aria =
    .aria-label = Simpan tampilan
appearance-save-success = Pengaturan tampilan berhasil disimpan
appearance-save-failed = Gagal menyimpan pengaturan tampilan
settings-decimal-separator-dot = 1,00 (titik)
settings-decimal-separator-comma = 1,00 (koma)
settings-decimal-separator-none = 1 (tanpa)
settings-paper-width-narrow = 58 mm (sempit)
settings-paper-width-standard = 80 mm (standar)

# ── Data Management ──
data-mgmt-title = Manajemen Data
data-mgmt-tabs-aria = Tindakan manajemen data
data-mgmt-tab-export = Ekspor
data-mgmt-tab-import = Impor
data-mgmt-tab-backup = Cadangan
data-mgmt-export-wizard-aria = Wizard ekspor
data-mgmt-export-title = Pilih data untuk diekspor
data-mgmt-export-types-aria = Tipe data untuk diekspor
data-mgmt-export-select-all = Pilih semua / tidak ada
data-mgmt-type-products = Produk
data-mgmt-type-products-desc = SKU, nama, harga, barcode, stok
data-mgmt-type-categories = Kategori
data-mgmt-type-categories-desc = ID kategori, nama, warna
data-mgmt-type-sales = Penjualan
data-mgmt-type-sales-desc = Header penjualan, item baris, pembayaran
data-mgmt-type-customers = Pelanggan
data-mgmt-type-customers-desc = Nama, email, telepon, poin loyalitas
data-mgmt-type-users = Pengguna
data-mgmt-type-users-desc = Nama pengguna, nama tampilan, peran (tanpa kata sandi)
data-mgmt-type-settings = Pengaturan
data-mgmt-type-settings-desc = Konfigurasi toko, nota, bendera fitur
data-mgmt-export-date-from = Dari
data-mgmt-export-date-to = Ke
data-mgmt-export-next = Berikutnya: Enkripsi
data-mgmt-export-exporting = Mengekspor…
data-mgmt-export-complete = Ekspor selesai
data-mgmt-export-done-text = Data diekspor ke:
data-mgmt-export-selected-types = Tipe yang dipilih:
data-mgmt-export-new-export = Ekspor baru
data-mgmt-encrypt-title = Atur kata sandi enkripsi
data-mgmt-encrypt-desc = File ekspor akan dienkripsi dengan AES-256-GCM. Pilih kata sandi yang kuat — Anda akan membutuhkannya untuk mengimpor data nanti.
data-mgmt-encrypt-password = Kata Sandi
data-mgmt-encrypt-password-placeholder = Minimal 8 karakter
data-mgmt-encrypt-confirm = Konfirmasi kata sandi
data-mgmt-encrypt-confirm-placeholder = Masukkan ulang kata sandi
data-mgmt-encrypt-back = Kembali
data-mgmt-encrypt-export = Ekspor
data-mgmt-import-wizard-aria = Wizard impor
data-mgmt-import-title = Pilih file cadangan
data-mgmt-import-desc = Pilih file .kasirpkg terenkripsi untuk diimpor. File harus dibuat oleh ekspor kasir.mu.
data-mgmt-import-browse = Cari file…
data-mgmt-import-preview-title = Pratinjau impor
data-mgmt-import-meta-file = File
data-mgmt-import-meta-store = Toko
data-mgmt-import-meta-version = Versi
data-mgmt-import-meta-created = Dibuat
data-mgmt-import-meta-contains = Berisi
data-mgmt-import-password = Kata sandi dekripsi
data-mgmt-import-password-placeholder = Masukkan kata sandi ekspor
data-mgmt-import-cancel = Batal
data-mgmt-analyse-file = Analisis file
data-mgmt-import-start = Mulai impor
data-mgmt-import-confirm-title = Impor Data
data-mgmt-import-confirm-message = Mengimpor akan menimpa data saat ini dengan isi file cadangan. Tindakan ini tidak dapat dibatalkan. Lanjutkan?
data-mgmt-import-analysing = Menganalisis file…
data-mgmt-import-dry-run-complete = Dry-run selesai — mengimpor…
data-mgmt-import-dry-run-title = Perubahan yang akan diterapkan
data-mgmt-import-dry-run-added = Item baru
data-mgmt-import-dry-run-updated = Diperbarui
data-mgmt-import-dry-run-skipped = Dilewati
data-mgmt-import-complete = Impor selesai
data-mgmt-import-done-text = Semua data berhasil diimpor.
data-mgmt-import-done-summary = { $added } item ditambahkan, { $updated } diperbarui, { $skipped } dilewati.
data-mgmt-import-new-import = Impor baru
data-mgmt-backup-status-aria = Status cadangan
data-mgmt-backup-title = Cadangan database
data-mgmt-backup-desc = Buat snapshot database online. Cadangan berjalan di latar belakang dan tidak mengganggu operasi POS.
data-mgmt-backup-label-last = Cadangan terakhir
data-mgmt-backup-never = Tidak Pernah
data-mgmt-backup-label-size = Ukuran
data-mgmt-backup-create = Buat cadangan sekarang
data-mgmt-backup-backing-up = Mencadangkan…
data-mgmt-toast-backup-success = Cadangan berhasil dibuat
data-mgmt-export-complete-aria = Ekspor selesai
data-mgmt-import-complete-aria = Impor selesai
data-mgmt-toast-backup-fail = Cadangan gagal
data-mgmt-toast-export-select-type = Pilih setidaknya satu tipe data untuk diekspor
data-mgmt-toast-export-password-length = Kata sandi minimal 8 karakter
data-mgmt-toast-export-password-match = Kata sandi tidak cocok
data-mgmt-toast-export-success = Ekspor selesai
data-mgmt-toast-export-fail = Ekspor gagal
data-mgmt-toast-import-enter-password = Masukkan kata sandi ekspor
data-mgmt-toast-import-no-file = Tidak ada file dipilih
data-mgmt-toast-import-success = Impor selesai
data-mgmt-toast-import-fail = Impor gagal
data-mgmt-toast-file-picker-fail = Gagal membuka pemilih file
data-mgmt-toast-backup-status-fail = Gagal memuat status cadangan

# ── Feature Toggles ──
feature-toggle-title = Alih Fitur
feature-toggle-subtitle = { $enabled } / { $total } aktif
feature-toggle-loading = Memuat fitur…
feature-toggle-group-core = Inti
feature-toggle-group-payments = Pembayaran
feature-toggle-group-products = Produk
feature-toggle-group-staff = Staf
feature-toggle-group-hardware = Perangkat Keras
feature-toggle-group-business-rules = Aturan Bisnis
feature-toggle-group-restaurant = Restoran
feature-toggle-group-scaling = Skalabilitas
feature-toggle-group-reporting = Pelaporan
feature-toggle-group-advanced = Lanjutan
feature-toggle-error-load = Gagal memuat fitur
feature-toggle-error-toggle = Gagal mengubah status fitur
feature-toggle-enabled = Fitur diaktifkan
feature-toggle-disabled = Fitur dinonaktifkan
feature-toggle-auto-enabled = Dependensi otomatis: { $list }
feature-toggle-retry = Coba Lagi
feature-toggle-empty = Tidak ada fitur ditemukan.
feature-toggle-empty-search = Tidak ada fitur yang cocok dengan pencarian Anda.
feature-toggle-search-placeholder =
    .placeholder = Cari fitur…
feature-toggle-search-aria = Cari fitur
feature-toggle-search-clear-aria = Hapus pencarian
feature-toggle-bulk-enable = Aktifkan Semua
feature-toggle-bulk-disable = Nonaktifkan Semua
feature-toggle-bulk-enable-aria = Aktifkan semua fitur { $group }
feature-toggle-bulk-disable-aria = Nonaktifkan semua fitur { $group }
feature-toggle-bulk-enabled = Semua fitur { $group } diaktifkan
feature-toggle-bulk-disabled = Semua fitur { $group } dinonaktifkan
feature-toggle-requires = Memerlukan: { $deps }
feature-toggle-group-aria = Fitur { $group }
feature-toggle-toggle-aria = Aktifkan/nonaktifkan { $name }

# ── Data Management ──
data-mgmt-password-show-aria = Tampilkan kata sandi
data-mgmt-password-hide-aria = Sembunyikan kata sandi

# ── Sales History ──
category-colour-picker-aria = Pemilih warna
category-colour-swatch-aria =
    .aria-label = Contoh warna { $colour }
category-delete-aria =
    .aria-label = Hapus { $name }
category-delete-dialog-aria = Dialog hapus kategori
category-name-fallback = (tanpa nama)

# ── POS (remaining) ──

# ── Settings Tabs ──


# ── General Settings ──
# ── Receipt Settings ──
settings-margins-heading = Margin Kertas (mm)
settings-margin-top = Atas
settings-margin-bottom = Bawah
settings-margin-left = Kiri
settings-margin-right = Kanan

# ── Receipt Preview ──

# ── Decimal separator options ──

# ── Printer Settings ──

# ── Scanner Settings ──

# ── Credit Settings ──

# ── System Settings ──

# ── Sound & Language ──

# ── Quick Links ──

# ── Customer-Facing Display ──

# ── Section headings (sub-screens) ──

# ── Payment Gateways ──

# ── Tender Presets ──

# ── Cloud Sync ──
settings-font-smoothing-antialiased = Antialiased (tajam)
settings-font-smoothing-subpixel = Subpixel (halus)
settings-sync-token-hint = Disimpan dengan aman di database — tidak pernah di localStorage
settings-sync-last = Sinkronisasi terakhir
settings-sync-pending = Perubahan tertunda
settings-sync-confirm-overwrite = Timpa data lokal dengan snapshot server?
settings-sync-confirm-pull-title = Tarik dari server?
settings-sync-toast-success = Sinkronisasi berhasil
settings-sync-toast-fail = Sinkronisasi gagal — periksa URL server dan token
settings-sync-toast-test-success = Uji koneksi berhasil
settings-sync-toast-test-fail = Tidak dapat menjangkau server
settings-sync-pull-toast-success = { $products } produk, { $tax_rates } tarif pajak, { $users } pengguna ditarik dari server
settings-sync-pull-toast-empty = Snapshot server kosong — tidak ada yang ditarik
settings-sync-pull-toast-fail = Penarikan gagal — periksa URL server dan token

# ── System & License ──
settings-system-license-header = Sistem & Kepemilikan Lisensi
settings-software-edition = Edisi Perangkat Lunak
settings-license-type = Tipe Lisensi
settings-copyright-notice = Pemberitahuan Hak Cipta
settings-commercial-contact = Kontak Komersial
settings-app-version = kasir.mu Enterprise v{ $version }

# ── License Info Section ──
settings-section-license = Lisensi
settings-license-tier = Tingkat
settings-license-status-label = Status
settings-license-expires = Kedaluwarsa
settings-license-grace = Masa Tenggang Hingga
settings-license-max-stores = Maks Toko
settings-license-max-pos = Maks Instansi POS
settings-license-tenant-id = ID Tenant
settings-license-allowed-types = Tipe Ruang Kerja Diizinkan
settings-license-allowed-types-all = Semua
settings-license-not-activated = Tidak ada lisensi yang diaktifkan. Aktifkan lisensi untuk melihat detail di sini.
settings-license-server-tier = Tingkat Server
settings-license-server-active = Server Aktif
settings-license-server-expires = Server Kedaluwarsa
settings-license-server-results = Hasil Pemeriksaan Lisensi
settings-license-type-value = Proprietary
settings-license-unlimited = Tidak Terbatas
settings-license-yes = Ya
settings-license-no = Tidak
settings-license-status-active = Aktif
settings-license-tier-free = Gratis
settings-license-tier-pro = Pro
settings-license-tier-premium = Premium
settings-license-tier-enterprise = Enterprise
settings-license-ws-retail = Ritel
settings-license-ws-restaurant = Restoran
settings-license-ws-cafe = Kafe
settings-license-ws-kiosk = Kios
settings-license-ws-franchise = Waralaba
settings-license-ws-warehouse = Gudang
settings-license-server-status-retrieved = Status lisensi server berhasil diambil.
settings-license-server-check-failed = Pemeriksaan server gagal
settings-license-server-status = Status Server
settings-license-live-online = Aktif
settings-license-live-offline = Offline
settings-license-live-inactive = Nonaktif
settings-license-live-checking = Memeriksa…
settings-license-last-checked = Terakhir diperiksa: { $when }
settings-license-just-now = baru saja
settings-license-seconds-ago = { $seconds }d yang lalu
settings-license-minutes-ago = { $minutes }m yang lalu
settings-license-refresh = Muat Ulang
settings-license-refresh-aria = Muat ulang status lisensi
settings-license-poll-offline = Server tidak dapat dijangkau
settings-license-load-failed = Gagal memuat info lisensi
# C3.3: Pause/resume subscription
settings-license-subscription-actions = Langganan
settings-license-pause-subscription = Jeda langganan
settings-license-pause-aria = Jeda langganan selama 1 bulan
settings-license-pause-success = Langganan dijeda. Resume kapan saja.
settings-license-pause-failed = Gagal menjeda langganan
settings-license-paused-until = Dijeda hingga
settings-license-resume-subscription = Lanjutkan langganan
settings-license-resume-aria = Lanjutkan langganan yang dijeda
settings-license-resume-success = Langganan dilanjutkan!
settings-license-resume-failed = Gagal melanjutkan langganan
# ADR #58 §2.3: Pre-expiry re-authentication window
settings-license-reauth-banner-title = Pemeriksaan Perpanjangan Langganan Diperlukan
settings-license-reauth-banner-desc = Langganan Anda berakhir dalam { $days } hari. Hubungkan ke internet untuk melakukan autentikasi ulang dengan server lisensi.
settings-license-reauth-action = Verifikasi Online Sekarang
settings-copyright-notice-value = kasir.mu © 2025–2026. Seluruh hak cipta dilindungi.

# ── Toast messages ──

# ── Updates ──
settings-updates-heading = Pembaruan
settings-current-version = Versi Saat Ini
settings-check-for-updates = Periksa Pembaruan
settings-checking-for-updates = Memeriksa…
settings-up-to-date = ✓ Anda telah menggunakan versi terbaru
settings-update-available = { $version } tersedia
settings-install-update = Pasang Sekarang
settings-installing-update = Memasang…
settings-update-status-label = Status
settings-update-not-checked = Belum diperiksa
settings-update-check-error = Pemeriksaan pembaruan gagal
settings-update-retry = Coba Lagi
settings-field-language = Bahasa

# ── Field validation ──
settings-tax-id-pattern-hint = Hanya huruf, angka, garis, titik, dan garis miring, maks 20 karakter

# ── Email Report Settings ──
settings-section-email = Laporan Email
settings-email-description = Konfigurasi SMTP untuk menerima laporan email terjadwal.
settings-email-host = Host SMTP
settings-email-port = Port
settings-email-username = Nama Pengguna
settings-email-username-placeholder = Opsional
settings-email-password = Kata Sandi
settings-email-password-placeholder = Masukkan kata sandi
settings-email-password-show = Tampilkan kata sandi
settings-email-password-hide = Sembunyikan kata sandi
settings-email-from = Alamat Pengirim
settings-email-use-tls = Gunakan STARTTLS
settings-email-save-btn = Simpan Pengaturan SMTP
settings-email-saved-btn = Tersimpan ✓
settings-email-loading = Memuat pengaturan email…
settings-email-saved = Pengaturan SMTP tersimpan
settings-email-save-error = Gagal menyimpan pengaturan SMTP
settings-email-host-required = Host SMTP harus diisi
settings-email-from-required = Alamat pengirim yang valid diperlukan
settings-email-test-btn = Kirim Laporan Uji Coba
settings-email-sending = Mengirim…
settings-email-test-tooltip = Mengirim laporan uji coba ke penerima pertama yang dikonfigurasi

# ── Email Report Schedule ──
settings-section-schedule = Jadwal Laporan
settings-schedule-loading = Memuat jadwal…
settings-schedule-description = Konfigurasi seberapa sering email laporan terjadwal dikirim.
settings-schedule-enabled = Aktifkan Laporan Terjadwal
settings-schedule-cadence = Frekuensi
settings-schedule-cadence-daily = Harian
settings-schedule-cadence-weekly = Mingguan (Senin)
settings-schedule-cadence-monthly = Bulanan (Tanggal 1)
settings-schedule-time = Waktu Kirim
settings-schedule-timezone = Zona Waktu
settings-schedule-lookback = Hari Mundur
settings-schedule-report-types = Jenis Laporan
settings-schedule-recipients = Penerima
settings-schedule-add-recipient = + Tambah Penerima
settings-schedule-save-btn = Simpan Jadwal
settings-email-schedule-saved = Jadwal laporan tersimpan

# ── Report type labels for schedule ──
settings-schedule-report-type-daily-revenue = Pendapatan Harian
settings-schedule-report-type-weekly-revenue = Pendapatan Mingguan
settings-schedule-report-type-monthly-revenue = Pendapatan Bulanan
settings-schedule-report-type-top-products = Produk Terlaris
settings-schedule-report-type-hourly-heatmap = Peta Panas Per Jam
settings-schedule-report-type-category-breakdown = Rincian Kategori
settings-schedule-report-type-low-stock-alerts = Peringatan Stok Rendah

# ── Schedule recipient aria labels ──
settings-schedule-recipient-aria = Penerima { $number }
settings-schedule-recipient-remove-aria = Hapus penerima { $number }
settings-schedule-recipient-add-aria = Tambah penerima

# ── Email test/schedule error fallbacks ──
settings-email-test-send-failed = Gagal mengirim email uji coba
settings-email-schedule-save-failed = Gagal menyimpan jadwal

# ── Workspace Cards (ADR #22 Phase 1) ──
workspace-pos-receipt-heading = Pengaturan Struk
workspace-pos-paper-width = Lebar Kertas
workspace-pos-show-currency = Tampilkan Mata Uang
workspace-pos-show-tax = Tampilkan Pajak
workspace-pos-tax-rounding = Pembulatan Pajak
workspace-pos-tax-rounding-halfup = Bulatkan Setengah ke Atas
workspace-pos-tax-rounding-truncate = Potong (Legacy)
workspace-pos-show-table = Tampilkan Nomor Meja
workspace-pos-footer = Footer Struk
workspace-pos-printer-heading = Printer
workspace-pos-printer-connection = Koneksi
workspace-pos-printer-ip = Alamat IP
workspace-pos-printer-paper-size = Ukuran Kertas
workspace-pos-scanner-heading = Pemindai Barcode
workspace-pos-scanner-mode = Mode Input
workspace-pos-scanner-device = ID Perangkat
workspace-resto-table-heading = Manajemen Meja
workspace-resto-table-enable = Aktifkan Tata Letak Meja
workspace-resto-table-hint = Meja muncul di layar POS untuk pesanan dine-in
workspace-resto-courses-heading = Pengiriman Hidangan
workspace-resto-courses-enable = Aktifkan Pengiriman Hidangan
workspace-resto-courses-hint = Kirim hidangan pembuka, utama, dan penutup ke dapur secara berurutan
workspace-resto-kitchen-printer-heading = Printer Dapur
workspace-resto-kp-connection = Koneksi
workspace-resto-kp-disabled = Nonaktif
workspace-resto-kp-ip = IP Printer Dapur
workspace-kds-sla-heading = Eskalasi SLA
workspace-kds-sound = Suara Pesanan Baru
workspace-kds-yellow-threshold = Peringatan Kuning (mnt)
workspace-kds-red-threshold = Peringatan Merah (mnt)
workspace-kds-display-heading = Tampilan Tiket
workspace-kds-auto-ack = Konfirmasi Otomatis
workspace-kds-density = Kepadatan
workspace-inv-threshold-heading = Ambang Stok
workspace-inv-low-stock = Peringatan Stok Rendah Pada
workspace-inv-units = { $count } item
workspace-inv-threshold-hint = Peringatan saat stok di bawah jumlah ini
workspace-inv-deduction-heading = Aturan Pengurangan
workspace-inv-deduction-warehouse = Utamakan Gudang
workspace-inv-deduction-hint = Saat diaktifkan, stok dikurangi dari gudang sebelum rak toko
workspace-terminal-prefs-heading = Preferensi Terminal
workspace-terminal-sound = Volume Suara
workspace-terminal-dark-mode = Mode Gelap
workspace-terminal-scale-zero = Nolkan Otomatis Timbangan Saat Boot

# ── Store Info Card (ADR #22 Phase 2) ──
workspace-store-info-heading = Info Toko
workspace-store-info-name = Nama
workspace-store-info-address = Alamat
workspace-store-info-branch = Cabang
workspace-store-info-currency = Mata Uang
workspace-store-info-tax-id = NPWP

# ── Topology Editor (ADR #22 Phase 2) ──
workspace-type-selector-label = Tipe Workspace

# ── Phase 3 workspace nav items ──

# ── Workspace Settings Modal (ADR #22 Phase 4) ──
workspace-modal-title = Pengaturan Workspace
workspace-modal-admin-settings = Admin Settings ↗
workspace-modal-close-aria = Tutup pengaturan
workspace-modal-role-manager = Manajer
workspace-modal-role-staff = Staf
workspace-modal-role-auditor = Auditor

# ── 4f: Workspace card aria-labels ──
terminal-sound-volume-aria = Volume suara
workspace-kds-yellow-threshold-aria = Ambang batas eskalasi kuning dalam menit
workspace-kds-red-threshold-aria = Ambang batas eskalasi merah dalam menit

terminal-feature-group-sales = Penjualan
terminal-feature-group-payments = Pembayaran
terminal-feature-group-inventory-products = Inventaris & Produk
terminal-feature-group-hardware = Perangkat Keras
terminal-feature-group-staff-security = Staf & Keamanan
terminal-feature-group-system = Sistem

# Exit survey (§7 churn prevention)
exit-survey-title = Sebelum Anda jeda...
exit-survey-message = Bantu kami berkembang — apa alasan utama Anda menjeda langganan?
exit-survey-reason-price = Terlalu mahal
exit-survey-reason-features = Fitur tidak cukup
exit-survey-reason-competitor = Beralih ke kompetitor
exit-survey-reason-closed = Usaha ditutup
exit-survey-reason-break = Istirahat sementara
exit-survey-reason-other = Lainnya
exit-survey-other-placeholder = Ceritakan lebih lanjut...
exit-survey-cancel = Kembali
exit-survey-submit = Jeda langganan

# ── Add-on Marketplace (C4.3) ─────────────────────────────────────
addon-marketplace-title = Tambahan
addon-marketplace-subtitle = Perluas paket Anda dengan fitur tambahan
addon-marketplace-empty = Tidak ada tambahan yang tersedia untuk paket Anda saat ini.
addon-purchase-button = Tambah
addon-owned-badge = Aktif
addon-analytics-name = Analitik Lanjutan
addon-analytics-desc = Buka laporan penjualan detail, analisis tren, dan rentang tanggal kustom di paket Plus.
addon-support-name = Dukungan Prioritas
addon-support-desc = Dapatkan waktu respons lebih cepat dan dukungan khusus dari tim kasir.mu.
addon-storage-name = Penyimpanan Cloud Tambahan
addon-storage-desc = Tingkatkan kuota penyimpanan cloud sync untuk katalog produk yang lebih besar dan riwayat lebih panjang.
addon-hal-name = Driver HAL Kustom
addon-hal-desc = Muat dan gunakan driver abstraction layer hardware kustom untuk perangkat POS khusus.

// ── API Lokal (Pengaturan → API Lokal) ────────────────────────────
settings-section-local-api = API Lokal
settings-local-api-intro = Jalankan skrip Anda sendiri ke mesin kasir ini melalui HTTP. Server hanya mendengarkan di komputer ini (127.0.0.1) dan mati secara default.
settings-local-api-enabled = Aktifkan API Lokal
settings-local-api-port = Port
settings-local-api-port-apply = Terapkan
settings-local-api-port-invalid = Port harus antara 1024 dan 65535.
settings-local-api-port-applied = Port diperbarui.
settings-local-api-port-failed = Gagal mengubah port.
settings-local-api-store = Toko yang dilayani
settings-local-api-store-primary = utama
settings-local-api-store-hint = Skrip hanya melihat data satu toko. Beralih akan merestart server dengan basis data toko terpilih.
settings-local-api-store-changed = Sekarang melayani toko terpilih.
settings-local-api-store-failed = Gagal beralih toko yang dilayani.
settings-local-api-start-failed = Gagal menjalankan server API lokal.
settings-local-api-toggle-failed = Gagal mengubah pengaturan API Lokal.
settings-local-api-stopped = API Lokal mati. Aktifkan untuk menjalankan server di komputer ini; skrip kemudian menggunakan URL dasar yang tampil di sini.
settings-local-api-token-label = Nama skrip
settings-local-api-token-label-placeholder =
    .placeholder = integrasi-saya
settings-local-api-generate = Buat Token
settings-local-api-token = Token API
settings-local-api-token-hint = Token memberikan akses baca ke semua data lokal selama 30 hari. Penulisan data master memerlukan kunci operator tambahan — lihat docs/guides/EXTENDING.md.
settings-local-api-token-expires = Kedaluwarsa { $expires }
settings-local-api-copy-url = Salin URL
settings-local-api-copy-token = Salin
settings-local-api-url-copied = URL dasar disalin.
settings-local-api-token-copied = Token disalin.
settings-local-api-copy-failed = Gagal menyalin — pilih teksnya secara manual.
settings-local-api-mint-failed = Gagal membuat token.
settings-local-api-rotate = Ganti rahasia
settings-local-api-rotate-warning = Mengganti rahasia langsung membuat semua token yang dibuat tidak berlaku dan mengubah kunci operator. Skrip memerlukan token baru.
settings-local-api-rotate-confirm = Konfirmasi penggantian
settings-local-api-rotate-cancel = Batal
settings-local-api-rotate-done = Rahasia penanda tangan diganti — buat token baru untuk skrip Anda.
settings-local-api-rotate-failed = Gagal mengganti rahasia penanda tangan.

# Settings section scope badges (todo-global-saas-1.md §H)
settings-scope-organization = Organisasi
settings-scope-legal-entity = Badan Hukum
settings-scope-location = Lokasi
settings-scope-workspace = Ruang Kerja
settings-scope-terminal = Perangkat Terminal

# ── Konfigurasi regional (regional slice 3, layar Business Defaults) ──
settings-regional-title = Regional
settings-regional-subtitle = Fakta pasar yang dijawab lokasi ini untuk nota dan laporan. Kolom kosong mewarisi dari badan hukum atau default organisasi.
settings-regional-locale = Locale (BCP-47)
settings-regional-locale-placeholder = mis. id-ID — kosongkan untuk mewarisi
settings-regional-currency = Mata uang (ISO-4217)
settings-regional-currency-placeholder = mis. IDR — kosongkan untuk mewarisi
settings-regional-currency-inherit = Warisi (tingkat di atas)
settings-regional-timezone = Zona waktu
settings-regional-timezone-inherit = Warisi (tingkat di atas)
settings-regional-timezone-utc = UTC (sentinel lama)
settings-regional-timezone-legacy = nilai lama
settings-regional-country = Anchor pasar (ISO-3166)
settings-regional-country-placeholder = mis. ID — kosongkan untuk tidak mengubah entitas
settings-regional-country-hint = Diresolusikan melalui badan hukum lokasi.
settings-regional-save = Simpan default regional
settings-regional-saving = Menyimpan…
settings-regional-saved = Default regional tersimpan.
settings-regional-error-save = Tidak dapat menyimpan default regional.
settings-regional-error-load = Tidak dapat memuat default regional.
settings-regional-no-location = Belum ada lokasi untuk dikonfigurasi.
settings-regional-scope-location = Diatur di lokasi ini
settings-regional-scope-legal-entity = Diwarisi dari badan hukum
settings-regional-scope-organization = Default organisasi
settings-regional-scope-built-in = Default bawaan

# ── Metode pembayaran lokal (regional slice 6, layar Business Defaults) ──
settings-localpay-title = Metode pembayaran lokal
settings-localpay-subtitle = Jalur pembayaran yang tersedia di pasar dan lokasi ini.
settings-localpay-code-placeholder = kode jalur, mis. qris
settings-localpay-code-label = Kode jalur
settings-localpay-label-placeholder = label tampilan, mis. QRIS
settings-localpay-label-label = Label tampilan
settings-localpay-add = Tambah jalur
settings-localpay-save = Simpan metode pembayaran
settings-localpay-saving = Menyimpan…
settings-localpay-saved = Metode pembayaran tersimpan.
settings-localpay-static-qr-label = Muatan QR statis (string EMVCo)
settings-localpay-error-save = Tidak dapat menyimpan metode pembayaran.
settings-localpay-error-load = Tidak dapat memuat metode pembayaran.
settings-localpay-no-location = Belum ada lokasi untuk dikonfigurasi.
settings-localpay-empty-list = Belum ada jalur yang dicatat — tambahkan yang ditawarkan lokasi ini.
settings-localpay-scope-location = Diatur di lokasi ini
settings-localpay-scope-legal-entity = Default pasar (badan hukum)


# ── Diagnostik (hasil ketersediaan fitur) ──
settings-diagnostics-title = Diagnostik
settings-diagnostics-intro = Mengapa setiap fitur tersedia atau terkunci untuk Anda saat ini — gerbang yang sama yang diterapkan aplikasi, dengan alasannya disebutkan. Hanya baca, bekerja offline.
settings-diagnostics-refresh = Segarkan
settings-diagnostics-load-failed = Tidak dapat memuat hasil pemeriksaan. Coba lagi.
settings-diagnostics-list-aria = Hasil pemeriksaan ketersediaan fitur
settings-diagnostics-status-available = Tersedia
settings-diagnostics-loading = …
settings-diagnostics-reason-server-policy = Diblokir kebijakan server
settings-diagnostics-reason-lifecycle = Langganan berakhir
settings-diagnostics-reason-tier = Tidak termasuk paket ini
settings-diagnostics-reason-quota = Kuota tercapai
settings-diagnostics-reason-role = Peran tidak memiliki izin
settings-diagnostics-reason-scope = Di luar cakupan lokasi
settings-diagnostics-feature-supports-qris = Pembayaran QRIS
settings-diagnostics-feature-supports-analytics = Analitik
settings-diagnostics-feature-supports-loyalty = Loyalitas
settings-diagnostics-feature-supports-daily-dashboard = Dasbor harian
settings-diagnostics-feature-supports-cloud-sync = Sinkronisasi awan
settings-diagnostics-feature-sales-history-days = Masa simpan riwayat penjualan
settings-diagnostics-feature-locations = Kuota lokasi
settings-diagnostics-feature-staff-users = Kuota akun staf
settings-diagnostics-feature-pos-instances = Kuota terminal POS
settings-diagnostics-feature-warehouses = Kuota titik stok gudang
settings-diagnostics-detail-tier = Paket: { $tier }
settings-diagnostics-detail-state = Status: { $state }
settings-diagnostics-detail-quota = Pemakaian: { $usage } / { $limit }
settings-diagnostics-detail-permission = Izin: { $permission }
settings-diagnostics-detail-scope-covered = Mencakup lokasi ini
settings-diagnostics-detail-scope-not-covered = Tidak mencakup lokasi ini
settings-diagnostics-detail-expires = Kedaluwarsa: { $expiresAt }
settings-diagnostics-detail-grace = Tenggang hingga: { $graceUntil }
settings-diagnostics-deployment-version = Versi aplikasi: { $version }


# ── Format struk (receipt-format axis, layar Business Defaults) ──
settings-rcptfmt-title = Format struk
settings-rcptfmt-subtitle = Bagaimana struk dicetak di lokasi ini.
settings-rcptfmt-content-label = Konten wajib
settings-rcptfmt-content-none = Belum ada konten pasar yang dikonfigurasi.
settings-rcptfmt-paper-width = Lebar kertas (mm, 20–120)
settings-rcptfmt-margin-top = Margin atas (mm)
settings-rcptfmt-margin-bottom = Margin bawah (mm)
settings-rcptfmt-show-table = Tampilkan nomor meja
settings-rcptfmt-show-logo = Cetak logo toko
settings-rcptfmt-save = Simpan format struk
settings-rcptfmt-saving = Menyimpan…
settings-rcptfmt-saved = Format struk tersimpan.
settings-rcptfmt-error-save = Tidak dapat menyimpan format struk.
settings-rcptfmt-error-load = Tidak dapat memuat format struk.
settings-rcptfmt-no-location = Belum ada lokasi untuk dikonfigurasi.
settings-rcptfmt-source-legal-entity = Wajib pasar (badan hukum)
settings-rcptfmt-source-terminal = Diatur di terminal ini
settings-rcptfmt-source-workspace = Diatur di lokasi ini
settings-rcptfmt-source-legacy = Diwarisi dari default toko
settings-rcptfmt-source-unset = Belum dikonfigurasi
settings-rcptfmt-element-store_name = Nama toko
settings-rcptfmt-element-store_address = Alamat toko
settings-rcptfmt-element-tax_id = NPWP
settings-rcptfmt-element-date = Tanggal
settings-rcptfmt-element-receipt_number = Nomor struk
settings-rcptfmt-element-items = Item
settings-rcptfmt-element-subtotal = Subtotal
settings-rcptfmt-element-tax = Pajak
settings-rcptfmt-element-total = Total
settings-rcptfmt-element-payments = Pembayaran
# W2-C: editor konten wajib (set_receipt_content_for_entity)
settings-rcptfmt-footer-text = Teks footer
settings-rcptfmt-show-tax = Cetak baris pajak
settings-rcptfmt-show-currency = Awalan simbol mata uang
settings-rcptfmt-decimal-separator = Pemisah desimal
settings-rcptfmt-sep-dot = Titik (1.234,56)
settings-rcptfmt-sep-comma = Koma (1.234,56)
settings-rcptfmt-sep-none = Tanpa
settings-rcptfmt-required-fields = Elemen wajib pasar
settings-rcptfmt-content-save = Simpan konten wajib
settings-rcptfmt-content-saving = Menyimpan…
settings-rcptfmt-content-saved = Konten wajib tersimpan.
settings-rcptfmt-content-error-save = Tidak dapat menyimpan konten wajib.
settings-rcptfmt-content-note = Ditulis pada lapisan wajib pasar (badan hukum) — berlaku untuk semua lokasi badan hukum ini.

# ── Penomoran resmi (W2-B, sumbu penomoran regional) ──
settings-fiscalnum-title = Penomoran resmi
settings-fiscalnum-subtitle = Deret nomor yang dipakai tiap badan hukum menerbitkan dokumen resminya.
settings-fiscalnum-label-entity = Badan hukum
settings-fiscalnum-label-kind = Jenis dokumen
settings-fiscalnum-kind-receipt = Struk
settings-fiscalnum-kind-invoice = Faktur
settings-fiscalnum-label-prefix = Awalan
settings-fiscalnum-label-padding = Digit nol di depan
settings-fiscalnum-label-period = Reset
settings-fiscalnum-period-never = Tidak pernah
settings-fiscalnum-period-daily = Harian
settings-fiscalnum-period-monthly = Bulanan
settings-fiscalnum-period-yearly = Tahunan
settings-fiscalnum-current-value = Nomor terakhir terbit: { $value }
settings-fiscalnum-current-value-note = Mengubah awalan, digit nol, atau periode tidak pernah mereset penghitung ini.
settings-fiscalnum-unset = Pasangan ini belum punya deret — menyimpan akan memulainya dari nol.
settings-fiscalnum-no-entity = Belum ada badan hukum untuk menomori dokumen.
settings-fiscalnum-save = Simpan deret
settings-fiscalnum-saved = Deret tersimpan
settings-fiscalnum-error-load = Gagal membaca deret nomor.
settings-fiscalnum-error-save = Gagal menyimpan deret nomor.
settings-fiscalnum-overview-title = Semua deret terdaftar
settings-fiscalnum-overview-empty = Belum ada deret terdaftar — simpan satu di atas untuk melihatnya di sini.
settings-fiscalnum-overview-col-entity = Badan hukum
settings-fiscalnum-overview-col-kind = Jenis dokumen
settings-fiscalnum-overview-col-prefix = Awalan
settings-fiscalnum-overview-col-current = Nomor terakhir
settings-fiscalnum-overview-col-updated = Diperbarui


