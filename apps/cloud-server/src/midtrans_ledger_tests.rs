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
