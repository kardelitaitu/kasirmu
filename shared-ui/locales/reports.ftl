# shared-ui/locales/reports.ftl — Sales report

sales-report-title = Sales Report
sales-report-daily = Daily
sales-report-weekly = Weekly
sales-report-monthly = Monthly
sales-report-start-date = Start
sales-report-end-date = End
sales-report-revenue-chart = Revenue
sales-report-category-breakdown = By Category
sales-report-hourly-heatmap = Busiest Hours
sales-report-top-products = Top Products
sales-report-total-revenue = Total:
sales-report-total-orders = Orders:
sales-report-total-gross-profit = Gross Profit:
sales-report-total-refunds = Refunds:
sales-report-total-net-revenue = Net Revenue:
sales-report-export-csv = Export CSV
sales-report-revenue-label = Revenue
sales-report-rank = #
top-products-name = Name
top-products-quantity = Qty
top-products-revenue = Revenue
top-products-gross-profit = Gross Profit
top-products-margin = Margin
sales-report-top-rank-aria = Rank top products by
sales-report-top-rank-revenue-aria = Rank by revenue
sales-report-top-rank-profit-aria = Rank by gross profit
sales-report-category-popularity = Category Popularity
sales-report-category-popularity-category = Category
sales-report-category-popularity-products = Products
sales-report-category-popularity-mean = Popularity
sales-report-category-popularity-mean-tip = Category average vs. catalog average
sales-report-category-popularity-top = Top Sellers
sales-report-category-popularity-uncategorized = Uncategorized
sales-report-popularity-trend = Popularity Trend
sales-report-demand-forecast = Demand Forecast
sales-report-category-forecast = Category Forecast
sales-report-demand-forecast-category = Category
sales-report-demand-forecast-avg = Avg / period
sales-report-demand-forecast-trend = Trend
sales-report-demand-forecast-next = Next period
heatmap-title = Busiest Hours
heatmap-no-data = No data
sales-report-hourly-heatmap-aria = Hourly heatmap
day-sunday = Sun
day-monday = Mon
day-tuesday = Tue
day-wednesday = Wed
day-thursday = Thu
day-friday = Fri
day-saturday = Sat

# Dashboard
dashboard-title = Dashboard
dashboard-revenue = Revenue
dashboard-gross-profit = Gross Profit
dashboard-orders = Orders
dashboard-top-product = Top Product
dashboard-low-stock-alerts = Low Stock Alerts
dashboard-no-data = No data yet
dashboard-stock-ok = All stock levels are healthy.

# Dashboard — date range
dashboard-filter-from = From
dashboard-filter-to = To
dashboard-btn-apply = Apply

# Dashboard — granularity toggle
dashboard-granularity-aria = Time granularity
dashboard-granularity-daily = Daily
dashboard-granularity-weekly = Weekly
dashboard-granularity-monthly = Monthly

# Dashboard — charts
dashboard-chart-revenue = Revenue Trend
dashboard-chart-revenue-aria = Revenue and profit trend chart
dashboard-chart-profit = Profit
dashboard-chart-category-breakdown = Category Breakdown
dashboard-chart-category-aria = Sales breakdown by product category
dashboard-chart-category = Categories
dashboard-chart-heatmap = Sales Heatmap
dashboard-chart-heatmap-aria = Hourly sales heatmap by day of week
dashboard-chart-top-products = Top 10 Products
dashboard-chart-top-products-aria = Top 10 products by revenue
dashboard-heatmap-empty = No heatmap data yet
dashboard-heatmap-tooltip = { $day } { $hour }: { $count } orders

# Dashboard — a11y
dashboard-region-aria = Dashboard
dashboard-stock-alerts-aria = Low stock alerts
dashboard-stock-below-threshold = { $qty } left (below { $threshold })

