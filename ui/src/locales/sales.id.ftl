sales-report-date-range = Rentang Tanggal
sales-report-apply = Terapkan
sales-report-export-pdf = Ekspor PDF

# ── Shortfall Resolution ──
shortfall-dialog-aria = Resolusi stok tidak mencukupi
shortfall-title = Stok Tidak Mencukupi
shortfall-description = Beberapa item tidak memiliki stok yang cukup di lokasi utama. Pilih sumber alternatif di bawah.
shortfall-wanted = Dibutuhkan
shortfall-available = Tersedia
shortfall-alternatives-label = Lokasi alternatif:
shortfall-alt-available = tersedia
shortfall-split-qty-aria =
    .aria-label = Jumlah dari lokasi ini
shortfall-simple-mode = Gunakan satu lokasi
shortfall-split-mode = Bagi antar lokasi
shortfall-no-alternatives = Tidak ada lokasi alternatif dengan stok tersedia.
shortfall-negative-override = Izinkan stok negatif (Override PIN Manajer)
shortfall-warehouse-warning = ⚠ Pemenuhan gudang mungkin dikenakan biaya pengiriman.
shortfall-cancel-btn = Batalkan Penjualan
shortfall-confirm-btn = Konfirmasi &amp; Lanjutkan
payment-shortfall-cancelled = Penjualan dibatalkan karena stok tidak mencukupi.

pos-cart-empty = Keranjang kosong
pos-tax = Pajak
pos-hold = Tahan
pos-cart-remove = Hapus
pos-cart-title = Penjualan Saat Ini
pos-cart-panel-title = Penjualan Saat Ini
pos-cart-panel-title-order = Pesanan Saat Ini
pos-cart-deducting-label = Mengurangkan: { $name }
pos-cart-deduction-badge-aria = Mengurangkan dari { $name }
pos-cart-unbound-error = Keranjang tidak memiliki lokasi pengurangan — tidak dapat menambahkan item
pos-cart-lock = Kunci
pos-cart-subtotal = Subtotal
pos-cart-discount-label = Diskon ({ $label })
pos-cart-add-discount = + Tambah Diskon
pos-cart-add-promotion = + Promosi
pos-cart-pct-placeholder =
    .placeholder = %
pos-cart-label-placeholder =
    .placeholder = Label (opsional)
pos-cart-apply = Terapkan
pos-cart-cancel = Batal
pos-cart-clear = Bersihkan
pos-cart-hold = Tahan
pos-cart-undo = Urungkan
pos-login-required = Perlu Login
pos-login-desc = Silakan masuk untuk menggunakan POS.
pos-shift-loading = Memuat shift…
pos-shift-no-active = Tidak ada shift aktif
pos-shift-elapsed = { $h ->
    [0] { $m }mnt
   *[other] { $h }j { $m }mnt
}
pos-hold-title = Tahan Pesanan Saat Ini
pos-hold-desc = Masukkan nama untuk pesanan yang ditahan agar dapat ditemukan nanti.
pos-hold-cancel = Batal
pos-hold-confirm = Tahan Pesanan
pos-close-shift-title = Tutup Shift
pos-close-shift-opened = Dibuka
pos-close-shift-opening-balance = Saldo awal
pos-close-shift-counted-label = Hitung uang tunai di laci (unit minor)
pos-close-shift-counted-placeholder =
    .placeholder = mis. 15000 untuk Rp150.000
pos-close-shift-notes-label = Catatan (opsional)
pos-close-shift-notes-placeholder =
    .placeholder = Catatan tentang shift ini…
pos-close-shift-confirm = Tutup Shift
pos-close-shift-closing = Menutup…
pos-open-shift-title = Buka Shift
pos-open-shift-balance-label = Saldo awal (unit minor)
pos-open-shift-balance-placeholder =
    .placeholder = mis. 500 untuk Rp5.000
pos-open-shift-opening = Membuka…
pos-shift-closed-title = Shift Ditutup
pos-shift-total-sales = Total Penjualan
pos-shift-cash-sales = Penjualan Tunai
pos-shift-card-sales = Penjualan Kartu
pos-shift-expected-cash = Tunai Diharapkan
pos-shift-counted = Dihitung
pos-shift-difference = Selisih
pos-shift-over = Lebih
pos-shift-short = Kurang
pos-shift-notes = Catatan
pos-shift-summary-done = Selesai

payment-title = Pembayaran
payment-table-number = Meja { $number }
    .aria-label = Nomor meja
payment-cash = Tunai
payment-other = Lainnya
payment-amount-tendered = Jumlah Dibayar
payment-processing = Memproses…
payment-qris-scan = Pindai dengan aplikasi QRIS
payment-qris-waiting = Menunggu konfirmasi pembayaran…
payment-qris-dialog-aria = Pembayaran QR QRIS
payment-qris-close-aria = Tutup pembayaran QR
payment-qris-qr-aria = Kode QR
payment-qris-waiting-aria = Menunggu pembayaran
payment-qris-confirmed-aria = Pembayaran dikonfirmasi
payment-qris-confirmed = Pembayaran dikonfirmasi!
payment-qris-amount = Jumlah
payment-qris-reference = Referensi
payment-qris-merchant = Pedagang
payment-qris-merchant-name = OZ-POS Store

# Price Override Modal
price-override-dialog-aria = Override harga
price-override-close-aria = Tutup
price-override-title = Override Harga
price-override-current-label = Harga saat ini
price-override-new-label = Harga baru (dalam unit minor)
price-override-new-aria = Masukkan harga baru dalam unit minor
price-override-cancel = Batal
price-override-next = Lanjut
price-override-back = Kembali
price-override-username-label = Masukkan username manajer
price-override-username-placeholder = Username
price-override-username-aria = Username manajer
price-override-pin-label = Masukkan PIN manajer
price-override-pin-aria = Entri PIN
price-override-pin-dots-aria = Entri PIN: { $count } dari { $max } digit
price-override-keypad-aria = Papan angka
price-override-clear = Hapus
price-override-backspace-aria = Backspace
price-override-verifying = Memverifikasi…
price-override-error-zero = Harga harus lebih besar dari 0
price-override-error-max = Harga melebihi 10x harga saat ini. Maksimum yang diizinkan adalah { $max }.
price-override-pin-failed = Verifikasi PIN gagal

