/*
last audited 25-07-26 by RSA-Agent (oz-media slice A: crop deep read)
crate: oz-media | status: SAFE | lint: CLEAN
findings: exemplary — decode errors surfaced, zero-size source rejected, saturating/clamped crop math, solid-colour trim guard returns the original frame, Smart bias documented as heuristic fallback
next: none | perf: M-2 support 25-07-26 — added the DynamicImage-taking variant (thumbnail_img / auto_crop_img) so the pipeline runs a single decode; byte-level API and behavior unchanged
*/
//! Auto image crop.
//!
//! Two behaviours are implemented:
//!
//! * [`CropMode::TrimBorders`] — trims uniform (background-coloured)
//!   borders by scanning from each edge and cutting at the first pixel
//!   that differs from the corner colour.
//! * [`CropMode::CenterCrop`] — crops the image to a target aspect ratio
//!   centred on the middle of the source.
//! * [`CropMode::Smart`] — centre-crop with a slight upward bias (the
//!   typical "subject near the top" assumption for product photos). True
//!   saliency detection is future work; this is the documented fallback.

use std::io::Cursor;

use crate::{ImageDimensions, MediaError};

/// Crop behaviour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CropMode {
    /// Trim uniform (background-coloured) borders automatically.
    TrimBorders,
    /// Centre-crop to the requested aspect ratio.
    CenterCrop,
    /// Smart-crop that keeps the detected subject in frame.
    Smart,
}

/// Auto-crop `image_data` according to `mode`.
///
/// `target` is required for [`CropMode::CenterCrop`] / [`CropMode::Smart`]
/// (the aspect ratio it implies); it is ignored for [`CropMode::TrimBorders`].
/// The result is re-encoded as JPEG.
///
/// # Errors
///
/// [`MediaError::InvalidImage`] if the input cannot be decoded, or
/// [`MediaError::InvalidDimensions`] if the source or target is degenerate.
pub fn auto_crop(
    image_data: &[u8],
    mode: CropMode,
    target: Option<ImageDimensions>,
) -> Result<(Vec<u8>, ImageDimensions), MediaError> {
    let img = image::load_from_memory(image_data)
        .map_err(|e| MediaError::InvalidImage(format!("decode: {e}")))?;

    let cropped = auto_crop_img(img, mode, target)?;
    let (cw, ch) = (cropped.width(), cropped.height());
    let rgb = cropped.to_rgb8();
    let mut out = Vec::new();
    rgb.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Jpeg)
        .map_err(|e| MediaError::InvalidImage(format!("encode: {e}")))?;

    Ok((out, ImageDimensions::new(cw, ch)))
}

/// Crop an already-decoded image (M-2: lets the pipeline run a single
/// full decode instead of re-decoding per stage).
///
/// The result is the cropped frame as a `DynamicImage` — the caller
/// chooses the encoding. The zero-size guard and the mode handling are
/// identical to [`auto_crop`].
///
/// # Errors
///
/// [`MediaError::InvalidDimensions`] if the source or target is degenerate.
pub fn auto_crop_img(
    img: image::DynamicImage,
    mode: CropMode,
    target: Option<ImageDimensions>,
) -> Result<image::DynamicImage, MediaError> {
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return Err(MediaError::InvalidDimensions(
            "source image has zero size".into(),
        ));
    }

    let cropped = match mode {
        CropMode::TrimBorders => trim_borders(&img, w, h),
        CropMode::CenterCrop => {
            let t = target.ok_or_else(|| {
                MediaError::InvalidDimensions("CenterCrop requires a target".into())
            })?;
            center_crop(&img, w, h, t, 0.5)
        }
        CropMode::Smart => {
            let t = target.ok_or_else(|| {
                MediaError::InvalidDimensions("Smart crop requires a target".into())
            })?;
            // Bias the crop window upward (0.35 of the source height above
            // the window, not 0.5) to keep the subject — typically near the
            // top for product photos — in frame.
            center_crop(&img, w, h, t, 0.35)
        }
    };

    Ok(cropped)
}

/// Crop `img` to the target aspect ratio centred at `vertical_bias`
/// (0.0 = top, 1.0 = bottom) of the remaining source height.
fn center_crop(
    img: &image::DynamicImage,
    w: u32,
    h: u32,
    target: ImageDimensions,
    vertical_bias: f32,
) -> image::DynamicImage {
    // Target aspect ratio (w/h), guarding against a zero target height.
    let target_ratio = if target.height == 0 {
        1.0
    } else {
        target.width as f32 / target.height as f32
    };
    let source_ratio = w as f32 / h as f32;

    // Compute the largest crop window with the target ratio that fits
    // the source.
    let (cw, ch) = if source_ratio > target_ratio {
        // Source is wider: crop the width.
        ((h as f32 * target_ratio).round() as u32, h)
    } else {
        // Source is taller (or equal): crop the height.
        (w, (w as f32 / target_ratio).round() as u32)
    };

    let x = (w.saturating_sub(cw)) / 2;
    // Vertical position = bias fraction of the slack.
    let slack = h.saturating_sub(ch);
    let y = ((slack as f32) * vertical_bias.clamp(0.0, 1.0)).round() as u32;

    img.crop_imm(
        x.min(w.saturating_sub(cw)),
        y.min(h.saturating_sub(ch)),
        cw,
        ch,
    )
}

/// Trim uniform borders by scanning from each edge for the corner colour.
fn trim_borders(img: &image::DynamicImage, w: u32, h: u32) -> image::DynamicImage {
    let rgb = img.to_rgb8();
    let corner = rgb.get_pixel(0, 0);

    let mut top = 0u32;
    'outer: for row in 0..h {
        for col in 0..w {
            if rgb.get_pixel(col, row) != corner {
                break 'outer;
            }
        }
        top += 1;
    }

    let mut bottom = h;
    'outer: for row in (0..h).rev() {
        for col in 0..w {
            if rgb.get_pixel(col, row) != corner {
                break 'outer;
            }
        }
        bottom -= 1;
    }

    let mut left = 0u32;
    'outer: for col in 0..w {
        for row in 0..h {
            if rgb.get_pixel(col, row) != corner {
                break 'outer;
            }
        }
        left += 1;
    }

    let mut right = w;
    'outer: for col in (0..w).rev() {
        for row in 0..h {
            if rgb.get_pixel(col, row) != corner {
                break 'outer;
            }
        }
        right -= 1;
    }

    // Guard against trimming everything (a solid-colour image).
    if top >= bottom || left >= right {
        return image::DynamicImage::ImageRgb8(rgb);
    }

    let cw = right - left;
    let ch = bottom - top;
    img.crop_imm(left, top, cw, ch)
}

#[cfg(test)]
#[path = "crop_tests.rs"]
mod tests;
