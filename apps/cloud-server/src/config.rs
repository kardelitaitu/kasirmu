/*
last audited 25-07-26 by RSA-Agent (cloud-server slice A: verified)
crate: cloud-server | status: SAFE | lint: CLEAN
findings: clean — sharded token buckets with per-route configs and background cleanup; unwraps carry SAFETY comments on static metric names; panic guards are deliberate pool-type mismatches; sweep found no SQL interpolation
next: none | perf: N/A
*/
//! Centralised configuration for the cloud server.
//!
//! All environment-variable reads happen in [`CloudServerConfig::from_env`].
//! Every other module receives the values it needs through the config struct
//! — no scattered `std::env::var()` calls across the codebase.
//!
//! Validation runs eagerly: invalid values (unparseable port, missing
//! required vars in production mode) are surfaced at startup with clear
//! error messages rather than cryptic panics later.

/// Log output format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    /// Default human-readable text output.
    Plain,
    /// Structured JSON lines (useful for log aggregators).
    Json,
}

/// Centralised configuration for the OZ-POS cloud sync server.
///
/// Construct with [`CloudServerConfig::from_env`]; pass by reference to
/// every module that needs environment-derived settings.
#[derive(Debug, Clone)]
pub struct CloudServerConfig {
    /// Path to the SQLite database file (default: `oz-pos.db`).
    /// Ignored when `database_url` points to a PostgreSQL server.
    pub db_path: String,

    /// Optional PostgreSQL connection URL (e.g. `postgres://...`).
    /// When set and starting with `postgres://`, the server connects to
    /// PostgreSQL instead of SQLite.
    pub database_url: Option<String>,

    /// When `true` (`OZ_DB_REQUIRE_TLS=1`, or implied by `OZ_PRODUCTION=1`),
    /// a PostgreSQL `database_url` must set `sslmode=require` — otherwise
    /// startup fails. This prevents the rustls client from silently falling
    /// back to plaintext (`sslmode=prefer` is the default when the URL omits
    /// it).
    pub require_tls: bool,

    /// Maximum number of connections in the PostgreSQL pool
    /// (`OZ_DB_POOL_SIZE`, default: `8`). Ignored for SQLite.
    pub db_pool_size: usize,

    /// When `true` (default), startup applies the full schema (`PG_INIT`) to
    /// the Postgres database. Set `OZ_APPLY_SCHEMA=0` once the schema exists
    /// and the app runs as the restricted post-cutover role (`oz_app`, see
    /// `scripts/rls-cutover.sql`): that role only has DML grants, so the
    /// unconditional DDL re-apply would fail with `permission denied for
    /// schema public`. The migration tool applies the schema once as the
    /// owner; the app then boots without touching DDL.
    pub apply_schema: bool,

    /// HTTP listen port (default: `3099`).
    pub port: u16,

    /// Admin key for token minting and plan management.
    /// When `None` (default), token and plan endpoints are open (dev mode).
    /// When set, callers must pass the matching `X-Admin-Key` header.
    pub admin_key: Option<String>,

    /// When `true`, sync requests from tenants on the `free` plan are
    /// rejected with `403 plan_required`.
    pub enforce_plans: bool,

    /// When `true` (`OZ_PRODUCTION=1`), startup fails unless `OZ_API_SECRET`
    /// and `OZ_ADMIN_KEY` are both set — no dev-secret JWT fallback and no
    /// open token mint in production. Also implies [`CloudServerConfig::require_tls`].
    pub production: bool,

    /// Log output format.
    pub log_format: LogFormat,

    /// When `true`, the server runs in redirect-only mode (ADR #11):
    /// no DB, no prune, no metrics — just the migration redirect.
    pub redirect_only: bool,

    /// New server URL for the migration redirect. Sync requests to
    /// `/api/sync/*` return HTTP 421 with this URL in the body.
    pub sync_redirect_url: Option<String>,

    /// Stripe webhook signing secret (`whsec_...`).
    /// Required for `POST /api/webhooks/stripe` signature verification.
    pub stripe_webhook_secret: Option<String>,

    /// Square webhook signature key.
    /// Required for `POST /api/webhooks/square` signature verification.
    pub square_webhook_signature_key: Option<String>,

    /// Public Square webhook URL (used for webhook registration).
    pub square_webhook_url: Option<String>,

