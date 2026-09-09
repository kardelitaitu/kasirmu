//! Service health contracts — what a status means, and what differs from
//! an outage.
//!
//! The app already probes some of this. `ping_license_server` asks the
//! license server `/api/health`, `sync_client::ping` asks the sync server,
//! and `StatusBar` renders dots for both. What none of them do is answer
//! the question the todo item asks: **what state is this service in, and is
//! that state the same as being down?** Today `ping_license_server` reduces
//! the server's answer to `resp.status().is_success()`, and the server
//! returns `503` with a full JSON body whenever its database is
//! unreachable — so "the server is up and told me a subsystem is broken"
//! and "there is no server" arrive at the UI as one indistinguishable red
//! dot. That collapse is the thing this module exists to prevent.
//!
//! Key types: [`ServiceKind`] (the four services the contract covers),
//! [`HealthState`] (the shared vocabulary every probe must answer in), and
//! [`LicenseHealthBody`] (the server's own payload, typed). Entry point for
//! the license server: [`classify_license_health`].
//!
//! Invariants:
//!
//! - **Pure.** No network, no clock, no database. Classification takes the
//!   status code and the body it already has, so every branch is testable
//!   without a server — which matters because the interesting branches are
//!   exactly the ones a live probe cannot be pointed at on demand.
//! - **A body is evidence; a status code alone is not a cause.** A non-2xx
//!   carrying a parsable health payload means the service is talking. It is
//!   [`HealthState::Degraded`], not `Unavailable`.
//! - **`Unknown` never outranks a known state when aggregating.** A service
//!   nobody probed must not make the whole product look broken; if `Unknown`
//!   were worst, the rollup would be dominated by whichever probe had not
//!   run yet, which is an artifact of polling order.
//! - **`Degraded` is not a warning to suppress.** It is a distinct state
//!   with a distinct operator action, so it must not be folded into either
//!   neighbour to simplify a colour scale.

use serde::Deserialize;

/// A service the health contract covers.
///
/// The four are the ones `todo-global-saas-3.md` names. They are not the
/// four that happen to be probeable today — payment and device connectivity
/// have no probe yet — and recording the set before every member has an
/// implementation is deliberate: the gap is then visible in the type rather
/// than hidden by omitting it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ServiceKind {
    /// The license/auth server (`https://license.ozpos.my.id`).
    LicenseServer,
    /// The cloud sync service.
    Sync,
    /// Payment processing (QRIS / Midtrans / Paddle / Stripe / Square).
    Payment,
    /// Reachability and freshness of a bound terminal device.
    DeviceConnectivity,
}

impl ServiceKind {
    /// Stable wire key. Snake_case, matching the reason codes in
    /// [`crate::availability`] rather than the camelCase the ping DTOs use,
    /// because this key is meant to be persisted and compared.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LicenseServer => "license_server",
            Self::Sync => "sync",
            Self::Payment => "payment",
            Self::DeviceConnectivity => "device_connectivity",
        }
    }

    /// Parse a stored key. Returns `None` for anything unrecognised — an
    /// unknown service is never silently folded into a known one.
    pub fn parse(key: &str) -> Option<Self> {
        match key {
            "license_server" => Some(Self::LicenseServer),
            "sync" => Some(Self::Sync),
            "payment" => Some(Self::Payment),
            "device_connectivity" => Some(Self::DeviceConnectivity),
            _ => None,
        }
    }

    /// Every service, in the order the item lists them.
    pub const ALL: [ServiceKind; 4] = [
        Self::LicenseServer,
        Self::Sync,
        Self::Payment,
        Self::DeviceConnectivity,
    ];
}

/// The state a service is in.
///
/// Serializes snake_case, matching [`HealthState::as_str`], so the wire key
/// and the persisted key cannot drift apart. Deserializing is required by the
/// desktop's `AuthPingResult`, which derives both halves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthState {
    /// Answering, and every subsystem it reports is fine.
    Operational,
    /// Answering, and told us something is broken. Reachable, not healthy.
    Degraded,
    /// Did not answer, or answered in a way that carries no usable signal.
    Unavailable,
    /// Not probed, or probed too long ago to call it either way.
    Unknown,
}

