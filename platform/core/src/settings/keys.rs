//! Well-known settings keys.

/// Store display name. Default: `"OZ-POS Store"`.
pub const STORE_NAME: &str = "store.name";
/// Store street address (printed on receipts).
pub const STORE_ADDRESS: &str = "store.address";
/// Store tax / VAT registration number.
pub const STORE_TAX_ID: &str = "store.tax_id";
/// Default ISO-4217 currency code. Default: `"USD"`.
pub const DEFAULT_CURRENCY: &str = "currency.default";
/// Old store-specific key — used as fallback for backward compatibility.
pub(crate) const OLD_DEFAULT_CURRENCY: &str = "store.default_currency";
/// Store branch name (e.g. "Downtown", "Mall Branch").
pub const STORE_BRANCH: &str = "store.branch";
/// Store logo (base64-encoded PNG). Empty string = no logo.
pub const STORE_LOGO: &str = "store.logo";
/// Store preset name (e.g., `"simple-retail"`, `"restaurant"`).
pub const STORE_PRESET: &str = "store.preset";
/// Whether the Setup Wizard has been completed.
pub const SETUP_COMPLETE: &str = "store.setup_complete";
/// Whether to show the Setup Wizard. `"true"` by default (absent).
/// Set to `"false"` when the user completes or skips the wizard.
pub const SHOW_SETUP_WIZARD: &str = "store.show_setup_wizard";

// ── Receipt display settings ───────────────────────────────────
/// Show currency symbol prefix on amounts. `"1"` or `"0"`. Default `"0"`.
pub const RECEIPT_SHOW_CURRENCY: &str = "receipt.show_currency";
/// Decimal separator style: `"dot"`, `"comma"`, or `"none"`. Default `"dot"`.
pub const RECEIPT_DECIMAL_SEP: &str = "receipt.decimal_separator";
/// Show tax line on receipts. `"1"` or `"0"`. Default `"1"`.
pub const RECEIPT_SHOW_TAX: &str = "receipt.show_tax";
/// Receipt footer text. Empty string means no footer.
pub const RECEIPT_FOOTER: &str = "receipt.footer";
/// Paper width: `"standard"` (80 mm) or `"narrow"` (58 mm). Default `"standard"`.
pub const RECEIPT_PAPER_WIDTH: &str = "receipt.paper_width";
/// Show table number on cart and receipts. `"1"` or `"0"`. Default `"0"`.
pub const RECEIPT_SHOW_TABLE_NUMBER: &str = "receipt.show_table_number";
/// Tax rounding mode: `"half_up"` or `"truncate"`. Default `"half_up"`.
pub const TAX_ROUNDING_MODE: &str = "tax.rounding_mode";
/// Top margin in mm. Default `"0"`.
pub const RECEIPT_MARGIN_TOP: &str = "receipt.margin_top";
/// Bottom margin in mm. Default `"0"`.
pub const RECEIPT_MARGIN_BOTTOM: &str = "receipt.margin_bottom";
/// Left margin in mm. Default `"0"`.
pub const RECEIPT_MARGIN_LEFT: &str = "receipt.margin_left";
/// Right margin in mm. Default `"0"`.
pub const RECEIPT_MARGIN_RIGHT: &str = "receipt.margin_right";

// ── Global Currency settings ─────────────────────────────────
/// Currency display format: `"symbol"` (use symbol like $) or `"code"` (use code like USD). Default `"symbol"`.
pub const CURRENCY_FORMAT: &str = "currency.format";
/// Currency symbol position: `"prefix"` ($10) or `"suffix"` (10$). Default `"prefix"`.
pub const CURRENCY_SYMBOL_POSITION: &str = "currency.symbol_position";
/// Decimal separator: `"dot"` (1.50) or `"comma"` (1,50). Default `"dot"`.
pub const CURRENCY_DECIMAL_SEPARATOR: &str = "currency.decimal_separator";
/// Thousands separator: `"comma"`, `"dot"`, `"space"`, or `"none"`. Default `"comma"`.
pub const CURRENCY_THOUSANDS_SEPARATOR: &str = "currency.thousands_separator";

// ── Printer settings ──────────────────────────────────────────
/// Printer connection type: `"auto"`, `"usb"`, `"serial"`, `"network"`.
pub const PRINTER_CONNECTION: &str = "printer.connection";
/// Printer device path (e.g. `/dev/usb/lp0` or `COM1`).
pub const PRINTER_DEVICE_PATH: &str = "printer.device_path";
/// Printer paper size: `"58"`, `"80"`, `"a4"`, `"letter"`, `"9.5x11"`, `"9.5x5.5"`.
pub const PRINTER_PAPER_SIZE: &str = "printer.paper_size";

