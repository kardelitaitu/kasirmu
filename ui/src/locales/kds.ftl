# ui/src/locales/kds.ftl — Kitchen Display System

kds-title = Kitchen Display
kds-screen-title = Kitchen Display
kds-screen-aria = Kitchen Display System
kds-pending = Pending
kds-preparing = Preparing
kds-ready = Ready
kds-served = Served
kds-cancelled = Cancelled
kds-item-status-pending = Pending
kds-item-status-preparing = Preparing
kds-item-status-ready = Ready
kds-item-status-served = Served
kds-item-status-cancelled = Cancelled
kds-order-number = Order #
kds-items =
    { $count ->
        [one] 1 item
       *[other] { $count } items
    }
kds-notes = Notes
kds-tap-to-advance = Tap to advance
kds-tap-to-advance-label = Order { $number }, tap to advance
kds-no-orders = No orders yet
kds-no-orders-filtered = No orders in this status
kds-order-count =
    { $count ->
        [one] 1 order
       *[other] { $count } orders
    }
kds-column-count =
    { $count ->
        [one] 1 order
       *[other] { $count } orders
    }
kds-time-ago-now = now
kds-time-ago = { $minutes }m
kds-urgent-badge = URGENT
kds-pull-to-refresh = Pull down to refresh
kds-release-to-refresh = Release to refresh

# Layout switcher
kds-layout-label = Layout
kds-layout-display-label = Display
kds-layout-options-aria = Layout options
kds-layout-popover-aria = KDS layout and display options
kds-layout-order-id = Order ID
kds-layout-table-number = Table Number
kds-layout-kanban = Kanban
kds-layout-focus = Focus
kds-layout-metro = Metro

# Settings panel
kds-settings-aria = KDS settings
kds-settings-sound = Sound
kds-settings-yellow = Yellow
kds-settings-yellow-aria = Yellow escalation threshold in minutes
kds-settings-red = Red
kds-settings-red-aria = Red escalation threshold in minutes
kds-slider-value-min = { $min } minutes
kds-settings-auto-ack = Auto-accept
kds-settings-density = Column
kds-settings-density-comfortable = 1
kds-settings-density-compact = 2

# ── 3a: Zone switching ──
kds-zone-filter-aria = Filter by kitchen zone
kds-zone-all = All

# ── 2c: Priority/rush flag ──
kds-rush-badge = RUSH

# ── 2b: History/recall view ──
kds-loading = Loading orders…
kds-history-toggle-aria = Toggle order history
kds-history-toggle-title = Order history
kds-history-filter-aria = Filter by status
kds-history-loading = Loading history...
kds-history-error = Failed to load order history
kds-history-empty = No completed orders yet
kds-history-received = Received
kds-history-served = Served

# ── 3f: Ticket editing ──
kds-edit-items-btn = Edit Items
kds-edit-items-btn-aria = Edit ticket items
kds-edit-items-aria = Edit items
kds-edit-count-label = Count
kds-edit-count-aria = Item count
kds-edit-save = Save
kds-edit-save-aria = Save items
kds-edit-cancel = Cancel
kds-edit-cancel-aria = Cancel edit

# ── 2a: Course names (Phase 2) ──
kds-course-appetizer = APPETIZER
kds-course-main = MAIN
kds-course-side = SIDE
kds-course-dessert = DESSERT
kds-course-beverage = BEVERAGE
kds-course-none = None
kds-course-other = OTHER
kds-course-loading = Loading items...
kds-course-modifier-separator =: 

# ── 3b: Offline resilience ──
kds-offline-label = Offline — showing cached orders
kds-offline-queued = { $count } update(s) queued — offline
kds-offline-queued-update = Update queued — will sync when online
# OFF-05: actions that exhausted retries and need operator attention
kds-offline-dead-letter = { $count } update(s) could not be synced after repeated attempts. Tap Retry to re-queue or clear to dismiss.
kds-offline-dead-letter-aria = Failed updates awaiting operator attention
kds-offline-dead-letter-clear-aria = Clear failed updates
# OFF-08: local persistence is unavailable — queued actions are not durable
kds-offline-storage-unavailable = Local offline storage is unavailable. Queued updates will be lost on reload.
kds-offline-retry = Retry
kds-offline-retry-aria = Retry pending updates
kds-offline-dismiss-aria = Dismiss offline banner

