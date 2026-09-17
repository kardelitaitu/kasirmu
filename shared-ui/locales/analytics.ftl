# shared-ui/locales/analytics.ftl — Staff analytics (analytics:view — owner/admin/manager)

analytics-title = Analytics
analytics-subtitle = Sales, products, and staff performance
analytics-region-aria = Staff analytics

# Export
analytics-export-csv = CSV
analytics-export-csv-aria = Export staff data as CSV
analytics-export-waitstaff-aria = Export waitstaff as CSV
analytics-export-top-items-aria = Export top items as CSV
analytics-export-payments-aria = Export payments as CSV
analytics-export-category-aria = Export categories as CSV
analytics-export-revenue-aria = Export revenue as CSV
analytics-export-aov-aria = Export average order value as CSV
analytics-export-basket-aria = Export basket size as CSV
analytics-export-col-name = Name
analytics-export-col-shifts = Shifts
analytics-export-col-closed = Closed shifts
analytics-export-col-orders = Orders
analytics-export-col-sales = Total sales
analytics-export-col-shift-sales = Shift sales
analytics-export-col-sku = SKU
analytics-export-col-units = Units sold
analytics-export-col-revenue = Revenue
analytics-export-col-method = Payment method
analytics-export-col-category = Category
analytics-export-col-share = Share %
analytics-export-col-period = Period
analytics-export-col-aov = Average order value
analytics-export-col-basket = Avg items per order
analytics-export-customers-aria = Export customers as CSV
analytics-export-discounts-aria = Export discounts as CSV
analytics-export-refunds-aria = Export refunds as CSV
analytics-export-voids-aria = Export voids as CSV
analytics-export-low-stock-aria = Export low stock as CSV
analytics-export-tables-aria = Export table turnover as CSV
analytics-export-inventory-aria = Export inventory as CSV
analytics-export-occupancy-aria = Export occupancy as CSV
analytics-export-col-code = Code
analytics-export-col-redemptions = Redemptions
analytics-export-col-qty = Quantity
analytics-export-col-stock = Current stock
analytics-export-col-reorder = Reorder
analytics-export-col-restock-cost = Restock cost
analytics-export-col-segment = Segment
analytics-export-col-customers = Customers
analytics-export-col-turn = Avg turn (min)
analytics-export-col-hour = Hour
analytics-export-col-occupancy = Occupancy %
analytics-export-heatmap-aria = Export heatmap as CSV
analytics-export-col-date = Date
analytics-export-col-week = Week
analytics-export-col-day = Day
analytics-back = Back
analytics-back-aria = Back to home
analytics-workspace-select-aria = Select workspace type
analytics-workspace-retail = Retail
analytics-workspace-restaurant = Restaurant
analytics-granularity-aria = Time granularity
analytics-granularity-weekly = Weekly
analytics-granularity-monthly = Monthly
analytics-granularity-yearly = Yearly
analytics-granularity-custom = Custom

# Heatmap month abbreviations + tooltips
analytics-month-jan = Jan
analytics-month-feb = Feb
analytics-month-mar = Mar
analytics-month-apr = Apr
analytics-month-may = May
analytics-month-jun = Jun
analytics-month-jul = Jul
analytics-month-aug = Aug
analytics-month-sep = Sep
analytics-month-oct = Oct
analytics-month-nov = Nov
analytics-month-dec = Dec
analytics-heatmap-hour-tooltip = { $day } { $hour }:00
analytics-heatmap-day-tooltip = Day { $day }
analytics-heatmap-week-tooltip = { $month } week { $week }
analytics-heat-busiest = Busiest: { $label } · { $sales }
analytics-heat-quietest = Quietest: { $label } · { $sales }
analytics-heat-cell-orders = { $count ->
    [one] { $count } order
   *[other] { $count } orders
}
analytics-heat-cell-tooltip = { $label } · { $sales } · { $orders }

# Unit suffixes (KPI values + chart tooltips)
analytics-unit-minutes = { $n } min
analytics-unit-days = { $n } { $n ->
    [one] day
   *[other] days
}
analytics-custom-from = From
analytics-custom-to = To
analytics-action-refresh-aria = Refresh data
analytics-compare-on-aria = Compare with previous period
analytics-compare-off-aria = Turn off comparison
analytics-action-zoom-out-aria = Zoom out
analytics-action-zoom-in-aria = Zoom in

