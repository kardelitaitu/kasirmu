/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean
next: none | perf: N/A
*/
//! TCP (raw / port 9100) connection helpers for network receipt printers.
//!
//! Many POS receipt printers (Epson TM-i series, Star mC-Print3, Bixolon)
//! support direct TCP printing on port 9100 ("raw protocol"). Data written
//! to the socket is interpreted as ESC/POS commands.

use std::time::Duration;

use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::error::HalError;

/// Default TCP port for raw ESC/POS printing.
pub const RAW_PORT: u16 = 9100;

/// Default connection timeout in seconds.
pub const CONNECT_TIMEOUT_SECS: u64 = 5;

/// Open a TCP connection to a receipt printer at the given address.
///
/// `addr` can be an IP address (`"192.168.1.100"`) or a hostname
/// (`"printer.local"`). Uses port 9100 by default; specify a custom
/// port with `"host:port"` syntax.
pub async fn connect(addr: &str) -> Result<TcpStream, HalError> {
    let full_addr = if addr.contains(':') {
        addr.to_owned()
    } else {
        format!("{addr}:{RAW_PORT}")
    };

    timeout(
        Duration::from_secs(CONNECT_TIMEOUT_SECS),
        TcpStream::connect(&full_addr),
    )
    .await
    .map_err(|_| HalError::Timeout(CONNECT_TIMEOUT_SECS as u32 * 1000))?
    .map_err(|e| HalError::NotFound(format!("cannot connect to printer at {full_addr}: {e}")))
}

/// Write ESC/POS data to a TCP stream and flush.
pub async fn write_all(stream: &mut TcpStream, data: &[u8]) -> Result<(), HalError> {
    use tokio::io::AsyncWriteExt;

    timeout(Duration::from_secs(10), stream.write_all(data))
        .await
        .map_err(|_| HalError::Timeout(10_000))?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::ConnectionReset
                || e.kind() == std::io::ErrorKind::ConnectionAborted
            {
                HalError::Disconnected
            } else {
                HalError::Io(e)
            }
        })?;

    stream.flush().await.map_err(HalError::Io)?;

    Ok(())
}

#[cfg(test)]
#[path = "tcp_tests.rs"]
mod tests;