# ── 3d: Voice callout ──
kds-order-up-tts = Order
kds-ready-tts = up

# ── 3f: Add items button + product picker (TODO 3f) ──
kds-add-items-btn = Add Items
kds-add-items-btn-aria = Add items to order
kds-picker-title = Add Items to Order
kds-picker-close-aria = Close picker
kds-picker-search-placeholder = Search products...
kds-picker-search-aria = Search products
kds-picker-loading = Loading products...
kds-picker-error = Failed to load products
kds-picker-no-products = No products found
kds-picker-clear-search = Clear search
kds-picker-selected = Selected
kds-picker-picked-empty = Click products to add them
kds-picker-course-aria = Course
kds-picker-qty-decrease = Decrease quantity
kds-picker-qty-increase = Increase quantity
kds-picker-remove-aria = Remove { $name }
kds-picker-cancel = Cancel
kds-picker-add-btn = Add { $count } item(s)
kds-picker-added-label = added

# ── UX audit: keyboard shortcuts + error retry ──
kds-shortcuts-aria = Keyboard shortcuts
kds-shortcuts-label = Keyboard shortcuts
kds-shortcut-select = Select ticket by position
kds-shortcut-advance = Advance selected ticket
kds-shortcut-navigate = Navigate tickets
kds-shortcut-deselect = Deselect / close
kds-error-retry-aria = Retry
kds-error-dismiss-aria = Dismiss
kds-error-update-failed = Failed to update the order — try again
kds-enrollment-failed = Device enrollment failed — check the connection and try again

# ── KDS Device Enrollment ──
kds-enrollment-title = Enroll KDS Device
kds-enrollment-close-aria = Close enrollment
kds-enrollment-name-label = Device Name
kds-enrollment-name-placeholder = e.g. Grill Display, Expo Screen
kds-enrollment-name-aria = KDS device display name
kds-enrollment-stations-label = Station Assignments (optional)
kds-enrollment-stations-placeholder = Type station name and press Enter
kds-enrollment-stations-aria = Add station assignment
kds-enrollment-stations-hint = Enter topology station IDs this device should display. Leave empty for broadcast mode (all orders).
kds-enrollment-station-remove-aria = Remove station { $station }
kds-enrollment-generating = Generating enrollment token…
kds-enrollment-success = Device registered successfully!
kds-enrollment-expiry-note = The enrollment token expires in 5 minutes. Scan the QR code with the KDS device to complete setup.
kds-enrollment-cancel = Cancel
kds-enrollment-create-btn = Create Device
kds-enrollment-done = Done
kds-enrollment-error = Failed to register device
kds-enrollment-scan-instruction = Scan this QR code with the KDS device to complete pairing.
kds-enrollment-qr-aria = QR code for enrolling { $name }
kds-enrollment-countdown = Token expires in { $seconds }s
kds-enrollment-expired = Token has expired — close and re-enroll to generate a new one

# ── KDS Device Status ──
kds-device-status-connected = Connected
kds-device-status-disconnected = Disconnected
kds-device-status-stale = Stale
kds-device-status-aria = KDS devices: { $connected } of { $total } connected
kds-device-list-aria = KDS device list
kds-device-enroll = Enroll device
kds-device-enroll-aria = Open the KDS device enrollment dialog

# ── Hamburger settings panel ──
kds-settings-theme = Theme
kds-settings-theme-toggle-aria = Toggle light or dark theme
kds-layout-order-id-caption = Show order number on cards
kds-layout-table-number-caption = Show table number on cards
kds-settings-sound-caption = Chime when an order arrives
kds-settings-auto-ack-caption = New orders appear without tapping Accept

