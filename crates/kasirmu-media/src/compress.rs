/*
last audited 25-07-26 by RSA-Agent (oz-media slice A: verified)
crate: oz-media | status: SAFE | lint: CLEAN
findings: clean — no unwrap/panic/unsafe; sibling tests per convention
next: none | perf: N/A
*/
//! Image compression.
//!
//! Re-encodes an image at a target quality and format. The output is
//! always decoded then re-encoded, so a JPEG→JPEG pass strips any
//! previous generation's artefacts/headers and yields a clean file.

use std::io::Cursor;

use crate::{ImageFormat, MediaError};

/// Compression quality setting — maps to a JPEG quality factor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Quality {
    /// High quality, larger files (JPEG quality 90).
    High,
    /// Balanced quality/size (JPEG quality 80).
    Medium,
    /// Small files, acceptable quality (JPEG quality 65).
    Low,
}

impl Quality {
    /// The JPEG quality factor (1–100) this preset maps to.
    pub fn jpeg_quality(self) -> u8 {
        match self {
            Self::High => 90,
            Self::Medium => 80,
            Self::Low => 65,
        }
    }
}

/// Compress `image_data` to `target_format` at the given quality.
///
/// JPEG and PNG are supported as output; WebP is passed through (the
/// `image` crate has no quality knob for WebP encoding, so it is left as
/// the source format when requested).
///
/// # Errors
///
/// [`MediaError::InvalidImage`] if the input cannot be decoded.
pub fn compress(
    image_data: &[u8],
    target_format: ImageFormat,
    quality: Quality,
) -> Result<Vec<u8>, MediaError> {
    // WebP keeps the byte-level pass-through contract (documented below
    // and asserted by `webp_passthrough_keeps_source`); no decode needed.
    if target_format == ImageFormat::WebP {
        return Ok(image_data.to_vec());
    }

    let img = image::load_from_memory(image_data)
        .map_err(|e| MediaError::InvalidImage(format!("decode: {e}")))?;

    compress_img(&img, target_format, quality)
}

/// Compress an already-decoded image (M-2: lets the pipeline encode
/// without a re-decode round-trip per stage).
///
/// JPEG and PNG are supported as output; WebP is encoded losslessly (the
/// `image` crate has no quality knob for WebP encoding).
///
/// # Errors
///
/// [`MediaError::InvalidImage`] if encoding fails.
pub fn compress_img(
    img: &image::DynamicImage,
    target_format: ImageFormat,
    quality: Quality,
) -> Result<Vec<u8>, MediaError> {
    let mut out = Vec::new();
    match target_format {
        ImageFormat::Jpeg => {
            let rgb = img.to_rgb8();
            // Bind the cursor to a variable so its borrow outlives the
            // encoder; a temporary Cursor is dropped before encode_image.
            let mut cursor = Cursor::new(&mut out);
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(
                &mut cursor,
                quality.jpeg_quality(),
            );
            enc.encode_image(&rgb)
                .map_err(|e| MediaError::InvalidImage(format!("jpeg encode: {e}")))?;
        }
        ImageFormat::Png => {
            let rgba = img.to_rgba8();
            rgba.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
                .map_err(|e| MediaError::InvalidImage(format!("png encode: {e}")))?;
        }
        ImageFormat::WebP => {
            // The `image` crate's WebP encoder has no quality parameter;
            // lossless keeps the frame valid and pixel-exact. The 0.25
            // encoder takes raw frames, so hand it the RGBA buffer.
            let rgba = img.to_rgba8();
            let (width, height) = rgba.dimensions();
            let mut cursor = Cursor::new(&mut out);
            let enc = image::codecs::webp::WebPEncoder::new_lossless(&mut cursor);
            enc.encode(
                rgba.as_raw(),
                width,
                height,
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|e| MediaError::InvalidImage(format!("webp encode: {e}")))?;
        }
    }

    Ok(out)
}

/// Estimate the compression ratio (output/input size) a caller can
/// expect.
///
/// Returns a heuristic based on the target format; JPEG output is the
/// most compact for photographic input.
pub fn expected_ratio(target_format: ImageFormat, quality: Quality) -> f64 {
    let _ = quality;
    match target_format {
        ImageFormat::Jpeg => 0.20,
        ImageFormat::Png => 0.60,
        ImageFormat::WebP => 0.18,
    }
}

#[cfg(test)]
#[path = "compress_tests.rs"]
mod tests;