# ── Card titles ─────────────────────────────────────────────
analytics-card-heatmap = Heat Map
analytics-heat-scale-aria = Sales intensity scale
analytics-heat-scale-low = Less
analytics-heat-scale-high = More
analytics-card-revenue = Revenue Overview
analytics-card-aov = Average Order Value
analytics-card-staff = Staff Performance
analytics-card-customers = New vs Returning Customers
analytics-card-payments = Payment Methods
analytics-card-discounts = Discounts & Promotions
analytics-card-refunds = Refunds & Voids
analytics-card-top-products = Top Products
analytics-card-category = Sales by Category
analytics-category-currency-aria = Select currency for the category chart
analytics-card-basket = Average Basket Size
analytics-card-inventory = Stock Turnover
analytics-card-low-stock = Low Stock Alerts
analytics-card-top-menu = Top Menu Items
analytics-card-tables = Table Turnover
analytics-card-occupancy = Table Occupancy
analytics-card-waitstaff = Top Waitstaff
analytics-card-voids = Voided Items
analytics-card-expand-aria = Expand card
analytics-card-restore-aria = Restore card
analytics-status-cards = { $count } cards
analytics-status-range = { $from } – { $to }
analytics-cache-chip = cache
analytics-cache-metrics-aria = TTL cache metrics
analytics-cache-popover-title = Cache metrics
analytics-cache-summary = { $rate } · { $hits } hits · { $misses } misses · { $expiries } expired
analytics-cache-col-key = key
analytics-cache-col-hits = hits
analytics-cache-col-misses = misses
analytics-cache-col-expiries = expired
analytics-cache-col-evictions = evicted
analytics-cache-empty = No queries yet
analytics-cache-clear = Clear cache
analytics-cache-clear-aria = Clear the analytics cache
analytics-toast-cache-cleared = Cache cleared
analytics-action-zoom-reset-aria = Reset zoom to 100%
analytics-scroll-top-aria = Back to top
analytics-action-collapse-all-aria = Collapse all cards
analytics-action-expand-all-aria = Expand all cards
analytics-range-presets-aria = Quick date ranges
analytics-range-preset-7d = Last 7 days
analytics-range-preset-30d = Last 30 days
analytics-range-preset-90d = Last 90 days
analytics-range-preset-365d = Last year
analytics-shortcuts-aria = Keyboard shortcuts
analytics-shortcuts-title = Shortcuts
analytics-shortcuts-granularity = Time range: 1–4
analytics-shortcuts-refresh = Refresh: R
analytics-shortcuts-zoom = Zoom in / out: + / −
analytics-shortcuts-zoom-reset = Reset zoom: 0
analytics-shortcuts-collapse = Collapse all: C
analytics-shortcuts-close = Close / restore: Esc
analytics-reset-layout = Reset layout
analytics-palette-aria = Quick actions
analytics-palette-placeholder = Search actions…
analytics-palette-empty = No matches
analytics-palette-home = Back to home

