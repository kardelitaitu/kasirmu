use super::*;

fn fresh_db() -> rusqlite::Connection {
    oz_core::migrations::fresh_db()
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

#[tokio::test]
async fn duplicate_order_id_is_rejected_not_merged() {
    let l = ledger();
    l.record_issue("QRIS-dup", "tenant-A", "sale-1", 1000, "IDR")
        .await
        .unwrap();
    // A collision means a retry that must not silently re-point the ledger.
    assert!(l.record_issue("QRIS-dup", "tenant-B", "sale-2", 9999, "IDR")
        .await
        .is_err());
    let e = l.lookup("QRIS-dup").await.unwrap().unwrap();
    assert_eq!(e.tenant_id, "tenant-A");
}

#[tokio::test]
async fn mark_status_records_non_terminal() {
    let l = ledger();
    l.record_issue("QRIS-o2", "tenant-A", "sale-2", 2000, "IDR")
        .await
        .unwrap();
    l.mark_status("QRIS-o2", "tenant-A", "expire").await.unwrap();
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
    l.mark_status("QRIS-o3", "tenant-A", "settlement").await.unwrap();
    l.mark_status("QRIS-o3", "tenant-A", "expire").await.unwrap();
    assert_eq!(
        l.lookup("QRIS-o3").await.unwrap().unwrap().status,
        "settlement"
    );
}

#[tokio::test]
async fn mark_status_scoped_by_order_id_only() {
    let l = ledger();
    l.record_issue("QRIS-x", "tenant-A", "sale-x", 10, "IDR").await.unwrap();
    l.record_issue("QRIS-y", "tenant-B", "sale-y", 20, "IDR").await.unwrap();
    l.mark_status("QRIS-x", "tenant-A", "capture").await.unwrap();
    assert_eq!(l.lookup("QRIS-y").await.unwrap().unwrap().status, "issued");
}