impl HealthState {
    /// Stable wire key.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Operational => "operational",
            Self::Degraded => "degraded",
            Self::Unavailable => "unavailable",
            Self::Unknown => "unknown",
        }
    }

    /// Parse a stored key. `None` for anything unrecognised.
    pub fn parse(key: &str) -> Option<Self> {
        match key {
            "operational" => Some(Self::Operational),
            "degraded" => Some(Self::Degraded),
            "unavailable" => Some(Self::Unavailable),
            "unknown" => Some(Self::Unknown),
            _ => None,
        }
    }

    /// Every state, worst last.
    pub const ALL: [HealthState; 4] = [
        Self::Operational,
        Self::Degraded,
        Self::Unavailable,
        Self::Unknown,
    ];

    /// Severity for aggregation. Lower is worse.
    ///
    /// `Unavailable` outranks `Degraded`: a service that is not answering at
    /// all is the more urgent condition, and the operator actions differ
    /// (check connectivity vs check a named subsystem).
    ///
    /// `Unknown` is ranked **best**, not worst, and that ordering is load
    /// bearing. Aggregation answers "what is the worst thing we actually
    /// know?" — if `Unknown` were worst, a rollup taken before the slowest
    /// probe returned would report the least alarming state available, and
    /// the banner would flicker with polling order instead of with health.
    /// Absence of evidence is not evidence of failure; it is reported as its
    /// own state on the row that has it, never as a verdict on the others.
    pub fn severity_rank(self) -> u8 {
        match self {
            Self::Unavailable => 0,
            Self::Degraded => 1,
            Self::Operational => 2,
            Self::Unknown => 3,
        }
    }

    /// The worse of two states, by [`Self::severity_rank`].
    pub fn worst(self, other: Self) -> Self {
        if self.severity_rank() <= other.severity_rank() {
            self
        } else {
            other
        }
    }

    /// Whether the service can currently do its job at all.
    ///
    /// `Degraded` counts as usable and that is intentional: the license
    /// server with an unreachable database still verifies a signature against
    /// a cached key, and treating that as a hard stop would take a POS
    /// terminal offline over a condition the till can work through.
    /// Degraded means "reduce what you rely on", not "stop".
    pub fn is_usable(self) -> bool {
        matches!(self, Self::Operational | Self::Degraded)
    }
}

/// Aggregate a set of per-service states into one rollup.
///
/// Returns [`HealthState::Unknown`] for an empty set — nothing probed is not
/// the same as everything fine.
pub fn aggregate(states: &[HealthState]) -> HealthState {
    states
        .iter()
        .copied()
        .reduce(|acc, s| acc.worst(s))
        .unwrap_or(HealthState::Unknown)
}

/// A configured-boolean gate block: `rsa` and `discord` in the server's
/// payload. Both are informational — the server's own comment is explicit
/// that these are "STATUS, not liveness" and never fail the HTTP check.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ConfiguredGate {
    /// Whether the credential or webhook is present.
    pub configured: bool,
}

/// The `smtp` block: sender-identity probe result, cached server-side for
/// 60s so a health poll cannot hammer the relay.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SmtpGate {
    /// Whether SMTP is configured at all.
    pub configured: bool,
    /// Whether the relay accepted the identity. Transient relay hiccups
    /// report `false` with a warning-style `error`, which is why this is not
    /// collapsed into a single boolean.
    pub verified: bool,
    /// Relay error text, empty when clean.
    #[serde(default)]
    pub error: String,
}

/// A pricing-gate block: `paddle` and `midtrans` share this shape apart from
/// the name of their credential field, which is why the credential is read
/// by each variant rather than unified — the two names are different facts
/// (a webhook secret vs a server key), and flattening them into one field
/// would lose which provider is misconfigured.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PricingGate {
    /// Whether the tier map parsed.
    #[serde(default)]
    pub price_tiers_configured: bool,
    /// How many tiers it maps. Zero with `price_tiers_configured: true` is a
    /// real and distinct state: configured, but mapping nothing.
    #[serde(default)]
    pub price_tiers_mappings: i64,
    /// Parse error text, empty when clean.
    #[serde(default)]
    pub error: String,
}

