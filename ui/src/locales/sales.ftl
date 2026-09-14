# ui/src/locales/sales.ftl — POS, cart, sales history, dashboard, refunds

# Cart
cart-title = Cart
cart-empty = Cart is empty
cart-line-remove = Remove
cart-total-label = Total

# POS
sale-pay-button = Pay
pos-cart-panel-title = Current Sale
pos-cart-panel-title-order = Current Order
pos-cart-deducting-label = Deducting: { $name }
pos-cart-deduction-badge-aria = Deducting from { $name }
pos-cart-unbound-error = Cart has no deduction location — cannot add items
pos-cart-empty = Cart is empty
pos-cart-empty-subtitle = Tap a menu item to start the order
pos-cart-remove = Remove
pos-cart-pay = Charge

# Bundle Expansion
pos-bundle-expanded =
    { $count ->
        [one] Bundle "{ $name }" added — 1 item to cart
       *[other] Bundle "{ $name }" added — { $count } items to cart
    }
pos-no-barcode-match = No product or bundle matches this barcode
pos-close-shift-cart-error = Complete or clear the current sale before closing the shift.
pos-close-shift-failed = Failed to close shift

# Scanner
pos-scanner-error = Scanner error: { $detail }
pos-toast-receipt-settings-failed = Failed to load receipt settings

# Payment Modal
payment-dialog-aria =
    .aria-label = Payment
payment-title = Complete Order
payment-table-number = Table { $number }
    .aria-label = Table number
payment-close-aria =
    .aria-label = Cancel payment
payment-done-title = Sale Complete
payment-change-label = Change due
payment-done-receipt = Receipt printed
payment-total-due = Total Due
payment-currency-aria =
    .aria-label = Charge currency
payment-currency-label = Charge Currency
payment-currency-select-aria =
    .aria-label = Select charge currency
payment-exchange-aria =
    .aria-label = Exchange rate information
payment-exchange-rate = Exchange rate
payment-rate-source = Rate source
payment-rate-timestamp = Rate timestamp
payment-rate-source-manual = manual
payment-receipt-currency-aria =
    .aria-label = Receipt currency information
payment-charged-in = Charged in
payment-default-currency = Default currency
payment-base-amount = Base amount
payment-charge-amount = Charge amount
payment-method-label = Payment Method
payment-method-cash = Cash
payment-method-card = Card
payment-method-qris = QRIS
payment-method-credit = Credit
payment-other-placeholder =
    .placeholder = Other...
    .aria-label = Other payment method name
payment-amount-tendered = Amount Tendered
payment-tendered-input =
    .placeholder = 0.00
    .aria-label = Amount tendered
payment-quick-tender-aria = Tender { $amount }
payment-tender-exact-aria =
    .aria-label = Tend exact amount
payment-tender-exact = Exact
payment-customer-name-aria =
    .aria-label = Customer name for open bill
payment-change = Change
payment-insufficient = Insufficient amount
payment-qris-description = Generate a QRIS QR code for the customer to scan with their payment app.
payment-qris-pay = Pay with QR
payment-qris-dynamic-pay = Pay with dynamic QR
payment-qris-countdown = Expires in { $seconds }s
payment-qris-expired-title = The QR code expired
payment-qris-reissue = Generate a new QR
payment-qris-cancel = Cancel payment
payment-qris-auto-charge-failed = QRIS Auto charge failed: { $reason }
payment-qris-auto-no-payload = The payment gateway returned no QR payload
payment-qris-auto-cancelled = QRIS payment cancelled — pending sale voided

# EDC card-present flow (agents-3 3.2)
payment-edc-description = Charge the total on the connected card terminal — tap, insert or swipe.
payment-edc-pay = Pay on card terminal
payment-edc-preflight = Checking card terminal…
payment-edc-waiting = Please tap, insert or swipe the card…
payment-edc-declined = Card declined
payment-edc-not-ready = Card terminal is not ready ({ $status })
payment-edc-failed = Card payment failed: { $reason }
payment-edc-dismiss = Back to payment
payment-qris-scan = Scan with your payment app
payment-qris-waiting = Waiting for payment...
payment-qris-manual-confirm = I received the payment
payment-qris-not-configured = Merchant static QR not configured — set it under Settings › Local payment methods.
payment-qris-dialog-aria = QRIS QR payment
payment-qris-close-aria = Close QR payment
payment-qris-qr-aria = QR code
payment-qris-waiting-aria = Waiting for payment
payment-qris-confirmed-aria = Payment confirmed
payment-qris-confirmed = Payment confirmed!
payment-qris-amount = Amount
payment-qris-reference = Reference
payment-qris-merchant = Merchant
payment-qris-merchant-name = OZ-POS Store

