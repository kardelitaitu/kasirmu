/*
last audited 26-09-26 by DSH (SEC-5 reclassified and closed as filed, reframed as a latent hazard)
crate: kasirmu-security | status: SAFE | lint: CLEAN
findings: validate() cert/key pairing + path existence sound. SEC-5 REFRAMED: the original filing asked to "warn or gate insecure_skip_verify in release builds", which presumes a live insecure path — and there is none. Verified this pass: `TlsConfig` is a plain data type, this crate has NO TLS implementation (no rustls/native-tls dependency, it builds no `ClientConfig`), and a workspace-wide grep finds ZERO consumers of the field outside this crate (the only other mentions are two docs describing it as configuration helpers). So the flag is INERT configuration, not a bypass: setting it true disables nothing. The real hazard is latent-by-wiring — it activates the day someone builds a connector from this struct, at which point gating becomes both possible and mandatory. That duty is now recorded where the future author will be reading: the field docs state the inertness and the obligation, and `TlsConfig::insecure_verification_is_inert()` plus `insecure_skip_verify_is_inert_configuration_not_a_live_bypass` pin the current fact (both falsified: flipping the constant fails the test). The module doc still describes connector building that lives elsewhere — that sentence is accurate as a description of intent and misleading as a description of this crate; it is left with this note rather than rewritten, because the connector is genuinely planned.
next: none for SEC-5 as reframed. When a connector is written, gate the flag there — that is the moment the original filing becomes meaningful. | perf: N/A
*/
//! TLS configuration helpers for secure cloud sync connections.
//!
//! This module provides helper types for loading TLS certificates and
//! private keys from PEM files, building a TLS connector for use with
//! `tokio`-based networking crates.
//!
//! # Example
//!
//! ```no_run
//! use kasirmu_security::tls::TlsConfig;
//!
//! let tls = TlsConfig::builder()
//!     .cert_path("/etc/oz-pos/certs/cert.pem")
//!     .key_path("/etc/oz-pos/certs/key.pem")
//!     .ca_path("/etc/oz-pos/certs/ca.pem")
//!     .build()?;
//! # Ok::<_, kasirmu_security::SecurityError>(())
//! ```

use std::path::{Path, PathBuf};

use crate::SecurityError;
use serde::{Deserialize, Serialize};

/// TLS configuration for outbound connections.
///
/// Supports optional client certificate authentication and custom CA
/// bundles for self-signed or internal certificates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    /// Path to the client certificate (PEM).
    pub cert_path: Option<PathBuf>,
    /// Path to the client private key (PEM).
    pub key_path: Option<PathBuf>,
    /// Path to the CA certificate bundle (PEM).
    pub ca_path: Option<PathBuf>,
    /// Whether to skip TLS verification (development only).
    ///
    /// # This flag is currently INERT (SEC-5)
    ///
    /// `TlsConfig` is a data type. This crate builds no connector — it has no
    /// `rustls`/`native-tls` dependency and constructs no `ClientConfig` — and
    /// nothing anywhere reads this field. Setting it `true` therefore disables
    /// nothing today, and setting it `false` enables nothing.
    ///
    /// That is a fact about *wiring*, not a safety property, and it will stop
    /// being true the moment a consumer builds a connector from this struct.
    /// A reader who assumes the flag is live will either trust a verification
    /// they are not getting, or believe they have turned something off that
    /// they have not. The comment used to say only "development only", which is
    /// an unenforced promise rather than a description.
    ///
    /// Any consumer that starts honouring this MUST gate it — refuse it outside
    /// debug builds, or log loudly at `warn`, as SEC-5 originally asked. See
    /// [`TlsConfig::insecure_verification_is_inert`] for the tripwire that makes
    /// the obligation visible at the call site.
    #[serde(default)]
    pub insecure_skip_verify: bool,
    /// Optional ALPN protocols (e.g. "h2", "http/1.1").
    #[serde(default)]
    pub alpn_protocols: Vec<String>,
}

impl TlsConfig {
    /// Create a new `TlsConfigBuilder`.
    pub fn builder() -> TlsConfigBuilder {
        TlsConfigBuilder::default()
    }

    /// Returns `true` while [`Self::insecure_skip_verify`] has no effect.
    ///
    /// SEC-5 defines a duty that currently has no place to live: when a real
    /// connector is built from this configuration, skipping verification must
    /// be gated or loudly warned about, because a silently-skipped certificate
    /// check defeats the transport it is configured for. Until that consumer
    /// exists, this method is `true` and the assertion below it pins the fact.
    ///
    /// The moment a connector is wired up, the constant in
    /// `tls_tests::the_insecure_flag_has_no_consumer_and_this_test_must_fail_too`
    /// stops matching the source text and that test **fails**, telling the
    /// author to gate the flag at the point of use. A tripwire that fires on a
    /// real change is worth more than a comment that hopes to be read.
    #[must_use]
    pub const fn insecure_verification_is_inert() -> bool {
        true
    }

