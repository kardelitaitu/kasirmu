# ui/src/locales/settings.ftl — Settings page, setup wizard, sync

# Setup Wizard
setup-logo = OZ-POS
# ── License: over-quota remediation (§J) ──
settings-license-quota-title = Quota status
settings-license-quota-intro = Resources measured against the { $tier } tier quotas — the same numbers the creation gates enforce.
settings-license-quota-ok = Everything is within quota.
settings-license-quota-over-aria = Over-quota resources
settings-license-quota-over-heading = Over quota — archive or upgrade
settings-license-quota-over-line = { $current } of { $limit } — { $excess } over
settings-license-quota-guidance = Archive unused resources in the relevant screen, or upgrade the tier to raise the limits. Nothing was deleted automatically.
settings-license-quota-load-failed = Could not load the quota assessment.
settings-license-quota-refresh = Refresh
settings-license-quota-dim-locations = Locations
settings-license-quota-dim-pos-registers = POS terminals
settings-license-quota-dim-warehouses = Warehouse stock points
settings-license-quota-dim-staff = Staff accounts
settings-license-quota-dim-products = Products
# §J B3 — the per-location KDS cap. It has no tenant-global usage row, so it
# needs a label of its own even though it is not a QuotaDimension in the
# tenant-global sense.
settings-license-quota-dim-kds-screens = KDS screens (this location)
# §J B3 — rows capped per location rather than per tenant.
settings-license-quota-loc-aria = Per-location quota limits
settings-license-quota-loc-title = Per-location limits
# B1's generic failure line gained a reason slot, because a refused store id
# and a dropped connection need different answers from the owner. The reason is
# the ERR-05/06 KIND-MAPPED message, never the backend's own sentence — which
# row it refers to is carried by the store id the card prints beside this line.
settings-license-quota-remedy-failed-detail = That action failed: { $reason }. The quota numbers above are unchanged.
# §J B1 — the two workspace-register remediation actions on the over-quota
# card. remedy-hint names the store because the card reads as tenant-wide while
# both actions are bound to one store; the copy must not imply otherwise.
settings-license-quota-remedy-aria = Workspace register remediation
settings-license-quota-remedy-title = Workspace registers
settings-license-quota-remedy-hint = Suspend the surplus registers of { $store }, or restore the ones an earlier downgrade suspended. Only this store is affected.
settings-license-quota-remedy-suspend = Suspend surplus
settings-license-quota-remedy-recover = Restore suspended
settings-license-quota-remedy-suspended = { $count } surplus register(s) suspended. They are disabled, not deleted.
settings-license-quota-remedy-recovered = { $count } suspended register(s) restored.
settings-license-quota-remedy-none = Nothing to change — no register of this store is over the limit or suspended.
setup-tagline = Point of Sale — Simplified
setup-step-store-type = Store Type
setup-step-payments = Payments
setup-step-products = Products
setup-step-staff = Staff
setup-step-hardware = Hardware
setup-step-business-rules = Business Rules
setup-step-data-cloud = Data & Cloud
setup-step-review = Review
setup-step-aria = Step { $number }: { $label }

setup-progress-aria = Setup progress

setup-preset-question = What kind of store are you running?
setup-preset-desc = Choose a preset to get started quickly, or customise every feature later.
setup-preset-group-aria = Store preset
# Accessible name for a feature toggle row. The code used to write
# `Toggle ${f.label}`, which concatenated the English word "Toggle" with the
# *unlocalized* array entry, so a screen reader announced "Toggle Inventory
# Tracking" to an Indonesian user even though the visible label was correct.
setup-feature-toggle-aria = Toggle { $name }

setup-preset-simple-retail = Simple Retail
setup-preset-simple-retail-desc = Barcode scan, cart, cash/card/QR, staff PIN, receipt printer
setup-preset-restaurant = Restaurant
setup-preset-restaurant-desc = Tables, KDS, split bill, QRIS, shift-based revenue
setup-preset-full-store = Full Store
setup-preset-full-store-desc = Everything except cloud sync and loyalty
setup-preset-custom = Custom
setup-preset-custom-desc = Start from scratch — enable exactly what you need

setup-preset-cafe = Cafe / Bakery
setup-preset-cafe-desc = Quick-service with kitchen display, cash+card, discounts
setup-preset-franchise = Franchise
setup-preset-franchise-desc = Multi-store, multi-terminal, restaurant + full admin stack

setup-features-title = { $title }
setup-features-desc = Toggle the features you need. You can change these later.
setup-features-group-aria = { $title }
setup-features-toggle-aria =
    .aria-label = Toggle { $label }

setup-features-section-payments = Payment Methods

# QRIS setup gate (C1 Free→Plus trigger — onboarding)
setup-qris-label = QRIS (Midtrans)
setup-qris-available = Accept QRIS payments — included with your plan.
setup-qris-included = Included
setup-qris-upgrade-required = QRIS payments are a Plus feature. Upgrade to Plus to accept QRIS.
setup-qris-upgrade-cta = Upgrade to Plus

setup-features-section-products = Products & Inventory
setup-features-section-staff = Staff Management
setup-features-section-hardware = Hardware & Peripherals
setup-features-section-business-rules = Business Rules
setup-features-section-data-cloud = Data, Reporting & Cloud

# Feature names (short — for review tags)
setup-feature-cash-payment = Cash
setup-feature-card-payment = Card
setup-feature-multi-currency = Multi-Currency
setup-feature-inventory-tracking = Inventory
setup-feature-product-variants = Variants
setup-feature-categories-enabled = Categories
setup-feature-staff-login = Staff Login
setup-feature-staff-roles = Staff Roles
setup-feature-shift-management = Shifts
setup-feature-audit-log = Audit Log
setup-feature-barcode-scanning = Barcode
setup-feature-receipt-printing = Receipts
setup-feature-cash-drawer = Cash Drawer
setup-feature-customer-display = Customer Display
setup-feature-nfc-reader = NFC
setup-feature-discount-engine = Discounts
setup-feature-tax-engine = Tax
setup-feature-loyalty-program = Loyalty
setup-feature-promotions-engine = Promotions
setup-feature-product-bundles = Bundles
setup-feature-reporting = Reports
setup-feature-analytics = Analytics
setup-feature-export-import = Export/Import
setup-feature-cloud-sync = Cloud Sync
setup-feature-multi-store = Multi-Store
setup-feature-multi-terminal = Multi-Terminal
setup-feature-plugin-system = Plugins