# Price Override Modal
price-override-dialog-aria = Price override
price-override-close-aria = Close
price-override-title = Price Override
price-override-current-label = Current price
price-override-new-label = New price (in minor units)
price-override-new-aria = Enter new price in minor units
price-override-cancel = Cancel
price-override-next = Next
price-override-back = Back
price-override-username-label = Enter manager username
price-override-username-placeholder = Username
price-override-username-aria = Manager username
price-override-pin-label = Enter manager PIN
price-override-pin-aria = PIN entry
price-override-pin-dots-aria = PIN entry: { $count } of { $max } digits
price-override-keypad-aria = Numeric keypad
price-override-clear = Clear
price-override-backspace-aria = Backspace
price-override-verifying = Verifying…
price-override-error-zero = Price must be greater than 0
price-override-error-max = Price exceeds 10x the current price. Maximum allowed is { $max }.
price-override-pin-failed = PIN verification failed
payment-split-title = Split Payments
payment-split-evenly = Split Evenly
payment-split-add = + Add Split
payment-split-method-cash = Cash
payment-split-method-card = Card
payment-split-other-placeholder =
    .placeholder = Other
    .aria-label = Other payment method name
payment-split-amount-placeholder =
    .placeholder = 0.00
    .aria-label = Split amount
payment-split-remove-aria = Remove split
    .aria-label = Remove split
payment-split-remaining = Remaining
payment-split-toggle = Split payment across methods
payment-cancel = Cancel
payment-open-bill = Open Bill
payment-credit-sale = Credit Sale
payment-customer-name = Customer Name
payment-customer-change = Change
payment-customer-select = Select Customer
payment-customer-remove-aria = Remove customer
payment-loyalty-use-points = Use Points
payment-loyalty-points-label = Points
payment-loyalty-discount-label = Discount: -{ $amount }
payment-customer-search-heading = Select Customer
payment-customer-search-empty = No customers found
payment-complete = Complete
payment-retry-aria =
    .aria-label = Retry payment
payment-retry = Retry
payment-toast-currency-failed = Failed to load currency data
payment-toast-customers-failed = Failed to load customers
payment-toast-loyalty-failed = Failed to load loyalty account
payment-toast-points-value-failed = Failed to load points value
payment-toast-kds-failed = Payment succeeded, but the kitchen ticket could not be created — notify the kitchen manually
payment-customer-placeholder = e.g. John Doe
payment-loyalty-points-aria = Points
payment-search-customers-aria = Search customers
payment-search-customers-placeholder = Search by name, phone, or email...

# ── Stock Shortfall Dialog ──
shortfall-dialog-aria = Insufficient stock resolution
shortfall-title = Insufficient Stock
shortfall-description = Some items don&apos;t have enough stock at the primary location. Choose alternative sources below.
shortfall-wanted = Wanted
shortfall-available = Available
shortfall-alternatives-label = Alternative locations:
shortfall-alt-available = available
shortfall-split-qty-aria =
    .aria-label = Quantity from this location
shortfall-simple-mode = Use single location
shortfall-split-mode = Split across locations
shortfall-no-alternatives = No alternative locations with stock available.
shortfall-negative-override = Allow negative stock (Manager PIN override)
shortfall-warehouse-warning = ⚠ Warehouse fulfillment may incur delivery charges.
shortfall-cancel-btn = Cancel Sale
shortfall-confirm-btn = Confirm &amp; Continue
payment-shortfall-cancelled = Sale cancelled due to insufficient stock.

# Sales History
sales-history-title = Sales History
sales-history-loading = Loading sales…
sales-history-error-load = Failed to load sales history
sales-history-empty = No sales recorded yet
sales-history-empty-filtered = No sales match your filters
# C1.2: the Free tier's 3-month history window was applied — upgrade teaser.
sales-history-cap-teaser = See more than 3 months of sales history — upgrade to Plus
sales-history-cap-upgrade-cta = Upgrade
sales-history-count = { $count } sale{ $count ->
  [one] 
  *[other] s
}
sales-history-page-info = Page { $current } of { $total }
sales-history-col-id = Sale ID
sales-history-col-date = Date
sales-history-col-total = Total
sales-history-col-items = Items
sales-history-col-status = Status
sales-history-col-payment = Payment
sales-history-col-cashier = Cashier
sales-history-view-aria = View { $id }
sales-history-void-aria = Void order { $id }
sales-history-search-placeholder =
    .placeholder = Search sale ID, payment, cashier…
sales-history-search-aria =
    .aria-label = Search sales
sales-history-filter-aria =
    .aria-label = Filter sales
sales-history-status-filter-aria =
    .aria-label = Filter by status
sales-history-date-from-aria =
    .aria-label = From date
sales-history-date-to-aria =
    .aria-label = To date
sales-history-cashier-aria =
    .aria-label = Filter by cashier
sales-history-table-aria =
    .aria-label = Sales history
sales-history-prev-aria =
    .aria-label = Previous page
sales-history-next-aria =
    .aria-label = Next page
sales-history-per-page-aria =
    .aria-label = Results per page
sales-history-void-overlay-aria =
    .aria-label = Void order
sales-history-void-reason-aria =
    .aria-label = Void reason
sales-history-detail-overlay-aria =
    .aria-label = Sale detail
sales-history-detail-close-aria =
    .aria-label = Close
sales-history-lines-aria =
    .aria-label = Sale line items
sales-history-actions-aria =
    .aria-label = Actions
sales-history-pagination-aria =
    .aria-label = Pagination
sales-history-void-close-aria =
    .aria-label = Close void dialog
sales-history-refund-lines-aria =
    .aria-label = Refund line items