# Menu Engineering
menu-eng-title = Menu Engineering
menu-eng-products = Products
menu-eng-total-revenue = Total Revenue
menu-eng-total-margin = Total Margin
menu-eng-margin-rate = Margin Rate
menu-eng-scatter-title = Volume vs. Margin Matrix
menu-eng-table-title = Product Breakdown
menu-eng-quadrant = Quadrant
menu-eng-recommendation = Recommendation
menu-eng-median-volume = Median Volume
menu-eng-median-margin = Median Margin
menu-eng-star = Star
menu-eng-plowhorse = Plowhorse
menu-eng-puzzle = Puzzle
menu-eng-dog = Dog
menu-eng-loading-aria = Loading menu engineering report
menu-eng-region-aria = Menu Engineering Report
menu-eng-start-date-aria = Start date
menu-eng-end-date-aria = End date
menu-eng-export-csv-aria = Export CSV
menu-eng-tooltip-volume = Volume
menu-eng-tooltip-revenue = Revenue
menu-eng-tooltip-margin = Margin
menu-eng-tooltip-price = Price
menu-eng-tooltip-cost = Cost
menu-eng-sku-header = SKU
menu-eng-margin-header = Margin
menu-eng-margin-unit-header = Margin/Unit
menu-eng-axis-volume = Volume (units sold)
menu-eng-axis-margin = Total Margin
menu-eng-legend-star = ● Star (high vol, high margin)
menu-eng-legend-plowhorse = ▲ Plowhorse (high vol, low margin)
menu-eng-legend-puzzle = ◆ Puzzle (low vol, high margin)
menu-eng-legend-dog = ▼ Dog (low vol, low margin)
menu-eng-table-aria = Menu engineering product breakdown
menu-eng-rec-star = Promote Star — high volume & high margin. Feature prominently.
menu-eng-rec-plowhorse = Increase Price on Plowhorse — high volume but low margin. Raise price or reduce cost.
menu-eng-rec-puzzle = Reposition Puzzle — low volume but high margin. Improve visibility or bundle.
menu-eng-rec-dog = Remove Dog — low volume & low margin. Consider delisting.

# Sales Report — a11y labels
sales-report-region-aria = Sales Report
sales-report-start-aria = Start date
sales-report-end-aria = End date
sales-report-view-aria = View mode
sales-report-compare-off-aria = Disable period comparison
sales-report-compare-on-aria = Compare to previous period
sales-report-print-aria = Print report
sales-report-export-aria = Export CSV
sales-report-heatmap-aria = Hourly heatmap

# Period comparison
sales-report-compare = Compare

# Custom Report Builder
custom-report-title = Custom Report
custom-report-dataset = Dataset
custom-report-start = Start
custom-report-end = End
custom-report-columns = Columns
custom-report-run = Run Report
custom-report-results = Results
custom-report-export-csv = Export CSV
custom-report-no-columns-match = No columns match your search

# Custom Report — a11y labels
custom-report-dataset-aria = Dataset
custom-report-start-aria = Start date
custom-report-end-aria = End date
custom-report-search-placeholder = Search columns…
custom-report-search-aria = Search columns
custom-report-search-clear-aria = Clear search
custom-report-columns-aria = Column selection
custom-report-run-aria = Run report
custom-report-region-aria = Custom Report Builder
custom-report-export-aria = Export CSV
custom-report-columns-selected = { $selected } / { $total } selected

# Custom Report — Pagination (REP-07)
custom-report-truncated = Results limited to { $limit } rows. Use pagination to view more.
custom-report-pagination-aria = Results pagination
custom-report-prev-page = Previous
custom-report-prev-page-aria = Previous page
custom-report-next-page = Next
custom-report-next-page-aria = Next page
custom-report-page-of = Page { $page }

# Export
dashboard-export-csv = CSV
dashboard-export-csv-aria = Export dashboard data as CSV
dashboard-category-clear-aria = Clear category selection
dashboard-back = Back
dashboard-back-aria = Back to home
dashboard-error-load = Failed to load dashboard data. Please try again.
dashboard-refreshing = Refreshing…
dashboard-delta-new = New

# Dashboard — CSV export columns
dashboard-export-col-date = Date
dashboard-export-col-revenue = Revenue
dashboard-export-col-profit = Gross Profit
dashboard-export-col-orders = Orders
