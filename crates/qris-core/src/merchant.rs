//! Merchant Account Information and Additional Data structures.

use crate::tag::*;
use crate::tlv;
use crate::error::QrisError;

/// One Merchant Account Information slot (EMVCo tags 26–51).
///
/// In the QRIS standard:
/// - Tags 26–45 are typically dedicated acquirers (e.g. Bank Jatim, BCA, Mandiri, GoPay).
/// - Tag 51 is the QRIS National Central Repository / Aggregator slot (`"ID.CO.QRIS.WWW"`).
///
/// Sub-tags inside:
/// - Sub-tag `00`: Reverse-domain Provider GUID / Identifier (e.g. `"ID.CO.BANKJATIM.WWW"`).
/// - Sub-tag `01`: Merchant PAN / Account Number (e.g. `"936001140000088872"`).
/// - Sub-tag `02`: **NMID** (National Merchant Identifier, e.g. `"ID1023000885752"`).
/// - Sub-tag `03`: Merchant Criteria (e.g. `"UKE"` for Usaha Kecil, `"UME"` for Mikro, `"UBE"` for Besar).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MerchantAccountInfo {
    /// The top-level tag for this slot (26–51).
    pub tag: u8,
    /// Provider / Issuer GUID — sub-tag `00`, e.g. `"ID.CO.BANKJATIM.WWW"`.
    pub guid: String,
    /// Merchant PAN / Account number — sub-tag `01`, if present.
    pub merchant_pan: Option<String>,
    /// **NMID** — sub-tag `02`, e.g. `"ID1023000885752"`.
    pub nmid: String,
    /// Merchant Criteria — sub-tag `03`, e.g. `"UKE"`, `"UME"`, `"UBE"`.
    pub criteria: Option<String>,
    /// Any additional sub-tags not covered by standard fields.
    pub extra_sub_tags: Vec<(u8, String)>,
}

impl MerchantAccountInfo {
    /// Parse the nested TLV value of a Merchant Account Info slot.
    pub(crate) fn from_nested(tag: u8, value: &str) -> Result<Self, QrisError> {
        let sub_tlvs = tlv::parse_nested(value)?;
        let mut guid = String::new();
        let mut merchant_pan = None;
        let mut nmid = String::new();
        let mut criteria = None;
        let mut extra = Vec::new();

        for t in sub_tlvs {
            match t.tag {
                SUB_TAG_GUID => guid = t.value,
                0x01 => merchant_pan = Some(t.value),
                SUB_TAG_NMID => nmid = t.value,
                0x03 => criteria = Some(t.value),
                _ => extra.push((t.tag, t.value)),
            }
        }

        Ok(Self {
            tag,
            guid,
            merchant_pan,
            nmid,
            criteria,
            extra_sub_tags: extra,
        })
    }

    /// Return a human-friendly name for the provider / issuer derived from the GUID.
    ///
    /// E.g. `"ID.CO.BANKJATIM.WWW"` → `"BANK JATIM"`, `"ID.CO.BCA.WWW"` → `"BCA"`.
    pub fn provider_name(&self) -> String {
        format_provider_guid(&self.guid)
    }

    /// Serialize this slot back to a QRIS top-level TLV segment.
    pub(crate) fn to_tlv_string(&self) -> String {
        let mut inner_fields: Vec<(u8, String)> = Vec::new();
        inner_fields.push((SUB_TAG_GUID, self.guid.clone()));
        if let Some(ref pan) = self.merchant_pan {
            inner_fields.push((0x01, pan.clone()));
        }
        inner_fields.push((SUB_TAG_NMID, self.nmid.clone()));
        if let Some(ref crit) = self.criteria {
            inner_fields.push((0x03, crit.clone()));
        }
        for (t, v) in &self.extra_sub_tags {
            inner_fields.push((*t, v.clone()));
        }

        let refs: Vec<(u8, &str)> = inner_fields.iter().map(|(t, v)| (*t, v.as_str())).collect();
        tlv::encode_nested(self.tag, &refs)
    }
}

