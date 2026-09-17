inventory-report-title = Laporan Stok
inventory-report-low-stock = Stok Menipis
inventory-report-in-stock = Tersedia
inventory-report-out-of-stock = Stok Habis
inventory-report-all = Semua Produk
inventory-report-product = Produk
inventory-report-sku = SKU
inventory-report-category = Kategori
inventory-report-current-stock = Stok Saat Ini
inventory-report-threshold = Batas
inventory-report-reorder = Pesan Ulang
inventory-report-export-csv = Ekspor CSV

inventory-adjust = Sesuaikan Stok
inventory-product = Produk

inv-title = Penyesuaian Stok
inv-step-select-product = 1. Pilih Produk
inv-step-adjustment-details = 2. Detail Penyesuaian
inv-change = Ganti
inv-change-aria = Ganti produk
inv-search-placeholder =
    .placeholder = Cari berdasarkan SKU, nama, atau barcode…
inv-search-aria = Cari produk
inv-loading = Memuat produk…
inv-no-results = Tidak ada produk yang cocok.
inv-hint = Ketik untuk mencari produk berdasarkan SKU, nama, atau barcode.
inv-stock-count = { $count } tersedia
inv-stock-off = Pelacakan stok nonaktif
inv-type-aria = Tipe penyesuaian
inv-type-add-aria = Stok Masuk
inv-type-add-label = Stok Masuk (Isi Ulang)
inv-type-remove-aria = Stok Keluar
inv-type-remove-label = Stok Keluar (Kurangi)
inv-qty-label = Jumlah
inv-qty-placeholder =
    .placeholder = mis. 10
inv-qty-hint = Stok saat ini: { $stock }
inv-reason-label = Alasan
inv-reason-select = Pilih alasan…
inv-reason-custom-label = Jelaskan alasannya
inv-reason-custom-placeholder =
    .placeholder = Masukkan alasan penyesuaian ini…
inv-error = { $message }
inv-success-adjusted = &quot;{ $name }&quot; disesuaikan sebesar { $delta }. Stok baru: { $newQty }
inv-error-qty-positive = Jumlah harus berupa angka positif
inv-error-reason-required = Silakan pilih atau masukkan alasan
inv-error-stock-insufficient = Tidak dapat mengurangi { $qty } unit — hanya { $stock } tersedia
inv-error-generic = Gagal menyesuaikan stok
inv-cancel = Batal
inv-apply-restock = Terapkan Isi Ulang
inv-apply-removal = Terapkan Pengurangan
inv-adjusting = Menyesuaikan…
inv-reason-restock = Isi ulang (pengiriman pemasok)
inv-reason-stock-take = Koreksi stok opname
inv-reason-return = Retur pelanggan
inv-reason-damaged = Rusak / kedaluwarsa
inv-reason-write-off = Penghapusan / kedaluwarsa
inv-reason-transfer = Transfer ke lokasi lain
inv-reason-other = Alasan lain…
inv-report-title = Laporan Stok
inv-report-threshold = Batas
inv-report-export-csv = Ekspor CSV
inv-report-sku = SKU
inv-report-product = Produk
inv-report-current-stock = Stok
inv-report-region-aria = Laporan Stok
inv-report-threshold-aria = Batas stok
inv-report-print-aria = Cetak laporan
inv-report-export-aria = Ekspor CSV
inv-report-csv-header-sku = SKU
inv-report-csv-header-product = Produk
inv-report-csv-header-stock = Stok Saat Ini
inv-report-csv-header-threshold = Batas
inv-report-csv-header-unit-price = Harga Satuan
inv-report-csv-header-unit-cost = HPP Satuan
inv-report-csv-header-unit-margin = Margin Satuan
inv-report-csv-header-margin = Margin
inv-report-csv-header-stock-value = Nilai Stok
inv-report-no-results = Tidak ada hasil
inv-search-results-aria = Hasil pencarian
inv-qty-field-aria = Jumlah
inv-reason-custom-field-aria = Jelaskan alasannya

# Inventory Shifts
inv-shift-start-title = Mulai Shift Stok
inv-shift-notes-placeholder =
    .placeholder = mis., Perhitungan shift malam...
inv-shift-start-btn = Mulai Shift
inv-shift-active-info = { $user } — { $location } — Dimulai { $time }
inv-shift-end-btn = Akhiri Shift
inv-shift-summary-title = Ringkasan Shift
inv-shift-summary-performed = Transaksi yang dilakukan selama shift ini:
inv-shift-no-transactions = Tidak ada transaksi yang tercatat.

# Inventory Shift — error toasts + a11y
inv-shift-error-locations = Gagal memuat lokasi
inv-error-load = Gagal memuat produk
inv-shift-error-active = Gagal memuat shift aktif
inv-shift-error-start = Gagal memulai shift
inv-shift-error-end = Gagal mengakhiri shift
inv-shift-bar-aria = Info Shift
inv-shift-location-aria = Lokasi
inv-shift-notes-aria = Catatan

