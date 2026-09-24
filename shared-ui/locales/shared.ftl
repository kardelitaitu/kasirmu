# shared-ui/locales/shared.ftl — Shared UI strings used across features
#
# IDs are `feature-element[-qualifier]`.

# Design system showcase
ds-title = Design System
theme-toggle-label = Toggle theme
theme-toggle-aria =
    .aria-label = Switch to { $mode ->
        [dark] dark
       *[light] light
    } mode

# Badge
badge-info = Info

# Loading / Spinner
shared-loading = Loading…
spinner-label = Loading…

# Toast
toast-success = Operation completed successfully
toast-error = Something went wrong
toast-warning = Please check your input
toast-info = This is an informational message

# Empty state
empty-state-title = Nothing here yet

# Error boundary
error-boundary-title = Something went wrong
error-boundary-retry = Try Again

# Error state
error-state-retry = Retry

# AppError user-safe copy (ERR-05/ERR-06 — typed normalizer output)
app-error-generic = Something went wrong. Please try again.
app-error-validation = Please check the information you entered and try again.
app-error-permission = You don't have permission to do this.
app-error-session = Your session has expired. Please sign in again.
app-error-conflict = This record was changed by someone else. Refresh and try again.
app-error-not-found = The requested item could not be found.
app-error-offline = You appear to be offline. Check your connection and try again.
app-error-hardware = A hardware device did not respond. Check it and try again.
app-error-subscription = This action is not included in your current plan.
app-error-global = Something unexpected happened. If this keeps happening, restart the app.

# Navigation
nav-inventory = Inventory

# Common / Global
cancel = Cancel
confirm = Confirm
save = Save
delete = Delete
edit = Edit
close = Close
loading = Loading…
print = Print
back = Back
retry = Retry
search = Search
toggle = Toggle
no-results = No results found
error-occurred = An error occurred

# Capability hints. Shown when an affordance needs a real app shell: the file
# pickers go through `@tauri-apps/plugin-dialog`, which the browser dev preview
# cannot reach (its `__TAURI_INTERNALS__` stub has no `invoke`). Replaces
# `restaurant-avatar-desktop-only`, which asserted the photo feature was
# desktop-only — true until the tablet gained the picker, false after.
image-pick-app-only = Choosing a photo needs the kasir.mu app

# Common aria-label attributes for generic UI actions
clear-aria = Clear
backspace-aria = Backspace
username-aria = Username
actions-aria = Actions
collapse-aria = Collapse sidebar
notifications-aria = Notifications
settings-aria = Settings
export-csv-aria = Export CSV
search-aria = Search
workspaces-aria = Workspaces
developer-tools-aria = Developer tools
theme-selector-aria = Theme selector
cancel-refund-aria = Cancel refund
decrease-qty-aria = Decrease quantity
increase-qty-aria = Increase quantity
filter-sales-aria = Filter sales
filter-status-aria = Filter by status
from-date-aria = From date
to-date-aria = To date
filter-cashier-aria = Filter by cashier
sales-history-aria = Sales history
pagination-aria = Pagination
badge-tooltip-aria = Badge with tooltip

# Audit Log
audit-log-title = Audit Log
audit-log-load-more = Load More
audit-log-error-load = Failed to load audit log
audit-log-mark-reviewed = Mark Reviewed
audit-log-reviewed-at = Reviewed: { $date }
audit-log-unreviewed-title =
    { $count ->
        [one] { $count } unreviewed event since last review
       *[other] { $count } unreviewed events since last review
    }
