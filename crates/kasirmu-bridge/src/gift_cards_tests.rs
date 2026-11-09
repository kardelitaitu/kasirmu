use super::*;

// ── Existing tests (preserved) ────────────────────────────────────

#[test]
fn balance_result_debug() {
    let result = BalanceResult {
        balance_minor: 1500,
        currency: "USD".into(),
        status: "active".into(),
    };
    let d = format!("{result:?}");
    assert!(d.contains("1500"));
}

#[test]
fn balance_result_serialize() {
    let result = BalanceResult {
        balance_minor: 2500,
        currency: "IDR".into(),
        status: "active".into(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["balance_minor"], 2500);
    assert_eq!(json["currency"], "IDR");
}

#[test]
fn balance_result_zero_and_empty() {
    let result = BalanceResult {
        balance_minor: 0,
        currency: "".into(),
        status: "".into(),
    };
    assert_eq!(result.balance_minor, 0);
}

// ── Helper ────────────────────────────────────────────────────────

// ── CRUD tests ────────────────────────────────────────────────────

/*
 * THE BRIDGE LEG OF THE CURRENCY GUARD.
 *
 * Round 247 threaded the entered currency through every layer so core could refuse a
 * gift card used in a different denomination. Round 248 mutated the bridge to pass
 * `None` -- silently discarding the currency -- and EVERY bridge test still passed:
 * this file had three cases, all about BalanceResult serialisation, and none called a
 * bridge function at all. The layer that carries the value was the layer nobody graded.
 *
 * The assertion is the observable consequence at the bridge boundary: the call is
 * refused for currency. That refusal cannot happen unless the currency survived the
 * hop, so this grades the forward rather than re-grading core (which has its own case).
 */
#[tokio::test]
async fn redeem_gift_card_scoped_forwards_the_currency_it_was_given() {
    use crate::testing::TestBridge;
    use kasirmu_core::db::Store;

    let bridge = TestBridge::new();
    let token = bridge
        .token_granting(kasirmu_core::permissions::GIFTCARDS_REDEEM)
        .await;

    // Seed a KWD card in the very store DB the scoped path opens.
    {
        // Seed the store the SESSION resolves to, not a guessed one: resolve_scope
        // opens session.store_id, and seeding "default" puts the card in a database
        // the scoped call never reads (learned the hard way this round).
        let store_id = bridge
            .sessions()
            .read()
            .unwrap()
            .get(&token)
            .map(|s| s.store_id.clone())
            .expect("token_granting must have registered the session");
        let conn = bridge.db_manager().open_store(&store_id).unwrap();
        let guard = conn.lock().unwrap();
        // created_by is a FK to users; seed the role and user the same way
        // crates/kasirmu-core/src/db/gift_cards_tests.rs::seed_user does.
        guard
            .execute(
                "INSERT OR IGNORE INTO roles (id, name, description, permissions, created_at, updated_at) 
                 VALUES ('role-owner', 'Owner', 'Owner role', '[\"*\"]', 
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
                [],
            )
            .expect("seed role");
        guard
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at) 
                 VALUES ('staff-1', 'staff-1', 'hash', 'staff-1', 'role-owner', 
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
                [],
            )
            .expect("seed user");

        // The sale the redemption names must EXIST, or a dropped currency is masked by a
        // foreign-key failure on the ledger insert and the test reddens for the wrong
        // reason. With the row present, losing the currency means the card is DRAINED
        // and the redemption SUCCEEDS -- which is the real failure this test must catch.
        guard
            .execute(
                "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor) 
                 VALUES ('sale-bridge-cur', 5000, 'KWD', 0, 'completed', 
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 5000, 0)",
                [],
            )
            .expect("seed the sale the redemption names");
        let store = Store::new(&guard);
        store
            .issue_gift_card(kasirmu_core::gift_card::IssueGiftCardInput {
                card_number: "GC-BRIDGE-CUR".into(),
                initial_amount_minor: 5000,
                currency: "KWD".into(),
                issued_to: None,
                created_by: "staff-1".into(),
                expiry_date: None,
            })
            .expect("seed the KWD card the assertion needs");
    }

    let ctx = bridge.ctx();
    let result = super::redeem_gift_card_scoped(
        &ctx,
        "GC-BRIDGE-CUR",
        1000,
        "IDR",
        "sale-bridge-cur",
        &token,
    )
    .await;

    let err = result.expect_err(
        "a KWD card redeemed as IDR must be refused; if the bridge drops the currency \
         this call succeeds and drains the card",
    );
    let text = format!("{err}").to_lowercase();
    assert!(
        text.contains("currency"),
        "expected a currency refusal to reach the caller, got: {err}"
    );
}

/*
 * THE TOP-UP LEG OF THE SAME GUARD.
 *
 * Round 248 gave redeem a bridge-level test after mutating the bridge to drop the
 * currency left every test green. The top-up leg was changed the same way in round
 * 247 and is a SEPARATE forward -- its own `Some(currency)` at gift_cards.rs:167 --
 * so the redeem case does not cover it. Measured 2026-10-26 (round 249): replacing
 * that forward with `None` left all four bridge tests passing. The gap was real and
 * the symmetry was an assumption.
 *
 * Top-up needs no sale row (the ledger's sale_id is NULL), so the only confound is the
 * card's own currency. If the currency is dropped, the top-up SUCCEEDS and credits a
 * KWD card with a number quoted in IDR -- a 1000x under-credit written into stored
 * value.
 */
#[tokio::test]
async fn top_up_gift_card_scoped_forwards_the_currency_it_was_given() {
    use crate::testing::TestBridge;
    use kasirmu_core::db::Store;

    let bridge = TestBridge::new();
    let token = bridge
        .token_granting(kasirmu_core::permissions::GIFTCARDS_ISSUE)
        .await;

    {
        let store_id = bridge
            .sessions()
            .read()
            .unwrap()
            .get(&token)
            .map(|s| s.store_id.clone())
            .expect("token_granting must have registered the session");
        let conn = bridge.db_manager().open_store(&store_id).unwrap();
        let guard = conn.lock().unwrap();
        guard
            .execute(
                "INSERT OR IGNORE INTO roles (id, name, description, permissions, created_at, updated_at)
                 VALUES ('role-owner', 'Owner', 'Owner role', '[\"*\"]',
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
                [],
            )
            .expect("seed role");
        guard
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at)
                 VALUES ('staff-1', 'staff-1', 'hash', 'staff-1', 'role-owner',
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
                [],
            )
            .expect("seed user");
        let store = Store::new(&guard);
        store
            .issue_gift_card(kasirmu_core::gift_card::IssueGiftCardInput {
                card_number: "GC-BRIDGE-TOPUP".into(),
                initial_amount_minor: 5000,
                currency: "KWD".into(),
                issued_to: None,
                created_by: "staff-1".into(),
                expiry_date: None,
            })
            .expect("seed the KWD card the assertion needs");
    }

    let ctx = bridge.ctx();
    let result = super::top_up_gift_card_scoped(&ctx, "GC-BRIDGE-TOPUP", 1000, "IDR", &token).await;

    let err = result.expect_err(
        "a KWD card topped up as IDR must be refused; if the bridge drops the currency \
         this call succeeds and credits the card with a number quoted in another denomination",
    );
    let text = format!("{err}").to_lowercase();
    assert!(
        text.contains("currency"),
        "expected a currency refusal to reach the caller, got: {err}"
    );
}