orders-title = Pesanan
orders-search = Cari pesanan…
orders-status-filter = Status
orders-status-all = Semua
orders-status-completed = Selesai
orders-status-voided = Dibatalkan
orders-void = Batalkan Pesanan
orders-reason = Alasan
orders-void-success = Pesanan dibatalkan

pos-cart-line-aria = { $sku }, { $qty } × { $amount }
pos-cart-line-decrease-aria = Kurangi jumlah { $sku }
pos-cart-line-qty-aria = Jumlah: { $qty }
pos-cart-line-increase-aria = Tambah jumlah { $sku }
pos-cart-line-remove-aria = Hapus { $sku } dari keranjang
pos-cart-line-swipe-remove-aria = Hapus { $sku }
pos-cart-line-override = Timpa
pos-cart-line-override-aria = Timpa harga untuk { $name }

# POS Cart Panel
pos-cart-panel-aria = Keranjang

# Cart course firing
pos-cart-course-fire-aria = Kirim { $label } ({ $count } item)
pos-cart-course-btn--all = Kirim Semua

# POS Cart Actions
pos-cart-table-aria = Nomor meja
pos-cart-options-collapse-aria = Tutup opsi
pos-cart-options-expand-aria = Buka opsi
pos-cart-discount-pct-aria = Persentase diskon
pos-cart-discount-label-aria = Label diskon
pos-cart-discount-remove-aria = Hapus diskon
pos-cart-discount-cancel-aria = Batal diskon
pos-cart-promotion-remove-aria = Hapus promosi { $name }
pos-cart-clear-aria = Kosongkan semua item dari keranjang
pos-cart-charge-aria = Tagih pelanggan
pos-cart-open-bill-aria = Simpan sebagai tagihan terbuka
pos-cart-open-bills-aria = Lihat tagihan terbuka
pos-cart-undo-btn = Urungkan
pos-cart-undo-dismiss-aria = Tutup notifikasi urungkan
pos-dismiss-error-aria = Tutup kesalahan

# POS Shift Overlays
pos-close-shift-overlay-aria = Tutup shift
pos-close-shift-balance-aria = Saldo akhir dalam unit minor
pos-close-shift-notes-aria = Catatan shift
pos-close-shift-summary-aria = Ringkasan shift ditutup
pos-open-shift-overlay-aria = Buka shift
pos-open-shift-balance-aria = Saldo awal dalam unit minor

# POS Open Bill
pos-open-bill-overlay-aria = Tagihan terbuka
pos-open-bills-overlay-aria = Daftar tagihan terbuka
pos-open-bill-desc = Masukkan nama pelanggan untuk tagihan terbuka ini.
pos-open-bill-placeholder = mis. John Doe
pos-open-bill-name-aria = Nama pelanggan
pos-open-bill-saving = Menyimpan…
pos-open-bill-save = Simpan Tagihan Terbuka
pos-open-bills-title = Tagihan Terbuka
pos-open-bills-close-aria = Tutup daftar tagihan terbuka
pos-open-bills-empty = Tidak ada tagihan terbuka.
pos-open-bills-resume = Lanjutkan

# Appearance Preview (White-label)
pos-cart-tip-label = Tambah Tip
pos-cart-tip-none = Tidak Ada
pos-cart-tip-aria = Pilihan tip
pos-cart-tip-segment-aria = Atur tip ke { $percent } persen
pos-cart-tip-segment-zero-aria = Tanpa tip
pos-cart-tip-line = Tip ({ $percent }%)
pos-cart-service-toggle-label = Tambah { $percent }% biaya layanan
pos-cart-service-toggle-aria = Aktifkan/nonaktifkan biaya layanan
pos-cart-service-line = Layanan ({ $percent }%)
pos-cart-undo-dismiss = Tutup
pos-cart-open-bill = Tagihan Terbuka
pos-cart-open-bills = Tagihan Terbuka
pos-cart-table-label = Meja #
pos-cart-table-placeholder = No.
pos-shift-close-btn = Tutup
pos-shift-open-btn = Buka
sales-history-title = Riwayat Penjualan
sales-history-loading = Memuat penjualan…
sales-history-error-load = Gagal memuat riwayat penjualan
sales-history-empty = Belum ada penjualan tercatat
sales-history-empty-filtered = Tidak ada penjualan yang cocok dengan filter Anda
# C1.2: jendela riwayat 3 bulan paket Free diterapkan — ajakan tingkatkan paket.
sales-history-cap-teaser = Lihat riwayat penjualan lebih dari 3 bulan — tingkatkan ke Plus
sales-history-cap-upgrade-cta = Tingkatkan
sales-history-count = { $count } penjualan
sales-history-page-info = Halaman { $current } dari { $total }
sales-history-col-id = ID Penjualan
sales-history-col-date = Tanggal
sales-history-col-total = Total
sales-history-col-items = Item
sales-history-col-status = Status
sales-history-col-payment = Pembayaran
sales-history-col-cashier = Kasir
sales-history-view-aria = Lihat { $id }
sales-history-void-aria = Batalkan pesanan { $id }
sales-history-detail-title = Detail Penjualan
sales-history-detail-close = Tutup
sales-history-detail-print = Cetak Ulang Nota
sales-history-detail-id = ID
sales-history-detail-date = Tanggal
sales-history-detail-status = Status
sales-history-detail-payment = Pembayaran
sales-history-detail-cashier = Kasir
sales-history-detail-subtotal = Subtotal
sales-history-detail-tax = Pajak
sales-history-detail-total = Total
sales-history-lines-title = Item Baris
sales-history-line-sku = SKU
sales-history-line-name = Nama
sales-history-line-qty = Jml
sales-history-line-unit-price = Harga Satuan
sales-history-line-total = Total
sales-history-line-cost = HPP
sales-history-line-margin = Margin
sales-history-line-margin-pct = Margin %
sales-history-line-tax = Pajak
sales-history-status-all = Semua
sales-history-status-completed = Selesai
sales-history-status-pending = Tertunda
sales-history-status-cancelled = Batal
sales-history-status-voided = Dibatalkan
sales-history-export-csv = Ekspor CSV
sales-history-search-label = Cari
sales-history-status-label = Status
sales-history-from-label = Dari
sales-history-to-label = Ke
sales-history-cashier-label = Kasir
sales-history-cashier-all = Semua Kasir
sales-history-clear-filters = Hapus filter
sales-history-prev-page = ← Sebelumnya
sales-history-next-page = Berikutnya →
sales-history-per-page-label = Per halaman
sales-history-void-title = Batalkan Pesanan
sales-history-void-desc = Ini akan membatalkan pesanan { $id } sebesar { $amount } dan mengembalikan stok. Tindakan ini tidak dapat dibatalkan.
sales-history-void-reason-label = Alasan pembatalan
sales-history-void-cancel = Batal
sales-history-void-confirm = Konfirmasi Pembatalan
sales-history-void-progress = Membatalkan…
sales-history-action-view = Lihat
sales-history-action-void = Batalkan
sales-history-void-reason-placeholder =
    .placeholder = mis. Pembatalan pelanggan
