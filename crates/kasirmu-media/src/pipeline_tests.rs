//! Media pipeline — transform composition + content hash tests.
//!
//! The transform stages are implemented; storage persistence is PLANNED.

use std::io::Cursor;

use image::RgbImage;

use super::{MediaLimits, MediaPipeline, content_hash};
use crate::compress::Quality;
use crate::crop::CropMode;
use crate::storage::LocalStorage;
use crate::thumbnail::ThumbnailPreset;
use crate::{ImageDimensions, ImageFormat};

/// Build a 400×300 RGB source image.
fn source_image() -> Vec<u8> {
    let img = RgbImage::from_pixel(400, 300, image::Rgb([200u8, 30, 30]));
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();
    buf
}

#[test]
fn transform_produces_original_plus_thumbnails() {
    let storage = LocalStorage::new("/tmp/media");
    let pipeline = MediaPipeline::new(storage);
    let src = source_image();

    let variants = pipeline
        .transform("photo.png", &src, CropMode::TrimBorders, None, ImageFormat::Jpeg,
            Quality::Medium,
            &[ThumbnailPreset::Small, ThumbnailPreset::Large],
        )
        .unwrap();

    // original + 2 presets.
    assert_eq!(variants.len(), 3);
    assert_eq!(variants[0].key, "photo.png");
    assert_eq!(variants[1].key, "photo.png_small");
    assert_eq!(variants[2].key, "photo.png_large");

    // Thumbnail dims respect their presets (400×300 → 128×96, 512×384).
    assert_eq!(variants[1].dimensions, ImageDimensions::new(128, 96));
    assert_eq!(variants[2].dimensions, ImageDimensions::new(512, 384));
}

#[test]
fn process_applies_transforms_without_persisting() {
    // process() is a stub for persistence but must apply the real
    // transforms and return the same variants as transform().
    let storage = LocalStorage::new("/tmp/media");
    let pipeline = MediaPipeline::new(storage);
    let src = source_image();

    let rt = tokio::runtime::Runtime::new().unwrap();
    let variants = rt
        .block_on(pipeline.process(
            "products/abc",
            "photo.png",
            &src,
            CropMode::TrimBorders,
            None,
            ImageFormat::Jpeg,
            Quality::Low,
            &[ThumbnailPreset::Icon],
        ))
        .unwrap();

    assert_eq!(variants.len(), 2);
    assert_eq!(variants[1].dimensions, ImageDimensions::new(64, 48));
}

#[test]
fn transform_rejects_oversized_input() {
    let storage = LocalStorage::new("/tmp/media");
    let pipeline = MediaPipeline::new(storage);
    let big = vec![0u8; 21 * 1024 * 1024]; // > 20 MiB default limit.
    let result = pipeline.transform("big.bin", &big, CropMode::TrimBorders, None, ImageFormat::Jpeg,
        Quality::Low,
        &[],
    );
    assert!(result.is_err(), "oversized input must be rejected");
}

#[test]
fn content_hash_is_stable_sha256() {
    let h1 = content_hash(b"hello world");
    let h2 = content_hash(b"hello world");
    assert_eq!(h1, h2);
    assert_eq!(h1.len(), 64);
    assert_eq!(
        h1,
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    );
}

#[test]
fn content_hash_differs_for_diff_inputs() {
    assert_ne!(content_hash(b"a"), content_hash(b"b"));
}

// ── MED-A/MED-B: crop modes reachable, degenerate target refused ────

/// MED-A: CenterCrop and Smart must work through the pipeline.
///
/// `transform` hard-coded `None` as the crop target, so both target-based
/// modes returned InvalidDimensions and only TrimBorders could ever run.
#[test]
fn transform_supports_target_based_crop_modes() {
    let pipeline = MediaPipeline::new(LocalStorage::new("/tmp/media"));
    let src = source_image();
    let target = ImageDimensions::new(100, 100);

    for mode in [CropMode::CenterCrop, CropMode::Smart] {
        let variants = pipeline
            .transform(
                "photo.png",
                &src,
                mode,
                Some(target),
                ImageFormat::Jpeg,
                Quality::Medium,
                &[],
            )
            .unwrap_or_else(|e| panic!("{mode:?} must work through the pipeline: {e}"));
        assert_eq!(variants.len(), 1);
    }
}

/// A target-based mode without a target is still a clean error.
#[test]
fn transform_requires_a_target_for_target_based_modes() {
    let pipeline = MediaPipeline::new(LocalStorage::new("/tmp/media"));
    let err = pipeline
        .transform(
            "photo.png",
            &source_image(),
            CropMode::CenterCrop,
            None,
            ImageFormat::Jpeg,
            Quality::Medium,
            &[],
        )
        .unwrap_err();
    assert!(
        err.to_string().contains("require a target"),
        "unexpected error: {err}"
    );
}

/// MED-B: a degenerate target must be refused, not produce a 0xN image.
///
/// The doc promised InvalidDimensions for a degenerate target but only the
/// source was checked, so `Some(ImageDimensions::new(0, 100))` returned Ok
/// with a zero-width frame.
#[test]
fn degenerate_crop_target_is_refused() {
    let src = source_image();
    let img = image::load_from_memory(&src).unwrap();
    for target in [
        ImageDimensions::new(0, 100),
        ImageDimensions::new(100, 0),
        ImageDimensions::new(0, 0),
    ] {
        let result = crate::crop::auto_crop_img(img.clone(), CropMode::CenterCrop, Some(target));
        assert!(
            result.is_err(),
            "a degenerate target must be refused: {target:?}"
        );
    }
}

// ── M-1: decompression-bomb dimension guards ──────────────────────

#[test]
fn transform_rejects_dimensions_over_max_side() {
    let storage = LocalStorage::new("/tmp/media");
    // 400x300 source vs a tiny max_side: the header probe must reject
    // before any decode allocates a pixel buffer.
    let limits = MediaLimits {
        max_side: 100,
        ..MediaLimits::default()
    };
    let pipeline = MediaPipeline::with_limits(storage, limits);
    let err = pipeline
        .transform("bomb.png", &source_image(), CropMode::TrimBorders, None, ImageFormat::Jpeg,
            Quality::Medium,
            &[],
        )
        .unwrap_err();
    assert!(
        err.to_string().contains("max_side"),
        "unexpected error: {err}"
    );
}

#[test]
fn transform_rejects_pixel_count_over_max_pixels() {
    let storage = LocalStorage::new("/tmp/media");
    // 400x300 = 120_000 pixels vs a 50_000 cap: sides are fine, the total
    // pixel budget is not.
    let limits = MediaLimits {
        max_pixels: 50_000,
        ..MediaLimits::default()
    };
    let pipeline = MediaPipeline::with_limits(storage, limits);
    let err = pipeline
        .transform("bomb.png", &source_image(), CropMode::TrimBorders, None, ImageFormat::Jpeg,
            Quality::Medium,
            &[],
        )
        .unwrap_err();
    assert!(
        err.to_string().contains("max_pixels"),
        "unexpected error: {err}"
    );
}