    /// Midtrans Core-API server key (`MIDTRANS_SERVER_KEY`). Doubles as the
    /// charge credential for `POST /api/payment/midtrans/qris` and the
    /// recomputation secret for `POST /api/webhooks/midtrans` signature
    /// verification. One platform-wide key — the same model Stripe and
    /// Square already use here; tenant attribution happens at webhook time
    /// via the `midtrans_transactions` ledger, not at key time
    /// (agents-1 D1 decision, 2026-09-13).
    pub midtrans_server_key: Option<String>,

    /// When `true` (`MIDTRANS_SANDBOX=1`), QRIS charges go to the Midtrans
    /// sandbox API. Verification is environment-agnostic (same SHA512
    /// algorithm — the key differs per environment), so this flag only
    /// steers the charge endpoint.
    pub midtrans_sandbox: bool,

    /// Optional QRIS acquirer (`MIDTRANS_QRIS_ACQUIRER`), forwarded verbatim to
    /// Midtrans as `qris.acquirer` on every charge this server raises —
    /// verbatim after `parse_qris_acquirer` strips surrounding whitespace,
    /// and with no case folding.
    ///
    /// **Unset (the default) sends no acquirer at all**, so the QR stays generic
    /// and any QRIS-compliant wallet can scan it — what every deployment does
    /// today. A blank or whitespace-only value is normalised to `None`, so a
    /// stray `=""` in a compose file cannot pin every QR to one e-wallet.
    ///
    /// SCOPE HONESTY: this is a **process-wide deployment knob, read once at
    /// startup** — not the per-terminal / per-merchant override
    /// `todo-payment.md` rules for merchants with a co-branded activation.
    /// There is no settings-table field, no admin route, no UI control and no
    /// cashier path to it; changing it means setting the env var and restarting
    /// the server. One entry in the whole platform may therefore pin **every**
    /// tenant's QR to one wallet, so it must stay unset in shared multi-tenant
    /// deployments until the per-tenant half is designed and ruled. Startup
    /// now warns (never refuses — refusing would break a legitimate
    /// single-tenant production deployment) when `OZ_PRODUCTION=1` is set
    /// alongside a value, and again when the value is outside the names
    /// Midtrans documents, which is a typo-check rather than a gate.
    pub midtrans_qris_acquirer: Option<String>,

    /// JWT signing secret for `POST /api/v1/tokens`.
    /// Falls back to a hard-coded dev secret when unset.
    pub api_secret: Option<String>,

    /// Optional Redis/Valkey URL (ADR #43 D4), e.g. `redis://...`.
    /// When set and reachable, the snapshot cache and rate limiter are
    /// shared across instances via Redis (Lua token bucket). When unset or
    /// unreachable, the server falls back to the in-process
    /// implementations — single-instance deployments need nothing new.
    pub redis_url: Option<String>,
}

