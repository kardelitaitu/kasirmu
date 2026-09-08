# API Reference — OZ-POS

> **Derived from the `#[tauri::command]` definitions in both clients, NOT from
> `generate_handler!` — the two sets differ, and the difference is the interesting
> part.** Regenerated 31-08-26, reconciled against reality 08-09-26. The live
> registered surface is **450 distinct commands** (measured 08-09-26; 425 in
> `apps/desktop-client/src/lib.rs`, 297 in `apps/tablet-client/src/lib.rs`, 272 in
> both). This page lists **505 entries across 49 modules**; the 55-entry gap is
> measured, not estimated, and breaks down as:
>
> | Class | Count | What it means |
> |---|---|---|
> | Marker wrong | 11 | Listed `[D]` or `[T]`, actually available in both shells (e.g. `discover_hardware_scoped`, `version`, `test_sync_connection`). |
> | Listed but **not registered anywhere** | 85 | A real `#[command]` fn that no `generate_handler!` includes, so the front-end cannot invoke it. Mostly the legacy unscoped twins of `*_scoped` commands (42 desktop, 124 tablet defined-but-unregistered overall). |
> | Listed and **not defined anywhere** | 14 | Stale names. `create_kds_order_from_sale`, `get_kds_order`, `get_kds_queue`, `list_kds_orders`, `update_kds_status`, and the seven `*_store_profile_scoped` entries. These are not deprecated paths — they do not exist. |
> | Registered but **not listed** | 44 | Missing from this page entirely: `create_role_scoped`, `delete_role_scoped`, `acknowledge_memo_scoped`, `create_legal_entity_scoped`, `create_location_profile_scoped`, `explain_feature_availability_scoped`, `get_over_quota_report`, `delete_topology_template`, and 36 more. |
>
> Reproduce every number above with
>
> ```bash
> python .agents/skills/docs-auditor/scripts/check-api-surface.py   # exit 1 today, by design
> ```
>
> It parses `generate_handler![...]` in each `lib.rs` for the registered set, every
> `#[command]` fn under `src/` for the defined set, and the entry lines of this page for
> the documented set, then reports the four classes separately. It is deliberately not
> wired into `check.sh`, `gates.json` or CI: this page is red against it right now, and a
> gate that starts life failing gets muted rather than fixed. Wiring it in needs the
> 154 discrepancies resolved first, or an explicit baseline.
>
> Each entry shows availability — **[D+T]** both clients, **[D]** desktop-only,
> **[T]** tablet-only — followed by the command's own `///` summary line. The
> `*_scoped` / unscoped split is the ADR #7 multi-store convention: the scoped
> variant resolves the store from the session token; the unscoped variant is the
> legacy global-DB path (deprecated where a scoped twin exists). For full parameter
> and return types, read the `#[tauri::command]` fn in
> `apps/desktop-client/src/commands/<module>.rs` (or the tablet equivalent). All
> commands return `Result<T, AppError>`.

<!-- regenerate: parse generate_handler! in both lib.rs for the surface, and the /// doc comments in commands/*.rs for the summaries -->
### `commands::analytics` (2)

- **`get_staff_analytics_daily_scoped`** [D+T] — Per-day shift + sales series for one staff member over `[from, to]`.
- **`get_staff_analytics_scoped`** [D+T] — Per-staff shift + sales summary for the session's store over `[from, to]`.

### `commands::audit` (4)

- **`export_audit_log_scoped`** [D+T] — Export the session store's audit log to CSV (AUD-09).
- **`get_audit_review_status_scoped`** [D+T] — Fetch the session store's latest review checkpoint + unreviewed count
- **`list_audit_log_scoped`** [D+T] — Fetch audit log entries scoped to the session's store (AUD-01).
- **`mark_audit_reviewed_scoped`** [D+T] — Persist a server-side review checkpoint for the session's store (AUD-04).

### `commands::auth` (8)

- **`create_session`** [D+T] — Create a new session and return an opaque session token.
- **`destroy_session`** [D+T] — Destroy an active session, invalidating the token.
- **`has_users`** [D] — Check whether any staff accounts exist in the database.
- **`refresh_picker_ticket`** [D] — Mint a fresh picker ticket for a caller who already holds a valid session token.
- **`session_keepalive`** [D+T] — Refresh the current session's TTL so long-lived screens (analytics,
- **`staff_check_username`** [D+T] — Check a username before the PIN step (STAFF-06).
- **`staff_login`** [D+T] — Authenticate a staff member by username and PIN.
- **`verify_pin`** [D] — Verify the current session user's PIN.

### `commands::branding` (10)