sales-history-detail-title = Sale Detail
sales-history-detail-close = Close
sales-history-detail-print = Reprint Receipt
sales-history-detail-id = ID
sales-history-detail-date = Date
sales-history-detail-status = Status
sales-history-detail-payment = Payment
sales-history-detail-cashier = Cashier
sales-history-detail-subtotal = Subtotal
sales-history-detail-tax = Tax
sales-history-detail-total = Total
sales-history-lines-title = Line Items
sales-history-line-sku = SKU
sales-history-line-name = Name
sales-history-line-qty = Qty
sales-history-line-unit-price = Unit Price
sales-history-line-total = Total
sales-history-line-cost = Cost
sales-history-line-margin = Margin
sales-history-line-margin-pct = Margin %
sales-history-line-tax = Tax
# F2-7 — the audit-stamp badge: shown on the detail's tax line when core
# stamped the sale as computed against a non-fresh tax estimate.
sales-history-tax-estimated-badge = Estimated
sales-history-status-all = All
sales-history-status-completed = Completed
sales-history-status-pending = Pending
sales-history-status-cancelled = Cancelled
sales-history-status-voided = Voided
sales-history-export-csv = Export CSV
sales-history-search-label = Search
sales-history-status-label = Status
sales-history-from-label = From
sales-history-to-label = To
sales-history-cashier-label = Cashier
sales-history-cashier-all = All Cashiers
sales-history-clear-filters = Clear filters
sales-history-prev-page = ← Prev
sales-history-next-page = Next →
sales-history-per-page-label = Per page
sales-history-void-title = Void Order
sales-history-void-desc = This will cancel order { $id } for { $amount } and restore inventory. This action cannot be undone.
sales-history-void-reason-label = Reason for void
sales-history-void-cancel = Cancel
sales-history-void-confirm = Confirm Void
sales-history-void-progress = Voiding…
sales-history-action-view = View
sales-history-action-void = Void
sales-history-void-reason-placeholder =
    .placeholder = e.g. Customer cancellation
sales-history-void-default-reason = Voided from sales history
sales-history-void-error = Failed to void order

# Sales History export
sales-history-export-id = Sale ID
sales-history-export-date = Date
sales-history-export-total = Total
sales-history-export-items = Items
sales-history-export-status = Status
sales-history-export-payment = Payment
sales-history-export-cashier = Cashier
sales-history-export-sku = SKU
sales-history-export-product = Product
sales-history-export-qty = Qty
sales-history-export-unit-price = Unit Price
sales-history-export-unit-cost = Unit Cost
sales-history-export-line-margin = Line Margin
sales-history-export-margin-pct = Margin %
sales-history-exporting = Exporting…
sales-history-pull-to-refresh = Pull down to refresh
sales-history-release-to-refresh = Release to refresh

# Sales Dashboard
sales-dashboard-title = Sales Dashboard
sales-dashboard-daily-total = Daily Total
sales-dashboard-total-sales = Total Sales
sales-dashboard-total-items = Total Items
sales-dashboard-hourly-title = Sales by Hour
sales-dashboard-no-data = No data for today
sales-dashboard-revenue-title = Revenue (14d)
sales-dashboard-category-title = By Category
sales-dashboard-heatmap-title = Busiest Hours
sales-dashboard-region-aria = Reporting dashboard
sales-dashboard-grid-aria = Dashboard widgets
sales-dashboard-daily-aria = Daily sales summary
sales-dashboard-hourly-aria = Sales by hour
sales-dashboard-hourly-bars-aria = Hourly sales bars
sales-dashboard-category-aria = Category breakdown
sales-dashboard-heatmap-aria = Hourly sales heatmap
sales-dashboard-chart-other = Other
sales-dashboard-revenue-aria = 14-day revenue chart
sales-dashboard-revenue-summary = 14-day revenue chart: { $total } total across { $days } days
sales-dashboard-category-summary = Category breakdown: { $count } categories
sales-dashboard-heatmap-summary = Hourly sales heatmap: { $count } active time slots

# Void Orders
void-orders-title = Orders
void-orders-search-placeholder =
    .placeholder = Search by order ID or payment method…
void-orders-search-aria =
    .aria-label = Search orders
void-orders-filter-status-aria =
    .aria-label = Filter by status
void-orders-status-all = All
void-orders-status-active = Active
void-orders-status-completed = Completed
void-orders-status-voided = Voided
void-orders-status-pending = Pending
void-orders-loading = Loading orders…
void-orders-retry = Retry
void-orders-empty-filtered = No orders match the current filters.
void-orders-empty-none = No orders recorded yet.
void-orders-table-aria =
    .aria-label = Orders
void-orders-col-order-id = Order ID
void-orders-col-date = Date
void-orders-col-status = Status
void-orders-col-total = Total
void-orders-col-items = Items
void-orders-col-payment = Payment
void-orders-col-actions = Actions
void-orders-col-actions-aria =
    .aria-label = Actions
void-orders-view-aria =
    .aria-label = View order { $id }
void-orders-view = View
void-orders-void-aria =
    .aria-label = Void order { $id }
void-orders-void = Void
void-orders-back-aria =
    .aria-label = Back to orders list
