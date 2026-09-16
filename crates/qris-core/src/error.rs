//! Error types for `qris-core`.

use thiserror::Error;

/// All errors that can arise while parsing, building, decoding, or rendering a QRIS payload.
#[derive(Debug, Error)]
pub enum QrisError {
    /// The input string is too short to contain a valid QRIS TLV field.
    #[error("payload too short: need at least {needed} characters, got {got}")]
    TooShort {
        /// Number of characters required.
        needed: usize,
        /// Number of characters received.
        got: usize,
    },

    /// A TLV field has a non-numeric or out-of-range length specifier.
    #[error("tag {tag:02} has an invalid length field: {reason}")]
    BadLength {
        /// The tag whose length was malformed.
        tag: u8,
        /// Rationale for the invalid length.
        reason: &'static str,
    },

    /// The CRC-16 checksum in the payload does not match the computed value.
    #[error("CRC mismatch: expected {expected:04X}, computed {computed:04X}")]
    CrcMismatch {
        /// Expected CRC-16 value.
        expected: u16,
        /// Computed CRC-16 value.
        computed: u16,
    },

    /// A mandatory QRIS top-level tag is absent.
    #[error("missing mandatory tag {0:02}")]
    MissingTag(u8),

    /// The same top-level tag appears more than once.
    #[error("duplicate top-level tag {0:02}")]
    DuplicateTag(u8),

    /// No Merchant Account Information slot (tags 26–51) was found.
    #[error("no merchant account information (tags 26–51) found in payload")]
    NoMerchantAccount,

    /// The NMID sub-tag (sub-tag 02 inside tags 26–51) is absent.
    #[error("NMID (sub-tag 02 inside merchant account info) not found")]
    MissingNmid,

    /// An amount or fee string cannot be parsed as a decimal number.
    #[error("invalid amount \"{0}\": expected a decimal number (e.g. \"50000\" or \"50000.00\")")]
    InvalidAmount(String),

    /// Tip indicator (tag 55) is present but the paired detail tag (56 or 57) is missing.
    #[error(
        "tip indicator (tag 55) present but neither fixed-fee (56) nor percentage-fee (57) tag was found"
    )]
    IncompleteTip,

    /// The NMID string does not conform to the expected structure.
    #[error("invalid NMID \"{0}\": expected format \"ID<4-digit-acquirer><merchant-number>\"")]
    InvalidNmid(String),

    /// A QR code could not be decoded from the supplied image.
    #[error("QR decode failed: {0}")]
    DecodeError(String),

    /// A QR code image could not be rendered.
    #[error("QR render failed: {0}")]
    RenderError(String),

    /// An I/O operation failed.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}
