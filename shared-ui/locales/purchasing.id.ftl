# shared-ui/locales/purchasing.id.ftl — Pemasok & Pesanan Pembelian

suppliers-title = Pemasok
suppliers-add = Tambah Pemasok
suppliers-search =
    .placeholder = Cari berdasarkan nama, kode, atau kontak…
    .aria-label = Cari pemasok

suppliers-add-title = Tambah Pemasok
suppliers-edit-title = Edit Pemasok
suppliers-btn-create = Buat
suppliers-btn-update = Perbarui
suppliers-btn-cancel = Batal

po-title = Pesanan Pembelian
po-add = Pesanan Pembelian Baru

# Purchase Order Form
po-form-new-title = Pesanan Pembelian Baru
po-form-edit-title = Edit Pesanan Pembelian
po-form-close-aria = Tutup
po-form-po-number-label = Nomor PO *
po-form-po-number-placeholder =
    .placeholder = PO-001
po-form-supplier-label = Pemasok *
po-form-supplier-select = -- Pilih --
po-form-expected-date-label = Tanggal Diharapkan
po-form-notes-label = Catatan
po-form-notes-placeholder =
    .placeholder = Catatan opsional
po-form-line-items = Item Baris
po-form-add-line = + Tambah Baris
po-form-sku = SKU
po-form-product-name = Nama Produk
po-form-qty = Jml
po-form-unit-cost = Biaya Satuan
po-form-unit-cost-placeholder = Jumlah dalam { $currency }
po-form-line-total = Total Baris
po-form-actions-label = Tindakan
po-form-remove-line-aria = Hapus baris
po-form-subtotal = Subtotal
po-form-create-btn = Buat PO
po-form-cancel-btn = Batal
po-form-aria-label = Formulir Pesanan Pembelian
po-form-table-aria = Item baris
po-form-error-po-required = Nomor PO wajib diisi
po-form-error-supplier-required = Pemasok wajib diisi
po-form-error-sku-required = Setiap baris harus memiliki SKU
po-form-error-generic = Gagal membuat pesanan pembelian
po-form-error-suppliers-failed = Gagal memuat pemasok

# Status labels
po-status-all = Semua
po-status-draft = Draf
po-status-pending = Tertunda
po-status-approved = Disetujui
po-status-received = Diterima
po-status-cancelled = Dibatalkan

# Table columns
po-col-number = No. PO
po-col-supplier = Pemasok
po-col-status = Status
po-col-order-date = Tanggal Pesan
po-col-expected = Diharapkan
po-col-total = Total
po-col-items = Item
po-col-actions =
    .aria-label = Tindakan

# Action buttons
po-action-submit = Kirim
po-action-approve = Setujui
po-action-receive = Terima
po-action-cancel = Batal

# Empty states
po-empty = Belum ada pesanan pembelian.
po-empty-filtered = Tidak ada pesanan pembelian dengan status "{ $status }".

# Error messages
po-error-load = Gagal memuat pesanan pembelian
po-error-update = Gagal memperbarui pesanan pembelian
po-error-receive = Gagal menerima pesanan pembelian

suppliers-no-results = Tidak ada pemasok yang cocok dengan pencarian Anda.
suppliers-clear-search = Hapus pencarian
suppliers-error-load = Pemasok tidak dapat dimuat.
suppliers-no-data = Belum ada pemasok.
suppliers-add-first = Tambah pemasok pertama

# Supplier table columns
suppliers-table-aria = Pemasok
suppliers-col-code = Kode
suppliers-col-name = Nama
suppliers-col-contact = Kontak
suppliers-col-phone = Telepon
suppliers-col-email = Email
suppliers-col-status = Status
suppliers-col-actions =
    .aria-label = Tindakan
suppliers-edit = Edit

# Supplier form fields
suppliers-field-code = Kode *
suppliers-field-name = Nama *
suppliers-field-contact = Kontak Person
suppliers-field-phone = Telepon
suppliers-field-email = Email
suppliers-field-address = Alamat
suppliers-field-tax-id = NPWP
suppliers-field-payment-terms = Ketentuan Pembayaran
suppliers-field-notes = Catatan

# Save-handler validation for the supplier form (see purchasing.ftl).
supplier-name-required = Nama pemasok wajib diisi
supplier-code-required = Kode pemasok wajib diisi

