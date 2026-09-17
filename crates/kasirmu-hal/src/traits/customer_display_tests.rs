use super::*;
use crate::drivers::mock::MockCustomerDisplay;

#[tokio::test]
async fn mock_defaults() {
    let d = MockCustomerDisplay::new();
    let info = d.device_info();
    assert_eq!(info.vendor, "mock");
}

#[tokio::test]
async fn show_and_clear() {
    let d = MockCustomerDisplay::new();
    let content = DisplayContent {
        line1: "OZ MART".into(),
        line2: "Total: $12.50".into(),
    };
    d.show(&content).await.unwrap();
    assert_eq!(d.last_content(), Some(content));

    d.clear().await.unwrap();
    assert_eq!(d.last_content(), None);
}

#[tokio::test]
async fn brightness_defaults_to_max() {
    let d = MockCustomerDisplay::new();
    assert!((d.brightness() - 1.0).abs() < f32::EPSILON);
}

#[tokio::test]
async fn set_brightness_clamps() {
    let d = MockCustomerDisplay::new();
    d.set_brightness(0.5).await.unwrap();
    assert!((d.brightness() - 0.5).abs() < f32::EPSILON);

    d.set_brightness(1.5).await.unwrap();
    assert!((d.brightness() - 1.0).abs() < f32::EPSILON);

    d.set_brightness(-0.1).await.unwrap();
    assert!((d.brightness() - 0.0).abs() < f32::EPSILON);
}

// ── DisplayContent struct tests ───────────────────────────────────

#[test]
fn display_content_debug() {
    let content = DisplayContent {
        line1: "OZ MART".into(),
        line2: "Total: $12.50".into(),
    };
    let debug = format!("{content:?}");
    assert!(debug.contains("OZ MART"));
    assert!(debug.contains("Total: $12.50"));
}

#[test]
fn display_content_clone() {
    let content = DisplayContent {
        line1: "Line 1".into(),
        line2: "Line 2".into(),
    };
    let cloned = content.clone();
    assert_eq!(content, cloned);
    assert_eq!(cloned.line1, "Line 1");
    assert_eq!(cloned.line2, "Line 2");
}

#[test]
fn display_content_partial_eq() {
    let a = DisplayContent {
        line1: "Hello".into(),
        line2: "World".into(),
    };
    let b = DisplayContent {
        line1: "Hello".into(),
        line2: "World".into(),
    };
    assert_eq!(a, b);
}

#[test]
fn display_content_not_eq_when_lines_differ() {
    let a = DisplayContent {
        line1: "Hello".into(),
        line2: "World".into(),
    };
    let b = DisplayContent {
        line1: "Hello".into(),
        line2: "Different".into(),
    };
    assert_ne!(a, b);
}

#[test]
fn display_content_empty_strings() {
    let content = DisplayContent {
        line1: String::new(),
        line2: String::new(),
    };
    assert_eq!(content.line1, "");
    assert_eq!(content.line2, "");
}

#[test]
fn display_content_field_values() {
    let content = DisplayContent {
        line1: "Store Name".into(),
        line2: "Rp 50,000".into(),
    };
    assert_eq!(content.line1, "Store Name");
    assert_eq!(content.line2, "Rp 50,000");
}
