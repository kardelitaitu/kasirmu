use super::*;

fn fresh_db() -> rusqlite::Connection {
    kasirmu_core::migrations::fresh_db()
}

fn ledger() -> LedgerDb {
    LedgerDb {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
    }
}

#[tokio::test]
async fn record_and_lookup_roundtrip() {
    let l = ledger();
    l.record_issue("QRIS-o1", "tenant-A", "sale-1", 15000, "IDR")
        .await
        .unwrap();
    let e = l.lookup("QRIS-o1").await.unwrap().expect("row present");
    assert_eq!(e.tenant_id, "tenant-A");
    assert_eq!(e.sale_id, "sale-1");
    assert_eq!(e.amount_minor, 15000);
    assert_eq!(e.status, "issued");
}

#[tokio::test]
async fn lookup_unknown_order_is_none() {
    assert!(ledger().lookup("QRIS-nope").await.unwrap().is_none());
}

/// A collision is still REFUSED — the invariant the replay case must not have
/// relaxed.
///
/// **Read with the test below, because the pair is the rule.** `record_issue`
/// became idempotent for a RETRY under R9(a) (2026-09-25), and the risk of that
/// change is exactly that "idempotent" quietly becomes "overwrite": two different
/// charges claiming one `order_id` must never merge, or one sale's settlement is
/// attributed to another. This case supplies DIFFERENT tenant, sale and amount for
/// the same key, which is the collision, and it must still fail. The case below
/// supplies IDENTICAL facts, which is the replay, and it must succeed. A future
/// edit that makes both succeed, or both fail, breaks one of the two and is caught
/// here.
#[tokio::test]
async fn duplicate_order_id_is_rejected_not_merged() {
    let l = ledger();
    l.record_issue("QRIS-dup", "tenant-A", "sale-1", 1000, "IDR")
        .await
        .unwrap();
    assert!(
        l.record_issue("QRIS-dup", "tenant-B", "sale-2", 9999, "IDR")
            .await
            .is_err(),
        "a different charge under the same order_id must not be merged into it"
    );
    let e = l.lookup("QRIS-dup").await.unwrap().unwrap();
    assert_eq!(e.tenant_id, "tenant-A", "the first charge must be untouched");
    assert_eq!(e.sale_id, "sale-1");
    assert_eq!(e.amount_minor, 1000);
}

/// A RETRY of the same charge is absorbed, not reported as a failure.
///
/// **This is the case R9(a) turned from a 500 into a success.** Once the gateway
/// key is derived from `sale_id`, a timeout-plus-retry reaches the server with the
/// SAME `order_id` — and before this change the ledger's bare INSERT answered
/// `UNIQUE constraint failed`, so the endpoint replied
/// `500 charge issued but not journaled` for a charge that was live AND correctly
/// journaled. The caller was told to reconcile manually a row that was already
/// right.
///
/// Same four facts, twice: the second call must be a no-op success, and the stored
/// row must be the one the first call wrote.
#[tokio::test]
async fn identical_retry_is_absorbed_as_a_replay() {
    let l = ledger();
    l.record_issue("QRIS-replay", "tenant-A", "sale-1", 1000, "IDR")
        .await
        .unwrap();
    l.record_issue("QRIS-replay", "tenant-A", "sale-1", 1000, "IDR")
        .await
        .expect("a replay of the same charge must succeed, not collide");
    let e = l.lookup("QRIS-replay").await.unwrap().unwrap();
    assert_eq!(e.tenant_id, "tenant-A");
    assert_eq!(e.sale_id, "sale-1");
    assert_eq!(e.amount_minor, 1000);
    assert_eq!(e.status, "issued", "a replay must not move the row's status");
}

#[tokio::test]
async fn mark_status_records_non_terminal() {
    let l = ledger();
    l.record_issue("QRIS-o2", "tenant-A", "sale-2", 2000, "IDR")
        .await
        .unwrap();
    l.mark_status("QRIS-o2", "tenant-A", "expire")
        .await
        .unwrap();
    assert_eq!(l.lookup("QRIS-o2").await.unwrap().unwrap().status, "expire");
}

#[tokio::test]
async fn settled_row_never_downgrades() {
    // Notifications can arrive out of order; settlement must win over a
    // late expire/cancel so the anomaly is observable, not destructive.
    let l = ledger();
    l.record_issue("QRIS-o3", "tenant-A", "sale-3", 3000, "IDR")
        .await
        .unwrap();
    l.mark_status("QRIS-o3", "tenant-A", "settlement")
        .await
        .unwrap();
    l.mark_status("QRIS-o3", "tenant-A", "expire")
        .await
        .unwrap();
    assert_eq!(
        l.lookup("QRIS-o3").await.unwrap().unwrap().status,
        "settlement"
    );
}

#[tokio::test]
async fn mark_status_scoped_by_order_id_only() {
    let l = ledger();
    l.record_issue("QRIS-x", "tenant-A", "sale-x", 10, "IDR")
        .await
        .unwrap();
    l.record_issue("QRIS-y", "tenant-B", "sale-y", 20, "IDR")
        .await
        .unwrap();
    l.mark_status("QRIS-x", "tenant-A", "capture")
        .await
        .unwrap();
    assert_eq!(l.lookup("QRIS-y").await.unwrap().unwrap().status, "issued");
}

