//! Image compression — tests.
//!
//! Verifies JPEG re-encode at different quality presets and that PNG
//! output round-trips.

use std::io::Cursor;

use image::RgbImage;

use super::compress;
use crate::{ImageFormat, MediaError, compress::Quality};

/// A photographic-ish source: a 100×100 gradient (JPEG-compressible).
fn source_image() -> Vec<u8> {
    let mut img = RgbImage::new(100, 100);
    for (x, y, px) in img.enumerate_pixels_mut() {
        *px = image::Rgb([x as u8, y as u8, 128]);
    }
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();
    buf
}

#[test]
fn jpeg_compress_produces_valid_output() {
    let src = source_image();
    let out = compress(&src, ImageFormat::Jpeg, Quality::Medium).unwrap();
    assert!(!out.is_empty());
    // Output must be a decodable JPEG.
    let decoded = image::load_from_memory(&out).unwrap();
    assert!(decoded.width() > 0);
}

#[test]
fn higher_quality_is_larger_or_equal() {
    let src = source_image();
    let low = compress(&src, ImageFormat::Jpeg, Quality::Low).unwrap();
    let high = compress(&src, ImageFormat::Jpeg, Quality::High).unwrap();
    // Quality 90 ≥ quality 65 in size (strictly greater on this gradient).
    assert!(
        high.len() >= low.len(),
        "high={} low={}",
        high.len(),
        low.len()
    );
}

#[test]
fn png_round_trips() {
    let src = source_image();
    let out = compress(&src, ImageFormat::Png, Quality::Medium).unwrap();
    let decoded = image::load_from_memory(&out).unwrap();
    assert_eq!(decoded.width(), 100);
    assert_eq!(decoded.height(), 100);
}

#[test]
fn webp_passthrough_keeps_source() {
    let src = source_image();
    let out = compress(&src, ImageFormat::WebP, Quality::Low).unwrap();
    assert_eq!(out, src);
}

#[test]
fn rejects_invalid_input() {
    let result = compress(b"not-an-image", ImageFormat::Jpeg, Quality::Medium);
    assert!(matches!(result, Err(MediaError::InvalidImage(_))));
}

#[test]
fn expected_ratio_is_reasonable() {
    assert!(super::expected_ratio(ImageFormat::Jpeg, Quality::High) < 1.0);
    assert!(super::expected_ratio(ImageFormat::Jpeg, Quality::High) > 0.0);
}
