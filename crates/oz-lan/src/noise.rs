//! noise-psk-v1 transport: the encrypted LAN wire extracted from
//! `lib.rs` so the forwarder file stays within the house size limit.
//!
//! Owns the protocol selector byte, the `Noise_XXpsk3_25519_ChaChaPoly_SHA256`
//! responder handshake, the 4-byte length-prefixed frame codec, and the
//! [`PeerTx`] write surface (plain newline-delimited JSON vs encrypted
//! frames). Behaviour is byte-for-byte the original; `lib_tests.rs`
//! exercises it through `handle_peer`.

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use sha2::{Digest, Sha256};

/// Noise-PSK-v1 protocol selector byte. A peer whose first stream byte
/// is this value negotiates the encrypted transport; any other byte is
/// treated as the start of a legacy JSON hello.
pub(crate) const NOISE_MAGIC_BYTE: u8 = 0x01;

/// Noise handshake pattern for the `noise-psk-v1` LAN transport.
///
/// `XXpsk3` = mutual ephemeral key exchange with the pre-shared key
/// mixed into message 3: the PSK never crosses the wire, and a peer
/// without it cannot complete the handshake (unlike the legacy hello,
/// which sends the PSK in cleartext JSON — see the DC-1 note on
/// `psk_matches` in `lib.rs`).
pub(crate) const NOISE_PATTERN: &str = "Noise_XXpsk3_25519_ChaChaPoly_SHA256";

/// Maximum frame (ciphertext) size — the Noise protocol hard cap
/// (65535 bytes, enforced by snow's `write_message`/`read_message`).
pub(crate) const NOISE_MAX_FRAME: usize = 65535;

/// Derive the 32-byte Noise PSK from the configured passphrase.
///
/// snow requires exactly 32 bytes; SHA-256 expands the human-chosen
/// `lan_server.psk` setting deterministically so both ends derive the
/// same key from the shared secret without ever transmitting it.
pub(crate) fn noise_psk_bytes(psk: &str) -> [u8; 32] {
    Sha256::digest(psk.as_bytes()).into()
}

/// Derive the responder's Noise static private key from the PSK.
///
/// `XXpsk3` requires a responder static key (message 2 carries `s`).
/// Deriving it deterministically from the PSK — domain-separated from
/// [`noise_psk_bytes`] so the two 32-byte keys can never collide —
/// avoids persisting a key file for a LAN-only transport while still
/// binding each peer's advertised identity to the shared secret.
pub(crate) fn noise_static_secret(psk: &str) -> [u8; 32] {
    Sha256::digest(format!("oz-pos-lan-static|{psk}").as_bytes()).into()
}

/// Read one length-prefixed frame (4-byte big-endian length + payload).
pub(crate) async fn read_frame(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > NOISE_MAX_FRAME {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("frame too large: {len} > {NOISE_MAX_FRAME}"),
        ));
    }
    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).await?;
    Ok(buf)
}

/// Write one length-prefixed frame (4-byte big-endian length + payload).
pub(crate) async fn write_frame(stream: &mut TcpStream, data: &[u8]) -> std::io::Result<()> {
    stream.write_all(&(data.len() as u32).to_be_bytes()).await?;
    stream.write_all(data).await
}

/// Handshake step timed out.
fn handshake_timeout(step: &str) -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        format!("noise handshake {step} timed out"),
    )
}

/// Handshake step failed cryptographically or on the wire.
fn handshake_failed(step: &str, reason: impl std::fmt::Display) -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        format!("noise handshake {step} failed: {reason}"),
    )
}

/// Perform the server (responder) side of the noise-psk-v1 handshake.
///
/// Reads initiator message 1 (`-> e`), responds with message 2
/// (`<- e ee s es`), then authenticates message 3 (`-> s es psk3`),
/// where the PSK is mixed: a peer without the correct pre-shared key
/// fails here and is dropped, and the PSK itself never crosses the
/// wire. Every step is bounded by `PSK_HANDSHAKE_TIMEOUT_SECS`.
pub(crate) async fn noise_handshake_responder(
    stream: &mut TcpStream,
    psk: &str,
) -> std::io::Result<snow::TransportState> {
    let dur = std::time::Duration::from_secs(crate::PSK_HANDSHAKE_TIMEOUT_SECS);
    let params: snow::params::NoiseParams = NOISE_PATTERN
        .parse()
        .map_err(|e| handshake_failed("pattern", e))?;
    // Bound before the builder chain: `Builder<'builder>` keeps the key
    // references alive for its whole lifetime, so temporaries won't do.
    let static_secret = noise_static_secret(psk);
    let psk_bytes = noise_psk_bytes(psk);
    let mut hs = snow::Builder::new(params)
        .local_private_key(&static_secret)
        .map_err(|e| handshake_failed("static key", e))?
        .psk(3, &psk_bytes)
        .map_err(|e| handshake_failed("psk", e))?
        .build_responder()
        .map_err(|e| handshake_failed("responder init", e))?;
    let mut buf = vec![0u8; NOISE_MAX_FRAME];

    // Message 1: -> e
    let msg1 = match tokio::time::timeout(dur, read_frame(stream)).await {
        Ok(Ok(m)) => m,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(handshake_timeout("msg1 read")),
    };
    if let Err(e) = hs.read_message(&msg1, &mut buf) {
        return Err(handshake_failed("msg1", e));
    }

    // Message 2: <- e ee s es
    let n = hs
        .write_message(&[], &mut buf)
        .map_err(|e| handshake_failed("msg2", e))?;
    match tokio::time::timeout(dur, write_frame(stream, &buf[..n])).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(handshake_timeout("msg2 write")),
    }

    // Message 3: -> s es psk3 — the PSK authenticates the initiator
    // here; a wrong PSK fails the MAC check and the peer is dropped.
    let msg3 = match tokio::time::timeout(dur, read_frame(stream)).await {
        Ok(Ok(m)) => m,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(handshake_timeout("msg3 read")),
    };
    if let Err(e) = hs.read_message(&msg3, &mut buf) {
        return Err(handshake_failed("msg3 (bad PSK or tampering)", e));
    }

    hs.into_transport_mode()
        .map_err(|e| handshake_failed("transport switch", e))
}

/// Write surface for one authenticated peer session.
///
/// `Plain` preserves the original wire format (newline-delimited JSON).
/// `Noise` wraps each event in one encrypted frame — the frame boundary
/// replaces the newline, so the JSON payload inside a frame carries no
/// trailing `\n`. Events larger than [`NOISE_MAX_FRAME`] cannot be
/// encrypted as a single Noise message; the resulting write error is
/// treated like any delivery failure (the event is offline-buffered,
/// itself capped at `MAX_OFFLINE_BUFFER_PER_PEER`).
pub(crate) enum PeerTx {
    Plain(TcpStream),
    Noise(TcpStream, snow::TransportState),
}

impl PeerTx {
    /// Write one event or heartbeat: a JSON line for plain peers, one
    /// encrypted frame for noise peers.
    pub(crate) async fn send_line(&mut self, line: &str) -> std::io::Result<()> {
        match self {
            PeerTx::Plain(stream) => stream.write_all(format!("{line}\n").as_bytes()).await,
            PeerTx::Noise(stream, state) => {
                let mut out = vec![0u8; line.len() + 32];
                let n = state
                    .write_message(line.as_bytes(), &mut out)
                    .map_err(|e| {
                        std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("noise encrypt failed: {e}"),
                        )
                    })?;
                write_frame(stream, &out[..n]).await
            }
        }
    }
}