# Transit Audit
inv-transit-title = Audit Stok Transit
inv-transit-col-sku = SKU
inv-transit-col-product = Produk
inv-transit-col-qty = Jml
inv-transit-col-source = Asal
inv-transit-col-dest = Tujuan
inv-transit-col-sent = Dikirim Pada
inv-transit-reverse-btn = Batalkan Transfer
inv-transit-no-overdue = Tidak ada item transit yang terlambat.
inv-transit-reverse-title = Batalkan Transfer?
inv-transit-reverse-message = Apakah Anda yakin ingin membatalkan transfer stok ini? Stok akan dikembalikan ke lokasi asal. Tindakan ini tidak dapat dibatalkan.
inv-transit-reverse-confirm = Batalkan
inv-transit-transfer-label = Transfer #
inv-transit-reversed-toast = Transfer stok berhasil dibatalkan
inv-transit-error-load = Gagal memuat stok transit
inv-transit-error-reverse = Gagal membatalkan transfer
inv-transit-unknown = Tidak diketahui

# Transaction Log
inv-log-title = Log Transaksi Stok
inv-log-filter-location = Lokasi
inv-log-filter-staff = Staf
inv-log-filter-type = Tipe
inv-log-filter-all = Semua
inv-log-expand-btn = Detail
inv-log-col-barcode = Barcode Dipindai
inv-log-col-datetime = Tanggal / Waktu
inv-log-col-type = Tipe
inv-log-col-location = Lokasi
inv-log-col-staff = Staf
inv-log-col-actions = Tindakan
inv-log-filter-start = Tanggal Mulai
inv-log-filter-end = Tanggal Akhir
inv-log-type-sale = Penjualan
inv-log-type-void = Void
inv-log-type-refund = Refund
inv-log-type-transfer = Transfer
inv-log-type-po-receive = PO Diterima
inv-log-type-stock-count = Stok Opname
inv-log-type-manual-adjustment = Penyesuaian Manual
inv-log-loading-lines = Memuat baris...
inv-log-notes = Catatan
inv-log-error-load = Gagal memuat transaksi
inv-log-error-lines = Gagal memuat detail transaksi

# Threshold Config
inv-threshold-title = Konfigurasi Batas Stok
inv-threshold-col-sku = SKU
inv-threshold-col-product = Nama Produk
inv-threshold-col-location = Lokasi
inv-threshold-col-threshold = Batas
inv-threshold-col-status = Status
inv-threshold-col-actions = Tindakan
inv-threshold-add-btn = + Tambah Batas
inv-threshold-dialog-title = Atur Batas
inv-threshold-global-opt = Global (Semua Lokasi)
inv-threshold-filter-all = Semua Lokasi
inv-threshold-filter-global = Hanya Global Fallback
inv-threshold-status-enabled = Aktif
inv-threshold-status-disabled = Nonaktif
inv-threshold-unknown-product = Produk Tidak Dikenal

# Threshold Config — additional keys
inv-threshold-filter-label = Filter berdasarkan Lokasi
inv-threshold-delete-title = Hapus Batas?
inv-threshold-delete-message = Apakah Anda yakin ingin menghapus batas peringatan stok ini? Tindakan ini tidak dapat dibatalkan.
inv-threshold-delete-confirm = Hapus
inv-threshold-error-qty = Batas harus berupa bilangan bulat non-negatif yang valid
inv-threshold-error-load = Gagal memuat data batas
inv-threshold-error-save = Gagal menyimpan batas
inv-threshold-error-delete = Gagal menghapus batas

# Stock Alert Panel
inv-alert-title = Panel Peringatan Stok
inv-alert-badge-count = { $count } Peringatan Stok
inv-alert-loading-aria = Memuat peringatan stok
inv-alert-loading = Memuat peringatan...
inv-alert-aria = Peringatan stok
inv-alert-panel-aria = Panel peringatan stok
inv-alert-empty = Tidak ada peringatan aktif
inv-alert-time-now = Baru saja
inv-alert-time-min = { $min }m lalu
inv-alert-time-hr = { $hr }j lalu
inv-alert-ack-aria = Tanggapi peringatan untuk { $name }
inv-alert-ack = Tanggapi
inv-alert-acking = ...
inv-alert-stock-label = Stok
inv-alert-threshold-label = Batas
inv-alert-error-load = Gagal memuat peringatan
inv-alert-error-ack = Gagal menanggapi

# ── Location Picker ──
loc-picker-label = Lokasi
loc-picker-trigger-aria = Pilih lokasi inventaris. Saat ini: { $name }
loc-picker-listbox-aria = Lokasi inventaris
loc-picker-error-load = Gagal memuat lokasi
loc-picker-badge-primary = Utama
loc-picker-badge-neg-stock = Stok neg.
loc-picker-search-aria = Cari lokasi
loc-picker-search-placeholder = Cari lokasi…
loc-picker-no-results = Tidak ada lokasi yang cocok dengan pencarian.
loc-type-store = Toko
loc-type-warehouse = Gudang
loc-type-transit = Transit
loc-type-damaged = Rusak
loc-type-virtual = Virtual
loc-type-unknown = Tidak Diketahui

# ── Table Management ──