audit-log-user-system = system
audit-log-loading = Loading…
audit-log-refresh = Refresh
audit-log-retry = Retry
# ERR-09: Accessible status while a reload is in flight with rows visible
audit-log-refreshing = Refreshing…
audit-log-filter-all = All
audit-log-filter-success = Success
audit-log-filter-failure = Failure
audit-log-loading-text = Loading audit log…
audit-log-empty-filtered = No audit entries match the current filters.
audit-log-empty-none = No audit entries recorded yet. Entries appear when sales are completed, voided, or staff actions occur.
audit-log-col-date = Date
audit-log-col-action = Action
audit-log-col-target = Target
audit-log-col-user = User ID
audit-log-col-outcome = Outcome
audit-log-col-details = Details
audit-log-count-of = { $shown } of { $total } entr{ $shown ->
  [one] y
  *[other] ies
}
audit-log-export = Export CSV
audit-log-export-error = Export failed. Please try again.
audit-log-export-progress = Exporting audit log…
audit-log-security-export = Export security CSV
audit-log-security-export-actor = Actor (user ID)
audit-log-security-export-from = From (inclusive)
audit-log-security-export-to = To (exclusive)
audit-log-security-export-error = Security event export failed. Please try again.

# Update Banner
update-banner-title = Update available
update-banner-new-version = New version
update-banner-install = Install
update-banner-installing = Installing…
update-banner-install-aria = Download and install update
update-banner-installing-aria = Installing update…
update-banner-dismiss-aria = Dismiss update notification
update-banner-dismiss = Dismiss
dismiss = Dismiss
update-banner-backing-up = Backing up…
update-banner-backing-up-aria = Backing up database before update
update-banner-backup-error = Backup failed
update-banner-version-blocked-title = Update not available
update-banner-version-blocked-desc = Your version { $current } is below the minimum { $minimum } required. Please reinstall from the website.
update-banner-rollback-title = Update may have failed
update-banner-rollback-desc = Previous version { $version } available for download. Click to restore.
update-banner-rollback = Restore Previous Version
update-banner-rollback-aria = Download previous version from GitHub

# Memo Banner
memo-banner-open-aria = Read the full memo: { $title }
memo-banner-open-aria-plain = Read the full memo
memo-banner-acknowledge-aria = Acknowledge this memo

# Memos (authoring)
memos-title = Memos
memos-refresh = Refresh
memos-new-heading = New memo
memos-label-title = Title
memos-placeholder-title = e.g. close the drawer at 10 PM
memos-label-body = Message
memos-placeholder-body = Write the message staff will see…
memos-label-scope = Audience
memos-scope-hint = Leave every location unchecked to reach all of them (Organization).
memos-scope-org = Organization
memos-label-duration = Duration
memos-duration-12h = 12 hours
memos-duration-24h = 24 hours
memos-duration-3d = 3 days
memos-duration-7d = 7 days
memos-duration-30d = 30 days
memos-create = Create draft
memos-publish = Publish
memos-stop = Stop
memos-revise-heading = Revise memo
memos-revise-note = Corrections publish a new revision; the duration and audience stay unchanged.
memos-revise = Publish revision
memos-revise-cancel = Cancel
memos-revise-row = Revise
memos-col-title = Title
memos-col-scope = Audience
memos-col-status = Status
memos-col-duration = Duration
memos-col-revision = Revision
memos-col-created = Created
memos-col-actions = Actions
memos-status-draft = Draft
memos-status-published = Published
memos-status-expired = Expired
memos-status-stopped = Stopped
memos-status-archived = Archived
memos-table-aria = Memo list
memos-empty = No memos yet. Create your first memo with the form above.
memos-error-load = Failed to load memos
memos-error-action = The memo action failed. Please try again.
memos-retry = Retry

# Toast
toast-dismiss-aria = Dismiss notification
toast-notifications-aria = Notifications
toast-show-detail = Show detail
toast-hide-detail = Hide detail
toast-copy = Copy
toast-copied = Copied!
toast-copy-aria = Copy error details
app-error-global-title = Unexpected error

# Modal
modal-close-aria = Close dialog

# Permission Denied
permission-denied-title = Access Denied
permission-denied-desc = { $action } requires a { $requiredRole } role.
permission-denied-perm-desc = You don't have permission to access { $action }.
permission-denied-perm-key = (required permission: { $permission })
permission-denied-current = You are logged in as { $displayName } ({ $roleName }).
permission-denied-go-back = Go back

