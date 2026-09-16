# ui/src/locales/products.ftl — Product management, lookup, variants

# ── Restaurant Menu ──────────────────────────────────────────────────
restaurant-menu-search-placeholder = Search Menu
restaurant-menu-hamburger-aria = Menu
restaurant-menu-back-aria = Back to workspaces
restaurant-menu-close = Close
restaurant-menu-close-aria = Close menu
restaurant-size-decrease-aria = Decrease size
restaurant-size-increase-aria = Increase size
restaurant-font-size-decrease-aria = Decrease font size
restaurant-font-size-increase-aria = Increase font size
restaurant-font-size-label = Font Size
restaurant-theme-light = Light Mode
restaurant-theme-dark = Dark Mode
restaurant-lock-terminal = Lock Terminal
restaurant-toggle-fullscreen = Toggle Fullscreen
restaurant-clear-color-aria = Clear color
restaurant-categories-aria = Menu categories
restaurant-menu-loading = Loading menu…
restaurant-menu-empty = Menu is empty
restaurant-menu-no-match = No items match your search
restaurant-menu-clear-search = Clear search
restaurant-menu-retry = Retry
restaurant-size-label = Size
restaurant-sort-label = Sort
# Sort options for the restaurant menu grid. RestaurantMenu.tsx:732 builds
# these ids by interpolating the mode value from the as-const tuple at
# RestaurantMenu.tsx:719, so no static gate can see the reference — the keys
# were simply never written, and every sort button fell through to its
# hardcoded JSX child. Surfaced by the template-family sweep in the Fluent
# page audit.
restaurant-sort-manual = Manual
restaurant-sort-a-z = A–Z
restaurant-sort-date = By Date
restaurant-sort-popularity = Popularity
restaurant-card-add = Add
restaurant-card-unavailable = Unavailable
restaurant-context-color-label = Color
restaurant-search-aria = Search menu items
restaurant-search-clear-aria = Clear search
restaurant-context-pin = Pin to top
restaurant-context-unpin = Unpin from top
restaurant-context-menu-aria = Menu item actions
restaurant-context-available = Mark available
restaurant-context-unavailable = Mark unavailable
restaurant-card-pin-title = Pinned to top
restaurant-menu-items-aria = Menu items
restaurant-color-swatch-aria = Color { $color }

# Product Lookup
product-lookup-dev-fallback = Using sample data (IPC unavailable)
product-lookup-search-placeholder =
    .placeholder = Search products…
product-lookup-search-aria =
    .aria-label = Search for products by name, SKU, or barcode
product-lookup-barcode-placeholder =
    .placeholder = Scan barcode…
product-lookup-barcode-aria =
    .aria-label = Enter or scan a barcode
product-lookup-barcode-scan = Scan
product-lookup-scan-btn-aria =
    .aria-label = Submit the entered barcode
product-lookup-no-results = No products found
product-lookup-clear-search = Clear search
product-lookup-loading = Loading products…
product-lookup-in-stock = In stock
product-lookup-out-of-stock = Out of stock
product-lookup-all-categories = All Categories
product-lookup-categories-aria = Filter by category
product-lookup-grid-aria = Product search results
product-lookup-card-aria =
    .aria-label = { $name } — { $price }. SKU: { $sku }. { $stock }
product-lookup-bundle-added = Bundle "{ $name }" added — { $count } items
product-lookup-no-match = No product or bundle matches this barcode
product-lookup-uncategorised = Uncategorised
product-lookup-error-load = Failed to load products

# Product Management
product-mgmt-title = Products
product-mgmt-add = Add Product
product-mgmt-empty = No products yet.
product-mgmt-empty-cta = Add your first product
product-mgmt-col-sku = SKU
product-mgmt-col-name = Name
product-mgmt-col-category = Category
product-mgmt-col-price = Price
product-mgmt-col-barcode = Barcode
product-mgmt-col-stock = Stock
product-mgmt-stock-in = In stock
product-mgmt-stock-out = Out of stock
product-mgmt-edit = Edit
product-mgmt-edit-aria = Edit { $name }
product-mgmt-delete = Delete
product-mgmt-delete-aria = Delete { $name }
product-mgmt-delete-confirm-title = Delete product?
product-mgmt-delete-confirm-message = Delete { $name } ({ $sku })? This cannot be undone.
product-mgmt-delete-confirm-btn = Delete
product-mgmt-error-delete = Failed to delete product
product-mgmt-error-load = Failed to load products
product-mgmt-error-retry = Retry
product-mgmt-alert-error = Could not load stock alerts. Showing last known count.
product-mgmt-alert-error-retry = Reload alerts
product-mgmt-error-invalid-stock = Stock must be a whole, non-negative number
product-mgmt-modal-add-title = Add Product
product-mgmt-modal-edit-title = Edit Product
product-mgmt-modal-close = Close
product-mgmt-field-name-required = Name *
product-mgmt-field-sku-required = SKU *
product-mgmt-field-price = Price (minor units)
product-mgmt-field-currency = Currency
product-mgmt-field-category = Category
product-mgmt-field-barcode = Barcode
product-mgmt-field-tax-rates = Tax Rates
product-mgmt-field-stock = Initial stock
product-mgmt-btn-cancel = Cancel
product-mgmt-btn-create = Create
product-mgmt-btn-update = Update
product-mgmt-error-save = Failed to save product
product-mgmt-error-invalid-price = Price must be a valid non-negative number
product-mgmt-table-aria = Product catalog
product-mgmt-actions-aria =
    .aria-label = Actions