sales-history-void-default-reason = Dibatalkan dari riwayat penjualan
sales-history-void-error = Gagal membatalkan pesanan
sales-history-export-id = ID Penjualan
sales-history-export-date = Tanggal
sales-history-export-total = Total
sales-history-export-items = Item
sales-history-export-status = Status
sales-history-export-payment = Pembayaran
sales-history-export-cashier = Kasir
sales-history-export-sku = SKU
sales-history-export-product = Produk
sales-history-export-qty = Qty
sales-history-export-unit-price = Harga Satuan
sales-history-export-unit-cost = HPP Satuan
sales-history-export-line-margin = Margin Baris
sales-history-export-margin-pct = Margin %
sales-history-exporting = Mengekspor…
sales-history-pull-to-refresh = Tarik ke bawah untuk memperbarui
sales-history-release-to-refresh = Lepaskan untuk memperbarui

# ── Sales Dashboard ──
sales-dashboard-title = Dasbor Penjualan
sales-dashboard-daily-total = Total Harian
sales-dashboard-total-sales = Total Penjualan
sales-dashboard-total-items = Total Item
sales-dashboard-hourly-title = Penjualan Per Jam
sales-dashboard-no-data = Tidak ada data hari ini
sales-dashboard-revenue-title = Pendapatan (14h)
sales-dashboard-category-title = Berdasarkan Kategori
sales-dashboard-heatmap-title = Jam Tersibuk
sales-dashboard-region-aria = Dasbor pelaporan
sales-dashboard-grid-aria = Widget dasbor
sales-dashboard-daily-aria = Ringkasan penjualan harian
sales-dashboard-hourly-aria = Penjualan per jam
sales-dashboard-hourly-bars-aria = Grafik penjualan per jam
sales-dashboard-category-aria = Rincian kategori
sales-dashboard-heatmap-aria = Peta panas penjualan per jam
sales-dashboard-chart-other = Lainnya
sales-dashboard-revenue-aria = Grafik pendapatan 14 hari
sales-dashboard-revenue-summary = Grafik pendapatan 14 hari: { $total } total dari { $days } hari
sales-dashboard-category-summary = Rincian kategori: { $count } kategori
sales-dashboard-heatmap-summary = Peta panas penjualan per jam: { $count } slot waktu aktif

# ── Void Orders ──
void-orders-title = Pesanan
void-orders-search-placeholder =
    .placeholder = Cari berdasarkan ID pesanan atau metode pembayaran…
void-orders-search-aria =
    .aria-label = Cari pesanan
void-orders-filter-status-aria =
    .aria-label = Saring berdasarkan status
void-orders-status-all = Semua
void-orders-status-active = Aktif
void-orders-status-completed = Selesai
void-orders-status-voided = Dibatalkan
void-orders-status-pending = Tertunda
void-orders-loading = Memuat pesanan…
void-orders-retry = Coba Lagi
void-orders-empty-filtered = Tidak ada pesanan yang cocok dengan filter saat ini.
void-orders-empty-none = Belum ada pesanan tercatat.
void-orders-table-aria =
    .aria-label = Pesanan
void-orders-col-order-id = ID Pesanan
void-orders-col-date = Tanggal
void-orders-col-status = Status
void-orders-col-total = Total
void-orders-col-items = Item
void-orders-col-payment = Pembayaran
void-orders-col-actions = Tindakan
void-orders-col-actions-aria =
    .aria-label = Tindakan
void-orders-view-aria =
    .aria-label = Lihat pesanan { $id }
void-orders-view = Lihat
void-orders-void-aria =
    .aria-label = Batalkan pesanan { $id }
void-orders-void = Batalkan
void-orders-back-aria =
    .aria-label = Kembali ke daftar pesanan
void-orders-back = Kembali ke Pesanan
void-orders-not-found = Pesanan tidak ditemukan.
void-orders-go-back = Kembali
void-orders-detail-heading = Pesanan { $id }
void-orders-meta-date = Tanggal
void-orders-meta-payment = Pembayaran
void-orders-meta-total = Total
void-orders-meta-items = Item
void-orders-line-items-title = Item Baris
void-orders-line-items-aria =
    .aria-label = Item baris pesanan