# Store Switcher
store-switcher-select = Select Store
store-switcher-current-aria = Current store: { $name }. Click to switch.
store-switcher-list-aria = Stores
store-switcher-primary = · Primary

# Gateway Status
gateway-status-online-aria = { $name } online
gateway-status-offline-aria = { $name } offline

# Role Badge
role-badge-logged-in-aria = Logged in as { $displayName }, { $roleName }
role-badge-logout-aria = Log out { $displayName }
role-badge-logout-title = Log out

# Language Selector
language-selector-label = Language
language-selector-select-aria = Select language

# Locale labels
locale-en = English
locale-id = Bahasa Indonesia

# Accessibility
a11y-skip-to-content = Skip to main content
# Shared right-click menu (components/ContextMenu.tsx), rendered by 14
# surfaces. Its labels are resolved with requiredLocalized(), so a missing key
# here shows the key rather than silently reverting to English.
ctx-menu-aria = Context menu
ctx-menu-copy = Copy
ctx-menu-paste = Paste

# Navigation section labels
nav-section-operations = Operations
nav-section-sales = Sales
nav-section-products = Products
nav-section-finance = Finance
nav-section-customers = Customers
nav-section-reports = Reports
nav-section-inventory = Inventory
nav-section-tools = Tools
nav-section-settings = Settings
nav-section-dev = Dev

nav-pos-terminal = POS Terminal
nav-kds = KDS
nav-products = Products
nav-stock-adjust = Stock Adjust
nav-sales-history = Sales History
nav-dashboard = Dashboard
nav-eod-report = EOD Report
nav-orders = Orders
nav-tax-rates = Tax Rates
nav-exchange-rates = Exchange Rates
nav-categories = Categories
nav-customers = Customers
nav-loyalty = Loyalty
nav-gift-cards = Gift Cards
nav-staff = Staff
nav-roles = Roles
nav-terminals = Terminals
nav-locations = Locations
nav-features = Features
nav-data = Data
nav-audit-log = Audit Log
nav-security-trail = Security Trail
nav-memos = Memos
nav-offline-queue = Offline Queue
nav-shifts = Shifts
nav-bundles = Bundles
nav-settings = Settings
nav-general = General
nav-dashboard-report = Dashboard
nav-analytics = Staff Analytics
nav-sales-report = Sales Report
nav-inventory-report = Inventory Report
nav-menu-engineering = Menu Engineering
nav-design-system = Design System
nav-tooltip-preview = Tooltip Preview
nav-kiosk = Kiosk
nav-tables = Tables
nav-promotions = Promotions
nav-suppliers = Suppliers
nav-purchase-orders = Purchase Orders
nav-stock-transfers = Stock Transfers
nav-stock-counts = Stock Counts
nav-custom-report = Custom Report
nav-pos = POS
app-sidebar-subtitle = Point of Sale
nav-stock = Stock
nav-reports = Reports
nav-sidebar-collapse = Collapse sidebar
nav-sidebar-expand = Expand sidebar
nav-main-aria = Main navigation
nav-tablist-aria = Navigation tabs
nav-switch-workspace = Switch Workspace