# Feature full labels (for toggle rows)
setup-feature-inventory-tracking-label = Inventory Tracking
setup-feature-product-variants-label = Product Variants
setup-feature-shift-management-label = Shift Management
setup-feature-barcode-scanning-label = Barcode Scanner
setup-feature-receipt-printing-label = Receipt Printer
setup-feature-nfc-reader-label = NFC Reader
setup-feature-tax-engine-label = Tax Engine
setup-feature-loyalty-program-label = Loyalty Program
setup-feature-product-bundles-label = Product Bundles
setup-feature-reporting-label = Reporting
setup-feature-export-import-label = Export & Import
setup-feature-plugin-system-label = Plugin System
setup-feature-cash-payment-label = Cash
setup-feature-card-payment-label = Card
setup-feature-multi-currency-label = Multi-Currency
setup-feature-categories-enabled-label = Categories
setup-feature-staff-login-label = Staff Login
setup-feature-staff-roles-label = Staff Roles
setup-feature-audit-log-label = Audit Log
setup-feature-cash-drawer-label = Cash Drawer
setup-feature-customer-display-label = Customer Display
setup-feature-discount-engine-label = Discounts
setup-feature-promotions-engine-label = Promotions
setup-feature-analytics-label = Analytics
setup-feature-cloud-sync-label = Cloud Sync
setup-feature-multi-store-label = Multi-Store
setup-feature-multi-terminal-label = Multi-Terminal

# Feature descriptions
setup-feature-cash-payment-desc = Accept cash payments and track cash drawer
setup-feature-card-payment-desc = Accept debit and credit card payments
setup-feature-multi-currency-desc = Support multiple currencies with exchange rates
setup-feature-inventory-tracking-desc = Track stock levels per product with alerts
setup-feature-product-variants-desc = Size, colour, flavour variants per product
setup-feature-categories-enabled-desc = Group products by category with colour coding
setup-feature-staff-login-desc = PIN or password login for cashiers
setup-feature-staff-roles-desc = Owner, manager, cashier permission levels
setup-feature-shift-management-desc = Open/close shifts with cash reconciliation
setup-feature-audit-log-desc = Immutable log of sensitive actions
setup-feature-barcode-scanning-desc = USB, serial, or Bluetooth barcode scanning
setup-feature-receipt-printing-desc = USB, serial, or network receipt printing
setup-feature-cash-drawer-desc = Automatic cash drawer via printer GPIO
setup-feature-customer-display-desc = Secondary display facing the customer
setup-feature-nfc-reader-desc = Contactless payment and loyalty card reading
setup-feature-discount-engine-desc = Percentage and fixed-amount discounts on items or cart
setup-feature-tax-engine-desc = Tax inclusive/exclusive with configurable rates
setup-feature-loyalty-program-desc = Customer points, tiers, and rewards
setup-feature-promotions-engine-desc = Buy-X-get-Y, time-limited offers, bundles
setup-feature-product-bundles-desc = Sell multiple SKUs together as a single item
setup-feature-reporting-desc = Sales, inventory, and shift reports
setup-feature-analytics-desc = Charts, top products, hourly heatmap, CSV exports
setup-feature-export-import-desc = Encrypted data export and import (.ozpkg)
setup-feature-cloud-sync-desc = Sync data to cloud PostgreSQL with backup
setup-feature-multi-store-desc = Manage multiple store locations
setup-feature-multi-terminal-desc = Multiple POS terminals per store
setup-feature-plugin-system-desc = Third-party plugins and custom drivers

setup-review-title = Review Your Setup
setup-review-desc = Here&rsquo;s a summary of your configuration. You can change anything later.
setup-review-preset = Preset: { $name }
setup-review-enabled = Enabled Features ({ $count })
setup-review-disabled = Disabled Features ({ $count })
setup-review-none = None
setup-review-all-on = Everything on!
setup-review-more = +{ $count } more

setup-default-currency-label = Default Currency

setup-complete-title = All Set!
setup-complete-desc = Your { $preset } POS is configured and ready. You can adjust settings anytime.
setup-launch = Launch OZ-POS
setup-complete-features = { $count } { $count ->
    [one] feature enabled
    *[other] features enabled
}
setup-back = Back
setup-skip = Skip setup
setup-finish = Complete Setup
setup-next = Next

# Live Setup Preview
lsp-title = Feature Preview
lsp-subtitle =
  The sidebar will show { $count } route(s) enabled by your selection
lsp-section-workspaces = Workspaces
lsp-section-nav = Navigation Items
lsp-workspaces-aria = Workspace preview
lsp-nav-aria = Navigation preview
lsp-nav-empty = No navigation items unlocked
lsp-nav-count = { $count } / { $total } items unlocked
lsp-ws-status-active = { $name } — active
lsp-ws-status-inactive = { $name } — inactive

ws-preview-name-restaurant-pos = Restaurant POS
ws-preview-name-store-pos = Store POS
ws-preview-name-kds = Kitchen Display
ws-preview-name-warehouse = Warehouse
ws-preview-name-admin = Admin

# Settings Page
settings-title = Settings
settings-page-title = Settings

# ── Sidebar navigation labels ──
settings-nav-general = General
settings-nav-sync = Cloud Sync
settings-nav-license = License
settings-nav-topology = Topology