void-orders-line-sku = SKU
void-orders-line-name = Nama
void-orders-line-qty = Jml
void-orders-line-unit-price = Harga Satuan
void-orders-line-total = Total
void-orders-void-section-title = Batalkan Pesanan
void-orders-void-description = Ini akan membatalkan pesanan, mengembalikan pembayaran, dan mengembalikan stok ke inventaris.
void-orders-reason-label = Alasan pembatalan
void-orders-reason-select = Pilih alasan…
void-orders-reason-placeholder =
    .placeholder = Masukkan alasan pembatalan…
void-orders-reason-aria =
    .aria-label = Alasan pembatalan kustom
void-orders-cancel = Batal
void-orders-confirm-voiding = Membatalkan…
void-orders-confirm = Konfirmasi Pembatalan
void-orders-voided-notice = Pesanan ini telah dibatalkan.
void-orders-error-load = Gagal memuat pesanan
void-orders-error-reason = Silakan pilih atau masukkan alasan pembatalan
void-orders-error-void = Gagal membatalkan pesanan
void-orders-success-voided = Pesanan berhasil dibatalkan. Stok telah dikembalikan.
void-orders-reason-cancelled = Dibatalkan oleh pelanggan
void-orders-reason-wrong-items = Item yang salah dipindai
void-orders-reason-duplicate = Pesanan duplikat
void-orders-reason-price-dispute = Sengketa harga
void-orders-reason-payment-issue = Masalah pembayaran
void-orders-reason-changed-mind = Pelanggan berubah pikiran
void-orders-reason-manager-override = Kewenangan manajer
void-orders-reason-other = Alasan lain…

# ── Refund ──
refund-title = Proses Pengembalian Dana
refund-done-title = Pengembalian Dana Diproses
refund-done-amount = Dikembalikan: { $amount }
refund-done = Selesai
refund-dialog-aria = Proses pengembalian dana
refund-close-aria =
    .aria-label = Batal pengembalian dana
refund-sale-id = Penjualan: { $id }
refund-sale-total = Total: { $amount }
refund-sale-date = Tanggal: { $date }
refund-items-title = Pilih Item untuk Dikembalikan
refund-item-aria =
    .aria-label = Kembalikan { $sku }
refund-qty-decrease-aria =
    .aria-label = Kurangi jumlah pengembalian
refund-qty-increase-aria =
    .aria-label = Tambah jumlah pengembalian
refund-reason-label = Alasan *
refund-reason-placeholder =
    .placeholder = mis. Pelanggan berubah pikiran
refund-reason-aria = Alasan pengembalian
refund-note-label = Catatan (internal)
refund-note-placeholder =
    .placeholder = Catatan internal opsional
refund-note-aria = Catatan pengembalian
refund-total-label = Total Pengembalian
refund-cancel = Batal
refund-submit = Proses Pengembalian Dana
refund-error = Pengembalian dana gagal

# Sales History Refund Line Items
refund-previous-refunds = Pengembalian Sebelumnya
refund-line-sku = SKU
refund-line-qty = Jml
refund-line-total = Total
refund-action-refund = Kembalikan

# Item Modifier Modal
modifier-no-options = Tidak ada opsi tersedia
modifier-free = Gratis
modifier-base-price = Harga dasar
modifier-addons = Tambahan
modifier-total = Total
modifier-add-to-cart = Tambah ke Keranjang
modifier-dialog-aria = Sesuaikan { $productName }

# ── EOD Report ──
eod-title = Laporan Akhir Hari
eod-cashier-shifts = Shift Kasir
eod-shift-active = Shift sedang berlangsung
eod-shift-active-since = Shift aktif sejak
eod-opening-balance = Saldo awal
eod-sales-this-shift = Penjualan shift ini
eod-closed-shifts = Shift Ditutup Hari Ini
eod-col-opened = Dibuka
eod-col-closed = Ditutup
eod-col-opening = Awal
eod-col-counted = Dihitung
eod-col-expected = Diharapkan
eod-col-diff = Selisih
eod-total = Total
eod-tag-over = Lebih
eod-tag-short = Kurang
eod-cash-reconciliation = Rekonsiliasi Tunai
eod-cash-total-opening = Total awal
eod-cash-total-counted = Total dihitung
eod-cash-total-expected = Total diharapkan
eod-cash-net-diff = Selisih bersih
eod-refresh = Segarkan
eod-refresh-aria = Segarkan laporan
eod-printing = Mencetak…
eod-print = Cetak
eod-print-aria = Cetak laporan EOD
eod-error = { $error }
eod-error-fallback = Gagal memuat laporan
eod-retry = Coba Lagi
eod-empty-title = Tidak ada data penjualan untuk hari ini.
eod-empty-sub = Penjualan akan muncul di sini setelah transaksi selesai.
eod-kpi-revenue = Total Pendapatan
eod-kpi-revenue-sub = { $count } penjualan selesai
eod-kpi-average = Rata-rata Penjualan
eod-kpi-average-sub = per transaksi
eod-kpi-voids = Pembatalan
eod-kpi-voids-sub = { $amount } dibatalkan
eod-kpi-discounts = Diskon Diterapkan
eod-kpi-discounts-sub = { $count } penjualan dengan diskon
eod-kpi-discounts-none = Tidak ada diskon diterapkan
eod-payment-breakdown = Rincian Pembayaran
eod-payment-empty = Tidak ada data pembayaran
eod-payment-count = { $count } transaksi
eod-payment-bar-aria = { $method }: { $pct }% dari pendapatan
eod-hourly-title = Penjualan Per Jam
eod-hourly-empty = Tidak ada data per jam
eod-hourly-chart-aria = Grafik batang penjualan per jam
eod-hour-bar-aria-sales = { $hour }:00 — { $count } penjualan, { $amount }
eod-hour-bar-aria-none = { $hour }:00 — Tidak ada penjualan
eod-summary-title = Ringkasan Hari Ini
eod-summary-completed = Penjualan Selesai
eod-summary-revenue = Total Pendapatan
eod-summary-voided-sales = Penjualan Dibatalkan
eod-summary-voided-value = Nilai Pembatalan
eod-summary-discounts = Penjualan dengan Diskon
eod-summary-payment-methods = Metode Pembayaran Digunakan

