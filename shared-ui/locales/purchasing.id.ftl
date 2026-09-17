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
po-form-unit-cost-placeholder = dalam sen
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
