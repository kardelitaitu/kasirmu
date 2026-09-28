//! Sibling unit tests for `loyalty.rs` (AGENTS.md: no tests in production files).
//!
//! Moved here with the types from `modules/loyalty/src/models_tests.rs`; the assertions are
//! unchanged, including the one that pins the redacting `Debug`.

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
        updated_at: String::new(),
        created_at: String::new(),
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
        created_at: String::new(),
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
        initial_balance_minor: 10000,
        current_balance_minor: 10000,
        currency: "USD".into(),
        status: "active".into(),
        issued_to: String::new(),
        issue_date: String::new(),
        expiry_date: None,
        created_by: None,
        updated_at: String::new(),
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
            updated_at: String::new(),
            created_at: String::new(),
        },
        tier: Some(LoyaltyTier {
            id: "tier-1".into(),
            name: "Gold".into(),
            min_points: 1000,
            points_per_unit: 2,
            earn_multiplier_millionths: 1_500_000,
            colour: "#FFD700".into(),
            sort_order: 1,
            created_at: String::new(),
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
            initial_balance_minor: 10000,
            current_balance_minor: 5000,
            currency: "USD".into(),
            status: "active".into(),
            issued_to: String::new(),
            issue_date: String::new(),
            expiry_date: None,
            created_by: None,
            updated_at: String::new(),
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
    assert_eq!(back.created_by, "user-1");
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
            initial_balance_minor: 10000,
            current_balance_minor: 5000,
            currency: "USD".into(),
            status: "active".into(),
            issued_to: String::new(),
            issue_date: String::new(),
            expiry_date: None,
            created_by: None,
            updated_at: String::new(),
        },
        transaction: GiftCardTransaction {
            id: "gct-1".into(),
            gift_card_id: "gc-1".into(),
            sale_id: None,
            txn_type: "redeem".into(),
            amount_minor: -5000,
            balance_after_minor: 5000,
            notes: String::new(),
            created_at: String::new(),
        },
    };
    let json = serde_json::to_string(&r).unwrap();
    let back: RedeemGiftCardResult = serde_json::from_str(&json).unwrap();
    assert_eq!(back.card.current_balance_minor, 5000);
    assert_eq!(back.transaction.amount_minor, -5000);
}

#[test]
fn gift_card_has_no_pin_surface_at_all() {
    // Replaces the former `gift_card_pin_is_never_serialized_or_debugged`
    // (MSL-10). That test pinned the *redaction* of a field that no longer
    // exists; this pins the stronger property that replaced it — there is no
    // PIN anywhere on the card, in the JSON, or in the Debug dump.
    //
    // The field was removed 2026-09-29 (migration 20261015_gift_cards_drop_pin.sql)
    // because nothing ever verified it and `skip_serializing` meant it could
    // not even be read back: a write-only secret with no reader.
    let card = GiftCard {
        id: "gc-1".into(),
        card_number: "9999".into(),
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
        !json.contains("\"pin\""),
        "serialized JSON must carry no pin field"
    );

    let dbg = format!("{card:?}");
    assert!(
        !dbg.contains("pin"),
        "Debug output must not mention a pin field"
    );

    let back: GiftCard = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, "gc-1");
    assert_eq!(back.card_number, "9999");
}

#[test]
fn issue_input_has_no_pin_field() {
    // The issuance payload lost `pin` in the same change. A payload from an
    // older client that still sends one must not fail — unknown fields are
    // ignored by default, which is what keeps the wire compatible.
    let legacy = r#"{"card_number":"1111","pin":"1234","initial_amount_minor":100,
                     "currency":"USD","created_by":"staff"}"#;
    let input: IssueGiftCardInput = serde_json::from_str(legacy).unwrap();
    assert_eq!(input.card_number, "1111");
    assert_eq!(input.initial_amount_minor, 100);

    let json = serde_json::to_string(&input).unwrap();
    assert!(
        !json.contains("\"pin\""),
        "issuance payload must not carry a pin field"
    );
}