# ── Cart ──
cart-title = Keranjang
cart-empty = Keranjang kosong
cart-line-remove = Hapus
cart-total-label = Total
sale-pay-button = Bayar
pos-cart-empty-subtitle = Ketuk item menu untuk memulai pesanan
pos-cart-pay = Tagih
pos-bundle-expanded =
    { $count ->
        [one] Bundel "{ $name }" ditambahkan — 1 item ke keranjang
       *[other] Bundel "{ $name }" ditambahkan — { $count } item ke keranjang
    }
pos-no-barcode-match = Tidak ada produk atau bundel yang cocok dengan barcode ini
pos-close-shift-cart-error = Selesaikan atau kosongkan penjualan saat ini sebelum menutup shift.
pos-close-shift-failed = Gagal menutup shift
pos-scanner-error = Kesalahan pemindai: { $detail }
pos-toast-receipt-settings-failed = Gagal memuat pengaturan nota

# ── Payment (remaining) ──
payment-dialog-aria =
    .aria-label = Pembayaran
payment-close-aria =
    .aria-label = Batal pembayaran
payment-done-title = Penjualan Selesai
payment-change-label = Kembalian
payment-done-receipt = Nota tercetak
payment-total-due = Total Tagihan
payment-currency-aria =
    .aria-label = Mata uang tagihan
payment-currency-label = Mata Uang Tagihan
payment-currency-select-aria =
    .aria-label = Pilih mata uang tagihan
payment-exchange-aria =
    .aria-label = Informasi nilai tukar
payment-exchange-rate = Nilai tukar
payment-rate-source = Sumber nilai
payment-rate-timestamp = Waktu nilai
payment-rate-source-manual = manual
payment-receipt-currency-aria =
    .aria-label = Informasi mata uang nota
payment-charged-in = Ditagih dalam
payment-default-currency = Mata uang default
payment-base-amount = Jumlah dasar
payment-charge-amount = Jumlah tagihan
payment-method-label = Metode Pembayaran
payment-method-cash = Tunai
payment-method-card = Kartu
payment-method-qris = QRIS
payment-method-credit = Kredit
payment-other-placeholder =
    .placeholder = Lainnya…
    .aria-label = Nama metode pembayaran lain
payment-tendered-input =
    .placeholder = 0,00
    .aria-label = Jumlah dibayar
payment-quick-tender-aria = Bayar { $amount }
payment-tender-exact-aria =
    .aria-label = Bayar tepat
payment-tender-exact = Tepat
payment-change = Kembalian
payment-insufficient = Jumlah tidak mencukupi
payment-qris-description = Hasilkan kode QR QRIS untuk dipindai pelanggan dengan aplikasi pembayaran mereka.
payment-qris-pay = Bayar dengan QR
payment-toast-currency-failed = Gagal memuat data mata uang
payment-toast-customers-failed = Gagal memuat pelanggan
payment-toast-loyalty-failed = Gagal memuat akun loyalitas
payment-toast-points-value-failed = Gagal memuat nilai poin
payment-toast-kds-failed = Pembayaran berhasil, tetapi tiket dapur gagal dibuat — beri tahu dapur secara manual
payment-customer-placeholder = mis. John Doe
payment-loyalty-points-aria = Poin
payment-search-customers-aria = Cari pelanggan
payment-search-customers-placeholder = Cari berdasarkan nama, telepon, atau email...
payment-split-title = Pembayaran Terpisah
payment-split-evenly = Bagi Rata
payment-split-add = + Tambah Pembagian
payment-split-method-cash = Tunai
payment-split-method-card = Kartu
payment-split-other-placeholder =
    .placeholder = Lainnya
    .aria-label = Nama metode pembayaran lain
payment-split-amount-placeholder =
    .placeholder = 0,00
    .aria-label = Jumlah pembagian
payment-split-remove-aria = Hapus pembagian
    .aria-label = Hapus pembagian
payment-split-remaining = Sisa
payment-split-toggle = Bagi pembayaran antar metode
payment-cancel = Batal
payment-open-bill = Tagihan Terbuka
payment-credit-sale = Penjualan Kredit
payment-customer-name = Nama Pelanggan
payment-customer-change = Ganti
payment-customer-select = Pilih Pelanggan
payment-customer-remove-aria = Hapus pelanggan
payment-loyalty-use-points = Gunakan Poin
payment-loyalty-points-label = Poin
payment-loyalty-discount-label = Diskon: -{ $amount }
payment-customer-search-heading = Pilih Pelanggan
payment-customer-search-empty = Tidak ada pelanggan
payment-complete = Selesaikan
payment-retry-aria =
    .aria-label = Coba lagi pembayaran
payment-retry = Coba Lagi

# ── Shift (remaining) ──
pos-open-bill-title = Tagihan Terbuka
pos-shift-close-aria = Tutup shift saat ini
pos-shift-open-aria = Buka shift baru

# ── Spinner ──

# ── Retail POS load error / retry ──
retail-load-error = Gagal memuat produk. Menampilkan data demo.
retail-load-error-unavailable = Gagal memuat produk. Periksa koneksi lalu coba lagi.
retail-load-error-retry-aria = Coba lagi memuat produk

# ── Retail POS screen ──
retail-store-name-fallback = TOKO
retail-shift-label = Shift
retail-no-shift = Tidak ada shift
retail-search-placeholder = Cari produk…
retail-search-clear-aria = Hapus pencarian
retail-no-products = Tidak ada produk
retail-no-products-match = Tidak ada produk yang cocok
retail-no-products-in-category = Tidak ada produk di kategori ini
retail-products-loading = Memuat produk…
retail-store-logo-alt = Logo toko
retail-sku-label = SKU
retail-sku-placeholder = Scan atau ketik barcode / SKU
retail-sku-go = CARI
retail-cart-items =
    { $count ->
        [one] { $count } item
       *[other] { $count } item
    }
