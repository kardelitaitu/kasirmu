# shared-ui/locales/purchasing.ftl — Suppliers & Purchase Orders

suppliers-title = Suppliers
suppliers-add = Add Supplier
suppliers-search =
    .placeholder = Search by name, code, or contact…
    .aria-label = Search suppliers

suppliers-add-title = Add Supplier
suppliers-edit-title = Edit Supplier
suppliers-btn-create = Create
suppliers-btn-update = Update
suppliers-btn-cancel = Cancel

po-title = Purchase Orders
po-add = New Purchase Order

# Purchase Order Form
po-form-new-title = New Purchase Order
po-form-edit-title = Edit Purchase Order
po-form-close-aria = Close
po-form-po-number-label = PO Number *
po-form-po-number-placeholder =
    .placeholder = PO-001
po-form-supplier-label = Supplier *
po-form-supplier-select = -- Select --
po-form-expected-date-label = Expected Date
po-form-notes-label = Notes
po-form-notes-placeholder =
    .placeholder = Optional notes
po-form-line-items = Line Items
po-form-add-line = + Add Line
po-form-sku = SKU
po-form-product-name = Product Name
po-form-qty = Qty
po-form-unit-cost = Unit Cost
# The field takes a NATURAL amount in the store's currency — the cashier types what
# they would say out loud ("45.00", "45000") and the form converts at the boundary
# via parseMoneyInput. The previous "in cents" named a USD/EUR subunit the field does
# not use on an exponent-0 currency (IDR — whole rupiah, no subunit at all), and
# naming the exponent instead ("minor units") is developer jargon the UX must never
# show (noMinorUnitsInUxCompliance). The { $currency } variable is what the operator
# actually needs: which currency they are typing.
po-form-unit-cost-placeholder = Amount in { $currency }
po-form-line-total = Line Total
po-form-actions-label = Actions
po-form-remove-line-aria = Remove line
po-form-subtotal = Subtotal
po-form-create-btn = Create PO
po-form-cancel-btn = Cancel
po-form-aria-label = Purchase Order Form
po-form-table-aria = Line items
po-form-error-po-required = PO number is required
po-form-error-supplier-required = Supplier is required
po-form-error-sku-required = Each line must have a SKU
po-form-error-generic = Failed to create purchase order
po-form-error-suppliers-failed = Failed to load suppliers

# Status labels
po-status-all = All
po-status-draft = Draft
po-status-pending = Pending
po-status-approved = Approved
po-status-received = Received
po-status-cancelled = Cancelled

# Table columns
po-col-number = PO #
po-col-supplier = Supplier
po-col-status = Status
po-col-order-date = Order Date
po-col-expected = Expected
po-col-total = Total
po-col-items = Items
po-col-actions =
    .aria-label = Actions

# Action buttons
po-action-submit = Submit
po-action-approve = Approve
po-action-receive = Receive
po-action-cancel = Cancel

# Empty states
po-empty = No purchase orders yet.
po-empty-filtered = No purchase orders with status "{ $status }".

# Error messages
po-error-load = Failed to load purchase orders
po-error-update = Failed to update purchase order
po-error-receive = Failed to receive purchase order

suppliers-no-results = No suppliers match your search.
suppliers-clear-search = Clear search
suppliers-error-load = Suppliers could not be loaded.
suppliers-no-data = No suppliers yet.
suppliers-add-first = Add your first supplier

# Supplier table columns
suppliers-table-aria = Suppliers
suppliers-col-code = Code
suppliers-col-name = Name
suppliers-col-contact = Contact
suppliers-col-phone = Phone
suppliers-col-email = Email
suppliers-col-status = Status
suppliers-col-actions =
    .aria-label = Actions
suppliers-edit = Edit

# Supplier form fields
suppliers-field-code = Code *
suppliers-field-name = Name *
suppliers-field-contact = Contact Person
suppliers-field-phone = Phone
suppliers-field-email = Email
suppliers-field-address = Address
suppliers-field-tax-id = Tax ID
suppliers-field-payment-terms = Payment Terms
suppliers-field-notes = Notes

