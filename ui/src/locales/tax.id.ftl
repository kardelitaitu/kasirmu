tax-config-title = Konfigurasi Pajak
tax-config-add = Tambah Tarif Pajak
tax-config-empty = Belum ada tarif pajak
tax-config-col-name = Nama
tax-config-col-rate = Tarif (%)
tax-config-table-aria = Tarif pajak
tax-config-cat-table-aria = Tarif pajak kategori
tax-config-modal-title = { $editing ->
    [true] Ubah Tarif Pajak
   *[other] Tambah Tarif Pajak
}
tax-config-field-name = Nama Pajak
tax-config-field-rate = Tarif (%)
tax-config-btn-cancel = Batal
tax-config-btn-save = Simpan
tax-config-btn-delete = Hapus
tax-config-col-type = Tipe
tax-config-col-actions =
    .aria-label = Tindakan
tax-config-col-default = Default
tax-config-col-category = Kategori
tax-config-col-assigned = Tarif Pajak Ditugaskan
tax-config-default-badge = Default
tax-config-type-inclusive = Inklusif
tax-config-type-exclusive = Eksklusif
tax-config-yes = Ya
tax-config-edit = Ubah
tax-config-edit-aria =
    .aria-label = Ubah { $name }
tax-config-delete-aria =
    .aria-label = Hapus { $name }
tax-config-cat-title = Tarif Pajak Kategori
tax-config-cat-desc = Tetapkan tarif pajak default ke kategori produk. Produk mewarisi tarif pajak kategorinya kecuali ditimpa di tingkat produk.
tax-config-no-categories = Belum ada kategori.
tax-config-no-rates-assigned = Belum ada tarif ditugaskan
tax-config-cat-edit-aria =
    .aria-label = Ubah tarif pajak untuk { $name }
tax-config-field-name-placeholder = mis. PPN
tax-config-field-rate-placeholder = 1100
tax-config-rate-hint = Masukkan tarif dalam basis poin (mis. 1100 = 11%%)
tax-config-tax-type = Tipe Pajak
tax-config-tax-type-aria = Tipe pajak
tax-config-type-exclusive-label = Eksklusif
tax-config-type-exclusive-desc = Ditambahkan saat checkout
tax-config-type-inclusive-label = Inklusif
tax-config-type-inclusive-desc = Termasuk dalam harga
tax-config-set-default = Tetapkan sebagai tarif pajak default
tax-config-cat-modal-title = Tarif Pajak — { $name }
tax-config-cat-modal-desc = Pilih tarif pajak yang berlaku untuk semua produk dalam kategori ini.
tax-config-no-rates = Belum ada tarif pajak. Buat satu terlebih dahulu.
tax-config-save-error = Gagal menyimpan tarif pajak
tax-config-delete-error = Gagal menghapus tarif pajak
tax-config-cat-save-error = Gagal menyimpan tarif pajak kategori
tax-config-load-error = Gagal memuat konfigurasi pajak.
tax-config-load-retry = Coba lagi
tax-config-rate-invalid = Tarif harus antara 0 dan { $max } basis poin.
tax-config-delete-confirm-title = Hapus { $name }?
tax-config-delete-confirm-message = Arsipkan “{ $name }”? Ini akan menyembunyikannya dari daftar dan menghapus penugasan produk/kategorinya. Penjualan historis tetap menyimpan tautan tarifnya.
tax-config-delete-blocked-title = Tidak dapat menghapus { $name }
tax-config-delete-blocked-message = “{ $name }” dirujuk oleh { $count } penjualan historis dan tidak dapat diarsipkan. Tarif yang dipakai penjualan lalu disimpan agar struk dan catatan audit tetap utuh.
tax-config-delete-deps-products = { $count ->
    [one] 1 penugasan produk
   *[other] { $count } penugasan produk
}
# F1: badge provenance cakupan (resolver berjalan Lokasi → Badan hukum → Global)
tax-config-scope-location = Lokasi · { $id }
tax-config-scope-legal-entity = Badan hukum · { $id }
tax-config-scope-global = Global
tax-config-delete-deps-categories = { $count ->
    [one] 1 penugasan kategori
   *[other] { $count } penugasan kategori
}

# ── Multi-Store ──