// ── Scanner settings ──────────────────────────────────────────
/// Selected scanner device ID.
pub const SCANNER_DEVICE_ID: &str = "scanner.device_id";
/// Scanner input mode: `"auto"`, `"keyboard"`, `"serial"`.
pub const SCANNER_INPUT_MODE: &str = "scanner.input_mode";

// ── Cloud Sync settings ──────────────────────────────────────
/// Remote server URL for syncing offline data.
pub const SYNC_SERVER_URL: &str = "sync_server_url";
/// API key for server authentication.
pub const SYNC_API_KEY: &str = "sync_api_key";
/// Whether cloud sync is enabled. `"1"` or `"0"`. Default `"0"`.
pub const SYNC_ENABLED: &str = "sync_enabled";
/// Registered terminal identifier used for client-credentials minting
/// (ADR sync-auth-hardening P3).
pub const SYNC_TERMINAL_ID: &str = "sync_terminal_id";
/// Registered terminal device secret used for client-credentials minting
/// (ADR sync-auth-hardening P3). Plaintext secret stored client-side only;
/// the server keeps only its SHA-256 hash.
pub const SYNC_TERMINAL_SECRET: &str = "sync_terminal_secret";

// ── PostgreSQL Sync settings ─────────────────────────────────
/// Whether PostgreSQL sync is enabled. `"1"` or `"0"`. Default `"0"`.
pub const PG_SYNC_ENABLED: &str = "pg_sync.enabled";
/// PostgreSQL hostname or IP address.
pub const PG_SYNC_HOST: &str = "pg_sync.host";
/// PostgreSQL port (default `"5432"`).
pub const PG_SYNC_PORT: &str = "pg_sync.port";
/// PostgreSQL database name.
pub const PG_SYNC_DBNAME: &str = "pg_sync.dbname";
/// PostgreSQL user name.
pub const PG_SYNC_USER: &str = "pg_sync.user";
/// PostgreSQL password.
pub const PG_SYNC_PASSWORD: &str = "pg_sync.password";
/// Whether the PG sync transport must connect over TLS. `"1"` or `"0"`.
/// Default `"0"` (matches the historical `NoTls` transport); set to `"1"`
/// to refuse plaintext connections to cloud PostgreSQL (AWS RDS, Azure,
/// etc.) — the server must then accept an `sslmode=require` handshake.
pub const PG_SYNC_REQUIRE_TLS: &str = "pg_sync.require_tls";

// ── Redis Cache settings ─────────────────────────────────────
/// Redis server URL. Default `"redis://localhost:6379"`.
///
/// Credential-bearing even though it is spelled as an endpoint: the
/// URL-embedded form `redis://:PASSWORD@host:6379` is what operators
/// actually save (and what `config_validator` already redacts before
/// logging — see `crates/oz-core/src/config_validator.rs`, COR-3), so the
/// whole value is a password in every respect. It is therefore on
/// [`SECRET_KEY_DENY_LIST`]: never readable through the raw `get_setting`
/// IPC, never replicated to a peer, never packaged. The daemon keeps
/// working because it reads it through the typed accessor
/// (`Settings::get_redis_url`), which is not an egress surface.
pub const REDIS_URL: &str = "redis.url";
/// Redis cache TTL in seconds. Default `300`.
pub const REDIS_CACHE_TTL: &str = "redis.cache_ttl";

// ── Brand / White-label settings ────────────────────────────
/// Primary brand colour (hex). Default `""` = follow the active theme (light #147EFB, dark #1155CC).
pub const BRAND_PRIMARY_COLOUR: &str = "brand.primary_colour";
/// Filesystem path to the store logo image.
pub const BRAND_LOGO_PATH: &str = "brand.logo_path";
/// Store display name for the header. Default `""`.
pub const BRAND_STORE_NAME: &str = "brand.store_name";

// ── Credit settings ─────────────────────────────────────────
/// Whether credit payment is enabled. `"1"` or `"0"`. Default `"0"`.
pub const CREDIT_ENABLED: &str = "credit.enabled";
/// Credit reminder interval in hours. Default `"24"`.
pub const CREDIT_REMINDER_INTERVAL: &str = "credit.reminder_interval";
/// Maximum credit limit in minor units. Default `"0"` (no limit).
pub const CREDIT_MAX_LIMIT: &str = "credit.max_limit";

