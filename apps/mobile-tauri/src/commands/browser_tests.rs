use super::*;

#[test]
fn urlencoding_encodes_query() {
    assert_eq!(urlencoding("Coca Cola"), "Coca+Cola");
    assert_eq!(urlencoding("Bakso 100%"), "Bakso+100%25");
}