# Workspace home
workspace-home-fullscreen-aria = Toggle fullscreen
workspace-home-fullscreen-hint = F11
fullscreen-enabled = Fullscreen mode enabled
fullscreen-disabled = Fullscreen mode disabled
workspace-home-loading = Loading workspaces…
workspace-home-sr-error = Connection error
workspace-home-available = { $count } workspaces available
workspace-home-coming-soon = Coming soon
workspace-card-active-aria = Active workspace
workspace-home-empty = No workspaces available
workspace-home-empty-desc = You don't have access to any workspaces yet. Contact an administrator.
workspace-home-staff-empty = No workspaces available
workspace-home-staff-empty-desc = Contact Administrator
workspace-card-open-aria = Open { $name }
workspace-card-no-access-aria = { $name } — not available for your role
workspace-card-no-access-badge = Not available
workspace-home-logout = Logout
workspace-home-logout-confirm-title = Logout?
workspace-home-logout-confirm-desc = You will be returned to the login screen. Any unsaved work will be lost.
workspace-home-logout-confirm-cancel = Cancel
workspace-home-logout-confirm-confirm = Logout
workspace-home-shortcut-hint = Press { $key } to open
workspace-home-user-aria = Logged in as { $name }
workspace-home-error-title = Connection Error
workspace-home-error-desc = Could not load your workspaces. Check your connection and try again.
# Shown when create_session is rejected: the workspace is listed, but no session
# token could be minted for it, so token-taking commands cannot run. The toast's
# Show detail carries the backend reason (clock rollback, denied workspace type,
# expired subscription, invalid signature).
workspace-session-token-error = Could not start the session for this workspace. Check the details and try again.
workspace-home-retry = Try Again
workspace-home-retry-btn = Retry
workspace-card-pin-aria = Pin { $name } to top
workspace-card-unpin-aria = Unpin { $name }

# Shell

# Shell layout (ADR-0001, tier T3). The shell renders the portrait prompt for a
# page registering layout="landscape-locked"; keep the child text the id string
# resolves to in step with the fallback in AppShell/TabletAppShell.
layout-rotate-to-landscape = Rotate your device to landscape for the full layout.
layout-rotate-to-landscape-aria =
    .aria-label = Rotate to landscape

# Status Bar
status-bar-connected = Backend connected
status-bar-disconnected = Backend disconnected
# Sync connection status
status-bar-sync-connected = Cloud sync connected
status-bar-sync-disconnected = Cloud sync disconnected
status-bar-sync-checking = Checking cloud sync connection…
# License status (login screen)
staff-login-license-active = License active
staff-login-license-inactive = License inactive
# P1-3: Tooltip for conflict count badge in StatusBar
statusbar-conflict-count = { $count } sync conflict(s) resolved
# SYNC-12: StatusBar visible labels + ARIA (localized at the render boundary)
statusbar-app-status-aria = Application status
statusbar-version = v0.0.40
statusbar-sync-name = Sync
statusbar-gateway-name = Stripe
statusbar-license = Proprietary License
# Unified status area (activation screen): auth / sync / version icons
statusbar-group-aria = Connection and version status
statusbar-version-label = Version
statusbar-checking-msg = { $name } · Checking…
statusbar-offline-msg = { $name } · Offline
statusbar-latency-msg = { $name } · { $ms }ms
# The server is answering and told us which subsystem is broken. Distinct from
# "Offline": a degraded service still serves, so this must not read as down.
# $cause is the server's own subsystem label (e.g. "database"), passed through.
statusbar-degraded-msg = { $name } · Degraded — { $cause }
statusbar-version-latest-msg = Version up to date
statusbar-version-update-msg = Update available
# Service-health contracts (saas-3): payment + device-connectivity pills
statusbar-payment-label = Payment
statusbar-devices-label = Devices
statusbar-retry-queued = Retrying { $name }…
statusbar-payment-gateway-msg = { $name } · { $count } gateway(s) active
statusbar-payment-unconfigured-msg = { $name } · No gateway configured
statusbar-devices-count-msg = { $name } · { $count } device(s)

