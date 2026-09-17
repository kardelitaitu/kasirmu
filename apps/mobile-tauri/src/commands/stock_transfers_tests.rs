use super::*;

#[test]
fn received_line_input_deserialize() {
    let json = r#"{"line_id":"l1","received_qty":5}"#;
    let input: ReceivedLineInput = serde_json::from_str(json).unwrap();
    assert_eq!(input.line_id, "l1");
    assert_eq!(input.received_qty, 5);
}

#[test]
fn received_line_input_debug() {
    let input = ReceivedLineInput {
        line_id: "l2".into(),
        received_qty: 10,
    };
    let debug = format!("{:?}", input);
    assert!(debug.contains("l2"));
    assert!(debug.contains("10"));
}

#[test]
fn transfer_with_lines_serialize() {
    let transfer = StockTransfer {
        id: "t1".into(),
        transfer_number: "TRF-20260115-001".into(),
        source_location: Some("Warehouse".into()),
        destination_location: Some("Store A".into()),
        source_terminal_id: None,
        destination_terminal_id: None,
        status: "draft".into(),
        notes: "test transfer".into(),
        created_by: "admin".into(),
        sent_at: None,
        received_at: None,
        received_by: None,
        created_at: "2026-01-15T10:00:00Z".into(),
        updated_at: "2026-01-15T10:00:00Z".into(),
    };
    let lines: Vec<StockTransferLine> = vec![];
    let twl = TransferWithLines { transfer, lines };
    let json = serde_json::to_value(&twl).unwrap();
    assert_eq!(json["transfer"]["id"], "t1");
}

#[test]
fn transfer_with_lines_debug() {
    let transfer = StockTransfer {
        id: "t2".into(),
        transfer_number: "TRF-20260115-002".into(),
        source_location: None,
        destination_location: None,
        source_terminal_id: None,
        destination_terminal_id: None,
        status: "draft".into(),
        notes: String::new(),
        created_by: "admin".into(),
        sent_at: None,
        received_at: None,
        received_by: None,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let twl = TransferWithLines {
        transfer,
        lines: vec![],
    };
    let debug = format!("{:?}", twl);
    assert!(debug.contains("t2"));
}