# ── Settings screens scaffold (rebuild) ──
# One nav label per blank screen under features/settings/screens/. The General
# scaffold reuses settings-nav-general above; the twelve below pair one-to-one
# with the remaining files, in their own order.
settings-nav-license-subscription = License & Subscription
settings-nav-devices-connectivity = Devices & Connectivity
settings-nav-business-defaults = Business Defaults
settings-nav-features-modules = Features & Modules
settings-nav-security-account = Security & Account
settings-nav-data-sync = Data & Sync
settings-nav-data-management = Data Management
settings-nav-sync-status = Sync Status
settings-nav-offline-queue = Offline Queue
settings-nav-tax-configuration = Tax Configuration
settings-nav-exchange-rates = Exchange Rates
settings-nav-system-diagnostics = System Diagnostics
settings-screen-placeholder = This page is being rebuilt.
settings-screen-migrating = Existing settings content will move here selectively.
# The settings page floor gate: roleAtLeast (utils/role.ts) shows this copy to any
# role below the admin floor.
# Sidebar Plus badge: read by the flat nav items whose page is gated behind
# the Plus plan. Lands together with the badge markup that references it
# (orphan gate: a key must be referenced by its own commit).
settings-nav-plus-badge-aria = Requires Plus plan
settings-locked-title = Settings restricted
settings-locked-desc = Settings are available to owners and administrators only.
settings-sidebar-nav-aria = Settings navigation
settings-sidebar-expand-aria = Expand settings sidebar
settings-sidebar-collapse-aria = Collapse settings sidebar
settings-back-aria = Go back
settings-sidebar-search-aria = Search settings
settings-sidebar-search-clear-aria = Clear search
# Survives the flat IA: with no categories left, "collapse all" folds every
# page into the icon rail, i.e. collapses the sidebar.
settings-sidebar-collapse-all-aria = Collapse all pages
settings-search-placeholder = Search
settings-shortcut-btn-aria = Keyboard shortcuts
settings-shortcuts-title = Keyboard shortcuts
settings-sidebar-pinned-group-aria = Pinned sections
settings-sidebar-resize-aria = Resize sidebar
settings-nav-pin-aria = Pin { $name }
settings-nav-unpin-aria = Unpin { $name }
settings-nav-pin-title = Pin
settings-nav-unpin-title = Unpin
settings-sidebar-no-results = No matching sections
settings-sidebar-clear-results = Clear search

# ── Live-region announcements (localized via Fluent vars, P60-4e) ──
settings-announce-section-opened = { $section } settings opened
settings-announce-search-none = No settings match your search
settings-announce-search-count =
    { $count ->
        [one] { $count } result found
       *[other] { $count } results found
    }
settings-announce-search-cleared = Search cleared

# ── Keyboard shortcut descriptions (popover) ──
settings-shortcuts-desc-navigate = Navigate items
settings-shortcuts-desc-firstlast = First / last item
settings-shortcuts-desc-close = Close mobile sidebar

settings-theme-toggle-dark-aria = Switch to dark mode
settings-theme-toggle-light-aria = Switch to light mode
settings-loading = Loading settings…
settings-section-loading = Loading…
settings-load-partial = Some settings could not be loaded. Try again.
settings-section-store = Store
settings-section-currency = Currency
settings-currency-loading = Loading currencies…
settings-section-display = Display
settings-section-receipt = Receipt
settings-field-store-name = Store name
settings-field-address = Address
settings-field-branch = Branch
settings-field-tax-id = Tax / VAT ID
settings-field-default-currency = Default currency
settings-field-decimal-separator = Decimal separator
settings-field-paper-width = Paper width
settings-field-footer = Receipt footer

# ── Display sub-section fields ──
settings-field-card-size = Menu Card Size
settings-field-font-size = Font Size
settings-card-size-decrease-aria =
    .aria-label = Decrease card size
settings-card-size-increase-aria =
    .aria-label = Increase card size
settings-font-size-decrease-aria =
    .aria-label = Decrease font size
settings-font-size-increase-aria =
    .aria-label = Increase font size
settings-field-font-smoothing = Font Smoothing
settings-toggle-show-currency = Show currency symbol on amounts
settings-toggle-show-tax = Show tax line on receipts
settings-toggle-show-table-number = Show table number on cart and receipts
settings-btn-save = Save
settings-close-unsaved-title = Leave with unsaved changes?
settings-close-unsaved-msg = Your settings changes have not been saved. Closing now discards them.
settings-close-unsaved-discard = Discard & close
settings-close-unsaved-keep = Keep editing
settings-btn-revert = Revert

settings-btn-revert-aria =
    .aria-label = Revert settings to last saved state

settings-saved = Saved!
settings-section-sync = Cloud Sync
settings-sync-server-url = Server URL
settings-sync-api-key = API Key
settings-sync-enabled = Enable Cloud Sync
settings-sync-enabled-aria = Toggle cloud sync
settings-sync-sync-now = Sync Now
settings-sync-syncing = Syncing…
settings-sync-test-connection = Test Connection
settings-sync-testing = Testing…
settings-sync-test-failed = Connection test failed
settings-sync-token-request-failed = Token request failed — check server URL
settings-sync-request-token = Request Token
settings-sync-requesting = Requesting…
settings-sync-error = Sync failed
settings-sync-plan-required = Cloud sync requires a paid plan
settings-sync-plan-required-hint = Your local sales keep working — upgrade to sync them to the cloud.

# ── Token expiry badge ──────────────────────────────────
settings-sync-expiry-expired = Expired
settings-sync-expiry-in-days = { $count ->
    [one] Expires in 1 day
   *[other] Expires in { $count } days
}
settings-sync-expiry-in-hours = { $count ->
    [one] Expires in 1 hour
   *[other] Expires in { $count } hours
}
settings-sync-expiry-in-minutes = { $count ->
    [one] Expires in 1 minute
   *[other] Expires in { $count } minutes
}
settings-sync-expiry-less-than-minute = Expires in less than a minute
settings-sync-expiry-fallback = Expires { $iso }
settings-sync-result = Last sync: { $synced } synced, { $failed } failed
settings-sync-success = Sync complete: { $synced } synced, { $failed } failed
settings-sync-nothing = Nothing to sync — all caught up
settings-store-name-placeholder =
    .placeholder = OZ-POS Store
settings-address-placeholder =
    .placeholder = 123 Main Street
settings-tax-id-placeholder =
    .placeholder = 12-3456789
settings-branch-placeholder =
    .placeholder = Main Branch