# Audit Action Labels
audit-action-sale-void = Void Sale
audit-action-sale-complete = Complete Sale
audit-action-sale-refund = Refund
audit-action-login = Staff Login
audit-action-login-failed = Login Failed
audit-action-user-create = Staff Created
audit-action-user-update = Staff Updated
audit-action-product-create = Product Created
audit-action-product-update = Product Updated
audit-action-product-delete = Product Deleted
audit-action-stock-adjust = Stock Adjusted
audit-action-setting-change = Setting Changed
audit-action-system-backup = Backup Created
audit-action-system-restore = Restore
audit-action-system-export = Data Export
audit-action-system-import = Data Import
audit-action-audit-review = Audit Reviewed
audit-action-sale-create = Sale Created
audit-action-bulk-import = Bulk Import
audit-action-inventory-sync = Inventory Synced
audit-action-unknown = Unknown Action
audit-log-outcome-success = Success
audit-log-outcome-failure = Failure
audit-log-outcome-unknown = Unknown
audit-log-table-label = Audit log entries
# ── Security trail (audit baseline) ───────────────────────────────
# The tenant-global half of the audit surface. Its labels live here beside the
# store audit log's because that is where the action catalog resolves — see
# auditCatalog.test.ts.
security-trail-title = Security Trail
security-trail-scope-note = Sign-ins, sign-outs, impersonation and staff account changes for every location in this organization.
# Deliberately not reusing audit-log-empty-none: that sentence names sales and
# voids, the store log's vocabulary, which is wrong for a trail of access events.
security-trail-empty = No security events match these filters.
audit-action-logout = Logged out
audit-action-impersonate-start = Impersonation started
audit-action-impersonate-stop = Impersonation stopped
audit-log-search-placeholder = Search actions, targets, or users…
audit-log-search-label = Search audit log
audit-log-filter-label = Filter by outcome

# Auth / License Activation
auth-activate-title = Setup
auth-activate-subtitle = Sign in or link this device to get started

# Three first steps, modelled on the modes ProvisioningFlow already exposes
# (setup-account-google / setup-tab-pair). Same commands, so the two screens cannot
# drift into disagreeing about what linking means. Email login is the desktop-link
# flow (ADR #54 §2.6): request_email_login_code / verify_email_login_code /
# login_with_email_password, registered on both shells.
auth-setup-title = How would you like to get started?
auth-setup-google = Sign in with Google
auth-setup-google-desc = Sign in, or create an account automatically if you are new.
auth-setup-pair = Pair this device to your organization
auth-setup-pair-desc = Scan a code from a phone or another terminal that is already set up.
auth-setup-email = Sign in with email
auth-setup-email-desc = We email a one-time code, or you can use your password.
auth-setup-back = Back
auth-setup-waiting-browser = Waiting for your browser to finish signing in…
auth-setup-google-failed = Could not sign in with Google. Please try again.
auth-email-label = Email Address
auth-email-placeholder = store@example.com
# Desktop-link email login (ADR #54 §2.6). The screen walks address -> code, or
# address -> password when the account has one. auth-email-failed is the fallback
# plainErrorMessage() shows when the request itself fails.
auth-email-step-title = Sign in with your email
auth-email-send-code = Send code
auth-email-use-password = Use a password instead
auth-email-code-title = Enter the code we emailed you
auth-email-code-label = Login code
auth-email-code-placeholder = 6-digit code
auth-email-verify = Verify code
auth-email-password-title = Enter your password
auth-email-password-label = Password
auth-email-password-submit = Sign in
auth-email-back = Use a different email address
auth-email-failed = Could not sign in. Check the address and your connection, then try again.
auth-phone-label = Phone Number
auth-phone-placeholder = 08123456789
auth-license-label = License Key
auth-license-placeholder = OZ-PRO-XXXX-XXXX-XXXX
# Accessible names for the icon-only clear (×) buttons on each field of the
# license activation form. Resolved via l10n.getString() at the render
# boundary, so a missing key here leaves the button unnamed, not English.
auth-clear-email = Clear email address
auth-clear-phone = Clear phone number
auth-clear-key = Clear license key
auth-activate-button = Activate License
auth-activating = Activating...
auth-activation-success = License activated successfully!
auth-activation-failed = Failed to activate license.
auth-activation-error = An error occurred during activation.
auth-trial-hint-pro = You came from a restaurant/cafe page — your trial key unlocks a 14-day Pro trial.
auth-trial-hint-enterprise = Your referral trial key unlocks a 30-day Pro trial.
auth-validation-required = License key and Email are required.
auth-validation-invalid-email = Invalid email format.
auth-validation-phone-required = Phone number is required.
auth-validation-invalid-phone = Invalid phone number format. Enter at least 7 digits.
auth-paste = Paste
auth-version = Version { $version }
auth-ip-local = Local : { $ip }
auth-ip-public = Public : { $ip }
auth-ip-detecting = Detecting...
auth-ip-unknown = Unknown
auth-copyright = kasir.mu © { $year } All rights reserved.
auth-clipboard-error = Clipboard error: { $message }
auth-error-title = Error