void-orders-back = Back to Orders
void-orders-not-found = Order not found.
void-orders-go-back = Go back
void-orders-detail-heading = Order { $id }
void-orders-meta-date = Date
void-orders-meta-payment = Payment
void-orders-meta-total = Total
void-orders-meta-items = Items
void-orders-line-items-title = Line Items
void-orders-line-items-aria =
    .aria-label = Order line items
void-orders-line-sku = SKU
void-orders-line-name = Name
void-orders-line-qty = Qty
void-orders-line-unit-price = Unit Price
void-orders-line-total = Total
void-orders-void-section-title = Void Order
void-orders-void-description = This will cancel the order, refund the payment, and restore stock to inventory.
void-orders-reason-label = Reason for void
void-orders-reason-select = Select a reason…
void-orders-reason-placeholder =
    .placeholder = Enter the reason for voiding this order…
void-orders-reason-aria =
    .aria-label = Custom void reason
void-orders-cancel = Cancel
void-orders-confirm-voiding = Voiding…
void-orders-confirm = Confirm Void
void-orders-voided-notice = This order has been voided.
void-orders-error-load = Failed to load orders
void-orders-error-reason = Please select or enter a void reason
void-orders-error-void = Failed to void order
void-orders-success-voided = Order voided successfully. Stock has been restored.
void-orders-reason-cancelled = Cancelled by customer
void-orders-reason-wrong-items = Wrong items scanned
void-orders-reason-duplicate = Duplicate order
void-orders-reason-price-dispute = Price dispute
void-orders-reason-payment-issue = Payment issue
void-orders-reason-changed-mind = Customer changed mind
void-orders-reason-manager-override = Manager override
void-orders-reason-other = Other reason…

# Refund
refund-title = Process Refund
refund-done-title = Refund Processed
refund-done-amount = Refunded: { $amount }
refund-done = Done
refund-dialog-aria = Process refund
refund-close-aria =
    .aria-label = Cancel refund
refund-sale-id = Sale: { $id }
refund-sale-total = Total: { $amount }
refund-sale-date = Date: { $date }
refund-items-title = Select Items to Refund
refund-item-aria =
    .aria-label = Refund { $sku }
refund-qty-decrease-aria =
    .aria-label = Decrease refund quantity
refund-qty-increase-aria =
    .aria-label = Increase refund quantity
refund-reason-label = Reason *
refund-reason-placeholder =
    .placeholder = e.g. Customer changed mind
refund-reason-aria = Refund reason
refund-note-label = Note (internal)
refund-note-placeholder =
    .placeholder = Optional internal note
refund-note-aria = Refund note
refund-total-label = Refund Total
refund-cancel = Cancel
refund-submit = Process Refund
refund-error = Refund failed

# Sales History Refund Line Items
refund-previous-refunds = Previous Refunds
refund-line-sku = SKU
refund-line-qty = Qty
refund-line-total = Total
refund-action-refund = Refund

# Item Modifier Modal
modifier-no-options = No options available
modifier-free = Free
modifier-base-price = Base price
modifier-addons = Add-ons
modifier-total = Total
modifier-add-to-cart = Add to Cart
modifier-dialog-aria = Customise { $productName }

# EOD Report
eod-title = End-of-Day Report
eod-cashier-shifts = Cashier Shifts
eod-shift-active = Shift in progress
eod-shift-active-since = Active shift since
eod-opening-balance = Opening balance
eod-sales-this-shift = Sales this shift
eod-closed-shifts = Closed Shifts Today
eod-col-opened = Opened
eod-col-closed = Closed
eod-col-opening = Opening
eod-col-counted = Counted
eod-col-expected = Expected
eod-col-diff = Diff
eod-total = Total
eod-tag-over = Over
eod-tag-short = Short
eod-cash-reconciliation = Cash Reconciliation
eod-cash-total-opening = Total opening
eod-cash-total-counted = Total counted
eod-cash-total-expected = Total expected
eod-cash-net-diff = Net difference
eod-refresh = Refresh
eod-refresh-aria = Refresh report
eod-printing = Printing…
eod-print = Print
eod-print-aria = Print EOD report
eod-error = { $error }
eod-error-fallback = Failed to load report
eod-retry = Retry
eod-empty-title = No sales data available for today.
eod-empty-sub = Sales will appear here once transactions are completed.
eod-kpi-revenue = Total Revenue
eod-kpi-revenue-sub = { $count } completed { $count ->
    [one] sale
    *[other] sales
}
eod-kpi-average = Average Sale
eod-kpi-average-sub = per transaction
eod-kpi-voids = Voids
eod-kpi-voids-sub = { $amount } voided
eod-kpi-discounts = Discounts Applied
eod-kpi-discounts-sub = { $count } { $count ->
    [one] sale with discount
    *[other] sales with discount
}
eod-kpi-discounts-none = No discounts applied
eod-payment-breakdown = Payment Breakdown
eod-payment-empty = No payment data
eod-payment-count = { $count } { $count ->
    [one] transaction
    *[other] transactions
}
eod-payment-bar-aria = { $method }: { $pct }% of revenue
eod-hourly-title = Sales by Hour
eod-hourly-empty = No hourly data
eod-hourly-chart-aria = Hourly sales bar chart
eod-hour-bar-aria-sales = { $hour }:00 — { $count } { $count ->
    [one] sale
    *[other] sales
}, { $amount }
eod-hour-bar-aria-none = { $hour }:00 — No sales
eod-summary-title = Today's Summary
eod-summary-completed = Completed Sales
eod-summary-revenue = Total Revenue
eod-summary-voided-sales = Voided Sales
eod-summary-voided-value = Voided Value
eod-summary-discounts = Sales with Discounts
eod-summary-payment-methods = Payment Methods Used

