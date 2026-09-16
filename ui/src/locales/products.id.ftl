products-name = Nama

restaurant-menu-search-placeholder = Cari Menu
restaurant-menu-hamburger-aria = Menu
restaurant-menu-back-aria = Kembali ke ruang kerja
restaurant-menu-close = Tutup
restaurant-menu-close-aria = Tutup menu
restaurant-size-decrease-aria = Perkecil ukuran
restaurant-size-increase-aria = Perbesar ukuran
restaurant-font-size-decrease-aria = Perkecil ukuran huruf
restaurant-font-size-increase-aria = Perbesar ukuran huruf
restaurant-font-size-label = Ukuran Huruf
restaurant-theme-light = Mode Terang
restaurant-theme-dark = Mode Gelap
restaurant-lock-terminal = Kunci Terminal
restaurant-toggle-fullscreen = Aktifkan/nonaktifkan layar penuh
restaurant-clear-color-aria = Hapus warna
restaurant-categories-aria = Kategori menu
restaurant-menu-loading = Memuat menu…
restaurant-menu-empty = Menu kosong
restaurant-size-label = Ukuran
restaurant-sort-label = Urutkan
# "Manual" and "A–Z" are intentionally identical to English — both are used
# as-is in Indonesian. Only the two translated words here are real translation
# work; do not "fix" the identical pair.
restaurant-sort-manual = Manual
restaurant-sort-a-z = A–Z
restaurant-sort-date = Berdasarkan Tanggal
restaurant-sort-popularity = Popularitas
restaurant-card-add = Tambah
restaurant-card-unavailable = Tidak tersedia
restaurant-context-color-label = Warna
restaurant-search-aria = Cari item menu
restaurant-search-clear-aria = Hapus pencarian
restaurant-context-pin = Sematkan ke atas
restaurant-context-unpin = Lepas sematan
restaurant-context-available = Tandai tersedia
restaurant-context-unavailable = Tandai tidak tersedia
restaurant-card-pin-title = Disematkan ke atas
restaurant-menu-items-aria = Item menu
restaurant-color-swatch-aria = Warna { $color }

# Error Boundary
product-lookup-dev-fallback = Menggunakan data contoh (IPC tidak tersedia)
product-lookup-search-placeholder =
    .placeholder = Cari produk…
product-lookup-search-aria =
    .aria-label = Cari produk berdasarkan nama, SKU, atau barcode
product-lookup-barcode-placeholder =
    .placeholder = Pindai barcode…
product-lookup-barcode-aria =
    .aria-label = Masukkan atau pindai barcode
product-lookup-barcode-scan = Pindai
product-lookup-scan-btn-aria =
    .aria-label = Kirim barcode yang dimasukkan
product-lookup-no-results = Tidak ada produk ditemukan
product-lookup-clear-search = Hapus pencarian
product-lookup-loading = Memuat produk…
product-lookup-in-stock = Tersedia
product-lookup-out-of-stock = Stok Habis
product-lookup-all-categories = Semua Kategori
product-lookup-categories-aria = Saring berdasarkan kategori
product-lookup-grid-aria = Hasil pencarian produk
product-lookup-card-aria =
    .aria-label = { $name } — { $price }. SKU: { $sku }. { $stock }
product-lookup-bundle-added = Bundel "{ $name }" ditambahkan — { $count } item
product-lookup-no-match = Tidak ada produk atau bundel yang cocok dengan barcode ini
product-lookup-uncategorised = Tanpa Kategori
product-lookup-error-load = Gagal memuat produk