## Tablet Device-Code Pairing (ADR #56 §2.5 / §5 Q1)
auth-tab-license-key = License Key
auth-tab-pair-device = Pair with Phone
auth-pair-scan-qr = Scan this QR code with your phone or visit { $url }
auth-pair-code-label = Pairing Code
auth-pair-waiting = Waiting for you to claim on your phone…
auth-pair-expired = Pairing code expired. Click to refresh.
auth-pair-refresh = Refresh Code
auth-pair-success = Device paired successfully!

## Revoked Account (ADR #58 §2.6)
auth-revoked-title = Account suspended
auth-revoked-message = Your kasir.mu account has been suspended. You cannot log in or process new sales. Your existing data is safe and can be exported below.
auth-revoked-contact = If you believe this is an error, please contact our support team.
auth-revoked-export-button = Export my data
auth-revoked-exporting = Exporting…
auth-revoked-export-aria = Export all local store data to an encrypted package
auth-revoked-export-success = Data exported successfully!
auth-revoked-export-error = Export failed: { $message }

## Create Owner PIN (first-run setup)
auth-create-pin-title = Create Owner PIN
auth-create-pin-desc = Set up the first owner account to manage your POS
auth-create-pin-display-name-label = Display Name
auth-create-pin-display-name-placeholder =
    .placeholder = Store Owner
auth-create-pin-username-label = Username
auth-create-pin-username-placeholder =
    .placeholder = owner
auth-create-pin-pin-label = PIN
auth-create-pin-pin-placeholder =
    .placeholder = At least 4 digits
auth-create-pin-confirm-label = Confirm PIN
auth-create-pin-confirm-placeholder =
    .placeholder = Re-enter PIN
auth-create-pin-creating = Creating...
auth-create-pin-create = Create Owner Account
auth-create-pin-success = Owner account created successfully!
auth-create-pin-error-fields = All fields are required.
auth-create-pin-error-pin-length = PIN must be at least 4 characters.
auth-create-pin-error-pin-mismatch = PINs do not match.
auth-create-pin-error-generic = An error occurred while creating the owner account.

# Additional common aria-label attributes
close-aria = Close
search-customers-aria = Search customers
search-products-aria = Search products
barcode-input-aria = Barcode input
submit-barcode-aria = Submit barcode
select-course-aria = Select course
revert-changes-aria = Revert changes
add-sample-line-aria = Add a sample line
previous-page-aria = Previous page
next-page-aria = Next page
results-per-page-aria = Results per page
void-order-aria = Void order
close-void-aria = Close void dialog
void-reason-aria = Void reason
sale-detail-aria = Sale detail
sale-line-items-aria = Sale line items
refund-line-items-aria = Refund line items
orders-aria = Orders
back-to-orders-aria = Back to orders list
order-line-items-aria = Order line items
decrease-card-size-aria = Decrease card size
increase-card-size-aria = Increase card size
decrease-font-size-aria = Decrease font size
increase-font-size-aria = Increase font size
primary-colour-picker-aria = Primary colour picker
colour-hex-aria = Colour hex value
reset-colour-aria = Reset colour to default
pick-logo-aria = Pick logo file
reset-appearance-aria = Reset all appearance settings
save-appearance-aria = Save appearance

# Stock alert bell (global header)
stock-alert-bell-empty-aria = No stock alerts
stock-alert-bell-count-aria = { $count ->
    [one] { $count } active stock alert
   *[other] { $count } active stock alerts
}

