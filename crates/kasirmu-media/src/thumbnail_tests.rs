//! Thumbnail generation — tests.
//!
//! Generates small in-memory source images and verifies the thumbnail
//! preserves aspect ratio and fits the requested bounding box.

use std::io::Cursor;

use image::RgbImage;

use super::generate_thumbnail;
use crate::{ImageDimensions, MediaError};

/// Build an 800×600 RGB source image with a known colour.
fn source_image() -> Vec<u8> {
    let img = RgbImage::from_pixel(800, 600, image::Rgb([200u8, 30, 30]));
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();
    buf
}

#[test]
fn thumbnail_fits_within_box_and_preserves_ratio() {
    let src = source_image();
    let (out, dims) = generate_thumbnail(&src, ImageDimensions::new(64, 64)).unwrap();

    // 800×600 → 64×48: width saturates the box, height follows ratio.
    assert_eq!(dims.width, 64);
    assert_eq!(dims.height, 48);
    // 64:48 == 4:3 == 800:600.
    assert_eq!(dims.width * 3, dims.height * 4);
    assert!(!out.is_empty());
}

#[test]
fn thumbnail_smaller_than_box_is_upscaled_to_fit() {
    // A 32×24 source against a 64×64 box upscales to 64×48.
    let img = RgbImage::from_pixel(32, 24, image::Rgb([10, 200, 60]));
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();

    let (_out, dims) = generate_thumbnail(&buf, ImageDimensions::new(64, 64)).unwrap();
    assert_eq!(dims.width, 64);
    assert_eq!(dims.height, 48);
}

#[test]
fn portrait_image_fits_by_height() {
    let img = RgbImage::from_pixel(600, 800, image::Rgb([60, 60, 200]));
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();

    let (_out, dims) = generate_thumbnail(&buf, ImageDimensions::new(64, 64)).unwrap();
    // 600×800 → 48×64: height saturates the box.
    assert_eq!(dims.width, 48);
    assert_eq!(dims.height, 64);
}

#[test]
fn rejects_degenerate_input() {
    let result = generate_thumbnail(b"not-an-image", ImageDimensions::new(64, 64));
    assert!(matches!(result, Err(MediaError::InvalidImage(_))));
}

#[test]
fn rejects_zero_max_dimensions() {
    let src = source_image();
    let result = generate_thumbnail(&src, ImageDimensions::new(0, 0));
    assert!(matches!(result, Err(MediaError::InvalidDimensions(_))));
}
