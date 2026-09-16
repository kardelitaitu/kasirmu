//! Fluent builder for constructing [`QrisPayload`] from scratch.

use crate::{
    error::QrisError,
    merchant::{AdditionalData, MerchantAccountInfo},
    payload::{QrisPayload, Tip},
    tag::*,
};

/// Fluent builder for a [`QrisPayload`].
///
/// ## Minimal dynamic QR
///
/// ```rust
/// use qris_core::QrisBuilder;
///
/// let payload = QrisBuilder::new()
///     .nmid("ID1020001234567")
///     .merchant_name("Warung Sayur Bu Sugeng")
///     .merchant_city("Kab. Demak")
///     .merchant_category_code("5812")
///     .amount("50000")
///     .build()
///     .unwrap();
///
/// println!("{}", payload.to_qris_string());
/// ```
#[derive(Debug, Default)]
pub struct QrisBuilder {
    // Merchant account slot 0
    nmid: Option<String>,
    guid: Option<String>,
    merchant_pan: Option<String>,
    criteria: Option<String>,
    extra_accounts: Vec<MerchantAccountInfo>,

    // Payment / transaction fields
    merchant_category_code: Option<String>,
    currency: Option<String>,
    amount: Option<String>,
    tip: Option<Tip>,

    // Merchant identity
    country_code: Option<String>,
    merchant_name: Option<String>,
    merchant_city: Option<String>,
    postal_code: Option<String>,

    // Additional data (tag 62)
    additional_data: AdditionalData,

    // Unknown pass-through tags
    extra: Vec<(u8, String)>,
}

impl QrisBuilder {
    /// Create an empty builder.
    pub fn new() -> Self {
        Self::default()
    }

    /// Pre-fill the builder from an existing [`QrisPayload`] for mutation.
    pub fn from_payload(mut p: QrisPayload) -> Self {
        let (nmid, guid, merchant_pan, criteria, extra_accounts) =
            if !p.merchant_accounts.is_empty() {
                let first = p.merchant_accounts.remove(0);
                (
                    Some(first.nmid),
                    Some(first.guid),
                    first.merchant_pan,
                    first.criteria,
                    p.merchant_accounts,
                )
            } else {
                (None, None, None, None, Vec::new())
            };

        Self {
            nmid,
            guid,
            merchant_pan,
            criteria,
            extra_accounts,
            merchant_category_code: Some(p.merchant_category_code),
            currency: Some(p.currency),
            amount: p.amount,
            tip: p.tip,
            country_code: Some(p.country_code),
            merchant_name: Some(p.merchant_name),
            merchant_city: Some(p.merchant_city),
            postal_code: p.postal_code,
            additional_data: p.additional_data.unwrap_or_default(),
            extra: p.extra,
        }
    }

    // ── Required fields ──────────────────────────────────────────────────

    /// Set the NMID (National Merchant Identifier), e.g. `"ID1020001234567"`.
    ///
    /// This is the primary merchant identifier and is **required** by `build`.
    pub fn nmid(mut self, nmid: impl Into<String>) -> Self {
        self.nmid = Some(nmid.into());
        self
    }

    /// Set the Merchant Name (tag 59). **Required** by `build`.
    pub fn merchant_name(mut self, name: impl Into<String>) -> Self {
        self.merchant_name = Some(name.into());
        self
    }

    /// Set the Merchant City (tag 60). **Required** by `build`.
    pub fn merchant_city(mut self, city: impl Into<String>) -> Self {
        self.merchant_city = Some(city.into());
        self
    }

    /// Set the Merchant Category Code (tag 52). **Required** by `build`.
    pub fn merchant_category_code(mut self, mcc: impl Into<String>) -> Self {
        self.merchant_category_code = Some(mcc.into());
        self
    }

    // ── Optional fields ──────────────────────────────────────────────────

    /// Override the provider GUID (default: `"ID.CO.QRIS.WWW"`).
    pub fn guid(mut self, guid: impl Into<String>) -> Self {
        self.guid = Some(guid.into());
        self
    }

    /// Set the Merchant PAN / Account Number (sub-tag `01` in slot 0).
    pub fn merchant_pan(mut self, pan: impl Into<String>) -> Self {
        self.merchant_pan = Some(pan.into());
        self
    }

    /// Set the Merchant Criteria (sub-tag `03` in slot 0, e.g. `"UKE"`, `"UME"`, `"UBE"`).
    pub fn criteria(mut self, criteria: impl Into<String>) -> Self {
        self.criteria = Some(criteria.into());
        self
    }

    /// Add an additional Merchant Account Information slot (tags 27–51) for multi-acquirer setups.
    pub fn extra_merchant_account(mut self, account: MerchantAccountInfo) -> Self {
        self.extra_accounts.push(account);
        self
    }

