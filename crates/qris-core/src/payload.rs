//! The [`QrisPayload`] type and its parsing / serialisation logic.

use crate::{
    builder::QrisBuilder,
    crc,
    error::QrisError,
    merchant::{AdditionalData, MerchantAccountInfo},
    tag::*,
    tlv,
};

/// A convenience-fee block embedded in tags 55–57.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Tip {
    /// Tag 55 = `"02"`. Tag 56 carries the fixed-fee amount string (e.g. `"1000"`).
    Fixed {
        /// Fixed convenience fee amount as string.
        amount: String,
    },
    /// Tag 55 = `"03"`. Tag 57 carries the percentage string (e.g. `"2.5"`).
    ///
    /// Stored as a `String` so callers can parse to their preferred decimal type.
    Percentage {
        /// Percentage fee as string (e.g. `"2.5"`).
        percent: String,
    },
}

/// A fully parsed and CRC-verified QRIS payload.
///
/// ## Parsing
///
/// ```rust,no_run
/// use qris_core::QrisPayload;
///
/// let raw = "000201010211...6304XXXX";
/// let payload = QrisPayload::parse(raw).unwrap();
/// println!("NMID: {}", payload.nmid());
/// ```
///
/// ## Reading from a QR image (`decode` feature)
///
/// ```rust,no_run
/// # #[cfg(feature = "decode")] {
/// use qris_core::QrisPayload;
/// let payload = QrisPayload::from_image("sticker.png").unwrap();
/// # }
/// ```
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct QrisPayload {
    // ── Tags 00–01 ────────────────────────────────────────────────────────
    /// Point-of-initiation method (static or dynamic).
    pub initiation: InitiationMethod,

    // ── Tags 26–51 ────────────────────────────────────────────────────────
    /// Merchant Account Information slots. At least one is always present.
    /// The primary NMID is in `merchant_accounts[0].nmid`.
    pub merchant_accounts: Vec<MerchantAccountInfo>,

    // ── Tags 52–57 ────────────────────────────────────────────────────────
    /// Merchant Category Code (ISO 18245), e.g. `"5812"`.
    pub merchant_category_code: String,
    /// Transaction Currency (ISO 4217 numeric), e.g. `"360"` for IDR.
    pub currency: String,
    /// Transaction Amount — `None` in a static QR.
    pub amount: Option<String>,
    /// Convenience fee block (tags 55–57), if present.
    pub tip: Option<Tip>,

    // ── Tags 58–61 ────────────────────────────────────────────────────────
    /// Country Code (ISO 3166-1 alpha-2), typically `"ID"`.
    pub country_code: String,
    /// Merchant Name — up to 25 characters.
    pub merchant_name: String,
    /// Merchant City — up to 15 characters.
    pub merchant_city: String,
    /// Postal Code — optional.
    pub postal_code: Option<String>,

    // ── Tag 62 ────────────────────────────────────────────────────────────
    /// Additional Data Field Template (bill number, terminal label, etc.).
    pub additional_data: Option<AdditionalData>,

    // ── Unknown tags ──────────────────────────────────────────────────────
    /// Unrecognised tags preserved for round-trip fidelity.
    pub extra: Vec<(u8, String)>,
}

impl QrisPayload {
    // ── Construction ──────────────────────────────────────────────────────

    /// Parse a raw QRIS string and verify its CRC.
    ///
    /// # Errors
    /// - [`QrisError::TooShort`] — fewer than 8 characters
    /// - [`QrisError::CrcMismatch`] — CRC does not match
    /// - [`QrisError::NoMerchantAccount`] — no tags 26–51 found
    /// - [`QrisError::MissingNmid`] — sub-tag 02 absent in slot 0
    pub fn parse(input: &str) -> Result<Self, QrisError> {
        crc::verify(input)?;
        let tlvs = tlv::parse_tlvs(input)?;
        Self::from_tlvs(tlvs)
    }

    /// Decode a QR code image file and parse the embedded QRIS string.
    ///
    /// Requires the `decode` feature.
    #[cfg(feature = "decode")]
    pub fn from_image(path: impl AsRef<std::path::Path>) -> Result<Self, QrisError> {
        let raw = crate::decode::decode_image_file(path)?;
        Self::parse(&raw)
    }

    /// Decode a QR code from raw image bytes and parse the embedded QRIS string.
    ///
    /// Requires the `decode` feature.
    #[cfg(feature = "decode")]
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, QrisError> {
        let raw = crate::decode::decode_image_bytes(bytes)?;
        Self::parse(&raw)
    }