# ── Topbar tabs + back ──
kds-back-aria = Back to workspaces
kds-tablist-aria = View orders
kds-tab-open = Open
kds-tab-completed = Completed

# ── Ticket card footer actions ──
kds-advance-start = Start
kds-advance-ready = Mark Ready
kds-advance-serve = Serve
kds-toggle-card-aria = Toggle order { $number } details
kds-toggle-card-aria-collapsed =
    { kds-toggle-card-aria } (collapsed)
kds-new-orders-announced =
    { $count ->
        [one] 1 new order
       *[other] { $count } new orders
    }

# ── Topbar filter dropdown ──
kds-filter-aria = Filter orders
kds-filter-all = All Categories
kds-filter-prepared = Prepared
kds-filter-selected = { $count } selected
kds-filter-completed-all = All
kds-filter-dinein = Dine in
kds-filter-takeaway = Takeaway

# ── Screen footer status bar ──
kds-footer-aria = Terminal status
kds-footer-last-sync = Last sync: { $time }
kds-footer-never = never
kds-footer-seconds = { $count }s ago
kds-footer-minutes = { $count }m ago
kds-footer-hours = { $count }h ago

# ── Completed tab (bucket columns) ──
kds-completed-aria = Completed orders
kds-completed-load-failed = Failed to load completed orders
kds-completed-retry-aria = Retry loading completed orders
kds-completed-today = Today
kds-completed-yesterday = Yesterday
kds-completed-this-week = This Week
kds-completed-older = Older
kds-completed-today-empty = No orders
kds-completed-yesterday-empty = No orders
kds-completed-this-week-empty = No orders
kds-completed-older-empty = No orders
kds-completed-status = Completed
kds-completed-reopen = Reopen
kds-completed-reopen-aria = Reopen order { $number }

# ── Shift ──
kds-shift-start = Start Shift
kds-shift-end = End Shift
kds-shift-end-title = End Shift?
kds-shift-end-msg = Are you sure you want to end the current kitchen shift?

# ── Confirm modal ──
kds-confirm-cancel = Cancel
kds-confirm-ok = Confirm

# ── Display settings ──
kds-settings-display-scale = Display scale
kds-settings-columns = Columns

# ── Colours ──
kds-settings-card-colours = Colours
kds-settings-color-dinein = Dine in
kds-settings-color-takeaway = Takeaway
kds-settings-color-rush = Rush
kds-settings-color-pending = Pending
kds-settings-color-preparing = Preparing
kds-settings-color-ready = Ready
kds-settings-color-complete = Complete
kds-settings-reset-colours = Reset colours

# ── Card Animations ──
kds-settings-card-animations = Card animations
kds-settings-card-animations-caption = Spawn and reorder effects

# ── Hardware Acceleration ──
kds-settings-hw-accel = Hardware acceleration
kds-settings-hw-accel-caption = Blur and GPU effects

# ── Hamburger panel: section headings, icon-only controls, colour pickers ──
# Recovered by the Fluent page audit. These were hardcoded English strings in
# KdsHamburgerPanel.tsx, which the rev-1 parity gate could not see because it
# only walked <Localized id="..."> under ui/src/features/**.
kds-panel-section-settings = Settings
kds-panel-section-behaviour = Behaviour
kds-theme-dark-aria = Dark theme
kds-theme-light-aria = Light theme
kds-zoom-out-aria = Zoom out
kds-zoom-in-aria = Zoom in
kds-zoom-reset-title = Reset to 100%
kds-zoom-reset-aria = Reset zoom to 100%
kds-cols-decrease-aria = Fewer columns
kds-cols-increase-aria = More columns
kds-cols-reset-title = Reset to auto
kds-cols-reset-aria = Reset columns to auto
kds-cols-auto = Auto
# Accessible name for a colour row's native picker: the localized row label
# plus this suffix. The previous code interpolated the raw key id, so a screen
# reader announced "kds-settings-color-dinein colour picker".
kds-color-picker-aria = { $name } colour picker