    /// Set the Transaction Amount (tag 54).
    ///
    /// Setting an amount automatically switches the payload to **Dynamic** mode.
    pub fn amount(mut self, amount: impl Into<String>) -> Self {
        self.amount = Some(amount.into());
        self
    }

    /// Remove the transaction amount (switch back to Static mode).
    pub fn clear_amount(mut self) -> Self {
        self.amount = None;
        self.tip = None;
        self
    }

    /// Set a fixed convenience fee (tag 55 = `"02"`, tag 56 = `fee`).
    pub fn tip_fixed(mut self, fee: impl Into<String>) -> Self {
        self.tip = Some(Tip::Fixed { amount: fee.into() });
        self
    }

    /// Set a percentage convenience fee (tag 55 = `"03"`, tag 57 = `percent`).
    ///
    /// `percent` should be a decimal string such as `"2.5"`.
    pub fn tip_percent(mut self, percent: impl Into<String>) -> Self {
        self.tip = Some(Tip::Percentage {
            percent: percent.into(),
        });
        self
    }

    /// Clear the convenience fee block.
    pub fn clear_tip(mut self) -> Self {
        self.tip = None;
        self
    }

    /// Override the Country Code (tag 58, default: `"ID"`).
    pub fn country_code(mut self, code: impl Into<String>) -> Self {
        self.country_code = Some(code.into());
        self
    }

    /// Override the Transaction Currency (tag 53, default: `"360"` = IDR).
    pub fn currency(mut self, code: impl Into<String>) -> Self {
        self.currency = Some(code.into());
        self
    }

    /// Set the Postal Code (tag 61, optional).
    pub fn postal_code(mut self, code: impl Into<String>) -> Self {
        self.postal_code = Some(code.into());
        self
    }

    // ── Additional Data (tag 62) convenience setters ─────────────────────

    /// Set the Bill Number (sub-tag 01 inside tag 62).
    pub fn bill_number(mut self, v: impl Into<String>) -> Self {
        self.additional_data.bill_number = Some(v.into());
        self
    }
    /// Set the Mobile Number (sub-tag 02 inside tag 62).
    pub fn mobile_number(mut self, v: impl Into<String>) -> Self {
        self.additional_data.mobile_number = Some(v.into());
        self
    }
    /// Set the Store Label (sub-tag 03 inside tag 62).
    pub fn store_label(mut self, v: impl Into<String>) -> Self {
        self.additional_data.store_label = Some(v.into());
        self
    }
    /// Set the Loyalty Number (sub-tag 04 inside tag 62).
    pub fn loyalty_number(mut self, v: impl Into<String>) -> Self {
        self.additional_data.loyalty_number = Some(v.into());
        self
    }
    /// Set the Reference Label (sub-tag 05 inside tag 62).
    pub fn reference_label(mut self, v: impl Into<String>) -> Self {
        self.additional_data.reference_label = Some(v.into());
        self
    }
    /// Set the Customer Label (sub-tag 06 inside tag 62).
    pub fn customer_label(mut self, v: impl Into<String>) -> Self {
        self.additional_data.customer_label = Some(v.into());
        self
    }
    /// Set the Terminal Label (sub-tag 07 inside tag 62).
    pub fn terminal_label(mut self, v: impl Into<String>) -> Self {
        self.additional_data.terminal_label = Some(v.into());
        self
    }
    /// Set the Purpose of Transaction (sub-tag 08 inside tag 62).
    pub fn purpose(mut self, v: impl Into<String>) -> Self {
        self.additional_data.purpose = Some(v.into());
        self
    }

    // ── Build ─────────────────────────────────────────────────────────────

