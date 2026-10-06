//! Headless LAN client for connecting to a kasir.mu primary POS / LAN forwarder.
//!
//! Connects via `Noise_XXpsk3` (when PSK configured) or plain cleartext, sends
//! discovery requests, auto-reconnects on disconnection with exponential backoff,
//! and yields incoming domain events ([`crate::TableSyncEvent`], [`crate::KdsSyncEvent`],
//! [`crate::KdsDiscoverResponse`], or raw JSON).

use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{broadcast, mpsc, watch};

use crate::KdsDiscoverResponse;
use crate::crdt_sync::{CRDT_EVENT_TAG_PREFIX, CrdtSyncEvent};
use crate::kds_sync::{KDS_EVENT_TAG_PREFIX, KdsSyncEvent};
use crate::noise::{noise_handshake_initiator, read_frame, write_frame};
use crate::table_sync::{TABLE_EVENT_TAG_PREFIX, TableSyncEvent};

/// Configuration for a LAN peer client connection.
#[derive(Debug, Clone)]
pub struct LanClientConfig {
    /// Server address to dial (e.g. `"192.168.1.50:9180"` or `"127.0.0.1:9180"`).
    pub server_addr: String,
    /// Pre-shared key for Noise_XXpsk3 transport. `None` connects using cleartext.
    pub psk: Option<String>,
    /// Unique identifier of this tablet/terminal for device-keyed replay on reconnect.
    pub device_id: Option<String>,
    /// Kitchen stations this terminal is interested in (empty = receive all).
    pub station_ids: Vec<String>,
    /// Whether to request an active KDS queue snapshot in the discovery request.
    pub want_queue: bool,
    /// Whether to request table states snapshot in the discovery request.
    pub want_tables: bool,
}

/// An incoming event received from the LAN server.
#[derive(Debug, Clone)]
pub enum LanEvent {
    /// Table occupancy / status transition event.
    Table(TableSyncEvent),
    /// Kitchen display system order / bump / recall event.
    Kds(KdsSyncEvent),
    /// CRDT offline mutation delta replication event.
    Crdt(CrdtSyncEvent),
    /// Discovery response received upon connecting.
    Discovery(KdsDiscoverResponse),
    /// Raw unparsed JSON line (e.g. `sale.completed`, `order.course_fired`).
    RawJson(String),
}

impl LanEvent {
    /// Parse an incoming wire line or decrypted text into a typed [`LanEvent`].
    pub fn parse(text: &str) -> Self {
        let trimmed = text.trim();
        if trimmed.starts_with(TABLE_EVENT_TAG_PREFIX) {
            if let Ok(ev) = serde_json::from_str::<TableSyncEvent>(trimmed) {
                return Self::Table(ev);
            }
        } else if trimmed.starts_with(KDS_EVENT_TAG_PREFIX) {
            if let Ok(ev) = serde_json::from_str::<KdsSyncEvent>(trimmed) {
                return Self::Kds(ev);
            }
        } else if trimmed.starts_with(CRDT_EVENT_TAG_PREFIX) {
            if let Ok(ev) = serde_json::from_str::<CrdtSyncEvent>(trimmed) {
                return Self::Crdt(ev);
            }
        }
        Self::RawJson(trimmed.to_string())
    }
}

/// Control handle for a running LAN client background task.
#[derive(Clone)]
pub struct LanClientHandle {
    shutdown_tx: Arc<watch::Sender<bool>>,
    uplink_tx: mpsc::Sender<String>,
}

impl LanClientHandle {
    /// Signal the client task to disconnect and stop reconnecting.
    pub fn stop(&self) {
        let _ = self.shutdown_tx.send(true);
    }

    /// Queue a message to send upstream to the primary LAN server.
    pub fn send(&self, msg: String) -> Result<(), mpsc::error::TrySendError<String>> {
        self.uplink_tx.try_send(msg)
    }

    /// Asynchronously send a message upstream to the primary LAN server.
    pub async fn send_async(&self, msg: String) -> Result<(), mpsc::error::SendError<String>> {
        self.uplink_tx.send(msg).await
    }
}

/// Spawn the auto-reconnecting LAN client daemon.
///
/// Returns a control handle and a broadcast receiver for incoming [`LanEvent`]s.
pub fn start_lan_client(
    config: LanClientConfig,
) -> (LanClientHandle, broadcast::Receiver<LanEvent>) {
    let (event_tx, event_rx) = broadcast::channel(256);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let (uplink_tx, uplink_rx) = mpsc::channel(256);
    let handle = LanClientHandle {
        shutdown_tx: Arc::new(shutdown_tx),
        uplink_tx,
    };

    tokio::spawn(run_client_loop(config, event_tx, shutdown_rx, uplink_rx));

    (handle, event_rx)
}

