//! Tests for product image ingest pipeline (spec 0046b §3.3).
//!
//! Covers the pure helpers that don't need a Tauri runtime: magic-byte
//! sniffing, the WebP transcode pipeline (size/dimension caps, adaptive
//! quality, format rejection), and the 16-hex content hash.

use super::*;
use image::GenericImageView;

/// Build a small solid-colour PNG and return its bytes.
fn tiny_png_bytes() -> Vec<u8> {
    let img = image::RgbaImage::from_pixel(64, 64, image::Rgba([200, 50, 50, 255]));
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    out
}

/// Build a solid-colour JPEG and return its bytes.
fn tiny_jpeg_bytes() -> Vec<u8> {
    let img = image::RgbImage::from_pixel(64, 64, image::Rgb([120, 200, 90]));
    let mut out = Vec::new();
    img.write_to(
        &mut std::io::Cursor::new(&mut out),
        image::ImageFormat::Jpeg,
    )
    .unwrap();
    out
}

#[test]
fn sniff_detects_png() {
    let bytes = tiny_png_bytes();
    assert_eq!(sniff_format(&bytes), Ok("png"));
}

#[test]
fn sniff_detects_jpeg() {
    let bytes = tiny_jpeg_bytes();
    assert_eq!(sniff_format(&bytes), Ok("jpeg"));
}

#[test]
fn sniff_rejects_unknown_format() {
    let bytes = b"GIF89a..........."; // GIF magic — not allowed
    assert!(sniff_format(bytes).is_err());
}

#[test]
fn sniff_rejects_short_input() {
    assert!(sniff_format(b"tiny").is_err());
}

#[test]
fn sniff_accepts_webp_header() {
    // RIFF....WEBP header
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&[0u8; 4]);
    bytes.extend_from_slice(b"WEBP");
    bytes.extend_from_slice(&[0u8; 8]);
    assert_eq!(sniff_format(&bytes), Ok("webp"));
}

#[test]
fn transcode_png_to_webp_under_caps() {
    let bytes = tiny_png_bytes();
    let webp = transcode_to_webp(&bytes).unwrap();
    // Must be a WebP file, ≤ 512px, and under the hard reject cap.
    assert!(webp.starts_with(b"RIFF") && &webp[8..12] == b"WEBP");
    assert!(
        webp.len() <= SIZE_HARD_REJECT,
        "webp too large: {}",
        webp.len()
    );
    assert!(!webp.is_empty());
}

#[test]
fn transcode_jpeg_to_webp_under_caps() {
    let bytes = tiny_jpeg_bytes();
    let webp = transcode_to_webp(&bytes).unwrap();
    assert!(webp.starts_with(b"RIFF") && &webp[8..12] == b"WEBP");
    assert!(webp.len() <= SIZE_HARD_REJECT);
}

#[test]
fn transcode_rejects_oversized_input() {
    // A 5000x5000 all-black PNG would exceed MAX_DIMENSION.
    let img = image::RgbaImage::new(5000, 5000);
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    // 5000*5000 = 25M pixels > 16.7M cap → rejected
    let err = transcode_to_webp(&out).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(_)));
}

#[test]
fn transcode_rejects_garbage_bytes() {
    let garbage = vec![0x00u8; 512];
    let err = transcode_to_webp(&garbage).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(_)));
}

#[test]
fn transcode_preserves_aspect_ratio_within_512() {
    // 1024x512 input → 512x256 output (longest edge 512)
    let img = image::RgbaImage::from_fn(1024, 512, |x, y| {
        image::Rgba([(x % 256) as u8, (y % 256) as u8, 0, 255])
    });
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    let webp = transcode_to_webp(&out).unwrap();

    // Decode the resulting WebP to verify dimensions
    let decoded = image::load_from_memory(&webp).unwrap();
    let (w, h) = decoded.dimensions();
    assert_eq!(w, 512);
    assert_eq!(h, 256);
}

#[test]
fn sha256_hex16_is_stable_and_16_chars() {
    let hash = sha256_hex16(b"hello world");
    assert_eq!(hash.len(), 16);
    // Deterministic
    assert_eq!(hash, sha256_hex16(b"hello world"));
    // Different input → different hash
    assert_ne!(hash, sha256_hex16(b"hello worlD"));
    // All lowercase hex
    assert!(
        hash.chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    );
}