    // ── Accessors ─────────────────────────────────────────────────────────

    /// Return the NMID from the first Merchant Account Information slot.
    ///
    /// This is the primary merchant identifier for QRIS.
    pub fn nmid(&self) -> &str {
        self.merchant_accounts
            .first()
            .map(|m| m.nmid.as_str())
            .unwrap_or("")
    }

    /// Return the provider GUID from the first Merchant Account Information slot (e.g. `"ID.CO.BANKJATIM.WWW"`).
    pub fn provider_guid(&self) -> &str {
        self.merchant_accounts
            .first()
            .map(|m| m.guid.as_str())
            .unwrap_or("")
    }

    /// Return the Merchant PAN / Account Number from the first slot, if present.
    pub fn merchant_pan(&self) -> Option<&str> {
        self.merchant_accounts
            .first()
            .and_then(|m| m.merchant_pan.as_deref())
    }

    /// Return the Merchant Criteria from the first slot, if present (e.g. `"UKE"`, `"UME"`).
    pub fn criteria(&self) -> Option<&str> {
        self.merchant_accounts
            .first()
            .and_then(|m| m.criteria.as_deref())
    }

    /// Return the friendly name of the primary acquirer/issuer (e.g. `"Bank Jatim"`).
    pub fn issuer(&self) -> String {
        self.merchant_accounts
            .first()
            .map(|m| m.provider_name())
            .unwrap_or_else(|| "Unknown".to_string())
    }

    /// Return all merchant account slots (acquirers & national aggregator).
    pub fn merchant_accounts(&self) -> &[MerchantAccountInfo] {
        &self.merchant_accounts
    }

    /// Return `true` if this is a static QR (no amount embedded).
    pub fn is_static(&self) -> bool {
        self.initiation == InitiationMethod::Static
    }

    /// Return `true` if this is a dynamic QR (amount embedded).
    pub fn is_dynamic(&self) -> bool {
        self.initiation == InitiationMethod::Dynamic
    }

    /// Return `true` if a transaction amount is present.
    pub fn has_amount(&self) -> bool {
        self.amount.is_some()
    }

    /// Return `true` if a convenience fee block is present.
    pub fn has_tip(&self) -> bool {
        self.tip.is_some()
    }

    /// Parse the amount string to whole rupiah, or `None` if absent.
    ///
    /// # Errors
    /// [`QrisError::InvalidAmount`] if the amount string is malformed.
    pub fn amount_rupiah(&self) -> Result<Option<u64>, QrisError> {
        match &self.amount {
            None => Ok(None),
            Some(s) => crate::amount::parse_amount(s).map(Some),
        }
    }

    // ── Conversion helpers ────────────────────────────────────────────────

    /// Stamp a transaction amount onto a static payload, returning a new dynamic payload.
    ///
    /// This is the most common POS pattern: scan a merchant's static sticker once,
    /// then for each transaction call `into_dynamic(amount)` to get a fresh dynamic QR.
    ///
    /// # Errors
    /// [`QrisError::InvalidAmount`] if `amount` is not a valid decimal string.
    pub fn into_dynamic(mut self, amount: impl Into<String>) -> Result<Self, QrisError> {
        let a = amount.into();
        crate::amount::parse_amount(&a)?; // validate before mutating
        self.amount = Some(a);
        self.initiation = InitiationMethod::Dynamic;
        Ok(self)
    }

    /// Strip the amount from a dynamic payload, returning a static one.
    pub fn into_static(mut self) -> Self {
        self.amount = None;
        self.tip = None;
        self.initiation = InitiationMethod::Static;
        self
    }

    /// Convert to a [`QrisBuilder`] pre-filled with all fields for further mutation.
    pub fn into_builder(self) -> QrisBuilder {
        QrisBuilder::from_payload(self)
    }

    // ── Serialisation ─────────────────────────────────────────────────────