pos-cart-add-discount = + Add Discount
pos-cart-add-promotion = + Promotions
pos-cart-apply = Apply
pos-cart-cancel = Cancel
pos-cart-clear = Clear
pos-cart-discount-label = Discount ({ $label })
pos-cart-hold = Hold
pos-cart-label-placeholder =
    .placeholder = Label (optional)
pos-cart-lock = Lock
pos-cart-pct-placeholder =
    .placeholder = %
pos-cart-subtotal = Subtotal
pos-cart-undo = Undo
pos-close-shift-counted-label = Counted cash in drawer
pos-close-shift-counted-placeholder =
    .placeholder = e.g. 150.00
pos-close-shift-notes-label = Notes (optional)
pos-close-shift-notes-placeholder =
    .placeholder = Any notes about this shift…
pos-close-shift-opened = Opened
pos-close-shift-opening-balance = Opening balance
pos-close-shift-title = Close Shift
# In-progress button states. sales.id.ftl has had these three since the shift
# flow grew; sales.ftl never caught up, so English was rendering the hardcoded
# <Localized> fallback child instead of bundle text -- visually correct, but
# untranslatable and invisible to every locale tool. Surfaced by the
# ternary-id scan added in the Fluent page audit.
pos-close-shift-confirm = Close Shift
pos-close-shift-closing = Closing…
pos-hold-cancel = Cancel
pos-hold-desc = Enter a name for this held order so you can find it later.
pos-hold-title = Hold Current Order
pos-login-desc = Please log in to use the POS.
pos-login-required = Login Required
pos-open-shift-balance-label = Opening balance
pos-open-shift-balance-placeholder =
    .placeholder = e.g. 100.00
pos-open-shift-title = Open Shift
pos-open-shift-opening = Opening…
pos-shift-card-sales = Card Sales
pos-shift-cash-sales = Cash Sales
pos-shift-closed-title = Shift Closed
pos-shift-counted = Counted
pos-shift-difference = Difference
pos-shift-expected-cash = Expected Cash
pos-shift-loading = Loading shift…
pos-shift-no-active = No active shift
pos-shift-elapsed = { $h ->
    [0] { $m }m
   *[other] { $h }h { $m }m
}
pos-shift-notes = Notes
pos-shift-summary-done = Done

# Cart Tip (items 6-10)
pos-cart-tip-label = Add Tip
pos-cart-tip-none = None
pos-cart-tip-aria = Tip selection
pos-cart-tip-segment-aria = Set tip to { $percent } percent
pos-cart-tip-segment-zero-aria = No tip
pos-cart-tip-line = Tip ({ $percent }%)

# Cart Service Charge
pos-cart-service-toggle-label = Add { $percent }% service charge
pos-cart-service-toggle-aria = Toggle service charge
pos-cart-service-line = Service ({ $percent }%)

# Persistent undo
pos-cart-undo-dismiss = Dismiss
pos-cart-undo-dismiss-aria = Dismiss undo notification
pos-shift-total-sales = Total Sales
pos-shift-over = Over
pos-shift-short = Short

# POS shift bar
pos-shift-close-btn = Close
pos-shift-open-btn = Open
pos-shift-close-aria = Close current shift
pos-shift-open-aria = Open a new shift
pos-dismiss-error-aria = Dismiss error

# POS cart
pos-cart-undo-btn = Undo
pos-cart-clear-aria = Clear all items from cart
pos-cart-charge-aria = Charge the customer
pos-cart-open-bill = Open Bill
pos-cart-open-bill-aria = Save as open bill
pos-cart-open-bills = Open Bills
pos-cart-open-bills-aria = View open bills
pos-cart-table-label = Table #
pos-cart-table-placeholder = No.
pos-cart-table-aria = Table number
pos-cart-options-collapse-aria = Collapse options
pos-cart-options-expand-aria = Expand options
pos-cart-discount-pct-aria = Discount percentage
pos-cart-discount-label-aria = Discount label
pos-cart-discount-remove-aria = Remove discount
pos-cart-discount-cancel-aria = Cancel discount
pos-cart-promotion-remove-aria = Remove promotion { $name }

# Cart line items (dynamic)
pos-cart-line-aria = { $sku }, { $qty } × { $amount }
pos-cart-line-decrease-aria = Decrease quantity of { $sku }
pos-cart-line-qty-aria = Quantity: { $qty }
pos-cart-line-increase-aria = Increase quantity of { $sku }
pos-cart-line-remove-aria = Remove { $sku } from cart
pos-cart-line-swipe-remove-aria = Remove { $sku }
pos-cart-line-override = Override
pos-cart-line-override-aria = Override price for { $name }

