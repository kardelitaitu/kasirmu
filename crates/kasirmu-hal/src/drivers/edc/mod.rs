/*
last audited 31-08-26 by DSH-Agent (moved in from oz-payment during the HAL unification)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: every driver here is a PLANNED stub — construction records configuration and every operation fails closed with HalError::Unsupported, so there is no I/O path to review yet. Correcting a claim carried in the source module's docs: the wired and wireless drivers were described as having "their own transport" duplicating HAL. They do not — port_name, baud_rate and target are all dead fields behind #[allow(dead_code)], and nothing was ever opened. The mock lives in super::mock per the mandatory-mock rule, not in a per-driver mock.rs.
next: real vendor protocol handlers, then registry-driven registration from the edc_terminals table | perf: N/A
*/
//! EDC card-payment terminal drivers.
//!
//! Concrete drivers for the [`EdcTerminal`](crate::traits::edc::EdcTerminal)
//! trait: [`WiredEdcTerminal`] for serial/USB-linked terminals and
//! [`WirelessEdcTerminal`] for Bluetooth or network ones.
//!
//! [`protocol`] isolates the vendor wire format (Ingenico Telium, Verifone
//! Verix, PAX DCC) from the transport, so a driver only ever deals with
//! encoded bytes in and decoded [`ProtocolMessage`]s out.
//!
//! **All drivers in this module are stubs.** They construct, report their
//! configured identity, and return [`HalError::Unsupported`](crate::error::HalError::Unsupported)
//! for every operation — deliberately fail-closed so an unimplemented
//! terminal can never be mistaken for one that approved a card.

pub mod protocol;
pub mod wired;
pub mod wireless;

pub use protocol::{
    ProtocolCodec, ProtocolMessage, ingenico::IngenicoCodec, pax::PaxCodec, verifone::VerifoneCodec,
};
pub use wired::WiredEdcTerminal;
pub use wireless::{WirelessEdcTerminal, WirelessTarget};

use crate::error::HalError;

/// Build the fail-closed error every unimplemented driver method returns.
///
/// Mirrors [`protocol::stub_error`] so a stubbed operation reads the same
/// whichever layer it failed in, and so no driver can accidentally return
/// `Ok` for work it does not do.
pub(crate) fn stub_error(driver: &str, method: &str) -> HalError {
    HalError::Unsupported(format!(
        "{driver} EDC terminal `{method}` — PLANNED, not implemented yet"
    ))
}