settings-footer-placeholder =
    .placeholder = Thank you for shopping!
settings-server-url-placeholder =
    .placeholder = https://api.example.com
settings-api-key-placeholder = Enter API key
settings-api-key-masked = ••••••••
settings-api-key-show-aria = Show API key
settings-api-key-hide-aria = Hide API key
settings-btn-save-aria =
    .aria-label = { $state ->
        [saved] Saved!
       *[save] Save settings
    }
settings-save-error = Failed to save settings. Please try again.
settings-save-partial = Some settings could not be saved. Try again.
settings-load-failed = Failed to load settings
settings-retry = Retry
settings-sync-not-configured = Sync is not configured. Enter a server URL and enable sync.
settings-sync-status-idle = Ready
settings-sync-status-ok = Connected
settings-sync-pending-count = { $count } pending
settings-sync-summary-pending = pending
settings-sync-summary-synced = synced
settings-sync-summary-failed = failed
settings-sync-summary-conflicts = conflicts
settings-sync-plan-label = Plan
settings-sync-plan-free = Free
settings-sync-plan-pro = Pro
settings-sync-plan-upgrade-hint = Upgrade to sync to the cloud
settings-sync-last-synced = Last synced { $time }
settings-sync-last-synced-never = Never synced
settings-sync-oldest-pending = Oldest pending { $time }
settings-sync-oldest-pending-none = Queue empty
settings-sync-time-just-now = just now
settings-sync-time-minutes-ago = { $count }m ago
settings-sync-time-hours-ago = { $count }h ago
settings-sync-time-days-ago = { $count }d ago
settings-sync-pull = Pull from Server
settings-sync-pulling = Pulling…
settings-sync-pull-empty = Server returned empty snapshot — nothing to pull
settings-sync-pull-result = Last pull: { $products } products, { $tax_rates } tax rates, { $users } users
settings-font-smoothing-antialiased = Antialiased (crisp)
settings-font-smoothing-subpixel = Subpixel (smooth)

# ── System & License ──
settings-system-license-header = System & License Ownership
settings-software-edition = Software Edition
settings-license-type = License Type
settings-copyright-notice = Copyright Notice
settings-commercial-contact = Commercial Contact
settings-app-version = OZ-POS Enterprise v{ $version }

# ── License Info Section ──
settings-section-license = License
settings-license-tier = Tier
settings-license-status-label = Status
settings-license-expires = Expires
settings-license-grace = Grace Period Until
settings-license-max-stores = Max Stores
settings-license-max-pos = Max POS Instances
settings-license-tenant-id = Tenant ID
settings-license-allowed-types = Allowed Workspace Types
settings-license-allowed-types-all = All
settings-license-not-activated = No license activated. Activate a license to see details here.
settings-license-server-tier = Server Tier
settings-license-server-active = Server Active
settings-license-server-expires = Server Expires
settings-license-server-results = License Check Results
settings-license-type-value = Proprietary
settings-license-unlimited = Unlimited
settings-license-yes = Yes
settings-license-no = No
settings-license-status-active = Active
settings-license-tier-free = Free
settings-license-tier-pro = Pro
settings-license-tier-premium = Premium
settings-license-tier-enterprise = Enterprise
settings-license-ws-retail = Retail
settings-license-ws-restaurant = Restaurant
settings-license-ws-cafe = Café
settings-license-ws-kiosk = Kiosk
settings-license-ws-franchise = Franchise
settings-license-ws-warehouse = Warehouse
settings-license-server-status-retrieved = Server license status retrieved.
settings-license-server-check-failed = Server check failed
settings-license-server-status = Server Status
settings-license-live-online = Live
settings-license-live-offline = Offline
settings-license-live-inactive = Inactive
settings-license-live-checking = Checking…
settings-license-last-checked = Last checked: { $when }
settings-license-just-now = just now
settings-license-seconds-ago = { $seconds }s ago
settings-license-minutes-ago = { $minutes }m ago
settings-license-refresh = Refresh
settings-license-refresh-aria = Refresh license status
settings-license-poll-offline = Server unreachable
settings-license-load-failed = Failed to load license info
# C3.3: Pause/resume subscription
settings-license-subscription-actions = Subscription
settings-license-pause-subscription = Pause subscription
settings-license-pause-aria = Pause subscription for 1 month
settings-license-pause-success = Subscription paused. Resume anytime.
settings-license-pause-failed = Failed to pause subscription
settings-license-paused-until = Paused until
settings-license-resume-subscription = Resume subscription
settings-license-resume-aria = Resume paused subscription
settings-license-resume-success = Subscription resumed!
settings-license-resume-failed = Failed to resume subscription
settings-copyright-notice-value = OZ-POS © 2025–2026 OZ Systems. All rights reserved.

# Appearance / Brand settings
appearance-primary-colour = Primary Colour
appearance-primary-colour-picker-aria =
    .aria-label = Primary colour picker
appearance-colour-hex-aria =
    .aria-label = Colour hex value
appearance-reset-colour-aria =
    .aria-label = Reset colour to default
appearance-reset-colour = Reset to default
appearance-follow-theme-aria = Following theme colour
    .aria-label = Following theme colour — pick a colour to override
appearance-follow-theme = Following theme colour
appearance-logo = Store Logo
appearance-logo-alt =
    .alt = Store logo
appearance-choose-logo = Choose Logo
appearance-choose-logo-aria =
    .aria-label = Pick logo file
appearance-store-name = Display Store Name
appearance-interface-zoom = Interface Zoom
appearance-zoom-auto = Automatic (Scale with screen)
appearance-zoom-100 = 100% (Default)
appearance-zoom-125 = 125%
appearance-zoom-150 = 150%
appearance-zoom-200 = 200%
appearance-branding = Branding
appearance-interface = Interface
appearance-preview-heading = Preview
appearance-store-name-fallback = OZ-POS
appearance-hw-accel = Hardware Acceleration
appearance-hw-accel-aria =
    .aria-label = Toggle hardware acceleration
