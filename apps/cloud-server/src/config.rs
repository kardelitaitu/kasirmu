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

/// Centralised configuration for the kasir.mu cloud sync server.
///
/// Construct with [`CloudServerConfig::from_env`]; pass by reference to
/// every module that needs environment-derived settings.
#[derive(Debug, Clone)]
pub struct CloudServerConfig {
    /// Path to the SQLite database file (default: `var/kasir.db`).
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

    /// Admin alert email recipient (`OZ_ADMIN_EMAIL`, default: `adikaradwiatmaja@gmail.com`).
    pub admin_email: String,

    /// SMTP relay host for system alerts (`OZ_SMTP_HOST`). Unset means email
    /// delivery is disabled and alerts are logged only.
    pub smtp_host: Option<String>,

    /// SMTP relay port (`OZ_SMTP_PORT`, default: 587).
    pub smtp_port: u16,

    /// SMTP relay username (`OZ_SMTP_USER`).
    pub smtp_user: Option<String>,

    /// SMTP relay password (`OZ_SMTP_PASSWORD`).
    pub smtp_password: Option<String>,

    /// SMTP sender address (`OZ_SMTP_FROM`, default: `no-reply@kasir.mu`).
    pub smtp_from: String,
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
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Build configuration from an injectable variable lookup — the whole of
    /// `from_env` with the process environment replaced by `lookup`.
    ///
    /// This exists so a test can exercise the DETECTION rules (`DATABASE_URL`
    /// present / absent, `OZ_DB_PATH` set / unset) without mutating the
    /// process-global environment. Mutating it forces every such test to take
    /// a process-wide lock and `serial_test::serial` on top, because a
    /// concurrent test in the same binary would otherwise observe the
    /// transient value; `lookup` makes the "environment" a local value, so
    /// such a test needs no lock at all.
    ///
    /// Semantics are identical to `from_env` — `Ok(Some(v))` is an exported
    /// value, `None` is an unset one. Production never calls this directly;
    /// it calls `from_env`.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let redirect_only = env_bool_via(&lookup, "OZ_REDIRECT_ONLY");
        let sync_redirect_url = lookup("OZ_SYNC_REDIRECT_URL");

        if redirect_only && sync_redirect_url.is_none() {
            return Err("OZ_REDIRECT_ONLY=true requires OZ_SYNC_REDIRECT_URL to be set".into());
        }

        let port: u16 = lookup("OZ_API_PORT")
            .and_then(|p| p.parse().ok())
            .unwrap_or(3099);

        let log_format = match lookup("OZ_LOG_FORMAT").as_deref() {
            Some("json") => LogFormat::Json,
            _ => LogFormat::Plain,
        };

        let enforce_plans = env_bool_via(&lookup, "OZ_ENFORCE_PLANS");
        let production = env_bool_via(&lookup, "OZ_PRODUCTION");

        // An empty string must not enable key gating: `docker compose`
        // passes `OZ_ADMIN_KEY` through as `""` when the host variable
        // is absent.
        let admin_key = lookup("OZ_ADMIN_KEY").filter(|k| !k.is_empty());
        let api_secret = lookup("OZ_API_SECRET").filter(|s| !s.is_empty());

        let database_url = lookup("DATABASE_URL");
        // Program state lives under var/ so the repo root stays clean and
        // scripts/verify-root-policy.py keeps its no-patterns allowlist honest.
        // The parent directory is created in Db::connect_sqlite, not here, so
        // that reading this config never touches the filesystem.
        let db_path = lookup("OZ_DB_PATH").unwrap_or_else(|| "var/kasir.db".into());
        let require_tls =
            resolve_require_tls(env_bool_via(&lookup, "OZ_DB_REQUIRE_TLS"), production);
        let db_pool_size = env_usize_via(&lookup, "OZ_DB_POOL_SIZE", 8);
        // Schema application is on by default; only an explicit `0`/`false`/
        // `off` disables it (the opposite of `env_bool`, where unset means
        // false). `OZ_APPLY_SCHEMA=0` is the post-cutover deployment shape.
        let apply_schema = !matches!(
            lookup("OZ_APPLY_SCHEMA")
                .as_deref()
                .map(str::trim)
                .unwrap_or("1"),
            "0" | "false" | "FALSE" | "off" | "OFF"
        );

        validate_production(production, api_secret.as_deref(), admin_key.as_deref())?;
        warn_plan_gating_disabled(production, enforce_plans);

        // Read the acquirer *after* the production flag exists locally, so the
        // same value that reaches the wire is the value the warnings below are
        // about. Hard ordering rule: warnings never `return Err` — refusing
        // here would break a legitimate single-tenant production deployment,
        // which is not this file's call.
        let midtrans_qris_acquirer = parse_qris_acquirer(lookup("MIDTRANS_QRIS_ACQUIRER"));
        warn_qris_acquirer_pitfalls(production, midtrans_qris_acquirer.as_deref());