product-mgmt-variants = Variants
product-mgmt-variants-aria = Variants for { $name }
product-mgmt-modal-aria = { $mode ->
        [add] Add product
       *[edit] Edit product
    }
product-mgmt-modal-close-aria =
    .aria-label = Close
product-mgmt-sku-placeholder =
    .placeholder = e.g. LATTE
product-mgmt-name-placeholder =
    .placeholder = e.g. Caffè Latte
product-mgmt-price-placeholder =
    .placeholder = 450
product-mgmt-barcode-placeholder =
    .placeholder = 4901234567890
product-mgmt-stock-placeholder =
    .placeholder = 0
product-mgmt-no-category = — No category —
product-mgmt-col-type = Type
product-mgmt-field-type = Type
product-mgmt-alerts-title = Stock Alerts
product-mgmt-alert-close = Close

# Product Variants
variant-mgmt-title = Variants — { $product }
variant-mgmt-empty = No variants yet.
variant-mgmt-empty-cta = Add a variant
variant-mgmt-add = Add Variant
variant-mgmt-col-name = Name
variant-mgmt-col-sku = SKU
variant-mgmt-col-price = Price
variant-mgmt-col-barcode = Barcode
variant-mgmt-col-status = Status
variant-mgmt-price-parent = Uses parent price
variant-mgmt-status-active = Active
variant-mgmt-status-inactive = Inactive
variant-mgmt-edit = Edit
variant-mgmt-edit-aria =
    .aria-label = Edit { $name }
variant-mgmt-delete = Delete
variant-mgmt-delete-aria =
    .aria-label = Delete { $name }
variant-mgmt-delete-confirm-title = Delete Variant
variant-mgmt-delete-confirm-body = Are you sure you want to delete variant "{ $name }" ({ $sku })? This action cannot be undone.
variant-mgmt-delete-confirm-cancel = Cancel
variant-mgmt-delete-confirm-confirm = Delete
variant-mgmt-modal-add-title = Add Variant
variant-mgmt-modal-edit-title = Edit Variant
variant-mgmt-close-aria =
    .aria-label = Close
variant-mgmt-field-name-required = Name *
variant-mgmt-field-sku-required = SKU *
variant-mgmt-field-price = Price (minor units)
variant-mgmt-field-currency = Currency
variant-mgmt-field-barcode = Barcode
variant-mgmt-field-sort-order = Sort order
variant-mgmt-field-active = Active
variant-mgmt-btn-cancel = Cancel
variant-mgmt-error-retry = Retry
variant-mgmt-btn-create = Create
variant-mgmt-btn-update = Update
variant-mgmt-overlay-aria = Variants for { $name }
variant-mgmt-table-aria = Product variants
variant-mgmt-actions-aria =
    .aria-label = Actions
variant-mgmt-name-placeholder =
    .placeholder = e.g. Large
variant-mgmt-sku-placeholder =
    .placeholder = e.g. TEA-LARGE
variant-mgmt-price-placeholder =
    .placeholder = 450
variant-mgmt-currency-placeholder =
    .placeholder = USD
variant-mgmt-barcode-placeholder =
    .placeholder = 4901234567890
variant-mgmt-sort-placeholder =
    .placeholder = 0
variant-mgmt-error-load = Failed to load variants
variant-mgmt-error-save = Failed to save variant
variant-mgmt-error-delete = Failed to delete variant
variant-mgmt-error-invalid-price = Variant price must be a whole, non-negative number
variant-mgmt-error-invalid-sort = Sort order must be a whole, non-negative number

# Category Management
categories-title = Categories
categories-no-categories = No categories yet
categories-empty-desc = Get started by creating your first category
categories-add-first = Add your first category
categories-add = Add Category
categories-name = Name
categories-name-placeholder =
    .placeholder = e.g. Bakery, Merchandise
categories-colour = Colour
categories-icon = Icon
categories-id-preview = ID Preview
categories-edit = Edit
categories-create = Create
categories-save = Save
categories-delete-confirm = Delete Category
categories-delete-warning = This will unlink all products in this category.
categories-delete-unlinked = { $count ->
    [one] Unlinked 1 product in this category.
   *[other] Unlinked { $count } products in this category.
}
categories-error-create = Failed to create category
categories-error-update = Failed to update category
categories-error-delete = Failed to delete category
categories-error-load = Failed to load categories
categories-error-retry = Retry
categories-error-name-required = Category name is required
categories-error-id-conflict = A category with this ID already exists
categories-error-colour-invalid = Choose a colour from the palette
categories-preview = Preview
categories-name-aria = Category Name
categories-icon-picker-aria = Pick an icon
categories-colour-picker-aria = Pick a colour
categories-icon-food = Food
categories-icon-snack = Snack
categories-icon-hot-drink = Hot drink
categories-icon-cold-drink = Cold drink
categories-icon-generic = Generic
category-mgmt-edit-aria = Edit category { $name }

# Product type labels
product-type-retail = Retail
product-type-restaurant = Restaurant
product-type-service = Service

# Stock Alert Panel
product-mgmt-stock-alert-open = Open stock alerts
product-mgmt-stock-alert-close = Close stock alerts
product-mgmt-alert-count =
    { $count ->
        [one] Open stock alerts ({ $count } active)
       *[other] Open stock alerts ({ $count } active)
    }
