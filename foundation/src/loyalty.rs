//! Loyalty and gift-card domain types — shared by the loyalty module and the core facade.
//!
//! Moved here from `modules-loyalty` (ADR-61 / C26, 2026-09-28) so `kasirmu-core` can re-export
//! them without depending on a business module. Every impl moved with its type — inherent ones
//! because Rust requires that (E0116), trait ones because the types are local here. The hand-written
//! redacting `Debug` for `GiftCard` is preserved verbatim: moving a credential-bearing type must not
//! restore a derived impl that printed it.

use serde::{Deserialize, Serialize};

/// A loyalty tier defining the earning rate and multiplier for a group of customers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyTier {
    /// Unique identifier for the tier.
    pub id: String,
    /// Display name (e.g. "Bronze", "Silver").
    pub name: String,
    /// Minimum lifetime points required to reach this tier.
    pub min_points: i64,
    /// Base points earned per minor unit of spend.
    pub points_per_unit: i64,
    /// Multiplier applied on top of base earnings, in fixed-point
    /// millionths (LOYALTY-01): 1.4× is `1_400_000`, never an f64. The
    /// old float column corrupted intent at write time and mis-rounded
    /// every exact .5 boundary in the points formula.
    pub earn_multiplier_millionths: i64,
    /// Hex colour for UI badge.
    pub colour: String,
    /// Display ordering (lower = higher priority).
    pub sort_order: i64,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

/// A customer's loyalty account — points balance and current tier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyAccount {
    /// Internal row id (UUID v4).
    pub id: String,
    /// FK to `customers.id`.
    pub customer_id: String,
    /// Current redeemable points balance.
    pub points: i64,
    /// Total points earned over the lifetime of the account.
    pub lifetime_points: i64,
    /// FK to `loyalty_tiers.id` (current tier).
    pub tier_id: Option<String>,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

/// A single points transaction — earn, redeem, adjust, or expire.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyTransaction {
    /// Internal row id (UUID v4).
    pub id: String,
    /// FK to `loyalty_accounts.id`.
    pub account_id: String,
    /// FK to `sales.id`, when tied to a sale.
    pub sale_id: Option<String>,
    /// Points delta (positive for earn, negative for redeem).
    pub points: i64,
    /// Transaction type: "earn", "redeem", "adjust", "expire".
    pub txn_type: String,
    /// Human-readable description of the transaction.
    pub description: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

/// Account with tier info and recent transactions (returned by API).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyAccountWithDetails {
    /// The underlying loyalty account.
    pub account: LoyaltyAccount,
    /// Current tier details (if any tier is assigned).
    pub tier: Option<LoyaltyTier>,
    /// Most recent 5–20 transactions.
    pub recent_transactions: Vec<LoyaltyTransaction>,
    /// The next tier above the current one (if any).
    pub next_tier: Option<LoyaltyTier>,
    /// Points required to reach the next tier.
    pub points_to_next_tier: i64,
}

/// A gift card with current balance and status.
///
/// MSL-10 fix: `pin` is a secret — it is excluded from serialization
/// (`skip_serializing`, with `default` so payloads from older clients
/// that still send it deserialize cleanly) and the manual `Debug` impl
/// redacts it, so neither a Tauri command response nor a log dump of the
/// struct can emit the plain PIN. Issuance takes the PIN through
/// [`IssueGiftCardInput::pin`]; the repository persists and reads it
/// directly.
#[derive(Clone, Serialize, Deserialize)]
pub struct GiftCard {
    /// Unique identifier.
    pub id: String,
    /// Human-readable card number (scannable barcode).
    pub card_number: String,
    /// PIN for balance checks (optional). Never serialized; see the
    /// struct-level MSL-10 note.
    #[serde(default, skip_serializing)]
    pub pin: String,
    /// Initial loaded value in minor units.
    pub initial_balance_minor: i64,
    /// Current redeemable value in minor units.
    pub current_balance_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Card status: active, frozen, redeemed, expired.
    pub status: String,
    /// Customer name this card was issued to (optional).
    pub issued_to: String,
    /// ISO-8601 issue date.
    pub issue_date: String,
    /// ISO-8601 expiry date (optional).
    pub expiry_date: Option<String>,
    /// Staff id who created this card.
    pub created_by: Option<String>,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl std::fmt::Debug for GiftCard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GiftCard")
            .field("id", &self.id)
            .field("card_number", &self.card_number)
            .field("pin", &"<redacted>")
            .field("initial_balance_minor", &self.initial_balance_minor)
            .field("current_balance_minor", &self.current_balance_minor)
            .field("currency", &self.currency)
            .field("status", &self.status)
            .field("issued_to", &self.issued_to)
            .field("issue_date", &self.issue_date)
            .field("expiry_date", &self.expiry_date)
            .field("created_by", &self.created_by)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

/// A single gift card transaction — issue, redeem, topup, refund.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GiftCardTransaction {
    /// Unique identifier.
    pub id: String,
    /// FK to `gift_cards.id`.
    pub gift_card_id: String,
    /// FK to `sales.id`, when tied to a sale.
    pub sale_id: Option<String>,
    /// Transaction type: issue, redeem, topup, refund.
    pub txn_type: String,
    /// Amount delta in minor units (positive for add, negative for deduct).
    pub amount_minor: i64,
    /// Balance after this transaction.
    pub balance_after_minor: i64,
    /// Human-readable notes.
    pub notes: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

/// Gift card with recent transactions (returned by detail API).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GiftCardWithTransactions {
    /// Gift card entity.
    pub card: GiftCard,
    /// Associated transactions.
    pub transactions: Vec<GiftCardTransaction>,
}

/// Input payload for issuing a new gift card.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueGiftCardInput {
    /// Card number.
    pub card_number: String,
    /// Optional PIN.
    pub pin: Option<String>,
    /// Initial amount minor.
    pub initial_amount_minor: i64,
    /// Currency.
    pub currency: String,
    /// Optional issued to customer.
    pub issued_to: Option<String>,
    /// Staff user ID created by.
    pub created_by: String,
    /// Optional expiry date.
    pub expiry_date: Option<String>,
}

/// Filter options for listing gift cards.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GiftCardFilter {
    /// Optional search term.
    pub search: Option<String>,
    /// Optional status filter.
    pub status: Option<String>,
    /// Optional issued_to filter.
    pub issued_to: Option<String>,
    /// Optional min_balance filter.
    pub min_balance: Option<i64>,
}

/// Result returned from a gift card redemption operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedeemGiftCardResult {
    /// Updated gift card.
    pub card: GiftCard,
    /// The redemption transaction.
    pub transaction: GiftCardTransaction,
}

#[cfg(test)]
#[path = "loyalty_tests.rs"]
mod tests;
