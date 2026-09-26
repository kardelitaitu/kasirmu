//! Unit tests for `render`.
//!
//! Moved out of `render.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `render.rs` with:
//!   `#[cfg(test)] #[path = "render_tests.rs"] mod tests;`

use super::*;

#[test]
fn png_starts_with_png_magic() {
    // Use the builder to produce a real payload string
    let payload = crate::QrisBuilder::new()
        .nmid("ID1020001234567")
        .merchant_name("Test")
        .merchant_city("Jakarta")
        .merchant_category_code("5812")
        .build()
        .unwrap()
        .to_qris_string()
        .unwrap();

    let png = to_png(&payload, 300).unwrap();
    assert_eq!(
        &png[..4],
        b"\x89PNG",
        "output must start with PNG magic bytes"
    );
}

#[test]
fn svg_contains_svg_tag() {
    let payload = crate::QrisBuilder::new()
        .nmid("ID1020001234567")
        .merchant_name("Test")
        .merchant_city("Jakarta")
        .merchant_category_code("5812")
        .build()
        .unwrap()
        .to_qris_string()
        .unwrap();

    let svg = to_svg(&payload).unwrap();
    assert!(svg.contains("<svg"), "output must contain an <svg> element");
}