# Workspace home — Insights section (owner/admin only)
workspace-home-insights-section = Insights
workspace-home-analytics-title = Analytics
workspace-home-analytics-desc = Staff performance, sales trends, and shift metrics
workspace-home-analytics-aria = Open Analytics
workspace-home-reports-title = Reports
workspace-home-reports-desc = Sales, inventory, and custom reports dashboard
workspace-home-staff-title = Staff Management
workspace-home-staff-desc = Manage staff, roles, and permissions
workspace-home-settings-title = Settings
workspace-home-settings-desc = System configuration and preferences
# Reuses the wording already approved for this feature at setup-feature-cloud-sync
# and -desc above, rather than inventing new copy for the same capability.
workspace-home-cloud-sync-title = Cloud Sync
workspace-home-cloud-sync-desc = Sync data to cloud PostgreSQL with backup
workspace-home-audit-title = Audit Log
workspace-home-audit-desc = View system activity and change history
workspace-home-terminals-title = Terminals
workspace-home-terminals-desc = Manage POS terminals and devices
workspace-home-locations-title = Locations
workspace-home-locations-desc = Manage physical locations and branches
workspace-home-shifts-title = Shifts
workspace-home-shifts-desc = Manage staff shifts and schedules
workspace-home-tax-config-title = Tax Rates
workspace-home-tax-config-desc = Configure tax rates and rules
workspace-home-exchange-rates-title = Exchange Rates
workspace-home-exchange-rates-desc = Configure currency exchange rates
workspace-home-promotions-title = Promotions
workspace-home-promotions-desc = Create and manage promotions
workspace-home-offline-queue-title = Offline Queue
workspace-home-offline-queue-desc = View pending offline sync items
workspace-home-features-title = Features
workspace-home-features-desc = Toggle feature availability
workspace-home-data-management-title = Data
workspace-home-data-management-desc = Back up, export, and import data
workspace-home-workspaces-section = Workspaces
workspace-home-tools-section = Tools
# Tools group headers — the agreed information architecture
# (todo-tools.md): Operations / Insights / Configuration.
workspace-home-tools-group-operations = Operations
workspace-home-tools-group-insights = Insights
workspace-home-tools-group-configuration = Configuration
# Locked tool cards: tier-ineligible cards stay visible (greyed,
# non-clickable) with a minimum-tier badge; subscription-invalid and
# role-locked cards show their own reason.
workspace-home-tools-requires-tier-plus = Requires Plus plan
workspace-home-tools-requires-tier-pro = Requires Pro plan
workspace-home-tools-requires-tier-premium = Requires Premium plan
workspace-home-tools-requires-tier-enterprise = Requires Enterprise plan
workspace-home-tools-subscription-inactive = Subscription inactive
workspace-home-tools-requires-role = Admin access required
workspace-home-topology-title = Topology Editor
workspace-home-topology-desc = Design locations, workspaces, and device links
workspace-home-memo-title = Memos
workspace-home-memo-desc = Write notices for terminals and locations
workspace-home-add-workspace = Add Workspace
workspace-home-add-workspace-desc = Configure workspaces in the topology editor
workspace-home-add-workspace-aria = Add workspace via topology editor
workspace-home-reports-aria = Open Reports
workspace-home-shortcut-open = Open