- **`get_brand_settings`** [T] — Load all brand settings at once.
- **`get_brand_settings_scoped`** [D+T] — Load all brand settings resolved from a session token. ADR #7.
- **`pick_logo_file`** [D] — Open a native file picker filtered to image files and return the
- **`pick_logo_file_scoped`** [D] — Session-scoped variant of [`pick_logo_file`].
- **`set_brand_logo_path`** [T] — Set the filesystem path to the store logo.
- **`set_brand_logo_path_scoped`** [D+T] — Set the brand logo path (scoped — two-phase db access).
- **`set_brand_primary_colour`** [T] — Set the primary brand colour.
- **`set_brand_primary_colour_scoped`** [D+T] — Scoped variant of `set_brand_primary_colour` (ADR #7).
- **`set_brand_store_name`** [T] — Set the brand store display name.
- **`set_brand_store_name_scoped`** [D+T] — Scoped variant of `set_brand_store_name` (ADR #7).

### `commands::browser` (2)

- **`open_product_images`** [T] — Open a Google Images search for a product in the default browser.
- **`open_product_images_scoped`** [D] — Open a Google Images search for a product in the default browser.

### `commands::bundles` (12)

- **`create_bundle`** [T] — Create bundle.
- **`create_bundle_scoped`** [D+T] — Create a new bundle (scoped).
- **`delete_bundle`** [T] — Delete bundle.
- **`delete_bundle_scoped`** [D+T] — Scoped variant of `delete_bundle` (ADR #7).
- **`get_bundle`** [T] — Get bundle.
- **`get_bundle_scoped`** [D+T] — Scoped variant of `get_bundle` (ADR #7).
- **`list_bundles`** [T] — List bundles.
- **`list_bundles_scoped`** [D+T] — Scoped variant of `list_bundles` (ADR #7).
- **`lookup_bundle_by_sku`** [T] — Lookup bundle by sku.
- **`lookup_bundle_by_sku_scoped`** [D+T] — Scoped variant of `lookup_bundle_by_sku` (ADR #7).
- **`update_bundle`** [T] — Update bundle.
- **`update_bundle_scoped`** [D+T] — Scoped variant of `update_bundle` (ADR #7).

### `commands::categories` (5)

- **`create_category_scoped`** [D+T] — Create category in the store resolved from a session token (CAT-01).
- **`delete_category_scoped`** [D+T] — Delete a category in the store resolved from a session token (CAT-01/02).
- **`list_categories`** [T] — Fetch all categories, ordered by name.
- **`list_categories_scoped`** [D+T] — Fetch all categories for the store resolved from a session token. ADR #7.
- **`update_category_scoped`** [D+T] — Update a category in the store resolved from a session token (CAT-01).

### `commands::currencies` (7)

- **`currency_info`** [D+T] — Currency info.
- **`currency_info_scoped`** [D] — Session-scoped variant of [`currency_info`].
- **`get_default_currency`** [D+T] — Get default currency.
- **`get_default_currency_scoped`** [D+T] — Get the default currency in the store resolved from a session token. ADR #7.
- **`list_currencies_scoped`** [D+T] — List currencies resolved from a session token. ADR #7.
- **`set_default_currency`** [D+T] — Set default currency.
- **`set_default_currency_scoped`** [D+T] — Set the default currency in the store resolved from a session token. ADR #7.

### `commands::customers` (7)

- **`create_customer_scoped`** [D+T] — Create a customer in the store resolved from a session token.
- **`delete_customer_scoped`** [D+T] — Delete a customer from the store resolved from a session token. ADR #7.
- **`get_customer_history_scoped`** [D+T] — Get the read-only history for a customer (CUST-05). ADR #7.
- **`get_customer_scoped`** [D+T] — Scoped variant of `get_customer` (ADR #7).
- **`list_customers_scoped`** [D+T] — List customers for the store resolved from a session token. ADR #7.
- **`search_customers_scoped`** [D+T] — Search customers in the store resolved from a session token. ADR #7.
- **`update_customer_scoped`** [D+T] — Update a customer in the store resolved from a session token. ADR #7.

### `commands::data` (7)

- **`create_backup`** [D] — Create backup.
- **`create_backup_scoped`** [D] — Session-scoped variant of [`create_backup`].
- **`export_data`** [D] — Export data.
- **`get_backup_status`** [D] — Get backup status.
- **`get_backup_status_scoped`** [D] — Session-scoped variant of [`get_backup_status`].
- **`import_data`** [D] — Import data.
- **`import_preview`** [D] — Import preview.

### `commands::edc` (5)

- **`edc_refund`** [D] — Refund a previously captured card transaction.
- **`edc_sale`** [D] — Process a card-present sale (authorize + capture in one call).
- **`edc_terminal_status`** [D] — Query the EDC terminal's current status.
- **`edc_terminal_status_scoped`** [D] — Session-scoped variant of [`edc_terminal_status`].
- **`edc_void`** [D] — Void a pending authorisation before capture.

### `commands::email` (4)

- **`get_report_schedule`** [D] — Get the current report schedule configuration.
- **`get_report_schedule_scoped`** [D] — Session-scoped variant of [`get_report_schedule`].
- **`save_report_schedule`** [D] — Save the report schedule configuration.
- **`send_test_report`** [D] — Send a test report email using the currently configured SMTP

### `commands::exchange_rates` (5)

- **`create_exchange_rate_scoped`** [D+T] — Create an exchange rate in the store resolved from a session token. ADR #7.
- **`delete_exchange_rate_scoped`** [D+T] — Delete an exchange rate in the store resolved from a session token. ADR #7.
- **`get_latest_exchange_rate_scoped`** [D+T] — Return the latest exchange rate for a pair effective on/before
- **`list_exchange_rates_scoped`** [D+T] — List exchange rates in the store resolved from a session token. ADR #7.
- **`list_latest_exchange_rates_scoped`** [D+T] — The current rate for every pair (CUR-11), store resolved from a

### `commands::features` (4)

- **`list_all_features`** [D+T] — Fetch every known feature with its current enabled status, metadata,
- **`list_all_features_scoped`** [D] — Session-scoped variant of [`list_all_features`].
- **`set_feature`** [D+T] — Enable or disable a single feature flag.
- **`set_features_bulk`** [D+T] — Enable or disable multiple feature flags atomically in a single

### `commands::gift_cards` (16)

- **`freeze_gift_card`** [T] — Freeze gift card.
- **`freeze_gift_card_scoped`** [D+T] — Freeze a gift card (scoped).
- **`get_gift_card`** [T] — Get gift card.
- **`get_gift_card_balance`** [T] — Get gift card balance.
- **`get_gift_card_balance_scoped`** [D+T] — Get the current balance of a gift card (scoped).
- **`get_gift_card_scoped`** [D+T] — Get a gift card by its card number or internal ID (scoped).
- **`issue_gift_card`** [T] — Issue gift card.
- **`issue_gift_card_scoped`** [D+T] — Issue a new gift card (scoped — requires valid session).
- **`list_gift_cards`** [T] — List gift cards.
- **`list_gift_cards_scoped`** [D+T] — List all gift cards with optional filtering by status (scoped).
- **`redeem_gift_card`** [T] — Redeem gift card.
- **`redeem_gift_card_scoped`** [D+T] — Redeem (spend) a gift card balance against a sale (scoped).
- **`top_up_gift_card`** [T] — Top_up gift card.
- **`top_up_gift_card_scoped`** [D+T] — Add value (top up) to an existing gift card (scoped).
- **`unfreeze_gift_card`** [T] — Unfreeze gift card.
- **`unfreeze_gift_card_scoped`** [D+T] — Unfreeze a previously frozen gift card (scoped).

### `commands::hardware` (16)

- **`discover_hardware_scoped`** [D] — Discover all connected USB hardware devices (scoped).
- **`display_clear_scoped`** [D] — Clear a customer-facing pole display (scoped).
- **`display_show_scoped`** [D] — Show content on a customer-facing pole display (scoped).
- **`list_displays_scoped`** [D] — List all registered customer displays (scoped).
- **`list_scanners`** [T] — List all registered barcode scanners.
- **`list_scanners_scoped`** [D+T] — List all registered barcode scanners (scoped).
- **`open_cash_drawer`** [T] — Open cash drawer.
- **`open_cash_drawer_scoped`** [D+T] — Open cash drawer (scoped — requires valid session).
- **`print_receipt`** [T] — Print receipt.
- **`print_receipt_scoped`** [D+T] — Print receipt (scoped — requires valid session).
- **`print_sales_receipt`** [T] — Print sales receipt.
- **`print_sales_receipt_scoped`** [D+T] — Print sales receipt for the store resolved from a session token. ADR #7.
- **`start_scanner`** [T] — Start a background polling task for the named scanner.
- **`start_scanner_scoped`** [D+T] — Start a barcode scanner (scoped).
- **`stop_scanner`** [T] — Stop the active barcode scanner background task (if any).
- **`stop_scanner_scoped`** [D+T] — Stop the active barcode scanner (scoped).

### `commands::health` (8)

- **`get_device_id`** [D+T] — Get the stable device identifier (hostname) for terminal binding.
- **`get_device_id_scoped`** [D] — Session-scoped variant of [`get_device_id`].
- **`get_local_ip`** [D+T] — Get the local IP address of the machine.
- **`get_local_ip_scoped`** [D] — Session-scoped variant of [`get_local_ip`].
- **`ping`** [D+T] — Liveness probe. Returns `Ok("pong")` if the Tauri runtime is alive.
- **`ping_scoped`** [D] — Session-scoped variant of [`ping`].
- **`version`** [T] — Version.
- **`version_scoped`** [D] — Version info resolved from a session token. ADR #7.

### `commands::history` (10)

- **`export_daily_summary`** [T] — Export daily summary.
- **`export_daily_summary_scoped`** [D+T] — Fetch the daily sales summary for the store resolved from a session token.
- **`export_eod_report`** [T] — Fetch the full EOD (End-of-Day) report for today.
- **`export_eod_report_scoped`** [D+T] — Fetch the full EOD report for the store resolved from a session token.
- **`export_sales_by_hour`** [T] — Export sales by hour.
- **`export_sales_by_hour_scoped`** [D+T] — Fetch sales-by-hour breakdown for the store resolved from a session token.
- **`get_sale`** [T] — Get sale.
- **`get_sale_scoped`** [D+T] — Fetch a single sale by ID from the store resolved from a session token.
- **`list_sales`** [T] — List sales.
- **`list_sales_scoped`** [D+T] — List all sales for the store resolved from a session token.

### `commands::inventory` (24)

- **`acknowledge_stock_alert_scoped`** [D] — Acknowledge a stock alert event (records who acknowledged it).
- **`active_stock_alerts_scoped`** [D] — Get active stock alerts for a location (enriched with product SKU/name).
- **`create_inventory_location`** [D] — Create a new inventory location.
- **`create_inventory_transaction`** [D] — Create a new manual / staff inventory transaction audit log session.
- **`deactivate_inventory_location`** [D] — Deactivate an inventory location (fails if contains stock or pending transfers).
- **`delete_stock_threshold`** [D] — Delete a stock alert threshold boundary.
- **`end_inventory_shift`** [D] — End an active inventory shift.
- **`finalize_sale`** [D] — Transition a pending sale's status to completed after payment capture.
- **`get_active_inventory_shift`** [D] — Retrieve the active inventory shift for the current user, if any.
- **`get_inventory_transaction`** [D] — Retrieve details of a single transaction, including its lines.
- **`get_low_stock_alerts_at_location_scoped`** [D] — Get per-location low stock alerts.
- **`get_stock_thresholds`** [D] — Get stock alert thresholds for a location.
- **`get_workspace_inventory_locations`** [D] — Get inventory location bindings for a workspace instance.
- **`get_workspace_locations_scoped`** [D] — Resolve locations bound to a workspace instance (unified resolver ADR-19 §10).
- **`invalidate_location_cache_scoped`** [D] — Invalidate the location resolver cache.
- **`list_inventory_locations`** [D] — List all inventory locations.
- **`list_inventory_shifts`** [D] — List all inventory shifts history.
- **`list_inventory_transactions`** [D] — List all inventory transactions.
- **`list_inventory_transactions_for_shift`** [D] — List inventory transactions for a specific shift (staff + location + time window).
- **`set_stock_threshold`** [D] — Set a stock alert threshold boundary.
- **`set_workspace_inventory_locations`** [D] — Set inventory location bindings for a workspace instance.
- **`start_inventory_shift`** [D] — Start a new inventory shift for the current user at a location.
- **`update_inventory_location`** [D] — Update details of an existing inventory location.
- **`void_pending_sale`** [D] — Void a pending sale and restore stock.

### `commands::inventory_counts` (10)

- **`add_count_line_scoped`** [D+T] — Add a line to an editable count in the session's store.
- **`complete_stock_count_scoped`** [D+T] — Complete a count and attribute generated adjustments to the session user.
- **`create_stock_count_scoped`** [D+T] — Create a stock count in the session's store and attribute it to the session user.
- **`get_count_lines_scoped`** [D+T] — Fetch lines from a count in the session's store.
- **`get_stock_count_scoped`** [D+T] — Fetch one stock count from the session's store.
- **`list_stock_adjustments_scoped`** [D+T] — List adjustments from the session's store.
- **`list_stock_counts_scoped`** [D+T] — List stock counts from the session's store.
- **`remove_count_line_scoped`** [D+T] — Remove a line belonging to an editable count in the session's store.
- **`update_count_line_scoped`** [D+T] — Update a line belonging to an editable count in the session's store.
- **`update_stock_count_status_scoped`** [D+T] — Move an editable count to `in_progress` or `cancelled`.

### `commands::kds` (14)

- **`create_kds_order_from_sale`** [T] — Create KDS orders from a completed sale. Returns one order per kitchen zone.
- **`create_kds_order_from_sale_scoped`** [D+T] — Create KDS orders in the store resolved from a session token. ADR #7.
- **`get_kds_order`** [T] — Get a KDS order by id.
- **`get_kds_order_lines_scoped`** [D] — Get all line items for a KDS order (scoped — ADR #7).
- **`get_kds_order_scoped`** [D+T] — Get a KDS order from the store resolved from a session token. ADR #7.
- **`get_kds_queue`** [T] — Get the kitchen queue (pending + preparing + ready, ordered oldest first).
- **`get_kds_queue_scoped`** [D+T] — Get the kitchen queue for the store resolved from a session token. ADR #7.
- **`list_kds_orders`** [T] — List KDS orders, optionally filtered by status.
- **`list_kds_orders_scoped`** [D+T] — List KDS orders for the store resolved from a session token. ADR #7.
- **`print_kds_chit_scoped`** [D] — Print a kitchen chit for a specific KDS order by ID (scoped — ADR #7).
- **`update_kds_line_item_status_scoped`** [D] — Update the status of a single KDS line item in the store resolved
- **`update_kds_order_items_scoped`** [D] — Update the items on a KDS order in the store resolved from a session token. ADR #7.
- **`update_kds_status`** [T] — Update a KDS order's status. Sets the appropriate timestamp automatically.
- **`update_kds_status_scoped`** [D+T] — Update a KDS order's status in the store resolved from a session token. ADR #7.

### `commands::kds_device` (6)

- **`ack_kds_order_scoped`** [D] — Acknowledge a KDS order — the device accepted the ticket and started
- **`deactivate_kds_device_scoped`** [D] — Deactivate a KDS device (soft-delete).
- **`get_kds_device_scoped`** [D] — Get a single KDS device by ID.
- **`list_kds_devices_scoped`** [D] — List all KDS devices for the Restaurant POS bound to the current session.
- **`register_kds_device_scoped`** [D] — Register a new KDS device bound to a Restaurant POS.
- **`update_kds_device_status_scoped`** [D] — Update a KDS device's connection status.

### `commands::kds_routing` (1)

- **`resolve_kds_targets_scoped`** [D] — Resolve which KDS device IDs should receive an order based on its

### `commands::license` (17)

- **`activate_license`** [D] — Activates a license key for the given email, phone, and machine ID.
- **`check_license_status`** [D] — Checks the license status against the PocketBase license server.
- **`check_license_status_scoped`** [D] — Session-scoped variant of [`check_license_status`].
- **`get_hardware_fingerprint`** [D] — Retrieves the device-level hardware fingerprint (SPEC-2026-TRIAL-LOCK).
- **`get_hardware_fingerprint_scoped`** [D] — Session-scoped variant of [`get_hardware_fingerprint`].
- **`get_license_status`** [D] — Analyzes the local license state and returns a comprehensive status response.
- **`get_license_status_scoped`** [D] — Session-scoped variant of [`get_license_status`].
- **`get_machine_id`** [D] — Retrieves the unique hardware identifier for this installation.
- **`get_machine_id_scoped`** [D] — Session-scoped variant of [`get_machine_id`].
- **`pause_subscription`** [D] — Pause the current subscription for 1–3 months.
- **`pause_subscription_scoped`** [D] — Session-scoped variant of [`pause_subscription`].
- **`renew_license`** [D] — Renews an existing license subscription with a new license key.
- **`renew_license_scoped`** [D] — Session-scoped variant of [`renew_license`].
- **`resume_subscription`** [D] — Resume a paused subscription.
- **`resume_subscription_scoped`** [D] — Session-scoped variant of [`resume_subscription`].
- **`test_auth_connection`** [D] — Ping the license server's `/api/health` endpoint to verify reachability.
- **`test_auth_connection_scoped`** [D] — Session-scoped variant of [`test_auth_connection`].

### `commands::loyalty` (8)

- **`earn_loyalty_points_scoped`** [D+T] — Awards loyalty points in the store resolved by the active session.
- **`get_loyalty_account_scoped`** [D+T] — Retrieves a loyalty account from the store resolved by the active session.
- **`get_or_create_loyalty_account_scoped`** [D+T] — Retrieves or creates a loyalty account in the active store.
- **`get_points_value_scoped`** [D+T] — Converts loyalty points into minor currency units in the active store.
- **`list_loyalty_accounts_scoped`** [D+T] — Lists loyalty accounts from the store resolved by the active session.
- **`list_loyalty_tiers_scoped`** [D+T] — Lists loyalty tiers from the store resolved by the active session.
- **`redeem_loyalty_points_scoped`** [D+T] — Redeems loyalty points in the store resolved by the active session.
- **`update_loyalty_tier_scoped`** [D+T] — Updates a loyalty tier in the store resolved by the active session.

### `commands::offline` (17)

- **`delete_offline_item`** [T] — Delete a processed offline queue item.
- **`delete_offline_item_scoped`** [D+T] — Delete a processed offline queue item (scoped).
- **`enqueue_offline`** [T] — Manually enqueue a transaction for later sync.
- **`enqueue_offline_scoped`** [D+T] — Enqueue a transaction for later sync (scoped).
- **`list_all_offline`** [T] — List all offline queue items (most recent first).
- **`list_all_offline_scoped`** [D+T] — List all offline queue items (scoped).
- **`list_pending_offline`** [T] — List all pending (unsynced) offline queue items, oldest first.
- **`list_pending_offline_scoped`** [D+T] — List all pending (unsynced) offline queue items (scoped).
- **`list_remote_failures`** [T] — List retained remote-application failures (dead-letter discovery).
- **`list_remote_failures_scoped`** [D+T] — List retained remote-application failures (scoped).
- **`offline_queue_status_summary_scoped`** [D] — Get a summary of the offline queue status (scoped).
- **`pending_offline_count`** [T] — Get the count of pending offline items.
- **`pending_offline_count_scoped`** [D+T] — Get the count of pending offline items (scoped).
- **`requeue_remote_failure`** [T] — Requeue a dead-lettered remote item so the next sync cycle retries it.
- **`requeue_remote_failure_scoped`** [D+T] — Requeue a dead-lettered remote item (scoped).
- **`retry_offline_sync`** [T] — Attempt to sync all pending offline items through the real cloud sync
- **`retry_offline_sync_scoped`** [D+T] — Attempt to sync all pending offline items (scoped).

### `commands::pos` (19)

- **`add_line_scoped`** [D+T] — Add a line to an active cart in the store resolved from a session token. ADR #7.
- **`complete_sale_scoped`** [D+T] — Complete a sale within the store resolved from a session token.
- **`complete_sale_with_resolved_shortfalls_scoped`** [D+T] — Complete a sale with cashier-resolved shortfalls (split fulfillment).
- **`compute_cart_tax_scoped`** [D+T] — Compute cart tax for the store resolved from a session token. ADR #7.
- **`delete_held_cart_scoped`** [D+T] — Delete a held cart in the store resolved from a session token. ADR #7.
- **`get_active_cart_scoped`** [T] — Load a cart in the session scope. ADR #7.
- **`get_cart_deduction_location`** [T] — Return the deduction location info for an active cart.
- **`get_cart_deduction_location_scoped`** [D] — Scoped variant of `get_cart_deduction_location` (ADR #7).
- **`get_held_cart_scoped`** [D+T] — Get a held cart from the store resolved from a session token. ADR #7.
- **`hold_cart_scoped`** [D+T] — Hold a cart in the store resolved from a session token. ADR #7.
- **`list_active_carts_scoped`** [T] — List active carts in the session scope. ADR #7.
- **`list_held_carts_scoped`** [D+T] — List held carts for the store resolved from a session token. ADR #7.
- **`list_open_bills_scoped`** [D+T] — List open bills for the store resolved from a session token. ADR #7.
- **`override_cart_deduction_location_scoped`** [D+T] — Override the deduction location lock on an active cart.
- **`override_line_price_scoped`** [D+T] — Override a line price within the store resolved from a session token.
- **`preview_promoted_total_from_lines_scoped`** [D+T] — Preview the promotion-reduced payable from raw cart lines.
- **`preview_promoted_total_scoped`** [D+T] — Preview the promotion-reduced payable for a cart without mutating it.
- **`set_cart_discount_scoped`** [D+T] — Set a cart discount within the store resolved from a session token.
- **`start_sale_scoped`** [D+T] — Start a new sale in the store resolved from a session token. ADR #7.

### `commands::product_variants` (10)

- **`create_product_variant`** [T] — Create a new product variant.
- **`create_product_variant_scoped`** [D+T] — Create a product variant (scoped).
- **`delete_product_variant`** [T] — Delete a product variant by its own SKU.
- **`delete_product_variant_scoped`** [D+T] — Scoped variant of `delete_product_variant` (ADR #7).
- **`get_product_variant`** [T] — Get a single variant by its own SKU.
- **`get_product_variant_scoped`** [D+T] — Scoped variant of `get_product_variant` (ADR #7).
- **`list_product_variants`** [T] — List all variants for a given parent product SKU.
- **`list_product_variants_scoped`** [D+T] — Scoped variant of `list_product_variants` (ADR #7).
- **`update_product_variant`** [T] — Update an existing product variant (matched by SKU).
- **`update_product_variant_scoped`** [D+T] — Update an existing product variant (scoped).

### `commands::products` (23)

- **`adjust_stock`** [T] — Adjust stock for a product identified by SKU.
- **`adjust_stock_scoped`** [D+T] — Adjust stock for the store resolved from a session token.
- **`create_product`** [T] — Create product.
- **`create_product_scoped`** [D+T] — Create a product within the store resolved from a session token.
- **`delete_product`** [T] — Delete product.
- **`delete_product_scoped`** [D+T] — Delete a product within the store resolved from a session token.
- **`get_product_track_serial`** [T] — Check whether a product tracks serial numbers.
- **`get_product_track_serial_batch`** [T] — Check serial-tracking flags for many SKUs in one round trip
- **`get_product_track_serial_batch_scoped`** [D+T] — Store-scoped batch variant of `get_product_track_serial_batch`. ADR #7.
- **`get_product_track_serial_scoped`** [D+T] — Check whether a product tracks serial numbers, store-scoped. ADR #7.
- **`list_products`** [T] — Fetch all products from the database.
- **`list_products_scoped`** [D+T] — Fetch all products for the store resolved from a session token.
- **`list_warehouse_products`** [T] — Fetch warehouse-tracked products only (excludes services).
- **`list_warehouse_products_at_location`** [D] — Fetch inventory-tracked products with stock at a specific location.
- **`list_warehouse_products_scoped`** [T] — Session-scoped variant of `list_warehouse_products`.
- **`lookup_by_barcode`** [T] — Look up a single product by barcode.
- **`lookup_by_barcode_scoped`** [D+T] — Look up a product by barcode for the store resolved from a
- **`lookup_product_by_sku`** [T] — Look up a single product by SKU.
- **`lookup_product_by_sku_scoped`** [D+T] — Look up a product by SKU for the store resolved from a
- **`record_product_search`** [T] — Record an acted-upon product search for the popularity index.
- **`record_product_search_scoped`** [D+T] — Record an acted-upon product search for the popularity index.
- **`update_product`** [T] — Update product.
- **`update_product_scoped`** [D+T] — Update a product within the store resolved from a session token.

### `commands::promotions` (14)

- **`apply_promotion`** [T] — Apply promotion.
- **`apply_promotion_scoped`** [D+T] — Apply a promotion in the store resolved from a session token. ADR #7.
- **`create_promotion`** [T] — Create promotion.
- **`create_promotion_scoped`** [D+T] — Create a promotion in the store resolved from a session token. ADR #7.
- **`delete_promotion`** [T] — Delete promotion.
- **`delete_promotion_scoped`** [D+T] — Delete a promotion in the store resolved from a session token. ADR #7.
- **`get_promotion`** [T] — Get promotion.
- **`get_promotion_scoped`** [D+T] — Get a promotion from the store resolved from a session token. ADR #7.
- **`get_sale_promotions`** [T] — Get sale promotions.
- **`get_sale_promotions_scoped`** [D+T] — Get sale promotions from the store resolved from a session token. ADR #7.
- **`list_promotions`** [T] — List promotions.
- **`list_promotions_scoped`** [D+T] — List promotions for the store resolved from a session token. ADR #7.
- **`update_promotion`** [T] — Update promotion.
- **`update_promotion_scoped`** [D+T] — Update a promotion in the store resolved from a session token. ADR #7.

### `commands::purchasing` (19)

- **`create_purchase_order`** [T] — Create purchase order.
- **`create_purchase_order_scoped`** [D+T] — Scoped variant of `create_purchase_order` (ADR #7).
- **`create_supplier`** [T] — Create supplier.
- **`create_supplier_scoped`** [D+T] — Scoped variant of `create_supplier` (ADR #7).
- **`get_purchase_order`** [T] — Get purchase order.
- **`get_purchase_order_scoped`** [D+T] — Scoped variant of `get_purchase_order` (ADR #7).
- **`get_supplier`** [T] — Get supplier.
- **`get_supplier_scoped`** [D+T] — Scoped variant of `get_supplier` (ADR #7).
- **`list_purchase_orders`** [T] — List purchase orders.
- **`list_purchase_orders_scoped`** [D+T] — Scoped variant of `list_purchase_orders` (ADR #7).
- **`list_suppliers`** [T] — List suppliers.
- **`list_suppliers_scoped`** [D+T] — Scoped variant of `list_suppliers` (ADR #7).
- **`receive_purchase_order`** [T] — Receive purchase order.
- **`receive_purchase_order_scoped`** [D+T] — Scoped variant of `receive_purchase_order` (ADR #7).
- **`receive_purchase_order_with_lines_scoped`** [D+T] — Scoped variant of `receive_purchase_order_with_lines` (ADR #7).
- **`update_po_status`** [T] — Update po status.
- **`update_po_status_scoped`** [D+T] — Scoped variant of `update_po_status` (ADR #7).
- **`update_supplier`** [T] — Update supplier.
- **`update_supplier_scoped`** [D+T] — Scoped variant of `update_supplier` (ADR #7).

### `commands::refunds` (3)

- **`list_refunds_scoped`** [D+T] — List all refunds for a sale from the store resolved from a session token.
- **`lookup_sale_by_receipt_barcode_scoped`** [D+T] — Look up a sale by receipt barcode from the store resolved from a session token.
- **`process_refund_scoped`** [D+T] — Process a refund within the store resolved from a session token.

### `commands::reports` (24)

- **`build_custom_report_scoped`** [D+T] — Build a custom report for the session's store.
- **`get_basket_size_scoped`** [D+T] — Get average basket size for the session's store.
- **`get_basket_size_trend_scoped`** [D+T] — Get per-day basket size (mean line count) for the session's store.
- **`get_category_breakdown_scoped`** [D+T] — Get category breakdown for the session's store.
- **`get_category_forecast_scoped`** [D+T] — Get the next-period demand forecast per top category (simple linear fit
- **`get_category_popularity_scoped`** [D+T] — Get per-category popularity standings for the session's store: each
- **`get_category_popularity_trend_scoped`** [D+T] — Get the per-period popularity trend for the session's store: each of the
- **`get_customer_split_scoped`** [D+T] — Get new vs returning customer counts for the session's store.
- **`get_daily_revenue_scoped`** [D+T] — Get daily revenue for the session's store.
- **`get_discounts_summary_scoped`** [D+T] — Get discount usage summary for the session's store.
- **`get_hourly_heatmap_scoped`** [D+T] — Get hourly heatmap for the session's store.
- **`get_hourly_occupancy_scoped`** [D+T] — Completed table-bound orders per hour of day for the session's store.
- **`get_inventory_trend_scoped`** [D+T] — Get daily units sold (the inventory trend line) for the session's store.
- **`get_inventory_turnover_scoped`** [D+T] — Get a stock-turnover snapshot for the session's store at one location.
- **`get_low_stock_alerts_scoped`** [D+T] — Get low stock alerts for the session's default store location.
- **`get_menu_engineering_scoped`** [D+T] — Get menu engineering for the session's store.
- **`get_monthly_revenue_scoped`** [D+T] — Get monthly revenue for the session's store.
- **`get_payment_method_breakdown_scoped`** [D+T] — Get revenue split by payment method for the session's store.
- **`get_sale_line_margins_scoped`** [D+T] — Get per-line cost and margin for a single sale (HPP exposure).
- **`get_table_turnover_scoped`** [D+T] — Completed table-bound orders per day for the session's store.
- **`get_top_products_scoped`** [D+T] — Get top products for the session's store with a bounded limit.
- **`get_voided_items_scoped`** [D+T] — Get the top voided product lines for the session's store.
- **`get_voided_sales_summary_scoped`** [D+T] — Get voided-sale totals for the session's store.
- **`get_weekly_revenue_scoped`** [D+T] — Get weekly revenue for the session's store.

### `commands::scale` (3)

- **`list_scale_devices_scoped`** [D+T] — List scale devices (scoped).
- **`read_scale_weight`** [T] — Read the current weight from the registered weight scale.
- **`read_scale_weight_scoped`** [D+T] — Read scale weight (scoped).

### `commands::security` (4)

- **`get_key_rotation_info`** [D] — Get the current key rotation status (key age, creation timestamp).
- **`get_key_rotation_info_scoped`** [D] — Session-scoped variant of [`get_key_rotation_info`].
- **`rotate_encryption_key`** [D] — Rotate (re-generate) the encryption key.
- **`rotate_encryption_key_scoped`** [D] — Session-scoped variant of [`rotate_encryption_key`].

### `commands::settings` (28)

- **`gateway_status`** [D+T] — Report which payment gateways have credentials configured.
- **`get_credit_settings`** [T] — Get credit settings.
- **`get_credit_settings_scoped`** [D+T] — Scoped variant of `get_credit_settings` (ADR #7).
- **`get_hardware_settings`** [T] — Get hardware settings for the current terminal from the DB.
- **`get_hardware_settings_scoped`** [D+T] — Get hardware settings (scoped — multi-phase with session validation).
- **`get_receipt_settings`** [T] — Get receipt settings.
- **`get_receipt_settings_scoped`** [D+T] — Get receipt settings resolved from a session token. ADR #7.
- **`get_setting`** [D+T] — Read a single setting value by key.
- **`get_setting_scoped`** [D+T] — Scoped variant of `get_setting` (ADR #7).
- **`get_store_settings`** [T] — Get store settings.
- **`get_store_settings_scoped`** [D+T] — Get store settings resolved from a session token. ADR #7.
- **`get_user_preferences_scoped`** [D+T] — Get user preferences resolved from a session token. ADR #7.
- **`list_credit_sales`** [T] — List credit sales.
- **`list_credit_sales_scoped`** [D+T] — List credit sales for the store resolved from a session token. ADR #7.
- **`set_credit_settings`** [T] — Set credit settings.
- **`set_credit_settings_scoped`** [D+T] — Set credit settings resolved from a session token. ADR #7.
- **`set_hardware_settings`** [T] — Set hardware settings.
- **`set_hardware_settings_scoped`** [D+T] — Set hardware settings resolved from a session token. ADR #7.
- **`set_receipt_settings`** [T] — Set receipt settings.
- **`set_receipt_settings_scoped`** [D+T] — Set receipt settings resolved from a session token. ADR #7.
- **`set_setting`** [D+T] — **Deprecated — use `set_setting_scoped` (ADR #7).**
- **`set_setting_scoped`** [D+T] — Write (or overwrite) a single setting value resolved from a session token. ADR #7.
- **`set_settings_scoped`** [D] — Write (or overwrite) multiple settings in a single transaction, resolved from a session token. ADR #7.
- **`set_store_settings`** [T] — Set store settings.
- **`set_store_settings_scoped`** [D+T] — Set store settings resolved from a session token. ADR #7.
- **`set_user_preferences_scoped`** [D+T] — Set user preferences resolved from a session token. ADR #7.
- **`settle_credit`** [T] — Settle credit.
- **`settle_credit_scoped`** [D+T] — Settle a credit sale resolved from a session token. ADR #7.

### `commands::setup` (5)

- **`complete_setup`** [D+T] — Persist the chosen preset and features, then mark setup as complete.
- **`dismiss_setup_wizard`** [D+T] — Dismiss the setup wizard without enabling any features.
- **`get_enabled_features`** [D+T] — Return the list of currently-enabled feature keys.
- **`get_setup_status`** [D+T] — Returns whether the setup wizard has been completed.
- **`seed_default_roles_scoped`** [D] — Requires the `staff:manage_roles` permission.

### `commands::shifts` (7)

- **`close_shift_scoped`** [D] — Close a shift in the store resolved from a session token. ADR #7.
- **`create_cash_payout_scoped`** [D] — Scoped variant of `create_cash_payout` (ADR #7).
- **`get_active_shift_scoped`** [D] — Get the active shift for the session user from the store-scoped DB. ADR #7.
- **`get_shift_report_scoped`** [D] — Scoped variant of `get_shift_report` (ADR #7).
- **`get_shift_scoped`** [D] — Scoped variant of `get_shift` (ADR #7).
- **`list_shifts_scoped`** [D] — List shifts for the store resolved from a session token. ADR #7.
- **`open_shift_scoped`** [D] — Open a shift in the store resolved from a session token. ADR #7.

### `commands::staff` (6)

- **`bootstrap_owner`** [D+T] — Create the first owner user in a fresh installation.
- **`create_staff_scoped`** [D+T] — Create a staff member. Caller identity is resolved from the session token.
- **`get_staff_profile_scoped`** [D+T] — Load a staff member's full profile as the session user sees it (ADR #35
- **`list_roles_scoped`** [D+T] — List roles. Caller identity is resolved from the session token.
- **`list_staff_scoped`** [D+T] — List staff members. Caller identity is resolved from the session token.
- **`update_staff_scoped`** [D+T] — Update a staff member. Caller identity is resolved from the session token.

### `commands::stock_transfers` (10)

- **`add_stock_transfer_line_scoped`** [D+T] — Add a transfer line in the session-scoped store.
- **`cancel_stock_transfer_scoped`** [D+T] — Cancel a transfer in the session-scoped store.
- **`create_stock_transfer_scoped`** [D+T] — Create a stock transfer in the store resolved from the session token.
- **`get_stock_transfer_lines_scoped`** [D+T] — Get transfer lines from the session-scoped store.
- **`get_stock_transfer_scoped`** [D+T] — Get a stock transfer from the session-scoped store.
- **`list_in_transit_transfers_scoped`** [D+T] — List in-transit transfers with their line items in one batch request.
- **`list_stock_transfers_scoped`** [D+T] — List stock transfers from the session-scoped store.
- **`receive_stock_transfer_scoped`** [D+T] — Receive a transfer, attributing the actor to the authenticated session.
- **`remove_stock_transfer_line_scoped`** [D+T] — Remove a transfer line in the session-scoped store.
- **`send_stock_transfer_scoped`** [D+T] — Send a transfer in the session-scoped store.

### `commands::store_profiles` (7)

- **`create_store_profile_scoped`** [D] — Scoped variant of `create_store_profile` (ADR #7).
- **`delete_store_profile_scoped`** [D] — Scoped variant of `delete_store_profile` (ADR #7).
- **`get_primary_store_scoped`** [D] — Scoped variant of `get_primary_store` (ADR #7).
- **`get_store_profile_scoped`** [D] — Scoped variant of `get_store_profile` (ADR #7).
- **`list_store_profiles_scoped`** [D] — Scoped variant of `list_store_profiles` (ADR #7).
- **`set_primary_store_scoped`** [D] — Scoped variant of `set_primary_store` (ADR #7).
- **`update_store_profile_scoped`** [D] — Scoped variant of `update_store_profile` (ADR #7).

### `commands::subscription` (1)

- **`get_subscription_capabilities`** [D+T] — Read the tenant's subscription capabilities and current usage.

### `commands::sync` (23)

- **`get_pg_sync_settings_scoped`** [D] — Get PG sync settings (scoped).
- **`get_sync_plan`** [T] — Read the caller's own sync plan from the server (ADR sync-plan-gating).
- **`get_sync_plan_scoped`** [D+T] — Get sync plan (scoped).
- **`get_sync_settings`** [T] — Get sync settings.
- **`get_sync_settings_scoped`** [D+T] — Get sync settings resolved from a session token. ADR #7.
- **`pending_sync_count`** [T] — Get the pending sync count.
- **`pending_sync_count_scoped`** [D+T] — Pending sync count (scoped).
- **`pg_sync_start_scoped`** [D] — PG sync start (scoped).
- **`pg_sync_status_scoped`** [D] — PG sync status (scoped).
- **`pg_sync_stop_scoped`** [D] — PG sync stop (scoped).
- **`request_sync_token`** [T] — Request a new JWT API token from the cloud server's
- **`request_sync_token_scoped`** [D+T] — Request a sync token (scoped).
- **`settings_changed_sink`** [D] — _signature: see commands/sync.rs_
- **`settings_changed_sink_scoped`** [D] — Settings changed sink (scoped — no-op for session-validated callers).
- **`sync_pull`** [T] — Pull a server snapshot and overwrite the local cache for products,
- **`sync_pull_scoped`** [D+T] — Sync pull (scoped — 4-phase with auth refresh + backup).
- **`sync_run`** [T] — Immediately run a sync cycle that pushes pending sales, credit, and
- **`sync_run_scoped`** [D+T] — Sync run (scoped — 3-phase with auth refresh).
- **`test_sync_connection`** [T] — Test the cloud sync connection by pinging the configured server.
- **`test_sync_connection_scoped`** [D+T] — Test sync connection (scoped).
- **`update_pg_sync_settings_scoped`** [D] — Update PG sync settings (scoped).
- **`update_sync_settings`** [T] — Update sync settings.
- **`update_sync_settings_scoped`** [D+T] — Update sync settings (scoped).

### `commands::tables` (18)

- **`assign_table_order`** [T] — Assign table order.
- **`assign_table_order_scoped`** [D+T] — Assign an order to a table in the store resolved from a session token. ADR #7.
- **`create_table`** [T] — Create table.
- **`create_table_scoped`** [D+T] — Create a table in the store resolved from a session token. ADR #7.
- **`delete_table`** [T] — Delete table.
- **`delete_table_scoped`** [D+T] — Delete a table in the store resolved from a session token. ADR #7.
- **`get_table`** [T] — Get table.
- **`get_table_scoped`** [D+T] — Get a table from the store resolved from a session token. ADR #7.
- **`list_sections`** [T] — List sections.
- **`list_sections_scoped`** [D+T] — List sections for the store resolved from a session token. ADR #7.
- **`list_tables`** [T] — List tables.
- **`list_tables_scoped`** [D+T] — List tables for the store resolved from a session token. ADR #7.
- **`release_table`** [T] — Release table.
- **`release_table_scoped`** [D+T] — Release a table in the store resolved from a session token. ADR #7.
- **`update_table`** [T] — Update table.
- **`update_table_scoped`** [D+T] — Update a table in the store resolved from a session token. ADR #7.
- **`update_table_status`** [T] — Update table status.
- **`update_table_status_scoped`** [D+T] — Update a table's status in the store resolved from a session token. ADR #7.

### `commands::tax` (7)

- **`create_tax_rate_scoped`** [D+T] — Create a tax rate in the store resolved from a session token. ADR #7.
- **`delete_tax_rate_scoped`** [D+T] — Delete a tax rate in the store resolved from a session token. ADR #7.
- **`get_tax_rate_dependency_counts_scoped`** [D+T] — Get dependency (reference) counts for a tax rate in the store resolved
- **`list_category_tax_rates_scoped`** [D+T] — List category-to-tax-rate assignments for the store resolved from a
- **`list_tax_rates_scoped`** [D+T] — List tax rates for the store resolved from a session token. ADR #7.
- **`set_category_tax_rates_scoped`** [D+T] — Set (replace) the tax rates assigned to a category in the store resolved
- **`update_tax_rate_scoped`** [D+T] — Update a tax rate in the store resolved from a session token. ADR #7.

### `commands::terminals` (25)

- **`clear_device_binding_scoped`** [D] — Clear a device binding in the store resolved from a session token. ADR #7.
- **`delete_terminal`** [T] — Delete a terminal by id.
- **`delete_terminal_override`** [T] — Delete a single feature override for a terminal.
- **`delete_terminal_override_scoped`** [D+T] — Delete a terminal override in the store resolved from a session token. ADR #7.
- **`delete_terminal_profile_scoped`** [D] — Delete a terminal profile in the store resolved from a session token. ADR #7.
- **`delete_terminal_scoped`** [D+T] — Delete a terminal in the store resolved from a session token. ADR #7.
- **`get_device_binding_scoped`** [D] — Get device binding from the store resolved from a session token. ADR #7.
- **`get_terminal`** [T] — Get a single terminal by id.
- **`get_terminal_profile_scoped`** [D] — Get a terminal profile from the store resolved from a session token. ADR #7.
- **`get_terminal_scoped`** [D+T] — Get a terminal from the store resolved from a session token. ADR #7.
- **`list_terminal_overrides`** [T] — List all feature overrides for a terminal.
- **`list_terminal_overrides_scoped`** [D+T] — List terminal overrides from the store resolved from a session token. ADR #7.
- **`list_terminal_profiles_scoped`** [D] — List terminal profiles from the store resolved from a session token. ADR #7.
- **`list_terminals`** [T] — List all registered terminals.
- **`list_terminals_scoped`** [D+T] — List terminals from the store resolved from a session token. ADR #7.
- **`ping_terminal`** [T] — Update a terminal's last_seen_at timestamp (heartbeat).
- **`ping_terminal_scoped`** [D+T] — Ping a terminal in the store resolved from a session token. ADR #7.
- **`register_terminal`** [T] — Register a new terminal.
- **`register_terminal_scoped`** [D+T] — Register a terminal in the store resolved from a session token. ADR #7.
- **`set_device_binding_scoped`** [D+T] — Set a device binding in the store resolved from a session token. ADR #7.
- **`set_terminal_override`** [T] — Set (upsert) a feature override for a terminal.
- **`set_terminal_override_scoped`** [D+T] — Set a terminal override in the store resolved from a session token. ADR #7.
- **`set_terminal_profile_scoped`** [D] — Set a terminal profile in the store resolved from a session token. ADR #7.
- **`update_terminal`** [T] — Update an existing terminal.
- **`update_terminal_scoped`** [D+T] — Update a terminal in the store resolved from a session token. ADR #7.

### `commands::topology` (4)

- **`apply_topology_diff`** [D] — Apply a full topology diff atomically (Critical #4).
- **`can_save_topology`** [D] — Return whether the authenticated session can save topology changes.
- **`load_topology`** [D] — Load the persisted topology graph.
- **`recover_pending_topology_apply_at_startup`** [D] — Complete a previously interrupted cross-database Apply before accepting a

### `commands::void` (1)

- **`void_sale_scoped`** [D+T] — Void a sale within the store resolved from a session token.

### `commands::workspaces` (15)

- **`archive_workspace_instance_scoped`** [D] — Archive (soft-delete) a workspace instance (admin). ADR #7.
- **`create_workspace_instance_scoped`** [D] — Create a new workspace instance (admin). Permission from session. ADR #7.
- **`get_user_workspace_instances_scoped`** [D] — Get instance IDs assigned to a user. Permission check from session. ADR #7.
- **`get_workspace_instance_scoped`** [D] — Get a single workspace instance. `is_default` reflects the session user. ADR #7.
- **`list_all_workspaces_scoped`** [D] — List all workspace types resolved from a session token. ADR #7.
- **`list_workspace_screens`** [T] — List screens (nav items) for a workspace type during boot/workspace
- **`list_workspace_screens_scoped`** [D] — List screens for a workspace type from the store-scoped database. ADR #7.
- **`list_workspaces`** [T] — List workspace instances for the pre-session workspace picker.
- **`list_workspaces_for_store_scoped`** [D] — List workspace instances in an explicitly named store for the session user.
- **`list_workspaces_scoped`** [D] — List workspace instances accessible to the session user within their store. ADR #7.
- **`recover_workspace_instances_scoped`** [D] — Recover `QuotaSuspended` workspace instances after a tier upgrade. ADR #5 Phase 3b.
- **`resolve_boot_store`** [D+T] — Resolve the active store and instance from device binding.
- **`set_user_workspace_instances_scoped`** [D] — Replace all instance assignments for a user. Caller permission from session. ADR #7.
- **`suspend_surplus_workspace_instances_scoped`** [D] — Suspend surplus workspace instances after a tier downgrade. ADR #5 Phase 3c.
- **`update_workspace_instance_scoped`** [D] — Update the editable fields of a workspace instance (admin). ADR #7.



---

> last audited 08-09-26 by docs-auditor

