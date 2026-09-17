//! Typed store configuration helpers.
/*
last audited 25-07-26 by RSA-Agent (platform-core slice C: settings/typed deep read)
crate: platform-core | status: SAFE | lint: CLEAN
findings: clean typed accessors with documented defaults; sync API key, terminal secret, and PG password transparently ENCRYPTED at rest via kasirmu_crypto with legacy-plaintext read fallback (corrects the broader COR-17/30 note: these secrets are not plaintext); decrypt-failure falls back to raw value silently rather than erroring (INFO — corrupted ciphertext yields garbage, no alert); currency default has documented old-key migration fallback
next: surface decrypt failures | perf: N/A
*/

use super::{Settings, keys};
use crate::error::PlatformError;
use rusqlite::Connection;

impl Settings {
    /// Get the store display name.
    pub fn get_store_name(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Self::get(conn, keys::STORE_NAME)
    }

    /// Set the store display name.
    pub fn set_store_name(conn: &Connection, name: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::STORE_NAME, name)
    }

    /// Get the store address (printed on receipts).
    pub fn get_store_address(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Self::get(conn, keys::STORE_ADDRESS)
    }

    /// Set the store address.
    pub fn set_store_address(conn: &Connection, addr: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::STORE_ADDRESS, addr)
    }

    /// Get the store tax / VAT registration number.
    pub fn get_store_tax_id(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Self::get(conn, keys::STORE_TAX_ID)
    }

    /// Set the store tax / VAT registration number.
    pub fn set_store_tax_id(conn: &Connection, id: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::STORE_TAX_ID, id)
    }

    /// Get the default currency code (ISO-4217).
    ///
    /// Prefers the new global `currency.default` key and falls back to the
    /// old `store.default_currency` key for databases that haven't been
    /// migrated yet.
    pub fn get_default_currency(conn: &Connection) -> Result<Option<String>, PlatformError> {
        if let Some(val) = Self::get(conn, keys::DEFAULT_CURRENCY)? {
            return Ok(Some(val));
        }
        Self::get(conn, keys::OLD_DEFAULT_CURRENCY)
    }

    /// Set the default currency code.
    ///
    /// Writes to the new global `currency.default` key and cleans up the
    /// old `store.default_currency` key.
    pub fn set_default_currency(conn: &Connection, code: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::DEFAULT_CURRENCY, code)?;
        let _ = Self::remove(conn, keys::OLD_DEFAULT_CURRENCY);
        Ok(())
    }

    /// Get the store branch name.
    pub fn get_store_branch(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Self::get(conn, keys::STORE_BRANCH)
    }

    /// Set the store branch name.
    pub fn set_store_branch(conn: &Connection, branch: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::STORE_BRANCH, branch)
    }

    /// Get the store logo (base64-encoded PNG).
    pub fn get_store_logo(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Self::get(conn, keys::STORE_LOGO)
    }

    /// Set the store logo (base64-encoded PNG).
    pub fn set_store_logo(conn: &Connection, logo: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::STORE_LOGO, logo)
    }

    // ── Receipt display settings ───────────────────────────────────

    /// Whether to show the currency symbol prefix on receipt amounts.
    pub fn get_receipt_show_currency(conn: &Connection) -> Result<bool, PlatformError> {
        Ok(Self::get(conn, keys::RECEIPT_SHOW_CURRENCY)?
            .as_deref()
            .unwrap_or("0")
            == "1")
    }

    /// Set whether to show the currency symbol prefix.
    pub fn set_receipt_show_currency(conn: &Connection, on: bool) -> Result<(), PlatformError> {
        Self::set(
            conn,
            keys::RECEIPT_SHOW_CURRENCY,
            if on { "1" } else { "0" },
        )
    }

    /// Decimal separator style: `"dot"`, `"comma"`, or `"none"`.
    pub fn get_receipt_decimal_separator(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::RECEIPT_DECIMAL_SEP)?.unwrap_or_else(|| "dot".into()))
    }

    /// Set the decimal separator style.
    pub fn set_receipt_decimal_separator(
        conn: &Connection,
        val: &str,
    ) -> Result<(), PlatformError> {
        Self::set(conn, keys::RECEIPT_DECIMAL_SEP, val)
    }

    /// Whether to show the tax line on receipts.
    pub fn get_receipt_show_tax(conn: &Connection) -> Result<bool, PlatformError> {
        Ok(Self::get(conn, keys::RECEIPT_SHOW_TAX)?
            .as_deref()
            .unwrap_or("1")
            == "1")
    }

    /// Set whether to show the tax line.
    pub fn set_receipt_show_tax(conn: &Connection, on: bool) -> Result<(), PlatformError> {
        Self::set(conn, keys::RECEIPT_SHOW_TAX, if on { "1" } else { "0" })
    }

    /// Get the receipt footer text (empty = no footer).
    pub fn get_receipt_footer(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::RECEIPT_FOOTER)?.unwrap_or_default())
    }

    /// Set the receipt footer text.
    pub fn set_receipt_footer(conn: &Connection, text: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::RECEIPT_FOOTER, text)
    }

    /// Paper width: `"standard"` (80 mm) or `"narrow"` (58 mm).
    pub fn get_receipt_paper_width(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::RECEIPT_PAPER_WIDTH)?.unwrap_or_else(|| "standard".into()))
    }

    /// Set the paper width.
    pub fn set_receipt_paper_width(conn: &Connection, val: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::RECEIPT_PAPER_WIDTH, val)
    }

    /// Whether to show the table number on cart and receipts.
    pub fn get_receipt_show_table_number(conn: &Connection) -> Result<bool, PlatformError> {
        Ok(Self::get(conn, keys::RECEIPT_SHOW_TABLE_NUMBER)?
            .as_deref()
            .unwrap_or("0")
            == "1")
    }

    /// Set whether to show the table number.
    pub fn set_receipt_show_table_number(conn: &Connection, on: bool) -> Result<(), PlatformError> {
        Self::set(
            conn,
            keys::RECEIPT_SHOW_TABLE_NUMBER,
            if on { "1" } else { "0" },
        )
    }

    /// Margin from paper top edge in mm. Default `"0"`.
    pub fn get_receipt_margin_top(conn: &Connection) -> Result<i64, PlatformError> {
        Ok(Self::get(conn, keys::RECEIPT_MARGIN_TOP)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    }

    /// Set the top margin.
    pub fn set_receipt_margin_top(conn: &Connection, mm: i64) -> Result<(), PlatformError> {
        Self::set(conn, keys::RECEIPT_MARGIN_TOP, &mm.to_string())
    }

    /// Margin from paper bottom edge in mm. Default `"0"`.
    pub fn get_receipt_margin_bottom(conn: &Connection) -> Result<i64, PlatformError> {
        Ok(Self::get(conn, keys::RECEIPT_MARGIN_BOTTOM)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    }

    /// Set the bottom margin.
    pub fn set_receipt_margin_bottom(conn: &Connection, mm: i64) -> Result<(), PlatformError> {
        Self::set(conn, keys::RECEIPT_MARGIN_BOTTOM, &mm.to_string())
    }

    /// Margin from paper left edge in mm. Default `"0"`.
    pub fn get_receipt_margin_left(conn: &Connection) -> Result<i64, PlatformError> {
        Ok(Self::get(conn, keys::RECEIPT_MARGIN_LEFT)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    }

    /// Set the left margin.
    pub fn set_receipt_margin_left(conn: &Connection, mm: i64) -> Result<(), PlatformError> {
        Self::set(conn, keys::RECEIPT_MARGIN_LEFT, &mm.to_string())
    }

    /// Margin from paper right edge in mm. Default `"0"`.
    pub fn get_receipt_margin_right(conn: &Connection) -> Result<i64, PlatformError> {
        Ok(Self::get(conn, keys::RECEIPT_MARGIN_RIGHT)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    }

    /// Set the right margin.
    pub fn set_receipt_margin_right(conn: &Connection, mm: i64) -> Result<(), PlatformError> {
        Self::set(conn, keys::RECEIPT_MARGIN_RIGHT, &mm.to_string())
    }

    /// Tax rounding mode: `"half_up"` or `"truncate"`. Default `"half_up"`.
    pub fn get_tax_rounding_mode(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::TAX_ROUNDING_MODE)?.unwrap_or_else(|| "half_up".into()))
    }

    /// Set the tax rounding mode (`"half_up"` or `"truncate"`).
    pub fn set_tax_rounding_mode(conn: &Connection, val: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::TAX_ROUNDING_MODE, val)
    }

    // ── Printer settings ─────────────────────────────────────────

    /// Printer connection type.
    pub fn get_printer_connection(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::PRINTER_CONNECTION)?.unwrap_or_else(|| "auto".into()))
    }

    /// Set printer connection type.
    pub fn set_printer_connection(conn: &Connection, val: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::PRINTER_CONNECTION, val)
    }

    /// Printer device path.
    pub fn get_printer_device_path(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::PRINTER_DEVICE_PATH)?.unwrap_or_default())
    }

    /// Set printer device path.
    pub fn set_printer_device_path(conn: &Connection, val: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::PRINTER_DEVICE_PATH, val)
    }

    /// Printer paper size.
    pub fn get_printer_paper_size(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::PRINTER_PAPER_SIZE)?.unwrap_or_else(|| "80".into()))
    }

    /// Set printer paper size.
    pub fn set_printer_paper_size(conn: &Connection, val: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::PRINTER_PAPER_SIZE, val)
    }

    // ── Scanner settings ─────────────────────────────────────────

    /// Selected scanner device ID.
    pub fn get_scanner_device_id(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::SCANNER_DEVICE_ID)?.unwrap_or_default())
    }

    /// Set scanner device ID.
    pub fn set_scanner_device_id(conn: &Connection, val: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::SCANNER_DEVICE_ID, val)
    }

    /// Scanner input mode.
    pub fn get_scanner_input_mode(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::SCANNER_INPUT_MODE)?.unwrap_or_else(|| "auto".into()))
    }

    /// Set scanner input mode.
    pub fn set_scanner_input_mode(conn: &Connection, val: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::SCANNER_INPUT_MODE, val)
    }

    // ── Credit settings ──────────────────────────────────────────

    /// Check if credit payment is enabled.
    pub fn is_credit_enabled(conn: &Connection) -> Result<bool, PlatformError> {
        Ok(Self::get(conn, keys::CREDIT_ENABLED)?.as_deref() == Some("1"))
    }

    /// Enable or disable credit payment.
    pub fn set_credit_enabled(conn: &Connection, enabled: bool) -> Result<(), PlatformError> {
        Self::set(conn, keys::CREDIT_ENABLED, if enabled { "1" } else { "0" })
    }

    /// Get credit reminder interval in hours.
    pub fn get_credit_reminder_interval(conn: &Connection) -> Result<i64, PlatformError> {
        Ok(Self::get(conn, keys::CREDIT_REMINDER_INTERVAL)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(24))
    }

    /// Set credit reminder interval in hours.
    pub fn set_credit_reminder_interval(
        conn: &Connection,
        hours: i64,
    ) -> Result<(), PlatformError> {
        Self::set(conn, keys::CREDIT_REMINDER_INTERVAL, &hours.to_string())
    }

    /// Get maximum credit limit in minor units (0 = no limit).
    pub fn get_credit_max_limit(conn: &Connection) -> Result<i64, PlatformError> {
        Ok(Self::get(conn, keys::CREDIT_MAX_LIMIT)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    }

    /// Set maximum credit limit in minor units.
    pub fn set_credit_max_limit(conn: &Connection, limit: i64) -> Result<(), PlatformError> {
        Self::set(conn, keys::CREDIT_MAX_LIMIT, &limit.to_string())
    }

    // ── Cloud Sync ───────────────────────────────────────────────

    /// Get the configured sync server URL.
    pub fn get_sync_server_url(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Self::get(conn, keys::SYNC_SERVER_URL)
    }

    /// Set the sync server URL.
    pub fn set_sync_server_url(conn: &Connection, url: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::SYNC_SERVER_URL, url)
    }

    /// Get the sync API key (transparently decrypted).
    pub fn get_sync_api_key(conn: &Connection) -> Result<Option<String>, PlatformError> {
        let raw = Self::get(conn, keys::SYNC_API_KEY)?;
        Ok(raw.map(|v| kasirmu_crypto::decrypt_sync_api_key(&v).unwrap_or(v)))
    }

    /// Set the sync API key (transparently encrypted at rest).
    pub fn set_sync_api_key(conn: &Connection, key: &str) -> Result<(), PlatformError> {
        let encrypted = kasirmu_crypto::encrypt_sync_api_key(key)
            .map_err(|e| PlatformError::Internal(e.to_string()))?;
        Self::set(conn, keys::SYNC_API_KEY, &encrypted)
    }

    /// Get the registered sync terminal identifier (ADR sync-auth-hardening
    /// P3). `None` when the terminal has not been paired yet.
    pub fn get_sync_terminal_id(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Ok(Self::get(conn, keys::SYNC_TERMINAL_ID)?.filter(|s| !s.is_empty()))
    }

    /// Set the registered sync terminal identifier (ADR sync-auth-hardening P3).
    pub fn set_sync_terminal_id(conn: &Connection, id: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::SYNC_TERMINAL_ID, id)
    }

    /// Get the registered sync terminal device secret (ADR sync-auth-hardening
    /// P3). Transparently decrypted. `None` when not paired yet.
    pub fn get_sync_terminal_secret(conn: &Connection) -> Result<Option<String>, PlatformError> {
        let raw = Self::get(conn, keys::SYNC_TERMINAL_SECRET)?;
        Ok(raw
            .filter(|s| !s.is_empty())
            .map(|v| kasirmu_crypto::decrypt_sync_terminal_secret(&v).unwrap_or(v)))
    }

    /// Set the registered sync terminal device secret (ADR sync-auth-hardening P3).
    /// Transparently encrypted at rest.
    pub fn set_sync_terminal_secret(conn: &Connection, secret: &str) -> Result<(), PlatformError> {
        let encrypted = kasirmu_crypto::encrypt_sync_terminal_secret(secret)
            .map_err(|e| PlatformError::Internal(e.to_string()))?;
        Self::set(conn, keys::SYNC_TERMINAL_SECRET, &encrypted)
    }

    /// Check if sync is enabled.
    pub fn is_sync_enabled(conn: &Connection) -> Result<bool, PlatformError> {
        Ok(Self::get(conn, keys::SYNC_ENABLED)?.as_deref() == Some("1"))
    }

    /// Enable or disable sync.
    pub fn set_sync_enabled(conn: &Connection, enabled: bool) -> Result<(), PlatformError> {
        Self::set(conn, keys::SYNC_ENABLED, if enabled { "1" } else { "0" })
    }

    // ── PostgreSQL Sync ─────────────────────────────────────────

    /// Check if PostgreSQL sync is enabled.
    pub fn is_pg_sync_enabled(conn: &Connection) -> Result<bool, PlatformError> {
        Ok(Self::get(conn, keys::PG_SYNC_ENABLED)?.as_deref() == Some("1"))
    }

    /// Enable or disable PostgreSQL sync.
    pub fn set_pg_sync_enabled(conn: &Connection, enabled: bool) -> Result<(), PlatformError> {
        Self::set(conn, keys::PG_SYNC_ENABLED, if enabled { "1" } else { "0" })
    }

    /// Get the PostgreSQL host.
    pub fn get_pg_sync_host(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Self::get(conn, keys::PG_SYNC_HOST)
    }

    /// Set the PostgreSQL host.
    pub fn set_pg_sync_host(conn: &Connection, host: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::PG_SYNC_HOST, host)
    }

    /// Get the PostgreSQL port.
    pub fn get_pg_sync_port(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Self::get(conn, keys::PG_SYNC_PORT)
    }

    /// Set the PostgreSQL port.
    pub fn set_pg_sync_port(conn: &Connection, port: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::PG_SYNC_PORT, port)
    }

    /// Get the PostgreSQL database name.
    pub fn get_pg_sync_dbname(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Self::get(conn, keys::PG_SYNC_DBNAME)
    }

    /// Set the PostgreSQL database name.
    pub fn set_pg_sync_dbname(conn: &Connection, dbname: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::PG_SYNC_DBNAME, dbname)
    }

    /// Get the PostgreSQL user.
    pub fn get_pg_sync_user(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Self::get(conn, keys::PG_SYNC_USER)
    }

    /// Set the PostgreSQL user.
    pub fn set_pg_sync_user(conn: &Connection, user: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::PG_SYNC_USER, user)
    }

    /// Get the PostgreSQL password (transparently decrypted).
    pub fn get_pg_sync_password(conn: &Connection) -> Result<Option<String>, PlatformError> {
        let raw = Self::get(conn, keys::PG_SYNC_PASSWORD)?;
        Ok(raw.map(|v| kasirmu_crypto::decrypt_pg_sync_password(&v).unwrap_or(v)))
    }

    /// Set the PostgreSQL password (transparently encrypted at rest).
    pub fn set_pg_sync_password(conn: &Connection, password: &str) -> Result<(), PlatformError> {
        let encrypted = kasirmu_crypto::encrypt_pg_sync_password(password)
            .map_err(|e| PlatformError::Internal(e.to_string()))?;
        Self::set(conn, keys::PG_SYNC_PASSWORD, &encrypted)
    }

    /// Get whether PG sync must connect over TLS.
    pub fn get_pg_sync_require_tls(conn: &Connection) -> Result<bool, PlatformError> {
        Ok(Self::get(conn, keys::PG_SYNC_REQUIRE_TLS)?.as_deref() == Some("1"))
    }

    /// Set whether PG sync must connect over TLS.
    pub fn set_pg_sync_require_tls(
        conn: &Connection,
        require_tls: bool,
    ) -> Result<(), PlatformError> {
        Self::set(
            conn,
            keys::PG_SYNC_REQUIRE_TLS,
            if require_tls { "1" } else { "0" },
        )
    }

    // ── Redis Cache ────────────────────────────────────────────────

    /// Get the Redis server URL.
    pub fn get_redis_url(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::REDIS_URL)?.unwrap_or_else(|| "redis://localhost:6379".into()))
    }

    /// Set the Redis server URL.
    pub fn set_redis_url(conn: &Connection, url: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::REDIS_URL, url)
    }

    /// Get the Redis cache TTL in seconds.
    ///
    /// Returns an error if the stored value cannot be parsed as a u64.
    pub fn get_redis_cache_ttl(conn: &Connection) -> Result<u64, PlatformError> {
        let val = Self::get(conn, keys::REDIS_CACHE_TTL)?;
        val.as_deref().unwrap_or("300").parse().map_err(|_| {
            PlatformError::Internal(format!(
                "invalid redis cache TTL: {}",
                val.as_deref().unwrap_or("(missing)")
            ))
        })
    }

    /// Set the Redis cache TTL in seconds.
    pub fn set_redis_cache_ttl(conn: &Connection, ttl: u64) -> Result<(), PlatformError> {
        Self::set(conn, keys::REDIS_CACHE_TTL, &ttl.to_string())
    }

    // ── Brand / White-label ─────────────────────────────────────

    /// Get the primary brand colour (hex).
    ///
    /// Returns `""` when the store never set an override: the UI treats
    /// the empty string as "follow the active theme" (light #147EFB,
    /// dark #1155CC in the theme token sheet). The old `"#147EFB"` fallback
    /// here silently pinned BOTH themes to the light blue, defeating
    /// per-theme primaries on every fresh install.
    pub fn get_brand_primary_colour(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::BRAND_PRIMARY_COLOUR)?.unwrap_or_default())
    }

    /// Set the primary brand colour.
    ///
    /// An empty string clears the override (see [`Self::get_brand_primary_colour`]).
    pub fn set_brand_primary_colour(conn: &Connection, colour: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::BRAND_PRIMARY_COLOUR, colour)
    }

    /// Get the filesystem path to the store logo.
    pub fn get_brand_logo_path(conn: &Connection) -> Result<Option<String>, PlatformError> {
        Self::get(conn, keys::BRAND_LOGO_PATH)
    }

    /// Set the filesystem path to the store logo.
    pub fn set_brand_logo_path(conn: &Connection, path: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::BRAND_LOGO_PATH, path)
    }

    /// Get the brand store display name.
    pub fn get_brand_store_name(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::BRAND_STORE_NAME)?.unwrap_or_default())
    }

    /// Set the brand store display name.
    pub fn set_brand_store_name(conn: &Connection, name: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::BRAND_STORE_NAME, name)
    }

    // ── Exchange Rate Auto-Sync ────────────────────────────────────

    /// Check if exchange rate auto-sync is enabled.
    pub fn is_rate_sync_enabled(conn: &Connection) -> Result<bool, PlatformError> {
        Ok(Self::get(conn, keys::RATE_SYNC_ENABLED)?.as_deref() == Some("1"))
    }

    /// Enable or disable exchange rate auto-sync.
    pub fn set_rate_sync_enabled(conn: &Connection, enabled: bool) -> Result<(), PlatformError> {
        Self::set(
            conn,
            keys::RATE_SYNC_ENABLED,
            if enabled { "1" } else { "0" },
        )
    }

    /// Get the exchange rate API key (transparently decrypted).
    pub fn get_rate_sync_api_key(conn: &Connection) -> Result<Option<String>, PlatformError> {
        let raw = Self::get(conn, keys::RATE_SYNC_API_KEY)?;
        Ok(raw.map(|v| kasirmu_crypto::decrypt_rate_api_key(&v).unwrap_or(v)))
    }

    /// Set the exchange rate API key (transparently encrypted at rest).
    pub fn set_rate_sync_api_key(conn: &Connection, key: &str) -> Result<(), PlatformError> {
        let encrypted = kasirmu_crypto::encrypt_rate_api_key(key)
            .map_err(|e| PlatformError::Internal(e.to_string()))?;
        Self::set(conn, keys::RATE_SYNC_API_KEY, &encrypted)
    }

    /// Get the exchange rate sync interval in minutes.
    pub fn get_rate_sync_interval(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::RATE_SYNC_INTERVAL)?.unwrap_or_else(|| "360".into()))
    }

    /// Set the exchange rate sync interval in minutes.
    pub fn set_rate_sync_interval(conn: &Connection, val: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::RATE_SYNC_INTERVAL, val)
    }

    /// Get the base currency for exchange rate sync.
    pub fn get_rate_sync_base_currency(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::RATE_SYNC_BASE_CURRENCY)?.unwrap_or_else(|| "USD".into()))
    }

    /// Set the base currency for exchange rate sync.
    pub fn set_rate_sync_base_currency(
        conn: &Connection,
        currency: &str,
    ) -> Result<(), PlatformError> {
        Self::set(conn, keys::RATE_SYNC_BASE_CURRENCY, currency)
    }

    // ── Global Currency display settings ───────────────────────────

    /// Get the currency display format: `"symbol"` or `"code"`.
    pub fn get_currency_format(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::CURRENCY_FORMAT)?.unwrap_or_else(|| "symbol".into()))
    }

    /// Set the currency display format.
    pub fn set_currency_format(conn: &Connection, fmt: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::CURRENCY_FORMAT, fmt)
    }

    /// Get the currency symbol position: `"prefix"` or `"suffix"`.
    pub fn get_currency_symbol_position(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::CURRENCY_SYMBOL_POSITION)?.unwrap_or_else(|| "prefix".into()))
    }

    /// Set the currency symbol position.
    pub fn set_currency_symbol_position(conn: &Connection, pos: &str) -> Result<(), PlatformError> {
        Self::set(conn, keys::CURRENCY_SYMBOL_POSITION, pos)
    }

    /// Get the decimal separator: `"dot"` or `"comma"`.
    pub fn get_currency_decimal_separator(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::CURRENCY_DECIMAL_SEPARATOR)?.unwrap_or_else(|| "dot".into()))
    }

    /// Set the decimal separator.
    pub fn set_currency_decimal_separator(
        conn: &Connection,
        sep: &str,
    ) -> Result<(), PlatformError> {
        Self::set(conn, keys::CURRENCY_DECIMAL_SEPARATOR, sep)
    }

    /// Get the thousands separator: `"comma"`, `"dot"`, `"space"`, or `"none"`.
    pub fn get_currency_thousands_separator(conn: &Connection) -> Result<String, PlatformError> {
        Ok(Self::get(conn, keys::CURRENCY_THOUSANDS_SEPARATOR)?.unwrap_or_else(|| "comma".into()))
    }

    /// Set the thousands separator.
    pub fn set_currency_thousands_separator(
        conn: &Connection,
        sep: &str,
    ) -> Result<(), PlatformError> {
        Self::set(conn, keys::CURRENCY_THOUSANDS_SEPARATOR, sep)
    }

    // ── LAN Server PSK (secret — encrypted at rest) ─────────────

    /// Get the LAN server pre-shared key (transparently decrypted).
    pub fn get_lan_server_psk(conn: &Connection) -> Result<Option<String>, PlatformError> {
        let raw = Self::get(conn, keys::LAN_SERVER_PSK)?;
        Ok(raw.map(|v| kasirmu_crypto::decrypt_lan_psk(&v).unwrap_or(v)))
    }

    /// Set the LAN server pre-shared key (transparently encrypted at rest).
    pub fn set_lan_server_psk(conn: &Connection, psk: &str) -> Result<(), PlatformError> {
        let encrypted = kasirmu_crypto::encrypt_lan_psk(psk)
            .map_err(|e| PlatformError::Internal(e.to_string()))?;
        Self::set(conn, keys::LAN_SERVER_PSK, &encrypted)
    }
}
