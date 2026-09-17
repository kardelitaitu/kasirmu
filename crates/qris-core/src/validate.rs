//! Structural validation of a [`QrisPayload`].

use crate::{error::QrisError, payload::QrisPayload, tag::*};

/// Validate that `payload` satisfies all QRIS structural requirements.
///
/// Returns the first error found. To collect *all* errors at once, use [`validate_all`].
pub fn validate(payload: &QrisPayload) -> Result<(), QrisError> {
    let errors = validate_all(payload);
    errors.into_iter().next().map_or(Ok(()), Err)
}

/// Validate `payload` and return every error found.
///
/// An empty `Vec` means the payload is structurally valid.
pub fn validate_all(payload: &QrisPayload) -> Vec<QrisError> {
    let mut errors = Vec::new();

    // Merchant accounts
    if payload.merchant_accounts.is_empty() {
        errors.push(QrisError::NoMerchantAccount);
    } else if payload.merchant_accounts[0].nmid.is_empty() {
        errors.push(QrisError::MissingNmid);
    }

    // Mandatory string fields
    if payload.merchant_name.is_empty() {
        errors.push(QrisError::MissingTag(TAG_MERCHANT_NAME));
    }
    if payload.merchant_city.is_empty() {
        errors.push(QrisError::MissingTag(TAG_MERCHANT_CITY));
    }
    if payload.merchant_category_code.is_empty() {
        errors.push(QrisError::MissingTag(TAG_MCC));
    }
    if payload.currency.is_empty() {
        errors.push(QrisError::MissingTag(TAG_CURRENCY));
    }
    if payload.country_code.is_empty() {
        errors.push(QrisError::MissingTag(TAG_COUNTRY));
    }

    // Amount must be a valid decimal if present
    if let Some(ref a) = payload.amount
        && crate::amount::parse_amount(a).is_err()
    {
        errors.push(QrisError::InvalidAmount(a.clone()));
    }

    // Tip consistency
    if let Some(ref tip) = payload.tip {
        match tip {
            crate::payload::Tip::Fixed { amount } => {
                if crate::amount::parse_amount(amount).is_err() {
                    errors.push(QrisError::InvalidAmount(amount.clone()));
                }
            }
            crate::payload::Tip::Percentage { percent } => {
                if percent.parse::<f64>().is_err() {
                    errors.push(QrisError::InvalidAmount(percent.clone()));
                }
            }
        }
    }

    // Dynamic QR should have an amount
    if payload.is_dynamic() && payload.amount.is_none() {
        errors.push(QrisError::MissingTag(TAG_AMOUNT));
    }

    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::QrisBuilder;

    fn valid() -> QrisPayload {
        QrisBuilder::new()
            .nmid("ID1020001234567")
            .merchant_name("Test")
            .merchant_city("Jakarta")
            .merchant_category_code("5812")
            .build()
            .unwrap()
    }

    #[test]
    fn valid_payload_passes() {
        assert!(validate(&valid()).is_ok());
        assert!(validate_all(&valid()).is_empty());
    }

    #[test]
    fn empty_merchant_name_fails() {
        let mut p = valid();
        p.merchant_name.clear();
        assert!(validate(&p).is_err());
    }
}