appearance-hw-accel-hint = Disable if UI animations feel janky on low-end devices. Restart the app for the change to take full effect.
appearance-preview = Preview
appearance-preview-btn-label = Primary Button
appearance-preview-btn-outline-label = Secondary
appearance-preview-badge-label = Live
appearance-reset-all-aria =
    .aria-label = Reset all to defaults
appearance-reset-all = Reset all to defaults
appearance-reset-all-confirm-title = Reset Appearance
appearance-reset-all-confirm = Reset all appearance settings to their defaults? This cannot be undone.
appearance-reset-all-success = Appearance settings reset to defaults
appearance-reset-all-failed = Failed to reset appearance settings
appearance-save-aria =
    .aria-label = Save appearance
appearance-save-success = Appearance settings saved
appearance-save-failed = Failed to save appearance settings

# Settings option labels
settings-decimal-separator-dot = 1.00 (dot)
settings-decimal-separator-comma = 1,00 (comma)
settings-decimal-separator-none = 1 (none)
settings-paper-width-standard = 80 mm (standard)
settings-paper-width-narrow = 58 mm (narrow)

# Category Management
category-delete-aria =
    .aria-label = Delete category { $name }
category-delete-dialog-aria = Delete category
category-colour-picker-aria = Pick a colour
category-colour-swatch-aria =
    .aria-label = Select colour { $colour }
category-name-fallback = Category Name

# Data Management Screen
data-mgmt-title = Data Management
data-mgmt-tabs-aria = Data management actions
data-mgmt-tab-export = Export
data-mgmt-tab-import = Import
data-mgmt-tab-backup = Backup

# Export wizard
data-mgmt-export-wizard-aria = Export wizard
data-mgmt-export-title = Select data to export
data-mgmt-export-types-aria = Data types to export
data-mgmt-export-select-all = Select all / none
data-mgmt-type-products = Products
data-mgmt-type-products-desc = SKU, name, price, barcode, stock
data-mgmt-type-categories = Categories
data-mgmt-type-categories-desc = Category id, name, colour
data-mgmt-type-sales = Sales
data-mgmt-type-sales-desc = Sale header, line items, payments
data-mgmt-type-customers = Customers
data-mgmt-type-customers-desc = Name, email, phone, loyalty points
data-mgmt-type-users = Users
data-mgmt-type-users-desc = Usernames, display names, roles (no passwords)
data-mgmt-type-settings = Settings
data-mgmt-type-settings-desc = Store config, receipts, feature flags
data-mgmt-export-date-from = From
data-mgmt-export-date-to = To
data-mgmt-export-next = Next: Encryption
data-mgmt-export-exporting = Exporting…
data-mgmt-export-complete = Export complete
data-mgmt-export-done-text = Data exported to:
data-mgmt-export-selected-types = Selected types:
data-mgmt-export-new-export = New export

# Encryption step
data-mgmt-encrypt-title = Set encryption password
data-mgmt-encrypt-desc = The export file will be encrypted with AES-256-GCM. Choose a strong password — you will need it to import the data later.
data-mgmt-encrypt-password = Password
data-mgmt-encrypt-password-placeholder = At least 8 characters
data-mgmt-encrypt-confirm = Confirm password
data-mgmt-encrypt-confirm-placeholder = Re-enter password
data-mgmt-encrypt-back = Back
data-mgmt-encrypt-export = Export

# Import wizard
data-mgmt-import-wizard-aria = Import wizard
data-mgmt-import-title = Select a backup file
data-mgmt-import-desc = Choose an encrypted .ozpkg file to import. The file must have been created by OZ-POS export.
data-mgmt-import-browse = Browse files…
data-mgmt-import-preview-title = Preview import
data-mgmt-import-meta-file = File
data-mgmt-import-meta-store = Store
data-mgmt-import-meta-version = Version
data-mgmt-import-meta-created = Created
data-mgmt-import-meta-contains = Contains
data-mgmt-import-password = Decryption password
data-mgmt-import-password-placeholder = Enter the export password
data-mgmt-import-cancel = Cancel
data-mgmt-analyse-file = Analyse file
data-mgmt-import-start = Start import
data-mgmt-import-confirm-title = Import Data
data-mgmt-import-confirm-message = Importing will overwrite current data with the contents of the backup file. This cannot be undone. Do you want to proceed?
data-mgmt-import-analysing = Analysing file…
data-mgmt-import-dry-run-complete = Dry-run complete — importing…
data-mgmt-import-dry-run-title = Changes to be applied
data-mgmt-import-dry-run-added = New items
data-mgmt-import-dry-run-updated = Updated
data-mgmt-import-dry-run-skipped = Skipped
data-mgmt-import-complete = Import complete
data-mgmt-import-done-text = All data has been imported successfully.
data-mgmt-import-done-summary = { $added } items added, { $updated } updated, { $skipped } skipped.
data-mgmt-import-new-import = New import

# Backup section
data-mgmt-backup-status-aria = Backup status
data-mgmt-backup-title = Database backup
data-mgmt-backup-desc = Create an online snapshot of the current database. The backup runs in the background and does not interrupt POS operations.
data-mgmt-backup-label-last = Last backup
data-mgmt-backup-never = Never
data-mgmt-backup-label-size = Size
data-mgmt-backup-create = Create backup now
data-mgmt-backup-backing-up = Backing up…

# Toast notifications
data-mgmt-toast-backup-success = Backup created successfully
data-mgmt-export-complete-aria = Export complete
data-mgmt-import-complete-aria = Import complete
data-mgmt-toast-backup-fail = Backup failed
data-mgmt-toast-export-select-type = Select at least one data type to export
data-mgmt-toast-export-password-length = Password must be at least 8 characters
data-mgmt-toast-export-password-match = Passwords do not match
data-mgmt-toast-export-success = Export complete
data-mgmt-toast-export-fail = Export failed
data-mgmt-toast-import-enter-password = Enter the export password
data-mgmt-toast-import-no-file = No file selected
data-mgmt-toast-import-success = Import complete
data-mgmt-toast-import-fail = Import failed
data-mgmt-toast-file-picker-fail = Failed to open file picker
data-mgmt-toast-backup-status-fail = Failed to load backup status

