use super::*;

#[test]
fn quantities_reject_negative_values() {
    assert!(validate_quantity("counted_qty", -1).is_err());
    assert!(validate_quantity("counted_qty", 0).is_ok());
}

#[test]
fn difference_is_checked() {
    assert_eq!(difference(Some(8), 10).unwrap(), -2);
    assert_eq!(difference(None, 10).unwrap(), 0);
    assert!(difference(Some(i64::MAX), i64::MIN).is_err());
}

#[test]
fn create_args_ignore_no_actor_field() {
    let args: CreateStockCountArgs =
        serde_json::from_str(r#"{"countType":"full","notes":"cycle","countedBy":"forged"}"#)
            .unwrap();
    assert_eq!(args.count_type, "full");
    assert_eq!(args.notes, "cycle");
}