# POS Cart (remaining)
product-mgmt-title = Produk
product-mgmt-add = Tambah Produk
product-mgmt-empty = Belum ada produk.
product-mgmt-empty-cta = Tambah produk pertama
product-mgmt-col-sku = SKU
product-mgmt-col-name = Nama
product-mgmt-col-category = Kategori
product-mgmt-col-price = Harga
product-mgmt-col-barcode = Barcode
product-mgmt-col-stock = Stok
product-mgmt-stock-in = Tersedia
product-mgmt-stock-out = Stok Habis
product-mgmt-edit = Ubah
product-mgmt-edit-aria = Ubah { $name }
product-mgmt-delete = Hapus
product-mgmt-delete-aria = Hapus { $name }
product-mgmt-delete-confirm-title = Hapus produk?
product-mgmt-delete-confirm-message = Hapus { $name } ({ $sku })? Tindakan ini tidak dapat dibatalkan.
product-mgmt-delete-confirm-btn = Hapus
product-mgmt-error-delete = Gagal menghapus produk
product-mgmt-error-load = Gagal memuat produk
product-mgmt-error-retry = Coba lagi
product-mgmt-alert-error = Tidak dapat memuat peringatan stok. Menampilkan jumlah terakhir.
product-mgmt-alert-error-retry = Muat ulang peringatan
product-mgmt-error-invalid-stock = Stok harus berupa bilangan bulat non-negatif
product-mgmt-modal-add-title = Tambah Produk
product-mgmt-modal-edit-title = Ubah Produk
product-mgmt-modal-close = Tutup
product-mgmt-field-name-required = Nama *
product-mgmt-field-sku-required = SKU *
product-mgmt-field-price = Harga (unit minor)
product-mgmt-field-currency = Mata Uang
product-mgmt-field-category = Kategori
product-mgmt-field-barcode = Barcode
product-mgmt-field-tax-rates = Tarif Pajak
product-mgmt-field-stock = Stok awal
product-mgmt-btn-cancel = Batal
product-mgmt-btn-create = Buat
product-mgmt-btn-update = Perbarui
product-mgmt-error-save = Gagal menyimpan produk
product-mgmt-error-invalid-price = Harga harus berupa angka non-negatif yang valid
product-mgmt-table-aria = Katalog produk
product-mgmt-actions-aria =
    .aria-label = Tindakan
product-mgmt-variants = Varian
product-mgmt-variants-aria = Varian untuk { $name }
product-mgmt-modal-aria = { $mode ->
        [add] Tambah produk
       *[edit] Ubah produk
    }
product-mgmt-modal-close-aria =
    .aria-label = Tutup
product-mgmt-sku-placeholder =
    .placeholder = mis. LATTE
product-mgmt-name-placeholder =
    .placeholder = mis. Caffè Latte
product-mgmt-price-placeholder =
    .placeholder = 450
product-mgmt-barcode-placeholder =
    .placeholder = 4901234567890
product-mgmt-stock-placeholder =
    .placeholder = 0
product-mgmt-no-category = — Tanpa Kategori —
product-mgmt-col-type = Tipe
product-mgmt-field-type = Tipe
product-mgmt-alerts-title = Notifikasi Stok
product-mgmt-alert-close = Tutup

# ── Product Variants ──
variant-mgmt-title = Varian — { $product }
variant-mgmt-empty = Belum ada varian.
variant-mgmt-empty-cta = Tambah varian
variant-mgmt-add = Tambah Varian
variant-mgmt-col-name = Nama
variant-mgmt-col-sku = SKU
variant-mgmt-col-price = Harga
variant-mgmt-col-barcode = Barcode
variant-mgmt-col-status = Status
variant-mgmt-price-parent = Menggunakan harga induk
variant-mgmt-status-active = Aktif
variant-mgmt-status-inactive = Tidak Aktif
variant-mgmt-edit = Ubah
variant-mgmt-edit-aria =
    .aria-label = Ubah { $name }
variant-mgmt-delete = Hapus
variant-mgmt-delete-aria =
    .aria-label = Hapus { $name }
variant-mgmt-delete-confirm-title = Hapus Varian
variant-mgmt-delete-confirm-body = Apakah Anda yakin ingin menghapus varian "{ $name }" ({ $sku })? Tindakan ini tidak dapat dibatalkan.
variant-mgmt-delete-confirm-cancel = Batal
variant-mgmt-delete-confirm-confirm = Hapus
variant-mgmt-modal-add-title = Tambah Varian
variant-mgmt-modal-edit-title = Ubah Varian
variant-mgmt-close-aria =
    .aria-label = Tutup