impl CloudServerConfig {
    /// Build configuration from environment variables.
    ///
    /// # Validation
    ///
    /// * `OZ_REDIRECT_ONLY=true` requires `OZ_SYNC_REDIRECT_URL` to be set.
    /// * `OZ_API_PORT` must parse as a valid `u16`.
    /// * `OZ_ADMIN_KEY` is treated as unset when empty (Docker passes `""`
    ///   for absent host variables).
    /// * `OZ_PRODUCTION=1` requires `OZ_API_SECRET` and `OZ_ADMIN_KEY` to be
    ///   set (no dev-secret fallback / open token mint).
    ///
    /// `MIDTRANS_QRIS_ACQUIRER` is never refused: `warn_qris_acquirer_pitfalls`
    /// can raise two startup warnings about it, both diagnostics and neither a
    /// gate.
    ///
    /// # Errors
    ///
    /// Returns `Err(message)` when validation fails so the caller can log
    /// and exit cleanly instead of panicking.
    pub fn from_env() -> Result<Self, String> {
        let redirect_only = env_bool("OZ_REDIRECT_ONLY");
        let sync_redirect_url = std::env::var("OZ_SYNC_REDIRECT_URL").ok();

        if redirect_only && sync_redirect_url.is_none() {
            return Err("OZ_REDIRECT_ONLY=true requires OZ_SYNC_REDIRECT_URL to be set".into());
        }

        let port: u16 = std::env::var("OZ_API_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3099);

        let log_format = match std::env::var("OZ_LOG_FORMAT").as_deref() {
            Ok("json") => LogFormat::Json,
            _ => LogFormat::Plain,
        };

        let enforce_plans = env_bool("OZ_ENFORCE_PLANS");
        let production = env_bool("OZ_PRODUCTION");

        // An empty string must not enable key gating: `docker compose`
        // passes `OZ_ADMIN_KEY` through as `""` when the host variable
        // is absent.
        let admin_key = std::env::var("OZ_ADMIN_KEY").ok().filter(|k| !k.is_empty());
        let api_secret = std::env::var("OZ_API_SECRET")
            .ok()
            .filter(|s| !s.is_empty());

        let database_url = std::env::var("DATABASE_URL").ok();
        let db_path = std::env::var("OZ_DB_PATH").unwrap_or_else(|_| "kasir.db".into());
        let require_tls = resolve_require_tls(env_bool("OZ_DB_REQUIRE_TLS"), production);
        let db_pool_size = env_usize("OZ_DB_POOL_SIZE", 8);
        // Schema application is on by default; only an explicit `0`/`false`/
        // `off` disables it (the opposite of `env_bool`, where unset means
        // false). `OZ_APPLY_SCHEMA=0` is the post-cutover deployment shape.
        let apply_schema = !matches!(
            std::env::var("OZ_APPLY_SCHEMA")
                .as_deref()
                .map(str::trim)
                .unwrap_or("1"),
            "0" | "false" | "FALSE" | "off" | "OFF"
        );

        validate_production(production, api_secret.as_deref(), admin_key.as_deref())?;

        // Read the acquirer *after* the production flag exists locally, so the
        // same value that reaches the wire is the value the warnings below are
        // about. Hard ordering rule: warnings never `return Err` — refusing
        // here would break a legitimate single-tenant production deployment,
        // which is not this file's call.
        let midtrans_qris_acquirer =
            parse_qris_acquirer(std::env::var("MIDTRANS_QRIS_ACQUIRER").ok());
        warn_qris_acquirer_pitfalls(production, midtrans_qris_acquirer.as_deref());

        Ok(Self {
            db_path,
            database_url,
            require_tls,
            db_pool_size,
            apply_schema,
            port,
            admin_key,
            enforce_plans,
            log_format,
            redirect_only,
            sync_redirect_url,
            stripe_webhook_secret: std::env::var("STRIPE_WEBHOOK_SECRET").ok(),
            square_webhook_signature_key: std::env::var("SQUARE_WEBHOOK_SIGNATURE_KEY").ok(),
            square_webhook_url: std::env::var("SQUARE_WEBHOOK_URL").ok(),
            midtrans_server_key: std::env::var("MIDTRANS_SERVER_KEY")
                .ok()
                .filter(|k| !k.is_empty()),
            midtrans_sandbox: env_bool("MIDTRANS_SANDBOX"),
            midtrans_qris_acquirer,
            production,
            api_secret,
            redis_url: std::env::var("OZ_REDIS_URL").ok().filter(|s| !s.is_empty()),
        })
    }
}

/// Parse a boolean environment variable.
///
/// Returns `true` for `"1"`, `"true"` (case-insensitive), or `"on"`
/// (case-insensitive). Everything else (including unset) returns `false`.
fn env_bool(name: &str) -> bool {
    std::env::var(name)
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "on" | "ON"))
        .unwrap_or(false)
}

