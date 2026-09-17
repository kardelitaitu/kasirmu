use super::*;

#[test]
fn test_gather_metrics_returns_text() {
    // Trigger lazy registration for at least one metric.
    sales_completed();
    let output = gather_metrics();
    assert!(output.contains("oz_pos_sales_completed_total"));
    assert!(output.starts_with('#'));
}

#[test]
fn test_counters_are_incrementable() {
    sales_completed().inc();
    sales_completed().inc_by(5);
    assert_eq!(sales_completed().get(), 6);
}

#[test]
fn test_histogram_observable() {
    barcode_lookup_duration().observe(0.001);
    barcode_lookup_duration().observe(0.002);
    let count = barcode_lookup_duration().get_sample_count();
    assert_eq!(count, 2);
}

#[test]
fn test_gauge_set_and_get() {
    inventory_level().set(42);
    assert_eq!(inventory_level().get(), 42);
    inventory_level().set(0);
    assert_eq!(inventory_level().get(), 0);
}

#[test]
fn test_transaction_commit_histogram_observable() {
    transaction_commit_duration().observe(0.01);
    transaction_commit_duration().observe(0.05);
    transaction_commit_duration().observe(0.1);
    let count = transaction_commit_duration().get_sample_count();
    assert_eq!(count, 3);
}

#[test]
fn test_cash_and_sync_gauges_default_zero() {
    // New gauges should default to 0.
    assert_eq!(cash_session_amount().get(), 0);
    assert_eq!(sync_queue_depth().get(), 0);
    cash_session_amount().set(5000);
    sync_queue_depth().set(3);
    assert_eq!(cash_session_amount().get(), 5000);
    assert_eq!(sync_queue_depth().get(), 3);
}
