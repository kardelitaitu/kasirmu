use super::*;

fn sample_transfer() -> StockTransfer {
    StockTransfer {
        id: "st-001".into(),
        transfer_number: "TRF-20260701-001".into(),
        status: "draft".into(),
        source_location: Some("Warehouse A".into()),
        destination_location: Some("Store B".into()),
        source_terminal_id: Some("term-1".into()),
        destination_terminal_id: Some("term-2".into()),
        notes: "Urgent restock".into(),
        created_by: "staff-1".into(),
        received_by: None,
        created_at: "2026-07-01T00:00:00.000Z".into(),
        sent_at: None,
        received_at: None,
        updated_at: "2026-07-01T00:00:00.000Z".into(),
    }
}

// ── Serde roundtrips ─────────────────────────────────────────

#[test]
fn stock_transfer_serde_roundtrip() {
    let transfer = sample_transfer();
    let json = serde_json::to_string(&transfer).unwrap();
    let back: StockTransfer = serde_json::from_str(&json).unwrap();
    assert_eq!(transfer.id, back.id);
    assert_eq!(transfer.transfer_number, back.transfer_number);
    assert_eq!(transfer.status, back.status);
    assert_eq!(transfer.source_location, back.source_location);
    assert_eq!(transfer.destination_location, back.destination_location);
}

#[test]
fn stock_transfer_sent_and_received() {
    let mut transfer = sample_transfer();
    transfer.status = "in_transit".into();
    transfer.sent_at = Some("2026-07-01T10:00:00.000Z".into());
    transfer.received_at = Some("2026-07-01T14:00:00.000Z".into());
    transfer.received_by = Some("staff-2".into());

    let json = serde_json::to_string(&transfer).unwrap();
    let back: StockTransfer = serde_json::from_str(&json).unwrap();
    assert_eq!(back.status, "in_transit");
    assert_eq!(back.sent_at, Some("2026-07-01T10:00:00.000Z".into()));
    assert_eq!(back.received_at, Some("2026-07-01T14:00:00.000Z".into()));
    assert_eq!(back.received_by, Some("staff-2".into()));
}

#[test]
fn stock_transfer_line_serde_roundtrip() {
    let line = StockTransferLine {
        id: "stl-1".into(),
        transfer_id: "st-001".into(),
        sku: "SKU-123".into(),
        product_name: "Widget".into(),
        qty: 10,
        received_qty: 0,
    };
    let json = serde_json::to_string(&line).unwrap();
    let back: StockTransferLine = serde_json::from_str(&json).unwrap();
    assert_eq!(line.id, back.id);
    assert_eq!(line.sku, back.sku);
    assert_eq!(line.qty, back.qty);
    assert_eq!(line.received_qty, back.received_qty);
}

#[test]
fn stock_transfer_line_partial_receive() {
    let line = StockTransferLine {
        id: "stl-2".into(),
        transfer_id: "st-001".into(),
        sku: "SKU-456".into(),
        product_name: "Gadget".into(),
        qty: 20,
        received_qty: 15,
    };
    assert_eq!(line.qty, 20);
    assert_eq!(line.received_qty, 15);
    assert!(line.received_qty < line.qty);
}

// ── Status variants ──────────────────────────────────────────

#[test]
fn stock_transfer_pending_status() {
    let mut transfer = sample_transfer();
    transfer.status = "pending".into();
    let json = serde_json::to_string(&transfer).unwrap();
    let back: StockTransfer = serde_json::from_str(&json).unwrap();
    assert_eq!(back.status, "pending");
}

#[test]
fn stock_transfer_in_transit_status() {
    let mut transfer = sample_transfer();
    transfer.status = "in_transit".into();
    transfer.sent_at = Some("2026-07-01T10:00:00.000Z".into());
    let json = serde_json::to_string(&transfer).unwrap();
    let back: StockTransfer = serde_json::from_str(&json).unwrap();
    assert_eq!(back.status, "in_transit");
    assert!(back.sent_at.is_some());
}

#[test]
fn stock_transfer_received_status() {
    let mut transfer = sample_transfer();
    transfer.status = "received".into();
    transfer.received_by = Some("staff-2".into());
    transfer.received_at = Some("2026-07-01T14:00:00.000Z".into());
    let json = serde_json::to_string(&transfer).unwrap();
    let back: StockTransfer = serde_json::from_str(&json).unwrap();
    assert_eq!(back.status, "received");
    assert_eq!(back.received_by, Some("staff-2".into()));
    assert!(back.received_at.is_some());
}

#[test]
fn stock_transfer_cancelled_status() {
    let mut transfer = sample_transfer();
    transfer.status = "cancelled".into();
    // Cancelled transfers should not have received data.
    transfer.received_by = None;
    transfer.received_at = None;
    transfer.sent_at = None;
    let json = serde_json::to_string(&transfer).unwrap();
    let back: StockTransfer = serde_json::from_str(&json).unwrap();
    assert_eq!(back.status, "cancelled");
    assert!(back.received_by.is_none());
    assert!(back.received_at.is_none());
}

// ── Edge cases ───────────────────────────────────────────────

#[test]
fn stock_transfer_no_locations() {
    let mut transfer = sample_transfer();
    transfer.source_location = None;
    transfer.destination_location = None;
    transfer.source_terminal_id = None;
    transfer.destination_terminal_id = None;
    let json = serde_json::to_string(&transfer).unwrap();
    let back: StockTransfer = serde_json::from_str(&json).unwrap();
    assert_eq!(back.source_location, None);
    assert_eq!(back.destination_location, None);
    assert_eq!(back.source_terminal_id, None);
    assert_eq!(back.destination_terminal_id, None);
}

#[test]
fn stock_transfer_empty_notes() {
    let mut transfer = sample_transfer();
    transfer.notes = "".into();
    let json = serde_json::to_string(&transfer).unwrap();
    let back: StockTransfer = serde_json::from_str(&json).unwrap();
    assert_eq!(back.notes, "");
}

#[test]
fn stock_transfer_line_full_receive() {
    let line = StockTransferLine {
        id: "stl-3".into(),
        transfer_id: "st-001".into(),
        sku: "SKU-789".into(),
        product_name: "Thingamajig".into(),
        qty: 5,
        received_qty: 5,
    };
    assert_eq!(line.received_qty, line.qty);
}

#[test]
fn stock_transfer_line_zero_qty_transfer() {
    let line = StockTransferLine {
        id: "stl-4".into(),
        transfer_id: "st-001".into(),
        sku: "SKU-000".into(),
        product_name: "Zero".into(),
        qty: 0,
        received_qty: 0,
    };
    let json = serde_json::to_string(&line).unwrap();
    let back: StockTransferLine = serde_json::from_str(&json).unwrap();
    assert_eq!(back.qty, 0);
    assert_eq!(back.received_qty, 0);
}

// ── Debug ────────────────────────────────────────────────────

#[test]
fn stock_transfer_debug() {
    let transfer = sample_transfer();
    let debug = format!("{:?}", transfer);
    assert!(debug.contains("TRF-20260701-001"));
    assert!(debug.contains("Warehouse A"));
}

#[test]
fn stock_transfer_line_debug() {
    let line = StockTransferLine {
        id: "stl-1".into(),
        transfer_id: "st-001".into(),
        sku: "SKU-123".into(),
        product_name: "Widget".into(),
        qty: 10,
        received_qty: 3,
    };
    let debug = format!("{:?}", line);
    assert!(debug.contains("SKU-123"));
    assert!(debug.contains("Widget"));
}