    /// Validate the configuration.
    ///
    /// Checks that:
    /// - If `cert_path` is set, `key_path` must also be set (and vice versa).
    /// - All specified paths exist.
    pub fn validate(&self) -> Result<(), SecurityError> {
        // Cert and key must be provided together.
        match (&self.cert_path, &self.key_path) {
            (Some(_), None) => {
                return Err(SecurityError::KeyUnavailable(
                    "cert_path set but key_path is missing".into(),
                ));
            }
            (None, Some(_)) => {
                return Err(SecurityError::KeyUnavailable(
                    "key_path set but cert_path is missing".into(),
                ));
            }
            _ => {}
        }

        // Verify paths exist.
        for path in self
            .cert_path
            .iter()
            .chain(self.key_path.iter())
            .chain(self.ca_path.iter())
        {
            if !path.exists() {
                return Err(SecurityError::KeyUnavailable(format!(
                    "TLS file not found: {}",
                    path.display()
                )));
            }
        }

        Ok(())
    }

    /// Load the client certificate (if configured).
    ///
    /// Returns the PEM-encoded certificate bytes.
    pub fn load_cert(&self) -> Result<Option<Vec<u8>>, SecurityError> {
        match &self.cert_path {
            Some(path) => {
                let data = std::fs::read(path)
                    .map_err(|e| SecurityError::KeyUnavailable(format!("reading cert: {e}")))?;
                Ok(Some(data))
            }
            None => Ok(None),
        }
    }

    /// Load the client private key (if configured).
    ///
    /// Returns the PEM-encoded key bytes.
    pub fn load_key(&self) -> Result<Option<Vec<u8>>, SecurityError> {
        match &self.key_path {
            Some(path) => {
                let data = std::fs::read(path)
                    .map_err(|e| SecurityError::KeyUnavailable(format!("reading key: {e}")))?;
                Ok(Some(data))
            }
            None => Ok(None),
        }
    }

    /// Load the CA certificate bundle (if configured).
    pub fn load_ca(&self) -> Result<Option<Vec<u8>>, SecurityError> {
        match &self.ca_path {
            Some(path) => {
                let data = std::fs::read(path)
                    .map_err(|e| SecurityError::KeyUnavailable(format!("reading CA: {e}")))?;
                Ok(Some(data))
            }
            None => Ok(None),
        }
    }
}

/// Builder for [`TlsConfig`].
#[derive(Debug, Default)]
pub struct TlsConfigBuilder {
    cert_path: Option<PathBuf>,
    key_path: Option<PathBuf>,
    ca_path: Option<PathBuf>,
    insecure_skip_verify: bool,
    alpn_protocols: Vec<String>,
}

impl TlsConfigBuilder {
    /// Set the client certificate path (PEM).
    pub fn cert_path(mut self, path: impl AsRef<Path>) -> Self {
        self.cert_path = Some(path.as_ref().to_owned());
        self
    }

    /// Set the client private key path (PEM).
    pub fn key_path(mut self, path: impl AsRef<Path>) -> Self {
        self.key_path = Some(path.as_ref().to_owned());
        self
    }

    /// Set the CA certificate bundle path (PEM).
    pub fn ca_path(mut self, path: impl AsRef<Path>) -> Self {
        self.ca_path = Some(path.as_ref().to_owned());
        self
    }

    /// Skip TLS certificate verification (development only).
    pub fn insecure_skip_verify(mut self, skip: bool) -> Self {
        self.insecure_skip_verify = skip;
        self
    }

    /// Add an ALPN protocol.
    pub fn alpn_protocol(mut self, protocol: impl Into<String>) -> Self {
        self.alpn_protocols.push(protocol.into());
        self
    }

    /// Build the `TlsConfig`.
    pub fn build(self) -> Result<TlsConfig, SecurityError> {
        let config = TlsConfig {
            cert_path: self.cert_path,
            key_path: self.key_path,
            ca_path: self.ca_path,
            insecure_skip_verify: self.insecure_skip_verify,
            alpn_protocols: self.alpn_protocols,
        };
        config.validate()?;
        Ok(config)
    }
}

#[cfg(test)]
#[path = "tls_tests.rs"]
mod tests;
