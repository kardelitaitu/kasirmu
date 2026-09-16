//! # qris-core
//!
//! Parse, build, decode, and render **QRIS** (Quick Response Code Indonesian Standard)
//! QR payment payloads.
//!
//! QRIS is Indonesia's national QR payment standard, built on the EMVCo
//! Merchant-Presented Mode (MPM) TLV specification.
//!
//! ## Feature flags
//!
//! | Feature  | Enables |
//! |----------|---------|
//! | *(none)* | [`QrisPayload::parse`], [`QrisBuilder`], all field access, CRC utilities |
//! | `decode` | [`QrisPayload::from_image`], [`QrisPayload::from_bytes`] |
//! | `render` | [`QrisPayload::to_qr_png`], [`QrisPayload::to_qr_svg`], [`QrisPayload::to_qr_png_with_logo`] |
//! | `serde`  | `Serialize` / `Deserialize` on all public data types |
//!
//! ## Flow 1 — Read a QR sticker and extract the NMID
//!
//! ```rust,no_run
//! # #[cfg(feature = "decode")] {
//! use qris_core::QrisPayload;
//!
//! let payload = QrisPayload::from_image("merchant_sticker.png")?;
//! println!("NMID:          {}", payload.nmid());
//! println!("Merchant name: {}", payload.merchant_name);
//! println!("City:          {}", payload.merchant_city);
//! println!("MCC:           {}", payload.merchant_category_code);
//! # }
//! # Ok::<(), qris_core::QrisError>(())
//! ```
//!
//! ## Flow 2 — Build a dynamic QR from NMID + details and render to PNG
//!
//! ```rust,no_run
//! # #[cfg(feature = "render")] {
//! use qris_core::QrisBuilder;
//!
//! let png_bytes = QrisBuilder::new()
//!     .nmid("ID1020001234567")
//!     .merchant_name("Warung Sayur Bu Sugeng")
//!     .merchant_city("Kab. Demak")
//!     .merchant_category_code("5812")
//!     .amount("50000")               // makes it dynamic
//!     .terminal_label("T-001")
//!     .build()?
//!     .to_qr_png(300)?;
//!
//! std::fs::write("dynamic.png", png_bytes)?;
//! # }
//! # Ok::<(), qris_core::QrisError>(())
//! ```
//!
//! ## Static → Dynamic conversion
//!
//! ```rust,no_run
//! # #[cfg(all(feature = "decode", feature = "render"))] {
//! use qris_core::QrisPayload;
//!
//! // Scan once
//! let static_payload = QrisPayload::from_image("sticker.png")?;
//!
//! // For each transaction, stamp the amount and re-render
//! let dynamic_png = static_payload
//!     .into_dynamic("75000")?
//!     .to_qr_png(300)?;
//! # }
//! # Ok::<(), qris_core::QrisError>(())
//! ```

pub mod amount;
pub mod builder;
pub mod error;
pub mod mcc;
pub mod merchant;
pub mod nmid;
pub mod payload;
pub mod tag;
pub mod validate;

pub(crate) mod crc;
pub(crate) mod tlv;

#[cfg(feature = "decode")]
pub mod decode;

#[cfg(feature = "render")]
pub mod render;

// ── Top-level re-exports ──────────────────────────────────────────────────────

pub use builder::QrisBuilder;
pub use error::QrisError;
pub use merchant::{AdditionalData, MerchantAccountInfo};
pub use nmid::NmidInfo;
pub use payload::{QrisPayload, Tip, is_valid_qris};
pub use tag::InitiationMethod;

// ── Top-level utility functions ───────────────────────────────────────────────

/// Compute the 4-character uppercase hex CRC for a partial QRIS string.
///
/// `partial` must contain all fields except the CRC value itself (it may or may
/// not include the `"6304"` tag/length prefix — if absent, it is added automatically).
///
/// This is a low-level utility for advanced users who assemble raw QRIS strings manually.
/// Most callers should use [`QrisBuilder`] or [`QrisPayload::to_qris_string`] instead.
///
/// # Examples
///
/// ```
/// use qris_core::compute_crc;
///
/// // The CRC is computed over everything up to and including "6304"
/// let crc = compute_crc("000201010211");
/// assert_eq!(crc.len(), 4);
/// ```
pub fn compute_crc(partial: &str) -> String {
    crc::compute(partial)
}