variant-mgmt-field-name-required = Nama *
variant-mgmt-field-sku-required = SKU *
variant-mgmt-field-price = Harga (unit minor)
variant-mgmt-field-currency = Mata Uang
variant-mgmt-field-barcode = Barcode
variant-mgmt-field-sort-order = Urutan
variant-mgmt-field-active = Aktif
variant-mgmt-btn-cancel = Batal
variant-mgmt-error-retry = Coba lagi
variant-mgmt-btn-create = Buat
variant-mgmt-btn-update = Perbarui
variant-mgmt-overlay-aria = Varian untuk { $name }
variant-mgmt-table-aria = Varian produk
variant-mgmt-actions-aria =
    .aria-label = Tindakan
variant-mgmt-name-placeholder =
    .placeholder = mis. Besar
variant-mgmt-sku-placeholder =
    .placeholder = mis. TEA-LARGE
variant-mgmt-price-placeholder =
    .placeholder = 450
variant-mgmt-currency-placeholder =
    .placeholder = USD
variant-mgmt-barcode-placeholder =
    .placeholder = 4901234567890
variant-mgmt-sort-placeholder =
    .placeholder = 0
variant-mgmt-error-load = Gagal memuat varian
variant-mgmt-error-save = Gagal menyimpan varian
variant-mgmt-error-delete = Gagal menghapus varian
variant-mgmt-error-invalid-price = Harga varian harus berupa bilangan bulat non-negatif
variant-mgmt-error-invalid-sort = Urutan harus berupa bilangan bulat non-negatif

# ── Category Management ──
categories-title = Kategori
categories-no-categories = Belum ada kategori
categories-empty-desc = Mulai dengan membuat kategori pertama Anda
categories-add-first = Tambah kategori pertama
categories-add = Tambah Kategori
categories-name = Nama
categories-name-placeholder =
    .placeholder = mis. Toko Roti, Barang
categories-colour = Warna
categories-icon = Ikon
categories-id-preview = Pratinjau ID
categories-edit = Ubah
categories-create = Buat
categories-save = Simpan
categories-delete-confirm = Hapus Kategori
categories-delete-warning = Ini akan memutuskan tautan semua produk dalam kategori ini.
categories-delete-unlinked = { $count ->
    [one] 1 produk terlepas taut di kategori ini.
   *[other] { $count } produk terlepas taut di kategori ini.
}
categories-error-create = Gagal membuat kategori
categories-error-update = Gagal memperbarui kategori
categories-error-delete = Gagal menghapus kategori
categories-error-load = Gagal memuat kategori
categories-error-retry = Coba lagi
categories-error-name-required = Nama kategori wajib diisi
categories-error-id-conflict = Kategori dengan ID ini sudah ada
categories-error-colour-invalid = Pilih warna dari palet
categories-preview = Pratinjau
categories-name-aria = Nama Kategori
categories-icon-picker-aria = Pilih ikon
categories-colour-picker-aria = Pilih warna
categories-icon-food = Makanan
categories-icon-snack = Camilan
categories-icon-hot-drink = Minuman panas
categories-icon-cold-drink = Minuman dingin
categories-icon-generic = Generik
category-mgmt-edit-aria = Edit kategori { $name }

# Product type labels
product-type-retail = Ritel
product-type-restaurant = Restoran
product-type-service = Layanan

# Stock Alert Panel
product-mgmt-stock-alert-open = Buka peringatan stok
product-mgmt-stock-alert-close = Tutup peringatan stok
product-mgmt-alert-count =
    { $count ->
        [one] Buka peringatan stok ({ $count } aktif)
       *[other] Buka peringatan stok ({ $count } aktif)
    }

# ── Customer Management (remaining) ──