retail-cart-header-col = #
retail-cart-header-item = Item
retail-cart-header-qty = Jml
retail-cart-header-price = @Harga
retail-cart-header-subtotal = Subtotal
retail-undo-items-removed =
    { $count ->
        [one] { $count } item dihapus
       *[other] { $count } item dihapus
    }
retail-total-discount = Diskon { $percent }%
retail-total-tax = PPN
retail-discount-button = Diskon
retail-resume-button = Lanjutkan
retail-credit-reminders = Piutang ({ $count })
retail-fn-void = Batal
retail-fn-diskon = Diskon
retail-fn-cari = Cari
retail-fn-history = Riwayat
retail-fn-pelanggan = Pelanggan
retail-fn-stok = Stok
retail-fn-shift = Shift
retail-fn-options = Opsi
retail-open-shift-opening-label = Saldo awal (Rp)
retail-open-shift-opening = Membuka…
retail-shift-closed-cash-sales = Penjualan Tunai:
retail-credit-reminders-title = Pengingat Piutang
retail-reminder-dismiss-aria = Tutup notifikasi
retail-reminder-low-stock-aria = Lihat { $count } produk stok menipis
retail-reminder-credit-aria = Lihat { $count } penjualan kredit
retail-reminder-held-cart-aria = Lihat { $count } pesanan ditahan
retail-held-cart-reminders =
    { $count ->
        [one] { $count } pesanan ditahan
       *[other] { $count } pesanan ditahan
    }
retail-credit-no-outstanding = Tidak ada piutang
retail-credit-col-customer = Pelanggan
retail-credit-col-amount = Jumlah
retail-credit-col-date = Tanggal
retail-credit-settle = Bayar
retail-clear-cart-title = Hapus Keranjang
retail-clear-cart-confirm =
    Hapus { $count ->
        [one] { $count } item dari keranjang?
       *[other] { $count } item dari keranjang?
    }
retail-clear-cart-clear = Hapus
retail-discount-title = Diskon
retail-discount-pct-tab = %
retail-discount-rp-tab = Rp
retail-discount-pct-label = Diskon (%)
retail-discount-rp-label = Diskon (Rp)
retail-customer-search-title = Pilih Pelanggan
retail-customer-search-placeholder = Cari berdasarkan nama, telepon, atau email…
retail-customer-search-loading = Memuat…
retail-customer-search-empty = Tidak ada pelanggan
retail-customer-clear = Hapus
retail-qty-total = Total:
retail-qty-picker-title = Pilih Jumlah
retail-qty-add = Tambah
retail-qty-backspace-aria = Hapus
retail-shortcuts-title = Pintasan Keyboard
retail-shortcut-pay = Bayar / Charge
retail-shortcut-clear = Hapus keranjang (Void)
retail-shortcut-discount = Diskon
retail-shortcut-hold = Tahan / Lanjutkan
retail-shortcut-sku = Fokus input SKU
retail-shortcut-shift = Buka / Tutup shift
retail-shortcut-options = Opsi
retail-shortcut-list = Daftar pintasan
retail-shortcut-close = Tutup modal / Opsi
retail-shortcut-fullscreen = Aktifkan/nonaktifkan layar penuh
retail-shortcut-credit = Pengingat kredit
retail-shortcut-low-stock = Filter produk stok menipis
retail-toast-failed-settings = Gagal memuat pengaturan toko
retail-toast-open-shift-first = Buka shift terlebih dahulu
retail-toast-order-held = Pesanan ditahan
retail-toast-failed-hold = Gagal menahan pesanan
retail-toast-failed-resume = Gagal melanjutkan pesanan
retail-toast-corrupt-cart = Data pesanan ditahan rusak dan telah dihapus
retail-toast-sale-complete = Transaksi selesai
retail-toast-credit-settled = Piutang dibayar
retail-toast-failed-settle = Gagal membayar piutang
retail-toast-failed-open-shift = Gagal membuka shift
retail-toast-failed-load-held = Gagal memuat pesanan ditahan
retail-toast-held-cart-deleted = Pesanan ditahan dihapus
retail-toast-failed-delete-held = Gagal menghapus pesanan ditahan
retail-toast-failed-cart = Gagal membuat keranjang penjualan
retail-toast-no-cart = Tidak ada keranjang penjualan aktif
retail-override-btn = Ganti Harga
retail-cart-course-aria = Kursus untuk { $name }
retail-cart-modifier-aria = Modifikasi untuk { $name }
retail-cart-modifier-btn = Modifikasi
retail-override-aria = Ganti harga untuk { $name }
retail-serial-placeholder = No. Seri
retail-serial-aria = Nomor seri untuk { $name }
retail-held-carts-title = Pesanan Ditahan
retail-held-carts-empty = Tidak ada pesanan ditahan
retail-fn-bar-aria = Bilah fungsi
retail-page-nav-aria = Halaman produk
retail-page-prev-aria = Halaman sebelumnya
retail-page-next-aria = Halaman berikutnya
retail-cart-qty-decrease-aria = Kurangi jumlah { $sku }
retail-cart-qty-increase-aria = Tambah jumlah { $sku }
retail-cart-remove-aria = Hapus { $sku } dari keranjang
retail-toast-insufficient-stock = Stok tidak mencukupi untuk { $name }
retail-toast-customers-failed = Gagal memuat pelanggan
retail-sku-not-found = Tidak ada produk yang cocok dengan SKU "{ $sku }"
retail-added-to-cart = { $name } ditambahkan
retail-no-low-stock-products = Tidak ada produk di bawah ambang stok minimum
retail-held-cart-delete-confirm = Hapus "{ $label }"? Tindakan ini tidak dapat dibatalkan.
retail-held-cart-delete-btn = Hapus
retail-low-stock-banner =
    { $count ->
        [one] { $count } produk stok menipis
       *[other] { $count } produk stok menipis
    }
