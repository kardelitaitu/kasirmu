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
/// Second cleartext copy of [`SYNC_API_KEY`], posted by the Settings -> Cloud
/// Sync card as a "mirror" for a screen that was supposed to load it back.
///
/// Declared here for the first time because the key had no constant at all:
/// it existed only as the bare literal `"sync.auth_token"`, which is exactly
/// how a key stays off both deny lists - the lists below are built FROM the
/// constants declared in this module, so an unregistered key is a key the
/// guard never sees. It is a credential in every respect (the same sync API
/// key, copied into a second row), so it belongs on [`SECRET_KEY_DENY_LIST`]
/// and NOT in [`NON_EXPORTABLE_DEVICE_KEYS`]: it is not per-device identity,
/// it is the tenant's sync secret.
///
/// There is NO reader for this key anywhere in the tree - not in `ui/src`,
/// not in Rust outside tests - so refusing it breaks nothing that works
/// today. What it was costing was egress: on no deny list, it left the
/// device on BOTH untrusted lanes (the `settings.update` sync queue and the
/// portable `.ozpkg` package) as a duplicate cleartext secret.
pub const AUTH_TOKEN: &str = "sync.auth_token";
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
/// logging — see `crates/kasirmu-core/src/config_validator.rs`, COR-3), so the
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
/// `kasirmu_local_api::SETTINGS_SECRET`; declared as a literal here because
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
/// is mandatory; `crates/kasirmu-bridge/src/settings_tests.rs` walks every
/// credential-family constant declared in this module and fails if any of
/// them is missing from [`SECRET_KEY_DENY_LIST`] or
/// [`NON_EXPORTABLE_DEVICE_KEYS`].
pub const SECRET_KEY_DENY_LIST: &[&str] = &[
    SYNC_API_KEY,
    AUTH_TOKEN,
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

/// Names that are neither credentials, nor device identity, nor manager-owned,
/// and that no peer may have APPLIED from the network: this install's own
/// sync destination and transport switches.
///
/// WHY THEY ARE REFUSED. `RemoteSync` decides by EXCLUSION over an OPEN
/// namespace (`raw.rs`, `IngestPolicyKind::admits`), so it can only refuse names
/// its author thought to name - while the applied key is the payload's own
/// string, read verbatim at platform/sync/src/queue.rs:525-536 and written
/// through a bare INSERT into the GLOBAL identity database (queue.rs:395 ->
/// daemon_tick.rs:292). Nothing signs or MACs an item (queue.rs:10-12: the
/// sender is not an authority), so any peer in the tenant, or the server
/// operator, can name these six today. The sharpest is not spelled like a
/// secret at all: crates/kasirmu-core/src/sync_auth.rs:72 sends Authorization:
/// Bearer <sync api key> to whatever `sync_server_url` currently holds, so
/// planting that one name exfiltrates a credential without ever naming a
/// credential key. The rest switch or repoint the transport tenant-wide.
///
/// WHY A SEPARATE LIST, the part a reader must not miss. The two lists above
/// are shared by BOTH untrusted directions and they stay shared. This one is
/// refused by REMOTE SYNC ONLY, deliberately: `PortablePackage` must keep
/// carrying whatever the app owns, because a backup restore legitimately
/// contains it and narrowing that arm would break restores. Spelling the
/// asymmetry as a third list here, beside the other two, keeps it visible;
/// folding these names into `is_non_exportable_setting_key` would look tidier
/// and would silently refuse on the package lane too.
///
/// WHAT THIS IS NOT: not an allow-list, and it does not close the open
/// namespace - every name NOT here is still admitted from a peer. The
/// allow-list is the paired, larger change, and it cannot be built from the
/// twelve names the UI happens to enqueue today: the reachable egress surface
/// is unbounded, because all five queue doors take an arbitrary key string from
/// the renderer (see .agents/egress-surface.md). The drift surface is the
/// namespace, not this list; this list closes the six we can name.
///
/// Each name here is refused at the door AND is never a queue producer, so
/// refusing it drops no working traffic. The four writers of `sync_server_url`
/// are crates/kasirmu-bridge/src/sync.rs:71, apps/tablet-client/src/commands/sync.rs:87,
/// apps/desktop-client/src/sync_bootstrap.rs:83 and
/// platform/sync/src/daemon_tick.rs:83 - none calls
/// `Store::enqueue_settings_update_superseding`
/// (crates/kasirmu-core/src/db/offline.rs:194). Note that last one writes this row
/// from a network RESPONSE, outside the ingest lane entirely (the ADR 11
/// migration redirect), so this list does not reach that path either.
///
/// Built FROM the constants, as the two lists above are - never from retyped
/// literals, so renaming a key value moves the guard with it.
/// SIX names, and the sixth one cost a pin to add. sync_enabled sat outside this
/// list for one commit because raw_tests pinned the folded spelling
/// "  sync_enabled\t" as the example of an ordinary key that survives the
/// normalisation fold - and a name on this list is by definition not that.
/// Resolved by moving the EXAMPLE, not by deleting the leg
/// (raw_tests.rs:732-760 now folds "  ui.locale\t"), because the assertion was
/// the thing under test and the name was only ever a stand-in. Recorded here so
/// nobody re-derives that collision at four in the morning: when a fold-leg
/// example and a refusal list disagree, change the example.
pub const PEER_NAMED_HAZARD_KEYS: &[&str] = &[
    SYNC_SERVER_URL,
    SYNC_ENABLED,
    PG_SYNC_HOST,
    PG_SYNC_USER,
    PG_SYNC_DBNAME,
    REDIS_CACHE_TTL,
];

/// The one predicate the `RemoteSync` arm asks: true when `key` names a
/// transport destination or switch. The SINGLE definition of that membership, so
/// no arm, lane or shell carries a copy of this list. The candidate is folded
/// first ([`normalised_candidate`]) exactly as the two shared lists fold it - a
/// near-miss spelling of a refused destination is still that destination - and
/// the list itself stays as declared.
pub fn is_peer_named_hazard_key(key: &str) -> bool {
    let candidate = normalised_candidate(key);
    PEER_NAMED_HAZARD_KEYS.contains(&candidate.as_str())
}

/// The comparison form of a candidate settings key: surrounding whitespace
/// trimmed and ASCII case-folded.
///
/// `pub` so the lifecycle-manager prefix rule
/// ([`crate::settings::is_manager_owned_key`]) AND the one comparison of this
/// family that lives in another crate — the manager-owner label of the bridge
/// lane (`crates/kasirmu-bridge/src/settings.rs`, `managed_key_owner`) — fold a
/// candidate through THIS function instead of writing a second normalisation:
/// the credential half and the prefix half of one ingest boolean have to answer
/// a near-miss spelling the same way, or the boolean has two matching semantics
/// inside it; a label that disagrees with the gate it labels is the same defect
/// one crate further out.
///
/// What this IS: the comparison form of a settings-key CANDIDATE, for matching
/// a key handed to a guard against the markers of this key family. What it is
/// NOT: not a storage normalisation — folding never merges, rewrites or
/// deduplicates a row, and the stored key stays byte for byte what the caller
/// wrote — and not a general string utility. Other subsystems must not fold
/// values, names, paths or free text with it: a caller that is not comparing a
/// settings key against a marker of this family has no business calling it.
///
/// The candidate is normalised — never the lists and never the prefix literals
/// — so [`SECRET_KEY_DENY_LIST`], [`NON_EXPORTABLE_DEVICE_KEYS`] and the
/// `local_api.` / `lan_server.` prefixes stay exactly as declared (lowercase,
/// untrimmed), and every comparison this key family makes against them goes
/// through this one fold.
///
/// Case-folding is ASCII-only on purpose: settings keys are ASCII identifiers,
/// and a Unicode case fold would promise a normalisation the TEXT/BINARY
/// storage layer does not make. Trimming is NOT ASCII-only, and a reader must
/// not assume it is: [`str::trim`] is Unicode `White_Space`-aware, so
/// `U+00A0` (NO-BREAK SPACE) and `U+2028` (LINE SEPARATOR) around a candidate
/// DO strip even though they are not whitespace to SQLite's BINARY collation.
/// The over-strip is harmless in one direction only, and which direction it is
/// has to be said plainly: it can only ever widen a REFUSAL (a NBSP-wrapped
/// `stripe.api_key` is folded to the deny-listed spelling and refused, while
/// the row itself survives as its own distinct row in storage), never widen an
/// admission — because every marker it is compared against is a lowercase
/// ASCII literal. An ordinary key that loses Unicode padding is still not a
/// marker, so no spelling of `store.name` becomes a refusal by way of this.
pub fn normalised_candidate(key: &str) -> String {
    key.trim().to_ascii_lowercase()
}

/// The credential a settings-key NAME denotes: the canonical
/// [`SECRET_KEY_DENY_LIST`] entry that this key spells, or `None` when the
/// name spells no credential at all.
///
/// This is the IDENTITY question — “what credential does this name
/// denote” — and it is the only place that question is answered. The four
/// policy questions asked about a credential (may it be written, may it be
/// read, may it leave the backend, may it be deleted) are asked BY CALLERS of
/// this function, against the base it returns, and never by a second
/// membership test: a caller that re-derives the match has started a second
/// definition of identity, and two definitions drift. The identity question
/// lives here and the verdicts live in callers;
/// `decision_pin_membership_tests_live_only_in_the_identity_functions` in this
/// module's tests fails any line that adds a membership test elsewhere in this
/// file, so the shape cannot quietly lapse.
///
/// As of this commit the resolution is deliberately SUFFIX-BLIND: whole-key
/// equality against the list, exactly the comparison [`is_secret_setting_key`]
/// already made, so nothing about a verdict moves tonight. The consequence,
/// stated rather than discovered later: `smtp_config:tenant-a`, the
/// `{base}:{tenant}` form `crates/kasirmu-api/src/pg.rs` writes through
/// `scoped_setting_key`, resolves to `None` even though it is the same SMTP
/// secret. That is a KNOWN BLIND SPOT with a recorded owner — the
/// credential-suffix wave — pinned by
/// `decision_pin_credential_base_is_suffix_blind` in this module's tests, not
/// a mystery.
///
/// The suffix arm is a PROJECTION change, not a caller change: whoever flips
/// it flips one line inside this function and every delegating caller moves
/// with it — which is exactly why it must not be flipped from inside a fix
/// wave that only means to close one read path.
pub fn credential_base(key: &str) -> Option<&'static str> {
    let candidate = normalised_candidate(key);
    SECRET_KEY_DENY_LIST
        .iter()
        .find(|entry| **entry == candidate.as_str())
        .copied()
}