# Cart panel
pos-cart-panel-aria = Cart

# Cart course firing
pos-cart-course-fire-aria = Fire { $label } ({ $count } items)
pos-cart-course-btn--all = Fire All

# Shift modal overlay labels
pos-close-shift-overlay-aria = Close shift
pos-close-shift-balance-aria = Closing balance
pos-close-shift-notes-aria = Shift notes
pos-close-shift-summary-aria = Shift closed summary
pos-open-shift-overlay-aria = Open shift
pos-open-shift-balance-aria = Opening balance
pos-open-bill-overlay-aria = Open bill
pos-open-bills-overlay-aria = Open bills list

# POS open bill modal
pos-open-bill-title = Open Bill
pos-open-bill-desc = Enter the customer name for this open bill.
pos-open-bill-placeholder = e.g. John Doe
pos-open-bill-name-aria = Customer name
pos-open-bill-saving = Saving…
pos-open-bill-save = Save Open Bill
pos-open-bills-title = Open Bills
pos-open-bills-close-aria = Close open bills list
pos-open-bills-empty = No open bills.
pos-open-bills-resume = Resume

# ── Retail POS load error / retry ──
retail-load-error = Failed to load products. Showing demo data.
retail-load-error-unavailable = Failed to load products. Check the connection and retry.
retail-load-error-retry-aria = Retry loading products

# ── Retail POS screen ──
retail-store-name-fallback = TOKO
retail-shift-label = Shift
retail-no-shift = No shift
retail-search-placeholder = Cari produk…
retail-search-clear-aria = Clear search
retail-no-products = No products
retail-no-products-match = No products match your search
retail-no-products-in-category = No products in this category
retail-products-loading = Loading products…
retail-store-logo-alt = Store logo
retail-sku-label = SKU
retail-sku-placeholder = Scan or type barcode / SKU
retail-sku-go = GO
retail-cart-items =
    { $count ->
        [one] { $count } item
       *[other] { $count } items
    }
retail-cart-header-col = #
retail-cart-header-item = Item
retail-cart-header-qty = Qty
retail-cart-header-price = @Price
retail-cart-header-subtotal = Subtotal
retail-undo-items-removed =
    { $count ->
        [one] { $count } item removed
       *[other] { $count } items removed
    }
retail-total-discount = Discount { $percent }%
retail-total-tax = PPN
retail-discount-button = Diskon
retail-resume-button = Resume
retail-credit-reminders = Credit Reminders ({ $count })
retail-fn-void = Void
retail-fn-diskon = Diskon
retail-fn-cari = Cari
retail-fn-history = History
retail-fn-pelanggan = Pelanggan
retail-fn-stok = Stok
retail-fn-shift = Shift
retail-fn-options = Options
retail-open-shift-opening-label = Opening balance (Rp)
retail-open-shift-opening = Opening…
retail-shift-closed-cash-sales = Cash Sales:
retail-credit-reminders-title = Credit Reminders
retail-reminder-dismiss-aria = Dismiss notifications
retail-reminder-low-stock-aria = View { $count } low-stock products
retail-reminder-credit-aria = View { $count } credit sales
retail-reminder-held-cart-aria = View { $count } held carts
retail-held-cart-reminders =
    { $count ->
        [one] { $count } held cart
       *[other] { $count } held carts
    }
retail-credit-no-outstanding = No outstanding credits
retail-credit-col-customer = Customer
retail-credit-col-amount = Amount
retail-credit-col-date = Date
retail-credit-settle = Settle
retail-clear-cart-title = Clear Cart
retail-clear-cart-confirm =
    Remove all { $count ->
        [one] { $count } item from the cart?
       *[other] { $count } items from the cart?
    }