retail-held-cart-delete-aria = Hapus pesanan ditahan
retail-held-cart-resume-aria = Lanjutkan pesanan
retail-held-cart-delete-title = Hapus Pesanan Ditahan
retail-fn-quick-return = Retur Cepat
retail-filtered-low-stock = Difilter: { $count } produk stok menipis
retail-filter-indicator-aria = Filter stok menipis aktif

# ── Quick Return ──────────────────────────────────────────────────────
retail-quick-return-title = Retur Cepat
retail-quick-return-desc = Pindai atau masukkan barcode struk untuk mencari transaksi retur.
retail-quick-return-placeholder = Barcode struk
retail-quick-return-aria = Input barcode struk
retail-quick-return-lookup = Cari
retail-quick-return-not-found = Transaksi tidak ditemukan untuk barcode ini
retail-quick-return-error = Gagal mencari struk
retail-header-workspaces-title = Kembali ke ruang kerja
retail-resize-handle-aria = Ubah ukuran panel keranjang

# ── Retail skip-to-content ────────────────────────────────────────────
retail-skip-to-main = Lewati ke konten utama
retail-header-workspaces-aria = Kembali ke ruang kerja

# ── Retail POS table columns ──
retail-col-sku = SKU / Kode
retail-col-name = Nama Produk
retail-col-stock = Stok
retail-col-price = Harga
retail-col-action = Aksi
retail-product-out-of-stock = Stok habis
retail-product-add-title = Tambah ke Keranjang
retail-product-add-aria = Tambah { $name } ke keranjang
retail-product-edit-title = Edit Produk
retail-product-edit-aria = Edit { $name }
retail-product-weigh-aria = Timbang { $name }
retail-edit-modal-close-aria =
    .aria-label = Tutup

# ── Edit Product Modal ──
retail-edit-product-title = Edit Produk
retail-edit-field-sku = SKU / Kode
retail-edit-field-name = Nama Produk
retail-edit-field-price = Harga (IDR)
retail-edit-field-stock = Jumlah Stok
retail-edit-field-low-stock = Ambang Stok Menipis
retail-edit-field-high-stock = Ambang Stok Tinggi
retail-edit-save = Simpan Perubahan
retail-edit-cancel = Batal
retail-course-none = Tidak ada
retail-edit-btn-aria = Edit produk { $name }

# ── Add Category / Add Product Modals ──
retail-add-category-btn = + Kategori
retail-add-category-btn-aria = Tambah kategori baru
retail-add-category-btn-title = Tambah kategori baru
retail-add-category-title = Tambah Kategori
retail-add-category-field-name = Nama Kategori
retail-add-category-name-placeholder = mis. Penyimpanan, Periferal, Aksesoris
retail-add-product-btn = + Produk
retail-add-product-btn-aria = Tambah produk baru
retail-add-product-btn-title = Tambah produk baru
retail-add-product-title = Tambah Produk
retail-add-product-category-label = Kategori
retail-add-product-name-placeholder = mis. Logitech G Pro X Wireless Mouse
retail-sku-lookup-aria = Cari berdasarkan SKU

# ── Retail POS table columns (ADR #36 D4) ──
retail-col-barcode = Barcode
retail-col-category = Kategori
retail-col-brand = Merek
retail-col-rack = Rak
retail-col-notes = Catatan
retail-col-popularity = Populer
retail-col-popularity-title = Urutkan berdasarkan popularitas
retail-col-hide-inactive = Sembunyikan produk nonaktif
retail-col-toggle-btn = Kolom
retail-col-toggle-title = Tampilkan / sembunyikan kolom
retail-col-toggle-aria = Pilih kolom yang terlihat

# ── Retail view-mode toggle (spec 0046b §3.5) ──
retail-view-grid-label = Grid
retail-view-text-label = Teks
retail-view-grid-title = Tampilkan produk sebagai grid gambar
retail-view-text-title = Tampilkan produk sebagai tabel teks

# ── Retail product attributes (ADR #36 D5) ──
retail-edit-field-cost = HPP (IDR)
retail-edit-field-unit = Satuan
retail-edit-field-brand = Merek
retail-edit-field-rack = Rak
retail-edit-field-notes = Catatan
retail-edit-field-active = Aktif (dapat dijual)
retail-edit-cost-override-hint = Menambah stok — perbarui HPP ke harga beli terbaru
retail-toast-save-product-failed = Gagal menyimpan produk

# ── Retail row context menu (ADR #38) ──
retail-row-menu-aria = Aksi produk
retail-row-menu-view-images = Lihat gambar produk

# ── Product Lookup rack (ADR #36 D6) ──
product-lookup-rack-title = Posisi rak

# ── Scale indicator widget ────────────────────────────────────────────────────
scale-indicator-aria = Indikator timbangan
scale-idle = Timbangan
scale-stable = Stabil
scale-unstable = …
scale-read-error = Kesalahan timbangan
scale-weigh-add = Timbang & Tambah
scale-weigh-add-aria = Timbang & tambah { $name }
scale-weigh-added = Ditambahkan { $weight }g dari { $name }
scale-target-set = { $name } dipilih untuk ditimbang
scale-clear-aria = Hapus target timbangan
weight-scale-aria = Timbangan
weight-scale-stable = Stabil
weight-scale-unstable = Tidak stabil
weight-scale-error = Kesalahan timbangan
weight-scale-idle = —
weight-scale-weigh-aria = Timbang
weight-scale-weighing = Menimbang…
weight-scale-weigh = Timbang