# Receive PO Modal & Terms
po-receive-modal-title = Terima Pesanan Pembelian
po-receive-number-label = Nomor PO
po-receive-supplier-label = Pemasok
po-receive-total-label = Total Tagihan
po-receive-payment-terms-label = Ketentuan Pembayaran
po-receive-term-cash = Tunai (Lunas Sekarang)
po-receive-term-cash-desc = Stok diterima dan langsung dibayar lunas
po-receive-term-on-account = Beli Tempo (Hutang)
po-receive-term-on-account-desc = Catat sebagai hutang dagang yang dibayar kemudian
po-receive-invoice-ref-label = No. Faktur / Referensi Pemasok
po-receive-invoice-ref-placeholder = contoh: INV-2026-001
po-receive-due-date-label = Tanggal Jatuh Tempo
po-receive-note-label = Catatan
po-receive-note-placeholder = Catatan opsional
po-receive-cancel-btn = Batal
po-receive-confirm-btn = Konfirmasi Penerimaan

# Vendor Bills (Hutang / Beli Tempo)
vendor-bills-title = Tagihan Pemasok (Hutang Dagang)
vendor-bills-add-btn = + Catat Hutang Pemasok
vendor-bills-stat-outstanding = Total Hutang Belum Lunas
vendor-bills-stat-overdue = Tagihan Jatuh Tempo
vendor-bills-stat-open = Tagihan Terbuka
vendor-bills-filter-all = Semua
vendor-bills-filter-open = Terbuka
vendor-bills-filter-partial = Sebagian
vendor-bills-filter-paid = Lunas
vendor-bills-filter-overdue = Jatuh Tempo
vendor-bills-loading = Memuat tagihan pemasok…
vendor-bills-empty-title = Tidak Ada Tagihan Pemasok
vendor-bills-empty-message = Semua hutang pemasok telah lunas, atau belum ada tagihan yang dicatat.
vendor-bills-col-supplier = Pemasok
vendor-bills-col-ref = Referensi / No. Faktur
vendor-bills-col-status = Status
vendor-bills-col-due = Jatuh Tempo
vendor-bills-col-amount = Total Hutang
vendor-bills-col-paid = Dibayar
vendor-bills-col-balance = Sisa Hutang
vendor-bills-col-actions =
    .aria-label = Tindakan
vendor-bill-status-open = Terbuka
vendor-bill-status-partial = Sebagian
vendor-bill-status-paid = Lunas
vendor-bill-status-written_off = Dihapuskan
vendor-bill-badge-overdue = JATUH TEMPO
vendor-bill-action-pay = Bayar
vendor-bill-action-writeoff = Hapus Hutang
vendor-bills-pay-title = Catat Pembayaran Hutang
vendor-bills-pay-balance-label = Sisa Hutang:
vendor-bills-pay-tender-label = Metode Pembayaran
vendor-bills-pay-amount-label = Jumlah Pembayaran
vendor-bills-pay-note-label = Catatan / Referensi
vendor-bills-pay-note-placeholder = contoh: Bukti transfer #
vendor-bills-btn-cancel = Batal
vendor-bills-btn-confirm-pay = Salurkan Pembayaran
vendor-bills-add-modal-title = Catat Tagihan Pemasok
vendor-bills-field-supplier = Pemasok *
vendor-bills-field-ref = No. Faktur / Referensi
vendor-bills-field-ref-placeholder = contoh: INV-9981
vendor-bills-field-amount = Jumlah Tagihan ({ $currency }) *
vendor-bills-field-due = Tanggal Jatuh Tempo
vendor-bills-field-note = Catatan
vendor-bills-btn-create-bill = Simpan Tagihan
vendor-bills-error-load = Gagal memuat tagihan pemasok
vendor-bills-error-invalid-amount = Harap masukkan nominal pembayaran yang valid dan positif
vendor-bills-error-supplier-required = Harap pilih pemasok
vendor-bills-payment-success = Pembayaran ke pemasok berhasil dicatat
vendor-bills-writeoff-confirm = Apakah Anda yakin ingin menghapus hutang pemasok ini? Tindakan ini tidak dapat dibatalkan.
vendor-bills-writeoff-success = Hutang pemasok berhasil dihapuskan
vendor-bills-create-success = Tagihan pemasok berhasil dicatat
vendor-bills-error-pay-failed = Pembayaran ke pemasok gagal dicatat
vendor-bills-error-writeoff-failed = Hutang pemasok gagal dihapuskan
vendor-bills-error-create-failed = Tagihan pemasok gagal dicatat
vendor-bills-title-writeoff = Hapus hutang?