async fn run_client_loop(
    config: LanClientConfig,
    event_tx: broadcast::Sender<LanEvent>,
    mut shutdown_rx: watch::Receiver<bool>,
    mut uplink_rx: mpsc::Receiver<String>,
) {
    let mut backoff = Duration::from_millis(200);
    const MAX_BACKOFF: Duration = Duration::from_secs(5);

    while !*shutdown_rx.borrow() {
        tracing::debug!(server = %config.server_addr, "dialing LAN forwarder");

        match TcpStream::connect(&config.server_addr).await {
            Ok(stream) => {
                backoff = Duration::from_millis(200);
                tracing::info!(server = %config.server_addr, "connected to LAN forwarder");

                let run_result =
                    handle_connection(&config, stream, &event_tx, &mut shutdown_rx, &mut uplink_rx)
                        .await;
                if *shutdown_rx.borrow() {
                    tracing::info!(server = %config.server_addr, "LAN client stopped by shutdown signal");
                    break;
                }
                if let Err(e) = run_result {
                    tracing::warn!(server = %config.server_addr, error = %e, "LAN connection dropped");
                }
            }
            Err(e) => {
                tracing::debug!(server = %config.server_addr, error = %e, "LAN connection failed");
            }
        }

        if *shutdown_rx.borrow() {
            break;
        }

        // Exponential backoff sleep before reconnecting
        tokio::select! {
            _ = tokio::time::sleep(backoff) => {
                backoff = std::cmp::min(backoff * 2, MAX_BACKOFF);
            }
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    break;
                }
            }
        }
    }
}

async fn handle_connection(
    config: &LanClientConfig,
    stream: TcpStream,
    event_tx: &broadcast::Sender<LanEvent>,
    shutdown_rx: &mut watch::Receiver<bool>,
    uplink_rx: &mut mpsc::Receiver<String>,
) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream);

    let discover_msg = serde_json::json!({
        "op": "discover",
        "device_id": config.device_id,
        "station_ids": config.station_ids,
        "want_queue": config.want_queue,
        "want_tables": config.want_tables,
    });
    let discover_str = serde_json::to_string(&discover_msg)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    if let Some(psk) = &config.psk {
        // ── Noise transport ──
        let mut transport = noise_handshake_initiator(&mut reader, psk).await?;

        // Send discovery request frame
        let mut out = vec![0u8; discover_str.len() + 32];
        let n = transport
            .write_message(discover_str.as_bytes(), &mut out)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        write_frame(reader.get_mut(), &out[..n]).await?;

        // Read discovery response frame
        let resp_frame = read_frame(&mut reader).await?;
        let mut pt = vec![0u8; resp_frame.len()];
        let n = transport
            .read_message(&resp_frame, &mut pt)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        if let Ok(resp) = serde_json::from_slice::<KdsDiscoverResponse>(&pt[..n]) {
            let _ = event_tx.send(LanEvent::Discovery(resp));
        }

        // Continuous read and uplink loop
        loop {
            tokio::select! {
                biased;

                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        return Ok(());
                    }
                }

                Some(outgoing) = uplink_rx.recv() => {
                    let mut out = vec![0u8; outgoing.len() + 32];
                    let n = transport
                        .write_message(outgoing.as_bytes(), &mut out)
                        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
                    write_frame(reader.get_mut(), &out[..n]).await?;
                }

                frame_res = read_frame(&mut reader) => {
                    let frame = frame_res?;
                    let mut pt = vec![0u8; frame.len()];
                    let n = transport
                        .read_message(&frame, &mut pt)
                        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
                    let text = std::str::from_utf8(&pt[..n])
                        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
                    let trimmed = text.trim();
                    if trimmed.is_empty() || trimmed == r#"{"type":"ping"}"# {
                        continue;
                    }
                    let _ = event_tx.send(LanEvent::parse(trimmed));
                }
            }
        }
    } else {
        // ── Cleartext JSON transport ──
        let discover_line = format!("{discover_str}\n");
        reader.get_mut().write_all(discover_line.as_bytes()).await?;

        // Read discovery response line
        let mut resp_line = String::new();
        reader.read_line(&mut resp_line).await?;
        let trimmed = resp_line.trim();
        if let Ok(resp) = serde_json::from_str::<KdsDiscoverResponse>(trimmed) {
            let _ = event_tx.send(LanEvent::Discovery(resp));
        } else if !trimmed.is_empty() && trimmed != r#"{"type":"ping"}"# {
            let _ = event_tx.send(LanEvent::parse(trimmed));
        }

        loop {
            tokio::select! {
                biased;

                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        return Ok(());
                    }
                }

                Some(outgoing) = uplink_rx.recv() => {
                    let line = format!("{}\n", outgoing.trim());
                    reader.get_mut().write_all(line.as_bytes()).await?;
                }

                line_res = async {
                    let mut line = String::new();
                    let n = reader.read_line(&mut line).await?;
                    if n == 0 {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::UnexpectedEof,
                            "server closed connection",
                        ));
                    }
                    Ok(line)
                } => {
                    let line = line_res?;
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed == r#"{"type":"ping"}"# {
                        continue;
                    }
                    let _ = event_tx.send(LanEvent::parse(trimmed));
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