/// An `amount_mismatch` row is NOT overwritten by a later notification.
///
/// **This pins a discrepancy the code carries and the tests do not cover.**
/// `webhooks/midtrans.rs:219-221` treats THREE statuses as terminal when deciding
/// whether a redelivery is "already processed": `settlement`, `capture`, **and**
/// `amount_mismatch`. But `MarkStatus`'s SQL guard protects only two of them
/// (`midtrans_ledger.rs:297`, `:320`: `status NOT IN ('settlement', 'capture')`).
///
/// **The consequence is money-shaped.** `amount_mismatch` is the flag that says *a
/// correctly-signed settlement disagreed with what we charged*. A later notification
/// — Midtrans redelivers, and a `pending` or `expire` follow-up is ordinary —
/// overwrites the row, and the incident stops being visible to anyone reading the
/// ledger. The discrepancy does not disappear; only the record of it does.
///
/// The test drives the LEDGER directly rather than the webhook, because the guard
/// is `mark_status`'s: routing through the webhook would also exercise the
/// already-processed short-circuit, and a test that fails for the wrong reason is
/// not a test of the guard.
#[tokio::test]
async fn amount_mismatch_is_never_overwritten_by_a_later_status() {
    let l = ledger();
    l.record_issue("QRIS-mm", "tenant-A", "sale-mm", 15000, "IDR")
        .await
        .unwrap();
    l.mark_status("QRIS-mm", "tenant-A", "amount_mismatch")
        .await
        .unwrap();
    assert_eq!(
        l.lookup("QRIS-mm").await.unwrap().unwrap().status,
        "amount_mismatch",
        "the mismatch must be recorded"
    );

    // A later, ordinary lifecycle notification. It must NOT erase the incident.
    l.mark_status("QRIS-mm", "tenant-A", "expire")
        .await
        .unwrap();
    assert_eq!(
        l.lookup("QRIS-mm").await.unwrap().unwrap().status,
        "amount_mismatch",
        "an amount mismatch is terminal: a later notification must not erase the record of a signed-amount discrepancy"
    );
}


// ── The terminal set is defined twice and must stay one set ────────────

/// The ledger guard and the webhook's already-processed check list the SAME
/// terminal statuses.
///
/// **This is the guard for `16a2f454c`, written because the defect it fixed was a
/// DRIFT, not a mistake.** The terminal set has two definitions in two files:
/// `mark_status`'s SQL guard (which protects a row from being overwritten) and the
/// webhook's `already_processed` check (which decides a redelivery needs no work).
/// They were `settlement`/`capture` and `settlement`/`capture`/`amount_mismatch` —
/// so a mismatch row was overwritable by any later notification, erasing the record
/// of a signed-amount discrepancy while the discrepancy itself remained.
///
/// The two sites are correct now, and neither test in this file would notice if one
/// drifted again: each exercises its OWN site. So the agreement itself is asserted
/// here, by reading both definitions out of source. Read rather than exercised,
/// because the property is *"these two lists are the same list"* and no single
/// runtime path can observe both.
///
/// If this fails after a deliberate change, update BOTH sites — and check the two
/// module docs (`midtrans_ledger.rs`, `webhooks/midtrans.rs`), which state the set
/// in prose as well.
#[test]
fn the_terminal_status_set_is_defined_once_in_effect() {
    // Paths are relative to THIS file, which sits in `src/` beside the ledger
    // module and above `webhooks/`.
    let ledger = include_str!("midtrans_ledger.rs");
    let webhook = include_str!("webhooks/midtrans.rs");

    // Every quoted status in the ledger's SQL guards.
    const GUARD: &str = "status NOT IN (";
    let mut guard_sets: Vec<&str> = Vec::new();
    let mut rest = ledger;
    while let Some(i) = rest.find(GUARD) {
        let after = &rest[i + GUARD.len()..];
        let end = after.find(')').expect("guard list must close");
        guard_sets.push(&after[..end]);
        rest = &after[end..];
    }
    assert_eq!(
        guard_sets.len(),
        2,
        "expected exactly two SQL guard arms (Postgres + SQLite); found {}. If a third was added, keep it in step with the others and update this count.",
        guard_sets.len()
    );
    // Both arms must agree with each other first — the PG/SQLite split is itself a
    // place where they could diverge.
    assert_eq!(
        guard_sets[0], guard_sets[1],
        "the Postgres and SQLite arms of the ledger guard disagree"
    );

    // The statuses the webhook treats as already-processed.
    let webhook_set = ["settlement", "capture", "amount_mismatch"];
    for status in webhook_set {
        assert!(
            guard_sets[0].contains(&format!("'{status}'")),
            "the webhook treats `{status}` as terminal but the ledger guard does not, so a row in that status can be overwritten. Guard reads: {}",
            guard_sets[0]
        );
    }
    // And the guard must not protect something the webhook does not know about —
    // the other direction, which would mean a row that can never be updated.
    for quoted in guard_sets[0].split(',') {
        let name = quoted.trim().trim_matches('\'');
        assert!(
            webhook_set.contains(&name),
            "the ledger guard protects `{name}`, which the webhook's already-processed check does not list. Add it there or remove it here."
        );
    }
    // The webhook's own comparison must actually name all three.
    for status in webhook_set {
        assert!(
            webhook.contains(&format!("entry.status == \"{status}\"")),
            "the webhook no longer compares against `{status}`"
        );
    }
}