# Warehouse workspace
warehouse-title = Warehouse Inventory
warehouse-location = Location
warehouse-no-location-title = No warehouse location
warehouse-no-location-desc = This workspace is not bound to a warehouse location. Configure it in the topology editor.
warehouse-empty-title = No products
warehouse-empty-desc = No inventory-tracked products found at this location.
warehouse-load-error = Failed to load warehouse inventory.
warehouse-adjust-error = Failed to adjust stock.
warehouse-col-sku = SKU
warehouse-col-name = Name
warehouse-col-category = Category
warehouse-col-qty = Qty
warehouse-col-cost = Cost
warehouse-col-actions = Actions
warehouse-products-count = products
warehouse-low-stock-alerts = low stock alerts
warehouse-search-placeholder = Search by name or SKU…
warehouse-search-aria = Search products
warehouse-filter-category = Filter by category
warehouse-filter-stock = Filter by stock status
warehouse-all-categories = All categories
warehouse-stock-all = All stock
warehouse-stock-in = In stock
warehouse-stock-out = Out of stock
warehouse-stock-low = Low stock
warehouse-no-results = No products match your search.
warehouse-stat-total = Total
warehouse-stat-out-of-stock = Out of stock
warehouse-stat-low-stock = Low stock
warehouse-btn-adjust = Adjust
warehouse-adjust-title = Adjust Stock
warehouse-adjust-current = Current stock
warehouse-adjust-delta-label = Quantity change (use + to add, − to remove)
warehouse-adjust-reason-label = Reason
warehouse-adjust-reason-placeholder = e.g. stock count, damage, return
warehouse-adjust-confirm = Confirm
warehouse-adjust-cancel = Cancel
warehouse-mode-tabs-aria = Warehouse mode

# ── Warehouse POS console (v2) ────────────────────────────────
warehouse-mode-receive = Receive
warehouse-mode-send = Send
warehouse-mode-count = Count
warehouse-mode-stock = Stock
warehouse-mode-receive-desc = Receive goods inbound
warehouse-mode-send-desc = Send goods outbound
warehouse-mode-count-desc = Cycle count
warehouse-mode-stock-desc = View stock

warehouse-scan-placeholder = Scan barcode or type SKU…
warehouse-scan-aria = Scan barcode or type SKU
warehouse-scan-add = Add
warehouse-scan-no-match = No product matches that barcode
warehouse-bin = Bin: { $bin }

warehouse-session-empty = Session is empty — scan or pick products
warehouse-session-items = { $count } item{ $count ->
  [one] 
 *[other] s
}
warehouse-session-line-qty = Qty
warehouse-session-line-picked = Picked
warehouse-session-complete-receive = Complete Receive
warehouse-session-complete-send = Complete Send
warehouse-session-print = Print
warehouse-session-clear = Clear

warehouse-fn-receive = Receive
warehouse-fn-send = Send
warehouse-fn-count = Count
warehouse-fn-stock = Stock
warehouse-fn-print = Print
warehouse-fn-reserved = { $key }
warehouse-fn-fullscreen = Fullscreen
warehouse-fn-bar-aria = Function keys
warehouse-shortcut-list = Shortcut list
warehouse-shortcut-close = Close

warehouse-popup-receive-title = Incoming session
warehouse-popup-send-title = Outgoing session
warehouse-popup-count-title = Count session
warehouse-popup-close = Close

warehouse-send-destination = Send to…
warehouse-send-destination-aria = Choose destination
warehouse-send-confirmed = Sent! { $number } — { $count } items to { $destination }
warehouse-send-verify-hint = Scan each item to verify it is picked
warehouse-send-unpicked = { $count } line{ $count ->
  [one]  not picked
 *[other] s not picked
}

warehouse-receive-source-po = Receive from purchase order
warehouse-receive-source-transfer = Receive from transfer
warehouse-receive-no-transfers = No in-transit transfers
warehouse-receive-no-pos = No approved purchase orders
warehouse-receive-confirmed = Received! { $number } — { $count } items
warehouse-receive-expected = Expected
warehouse-receive-received = Received
warehouse-receive-damaged = Damaged
warehouse-receive-short = Short

warehouse-count-create = Start Count
warehouse-count-type = Count type
warehouse-count-notes = Notes
warehouse-count-start = Start
warehouse-count-open = Open counts
warehouse-count-history = History
warehouse-count-lines = lines
warehouse-count-empty = No lines yet — scan a barcode to start counting
warehouse-count-back = Back
warehouse-count-complete = Complete Count
warehouse-count-complete-success = Count complete — { $count } adjustments posted
warehouse-count-error = Count failed