# Save-handler validation for the supplier form. Key names match the
# l10n.getString() call sites in SuppliersScreen verbatim.
supplier-name-required = Supplier name is required
supplier-code-required = Supplier code is required

# Receive PO Modal & Terms
po-receive-modal-title = Receive Purchase Order
po-receive-number-label = PO Number
po-receive-supplier-label = Supplier
po-receive-total-label = Total Amount
po-receive-payment-terms-label = Payment Terms
po-receive-term-cash = Cash (Paid Now)
po-receive-term-cash-desc = Stock received and paid immediately
po-receive-term-on-account = On Account (Beli Tempo)
po-receive-term-on-account-desc = Record vendor debt to be paid later
po-receive-invoice-ref-label = Vendor Invoice / Reference
po-receive-invoice-ref-placeholder = e.g. INV-2026-001
po-receive-due-date-label = Payment Due Date
po-receive-note-label = Note / Remarks
po-receive-note-placeholder = Optional remarks
po-receive-cancel-btn = Cancel
po-receive-confirm-btn = Confirm Receipt

# Vendor Bills (Hutang / Beli Tempo)
vendor-bills-title = Vendor Bills (Hutang Supplier)
vendor-bills-add-btn = + Add Vendor Bill
vendor-bills-stat-outstanding = Total Outstanding Debt
vendor-bills-stat-overdue = Overdue Bills
vendor-bills-stat-open = Unsettled Bills
vendor-bills-filter-all = All
vendor-bills-filter-open = Open
vendor-bills-filter-partial = Partial
vendor-bills-filter-paid = Paid
vendor-bills-filter-overdue = Overdue
vendor-bills-loading = Loading vendor bills…
vendor-bills-empty-title = No Vendor Bills
vendor-bills-empty-message = All supplier debts are settled, or no bills have been recorded yet.
vendor-bills-col-supplier = Supplier
vendor-bills-col-ref = Reference / Bill #
vendor-bills-col-status = Status
vendor-bills-col-due = Due Date
vendor-bills-col-amount = Amount
vendor-bills-col-paid = Paid
vendor-bills-col-balance = Balance
vendor-bills-col-actions =
    .aria-label = Actions
vendor-bill-status-open = Open
vendor-bill-status-partial = Partial
vendor-bill-status-paid = Paid
vendor-bill-status-written_off = Written Off
vendor-bill-badge-overdue = OVERDUE
vendor-bill-action-pay = Pay
vendor-bill-action-writeoff = Write Off
vendor-bills-pay-title = Record Vendor Payment
vendor-bills-pay-balance-label = Remaining Balance:
vendor-bills-pay-tender-label = Payment Tender
vendor-bills-pay-amount-label = Amount to Pay
vendor-bills-pay-note-label = Note / Reference
vendor-bills-pay-note-placeholder = e.g. Transfer receipt #
vendor-bills-btn-cancel = Cancel
vendor-bills-btn-confirm-pay = Disburse Payment
vendor-bills-add-modal-title = Add Vendor Bill
vendor-bills-field-supplier = Supplier *
vendor-bills-field-ref = Invoice / Bill Reference
vendor-bills-field-ref-placeholder = e.g. INV-9981
vendor-bills-field-amount = Bill Amount ({ $currency }) *
vendor-bills-field-due = Due Date
vendor-bills-field-note = Notes
vendor-bills-btn-create-bill = Save Bill
vendor-bills-error-load = Failed to load vendor bills
vendor-bills-error-invalid-amount = Please enter a valid positive payment amount
vendor-bills-error-supplier-required = Please select a supplier
vendor-bills-payment-success = Vendor payment recorded successfully
vendor-bills-writeoff-confirm = Are you sure you want to write off this vendor debt? This action cannot be undone.
vendor-bills-writeoff-success = Vendor debt written off successfully
vendor-bills-create-success = Vendor bill recorded successfully
vendor-bills-error-pay-failed = Could not record the vendor payment
vendor-bills-error-writeoff-failed = Could not write off this vendor debt
vendor-bills-error-create-failed = Could not record this vendor bill
vendor-bills-title-writeoff = Write off debt?