# ── Card visuals ─────────────────────────────────────────────────
analytics-card-vs-prev = vs previous period
analytics-card-prev = previous period
analytics-rank-up = up
analytics-rank-down = down
analytics-rank-delta-aria = { $name }: { $value }, { $dir } { $pct }% vs previous period
analytics-card-total-revenue = Total revenue
analytics-card-peak = Peak: { $label } · { $value }
analytics-card-low = Low: { $label } · { $value }
analytics-card-staff-sales = Staff sales total
analytics-card-customers-total = Total customers
analytics-card-customers-new-share = { $pct }% new customers
analytics-card-payments-top = Top payment method
analytics-card-customers-new = New
analytics-card-customers-returning = Returning
analytics-card-payments-cash = Cash
analytics-card-payments-card = Card
analytics-card-payments-qris = QRIS
analytics-card-payments-ewallet = E-wallet
analytics-card-discounts-redeemed = redeemed
analytics-card-category-top = Top category
analytics-card-top-product = Top product
analytics-card-discounts-share = of sales from discounts
analytics-card-refunds-count = Refund count
analytics-card-refunds-amount = Refunded amount
analytics-card-refunds-avg = Average refund
analytics-csv-col-currency = Currency
analytics-card-inventory-turnover = Turnover
analytics-card-inventory-days = Days of stock
analytics-card-inventory-skus = Active SKUs
analytics-card-basket-items = items / order
analytics-card-basket-orders = orders
analytics-card-low-stock-left = left
analytics-card-low-stock-restock = Est. restock cost
analytics-card-low-stock-items = items flagged
analytics-card-low-stock-critical = Critical items
analytics-card-low-stock-order = Order { $n }
analytics-card-tables-turn = Avg. turn time
analytics-card-occupancy-occupied = occupied
analytics-card-occupancy-peak = Peak hour
analytics-card-occupancy-orders = table orders
analytics-card-occupancy-hourly = Occupancy by hour
analytics-card-voids-count = Voided items
analytics-card-waitstaff-covers = covers
analytics-card-waitstaff-total = Total covers
analytics-card-error-load = Couldn't load this chart. Check your connection and refresh.
analytics-empty-generic = No data in this period.
analytics-empty-low-stock = All items are sufficiently stocked.
analytics-empty-heatmap = No sales recorded in this range.
analytics-toast-layout-saved = Layout saved
analytics-toast-layout-reset = Layout reset to default
analytics-toast-zoom-reset = Zoom reset to 100%
analytics-toast-refreshing = Refreshing data…
analytics-toast-compare-on = Comparing with previous period
analytics-toast-compare-off = Comparison off
analytics-toast-collapsed = All cards collapsed
analytics-toast-expanded = All cards expanded
analytics-card-menu-aria = Card options
analytics-menu-move-up = Move up
analytics-menu-move-down = Move down
analytics-menu-move-top = Move to top
analytics-menu-move-bottom = Move to bottom
analytics-menu-collapse-card = Collapse card
analytics-menu-show-card = Show card
analytics-zoom-slider-aria = Zoom level

# ── Card descriptions (info tooltips) ──────────────────────────
analytics-card-desc-heatmap = Sales intensity across time, scaled by the selected time range.
analytics-card-desc-revenue = Total revenue for the selected period.
analytics-card-desc-aov = Average amount spent per order.
analytics-card-desc-staff = Performance summary per staff member.
analytics-card-desc-customers = Share of new versus returning customers.
analytics-card-desc-payments = Revenue split by payment method.
analytics-card-desc-discounts = Discounts and promotions applied.
analytics-card-desc-refunds = Refunds and voided transactions.
analytics-card-desc-top-products = Best-selling products by revenue and quantity.
analytics-card-desc-category = Revenue by product category.
analytics-card-desc-basket = Average number of items per transaction.
analytics-card-desc-inventory = How quickly stock sells through.
analytics-card-desc-low-stock = Products near or below reorder level.
analytics-card-desc-top-menu = Best-selling menu items by revenue and quantity.
analytics-card-desc-tables = Table turnover and covers served.
analytics-card-desc-occupancy = Table utilization over time.
analytics-card-desc-waitstaff = Top-performing waitstaff by covers served.
analytics-card-desc-voids = Items voided or removed from orders.

# C2.2: Analytics is a Pro+ feature — locked screen for lower tiers.
analytics-upgrade-required = Analytics is a Pro feature
analytics-upgrade-message = Unlock revenue, category, and hourly reports across all your stores. Upgrade to Pro to see your full analytics dashboard.
analytics-upgrade-cta = Upgrade to Pro

# Session expired banner — shown when an analytics command fails with
# InvalidSession (session TTL passed or backend restarted).
analytics-session-expired-title = Session expired
analytics-session-expired-message = Your session has expired. Sign in again to continue viewing analytics.
analytics-sign-in-again = Sign in again

# No workspace selected prompt — shown when the dashboard has no active workspace.
analytics-no-workspace-title = No workspace selected
analytics-no-workspace-message = Select a workspace to view analytics
analytics-select-workspace = Select workspace
