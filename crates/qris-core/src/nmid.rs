//! NMID (National Merchant Identifier) parsing and inspection.
//!
//! An NMID follows the format:
//! ```text
//! ID  <4-digit acquirer code>  <variable-length merchant number>
//! ^^  ^^^^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//! 2    4                      ≥ 1 (typically 9–13 digits)
//! ```
//! Example: `"ID1020001234567"` → country `"ID"`, acquirer `"1020"`, merchant `"001234567"`.

use crate::error::QrisError;

/// Parsed components of a QRIS NMID string.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct NmidInfo {
    /// Country code prefix — always `"ID"` for Indonesian QRIS.
    pub country_code: String,
    /// 4-digit acquirer (payment provider) code.
    pub acquirer_code: String,
    /// Variable-length merchant number (the remainder of the NMID).
    pub merchant_number: String,
    /// The full NMID string as originally supplied.
    pub raw: String,
}

impl NmidInfo {
    /// Parse an NMID string into its component parts.
    ///
    /// # Errors
    /// Returns [`QrisError::InvalidNmid`] if the string is shorter than 7 characters,
    /// does not start with `"ID"`, or the acquirer segment is not all ASCII digits.
    ///
    /// # Examples
    ///
    /// ```
    /// use qris_core::nmid::NmidInfo;
    ///
    /// let info = NmidInfo::parse("ID1020001234567").unwrap();
    /// assert_eq!(info.country_code, "ID");
    /// assert_eq!(info.acquirer_code, "1020");
    /// assert_eq!(info.merchant_number, "001234567");
    /// ```
    pub fn parse(nmid: &str) -> Result<Self, QrisError> {
        // Minimum: "ID" (2) + acquirer (4) + at least 1 merchant digit = 7
        if nmid.len() < 7 {
            return Err(QrisError::InvalidNmid(nmid.to_string()));
        }

        let country_code = &nmid[..2];
        if country_code != "ID" {
            return Err(QrisError::InvalidNmid(nmid.to_string()));
        }

        let acquirer_code = &nmid[2..6];
        if !acquirer_code.chars().all(|c| c.is_ascii_digit()) {
            return Err(QrisError::InvalidNmid(nmid.to_string()));
        }

        let merchant_number = &nmid[6..];
        if merchant_number.is_empty() {
            return Err(QrisError::InvalidNmid(nmid.to_string()));
        }

        Ok(Self {
            country_code: country_code.to_string(),
            acquirer_code: acquirer_code.to_string(),
            merchant_number: merchant_number.to_string(),
            raw: nmid.to_string(),
        })
    }

    /// Returns `true` if `other` shares the same acquirer code.
    pub fn same_acquirer(&self, other: &Self) -> bool {
        self.acquirer_code == other.acquirer_code
    }
}

/// Returns `true` if two `QrisPayload`s refer to the same merchant (same NMID in slot 0).
///
/// Convenience function — equivalent to comparing `payload_a.nmid() == payload_b.nmid()`.
pub fn same_merchant(nmid_a: &str, nmid_b: &str) -> bool {
    nmid_a == nmid_b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_nmid() {
        let info = NmidInfo::parse("ID1020001234567").unwrap();
        assert_eq!(info.country_code, "ID");
        assert_eq!(info.acquirer_code, "1020");
        assert_eq!(info.merchant_number, "001234567");
        assert_eq!(info.raw, "ID1020001234567");
    }

    #[test]
    fn reject_short_nmid() {
        assert!(NmidInfo::parse("ID102").is_err());
    }

    #[test]
    fn reject_non_id_prefix() {
        assert!(NmidInfo::parse("MY1020001234567").is_err());
    }

    #[test]
    fn reject_non_digit_acquirer() {
        assert!(NmidInfo::parse("IDABCD001234567").is_err());
    }

    #[test]
    fn same_acquirer_check() {
        let a = NmidInfo::parse("ID1020001234567").unwrap();
        let b = NmidInfo::parse("ID1020009876543").unwrap();
        let c = NmidInfo::parse("ID9999001234567").unwrap();
        assert!(a.same_acquirer(&b));
        assert!(!a.same_acquirer(&c));
    }
}
