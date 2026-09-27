//! Quota enforcement: the typed failures a limit check returns.
//!
//! Split out of `subscription.rs` on 2026-09-28. `QuotaError` carries the
//! UPGRADE MESSAGE as well as the failure — every variant renders a sentence the
//! UI shows to the merchant — so the enum, its `Display` impl and its conversion
//! into `CoreError` are kept together rather than split by item kind.
//!
//! Invariant: a quota failure is always actionable, never a bare rejection; the
//! conversion into `CoreError` preserves the rendered text so the surface that
//! reports it need not know the variant.

use crate::error::CoreError;

/// Error type for quota-related failures, used by the subscription
/// module to provide actionable upgrade messaging.
#[derive(Debug)]
pub enum QuotaError {
    /// The tenant has reached their per-store register limit.
    RegisterLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number allowed.
        limit: i64,
        /// The current usage count.
        current: i64,
    },
    /// The tenant has reached their store count limit.
    StoreLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number allowed.
        limit: i64,
        /// The current usage count.
        current: i64,
    },
    /// The workspace type is not available on this tier.
    TypeNotAllowed {
        /// The subscription tier name.
        tier: String,
        /// The workspace type key that was rejected.
        type_key: String,
    },
    /// The tenant has reached their staff-user limit (C1.1, §9 pre-launch item 1).
    StaffLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number of staff users allowed.
        limit: i64,
        /// The current active staff count.
        current: i64,
    },
    /// The tenant has reached their warehouse-location limit.
    WarehouseLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number of warehouse locations allowed.
        limit: i64,
        /// The current active warehouse count.
        current: i64,
    },
    /// The tenant has reached their product/menu-item limit
    /// (subscription-tiers.md §Numeric Limits).
    ProductLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number of products allowed.
        limit: i64,
        /// The current product count.
        current: i64,
    },
    /// The tenant has reached their KDS screen limit
    /// (subscription-tiers.md §Numeric Limits).
    KdsScreenLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number of KDS screens allowed.
        limit: i64,
        /// The current active KDS screen count.
        current: i64,
    },
}

impl std::fmt::Display for QuotaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RegisterLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} registers per store. \
                     This store already has {current}. Upgrade to add more."
                )
            }
            Self::StoreLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} stores. \
                     You currently have {current}. Upgrade to add more."
                )
            }
            Self::TypeNotAllowed { tier, type_key } => {
                write!(
                    f,
                    "The '{type_key}' workspace type requires a higher tier. \
                     Your current tier is {tier}."
                )
            }
            Self::StaffLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} staff users. \
                     You currently have {current}. Upgrade to add more."
                )
            }
            Self::WarehouseLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} warehouse locations. \
                     You currently have {current}. Upgrade to add more."
                )
            }
            Self::ProductLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} products. \
                     You currently have {current}. Upgrade to add more."
                )
            }
            Self::KdsScreenLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} KDS screens. \
                     You currently have {current}. Upgrade to add more."
                )
            }
        }
    }
}

impl From<QuotaError> for CoreError {
    fn from(e: QuotaError) -> Self {
        CoreError::SubscriptionLimitExceeded(e.to_string())
    }
}
