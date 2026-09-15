//! QRIS / EMVCo MPM tag constants and enumerations.
//!
//! All tag identifiers are two decimal ASCII digits in the wire format (e.g. `"26"`),
//! represented here as `u8` values for efficient matching.

// ── Core ─────────────────────────────────────────────────────────────────────
/// Payload Format Indicator — always `"01"`.
pub const TAG_PAYLOAD_FORMAT: u8 = 0x00; // 00

/// Point of Initiation Method — `"11"` = static, `"12"` = dynamic.
pub const TAG_INITIATION_METHOD: u8 = 0x01; // 01

// ── Merchant Account Information (tags 26–51, each containing nested TLV) ───
/// First Merchant Account Information slot tag.
pub const TAG_MERCHANT_INFO_START: u8 = 26;

/// Last Merchant Account Information slot tag.
pub const TAG_MERCHANT_INFO_END: u8 = 51;

/// Sub-tag: Provider GUID — e.g. `"ID.CO.QRIS.WWW"`.
pub const SUB_TAG_GUID: u8 = 0x00; // 00

/// Sub-tag: **NMID** (National Merchant Identifier) — e.g. `"ID1020001234567"`.
///
/// This is the primary identifier used to look up or generate a merchant's QRIS.
pub const SUB_TAG_NMID: u8 = 0x02; // 02

// ── Transaction / fee data ────────────────────────────────────────────────────
/// Merchant Category Code (ISO 18245 4-digit string), e.g. `"5812"`.
pub const TAG_MCC: u8 = 52;

/// Transaction Currency (ISO 4217 numeric string). IDR = `"360"`.
pub const TAG_CURRENCY: u8 = 53;

/// Transaction Amount — decimal string, e.g. `"50000"`. Absent in static QR.
pub const TAG_AMOUNT: u8 = 54;

/// Tip or Convenience Fee Indicator — `"02"` = fixed amount, `"03"` = percentage.
pub const TAG_TIP_INDICATOR: u8 = 55;

/// Convenience Fee (fixed) — decimal string, e.g. `"1000"`. Present when tag 55 = `"02"`.
pub const TAG_FEE_FIXED: u8 = 56;

/// Convenience Fee (percentage) — decimal string, e.g. `"2.5"`. Present when tag 55 = `"03"`.
pub const TAG_FEE_PERCENT: u8 = 57;

// ── Merchant identity ─────────────────────────────────────────────────────────
/// Country Code (ISO 3166-1 alpha-2). Indonesia = `"ID"`.
pub const TAG_COUNTRY: u8 = 58;

/// Merchant Name — up to 25 characters.
pub const TAG_MERCHANT_NAME: u8 = 59;

/// Merchant City — up to 15 characters.
pub const TAG_MERCHANT_CITY: u8 = 60;

/// Postal Code — optional, up to 10 characters.
pub const TAG_POSTAL_CODE: u8 = 61;

/// Additional Data Field Template — nested TLV (bill number, terminal label, etc.).
pub const TAG_ADDITIONAL_DATA: u8 = 62;

/// CRC-16 checksum — always the last tag; 4 uppercase hex characters.
pub const TAG_CRC: u8 = 63;

// ── Sub-tags inside Additional Data Field Template (tag 62) ──────────────────
/// Bill Number sub-tag.
pub const SUB_TAG_BILL_NUMBER: u8 = 0x01;
/// Mobile Number sub-tag.
pub const SUB_TAG_MOBILE_NUMBER: u8 = 0x02;
/// Store Label sub-tag.
pub const SUB_TAG_STORE_LABEL: u8 = 0x03;
/// Loyalty Number sub-tag.
pub const SUB_TAG_LOYALTY_NUMBER: u8 = 0x04;
/// Reference Label sub-tag.
pub const SUB_TAG_REFERENCE_LABEL: u8 = 0x05;
/// Customer Label sub-tag.
pub const SUB_TAG_CUSTOMER_LABEL: u8 = 0x06;
/// Terminal Label sub-tag.
pub const SUB_TAG_TERMINAL_LABEL: u8 = 0x07;
/// Purpose of Transaction sub-tag.
pub const SUB_TAG_PURPOSE: u8 = 0x08;

/// Point-of-initiation mode for a QRIS payload.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum InitiationMethod {
    /// Static QR — no amount embedded; customer enters the amount at their app.
    Static,
    /// Dynamic QR — amount (and optionally tip) is embedded in the payload.
    Dynamic,
}

impl InitiationMethod {
    /// Parse the wire value (`"11"` or `"12"`).
    pub(crate) fn from_wire(s: &str) -> Self {
        if s == "12" { Self::Dynamic } else { Self::Static }
    }

    /// Serialize to the wire value.
    pub(crate) fn to_wire(&self) -> &'static str {
        match self { Self::Static => "11", Self::Dynamic => "12" }
    }
}