// ── Exchange Rate Auto-Sync settings ─────────────────────────
/// Whether exchange rate auto-sync is enabled. `"1"` or `"0"`. Default `"0"`.
pub const RATE_SYNC_ENABLED: &str = "rate_sync.enabled";
/// API key for the exchange rate provider.
pub const RATE_SYNC_API_KEY: &str = "rate_sync.api_key";
/// Sync interval in minutes. Default `"360"` (6 hours).
pub const RATE_SYNC_INTERVAL: &str = "rate_sync.interval";
/// Base currency for exchange rates. Default `"USD"`.
pub const RATE_SYNC_BASE_CURRENCY: &str = "rate_sync.base_currency";

// ── LAN server settings (C-4) ────────────────────────────
/// Bind address for the LAN event forwarder.
/// Default `"127.0.0.1"` (loopback only). Set to `"0.0.0.0"`
/// to allow external KDS tablet connections — requires
/// `lan_server.psk` to be non-empty.
pub const LAN_SERVER_BIND: &str = "lan_server.bind";
/// Pre-shared key for the LAN event forwarder.
/// Required when `lan_server.bind` is `"0.0.0.0"`.
/// Peers must send `{"op":"hello","psk":"<value>"}` as
/// their first message or the connection is dropped.
pub const LAN_SERVER_PSK: &str = "lan_server.psk";

// ── Media (images) settings ───────────────────────────────
/// Media storage backend: `"local"` (Tauri filesystem) or `"object"`
/// (S3-compatible, cloud). Default `"local"`.
pub const MEDIA_STORAGE_BACKEND: &str = "media.storage_backend";
/// Root path for local media storage (relative or absolute).
/// Default `"media"` under the app data dir.
pub const MEDIA_ROOT_PATH: &str = "media.root_path";
/// Max input file size for images, in bytes. Default `"20971520"` (20 MiB).
pub const MEDIA_MAX_INPUT_BYTES: &str = "media.max_input_bytes";
/// Max decodable pixels for images (decompression-bomb guard).
/// Default `"40000000"` (40 MP).
pub const MEDIA_MAX_PIXELS: &str = "media.max_pixels";

// ── EDC terminals settings ────────────────────────────────
/// Default EDC terminal ID used when the cashier flow picks a card
/// terminal. Empty string = no default (user is prompted).
pub const EDC_DEFAULT_TERMINAL: &str = "edc.default_terminal";

// ── Regional defaults ─────────────────────────────────────
/// Organization-default BCP-47 locale, written by the Settings → General
/// language selector. Named here because the literal previously had no reader
/// anywhere in the repo; `oz_core::regional` now consumes it as the
/// organization layer of the locale chain.
pub const UI_LOCALE: &str = "ui.locale";

// ── Credential-bearing keys (C-2) ───────────────────────────
//
// The two deny lists at the foot of this module are the ONE shared source of
// truth for both shells: the desktop lane re-exports them through
// `oz_bridge::settings` and `apps/tablet-client` imports them directly. They
// are built FROM the constants declared here — never from retyped literals —
// so renaming a key value moves the guard with it instead of silently
// dropping coverage (the original `sync.terminal_secret` typo left the
// stored key `sync_terminal_secret` readable through `get_setting` and
// exportable in a `.ozpkg` for exactly that reason).