retail-clear-cart-clear = Clear
retail-discount-title = Discount
retail-discount-pct-tab = %
retail-discount-rp-tab = Rp
retail-discount-pct-label = Discount (%)
retail-discount-rp-label = Discount (Rp)
retail-customer-search-title = Select Customer
retail-customer-search-placeholder = Search by name, phone, or email...
retail-customer-search-loading = Loading...
retail-customer-search-empty = No customers found
retail-customer-clear = Clear
retail-qty-total = Total:
retail-qty-picker-title = Select Quantity
retail-qty-add = Add
retail-qty-backspace-aria = Backspace
retail-shortcuts-title = Keyboard Shortcuts
retail-shortcut-pay = Pay / Charge
retail-shortcut-clear = Clear cart (Void)
retail-shortcut-discount = Discount
retail-shortcut-hold = Hold / Resume order
retail-shortcut-sku = Focus SKU input
retail-shortcut-shift = Open / Close shift
retail-shortcut-options = Options
retail-shortcut-list = This shortcut list
retail-shortcut-close = Close modal / Options
retail-shortcut-fullscreen = Toggle Fullscreen
retail-shortcut-credit = Credit reminders
retail-shortcut-low-stock = Filter low-stock products
retail-toast-failed-settings = Failed to load store settings
retail-toast-open-shift-first = Open a shift first
retail-toast-order-held = Order held
retail-toast-failed-hold = Failed to hold order
retail-toast-failed-resume = Failed to resume order
retail-toast-corrupt-cart = Held cart data is corrupted and has been removed
retail-toast-sale-complete = Sale complete
retail-toast-credit-settled = Credit settled
retail-toast-failed-settle = Failed to settle credit
retail-toast-failed-open-shift = Failed to open shift
retail-toast-failed-load-held = Failed to load held carts
retail-toast-held-cart-deleted = Held cart deleted
retail-toast-failed-delete-held = Failed to delete held cart
retail-toast-failed-cart = Failed to create sale cart
retail-toast-no-cart = No active sale cart
retail-override-btn = Override
retail-cart-course-aria = Course for { $name }
retail-cart-modifier-aria = Modifiers for { $name }
retail-cart-modifier-btn = Modifiers
retail-override-aria = Override price for { $name }
retail-serial-placeholder = Serial #
retail-serial-aria = Serial number for { $name }
retail-held-carts-title = Held Carts
retail-held-carts-empty = No held carts
retail-fn-bar-aria = Function bar
retail-page-nav-aria = Product pages
retail-page-prev-aria = Previous page
retail-page-next-aria = Next page
retail-cart-qty-decrease-aria = Decrease quantity of { $sku }
retail-cart-qty-increase-aria = Increase quantity of { $sku }
retail-cart-remove-aria = Remove { $sku } from cart
retail-toast-insufficient-stock = Insufficient stock for { $name }
retail-toast-customers-failed = Failed to load customers
retail-sku-not-found = No product matches SKU "{ $sku }"
retail-added-to-cart = Added { $name }
retail-no-low-stock-products = No products below the low-stock threshold
retail-low-stock-banner =
    { $count ->
        [one] { $count } product low on stock
       *[other] { $count } products low on stock
    }
retail-held-cart-delete-aria = Delete held cart
retail-held-cart-resume-aria = Resume cart
retail-held-cart-delete-title = Delete Held Cart
retail-held-cart-delete-confirm = Delete "{ $label }"? This cannot be undone.
retail-held-cart-delete-btn = Delete



# ── Scale indicator widget ────────────────────────────────────────────────────
scale-indicator-aria = Scale weight indicator
scale-idle = Scale
scale-stable = Stable
scale-unstable = …
scale-read-error = Scale error
scale-weigh-add = Weigh & Add
scale-weigh-add-aria = Weigh & add { $name }
scale-weigh-added = Added { $weight }g of { $name }
scale-target-set = { $name } selected for weighing
scale-clear-aria = Clear weigh target

# ── Retail POS shortcut keys ───────────────────────────────────────────────
retail-fn-quick-return = Quick Return
retail-filtered-low-stock = Filtered: { $count } low-stock products
retail-filter-indicator-aria = Low-stock filter active

# ── Quick Return ──────────────────────────────────────────────────────
retail-quick-return-title = Quick Return
retail-quick-return-desc = Scan or enter the receipt barcode to look up a sale for return.
retail-quick-return-placeholder = Receipt barcode
retail-quick-return-aria = Receipt barcode input
retail-quick-return-lookup = Look Up
retail-quick-return-not-found = Sale not found for this receipt barcode
retail-quick-return-error = Failed to look up receipt
retail-header-workspaces-title = Back to workspaces
retail-resize-handle-aria = Resize cart panel

# ── Retail skip-to-content ────────────────────────────────────────────
retail-skip-to-main = Skip to main content
retail-header-workspaces-aria = Back to workspaces

# ── Retail POS table columns ──
retail-col-sku = SKU / Code
retail-col-name = Product Name
retail-col-stock = Stock
retail-col-price = Price
retail-col-action = Action
retail-product-out-of-stock = Out of stock
retail-product-add-title = Add to Cart
retail-product-add-aria = Add { $name } to cart
retail-product-edit-title = Edit Product
retail-product-edit-aria = Edit { $name }
retail-product-weigh-aria = Weigh { $name }
retail-edit-modal-close-aria =
    .aria-label = Close

# ── Edit Product Modal ──
retail-edit-product-title = Edit Product
retail-edit-field-sku = SKU / Code
retail-edit-field-name = Product Name
retail-edit-field-price = Price (IDR)
retail-edit-field-stock = Stock Quantity
retail-edit-field-low-stock = Low Stock Threshold
retail-edit-field-high-stock = High Stock Threshold
retail-edit-save = Save Changes
retail-edit-cancel = Cancel
retail-course-none = None
retail-edit-btn-aria = Edit product { $name }

# ── Add Category / Add Product Modals ──
retail-add-category-btn = + Category
retail-add-category-btn-aria = Add new category
retail-add-category-btn-title = Add new category
retail-add-category-title = Add Category
retail-add-category-field-name = Category Name
retail-add-category-name-placeholder = e.g. Storage, Peripherals, Accessories
retail-add-product-btn = + Product
retail-add-product-btn-aria = Add new product
retail-add-product-btn-title = Add new product
retail-add-product-title = Add Product
retail-add-product-category-label = Category
retail-add-product-name-placeholder = e.g. Logitech G Pro X Wireless Mouse
retail-sku-lookup-aria = Look up SKU