# Aria labels

# Feature Toggles
feature-toggle-title = Feature Toggles
feature-toggle-subtitle = { $enabled } / { $total } enabled
feature-toggle-loading = Loading features…
feature-toggle-group-core = Core
feature-toggle-group-payments = Payments
feature-toggle-group-products = Products
feature-toggle-group-staff = Staff
feature-toggle-group-hardware = Hardware
feature-toggle-group-business-rules = Business Rules
feature-toggle-group-restaurant = Restaurant
feature-toggle-group-scaling = Scaling
feature-toggle-group-reporting = Reporting
feature-toggle-group-advanced = Advanced
feature-toggle-error-load = Failed to load features
feature-toggle-error-toggle = Failed to toggle feature
feature-toggle-enabled = Feature enabled
feature-toggle-disabled = Feature disabled
feature-toggle-auto-enabled = Auto-enabled dependencies: { $list }
feature-toggle-retry = Retry
feature-toggle-empty = No features found.
feature-toggle-empty-search = No features match your search.
feature-toggle-search-placeholder =
    .placeholder = Search features…
feature-toggle-search-aria = Search features
feature-toggle-search-clear-aria = Clear search
feature-toggle-bulk-enable = Enable All
feature-toggle-bulk-disable = Disable All
feature-toggle-bulk-enable-aria = Enable all { $group } features
feature-toggle-bulk-disable-aria = Disable all { $group } features
feature-toggle-bulk-enabled = All { $group } features enabled
feature-toggle-bulk-disabled = All { $group } features disabled
feature-toggle-requires = Requires: { $deps }
feature-toggle-group-aria = { $group } features
feature-toggle-toggle-aria = Toggle { $name }

# ── Data Management ──
data-mgmt-password-show-aria = Show password
data-mgmt-password-hide-aria = Hide password

# ── Settings screen ──
settings-margins-heading = Paper Margins (mm)
settings-margin-top = Top
settings-margin-bottom = Bottom
settings-margin-left = Left
settings-margin-right = Right

# Settings receipt preview

# Settings decimal separator options

# Settings paper width options

# Payments tab

# Tender presets

# Sound & language

# Quick links

# Customer-facing display

# New tab labels

# Section headings (when a sub-screen doesn't render its own)

# Sync tab
settings-sync-token-hint = Stored securely in the database — never in localStorage
settings-sync-last = Last sync
settings-sync-pending = Pending changes
settings-sync-toast-success = Sync completed successfully
settings-sync-toast-fail = Sync failed — check server URL and token
settings-sync-toast-test-success = Connection test passed
settings-sync-toast-test-fail = Could not reach server
settings-sync-confirm-overwrite = Overwrite local data with the server snapshot?
settings-sync-confirm-pull-title = Pull from server?
settings-sync-pull-toast-success = Pulled { $products } products, { $tax_rates } tax rates, { $users } users from server
settings-sync-pull-toast-empty = Server snapshot was empty — nothing to pull
settings-sync-pull-toast-fail = Pull failed — check server URL and token
settings-field-language = Language

# ── Field validation ──
settings-tax-id-pattern-hint = Letters, numbers, dashes, dots, and slashes only, max 20 characters

# ── Updates ──
settings-updates-heading = Updates
settings-current-version = Current Version
settings-check-for-updates = Check for Updates
settings-checking-for-updates = Checking…
settings-up-to-date = ✓ You're up to date
settings-update-available = { $version } is available
settings-install-update = Install Now
settings-installing-update = Installing…
settings-update-status-label = Status
settings-update-not-checked = Not checked
settings-update-check-error = Update check failed
settings-update-retry = Retry

# ── Email Report Settings ──
settings-section-email = Email Reports
settings-email-description = Configure SMTP to receive scheduled report emails.
settings-email-host = SMTP Host
settings-email-port = Port
settings-email-username = Username
settings-email-username-placeholder = Optional
settings-email-password = Password
settings-email-password-placeholder = Enter password
settings-email-password-show = Show password
settings-email-password-hide = Hide password
settings-email-from = From Address
settings-email-use-tls = Use STARTTLS
settings-email-save-btn = Save SMTP Settings
settings-email-saved-btn = Saved ✓
settings-email-loading = Loading email settings…
settings-email-saved = SMTP settings saved
settings-email-save-error = Failed to save SMTP settings
settings-email-host-required = SMTP host is required
settings-email-from-required = A valid from-address is required
settings-email-test-btn = Send Test Report
settings-email-sending = Sending…
settings-email-test-tooltip = Sends a test report to the first configured recipient

# ── Email Report Schedule ──
settings-section-schedule = Report Schedule
settings-schedule-loading = Loading schedule…
settings-schedule-description = Configure how often scheduled report emails are sent.
settings-schedule-enabled = Enable Scheduled Reports
settings-schedule-cadence = Frequency
settings-schedule-cadence-daily = Daily
settings-schedule-cadence-weekly = Weekly (Monday)
settings-schedule-cadence-monthly = Monthly (1st)
settings-schedule-time = Send Time
settings-schedule-timezone = Timezone
settings-schedule-lookback = Lookback Days
settings-schedule-report-types = Report Types
settings-schedule-recipients = Recipients
settings-schedule-add-recipient = + Add Recipient
settings-schedule-save-btn = Save Schedule
settings-email-schedule-saved = Report schedule saved

# ── Report type labels for schedule ──
settings-schedule-report-type-daily-revenue = Daily Revenue
settings-schedule-report-type-weekly-revenue = Weekly Revenue
settings-schedule-report-type-monthly-revenue = Monthly Revenue
settings-schedule-report-type-top-products = Top Products
settings-schedule-report-type-hourly-heatmap = Hourly Heatmap
settings-schedule-report-type-category-breakdown = Category Breakdown
settings-schedule-report-type-low-stock-alerts = Low Stock Alerts

# ── Schedule recipient aria labels ──
settings-schedule-recipient-aria = Recipient { $number }
settings-schedule-recipient-remove-aria = Remove recipient { $number }
settings-schedule-recipient-add-aria = Add recipient