/// Convert a reverse-domain QRIS GUID like `"ID.CO.BANKJATIM.WWW"` into a friendly name like `"BANK JATIM"`.
pub fn format_provider_guid(guid: &str) -> String {
    let upper = guid.to_uppercase();
    if upper.contains("BANKJATIM") {
        "Bank Jatim".to_string()
    } else if upper.contains("BCA") {
        "BCA".to_string()
    } else if upper.contains("MANDIRI") {
        "Bank Mandiri".to_string()
    } else if upper.contains("BRI") {
        "BRI".to_string()
    } else if upper.contains("BNI") {
        "BNI".to_string()
    } else if upper.contains("GOPAY") {
        "GoPay".to_string()
    } else if upper.contains("OVO") {
        "OVO".to_string()
    } else if upper.contains("DANA") {
        "DANA".to_string()
    } else if upper.contains("SHOPEEPAY") || upper.contains("AIRPAY") {
        "ShopeePay".to_string()
    } else if upper.contains("LINKAJA") {
        "LinkAja".to_string()
    } else if upper == "ID.CO.QRIS.WWW" {
        "QRIS Central Repository".to_string()
    } else {
        guid.replace("ID.CO.", "").replace(".WWW", "")
    }
}

/// Parsed Additional Data Field Template (tag 62).
///
/// All fields are optional — only include those present in the payload.
#[derive(Debug, Clone, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AdditionalData {
    /// Bill number — sub-tag `01`.
    pub bill_number: Option<String>,
    /// Mobile number — sub-tag `02`.
    pub mobile_number: Option<String>,
    /// Store label — sub-tag `03`.
    pub store_label: Option<String>,
    /// Loyalty number — sub-tag `04`.
    pub loyalty_number: Option<String>,
    /// Reference label — sub-tag `05`.
    pub reference_label: Option<String>,
    /// Customer label — sub-tag `06`.
    pub customer_label: Option<String>,
    /// Terminal label — sub-tag `07`.
    pub terminal_label: Option<String>,
    /// Purpose of transaction — sub-tag `08`.
    pub purpose: Option<String>,
    /// Unrecognised sub-tags.
    pub extra: Vec<(u8, String)>,
}

impl AdditionalData {
    /// Parse the nested TLV value of tag 62.
    pub(crate) fn from_nested(value: &str) -> Result<Self, QrisError> {
        let sub_tlvs = tlv::parse_nested(value)?;
        let mut data = Self::default();
        for t in sub_tlvs {
            match t.tag {
                SUB_TAG_BILL_NUMBER    => data.bill_number    = Some(t.value),
                SUB_TAG_MOBILE_NUMBER  => data.mobile_number  = Some(t.value),
                SUB_TAG_STORE_LABEL    => data.store_label    = Some(t.value),
                SUB_TAG_LOYALTY_NUMBER => data.loyalty_number = Some(t.value),
                SUB_TAG_REFERENCE_LABEL=> data.reference_label= Some(t.value),
                SUB_TAG_CUSTOMER_LABEL => data.customer_label = Some(t.value),
                SUB_TAG_TERMINAL_LABEL => data.terminal_label = Some(t.value),
                SUB_TAG_PURPOSE        => data.purpose        = Some(t.value),
                _                      => data.extra.push((t.tag, t.value)),
            }
        }
        Ok(data)
    }

    /// Serialize to the nested TLV string that becomes the value of tag 62.
    pub(crate) fn to_nested_string(&self) -> String {
        let mut fields: Vec<(u8, String)> = Vec::new();
        macro_rules! push_opt {
            ($sub:expr, $field:expr) => {
                if let Some(ref v) = $field { fields.push(($sub, v.clone())); }
            };
        }
        push_opt!(SUB_TAG_BILL_NUMBER,     self.bill_number);
        push_opt!(SUB_TAG_MOBILE_NUMBER,   self.mobile_number);
        push_opt!(SUB_TAG_STORE_LABEL,     self.store_label);
        push_opt!(SUB_TAG_LOYALTY_NUMBER,  self.loyalty_number);
        push_opt!(SUB_TAG_REFERENCE_LABEL, self.reference_label);
        push_opt!(SUB_TAG_CUSTOMER_LABEL,  self.customer_label);
        push_opt!(SUB_TAG_TERMINAL_LABEL,  self.terminal_label);
        push_opt!(SUB_TAG_PURPOSE,         self.purpose);
        for (t, v) in &self.extra { fields.push((*t, v.clone())); }

        fields.iter()
            .map(|(t, v)| tlv::encode_field(*t, v))
            .collect()
    }

    /// Returns `true` if no fields are set.
    pub fn is_empty(&self) -> bool {
        self.bill_number.is_none()
            && self.mobile_number.is_none()
            && self.store_label.is_none()
            && self.loyalty_number.is_none()
            && self.reference_label.is_none()
            && self.customer_label.is_none()
            && self.terminal_label.is_none()
            && self.purpose.is_none()
            && self.extra.is_empty()
    }
}
