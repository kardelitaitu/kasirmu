//! LAN peer discovery and sync transport.
//!
//! This module provides mDNS/DNS-SD service broadcasting so that
//! kasir.mu terminals can discover each other on the local network.

#[cfg(feature = "lan-mdns")]
pub mod lan_discovery;