    /// Serialise to a valid QRIS string (CRC recalculated automatically).
    pub fn to_qris_string(&self) -> String {
        let mut out = String::new();

        // 00: Payload Format Indicator
        out.push_str(&tlv::encode_field(TAG_PAYLOAD_FORMAT, "01"));
        // 01: Initiation Method
        out.push_str(&tlv::encode_field(
            TAG_INITIATION_METHOD,
            self.initiation.to_wire(),
        ));

        // 26–51: Merchant Account Info
        for slot in &self.merchant_accounts {
            out.push_str(&slot.to_tlv_string());
        }

        // 52: MCC
        out.push_str(&tlv::encode_field(TAG_MCC, &self.merchant_category_code));
        // 53: Currency
        out.push_str(&tlv::encode_field(TAG_CURRENCY, &self.currency));

        // 54: Amount (dynamic only)
        if let Some(ref a) = self.amount {
            out.push_str(&tlv::encode_field(TAG_AMOUNT, a));
        }

        // 55–57: Tip
        if let Some(ref tip) = self.tip {
            match tip {
                Tip::Fixed { amount } => {
                    out.push_str(&tlv::encode_field(TAG_TIP_INDICATOR, "02"));
                    out.push_str(&tlv::encode_field(TAG_FEE_FIXED, amount));
                }
                Tip::Percentage { percent } => {
                    out.push_str(&tlv::encode_field(TAG_TIP_INDICATOR, "03"));
                    out.push_str(&tlv::encode_field(TAG_FEE_PERCENT, percent));
                }
            }
        }

        // 58: Country
        out.push_str(&tlv::encode_field(TAG_COUNTRY, &self.country_code));
        // 59: Merchant Name
        out.push_str(&tlv::encode_field(TAG_MERCHANT_NAME, &self.merchant_name));
        // 60: Merchant City
        out.push_str(&tlv::encode_field(TAG_MERCHANT_CITY, &self.merchant_city));

        // 61: Postal Code
        if let Some(ref pc) = self.postal_code {
            out.push_str(&tlv::encode_field(TAG_POSTAL_CODE, pc));
        }

        // 62: Additional Data
        if let Some(ref ad) = self.additional_data {
            if !ad.is_empty() {
                let nested = ad.to_nested_string();
                out.push_str(&tlv::encode_field(TAG_ADDITIONAL_DATA, &nested));
            }
        }

        // Extra unknown tags — emit before CRC
        for (t, v) in &self.extra {
            out.push_str(&tlv::encode_field(*t, v));
        }

        // 63: CRC (appended by crc::append_crc)
        crc::append_crc(out)
    }

    // ── Rendering ─────────────────────────────────────────────────────────

    /// Render to a PNG image (`pixel_size × pixel_size`). Requires the `render` feature.
    #[cfg(feature = "render")]
    pub fn to_qr_png(&self, pixel_size: u32) -> Result<Vec<u8>, QrisError> {
        crate::render::to_png(&self.to_qris_string(), pixel_size)
    }

    /// Render to an SVG string. Requires the `render` feature.
    #[cfg(feature = "render")]
    pub fn to_qr_svg(&self) -> Result<String, QrisError> {
        crate::render::to_svg(&self.to_qris_string())
    }

    /// Render to a PNG image with a logo overlaid in the centre. Requires the `render` feature.
    ///
    /// Uses error-correction level H so up to 30% of the QR can be covered by the logo.
    #[cfg(feature = "render")]
    pub fn to_qr_png_with_logo(
        &self,
        pixel_size: u32,
        logo_bytes: &[u8],
    ) -> Result<Vec<u8>, QrisError> {
        crate::render::to_png_with_logo(&self.to_qris_string(), pixel_size, logo_bytes)
    }

    // ── Validation ────────────────────────────────────────────────────────

    /// Validate that all mandatory fields are present and consistent.
    ///
    /// Returns the first [`QrisError`] found. Use [`crate::validate::validate_all`]
    /// to collect every error at once.
    pub fn validate(&self) -> Result<(), QrisError> {
        crate::validate::validate(self)
    }

    // ── Quick checks ──────────────────────────────────────────────────────

    /// Quickly verify the CRC of a raw QRIS string without full parsing.
    ///
    /// Useful as a pre-filter before calling `parse`.
    pub fn is_valid_crc(input: &str) -> bool {
        crc::verify(input).is_ok()
    }

    // ── Internal ──────────────────────────────────────────────────────────