# ── Gift Cards ─────────────────────────────────────────────────────
gift-cards-loading = Memuat...
gift-cards-status-all = Semua Status
gift-cards-status-active = Aktif
gift-cards-status-frozen = Dibekukan
gift-cards-status-redeemed = Ditukarkan
gift-cards-status-expired = Kedaluwarsa
gift-cards-info-initial-balance = Saldo Awal
gift-cards-info-issued = Diterbitkan
gift-cards-info-expires = Kedaluwarsa
gift-cards-freeze = Bekukan
gift-cards-unfreeze = Buka Bekuan
gift-cards-top-up = Top Up
gift-cards-confirm-topup = Konfirmasi Top-Up
gift-cards-cancel-topup = Batal
gift-cards-recent-transactions = Transaksi Terbaru
gift-cards-txn-type = Tipe
gift-cards-txn-amount = Jumlah
gift-cards-txn-balance = Saldo
gift-cards-txn-notes = Catatan
gift-cards-txn-date = Tanggal

# C2.2: QRIS adalah fitur Plus+ — ajakan tingkatkan paket di modal pembayaran.
payment-qris-upgrade-required = Pembayaran QRIS adalah fitur Plus. Tingkatkan ke Plus untuk menerima QRIS.
payment-qris-upgrade-cta = Tingkatkan ke Plus

# ── Receipt Preview ──
receipt-preview-aria = Pratinjau Struk
receipt-preview-store-name = Toko OZ-POS
receipt-preview-col-item = Item
receipt-preview-col-qty = Jum
receipt-preview-col-price = Harga
receipt-preview-col-total = Total
receipt-preview-subtotal = SUBTOTAL:
receipt-preview-tax = PAJAK:
receipt-preview-total = TOTAL:
receipt-preview-change = KEMBALIAN:
receipt-preview-qr-label = Scan untuk bayar
receipt-preview-qr-aria = Kode QR pembayaran
receipt-preview-thanks = Terima kasih atas pembelian Anda!
receipt-preview-skip = Lewati
receipt-preview-print = Cetak Struk

# ── Sales History ARIA (remaining) ──
sales-history-search-placeholder =
    .placeholder = Cari ID penjualan, pembayaran, kasir…
sales-history-search-aria =
    .aria-label = Cari penjualan
sales-history-filter-aria =
    .aria-label = Saring penjualan
sales-history-status-filter-aria =
    .aria-label = Saring berdasarkan status
sales-history-date-from-aria =
    .aria-label = Dari tanggal
sales-history-date-to-aria =
    .aria-label = Ke tanggal
sales-history-cashier-aria =
    .aria-label = Saring berdasarkan kasir
sales-history-table-aria =
    .aria-label = Riwayat penjualan
sales-history-prev-aria =
    .aria-label = Halaman sebelumnya
sales-history-next-aria =
    .aria-label = Halaman berikutnya
sales-history-per-page-aria =
    .aria-label = Hasil per halaman
sales-history-void-overlay-aria =
    .aria-label = Batalkan pesanan
sales-history-void-reason-aria =
    .aria-label = Alasan pembatalan
sales-history-detail-overlay-aria =
    .aria-label = Detail penjualan
sales-history-detail-close-aria =
    .aria-label = Tutup
sales-history-lines-aria =
    .aria-label = Item baris penjualan
sales-history-actions-aria =
    .aria-label = Tindakan
sales-history-pagination-aria =
    .aria-label = Paginasi
sales-history-void-close-aria =
    .aria-label = Tutup dialog pembatalan
sales-history-refund-lines-aria =
    .aria-label = Item baris pengembalian

# ── Payment (remaining) ──
payment-customer-name-aria =
    .aria-label = Nama pelanggan untuk tagihan terbuka

# Daily Sales Dashboard — Free tier lock (C2.2, §6)
daily-dashboard-locked-title = Dasbor Penjualan Harian
daily-dashboard-locked-message = Lihat total pendapatan harian, jumlah penjualan, dan rincian item dalam sekilas. Fitur ini tersedia di Plus ke atas.
daily-dashboard-locked-cta = Upgrade ke Plus


pos-promotions-dialog-aria = Pemilih promosi
pos-promotions-close-aria = Tutup promosi
pos-promotions-title = Promosi
pos-promotions-loading = Memuat promosi…
pos-promotions-empty = Tidak ada promosi aktif
pos-promotions-load-failed = Gagal memuat promosi
pos-promotions-value-percent = Diskon { $value }%
pos-promotions-value-fixed = Potongan { $value } unit kecil
pos-promotions-value-bxgy = Beli X dapat Y
pos-promotions-not-applicable = Belum dapat diterapkan di kasir
pos-promotions-min-order = Butuh pesanan minimum { $min }
pos-promotions-applied = Promosi diterapkan: { $name }
pos-promotions-toggle-aria = Aktif/nonaktifkan promosi { $name }
pos-promotions-selected-count = { $count } dipilih
pos-promotions-apply-selected = Terapkan promosi
pos-promotions-apply-aria = Terapkan promosi { $name }
pos-promotions-unavailable-aria = Promosi { $name } tidak dapat diterapkan

# ── Product image editor (spec 0046b §3.2–3.3) ──
retail-edit-image-title = Gambar Produk
retail-edit-image-primary = Gambar utama
retail-edit-image-alternatives = Gambar tambahan
retail-edit-image-set = Atur Gambar
retail-edit-image-set-aria = Pilih gambar baru untuk { $name }
retail-edit-image-set-alt-aria = Pilih gambar tambahan { $slot } untuk { $name }
retail-edit-image-replace = Ganti
retail-edit-image-replace-aria = Ganti gambar untuk { $name }
retail-edit-image-clear = Hapus
retail-edit-image-clear-aria = Hapus gambar untuk { $name }
retail-edit-image-clear-alt-aria = Hapus gambar tambahan { $slot } untuk { $name }
retail-edit-image-uploading = Mengunggah gambar…
retail-edit-image-error = Gagal memperbarui gambar. Coba lagi.
retail-edit-image-menu-note = Item menu selalu memiliki tepat satu gambar.
retail-edit-image-alt = Gambar { $name } { $slot }