/// The device-bound identity key a settings-key NAME denotes: the canonical
/// [`NON_EXPORTABLE_DEVICE_KEYS`] entry it spells, or `None` when it spells
/// none.
///
/// The twin of [`credential_base`], same shape, same rules, and the same
/// division of labour: the IDENTITY question lives here and the VERDICTS live
/// in callers. A name's device half answers “may this leave the backend in a
/// portable package” and nothing else — these keys stay readable through
/// `get_setting`, which is why the two lists are never merged and why no name
/// moves between them. A second membership test would be a second definition
/// of identity; `decision_pin_membership_tests_live_only_in_the_identity_functions
/// in this module's tests fails any line that adds one.
///
/// Suffix-blind for the same reason and with the same consequence as
/// [`credential_base`] — whole-key equality against a list that stays as
/// declared — so `sync_terminal_id:tenant-a` resolves to `None` today.
pub fn device_base(key: &str) -> Option<&'static str> {
    let candidate = normalised_candidate(key);
    NON_EXPORTABLE_DEVICE_KEYS
        .iter()
        .find(|entry| **entry == candidate.as_str())
        .copied()
}
/// Returns true when the given settings key holds a credential that the raw
/// get_setting IPC surface must never return (C-2).
///
/// Both shells route through this one predicate so the match cannot drift the
/// way the two hand-copied lists did; the bridge layer adds only the
/// lifecycle-manager prefix rule on top of it.
///
/// The identity test itself lives in [`credential_base`]: this predicate is that
/// function's `is_some()`, so the fold, the suffix-blindness and the
/// canonical-entry contract are defined there and nowhere else. Same verdicts
/// as before this indirection, one place that answers what a name denotes.
///
/// The candidate key is normalised before the match — trimmed and ASCII
/// case-folded — because the settings table is a TEXT primary key under the
/// default BINARY collation: `Stripe.API_KEY` and `"stripe.api_key "` are
/// distinct rows a case- and whitespace-exact match admits on both the write
/// funnel and the read-back, so a cleartext credential stored under a
/// near-miss key reads straight back over IPC. Normalising here fixes every
/// caller at once; the lists themselves stay lowercase and untouched.
///
/// What this does NOT do, so nobody mistakes the fold for more than it is:
///
/// * It does not normalise STORAGE. A near-miss key still creates a second
///   row with its own value; nothing is deduplicated, merged or rewritten.
///   The repair closes the write-refusal and read-back gap for a sloppy key —
///   the second row is now refused, not reconciled.
/// * It does not make the deny list prefix-safe. The match is equality on the
///   normalised whole key, so `stripe.api_key.extra` — or any key whose
///   normalised form contains none of the markers — is still admitted.
///   Whether this list should be an allow-list is a separate and larger
///   question, deliberately left open here.
/// * The `smtp_config` cleartext exception is NOT here and must not move
///   here. It lives beside the tracked-funnel refusal
///   (`Settings::cleartext_credential_refusal`) and is write-lane only;
///   folding it into this predicate would un-refuse `smtp_config` on the
///   raw get_setting read surface — the exception becoming a bypass. This
///   predicate keeps flagging `smtp_config` in every casing, so casing can
///   never widen that exception from this side.
pub fn is_secret_setting_key(key: &str) -> bool {
    credential_base(key).is_some()
}

/// Returns true when the given key must never leave the backend inside a
/// portable export/restore package: every credential from
/// [SECRET_KEY_DENY_LIST] plus the device-bound identity keys from
/// [NON_EXPORTABLE_DEVICE_KEYS].
///
/// Neither half computes a match of its own: the credential half resolves
/// through [`credential_base`] and the device half through [`device_base`], so
/// this predicate holds no local `normalised_candidate` call. That is the point
/// — the fold, the case rules and the suffix-blindness are each defined once,
/// which is what kept the two shells' hand-copied lists from ever agreeing.
/// The egress rule is therefore exactly the OR of two identity answers, and
/// this function is where a caller asks the “may it leave” verdict.
///
/// Lifecycle-manager-owned prefixes (local_api.*, lan_server.*) are refused
/// on top of this by the bridge lane, which owns the manager names; the
/// tablet shell has no such manager surface, so this is the whole rule there.
pub fn is_non_exportable_setting_key(key: &str) -> bool {
    credential_base(key).is_some() || device_base(key).is_some()
}

#[cfg(test)]
#[path = "keys_tests.rs"]
mod tests;