        let admin_email = lookup("OZ_ADMIN_EMAIL")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "adikaradwiatmaja@gmail.com".to_string());
        let smtp_host = lookup("OZ_SMTP_HOST")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let smtp_port: u16 = lookup("OZ_SMTP_PORT")
            .and_then(|p| p.parse().ok())
            .unwrap_or(587);
        let smtp_user = lookup("OZ_SMTP_USER")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let smtp_password = lookup("OZ_SMTP_PASSWORD").filter(|s| !s.is_empty());
        let smtp_from = lookup("OZ_SMTP_FROM")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "no-reply@kasir.mu".to_string());

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
            stripe_webhook_secret: lookup("STRIPE_WEBHOOK_SECRET"),
            square_webhook_signature_key: lookup("SQUARE_WEBHOOK_SIGNATURE_KEY"),
            square_webhook_url: lookup("SQUARE_WEBHOOK_URL"),
            midtrans_server_key: lookup("MIDTRANS_SERVER_KEY").filter(|k| !k.is_empty()),
            midtrans_sandbox: env_bool_via(&lookup, "MIDTRANS_SANDBOX"),
            midtrans_qris_acquirer,
            production,
            api_secret,
            redis_url: lookup("OZ_REDIS_URL").filter(|s| !s.is_empty()),
            admin_email,
            smtp_host,
            smtp_port,
            smtp_user,
            smtp_password,
            smtp_from,
        })
    }

    /// Return an `SmtpConfig` if `smtp_host` is configured.
    pub fn alert_smtp_config(&self) -> Option<kasirmu_core::export::email_report::SmtpConfig> {
        self.smtp_host
            .as_ref()
            .map(|host| kasirmu_core::export::email_report::SmtpConfig {
                host: host.clone(),
                port: self.smtp_port,
                username: self.smtp_user.clone(),
                password: self.smtp_password.clone(),
                from: self.smtp_from.clone(),
                use_tls: self.smtp_port == 465,
            })
    }
}

/// Parse a boolean variable from an injectable lookup — the primitive
/// [`CloudServerConfig::from_lookup`] is built from.
///
/// Returns `true` for `"1"`, `"true"` (case-insensitive), or `"on"`
/// (case-insensitive). Everything else (including unset) returns `false`.
fn env_bool_via(lookup: &impl Fn(&str) -> Option<String>, name: &str) -> bool {
    lookup(name)
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

/// Warn when a production build will run with plan gating OFF.
///
/// `OZ_ENFORCE_PLANS` is an ordinary `env_bool`, so an unset (or misspelled,
/// or `0`/`false`) value disables the sync plan gate entirely. That is the
/// correct default for development — the flag exists so dev and test keep
/// working — but in production it silently turns a paid feature boundary into
/// an open one, and the failure is invisible: every request succeeds.
///
/// **Warned, never refused.** `validate_production` deliberately refuses only
/// the two credentials whose absence is an open door (`OZ_API_SECRET`,
/// `OZ_ADMIN_KEY`); refusing here would break a legitimate production
/// deployment that has not started selling plans yet, which is not this
/// file's call. The warning names the exact variable so an operator reading
/// startup logs can see the gate is open.
/// The RULE behind [`warn_plan_gating_disabled`], split out so a test can pin it.
///
/// Separating the predicate from the `tracing::warn!` call is deliberate: a test
/// that observes a log line is testing the subscriber wiring, not the rule. This
/// function is the whole decision, and the warning above it is just the side
/// effect of it being true.
const fn should_warn_plan_gating_disabled(production: bool, enforce_plans: bool) -> bool {
    production && !enforce_plans
}

fn warn_plan_gating_disabled(production: bool, enforce_plans: bool) {
    if should_warn_plan_gating_disabled(production, enforce_plans) {
        tracing::warn!(
            "OZ_ENFORCE_PLANS is not enabled while OZ_PRODUCTION=1: the sync plan gate is OPEN, so tenants on the free plan (or with no plan row) are NOT rejected. Set OZ_ENFORCE_PLANS=1 to enforce it. Warned, not refused: a production deployment that has not started selling plans yet is legitimate."
        );
    }
}
/// Parse a positive integer from an injectable lookup.
///
/// Returns `default` when the variable is unset, empty, or not a positive
/// integer — the pool must always have at least one connection.
fn env_usize_via(lookup: &impl Fn(&str) -> Option<String>, name: &str, default: usize) -> usize {
    parse_usize(lookup(name).as_deref().unwrap_or(""), default)
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