/// Per-install Local API JWT signing secret. Mirrors
/// `oz_local_api::SETTINGS_SECRET`; declared as a literal here because
/// platform-core must not depend on the Local API crate.
pub const LOCAL_API_SECRET: &str = "local_api.secret";
/// Serialised SMTP account JSON, whose `password` field is encrypted at rest.
pub const SMTP_CONFIG: &str = "smtp_config";
/// API key issued by the license server.
pub const LICENSE_API_KEY: &str = "license.api_key";
/// Signed license payload — replaying it into another install re-binds a
/// license, so it never leaves the backend.
pub const LICENSE_PAYLOAD: &str = "license.payload";
/// Signature over [`LICENSE_PAYLOAD`].
pub const LICENSE_SIGNATURE: &str = "license.signature";
/// Tenant id issued by the license server; identifies the paying tenant.
pub const LICENSE_TENANT_ID: &str = "license.tenant_id";
/// Customer phone number captured at license activation (written by
/// `license.rs` from the server response). Personal data tied to the
/// per-install activation — like [`LICENSE_TENANT_ID`] it identifies the
/// paying tenant, not configuration a second till needs, so it is denied
/// from the raw get_setting IPC surface and both untrusted lanes.
pub const LICENSE_PHONE: &str = "license.phone";
/// Stripe secret API key.
pub const STRIPE_API_KEY: &str = "stripe.api_key";
/// Square API key.
pub const SQUARE_API_KEY: &str = "square.api_key";
/// Midtrans (QRIS) server key.
pub const MIDTRANS_SERVER_KEY: &str = "midtrans.server_key";
/// Persisted machine fingerprint: the KDF factor for every machine-bound
/// encryption family and the one-trial-per-device lock.
pub const MACHINE_ID: &str = "machine_id";
/// Persisted hardware fingerprint (`hw_` + full SHA-256 hex of the system
/// UUID anchor): the license server's one-trial-per-device lock. Like
/// [`MACHINE_ID`] it is per-device identity — shipping it to a peer hands
/// it this machine's identity — so it is refused on both untrusted lanes
/// while `license.rs` keeps minting it under TrustedLocal.
pub const HARDWARE_FINGERPRINT: &str = "hardware_fingerprint";

/// Settings keys that must never be returned by the raw `get_setting` IPC
/// surface, nor travel in a portable export/restore package.
///
/// Each entry is a credential, API key, password or pre-shared key
/// (C-2: CWE-200 information disclosure). A connection string counts as a
/// credential when its URL form can carry the password inside it
/// ([`REDIS_URL`] does: `redis://:PASSWORD@host:6379` is the form operators
/// save), so refusing the endpoint is refusing the secret, not the host.
/// Adding a credential constant here
/// is mandatory; `crates/oz-bridge/src/settings_tests.rs` walks every
/// credential-family constant declared in this module and fails if any of
/// them is missing from [`SECRET_KEY_DENY_LIST`] or
/// [`NON_EXPORTABLE_DEVICE_KEYS`].
pub const SECRET_KEY_DENY_LIST: &[&str] = &[
    SYNC_API_KEY,
    SYNC_TERMINAL_SECRET,
    PG_SYNC_PASSWORD,
    REDIS_URL,
    RATE_SYNC_API_KEY,
    LAN_SERVER_PSK,
    LOCAL_API_SECRET,
    SMTP_CONFIG,
    LICENSE_API_KEY,
    LICENSE_PAYLOAD,
    LICENSE_SIGNATURE,
    LICENSE_TENANT_ID,
    LICENSE_PHONE,
    STRIPE_API_KEY,
    SQUARE_API_KEY,
    MIDTRANS_SERVER_KEY,
];

/// Device-bound identity keys: like the credential list above they must
/// never leave the backend in a portable package, but they are identifiers
/// rather than credentials, so they stay readable through `get_setting`.
///
/// `sync_terminal_id` is the cleartext half of the client-credentials pair
/// whose secret is [`SYNC_TERMINAL_SECRET`], and [`MACHINE_ID`] is the KDF
/// factor for the machine-bound families. Shipping either into a second
/// install would hand it the source machine's identity (duplicate terminal
/// registration; a restored trial lock), which is the same per-install
/// property review MED-2 protected for `local_api.secret`.
pub const NON_EXPORTABLE_DEVICE_KEYS: &[&str] =
    &[SYNC_TERMINAL_ID, MACHINE_ID, HARDWARE_FINGERPRINT];

/// Returns true when the given settings key holds a credential that the raw
/// get_setting IPC surface must never return (C-2).
///
/// Both shells route through this one predicate so the match cannot drift the
/// way the two hand-copied lists did; the bridge layer adds only the
/// lifecycle-manager prefix rule on top of it.
pub fn is_secret_setting_key(key: &str) -> bool {
    SECRET_KEY_DENY_LIST.contains(&key)
}

/// Returns true when the given key must never leave the backend inside a
/// portable export/restore package: every credential from
/// [SECRET_KEY_DENY_LIST] plus the device-bound identity keys from
/// [NON_EXPORTABLE_DEVICE_KEYS].
///
/// Lifecycle-manager-owned prefixes (local_api.*, lan_server.*) are refused
/// on top of this by the bridge lane, which owns the manager names; the
/// tablet shell has no such manager surface, so this is the whole rule there.
pub fn is_non_exportable_setting_key(key: &str) -> bool {
    is_secret_setting_key(key) || NON_EXPORTABLE_DEVICE_KEYS.contains(&key)
}