    fn from_tlvs(tlvs: Vec<tlv::Tlv>) -> Result<Self, QrisError> {
        let mut initiation = InitiationMethod::Static;
        let mut merchant_accounts: Vec<MerchantAccountInfo> = Vec::new();
        let mut merchant_category_code = String::new();
        let mut currency = String::from("360");
        let mut amount: Option<String> = None;
        let mut tip_indicator: Option<String> = None;
        let mut fee_fixed: Option<String> = None;
        let mut fee_percent: Option<String> = None;
        let mut country_code = String::from("ID");
        let mut merchant_name = String::new();
        let mut merchant_city = String::new();
        let mut postal_code: Option<String> = None;
        let mut additional_data: Option<AdditionalData> = None;
        let mut extra: Vec<(u8, String)> = Vec::new();

        for t in tlvs {
            match t.tag {
                TAG_PAYLOAD_FORMAT => {} // always "01", skip
                TAG_INITIATION_METHOD => {
                    initiation = InitiationMethod::from_wire(&t.value);
                }
                26..=51 => {
                    merchant_accounts.push(MerchantAccountInfo::from_nested(t.tag, &t.value)?);
                }
                TAG_MCC => merchant_category_code = t.value,
                TAG_CURRENCY => currency = t.value,
                TAG_AMOUNT => amount = Some(t.value),
                TAG_TIP_INDICATOR => tip_indicator = Some(t.value),
                TAG_FEE_FIXED => fee_fixed = Some(t.value),
                TAG_FEE_PERCENT => fee_percent = Some(t.value),
                TAG_COUNTRY => country_code = t.value,
                TAG_MERCHANT_NAME => merchant_name = t.value,
                TAG_MERCHANT_CITY => merchant_city = t.value,
                TAG_POSTAL_CODE => postal_code = Some(t.value),
                TAG_ADDITIONAL_DATA => {
                    additional_data = Some(AdditionalData::from_nested(&t.value)?);
                }
                TAG_CRC => {} // consumed by CRC verification, skip
                _ => extra.push((t.tag, t.value)),
            }
        }

        if merchant_accounts.is_empty() {
            return Err(QrisError::NoMerchantAccount);
        }
        if merchant_accounts[0].nmid.is_empty() {
            return Err(QrisError::MissingNmid);
        }

        // Build Tip from indicator + detail tags
        let tip = match tip_indicator.as_deref() {
            Some("02") => {
                let amount = fee_fixed.ok_or(QrisError::IncompleteTip)?;
                Some(Tip::Fixed { amount })
            }
            Some("03") => {
                let percent = fee_percent.ok_or(QrisError::IncompleteTip)?;
                Some(Tip::Percentage { percent })
            }
            Some(_) | None => None,
        };

        Ok(Self {
            initiation,
            merchant_accounts,
            merchant_category_code,
            currency,
            amount,
            tip,
            country_code,
            merchant_name,
            merchant_city,
            postal_code,
            additional_data,
            extra,
        })
    }
}

/// Quick check: returns `true` if `s` has a valid QRIS CRC, `false` otherwise.
///
/// Cheaper than `QrisPayload::parse` — no TLV parsing, just CRC verification.
///
/// # Examples
///
/// ```
/// use qris_core::is_valid_qris;
/// assert!(!is_valid_qris("corrupted"));
/// ```
pub fn is_valid_qris(s: &str) -> bool {
    QrisPayload::is_valid_crc(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_payload() -> String {
        // Build a valid minimal static payload through the builder
        QrisBuilder::new()
            .nmid("ID1020001234567")
            .merchant_name("Test Merchant")
            .merchant_city("Jakarta")
            .merchant_category_code("5812")
            .build()
            .unwrap()
            .to_qris_string()
    }

    #[test]
    fn parse_and_round_trip() {
        let s = minimal_payload();
        let p = QrisPayload::parse(&s).unwrap();
        let s2 = p.to_qris_string();
        assert_eq!(s, s2, "round-trip must be identity");
    }

    #[test]
    fn nmid_accessor() {
        let s = minimal_payload();
        let p = QrisPayload::parse(&s).unwrap();
        assert_eq!(p.nmid(), "ID1020001234567");
    }

    #[test]
    fn into_dynamic_sets_amount() {
        let s = minimal_payload();
        let p = QrisPayload::parse(&s).unwrap();
        let dyn_p = p.into_dynamic("50000").unwrap();
        assert!(dyn_p.is_dynamic());
        assert_eq!(dyn_p.amount.as_deref(), Some("50000"));
        // The serialised result must still have a valid CRC
        assert!(QrisPayload::is_valid_crc(&dyn_p.to_qris_string()));
    }

    #[test]
    fn into_static_clears_amount() {
        let s = minimal_payload();
        let p = QrisPayload::parse(&s)
            .unwrap()
            .into_dynamic("50000")
            .unwrap()
            .into_static();
        assert!(p.is_static());
        assert!(p.amount.is_none());
    }

    #[test]
    fn invalid_crc_rejected() {
        let mut s = minimal_payload();
        // Corrupt the last character of the CRC
        let last = s.pop().unwrap();
        s.push(if last == 'F' { '0' } else { 'F' });
        assert!(QrisPayload::parse(&s).is_err());
    }
}