/// Normalise the raw `MIDTRANS_QRIS_ACQUIRER` value into an acquirer override.
///
/// Unset, empty and whitespace-only all map to `None`, which is the ruled
/// default: the charge omits `qris.acquirer` and Midtrans issues a generic
/// QRIS code. Surrounding whitespace is stripped, and the value left over is
/// passed through unchanged — an inner space, mixed case and any name this
/// server has never heard of all survive as written, because the gateway and
/// not this server owns the vocabulary. So trimming is applied, and case
/// folding is not.
///
/// Trimming is load-bearing, not cosmetic: a CRLF `.env`, an `env_file`, or a
/// trailing space in a compose `environment:` entry used to produce
/// `Some("gopay\r")`, which went on the wire byte-for-byte, was rejected by
/// Midtrans, and turned every QRIS charge on that deployment into a 502 —
/// while a whitespace-only value already read as `None`, so the blank guard
/// alone never told anyone the value was broken.
///
/// Split out from `from_env` so the semantics are unit-testable without
/// mutating process env.
fn parse_qris_acquirer(raw: Option<String>) -> Option<String> {
    raw.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

/// The acquirer names Midtrans documents for `qris.acquirer`
/// (`todo-payment.md`: `gopay`, `shopeepay`, `dana`, `linkaja`).
///
/// This is a **diagnostic aid, not a validation gate** — see
/// `warn_qris_acquirer_pitfalls`. Which acquirer a merchant may name is
/// governed by their Midtrans activation, so the set can be wrong in both
/// directions and neither case is this server's to decide.
const KNOWN_QRIS_ACQUIRERS: [&str; 4] = ["gopay", "shopeepay", "dana", "linkaja"];

/// Non-blocking startup warnings for a configured `MIDTRANS_QRIS_ACQUIRER`.
///
/// The field's own docs say it must stay unset in shared multi-tenant
/// deployments, and until now nothing checked — so this reports the two ways
/// the knob goes wrong, in the order a reader needs them:
///
/// 1. **The pin.** `production && acquirer.is_some()`: the value is one
///    process-wide env var read once at startup, so it pins **every** tenant's
///    QR to one wallet, not the operator's own. Warned, never refused — a
///    single-tenant production deployment setting it is a legitimate choice
///    this file may not veto.
/// 2. **The typo.** A value outside `KNOWN_QRIS_ACQUIRERS` is an all-tenant
///    outage discovered at the first charge, and the charset/length of the
///    value is otherwise unbounded and unchecked. This one exists because the
///    honest verdict is that the value is *not* an injection risk: it is
///    forwarded as a JSON string scalar through serde (`qris.rs` ->
///    `post_json` -> reqwest `.json()`), never into a URL, header or SQL, and
///    the only party who can set it already holds `MIDTRANS_SERVER_KEY` — so
///    there is no privilege gradient, only an outage nobody notices until a
///    customer scans a QR.
///
/// Takes the parsed value (not the raw env) so both warnings describe exactly
/// what goes on the wire. Split out of `from_env` for the same reason
/// `parse_qris_acquirer` is: testable without mutating process env.
fn warn_qris_acquirer_pitfalls(production: bool, acquirer: Option<&str>) {
    let Some(acquirer) = acquirer else {
        return; // generic QRIS code — the ruled default, nothing to say
    };

    if production {
        tracing::warn!(
            acquirer = %acquirer,
            "MIDTRANS_QRIS_ACQUIRER is set while OZ_PRODUCTION=1. It is a \
             process-wide knob read once at startup, so it pins EVERY tenant's \
             QR to this one wallet — unset it in shared multi-tenant \
             deployments. Warned, not refused: a single-tenant production \
             deployment may want it."
        );
    }

    if !KNOWN_QRIS_ACQUIRERS.contains(&acquirer) {
        tracing::warn!(
            acquirer = %acquirer,
            known = ?KNOWN_QRIS_ACQUIRERS,
            "MIDTRANS_QRIS_ACQUIRER is outside the known acquirer set. This \
             list is a diagnostic aid, NOT a validation gate: the value is \
             still forwarded verbatim, and which acquirer a merchant may name \
             is governed by their Midtrans activation. A wrong name here is an \
             all-tenant QRIS outage discovered at the first charge."
        );
    }
}

/// Parse a positive integer environment variable.
///
/// Returns `default` when the variable is unset, empty, or not a positive
/// integer — the pool must always have at least one connection.
fn env_usize(name: &str, default: usize) -> usize {
    parse_usize(std::env::var(name).as_deref().unwrap_or(""), default)
}

/// Parse a positive integer from a string, falling back to `default`.
///
/// Extracted as a pure helper so the parsing rules are unit-testable
/// without environment mutation.
fn parse_usize(s: &str, default: usize) -> usize {
    s.trim()
        .parse::<usize>()
        .ok()
        .filter(|n| *n > 0)
        .unwrap_or(default)
}

/// Validate production-mode requirements.
///
/// When `production` is enabled, the JWT signing secret and admin key must
/// both be configured so the server never falls back to the hard-coded dev
/// secret or an open token mint.
fn validate_production(
    production: bool,
    api_secret: Option<&str>,
    admin_key: Option<&str>,
) -> Result<(), String> {
    if !production {
        return Ok(());
    }
    if api_secret.is_none() {
        return Err(
            "OZ_PRODUCTION=1 requires OZ_API_SECRET to be set (no dev-secret fallback)".into(),
        );
    }
    if admin_key.is_none() {
        return Err("OZ_PRODUCTION=1 requires OZ_ADMIN_KEY to be set (no open token mint)".into());
    }
    Ok(())
}

/// Resolve whether the Postgres connection must use TLS.
///
/// `OZ_PRODUCTION=1` implies TLS even when `OZ_DB_REQUIRE_TLS` is unset, so a
/// single production flag enforces the encrypted-connection requirement.
fn resolve_require_tls(flag: bool, production: bool) -> bool {
    flag || production
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