/// The license server's `/api/health` payload.
///
/// Every field except `status` and `db_connected` is `#[serde(default)]` so
/// an older server that omits a newer block still classifies. That tolerance
/// is one-directional on purpose: a missing block reads as absent, never as
/// healthy, so a server predating the gate cannot be reported as passing it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct LicenseHealthBody {
    /// `"ok"` or `"degraded"` as the server names it.
    pub status: String,
    /// Whether the server's own `SELECT 1` succeeded.
    pub db_connected: bool,
    /// Database error text, empty when connected.
    #[serde(default)]
    pub db_error: String,
    /// Sender-identity block, absent on older servers.
    #[serde(default)]
    pub smtp: Option<SmtpGate>,
    /// Paddle pricing gate, absent on older servers.
    #[serde(default)]
    pub paddle: Option<PaddleGate>,
    /// Midtrans pricing gate — the payment-provider signal, absent on older
    /// servers.
    #[serde(default)]
    pub midtrans: Option<MidtransGate>,
    /// License-signing key block.
    #[serde(default)]
    pub rsa: Option<ConfiguredGate>,
    /// Support-webhook block.
    #[serde(default)]
    pub discord: Option<ConfiguredGate>,
    /// Server uptime in whole seconds.
    #[serde(default)]
    pub uptime_secs: i64,
}

/// The `paddle` block.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PaddleGate {
    /// Whether the webhook secret is present.
    #[serde(default)]
    pub secret_configured: bool,
    /// Whether the tier map parsed.
    #[serde(default)]
    pub price_tiers_configured: bool,
    /// How many tiers it maps.
    #[serde(default)]
    pub price_tiers_mappings: i64,
    /// Parse error text, empty when clean.
    #[serde(default)]
    pub error: String,
}

/// The `midtrans` block.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct MidtransGate {
    /// Whether the server key is present.
    #[serde(default)]
    pub server_key_configured: bool,
    /// Whether the tier map parsed.
    #[serde(default)]
    pub price_tiers_configured: bool,
    /// How many tiers it maps.
    #[serde(default)]
    pub price_tiers_mappings: i64,
    /// Parse error text, empty when clean.
    #[serde(default)]
    pub error: String,
}

impl LicenseHealthBody {
    /// The named subsystems that are broken, in payload order.
    ///
    /// Only the database can make the server itself unhealthy — the other
    /// gates are informational by the server's own design — so this lists
    /// them as *detail*, and the caller decides how much to surface. A gate
    /// block that is absent is not reported as broken: an older server simply
    /// does not have it.
    pub fn broken_subsystems(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        if !self.db_connected {
            out.push("database");
        }
        if let Some(smtp) = &self.smtp {
            if smtp.configured && !smtp.verified {
                out.push("smtp");
            }
        }
        if let Some(p) = &self.paddle {
            if !p.secret_configured || !p.price_tiers_configured {
                out.push("paddle");
            }
        }
        if let Some(m) = &self.midtrans {
            if !m.server_key_configured || !m.price_tiers_configured {
                out.push("midtrans");
            }
        }
        if self.rsa.as_ref().is_some_and(|g| !g.configured) {
            out.push("rsa");
        }
        out
    }
}

/// Classify a license-server health response.
///
/// `body` is the parsed payload, or `None` when the response was not parsable
/// health JSON. The status code alone cannot tell a degraded server from a
/// dead one, which is the whole point: the server answers `503` *with* a body
/// when it is up and its database is not, and answers nothing when it is not.
///
/// Returns the state plus a short human-readable cause for the row.
pub fn classify_license_health(
    status: u16,
    body: Option<&LicenseHealthBody>,
) -> (HealthState, Option<String>) {
    match body {
        // The server talked. Trust what it said over what the status code
        // implies, including on 2xx: a server that returns 200 while
        // reporting `degraded` is degraded.
        Some(parsed) => {
            let broken = parsed.broken_subsystems();
            if parsed.status == "ok" && broken.is_empty() {
                (HealthState::Operational, None)
            } else {
                let cause = if broken.is_empty() {
                    format!("server reported {}", parsed.status)
                } else {
                    broken.join(", ")
                };
                (HealthState::Degraded, Some(cause))
            }
        }
        // No usable signal. A 2xx with an unparsable body is still a service
        // we cannot read, so it is Unavailable rather than a guess at ok.
        None => (
            HealthState::Unavailable,
            Some(format!("no health payload (HTTP {status})")),
        ),
    }
}

#[cfg(test)]
#[path = "service_health_tests.rs"]
mod tests;