# ── Email test/schedule error fallbacks ──
settings-email-test-send-failed = Failed to send test email
settings-email-schedule-save-failed = Failed to save schedule

# ── Workspace Cards (ADR #22 Phase 1) ──
workspace-pos-receipt-heading = Receipt Settings
workspace-pos-paper-width = Paper Width
workspace-pos-show-currency = Show Currency
workspace-pos-show-tax = Show Tax
workspace-pos-tax-rounding = Tax Rounding
workspace-pos-tax-rounding-halfup = Round Half Up
workspace-pos-tax-rounding-truncate = Truncate (Legacy)
workspace-pos-show-table = Show Table Number
workspace-pos-footer = Receipt Footer
workspace-pos-printer-heading = Printer
workspace-pos-printer-connection = Connection
workspace-pos-printer-ip = IP Address
workspace-pos-printer-paper-size = Paper Size
workspace-pos-scanner-heading = Barcode Scanner
workspace-pos-scanner-mode = Input Mode
workspace-pos-scanner-device = Device ID
workspace-resto-table-heading = Table Management
workspace-resto-table-enable = Enable Table Layout
workspace-resto-table-hint = Tables appear on the POS screen for dine-in orders
workspace-resto-courses-heading = Course Firing
workspace-resto-courses-enable = Enable Course Firing
workspace-resto-courses-hint = Send appetizers, mains, and desserts to the kitchen in sequence
workspace-resto-kitchen-printer-heading = Kitchen Printer
workspace-resto-kp-connection = Connection
workspace-resto-kp-disabled = Disabled
workspace-resto-kp-ip = Kitchen Printer IP
workspace-kds-sla-heading = SLA Escalation
workspace-kds-sound = New Order Sound
workspace-kds-yellow-threshold = Yellow Alert (min)
workspace-kds-red-threshold = Red Alert (min)
workspace-kds-display-heading = Ticket Display
workspace-kds-auto-ack = Auto-Accept
workspace-kds-density = Density
workspace-inv-threshold-heading = Stock Thresholds
workspace-inv-low-stock = Low Stock Alert At
workspace-inv-units = { $count } items
workspace-inv-threshold-hint = Alert when stock falls below this quantity
workspace-inv-deduction-heading = Deduction Rules
workspace-inv-deduction-warehouse = Prefer Warehouse First
workspace-inv-deduction-hint = When enabled, stock is deducted from warehouse before store shelves
workspace-terminal-prefs-heading = Terminal Preferences
workspace-terminal-sound = Sound Volume
workspace-terminal-dark-mode = Dark Mode
workspace-terminal-scale-zero = Auto-Zero Scale on Boot

# ── Store Info Card (ADR #22 Phase 2) ──
workspace-store-info-heading = Store Info
workspace-store-info-name = Name
workspace-store-info-address = Address
workspace-store-info-branch = Branch
workspace-store-info-currency = Currency
workspace-store-info-tax-id = Tax ID

# ── Topology Editor (ADR #22 Phase 2) ──
workspace-type-selector-label = Workspace Type

# ── Phase 3 workspace nav items ──

# ── Workspace Settings Modal (ADR #22 Phase 4) ──
workspace-modal-title = Workspace Settings
workspace-modal-admin-settings = Admin Settings ↗
workspace-modal-close-aria = Close settings
workspace-modal-role-manager = Manager
workspace-modal-role-staff = Staff
workspace-modal-role-auditor = Auditor

# ── 4f: Workspace card aria-labels ──
terminal-sound-volume-aria = Sound volume
workspace-kds-yellow-threshold-aria = Yellow escalation threshold in minutes
workspace-kds-red-threshold-aria = Red escalation threshold in minutes

# ── Terminal Management feature groups ──
terminal-feature-group-sales = Sales
terminal-feature-group-payments = Payments
terminal-feature-group-inventory-products = Inventory & Products
terminal-feature-group-hardware = Hardware
terminal-feature-group-staff-security = Staff & Security
terminal-feature-group-system = System

# Exit survey (§7 churn prevention)
exit-survey-title = Before you pause...
exit-survey-message = Help us improve — what's the main reason you're pausing?
exit-survey-reason-price = Too expensive
exit-survey-reason-features = Not enough features
exit-survey-reason-competitor = Switching to a competitor
exit-survey-reason-closed = Business closed
exit-survey-reason-break = Taking a temporary break
exit-survey-reason-other = Other
exit-survey-other-placeholder = Please tell us more...
exit-survey-cancel = Go back
exit-survey-submit = Pause subscription

# ── Add-on Marketplace (C4.3) ─────────────────────────────────────
addon-marketplace-title = Add-ons
addon-marketplace-subtitle = Extend your plan with additional features
addon-marketplace-empty = No add-ons available for your current plan.
addon-purchase-button = Add
addon-owned-badge = Active
addon-analytics-name = Advanced Analytics
addon-analytics-desc = Unlock detailed sales reports, trend analysis, and custom date ranges on the Plus plan.
addon-support-name = Priority Support
addon-support-desc = Get faster response times and dedicated support from the OZ-POS team.
addon-storage-name = Extra Cloud Storage
addon-storage-desc = Increase your cloud sync storage quota for larger product catalogs and longer history.
addon-hal-name = Custom HAL Drivers
addon-hal-desc = Load and use custom hardware abstraction layer drivers for specialized POS peripherals.

// ── Local API (Settings → Local API) ──────────────────────────────
settings-section-local-api = Local API
settings-local-api-intro = Run your own scripts against this register over HTTP. The server listens only on this machine (127.0.0.1) and is off by default.
settings-local-api-enabled = Enable Local API
settings-local-api-port = Port
settings-local-api-port-apply = Apply
settings-local-api-port-invalid = Port must be between 1024 and 65535.
settings-local-api-port-applied = Port updated.
settings-local-api-port-failed = Could not change the port.
settings-local-api-store = Served store
settings-local-api-store-primary = primary
settings-local-api-store-hint = Scripts see exactly one store's data. Switching restarts the server against the selected store's database.
settings-local-api-store-changed = Now serving the selected store.
settings-local-api-store-failed = Could not switch the served store.
settings-local-api-start-failed = Could not start the local API server.
settings-local-api-toggle-failed = Could not change the Local API setting.
settings-local-api-stopped = The local API is stopped. Enable it to start a server on this machine; scripts then use the base URL shown here.
settings-local-api-token-label = Script name
settings-local-api-token-label-placeholder =
    .placeholder = my-integration
