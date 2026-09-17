//! Auto crop — tests.
//!
//! Verifies border trimming and centre/smart cropping.

use std::io::Cursor;

use image::{Rgb, RgbImage};

use super::{CropMode, auto_crop};
use crate::{ImageDimensions, MediaError};

/// Build a 100×100 image with a 10px border of colour `border` around a
/// coloured centre.
fn bordered_image(border: Rgb<u8>, centre: Rgb<u8>) -> Vec<u8> {
    let mut img = RgbImage::from_pixel(100, 100, border);
    for x in 10..90 {
        for y in 10..90 {
            img.put_pixel(x, y, centre);
        }
    }
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();
    buf
}

#[test]
fn trims_uniform_borders() {
    let src = bordered_image(Rgb([255, 255, 255]), Rgb([50, 50, 50]));
    let (out, dims) = auto_crop(&src, CropMode::TrimBorders, None).unwrap();

    // The 10px white border is trimmed: 100→80.
    assert_eq!(dims.width, 80);
    assert_eq!(dims.height, 80);
    assert!(!out.is_empty());
}

#[test]
fn centre_crop_to_square_keeps_dimensions() {
    let src = bordered_image(Rgb([0, 0, 0]), Rgb([120, 120, 120]));
    let (out, dims) =
        auto_crop(&src, CropMode::CenterCrop, Some(ImageDimensions::new(1, 1))).unwrap();

    // 100×100 → square crop of 1:1 → still 100×100.
    assert_eq!(dims.width, 100);
    assert_eq!(dims.height, 100);
    assert!(!out.is_empty());
}

#[test]
fn centre_crop_wide_to_portrait_ratio() {
    // 100×100 source, target ratio 2:3 (w/h) → source is wider, crop width.
    let src = bordered_image(Rgb([0, 0, 0]), Rgb([90, 90, 90]));
    let (_, dims) =
        auto_crop(&src, CropMode::CenterCrop, Some(ImageDimensions::new(2, 3))).unwrap();

    // Source 100×100, ratio 0.667 → crop height 100, width = 100*0.667 = 67.
    assert_eq!(dims.width, 67);
    assert_eq!(dims.height, 100);
}

#[test]
fn smart_crop_requires_target() {
    let src = bordered_image(Rgb([0, 0, 0]), Rgb([90, 90, 90]));
    let result = auto_crop(&src, CropMode::Smart, None);
    assert!(matches!(result, Err(MediaError::InvalidDimensions(_))));
}

#[test]
fn rejects_invalid_input() {
    let result = auto_crop(b"not-an-image", CropMode::TrimBorders, None);
    assert!(matches!(result, Err(MediaError::InvalidImage(_))));
}
