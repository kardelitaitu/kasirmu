//! LAN discovery via mDNS/DNS-SD.
//!
//! [`LanDiscoverer`] advertises an OZ-POS terminal on the local network
//! using mDNS so that other terminals (e.g. a KDS tablet) can find it
//! without manual IP configuration.
//!
//! # Service type
//!
//! Service type: `_oz-pos._tcp.local.`
//!
//! TXT records published:
//! - `terminal_id` — unique identifier for this terminal
//! - `role` — terminal role (e.g. `counter_pos`, `kds_kiosk`)
//! - `tcp_port` — the TCP port the terminal's sync/event server listens on
//!
//! # Example
//!
//! ```ignore
//! use kasirmu_core::sync::lan_discovery::LanDiscoverer;
//!
//! let mut discoverer = LanDiscoverer::new("term-1", "counter_pos", 9180);
//! discoverer.start().expect("start mDNS advertising");
//! // ... application runs ...
//! discoverer.stop().expect("stop mDNS advertising");
//! ```

use mdns_sd::{ServiceDaemon, ServiceInfo};

/// The mDNS service type advertised by all OZ-POS terminals.
const SERVICE_TYPE: &str = "_oz-pos._tcp.local.";

/// Advertises an OZ-POS terminal on the LAN via mDNS/DNS-SD.
///
/// Create one per application lifetime, call [`start()`](Self::start) to
/// begin advertising, and [`stop()`](Self::stop) on shutdown.
///
/// The struct is **not** `Clone` — the underlying `ServiceDaemon` handle
/// is owned and dropped when the discoverer is dropped.
pub struct LanDiscoverer {
    /// Unique terminal identifier.
    terminal_id: String,
    /// Terminal role (e.g. `"counter_pos"`, `"kds_kiosk"`, `"unrestricted"`).
    role: String,
    /// TCP port the terminal's event/sync server listens on.
    tcp_port: u16,
    /// Optional mDNS daemon handle. `Some` when advertising is active.
    daemon: Option<ServiceDaemon>,
}

// `ServiceDaemon` does not implement `Debug`, so we implement it manually.
impl std::fmt::Debug for LanDiscoverer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LanDiscoverer")
            .field("terminal_id", &self.terminal_id)
            .field("role", &self.role)
            .field("tcp_port", &self.tcp_port)
            .field("daemon", &self.daemon.as_ref().map(|_| "<ServiceDaemon>"))
            .finish()
    }
}

impl LanDiscoverer {
    /// Create a new `LanDiscoverer` without starting advertising.
    ///
    /// Call [`start()`](Self::start) to begin broadcasting on the LAN.
    pub fn new(terminal_id: impl Into<String>, role: impl Into<String>, tcp_port: u16) -> Self {
        Self {
            terminal_id: terminal_id.into(),
            role: role.into(),
            tcp_port,
            daemon: None,
        }
    }

    /// Start advertising this terminal via mDNS on the LAN.
    ///
    /// Spawns a background mDNS daemon thread and registers the
    /// `_oz-pos._tcp.local.` service with TXT records containing
    /// `terminal_id`, `role`, and `tcp_port`.
    ///
    /// Returns an error if the daemon cannot be created or the
    /// service registration fails.
    pub fn start(&mut self) -> Result<(), String> {
        // Prevent double-start.
        if self.daemon.is_some() {
            return Ok(());
        }

        let daemon =
            ServiceDaemon::new().map_err(|e| format!("failed to create mDNS daemon: {e}"))?;

        let service_info = self.build_service_info()?;

        daemon
            .register(service_info)
            .map_err(|e| format!("failed to register mDNS service: {e}"))?;

        tracing::info!(
            terminal_id = %self.terminal_id,
            role = %self.role,
            tcp_port = %self.tcp_port,
            "mDNS advertising started"
        );

        self.daemon = Some(daemon);
        Ok(())
    }

    /// Stop advertising this terminal and shut down the mDNS daemon.
    ///
    /// This is idempotent — calling it when advertising is not active
    /// is a no-op.
    pub fn stop(&mut self) -> Result<(), String> {
        if let Some(daemon) = self.daemon.take() {
            daemon
                .shutdown()
                .map_err(|e| format!("failed to shut down mDNS daemon: {e}"))?;

            tracing::info!(
                terminal_id = %self.terminal_id,
                "mDNS advertising stopped"
            );
        }
        Ok(())
    }

    /// Returns `true` if the discoverer is currently advertising.
    pub fn is_running(&self) -> bool {
        self.daemon.is_some()
    }

    /// Build the `ServiceInfo` for this terminal.
    fn build_service_info(&self) -> Result<ServiceInfo, String> {
        // Instance name: use terminal_id as the unique instance name.
        let instance_name = &self.terminal_id;

        // Hostname: use a `.local.` name derived from terminal_id.
        let host_name = format!("{}.local.", self.terminal_id);

        // TXT records with terminal metadata.
        let properties: &[(&str, &str)] = &[
            ("terminal_id", &self.terminal_id),
            ("role", &self.role),
            ("tcp_port", &self.tcp_port.to_string()),
        ];

        let mut info = ServiceInfo::new(
            SERVICE_TYPE,
            instance_name,
            &host_name,
            "", // empty — enable_addr_auto will fill in the IP
            self.tcp_port,
            properties,
        )
        .map_err(|e| format!("invalid service info: {e}"))?;

        info = info.enable_addr_auto();
        Ok(info)
    }
}

#[cfg(test)]
#[path = "lan_discovery_tests.rs"]
mod tests;