    /// Validate, serialise, and return a [`QrisPayload`] with a correct CRC.
    ///
    /// # Errors
    /// - [`QrisError::MissingNmid`] — `nmid` not set
    /// - [`QrisError::MissingTag`] — `merchant_name`, `merchant_city`, or `mcc` not set
    /// - [`QrisError::InvalidAmount`] — amount string is not a valid decimal
    pub fn build(self) -> Result<QrisPayload, QrisError> {
        let nmid = self.nmid.ok_or(QrisError::MissingNmid)?;
        let merchant_name = self
            .merchant_name
            .ok_or(QrisError::MissingTag(TAG_MERCHANT_NAME))?;
        let merchant_city = self
            .merchant_city
            .ok_or(QrisError::MissingTag(TAG_MERCHANT_CITY))?;
        let merchant_category_code = self
            .merchant_category_code
            .ok_or(QrisError::MissingTag(TAG_MCC))?;

        // Validate amount string if provided
        if let Some(ref a) = self.amount {
            crate::amount::parse_amount(a)?;
        }

        let initiation = if self.amount.is_some() {
            InitiationMethod::Dynamic
        } else {
            InitiationMethod::Static
        };

        let guid = self.guid.unwrap_or_else(|| "ID.CO.QRIS.WWW".to_string());
        let currency = self.currency.unwrap_or_else(|| "360".to_string());
        let country_code = self.country_code.unwrap_or_else(|| "ID".to_string());

        let mut merchant_accounts = vec![MerchantAccountInfo {
            tag: TAG_MERCHANT_INFO_START,
            guid,
            merchant_pan: self.merchant_pan,
            nmid,
            criteria: self.criteria,
            extra_sub_tags: Vec::new(),
        }];
        merchant_accounts.extend(self.extra_accounts);

        let additional_data = if self.additional_data.is_empty() {
            None
        } else {
            Some(self.additional_data)
        };

        Ok(QrisPayload {
            initiation,
            merchant_accounts,
            merchant_category_code,
            currency,
            amount: self.amount,
            tip: self.tip,
            country_code,
            merchant_name,
            merchant_city,
            postal_code: self.postal_code,
            additional_data,
            extra: self.extra,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimal_build() {
        let p = QrisBuilder::new()
            .nmid("ID1020001234567")
            .merchant_name("Test")
            .merchant_city("Jakarta")
            .merchant_category_code("5812")
            .build()
            .unwrap();
        assert_eq!(p.nmid(), "ID1020001234567");
        assert!(p.is_static());
        // CRC must be valid
        assert!(QrisPayload::is_valid_crc(&p.to_qris_string()));
    }

    #[test]
    fn dynamic_with_amount() {
        let p = QrisBuilder::new()
            .nmid("ID1020001234567")
            .merchant_name("Test")
            .merchant_city("Jakarta")
            .merchant_category_code("5812")
            .amount("50000")
            .build()
            .unwrap();
        assert!(p.is_dynamic());
        assert_eq!(p.amount.as_deref(), Some("50000"));
    }

    #[test]
    fn missing_nmid_error() {
        let err = QrisBuilder::new()
            .merchant_name("Test")
            .merchant_city("Jakarta")
            .merchant_category_code("5812")
            .build();
        assert!(matches!(err, Err(QrisError::MissingNmid)));
    }

    #[test]
    fn with_additional_data() {
        let p = QrisBuilder::new()
            .nmid("ID1020001234567")
            .merchant_name("Test")
            .merchant_city("Jakarta")
            .merchant_category_code("5812")
            .terminal_label("T001")
            .bill_number("INV-2024-001")
            .build()
            .unwrap();
        let ad = p.additional_data.unwrap();
        assert_eq!(ad.terminal_label.as_deref(), Some("T001"));
        assert_eq!(ad.bill_number.as_deref(), Some("INV-2024-001"));
    }

    #[test]
    fn from_payload_round_trip() {
        let original = QrisBuilder::new()
            .nmid("ID1020001234567")
            .merchant_name("Original Name")
            .merchant_city("Bandung")
            .merchant_category_code("5812")
            .build()
            .unwrap();

        let mutated = original
            .into_builder()
            .merchant_name("New Name")
            .build()
            .unwrap();

        assert_eq!(mutated.merchant_name, "New Name");
        assert_eq!(mutated.nmid(), "ID1020001234567");
    }

    #[test]
    fn with_pan_criteria_postal() {
        let p = QrisBuilder::new()
            .nmid("ID1023000885752")
            .guid("ID.CO.BANKJATIM.WWW")
            .merchant_pan("936001140000088872")
            .criteria("UKE")
            .postal_code("61363")
            .merchant_name("082 PUSK TROWULAN")
            .merchant_city("MOJOKERTO")
            .merchant_category_code("9399")
            .amount("100000")
            .build()
            .unwrap();

        assert_eq!(p.merchant_pan(), Some("936001140000088872"));
        assert_eq!(p.criteria(), Some("UKE"));
        assert_eq!(p.postal_code.as_deref(), Some("61363"));
        assert!(p.is_dynamic());

        let raw = p.to_qris_string();
        assert!(raw.contains("936001140000088872"));
        assert!(raw.contains("61363"));
        assert!(QrisPayload::is_valid_crc(&raw));

        let reparsed = QrisPayload::parse(&raw).unwrap();
        assert_eq!(reparsed.merchant_pan(), Some("936001140000088872"));
        assert_eq!(reparsed.criteria(), Some("UKE"));
        assert_eq!(reparsed.postal_code.as_deref(), Some("61363"));
    }
}