settings-local-api-generate = Generate Token
settings-local-api-token = API token
settings-local-api-token-hint = The token grants read access to all local data for 30 days. Master-data writes additionally require the operator key — see docs/guides/EXTENDING.md.
settings-local-api-token-expires = Expires { $expires }
settings-local-api-copy-url = Copy URL
settings-local-api-copy-token = Copy
settings-local-api-url-copied = Base URL copied.
settings-local-api-token-copied = Token copied.
settings-local-api-copy-failed = Copy failed — select the text manually.
settings-local-api-mint-failed = Could not generate a token.
settings-local-api-rotate = Rotate secret
settings-local-api-rotate-warning = Rotating invalidates every minted token immediately and changes the operator key. Scripts will need freshly minted tokens.
settings-local-api-rotate-confirm = Confirm rotate
settings-local-api-rotate-cancel = Cancel
settings-local-api-rotate-done = Signing secret rotated — mint a new token for your scripts.
settings-local-api-rotate-failed = Could not rotate the signing secret.

# Settings section scope badges (todo-global-saas-1.md §H)
settings-scope-organization = Organization
settings-scope-legal-entity = Legal Entity
settings-scope-location = Location
settings-scope-workspace = Workspace
settings-scope-terminal = Terminal

# ── Regional configuration (regional slice 3, Business Defaults screen) ──
settings-regional-title = Regional
settings-regional-subtitle = Market facts this location answers for receipts and reports. Blank fields inherit from the legal entity or the organization defaults.
settings-regional-locale = Locale (BCP-47)
settings-regional-locale-placeholder = e.g. id-ID — blank inherits
settings-regional-currency = Currency (ISO-4217)
settings-regional-currency-placeholder = e.g. IDR — blank inherits
settings-regional-currency-inherit = Inherit (scope above)
settings-regional-timezone = Timezone
settings-regional-timezone-inherit = Inherit (scope above)
settings-regional-timezone-utc = UTC (legacy sentinel)
settings-regional-timezone-legacy = legacy value
settings-regional-country = Market anchor (ISO-3166)
settings-regional-country-placeholder = e.g. ID — blank leaves the entity unchanged
settings-regional-country-hint = Resolved through the location's legal entity.
settings-regional-save = Save regional defaults
settings-regional-saving = Saving…
settings-regional-saved = Regional defaults saved.
settings-regional-error-save = Could not save the regional defaults.
settings-regional-error-load = Could not load the regional defaults.
settings-regional-no-location = No location to configure yet.
settings-regional-scope-location = Set at this location
settings-regional-scope-legal-entity = Inherited from the legal entity
settings-regional-scope-organization = Organization default
settings-regional-scope-built-in = Built-in default

# ── Local payment methods (regional slice 6, Business Defaults screen) ──
settings-localpay-title = Local payment methods
settings-localpay-subtitle = Which payment rails this market and site offer.
settings-localpay-code-placeholder = rail code, e.g. qris
settings-localpay-code-label = Rail code
settings-localpay-label-placeholder = display label, e.g. QRIS
settings-localpay-label-label = Display label
settings-localpay-add = Add rail
settings-localpay-save = Save payment methods
settings-localpay-saving = Saving…
settings-localpay-saved = Payment methods saved.
settings-localpay-error-save = Could not save the payment methods.
settings-localpay-error-load = Could not load the payment methods.
settings-localpay-no-location = No location to configure yet.
settings-localpay-empty-list = No rails recorded yet — add the ones this site offers.
settings-localpay-scope-location = Set at this site
settings-localpay-scope-legal-entity = Market default (legal entity)


# ── Diagnostics (feature-availability verdicts) ──
settings-diagnostics-title = Diagnostics
settings-diagnostics-intro = Why each feature is available or locked for you right now — the same gates the app enforces, with the reason named. Read-only, works offline.
settings-diagnostics-refresh = Refresh
settings-diagnostics-load-failed = Could not load the verdicts. Try again.
settings-diagnostics-list-aria = Feature availability verdicts
settings-diagnostics-status-available = Available
settings-diagnostics-loading = …
settings-diagnostics-reason-server-policy = Blocked by server policy
settings-diagnostics-reason-lifecycle = Subscription ended
settings-diagnostics-reason-tier = Not in this tier
settings-diagnostics-reason-quota = Quota reached
settings-diagnostics-reason-role = Role lacks permission
settings-diagnostics-reason-scope = Out of location scope
settings-diagnostics-feature-supports-qris = QRIS payments
settings-diagnostics-feature-supports-analytics = Analytics
settings-diagnostics-feature-supports-loyalty = Loyalty
settings-diagnostics-feature-supports-daily-dashboard = Daily dashboard
settings-diagnostics-feature-supports-cloud-sync = Cloud sync
settings-diagnostics-feature-sales-history-days = Sales history retention
settings-diagnostics-feature-locations = Location quota
settings-diagnostics-feature-staff-users = Staff accounts quota
settings-diagnostics-feature-pos-instances = POS terminals quota
settings-diagnostics-feature-warehouses = Warehouse stock points quota
settings-diagnostics-detail-tier = Tier: { $tier }
settings-diagnostics-detail-state = State: { $state }
settings-diagnostics-detail-quota = Usage: { $usage } / { $limit }
settings-diagnostics-detail-permission = Permission: { $permission }
settings-diagnostics-detail-scope-covered = Covers this location
settings-diagnostics-detail-scope-not-covered = Does not cover this location
settings-diagnostics-detail-expires = Expires: { $expiresAt }
settings-diagnostics-detail-grace = Grace until: { $graceUntil }
settings-diagnostics-deployment-version = App version: { $version }

