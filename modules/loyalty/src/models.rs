/*
last audited 25-07-26 by RSA-Agent (modules-loyalty slice A: models deep read)
crate: modules-loyalty | status: SAFE | lint: CLEAN
findings: MSL-10 FIXED — pin is skip_serializing+default (JSON responses omit it) and Debug is a manual impl redacting it: any JSON serialization of a GiftCard (Tauri command response, log dump) emits the PIN, and Debug prints it; consistent with COR-17 plaintext-at-rest but adds wire/log exposure. Proposed: serde(skip_serializing) on pin plus a redacted Debug or manual impl. LoyaltyTier.earn_multiplier_millionths is fixed-point i64 (LOYALTY-01: was f64, migrated to millionths — points math never touches a float); earn/redeem service logic lives in kasirmu-core db/loyalty.rs (audited exemplary: idempotent per account+sale+txn, redeem validates server-side)
next: redact GiftCard pin in fix-order phase | perf: N/A
*/
//! Loyalty & Gift Card domain models.

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
mod tests {
    use super::*;

    // ── LoyaltyTier ─────────────────────────────────────────────────

    #[test]
    fn loyalty_tier_serde_roundtrip() {
        let tier = LoyaltyTier {
            id: "tier-1".into(),
            name: "Gold".into(),
            min_points: 1000,
            points_per_unit: 2,
            earn_multiplier_millionths: 1_500_000,
            colour: "#FFD700".into(),
            sort_order: 1,
            created_at: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&tier).unwrap();
        let back: LoyaltyTier = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "Gold");
        assert_eq!(back.min_points, 1000);
        assert_eq!(back.earn_multiplier_millionths, 1_500_000);
        assert_eq!(back.points_per_unit, 2);
    }

    // ── LoyaltyAccount ──────────────────────────────────────────────

    #[test]
    fn loyalty_account_serde_roundtrip() {
        let acct = LoyaltyAccount {
            id: "acct-1".into(),
            customer_id: "cust-1".into(),
            points: 500,
            lifetime_points: 2000,
            tier_id: Some("tier-1".into()),
            updated_at: "2025-06-01T00:00:00Z".into(),
            created_at: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&acct).unwrap();
        let back: LoyaltyAccount = serde_json::from_str(&json).unwrap();
        assert_eq!(back.points, 500);
        assert_eq!(back.lifetime_points, 2000);
        assert_eq!(back.tier_id.as_deref(), Some("tier-1"));
    }

    #[test]
    fn loyalty_account_tier_id_nullable() {
        let acct = LoyaltyAccount {
            id: "acct-2".into(),
            customer_id: "cust-2".into(),
            points: 0,
            lifetime_points: 0,
            tier_id: None,
            updated_at: "".into(),
            created_at: "".into(),
        };
        let json = serde_json::to_string(&acct).unwrap();
        let back: LoyaltyAccount = serde_json::from_str(&json).unwrap();
        assert!(back.tier_id.is_none());
    }

    // ── LoyaltyTransaction ──────────────────────────────────────────

    #[test]
    fn loyalty_transaction_serde_roundtrip() {
        let txn = LoyaltyTransaction {
            id: "txn-1".into(),
            account_id: "acct-1".into(),
            sale_id: Some("sale-1".into()),
            points: 100,
            txn_type: "earn".into(),
            description: "Purchase reward".into(),
            created_at: "2025-06-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&txn).unwrap();
        let back: LoyaltyTransaction = serde_json::from_str(&json).unwrap();
        assert_eq!(back.points, 100);
        assert_eq!(back.txn_type, "earn");
        assert_eq!(back.sale_id.as_deref(), Some("sale-1"));
    }

    #[test]
    fn loyalty_transaction_negative_points_for_redeem() {
        let txn = LoyaltyTransaction {
            id: "txn-2".into(),
            account_id: "acct-1".into(),
            sale_id: None,
            points: -200,
            txn_type: "redeem".into(),
            description: "Redeemed at checkout".into(),
            created_at: "".into(),
        };
        let json = serde_json::to_string(&txn).unwrap();
        let back: LoyaltyTransaction = serde_json::from_str(&json).unwrap();
        assert_eq!(back.points, -200);
    }

    // ── GiftCard ────────────────────────────────────────────────────

    #[test]
    fn gift_card_serde_roundtrip() {
        let card = GiftCard {
            id: "gc-1".into(),
            card_number: "1234-5678-9012-3456".into(),
            pin: "1234".into(),
            initial_balance_minor: 50000,
            current_balance_minor: 35000,
            currency: "IDR".into(),
            status: "active".into(),
            issued_to: "John".into(),
            issue_date: "2025-01-01".into(),
            expiry_date: Some("2026-01-01".into()),
            created_by: Some("user-1".into()),
            updated_at: "2025-06-01".into(),
        };
        let json = serde_json::to_string(&card).unwrap();
        let back: GiftCard = serde_json::from_str(&json).unwrap();
        assert_eq!(back.card_number, "1234-5678-9012-3456");
        assert_eq!(back.current_balance_minor, 35000);
        assert_eq!(back.currency, "IDR");
        assert_eq!(back.status, "active");
        assert_eq!(back.expiry_date.as_deref(), Some("2026-01-01"));
    }

    #[test]
    fn gift_card_nullable_fields() {
        let card = GiftCard {
            id: "gc-2".into(),
            card_number: "0000".into(),
            pin: "".into(),
            initial_balance_minor: 10000,
            current_balance_minor: 10000,
            currency: "USD".into(),
            status: "active".into(),
            issued_to: "".into(),
            issue_date: "".into(),
            expiry_date: None,
            created_by: None,
            updated_at: "".into(),
        };
        let json = serde_json::to_string(&card).unwrap();
        let back: GiftCard = serde_json::from_str(&json).unwrap();
        assert!(back.expiry_date.is_none());
        assert!(back.created_by.is_none());
    }

    // ── GiftCardTransaction ─────────────────────────────────────────

    #[test]
    fn gift_card_transaction_serde_roundtrip() {
        let txn = GiftCardTransaction {
            id: "gct-1".into(),
            gift_card_id: "gc-1".into(),
            sale_id: Some("sale-1".into()),
            txn_type: "redeem".into(),
            amount_minor: -5000,
            balance_after_minor: 30000,
            notes: "Used at checkout".into(),
            created_at: "2025-06-01".into(),
        };
        let json = serde_json::to_string(&txn).unwrap();
        let back: GiftCardTransaction = serde_json::from_str(&json).unwrap();
        assert_eq!(back.amount_minor, -5000);
        assert_eq!(back.balance_after_minor, 30000);
        assert_eq!(back.txn_type, "redeem");
    }

    // ── LoyaltyAccountWithDetails ───────────────────────────────────

    #[test]
    fn loyalty_account_with_details_serde_roundtrip() {
        let details = LoyaltyAccountWithDetails {
            account: LoyaltyAccount {
                id: "acct-1".into(),
                customer_id: "cust-1".into(),
                points: 500,
                lifetime_points: 2000,
                tier_id: Some("tier-1".into()),
                updated_at: "".into(),
                created_at: "".into(),
            },
            tier: Some(LoyaltyTier {
                id: "tier-1".into(),
                name: "Gold".into(),
                min_points: 1000,
                points_per_unit: 2,
                earn_multiplier_millionths: 1_500_000,
                colour: "#FFD700".into(),
                sort_order: 1,
                created_at: "".into(),
            }),
            recent_transactions: vec![],
            next_tier: None,
            points_to_next_tier: 500,
        };
        let json = serde_json::to_string(&details).unwrap();
        let back: LoyaltyAccountWithDetails = serde_json::from_str(&json).unwrap();
        assert_eq!(back.account.points, 500);
        assert_eq!(back.tier.as_ref().unwrap().name, "Gold");
        assert!(back.next_tier.is_none());
        assert_eq!(back.points_to_next_tier, 500);
    }

    // ── GiftCardWithTransactions ────────────────────────────────────

    #[test]
    fn gift_card_with_transactions_serde_roundtrip() {
        let g = GiftCardWithTransactions {
            card: GiftCard {
                id: "gc-1".into(),
                card_number: "1111".into(),
                pin: "".into(),
                initial_balance_minor: 10000,
                current_balance_minor: 5000,
                currency: "USD".into(),
                status: "active".into(),
                issued_to: "".into(),
                issue_date: "".into(),
                expiry_date: None,
                created_by: None,
                updated_at: "".into(),
            },
            transactions: vec![],
        };
        let json = serde_json::to_string(&g).unwrap();
        let back: GiftCardWithTransactions = serde_json::from_str(&json).unwrap();
        assert_eq!(back.card.current_balance_minor, 5000);
        assert!(back.transactions.is_empty());
    }

    // ── IssueGiftCardInput ──────────────────────────────────────────

    #[test]
    fn issue_gift_card_input_serde_roundtrip() {
        let input = IssueGiftCardInput {
            card_number: "9999".into(),
            pin: Some("1234".into()),
            initial_amount_minor: 25000,
            currency: "IDR".into(),
            issued_to: Some("Jane".into()),
            created_by: "user-1".into(),
            expiry_date: None,
        };
        let json = serde_json::to_string(&input).unwrap();
        let back: IssueGiftCardInput = serde_json::from_str(&json).unwrap();
        assert_eq!(back.card_number, "9999");
        assert_eq!(back.initial_amount_minor, 25000);
        assert!(back.pin.is_some());
    }

    // ── GiftCardFilter ──────────────────────────────────────────────

    #[test]
    fn gift_card_filter_default_is_empty() {
        let f = GiftCardFilter::default();
        assert!(f.search.is_none());
        assert!(f.status.is_none());
        assert!(f.issued_to.is_none());
        assert!(f.min_balance.is_none());
    }

    #[test]
    fn gift_card_filter_serde_roundtrip() {
        let f = GiftCardFilter {
            search: Some("card".into()),
            status: Some("active".into()),
            issued_to: Some("John".into()),
            min_balance: Some(1000),
        };
        let json = serde_json::to_string(&f).unwrap();
        let back: GiftCardFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(back.search.as_deref(), Some("card"));
        assert_eq!(back.min_balance, Some(1000));
    }

    // ── RedeemGiftCardResult ────────────────────────────────────────

    #[test]
    fn redeem_gift_card_result_serde_roundtrip() {
        let r = RedeemGiftCardResult {
            card: GiftCard {
                id: "gc-1".into(),
                card_number: "1111".into(),
                pin: "".into(),
                initial_balance_minor: 10000,
                current_balance_minor: 5000,
                currency: "USD".into(),
                status: "active".into(),
                issued_to: "".into(),
                issue_date: "".into(),
                expiry_date: None,
                created_by: None,
                updated_at: "".into(),
            },
            transaction: GiftCardTransaction {
                id: "gct-1".into(),
                gift_card_id: "gc-1".into(),
                sale_id: None,
                txn_type: "redeem".into(),
                amount_minor: -5000,
                balance_after_minor: 5000,
                notes: "".into(),
                created_at: "".into(),
            },
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: RedeemGiftCardResult = serde_json::from_str(&json).unwrap();
        assert_eq!(back.card.current_balance_minor, 5000);
        assert_eq!(back.transaction.amount_minor, -5000);
    }
}

#[test]
fn gift_card_pin_is_never_serialized_or_debugged() {
    // MSL-10 fix: the plain PIN must not reach JSON responses or Debug
    // output (Tauri command responses, log dumps).
    let card = GiftCard {
        id: "gc-1".into(),
        card_number: "9999".into(),
        pin: "1234".into(),
        initial_balance_minor: 25000,
        current_balance_minor: 25000,
        currency: "USD".into(),
        status: "active".into(),
        issued_to: "Jane".into(),
        issue_date: "2026-08-30".into(),
        expiry_date: None,
        created_by: Some("user-1".into()),
        updated_at: "2026-08-30T00:00:00Z".into(),
    };

    let json = serde_json::to_string(&card).unwrap();
    assert!(
        !json.contains("1234"),
        "serialized JSON must not contain the PIN"
    );
    assert!(
        !json.contains("\"pin\""),
        "serialized JSON must omit the pin field"
    );

    let dbg = format!("{card:?}");
    assert!(
        !dbg.contains("1234"),
        "Debug output must not contain the PIN"
    );
    assert!(
        dbg.contains("<redacted>"),
        "Debug output must redact the pin"
    );

    // Deserialization defaults the omitted pin to empty (older payloads
    // keep working; issuance carries the PIN via IssueGiftCardInput).
    let back: GiftCard = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, "gc-1");
    assert_eq!(back.pin, "");
}
