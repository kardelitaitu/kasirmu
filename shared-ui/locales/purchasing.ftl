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
po-form-unit-cost-placeholder = in cents
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