# ── Retail POS table columns (ADR #36 D4) ──
retail-col-barcode = Barcode
retail-col-category = Category
retail-col-brand = Brand
retail-col-rack = Rack
retail-col-notes = Notes
retail-col-popularity = Popularity
retail-col-popularity-title = Sort by popularity
retail-col-hide-inactive = Hide inactive products
retail-col-toggle-btn = Columns
retail-col-toggle-title = Show / hide columns
retail-col-toggle-aria = Choose visible columns

# ── Retail view-mode toggle (spec 0046b §3.5) ──
retail-view-grid-label = Grid
retail-view-text-label = Text
retail-view-grid-title = Show products as an image grid
retail-view-text-title = Show products as a text table

# ── Retail product attributes (ADR #36 D5) ──
retail-edit-field-cost = Cost (IDR)
retail-edit-field-unit = Unit
retail-edit-field-brand = Brand
retail-edit-field-rack = Rack
retail-edit-field-notes = Notes
retail-edit-field-active = Active (sellable)
retail-edit-cost-override-hint = Restocking — update the cost to the latest purchase price
retail-toast-save-product-failed = Failed to save product

# ── Retail row context menu (ADR #38) ──
retail-row-menu-aria = Product actions
retail-row-menu-view-images = View product images

# ── Product Lookup rack (ADR #36 D6) ──
product-lookup-rack-title = Rack position

# ── Gift Cards ─────────────────────────────────────────────────────
gift-cards-loading = Loading...
gift-cards-status-all = All Statuses
gift-cards-status-active = Active
gift-cards-status-frozen = Frozen
gift-cards-status-redeemed = Redeemed
gift-cards-status-expired = Expired
gift-cards-info-initial-balance = Initial Balance
gift-cards-info-issued = Issued
gift-cards-info-expires = Expires
gift-cards-freeze = Freeze
gift-cards-unfreeze = Unfreeze
gift-cards-top-up = Top Up
gift-cards-confirm-topup = Confirm Top-Up
gift-cards-cancel-topup = Cancel
gift-cards-recent-transactions = Recent Transactions
gift-cards-txn-type = Type
gift-cards-txn-amount = Amount
gift-cards-txn-balance = Balance
gift-cards-txn-notes = Notes
gift-cards-txn-date = Date

# C2.2: QRIS is a Plus+ feature — upgrade prompt on the payment modal.
payment-qris-upgrade-required = QRIS payments are a Plus feature. Upgrade to Plus to accept QRIS.
payment-qris-upgrade-cta = Upgrade to Plus

# ── Receipt Preview ──
receipt-preview-aria = Receipt Preview
receipt-preview-store-name = OZ-POS Store
receipt-preview-col-item = Item
receipt-preview-col-qty = Qty
receipt-preview-col-price = Price
receipt-preview-col-total = Total
receipt-preview-subtotal = SUBTOTAL:
receipt-preview-tax = TAX:
receipt-preview-total = TOTAL:
receipt-preview-change = CHANGE:
receipt-preview-qr-label = Scan to pay
receipt-preview-qr-aria = Payment QR code
receipt-preview-thanks = Thank you for your purchase!
receipt-preview-skip = Skip
receipt-preview-print = Print Receipt

# Dashboard
# Daily Sales Dashboard — Free tier lock (C2.2, §6)
daily-dashboard-locked-title = Daily Sales Dashboard
daily-dashboard-locked-message = See your daily revenue, sales count, and item breakdown at a glance. This feature is available on Plus and above.
daily-dashboard-locked-cta = Upgrade to Plus

pos-promotions-dialog-aria = Promotions picker
pos-promotions-close-aria = Close promotions
pos-promotions-title = Promotions
pos-promotions-loading = Loading promotions…
pos-promotions-empty = No active promotions
pos-promotions-load-failed = Failed to load promotions
pos-promotions-value-percent = { $value }% off
pos-promotions-value-fixed = { $value } minor units off
pos-promotions-value-bxgy = Buy X get Y
pos-promotions-not-applicable = Not applicable in this checkout yet
pos-promotions-min-order = Requires a minimum order of { $min }
pos-promotions-applied = Promotions applied: { $name }
pos-promotions-toggle-aria = Toggle promotion { $name }
pos-promotions-selected-count = { $count } selected
pos-promotions-apply-selected = Apply promotions
pos-promotions-apply-aria = Apply promotion { $name }
pos-promotions-unavailable-aria = Promotion { $name } is not applicable

# ── Product image editor (spec 0046b §3.2–3.3) ──
retail-edit-image-title = Product Images
retail-edit-image-primary = Primary image
retail-edit-image-alternatives = Additional images
retail-edit-image-set = Set Image
retail-edit-image-set-aria = Choose a new image for { $name }
retail-edit-image-set-alt-aria = Choose additional image { $slot } for { $name }
retail-edit-image-replace = Replace
retail-edit-image-replace-aria = Replace the image for { $name }
retail-edit-image-clear = Remove
retail-edit-image-clear-aria = Remove the image for { $name }
retail-edit-image-clear-alt-aria = Remove additional image { $slot } for { $name }
retail-edit-image-uploading = Uploading image…
retail-edit-image-error = Could not update the image. Try again.
retail-edit-image-menu-note = Menu items always have exactly one image.
retail-edit-image-alt = { $name } image { $slot }